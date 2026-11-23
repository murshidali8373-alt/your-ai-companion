/**
 * The extension's ask endpoint. Public by route prefix, so this handler owns its
 * security: bearer verification, body validation, permission gate (inside `ask`),
 * usage cap, and no error leakage.
 */

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { ask, askGuest } from "@/lib/buddy-service.server";
import {
  extensionJsonResponse,
  handleExtensionOptions,
} from "@/lib/extension-cors.server";
import { verifyBearer } from "@/lib/supabase-bearer.server";
import {
  acquireIdempotencyLock,
  checkApiRateLimit,
  completeIdempotencyLock,
  extractCallerKey,
  releaseIdempotencyLock,
} from "@/lib/security/guardrails.server";
import { recordTelemetry, startTelemetrySpan } from "@/lib/telemetry/observability.server";

const elementSchema = z.object({
  ref: z.string().max(24),
  role: z.string().max(24),
  name: z.string().max(300).default(""),
  tag: z.string().max(80).default(""),
  selector: z.string().max(600).default(""),
  value: z.string().max(300).optional(),
  placeholder: z.string().max(200).optional(),
  required: z.boolean().optional(),
  disabled: z.boolean().optional(),
  invalid: z.boolean().optional(),
  options: z.array(z.string().max(120)).max(40).optional(),
  level: z.number().optional(),
  sensitive: z.boolean().optional(),
});

const bodySchema = z.object({
  question: z.string().min(1).max(2000),
  intent: z
    .enum([
      "explain_page",
      "locate_element",
      "answer",
      "plan",
      "summarize",
      "classify",
      "deep_research",
      "browser_action",
      "interpret_command",
      "file_analysis",
      "general",
    ])
    .default("answer"),
  snapshot: z
    .object({
      url: z.string().max(2000),
      origin: z.string().max(300).default(""),
      title: z.string().max(400).default(""),
      capturedAt: z.string().max(40).default(""),
      headings: z.array(elementSchema).max(80).default([]),
      forms: z.array(elementSchema).max(120).default([]),
      controls: z.array(elementSchema).max(120).default([]),
      alerts: z.array(elementSchema).max(40).default([]),
      text: z.string().max(20000).default(""),
      truncated: z.boolean().default(false),
    })
    .passthrough()
    .nullable()
    .default(null),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(2000),
      }),
    )
    .max(10)
    .optional(),
  preferredModel: z.string().max(100).optional(),
  preferredProvider: z.string().max(40).optional(),
  userApiKey: z.string().max(200).optional(),
  customBaseUrl: z.string().max(300).optional(),
  buddySlug: z.string().max(80).optional(),
  customBuddyId: z.string().max(80).optional(),
  screenshotBase64: z.string().max(6_000_000).optional(),
  uploadedDocumentSummary: z
    .object({
      fileName: z.string().max(200),
      documentType: z.string().max(40),
      availableFields: z.array(z.string().max(60)).max(30),
    })
    .optional(),
  actionContext: z
    .object({
      lastTargetField: z.string().max(120).nullable().optional(),
      lastActionType: z.string().max(40).nullable().optional(),
      pendingSlotType: z.string().max(40).nullable().optional(),
      activeElementLabel: z.string().max(120).nullable().optional(),
      recentFields: z.array(z.string().max(80)).max(15).optional(),
    })
    .optional(),
  sessionContext: z.record(z.unknown()).nullable().optional(),
  activeTabId: z.number().int().nullable().optional(),
  idempotencyKey: z.string().max(120).optional(),
  correlationId: z.string().max(80).optional(),
});

