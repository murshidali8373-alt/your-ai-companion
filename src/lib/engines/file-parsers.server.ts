/**
 * REAL FILE WORKSPACE PARSERS, WRITERS & VERIFIERS (AI Buddy 2.0 — Phase 3)
 *
 * Supported & Tested Formats:
 * - CSV / TSV / TXT / JSON (RFC-4180 + UTF-8)
 * - XLSX (exceljs: read/create sheets, formula calculation, compare workbooks,
 *         cell updates preserving styles/formatting, verified workbook export)
 * - DOCX (mammoth + docx + jszip: read headings & tables, create & safely update)
 * - PDF  (unpdf + pdf-lib: extract text with page references, create formatted PDF reports,
 *         and verify generated PDFs by re-opening and checking readable text & page count)
 *
 * Security:
 * - Strict filename sanitization (`path.basename`), extension allowlist, size limit (15 MB)
 * - User/guest isolation on stored workspace artifacts
 * - Non-destructive edits always produce a new verified artifact without overwriting source
 */

import path from "node:path";
import ExcelJS from "exceljs";
import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
} from "docx";
import JSZip from "jszip";
import mammoth from "mammoth";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { extractText } from "unpdf";
import { parseDelimitedText } from "@/shared/document-extractor";
import {
  compareSpreadsheetFiles,
  findCrossSpreadsheetDuplicates,
  type CrossFileComparisonResult,
  type CrossFileDuplicate,
} from "./file-workspace-engine";

export const SUPPORTED_WORKSPACE_EXTENSIONS = [
  "csv",
  "tsv",
  "txt",
  "json",
  "xlsx",
  "docx",
  "pdf",
] as const;

export type SupportedWorkspaceExtension = (typeof SUPPORTED_WORKSPACE_EXTENSIONS)[number];

const MAX_FILE_BYTES = 15 * 1024 * 1024;

export interface ParsedXlsxSheet {
  name: string;
  headers: string[];
  rows: Array<Record<string, unknown>>;
  formulas: Array<{ cell: string; formula: string; evaluatedResult: unknown }>;
  rowCount: number;
  hasStyling: boolean;
}

export interface ParsedXlsxWorkbook {
  format: "xlsx";
  sheetNames: string[];
  sheets: ParsedXlsxSheet[];
  totalRows: number;
}

export interface ParsedDocxDocument {
  format: "docx";
  text: string;
  headings: Array<{ level: number; text: string }>;
  tables: Array<{ headers: string[]; rows: string[][] }>;
  paragraphCount: number;
}

export interface ParsedPdfDocument {
  format: "pdf";
  pageCount: number;
  pages: Array<{ page: number; text: string }>;
  fullText: string;
}

export interface WorkspaceArtifact {
  artifactId: string;
  ownerId: string;
  filename: string;
  extension: SupportedWorkspaceExtension;
  mimeType: string;
  sizeBytes: number;
  buffer: Buffer;
  summary: string;
  parsedPreview?: Record<string, unknown>;
  verified: boolean;
  createdAt: string;
}

const ARTIFACT_STORE_KEY = "__aiBuddyWorkspaceArtifactsV1";

function getArtifactStore(): Map<string, WorkspaceArtifact> {
  const g = globalThis as Record<string, unknown>;
  if (!g[ARTIFACT_STORE_KEY]) {
    g[ARTIFACT_STORE_KEY] = new Map<string, WorkspaceArtifact>();
  }
  return g[ARTIFACT_STORE_KEY] as Map<string, WorkspaceArtifact>;
}

export function sanitizeWorkspaceFilename(rawName: string): string {
  const base = path
    .basename(String(rawName || "workspace_file.txt"))
    .replace(/[^a-zA-Z0-9._-]/g, "_");
  return base || "workspace_file.txt";
}

export function detectSupportedExtension(filename: string): SupportedWorkspaceExtension | null {
  const ext = path.extname(filename).replace(/^\./, "").toLowerCase();
  if ((SUPPORTED_WORKSPACE_EXTENSIONS as readonly string[]).includes(ext)) {
    return ext as SupportedWorkspaceExtension;
  }
  return null;
}

