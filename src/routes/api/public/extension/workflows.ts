/**
 * Public extension endpoint for Persistent Workflow Automation:
 * - Natural-language workflow parsing & conversational editing
 * - Explicit user approval & enable gate
 * - Pause, resume, manual run, and due-cron execution
 * - Execution history, failure notifications, and honest scheduler infrastructure report
 */

import crypto from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  extensionJsonResponse,
  handleExtensionOptions,
} from "@/lib/extension-cors.server";
import { verifyBearer } from "@/lib/supabase-bearer.server";
import {
  parseNaturalLanguageWorkflow,
} from "@/lib/engines/workflow-recipe-engine";
import {
  applyNaturalEditToWorkflow,
  deleteWorkflow,
  enableApprovedWorkflow,
  executeWorkflowRun,
  getSchedulerInfrastructureReport,
  listFailureNotifications,
  listWorkflows,
  pauseWorkflow,
  resumeWorkflow,
  runDueWorkflows,
  saveWorkflow,
} from "@/lib/engines/workflow-automation.server";
import { checkApiRateLimit, extractCallerKey } from "@/lib/security/guardrails.server";
import { recordTelemetry, startTelemetrySpan } from "@/lib/telemetry/observability.server";

const postSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("parse"),
    prompt: z.string().min(1).max(2000),
    availableFiles: z.array(z.string()).optional(),
    availableConnectors: z.array(z.string()).optional(),
  }),
  z.object({
    action: z.literal("create"),
    prompt: z.string().min(1).max(2000),
    availableFiles: z.array(z.string()).optional(),
    availableConnectors: z.array(z.string()).optional(),
  }),
  z.object({
    action: z.literal("approve"),
    workflowId: z.string().min(1),
  }),
  z.object({
    action: z.literal("edit"),
    workflowId: z.string().min(1),
    instruction: z.string().min(1).max(1000),
  }),
  z.object({
    action: z.literal("pause"),
    workflowId: z.string().min(1),
  }),
  z.object({
    action: z.literal("resume"),
    workflowId: z.string().min(1),
  }),
  z.object({
    action: z.literal("run_now"),
    workflowId: z.string().min(1),
  }),
  z.object({
    action: z.literal("run_due"),
    nowIso: z.string().optional(),
  }),
]);

