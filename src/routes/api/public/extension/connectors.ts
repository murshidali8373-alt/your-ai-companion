/**
 * Public extension endpoint for Connected Apps status, health check, audit logs,
 * server-side session registration/revocation, and approval-gated action execution.
 */

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  extensionJsonResponse,
  handleExtensionOptions,
} from "@/lib/extension-cors.server";
import { verifyBearer } from "@/lib/supabase-bearer.server";
import {
  disconnectConnectorToken,
  executeConnectorAction,
  listConnectorAuditLog,
  listConnectorsForUser,
  registerServerConnectorToken,
} from "@/lib/integrations/connectors.server";
import {
  acquireIdempotencyLock,
  checkApiRateLimit,
  completeIdempotencyLock,
  extractCallerKey,
  releaseIdempotencyLock,
} from "@/lib/security/guardrails.server";
import { recordTelemetry, startTelemetrySpan } from "@/lib/telemetry/observability.server";

const postSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("execute"),
    connectorId: z.string().min(1),
    capabilityId: z.string().min(1),
    input: z.record(z.unknown()).optional(),
    approvalGranted: z.boolean().default(false),
    idempotencyKey: z.string().max(120).optional(),
  }),
  z.object({
    action: z.literal("connect"),
    connectorId: z.string().min(1),
    accessToken: z.string().min(1),
    scopes: z.array(z.string()).optional(),
    expiresInSeconds: z.number().int().positive().optional(),
  }),
]);

export const Route = createFileRoute("/api/public/extension/connectors")({
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
        const userId = auth?.userId ?? "guest";
        return extensionJsonResponse(request, {
          ok: true,
          isGuest: !auth,
          connectors: listConnectorsForUser(userId),
          auditLog: listConnectorAuditLog(userId),
        });
      },

      POST: async ({ request }) => {
        let auth = null;
        try {
          auth = await verifyBearer(request.headers.get("authorization"));
        } catch {
          auth = null;
        }
        const userId = auth?.userId ?? "guest";
        const callerKey = extractCallerKey(request, userId);
        const rate = checkApiRateLimit("extension_connectors", callerKey, {
          maxRequests: 60,
          windowMs: 60_000,
        });
        if (!rate.allowed) {
          recordTelemetry({
            type: "security.block",
            outcome: "blocked",
            userId,
            detail: `Rate limit exceeded on /api/public/extension/connectors (${callerKey})`,
          });
          return extensionJsonResponse(
            request,
            {
              ok: false,
              error: "rate_limited",
              message: `Too many connector requests. Retry after ${rate.retryAfterSeconds}s.`,
              retryAfterSeconds: rate.retryAfterSeconds,
            },
            429,
          );
        }

        let body: z.infer<typeof postSchema>;
        try {
          body = postSchema.parse(await request.json());
        } catch {
          return extensionJsonResponse(request, { ok: false, message: "Invalid connector request." }, 400);
        }

        if (body.action === "connect") {
          const span = startTelemetrySpan({
            type: "connector.call",
            userId,
            detail: `Connect token for ${body.connectorId}`,
          });
          const res = registerServerConnectorToken({
            userId,
            connectorId: body.connectorId,
            accessToken: body.accessToken,
            scopes: body.scopes,
            expiresInSeconds: body.expiresInSeconds,
          });
          span.finish(res.ok ? "ok" : "error", res.message);
          return extensionJsonResponse(request, res, res.ok ? 200 : 400);
        }

        const span = startTelemetrySpan({
          type: "connector.call",
          userId,
          detail: `Execute ${body.connectorId}:${body.capabilityId}`,
        });
        const idemKey = body.idempotencyKey ? `${userId}:${body.idempotencyKey}` : null;
        const idem = acquireIdempotencyLock("extension_connectors", idemKey);
        if (idem.state === "in_flight") {
          span.finish("blocked", "Duplicate connector call in flight");
          return extensionJsonResponse(
            request,
            { ok: false, error: "duplicate_in_flight", message: "Connector action is already running." },
            409,
          );
        }
        if (idem.state === "replay") {
          span.finish("ok", "Idempotent connector replay");
          return extensionJsonResponse(request, {
            ...(idem.cachedResult as Record<string, unknown>),
            idempotentReplay: true,
          });
        }

        try {
          const res = await executeConnectorAction({
            userId,
            connectorId: body.connectorId,
            capabilityId: body.capabilityId,
            input: body.input,
            approvalGranted: body.approvalGranted,
          });
          completeIdempotencyLock(idem.lockKey, res);
          span.finish(res.ok ? "ok" : res.requiresApproval ? "blocked" : "error", res.message);
          return extensionJsonResponse(request, res);
        } catch (err) {
          releaseIdempotencyLock(idem.lockKey);
          span.finish("error", err instanceof Error ? err.message : "Connector execution failed");
          return extensionJsonResponse(
            request,
            { ok: false, message: err instanceof Error ? err.message : "Connector execution failed." },
            500,
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
        const userId = auth?.userId ?? "guest";
        const url = new URL(request.url);
        const connectorId = url.searchParams.get("connectorId");
        if (!connectorId) {
          return extensionJsonResponse(request, { ok: false, message: "Missing connectorId." }, 400);
        }
        const deleted = disconnectConnectorToken(userId, connectorId);
        return extensionJsonResponse(request, { ok: true, disconnected: deleted });
      },
    },
  },
});