export function storeWorkspaceArtifact(params: {
  ownerId?: string | null;
  filename: string;
  mimeType: string;
  buffer: Buffer;
  summary: string;
  parsedPreview?: Record<string, unknown>;
  verified?: boolean;
}): WorkspaceArtifact {
  if (params.buffer.byteLength > MAX_FILE_BYTES) {
    throw new Error(
      `File exceeds maximum supported workspace size (${MAX_FILE_BYTES / (1024 * 1024)} MB).`,
    );
  }
  const safeName = sanitizeWorkspaceFilename(params.filename);
  const ext = detectSupportedExtension(safeName) ?? "txt";
  const artifact: WorkspaceArtifact = {
    artifactId: `art_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    ownerId: params.ownerId || "guest",
    filename: safeName,
    extension: ext,
    mimeType: params.mimeType,
    sizeBytes: params.buffer.byteLength,
    buffer: params.buffer,
    summary: params.summary,
    parsedPreview: params.parsedPreview,
    verified: params.verified ?? true,
    createdAt: new Date().toISOString(),
  };
  const store = getArtifactStore();
  store.set(artifact.artifactId, artifact);
  // Bound store to 80 recent artifacts to prevent memory leaks
  if (store.size > 80) {
    const oldestKey = store.keys().next().value;
    if (oldestKey) store.delete(oldestKey);
  }
  return artifact;
}

export function getWorkspaceArtifact(
  artifactId: string,
  ownerId?: string | null,
): WorkspaceArtifact | null {
  const art = getArtifactStore().get(artifactId);
  if (!art) return null;
  if (ownerId && art.ownerId !== ownerId) return null;
  if (!ownerId && art.ownerId !== "guest") return null;
  return art;
}

export function listWorkspaceArtifacts(
  ownerId?: string | null,
): Array<Omit<WorkspaceArtifact, "buffer">> {
  const targetOwner = ownerId || "guest";
  return Array.from(getArtifactStore().values())
    .filter((a) => a.ownerId === targetOwner)
    .map(({ buffer: _buf, ...meta }) => meta)
    .reverse();
}

export function deleteWorkspaceArtifact(artifactId: string, ownerId?: string | null): boolean {
  const existing = getWorkspaceArtifact(artifactId, ownerId);
  if (!existing) return false;
  return getArtifactStore().delete(artifactId);
}

// ============================================================================
// EXCEL FORMULA HELPER (Deterministic SUM / AVERAGE / COUNT / MIN / MAX)
// ============================================================================

function colLettersToNumber(letters: string): number {
  let num = 0;
  for (let i = 0; i < letters.length; i++) {
    num = num * 26 + (letters.charCodeAt(i) - 64);
  }
  return num;
}

function parseCellCoord(coord: string): { col: number; row: number } | null {
  const m = coord
    .trim()
    .toUpperCase()
    .match(/^([A-Z]+)(\d+)$/);
  if (!m) return null;
  return { col: colLettersToNumber(m[1]!), row: Number(m[2]) };
}

export function evaluateSimpleFormula(
  formula: string,
  worksheet: ExcelJS.Worksheet,
): number | string | null {
  const raw = formula.trim().replace(/^=/, "");
  const fnMatch = raw.match(/^(SUM|AVERAGE|AVG|COUNT|MIN|MAX)\(([^)]+)\)$/i);
  if (fnMatch) {
    const fn = fnMatch[1]!.toUpperCase();
    const rangeArg = fnMatch[2]!.trim();
    const values: number[] = [];

    for (const part of rangeArg.split(",")) {
      const trimmed = part.trim();
      if (trimmed.includes(":")) {
        const [startStr, endStr] = trimmed.split(":");
        const s = parseCellCoord(startStr || "");
        const e = parseCellCoord(endStr || "");
        if (s && e) {
          for (let r = Math.min(s.row, e.row); r <= Math.max(s.row, e.row); r++) {
            for (let c = Math.min(s.col, e.col); c <= Math.max(s.col, e.col); c++) {
              const cellVal = worksheet.getRow(r).getCell(c).value;
              const resolved =
                typeof cellVal === "object" && cellVal !== null && "result" in cellVal
                  ? (cellVal as { result?: unknown }).result
                  : cellVal;
              if (typeof resolved === "number" && !Number.isNaN(resolved)) {
                values.push(resolved);
              }
            }
          }
        }
      } else {
        const pt = parseCellCoord(trimmed);
        if (pt) {
          const cellVal = worksheet.getRow(pt.row).getCell(pt.col).value;
          const resolved =
            typeof cellVal === "object" && cellVal !== null && "result" in cellVal
              ? (cellVal as { result?: unknown }).result
              : cellVal;
          if (typeof resolved === "number" && !Number.isNaN(resolved)) {
            values.push(resolved);
          }
        }
      }
    }

    if (fn === "COUNT") return values.length;
    if (values.length === 0) return 0;
    if (fn === "SUM") return Number(values.reduce((a, b) => a + b, 0).toFixed(4));
    if (fn === "AVERAGE" || fn === "AVG") {
      return Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(4));
    }
    if (fn === "MIN") return Math.min(...values);
    if (fn === "MAX") return Math.max(...values);
  }

  // Binary cell arithmetic like B2*C2 or B2+C2 or B2-C2
  const arithMatch = raw.match(/^([A-Z]+\d+)\s*([+\-*/])\s*([A-Z]+\d+|\d+(?:\.\d+)?)$/i);
  if (arithMatch) {
    const leftCoord = parseCellCoord(arithMatch[1]!);
    if (!leftCoord) return null;
    const leftRaw = worksheet.getRow(leftCoord.row).getCell(leftCoord.col).value;
    const leftNum = Number(
      typeof leftRaw === "object" && leftRaw !== null && "result" in leftRaw
        ? (leftRaw as { result?: unknown }).result
        : leftRaw,
    );
    const rightToken = arithMatch[3]!;
    let rightNum = Number(rightToken);
    if (Number.isNaN(rightNum)) {
      const rightCoord = parseCellCoord(rightToken);
      if (rightCoord) {
        const rightRaw = worksheet.getRow(rightCoord.row).getCell(rightCoord.col).value;
        rightNum = Number(
          typeof rightRaw === "object" && rightRaw !== null && "result" in rightRaw
            ? (rightRaw as { result?: unknown }).result
            : rightRaw,
        );
      }
    }
    if (!Number.isNaN(leftNum) && !Number.isNaN(rightNum)) {
      const op = arithMatch[2]!;
      if (op === "+") return Number((leftNum + rightNum).toFixed(4));
      if (op === "-") return Number((leftNum - rightNum).toFixed(4));
      if (op === "*") return Number((leftNum * rightNum).toFixed(4));
      if (op === "/") return rightNum === 0 ? null : Number((leftNum / rightNum).toFixed(4));
    }
  }
  return null;
}

function unwrapExcelCell(
  cell: ExcelJS.Cell,
  worksheet: ExcelJS.Worksheet,
): {
  value: unknown;
  formula?: string;
} {
  const raw = cell.value;
  if (raw === null || raw === undefined) return { value: "" };
  if (typeof raw === "object" && "formula" in raw) {
    const fObj = raw as { formula?: string; result?: unknown };
    const evaluated =
      fObj.result !== undefined
        ? fObj.result
        : fObj.formula
          ? evaluateSimpleFormula(fObj.formula, worksheet)
          : null;
    return { value: evaluated ?? "", formula: fObj.formula };
  }
  if (
    typeof raw === "object" &&
    "richText" in raw &&
    Array.isArray((raw as { richText?: Array<{ text: string }> }).richText)
  ) {
    return {
      value: (raw as { richText: Array<{ text: string }> }).richText.map((r) => r.text).join(""),
    };
  }
  if (raw instanceof Date) return { value: raw.toISOString() };
  return { value: raw };
}

// ============================================================================
// 1. XLSX PARSER / WRITER / UPDATER / COMPARATOR
// ============================================================================

export async function readXlsxBuffer(buffer: Buffer): Promise<ParsedXlsxWorkbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

  const sheets: ParsedXlsxSheet[] = [];
  let totalRows = 0;

  workbook.eachSheet((ws) => {
    const headers: string[] = [];
    const headerRow = ws.getRow(1);
    headerRow.eachCell({ includeEmpty: false }, (cell, colNum) => {
      headers[colNum - 1] = String(unwrapExcelCell(cell, ws).value || `Column_${colNum}`).trim();
    });

    const rows: Array<Record<string, unknown>> = [];
    const formulas: ParsedXlsxSheet["formulas"] = [];
    let hasStyling = false;

    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) {
        row.eachCell((cell) => {
          if (cell.font?.bold || cell.fill?.type) hasStyling = true;
        });
        return;
      }
      const record: Record<string, unknown> = {};
      let hasAnyValue = false;
      headers.forEach((h, idx) => {
        if (!h) return;
        const cell = row.getCell(idx + 1);
        if (cell.font?.bold || cell.fill?.type || cell.numFmt) hasStyling = true;
        const unwrapped = unwrapExcelCell(cell, ws);
        if (unwrapped.formula) {
          formulas.push({
            cell: cell.address,
            formula: unwrapped.formula,
            evaluatedResult: unwrapped.value,
          });
        }
        if (unwrapped.value !== "" && unwrapped.value !== null && unwrapped.value !== undefined) {
          hasAnyValue = true;
        }
        record[h] = unwrapped.value;
      });
      if (hasAnyValue) {
        rows.push(record);
      }
    });

    totalRows += rows.length;
    sheets.push({
      name: ws.name,
      headers: headers.filter(Boolean),
      rows,
      formulas,
      rowCount: rows.length,
      hasStyling,
    });
  });

  return {
    format: "xlsx",
    sheetNames: sheets.map((s) => s.name),
    sheets,
    totalRows,
  };
}

export async function createXlsxBuffer(params: {
  sheets: Array<{
    name: string;
    headers?: string[];
    rows: Array<Record<string, unknown>>;
    formulas?: Array<{ cell: string; formula: string }>;
  }>;
}): Promise<{ buffer: Buffer; verified: ParsedXlsxWorkbook }> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "AI Buddy Workspace";
  workbook.created = new Date();

  for (const sheetSpec of params.sheets) {
    const ws = workbook.addWorksheet(sheetSpec.name.slice(0, 31) || "Sheet1");
    const headers =
      sheetSpec.headers && sheetSpec.headers.length > 0
        ? sheetSpec.headers
        : Array.from(new Set(sheetSpec.rows.flatMap((r) => Object.keys(r))));

    const headerRow = ws.addRow(headers);
    headerRow.font = { bold: true };
    headerRow.eachCell((cell) => {
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFE2E8F0" },
      };
    });

    for (const row of sheetSpec.rows) {
      ws.addRow(headers.map((h) => row[h] ?? ""));
    }

    if (sheetSpec.formulas) {
      for (const f of sheetSpec.formulas) {
        const target = ws.getCell(f.cell);
        const evaluated = evaluateSimpleFormula(f.formula, ws);
        target.value = {
          formula: f.formula.replace(/^=/, ""),
          result: evaluated ?? undefined,
        };
      }
    }

    ws.columns.forEach((col) => {
      col.width = 18;
    });
  }

  const out = Buffer.from(await workbook.xlsx.writeBuffer());
  const verified = await readXlsxBuffer(out);
  return { buffer: out, verified };
}

export async function updateXlsxBufferNonDestructively(params: {
  sourceBuffer: Buffer;
  sheetName?: string;
  updates: Array<{
    matchKey?: string;
    matchValue?: unknown;
    targetColumn?: string;
    cellAddress?: string;
    newValue?: unknown;
    formula?: string;
  }>;
}): Promise<{
  buffer: Buffer;
  modifiedCount: number;
  auditTrail: Array<{ location: string; previousValue: unknown; newValue: unknown }>;
  verified: ParsedXlsxWorkbook;
}> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(params.sourceBuffer as unknown as ArrayBuffer);

  const ws = params.sheetName ? workbook.getWorksheet(params.sheetName) : workbook.worksheets[0];
  if (!ws) {
    throw new Error(`Worksheet "${params.sheetName || "first sheet"}" not found in workbook.`);
  }

  const headers: string[] = [];
  ws.getRow(1).eachCell({ includeEmpty: false }, (cell, colNum) => {
    headers[colNum - 1] = String(unwrapExcelCell(cell, ws).value || "").trim();
  });

  const auditTrail: Array<{ location: string; previousValue: unknown; newValue: unknown }> = [];

  for (const upd of params.updates) {
    if (upd.cellAddress) {
      const cell = ws.getCell(upd.cellAddress);
      const prev = unwrapExcelCell(cell, ws).value;
      if (upd.formula) {
        const res = evaluateSimpleFormula(upd.formula, ws);
        cell.value = { formula: upd.formula.replace(/^=/, ""), result: res ?? undefined };
      } else {
        cell.value = upd.newValue as ExcelJS.CellValue;
      }
      auditTrail.push({
        location: `${ws.name}!${upd.cellAddress}`,
        previousValue: prev,
        newValue: upd.newValue,
      });
      continue;
    }

    if (upd.matchKey && upd.targetColumn) {
      const matchColIdx =
        headers.findIndex((h) => h.toLowerCase() === upd.matchKey!.toLowerCase()) + 1;
      const targetColIdx =
        headers.findIndex((h) => h.toLowerCase() === upd.targetColumn!.toLowerCase()) + 1;
      if (matchColIdx <= 0 || targetColIdx <= 0) continue;

      ws.eachRow((row, rowNum) => {
        if (rowNum === 1) return;
        const keyVal = unwrapExcelCell(row.getCell(matchColIdx), ws).value;
        if (
          String(keyVal).trim().toLowerCase() ===
          String(upd.matchValue ?? "")
            .trim()
            .toLowerCase()
        ) {
          const targetCell = row.getCell(targetColIdx);
          const prev = unwrapExcelCell(targetCell, ws).value;
          targetCell.value = upd.newValue as ExcelJS.CellValue;
          auditTrail.push({
            location: `${ws.name}!${targetCell.address}`,
            previousValue: prev,
            newValue: upd.newValue,
          });
        }
      });
    }
  }

  // Re-evaluate existing formula cells on the modified sheet cleanly
  ws.eachRow((row, rowNum) => {
    if (rowNum === 1) return;
    row.eachCell((cell) => {
      const raw = cell.value;
      if (typeof raw === "object" && raw !== null && "formula" in raw) {
        const f = (raw as { formula?: string }).formula;
        if (f) {
          const evaluated = evaluateSimpleFormula(f, ws);
          if (evaluated !== null) {
            cell.value = { formula: f, result: evaluated };
          }
        }
      }
    });
  });

  const out = Buffer.from(await workbook.xlsx.writeBuffer());
  const verified = await readXlsxBuffer(out);
  return {
    buffer: out,
    modifiedCount: auditTrail.length,
    auditTrail,
    verified,
  };
}

export async function compareXlsxBuffers(params: {
  baseBuffer: Buffer;
  compareBuffer: Buffer;
  baseFileName: string;
  compareFileName: string;
  keyField?: string;
  compareFields?: string[];
}): Promise<{
  comparison: CrossFileComparisonResult;
  crossDuplicates: CrossFileDuplicate[];
  baseSheetNames: string[];
  compareSheetNames: string[];
}> {
  const baseWb = await readXlsxBuffer(params.baseBuffer);
  const compWb = await readXlsxBuffer(params.compareBuffer);
  const baseRows = baseWb.sheets[0]?.rows ?? [];
  const compRows = compWb.sheets[0]?.rows ?? [];

  const detectedKey =
    params.keyField ||
    baseWb.sheets[0]?.headers.find((h) => /^(?:sku|id|order_?id|code)$/i.test(h)) ||
    baseWb.sheets[0]?.headers[0] ||
    "id";

  const compareFields =
    params.compareFields && params.compareFields.length > 0
      ? params.compareFields
      : (baseWb.sheets[0]?.headers ?? []).filter((h) => h !== detectedKey);

  const comparison = compareSpreadsheetFiles({
    baseData: baseRows,
    compareData: compRows,
    keyField: detectedKey,
    compareFields,
    baseFileName: params.baseFileName,
    compareFileName: params.compareFileName,
  });

  const crossDuplicates = findCrossSpreadsheetDuplicates(
    [
      { filename: params.baseFileName, rows: baseRows },
      { filename: params.compareFileName, rows: compRows },
    ],
    detectedKey,
  );

  return {
    comparison,
    crossDuplicates,
    baseSheetNames: baseWb.sheetNames,
    compareSheetNames: compWb.sheetNames,
  };
}

// ============================================================================
// 2. DOCX PARSER / CREATOR / NON-DESTRUCTIVE UPDATER
// ============================================================================

function stripHtmlTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export async function readDocxBuffer(buffer: Buffer): Promise<ParsedDocxDocument> {
  const [rawRes, htmlRes] = await Promise.all([
    mammoth.extractRawText({ buffer }),
    mammoth.convertToHtml({ buffer }),
  ]);

  const html = htmlRes.value || "";
  const headings: ParsedDocxDocument["headings"] = [];
  for (const m of html.matchAll(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi)) {
    const level = Number(m[1]);
    const text = stripHtmlTags(m[2] || "");
    if (text) headings.push({ level, text });
  }

  const tables: ParsedDocxDocument["tables"] = [];
  for (const tMatch of html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi)) {
    const rowsRaw: string[][] = [];
    for (const rMatch of (tMatch[1] || "").matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells: string[] = [];
      for (const cMatch of (rMatch[1] || "").matchAll(
        /<(?:th|td)[^>]*>([\s\S]*?)<\/(?:th|td)>/gi,
      )) {
        cells.push(stripHtmlTags(cMatch[1] || ""));
      }
      if (cells.length > 0) rowsRaw.push(cells);
    }
    if (rowsRaw.length > 0) {
      tables.push({
        headers: rowsRaw[0]!,
        rows: rowsRaw.slice(1),
      });
    }
  }

  const text = (rawRes.value || "").trim();
  const paragraphCount = text ? text.split(/\n+/).filter((l) => l.trim()).length : 0;

  return {
    format: "docx",
    text,
    headings,
    tables,
    paragraphCount,
  };
}

export async function createDocxBuffer(params: {
  title: string;
  sections: Array<{
    heading?: string;
    paragraphs?: string[];
    bullets?: string[];
    table?: { headers: string[]; rows: string[][] };
  }>;
}): Promise<{ buffer: Buffer; verified: ParsedDocxDocument }> {
  const children: Array<Paragraph | Table> = [
    new Paragraph({
      text: params.title,
      heading: HeadingLevel.HEADING_1,
    }),
  ];

  for (const sec of params.sections) {
    if (sec.heading) {
      children.push(
        new Paragraph({
          text: sec.heading,
          heading: HeadingLevel.HEADING_2,
        }),
      );
    }
    for (const p of sec.paragraphs ?? []) {
      children.push(new Paragraph({ children: [new TextRun(p)] }));
    }
    for (const b of sec.bullets ?? []) {
      children.push(new Paragraph({ text: b, bullet: { level: 0 } }));
    }
    if (sec.table && sec.table.headers.length > 0) {
      const headerRow = new TableRow({
        children: sec.table.headers.map(
          (h) =>
            new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: h, bold: true })] })],
            }),
        ),
      });
      const bodyRows = sec.table.rows.map(
        (r) =>
          new TableRow({
            children: sec.table!.headers.map(
              (_, colIdx) =>
                new TableCell({
                  children: [new Paragraph(String(r[colIdx] ?? ""))],
                }),
            ),
          }),
      );
      children.push(new Table({ rows: [headerRow, ...bodyRows] }));
    }
  }

  const doc = new Document({
    sections: [{ children }],
  });
  const buffer = Buffer.from(await Packer.toBuffer(doc));
  const verified = await readDocxBuffer(buffer);
  return { buffer, verified };
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function updateDocxBufferNonDestructively(params: {
  sourceBuffer: Buffer;
  replacements?: Array<{ find: string; replace: string }>;
  appendParagraphs?: string[];
}): Promise<{
  buffer: Buffer;
  replacementsApplied: number;
  appendedCount: number;
  verified: ParsedDocxDocument;
}> {
  const zip = await JSZip.loadAsync(params.sourceBuffer);
  const docXmlFile = zip.file("word/document.xml");
  if (!docXmlFile) {
    throw new Error("Invalid DOCX archive: missing word/document.xml");
  }
  let xml = await docXmlFile.async("string");
  let replacementsApplied = 0;

  for (const rep of params.replacements ?? []) {
    if (!rep.find) continue;
    const escapedFind = escapeXml(rep.find);
    const escapedReplace = escapeXml(rep.replace);
    if (xml.includes(escapedFind)) {
      xml = xml.split(escapedFind).join(escapedReplace);
      replacementsApplied += 1;
    }
  }

  let appendedCount = 0;
  if (params.appendParagraphs && params.appendParagraphs.length > 0 && xml.includes("</w:body>")) {
    const extraNodes = params.appendParagraphs
      .map((text) => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`)
      .join("");
    xml = xml.replace("</w:body>", `${extraNodes}</w:body>`);
    appendedCount = params.appendParagraphs.length;
  }

  zip.file("word/document.xml", xml);
  const out = Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));
  const verified = await readDocxBuffer(out);
  return { buffer: out, replacementsApplied, appendedCount, verified };
}