export const Route = createFileRoute("/api/public/extension/ask")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => handleExtensionOptions(request),
      POST: async ({ request }) => {
        const auth = await verifyBearer(request.headers.get("authorization"));
        const callerKey = extractCallerKey(request, auth?.userId ?? null);
        const rate = checkApiRateLimit("extension_ask", callerKey, {
          maxRequests: 60,
          windowMs: 60_000,
        });
        if (!rate.allowed) {
          recordTelemetry({
            type: "security.block",
            outcome: "blocked",
            userId: auth?.userId ?? "guest",
            detail: `Rate limit exceeded on /api/public/extension/ask (${callerKey})`,
          });
          return extensionJsonResponse(
            request,
            {
              error: "rate_limited",
              message: `Too many requests. Please retry after ${rate.retryAfterSeconds}s.`,
              retryAfterSeconds: rate.retryAfterSeconds,
            },
            429,
          );
        }

        let parsed: z.infer<typeof bodySchema>;
        try {
          parsed = bodySchema.parse(await request.json());
        } catch {
          return extensionJsonResponse(
            request,
            { error: "bad_request", message: "That request was malformed." },
            400,
          );
        }

        const span = startTelemetrySpan({
          correlationId: parsed.correlationId,
          type: "task.start",
          userId: auth?.userId ?? "guest",
          detail: `Ask (${parsed.intent}): ${parsed.question.slice(0, 120)}`,
        });

        const idemScopeKey = parsed.idempotencyKey
          ? `${auth?.userId ?? "guest"}:${parsed.idempotencyKey}`
          : null;
        const idem = acquireIdempotencyLock("extension_ask", idemScopeKey);
        if (idem.state === "in_flight") {
          span.finish("blocked", "Duplicate in-flight ask request rejected");
          return extensionJsonResponse(
            request,
            {
              error: "duplicate_in_flight",
              message: "An identical request is already executing.",
              correlationId: span.correlationId,
            },
            409,
          );
        }
        if (idem.state === "replay") {
          span.finish("ok", "Returned idempotent cached ask response");
          const replayPayload =
            idem.cachedResult && typeof idem.cachedResult === "object"
              ? {
                  ...(idem.cachedResult as Record<string, unknown>),
                  idempotentReplay: true,
                  correlationId: span.correlationId,
                }
              : idem.cachedResult;
          return extensionJsonResponse(request, replayPayload);
        }

        try {
          if (auth) {
            const result = await ask(auth.db, auth.userId, {
              question: parsed.question,
              intent: parsed.intent,
              snapshot: parsed.snapshot as never,
              source: "extension",
              history: parsed.history,
              preferredModel: parsed.preferredModel,
              preferredProvider: parsed.preferredProvider,
              userApiKey: parsed.userApiKey,
              customBaseUrl: parsed.customBaseUrl,
              buddySlug: parsed.buddySlug,
              customBuddyId: parsed.customBuddyId,
              screenshotBase64: parsed.screenshotBase64,
              uploadedDocumentSummary: parsed.uploadedDocumentSummary,
              actionContext: parsed.actionContext,
              sessionContext: (parsed.sessionContext ?? null) as never,
              activeTabId: parsed.activeTabId ?? null,
            });
            const payload = { ...result, correlationId: span.correlationId };
            completeIdempotencyLock(idem.lockKey, payload);
            span.finish("ok", `Completed ask for user (${result.activeProvider ?? "unknown"})`);
            return extensionJsonResponse(request, payload);
          } else {
            // Guest mode: unauthenticated users can still inspect pages and ask Buddy
            const result = await askGuest({
              question: parsed.question,
              intent: parsed.intent,
              snapshot: parsed.snapshot as never,
              source: "extension",
              history: parsed.history,
              preferredModel: parsed.preferredModel,
              preferredProvider: parsed.preferredProvider,
              userApiKey: parsed.userApiKey,
              customBaseUrl: parsed.customBaseUrl,
              buddySlug: parsed.buddySlug,
              customBuddyId: parsed.customBuddyId,
              screenshotBase64: parsed.screenshotBase64,
              uploadedDocumentSummary: parsed.uploadedDocumentSummary,
              actionContext: parsed.actionContext,
              sessionContext: (parsed.sessionContext ?? null) as never,
              activeTabId: parsed.activeTabId ?? null,
            });
            const payload = { ...result, guest: true, correlationId: span.correlationId };
            completeIdempotencyLock(idem.lockKey, payload);
            span.finish("ok", `Completed guest ask (${result.activeProvider ?? "unknown"})`);
            return extensionJsonResponse(request, payload);
          }
        } catch (error) {
          releaseIdempotencyLock(idem.lockKey);
          span.finish("error", error instanceof Error ? error.message : "Ask execution error");
          console.error("[extension/ask]", error);
          const message =
            error instanceof Error
              ? error.message
              : typeof error === "string"
                ? error
                : "Buddy encountered an unexpected server error. Try again.";
          return extensionJsonResponse(
            request,
            { error: "server_error", message, correlationId: span.correlationId },
            500,
          );
        }
      },
    },
  },
});
