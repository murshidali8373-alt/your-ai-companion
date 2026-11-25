/**
 * Public extension endpoint for real File Workspace operations:
 * - Parse & store uploaded CSV / TSV / TXT / JSON / XLSX / DOCX / PDF
 * - Compare two stored spreadsheets / XLSX workbooks
 * - Generate & verify XLSX / DOCX / PDF / CSV / JSON reports
 * - Non-destructively update XLSX or DOCX artifacts
 * - List & download generated artifacts safely
 */

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  buildExtensionCorsHeaders,
  extensionJsonResponse,
  handleExtensionOptions,
} from "@/lib/extension-cors.server";
import { verifyBearer } from "@/lib/supabase-bearer.server";
import {
  compareXlsxBuffers,
  createDocxBuffer,
  createPdfBuffer,
  createXlsxBuffer,
  deleteWorkspaceArtifact,
  getWorkspaceArtifact,
  listWorkspaceArtifacts,
  parseWorkspaceBuffer,
  storeWorkspaceArtifact,
  SUPPORTED_WORKSPACE_EXTENSIONS,
  updateDocxBufferNonDestructively,
  updateXlsxBufferNonDestructively,
} from "@/lib/engines/file-parsers.server";
import { analyzeSpreadsheetData, detectMissingValuesReport, detectStatisticalOutliers } from "@/lib/engines/data-intelligence-engine";
import {
  checkApiRateLimit,
  extractCallerKey,
  sanitizeContentDispositionFilename,
} from "@/lib/security/guardrails.server";
import { recordTelemetry, startTelemetrySpan } from "@/lib/telemetry/observability.server";

const uploadSchema = z.object({
  action: z.literal("upload").default("upload"),
  filename: z.string().min(1).max(200),
  mimeType: z.string().max(120).optional(),
  base64Data: z.string().max(20_000_000).optional(),
  textContent: z.string().max(10_000_000).optional(),
});

const compareSchema = z.object({
  action: z.literal("compare"),
  baseArtifactId: z.string().min(1),
  compareArtifactId: z.string().min(1),
  keyField: z.string().optional(),
  compareFields: z.array(z.string()).optional(),
});

const generateSchema = z.object({
  action: z.literal("generate"),
  format: z.enum(["xlsx", "docx", "pdf", "csv", "json"]),
  filename: z.string().min(1).max(200),
  title: z.string().max(200).optional(),
  rows: z.array(z.record(z.unknown())).optional(),
  sections: z
    .array(
      z.object({
        heading: z.string().optional(),
        body: z.string().optional(),
        paragraphs: z.array(z.string()).optional(),
        bullets: z.array(z.string()).optional(),
      }),
    )
    .optional(),
});

const updateSchema = z.object({
  action: z.literal("update"),
  artifactId: z.string().min(1),
  xlsxUpdates: z
    .array(
      z.object({
        matchKey: z.string().optional(),
        matchValue: z.unknown().optional(),
        targetColumn: z.string().optional(),
        cellAddress: z.string().optional(),
        newValue: z.unknown(),
        formula: z.string().optional(),
      }),
    )
    .optional(),
  docxReplacements: z.array(z.object({ find: z.string(), replace: z.string() })).optional(),
  docxAppendParagraphs: z.array(z.string()).optional(),
});

function decodeBase64Payload(raw: string): Buffer {
  const cleaned = raw.includes(",") ? raw.split(",")[1] ?? "" : raw;
  return Buffer.from(cleaned, "base64");
}