// ============================================================================
// 3. PDF PARSER (WITH PAGE REFS) / CREATOR / VERIFIER
// ============================================================================

export async function readPdfBuffer(buffer: Buffer): Promise<ParsedPdfDocument> {
  const result = await extractText(new Uint8Array(buffer), { mergePages: false });
  const rawPages = Array.isArray(result.text) ? result.text : [String(result.text ?? "")];
  const pages = rawPages.map((text, idx) => ({
    page: idx + 1,
    text: String(text || "").trim(),
  }));

  return {
    format: "pdf",
    pageCount: result.totalPages || pages.length,
    pages,
    fullText: pages.map((p) => `[Page ${p.page}]\n${p.text}`).join("\n\n"),
  };
}

function wrapTextLines(text: string, maxCharsPerLine: number): string[] {
  const out: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    if (!rawLine.trim()) {
      out.push("");
      continue;
    }
    const words = rawLine.split(/\s+/);
    let current = "";
    for (const w of words) {
      if ((current + " " + w).trim().length > maxCharsPerLine) {
        if (current) out.push(current);
        current = w;
      } else {
        current = (current ? current + " " : "") + w;
      }
    }
    if (current) out.push(current);
  }
  return out;
}

export async function createPdfBuffer(params: {
  title: string;
  subtitle?: string;
  sections: Array<{ heading?: string; body: string }>;
}): Promise<{
  buffer: Buffer;
  verified: ParsedPdfDocument;
  verificationPassed: boolean;
}> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(params.title);
  pdfDoc.setCreator("AI Buddy Workspace");

  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const margin = 48;
  const lineHeight = 15;

  let page = pdfDoc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  const ensureSpace = (needed: number) => {
    if (y - needed < margin + 24) {
      page = pdfDoc.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
    }
  };

  // Title
  page.drawText(params.title.slice(0, 90), {
    x: margin,
    y,
    size: 18,
    font: fontBold,
    color: rgb(0.08, 0.12, 0.24),
  });
  y -= 24;

  if (params.subtitle) {
    page.drawText(params.subtitle.slice(0, 110), {
      x: margin,
      y,
      size: 10,
      font: fontRegular,
      color: rgb(0.35, 0.42, 0.55),
    });
    y -= 20;
  }

  for (const sec of params.sections) {
    if (sec.heading) {
      ensureSpace(26);
      y -= 6;
      page.drawText(sec.heading.slice(0, 95), {
        x: margin,
        y,
        size: 13,
        font: fontBold,
        color: rgb(0.12, 0.18, 0.35),
      });
      y -= 18;
    }

    const lines = wrapTextLines(sec.body, 82);
    for (const line of lines) {
      ensureSpace(lineHeight);
      if (line) {
        // Strip unsupported non-WinAnsi chars cleanly so pdf-lib StandardFont never throws
        const safeLine = line.replace(/[^\x20-\x7E]/g, " ");
        page.drawText(safeLine, {
          x: margin,
          y,
          size: 10.5,
          font: fontRegular,
          color: rgb(0.15, 0.19, 0.25),
        });
      }
      y -= lineHeight;
    }
    y -= 8;
  }

  // Add page numbers footer
  const totalPages = pdfDoc.getPageCount();
  pdfDoc.getPages().forEach((p, idx) => {
    p.drawText(`Page ${idx + 1} of ${totalPages}`, {
      x: pageWidth - margin - 65,
      y: 22,
      size: 9,
      font: fontRegular,
      color: rgb(0.45, 0.5, 0.58),
    });
  });

  const buffer = Buffer.from(await pdfDoc.save());

  // Mandatory self-verification: re-open generated PDF and extract text
  const verified = await readPdfBuffer(buffer);
  const verificationPassed =
    verified.pageCount === totalPages &&
    verified.fullText.toLowerCase().includes(params.title.slice(0, 12).toLowerCase());

  return { buffer, verified, verificationPassed };
}