export const Route = createFileRoute("/api/public/extension/workflows")({
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
          workflows: listWorkflows(userId),
          failureNotifications: listFailureNotifications(userId),
          schedulerInfrastructure: getSchedulerInfrastructureReport(),
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
        const rate = checkApiRateLimit("extension_workflows", callerKey, {
          maxRequests: 60,
          windowMs: 60_000,
        });
        if (!rate.allowed) {
          recordTelemetry({
            type: "security.block",
            outcome: "blocked",
            userId,
            detail: `Rate limit exceeded on /api/public/extension/workflows (${callerKey})`,
          });
          return extensionJsonResponse(
            request,
            {
              ok: false,
              error: "rate_limited",
              message: `Too many workflow requests. Retry after ${rate.retryAfterSeconds}s.`,
              retryAfterSeconds: rate.retryAfterSeconds,
            },
            429,
          );
        }

        let body: z.infer<typeof postSchema>;
        try {
          body = postSchema.parse(await request.json());
        } catch {
          return extensionJsonResponse(
            request,
            { ok: false, message: "Invalid workflow request payload." },
            400,
          );
        }

        const span = startTelemetrySpan({
          type: "workflow.run",
          userId,
          detail: `Workflow action: ${body.action}`,
        });

        if (body.action === "parse") {
          const draft = parseNaturalLanguageWorkflow(body.prompt, {
            availableFiles: body.availableFiles,
            availableConnectors: body.availableConnectors,
          });
          span.finish("ok", "Parsed workflow draft");
          return extensionJsonResponse(request, { ok: true, draft });
        }

        if (body.action === "create") {
          const draft = parseNaturalLanguageWorkflow(body.prompt, {
            availableFiles: body.availableFiles,
            availableConnectors: body.availableConnectors,
          });
          const saved = saveWorkflow(userId, draft.recipe);
          span.finish("ok", `Created workflow ${saved.id}`);
          return extensionJsonResponse(request, {
            ok: true,
            draft,
            workflow: saved,
            requiresApproval: true,
          });
        }

        if (body.action === "approve") {
          const res = enableApprovedWorkflow(userId, body.workflowId);
          span.finish(res.ok ? "ok" : "error", `Approve workflow ${body.workflowId}`);
          return extensionJsonResponse(request, res, res.ok ? 200 : 400);
        }

        if (body.action === "edit") {
          const res = applyNaturalEditToWorkflow(userId, body.workflowId, body.instruction);
          span.finish(res.ok ? "ok" : "error", `Edit workflow ${body.workflowId}`);
          return extensionJsonResponse(request, res, res.ok ? 200 : 404);
        }

        if (body.action === "pause") {
          const res = pauseWorkflow(userId, body.workflowId);
          span.finish(res.ok ? "ok" : "error", `Pause workflow ${body.workflowId}`);
          return extensionJsonResponse(request, res, res.ok ? 200 : 404);
        }

        if (body.action === "resume") {
          const res = resumeWorkflow(userId, body.workflowId);
          span.finish(res.ok ? "ok" : "error", `Resume workflow ${body.workflowId}`);
          return extensionJsonResponse(request, res, res.ok ? 200 : 400);
        }

        if (body.action === "run_now") {
          const res = await executeWorkflowRun(userId, body.workflowId, undefined, "manual");
          span.finish(res.ok ? "ok" : "error", `Run workflow ${body.workflowId}`);
          return extensionJsonResponse(request, res, res.ok ? 200 : 400);
        }

        // run_due (fail-closed unless WORKFLOW_CRON_SECRET / CRON_SECRET is configured and matches x-cron-secret)
        const configuredSecret =
          process.env["WORKFLOW_CRON_SECRET"]?.trim() || process.env["CRON_SECRET"]?.trim();
        if (!configuredSecret) {
          span.finish("blocked", "Scheduled runner disabled: WORKFLOW_CRON_SECRET not configured");
          recordTelemetry({
            type: "security.block",
            outcome: "blocked",
            userId,
            detail: "Blocked unauthenticated run_due workflow tick because WORKFLOW_CRON_SECRET is unset",
          });
          return extensionJsonResponse(
            request,
            {
              ok: false,
              error: "cron_not_configured",
              message:
                "Scheduled workflow execution fails closed until WORKFLOW_CRON_SECRET is configured on the server.",
            },
            503,
          );
        }
        const supplied = request.headers.get("x-cron-secret")?.trim() ?? "";
        const suppliedBuf = crypto.createHash("sha256").update(supplied).digest();
        const expectedBuf = crypto.createHash("sha256").update(configuredSecret).digest();
        if (!supplied || !crypto.timingSafeEqual(suppliedBuf, expectedBuf)) {
          span.finish("blocked", "Unauthorized scheduled runner tick");
          recordTelemetry({
            type: "security.block",
            outcome: "blocked",
            userId,
            detail: "Rejected run_due workflow tick due to missing or invalid x-cron-secret",
          });
          return extensionJsonResponse(
            request,
            {
              ok: false,
              error: "unauthorized",
              message: "Unauthorized scheduled runner tick.",
            },
            401,
          );
        }
        const dueRes = await runDueWorkflows(body.nowIso);
        span.finish("ok", `Executed due workflows (${dueRes.executedCount})`);
        return extensionJsonResponse(request, { ok: true, ...dueRes });
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
        const workflowId = url.searchParams.get("workflowId");
        if (!workflowId) {
          return extensionJsonResponse(request, { ok: false, message: "Missing workflowId." }, 400);
        }
        const deleted = deleteWorkflow(userId, workflowId);
        return extensionJsonResponse(request, { ok: deleted, deleted });
      },
    },
  },
});