export const Route = createFileRoute("/api/public/extension/workspace")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => handleExtensionOptions(request),

      GET: async ({ request }) => {
        let auth = null;
        try {
          auth = await verifyBearer(request.headers.get("authorization"));
        } catch {
          auth = null;
        }
        const ownerId = auth?.userId ?? "guest";
        const url = new URL(request.url);
        const downloadId = url.searchParams.get("downloadId");

        if (downloadId) {
          const art = getWorkspaceArtifact(downloadId, ownerId);
          if (!art) {
            return extensionJsonResponse(request, { ok: false, message: "Artifact not found." }, 404);
          }
          const safeFilename = sanitizeContentDispositionFilename(art.filename);
          return new Response(new Uint8Array(art.buffer), {
            status: 200,
            headers: {
              "Content-Type": art.mimeType,
              "Content-Disposition": `attachment; filename="${safeFilename}"`,
              "X-Content-Type-Options": "nosniff",
              "Cache-Control": "no-store",
              ...buildExtensionCorsHeaders(request),
            },
          });
        }

        const inspectId = url.searchParams.get("inspectId");
        if (inspectId) {
          const art = getWorkspaceArtifact(inspectId, ownerId);
          if (!art) {
            return extensionJsonResponse(request, { ok: false, message: "Artifact not found." }, 404);
          }
          return extensionJsonResponse(request, {
            ok: true,
            artifact: {
              artifactId: art.artifactId,
              filename: art.filename,
              extension: art.extension,
              mimeType: art.mimeType,
              sizeBytes: art.sizeBytes,
              summary: art.summary,
              parsedPreview: art.parsedPreview,
              verified: art.verified,
              createdAt: art.createdAt,
            },
          });
        }

        return extensionJsonResponse(request, {
          ok: true,
          supportedFormats: SUPPORTED_WORKSPACE_EXTENSIONS,
          artifacts: listWorkspaceArtifacts(ownerId),
        });
      },

      POST: async ({ request }) => {
        let auth = null;
        try {
          auth = await verifyBearer(request.headers.get("authorization"));
        } catch {
          auth = null;
        }
        const ownerId = auth?.userId ?? "guest";
        const callerKey = extractCallerKey(request, ownerId);
        const rate = checkApiRateLimit("extension_workspace", callerKey, {
          maxRequests: 80,
          windowMs: 60_000,
        });
        if (!rate.allowed) {
          recordTelemetry({
            type: "security.block",
            outcome: "blocked",
            userId: ownerId,
            detail: `Rate limit exceeded on /api/public/extension/workspace (${callerKey})`,
          });
          return extensionJsonResponse(
            request,
            {
              ok: false,
              error: "rate_limited",
              message: `Too many workspace requests. Retry after ${rate.retryAfterSeconds}s.`,
              retryAfterSeconds: rate.retryAfterSeconds,
            },
            429,
          );
        }

        let rawBody: Record<string, unknown>;
        try {
          rawBody = (await request.json()) as Record<string, unknown>;
        } catch {
          return extensionJsonResponse(request, { ok: false, message: "Invalid JSON body." }, 400);
        }

        const action = String(rawBody["action"] ?? "upload");
        const span = startTelemetrySpan({
          type: "file.parse",
          userId: ownerId,
          detail: `Workspace action: ${action}`,
        });

        try {
          if (action === "upload") {
            const parsedReq = uploadSchema.parse(rawBody);
            const safeName = sanitizeContentDispositionFilename(parsedReq.filename);
            if (/[\\/]|\.\./.test(parsedReq.filename)) {
              span.finish("blocked", `Path traversal rejected in upload filename: ${safeName}`);
              return extensionJsonResponse(
                request,
                { ok: false, message: "Invalid filename: path separators are not allowed." },
                400,
              );
            }
            const buffer = parsedReq.base64Data
              ? decodeBase64Payload(parsedReq.base64Data)
              : Buffer.from(parsedReq.textContent ?? "", "utf8");

            const parsed = await parseWorkspaceBuffer(safeName, buffer);
            const tableRows = parsed.table?.rows ?? [];
            const sheetAnalysis = tableRows.length > 0 ? analyzeSpreadsheetData(tableRows) : undefined;
            const missingReport = tableRows.length > 0 ? detectMissingValuesReport(tableRows) : undefined;
            const firstNumericCol = sheetAnalysis?.columns.find(
              (c) => c.inferredType === "numeric" || c.inferredType === "currency",
            )?.name;
            const outliers =
              tableRows.length >= 4 && firstNumericCol
                ? detectStatisticalOutliers(tableRows, firstNumericCol)
                : [];

            const artifact = storeWorkspaceArtifact({
              ownerId,
              filename: safeName,
              mimeType: parsedReq.mimeType || "application/octet-stream",
              buffer,
              summary: parsed.summary,
              verified: true,
              parsedPreview: {
                extension: parsed.extension,
                headers: parsed.table?.headers,
                rowCount: parsed.table?.rowCount,
                sampleRows: tableRows.slice(0, 8),
                sheetNames: parsed.workbook?.sheetNames,
                formulasCount: parsed.workbook?.sheets.reduce((a, s) => a + s.formulas.length, 0),
                docxHeadings: parsed.docx?.headings,
                docxTablesCount: parsed.docx?.tables.length,
                pdfPageCount: parsed.pdf?.pageCount,
                pdfPagesPreview: parsed.pdf?.pages.slice(0, 3).map((p) => ({
                  page: p.page,
                  excerpt: p.text.slice(0, 300),
                })),
                analysisSummary: sheetAnalysis?.summary,
                missingColumns: missingReport?.columnsWithMissing.length,
                outliersCount: outliers.length,
              },
            });

            span.finish("ok", `Uploaded workspace artifact ${artifact.filename}`);
            return extensionJsonResponse(request, {
              ok: true,
              artifactId: artifact.artifactId,
              filename: artifact.filename,
              extension: artifact.extension,
              summary: artifact.summary,
              preview: artifact.parsedPreview,
            });
          }

          if (action === "compare") {
            const req = compareSchema.parse(rawBody);
            const baseArt = getWorkspaceArtifact(req.baseArtifactId, ownerId);
            const compArt = getWorkspaceArtifact(req.compareArtifactId, ownerId);
            if (!baseArt || !compArt) {
              span.finish("blocked", "One or both artifacts not found for comparison");
              return extensionJsonResponse(request, { ok: false, message: "One or both artifacts not found." }, 404);
            }
            if (baseArt.extension === "xlsx" && compArt.extension === "xlsx") {
              const res = await compareXlsxBuffers({
                baseBuffer: baseArt.buffer,
                compareBuffer: compArt.buffer,
                baseFileName: baseArt.filename,
                compareFileName: compArt.filename,
                keyField: req.keyField,
                compareFields: req.compareFields,
              });
              span.finish("ok", `Compared XLSX ${baseArt.filename} vs ${compArt.filename}`);
              return extensionJsonResponse(request, { ok: true, ...res });
            }
            const parsedBase = await parseWorkspaceBuffer(baseArt.filename, baseArt.buffer);
            const parsedComp = await parseWorkspaceBuffer(compArt.filename, compArt.buffer);
            const baseRows = parsedBase.table?.rows ?? [];
            const compRows = parsedComp.table?.rows ?? [];
            const keyField =
              req.keyField ||
              parsedBase.table?.headers.find((h) => /^(?:sku|id|order_?id|code)$/i.test(h)) ||
              parsedBase.table?.headers[0] ||
              "id";
            const compareFields =
              req.compareFields ||
              (parsedBase.table?.headers ?? []).filter((h) => h !== keyField);
            const { compareSpreadsheetFiles } = await import("@/lib/engines/file-workspace-engine");
            const comparison = compareSpreadsheetFiles({
              baseData: baseRows,
              compareData: compRows,
              keyField,
              compareFields,
              baseFileName: baseArt.filename,
              compareFileName: compArt.filename,
            });
            span.finish("ok", `Compared ${baseArt.filename} vs ${compArt.filename}`);
            return extensionJsonResponse(request, { ok: true, comparison });
          }

          if (action === "generate") {
            const req = generateSchema.parse(rawBody);
            if (/[\\/]|\.\./.test(req.filename)) {
              span.finish("blocked", "Path traversal rejected in generate filename");
              return extensionJsonResponse(
                request,
                { ok: false, message: "Invalid filename: path separators are not allowed." },
                400,
              );
            }
            const safeRequestedName = sanitizeContentDispositionFilename(req.filename);
            let outBuffer: Buffer;
            let mimeType = "application/octet-stream";
            let summary = "";
            let verified = true;

            if (req.format === "xlsx") {
              const res = await createXlsxBuffer({
                sheets: [{ name: "Report", rows: req.rows ?? [] }],
              });
              outBuffer = res.buffer;
              mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
              summary = `Created & verified XLSX (${res.verified.totalRows} row(s)).`;
            } else if (req.format === "docx") {
              const res = await createDocxBuffer({
                title: req.title || safeRequestedName,
                sections: (req.sections ?? []).map((s) => ({
                  heading: s.heading,
                  paragraphs: s.paragraphs ?? (s.body ? [s.body] : []),
                  bullets: s.bullets,
                })),
              });
              outBuffer = res.buffer;
              mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
              summary = `Created & verified DOCX (${res.verified.headings.length} heading(s)).`;
            } else if (req.format === "pdf") {
              const res = await createPdfBuffer({
                title: req.title || safeRequestedName,
                sections: (req.sections ?? []).map((s) => ({
                  heading: s.heading,
                  body: s.body || (s.paragraphs ?? []).join("\n") || "",
                })),
              });
              outBuffer = res.buffer;
              mimeType = "application/pdf";
              verified = res.verificationPassed;
              summary = `Created & verified PDF (${res.verified.pageCount} page(s), readable=${verified}).`;
            } else if (req.format === "csv") {
              const rows = req.rows ?? [];
              const keys = rows.length ? Array.from(new Set(rows.flatMap((r) => Object.keys(r)))) : [];
              const csvLines = [
                keys.map((k) => `"${k.replace(/"/g, '""')}"`).join(","),
                ...rows.map((r) =>
                  keys.map((k) => `"${String(r[k] ?? "").replace(/"/g, '""')}"`).join(","),
                ),
              ];
              outBuffer = Buffer.from(csvLines.join("\n"), "utf8");
              mimeType = "text/csv; charset=utf-8";
              summary = `Created CSV (${rows.length} row(s)).`;
            } else {
              outBuffer = Buffer.from(JSON.stringify(req.rows ?? req.sections ?? {}, null, 2), "utf8");
              mimeType = "application/json; charset=utf-8";
              summary = "Created structured JSON artifact.";
            }

            const artifact = storeWorkspaceArtifact({
              ownerId,
              filename: safeRequestedName.endsWith(`.${req.format}`)
                ? safeRequestedName
                : `${safeRequestedName}.${req.format}`,
              mimeType,
              buffer: outBuffer,
              summary,
              verified,
            });
            span.finish("ok", `Generated ${req.format.toUpperCase()} artifact ${artifact.filename}`);
            return extensionJsonResponse(request, {
              ok: true,
              artifactId: artifact.artifactId,
              filename: artifact.filename,
              summary: artifact.summary,
              verified: artifact.verified,
            });
          }

          if (action === "update") {
            const req = updateSchema.parse(rawBody);
            const source = getWorkspaceArtifact(req.artifactId, ownerId);
            if (!source) {
              span.finish("blocked", "Source artifact not found for update");
              return extensionJsonResponse(request, { ok: false, message: "Source artifact not found." }, 404);
            }
            if (source.extension === "xlsx") {
              const res = await updateXlsxBufferNonDestructively({
                sourceBuffer: source.buffer,
                updates: req.xlsxUpdates ?? [],
              });
              const updatedName = source.filename.replace(/\.xlsx$/i, "_updated.xlsx");
              const artifact = storeWorkspaceArtifact({
                ownerId,
                filename: updatedName,
                mimeType: source.mimeType,
                buffer: res.buffer,
                summary: `Updated ${res.modifiedCount} cell(s) non-destructively in "${updatedName}".`,
                verified: true,
              });
              span.finish("ok", `Updated XLSX artifact ${artifact.filename}`);
              return extensionJsonResponse(request, {
                ok: true,
                artifactId: artifact.artifactId,
                filename: artifact.filename,
                modifiedCount: res.modifiedCount,
                auditTrail: res.auditTrail,
              });
            }
            if (source.extension === "docx") {
              const res = await updateDocxBufferNonDestructively({
                sourceBuffer: source.buffer,
                replacements: req.docxReplacements,
                appendParagraphs: req.docxAppendParagraphs,
              });
              const updatedName = source.filename.replace(/\.docx$/i, "_updated.docx");
              const artifact = storeWorkspaceArtifact({
                ownerId,
                filename: updatedName,
                mimeType: source.mimeType,
                buffer: res.buffer,
                summary: `Updated DOCX (${res.replacementsApplied} replacement(s), ${res.appendedCount} appended paragraph(s)).`,
                verified: true,
              });
              span.finish("ok", `Updated DOCX artifact ${artifact.filename}`);
              return extensionJsonResponse(request, {
                ok: true,
                artifactId: artifact.artifactId,
                filename: artifact.filename,
                replacementsApplied: res.replacementsApplied,
                appendedCount: res.appendedCount,
              });
            }
            span.finish("blocked", `Unsupported update extension: ${source.extension}`);
            return extensionJsonResponse(
              request,
              { ok: false, message: `Non-destructive binary update is implemented for XLSX and DOCX.` },
              400,
            );
          }

          span.finish("blocked", `Unsupported workspace action "${action}"`);
          return extensionJsonResponse(request, { ok: false, message: `Unsupported workspace action "${action}".` }, 400);
        } catch (err) {
          span.finish("error", err instanceof Error ? err.message : "Workspace processing error.");
          return extensionJsonResponse(
            request,
            { ok: false, message: err instanceof Error ? err.message : "Workspace processing error." },
            400,
          );
        }
      },

      DELETE: async ({ request }) => {
        let auth = null;
        try {
          auth = await verifyBearer(request.headers.get("authorization"));
        } catch {
          auth = null;
        }
        const ownerId = auth?.userId ?? "guest";
        const url = new URL(request.url);
        const id = url.searchParams.get("artifactId");
        if (!id) {
          return extensionJsonResponse(request, { ok: false, message: "Missing artifactId." }, 400);
        }
        const deleted = deleteWorkspaceArtifact(id, ownerId);
        return extensionJsonResponse(request, { ok: deleted, deleted });
      },
    },
  },
});