// ============================================================================
// 4. UNIFIED FILE PARSER DISPATCHER (CSV / TSV / TXT / JSON / XLSX / DOCX / PDF)
// ============================================================================

export async function parseWorkspaceBuffer(
  filename: string,
  buffer: Buffer,
): Promise<{
  extension: SupportedWorkspaceExtension;
  summary: string;
  table?: { headers: string[]; rows: Array<Record<string, unknown>>; rowCount: number };
  workbook?: ParsedXlsxWorkbook;
  docx?: ParsedDocxDocument;
  pdf?: ParsedPdfDocument;
  textContent?: string;
  jsonData?: unknown;
}> {
  const ext = detectSupportedExtension(filename);
  if (!ext) {
    throw new Error(
      `Unsupported file format "${path.extname(filename)}". Supported: ${SUPPORTED_WORKSPACE_EXTENSIONS.join(", ")}.`,
    );
  }

  if (ext === "csv" || ext === "tsv") {
    const text = buffer.toString("utf8");
    const parsed = parseDelimitedText(text, ext === "tsv" ? "\t" : ",");
    if (!parsed) {
      throw new Error(`Could not parse delimited ${ext.toUpperCase()} file "${filename}".`);
    }
    return {
      extension: ext,
      summary: `Parsed ${ext.toUpperCase()} file "${filename}": ${parsed.rowCount} row(s), ${parsed.headers.length} column(s).`,
      table: parsed,
      textContent: text,
    };
  }

  if (ext === "txt") {
    const text = buffer.toString("utf8");
    return {
      extension: "txt",
      summary: `Parsed TXT file "${filename}" (${text.length} chars).`,
      textContent: text,
    };
  }

  if (ext === "json") {
    const text = buffer.toString("utf8");
    const jsonData = JSON.parse(text) as unknown;
    const rows = Array.isArray(jsonData)
      ? jsonData.filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null)
      : undefined;
    const headers =
      rows && rows.length > 0 ? Array.from(new Set(rows.flatMap((r) => Object.keys(r)))) : [];
    return {
      extension: "json",
      summary: rows
        ? `Parsed JSON array "${filename}": ${rows.length} record(s).`
        : `Parsed JSON object "${filename}".`,
      jsonData,
      table: rows ? { headers, rows, rowCount: rows.length } : undefined,
      textContent: text,
    };
  }

  if (ext === "xlsx") {
    const workbook = await readXlsxBuffer(buffer);
    const first = workbook.sheets[0];
    return {
      extension: "xlsx",
      summary: `Parsed XLSX "${filename}": ${workbook.sheetNames.length} sheet(s), ${workbook.totalRows} total row(s).`,
      workbook,
      table: first
        ? { headers: first.headers, rows: first.rows, rowCount: first.rowCount }
        : undefined,
    };
  }

  if (ext === "docx") {
    const docx = await readDocxBuffer(buffer);
    return {
      extension: "docx",
      summary: `Parsed DOCX "${filename}": ${docx.headings.length} heading(s), ${docx.tables.length} table(s), ${docx.paragraphCount} paragraph(s).`,
      docx,
      textContent: docx.text,
    };
  }

  // ext === "pdf"
  const pdf = await readPdfBuffer(buffer);
  return {
    extension: "pdf",
    summary: `Parsed PDF "${filename}": ${pdf.pageCount} page(s), ${pdf.fullText.length} chars extracted with page refs.`,
    pdf,
    textContent: pdf.fullText,
  };
}
