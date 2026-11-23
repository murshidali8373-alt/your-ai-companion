/**
 * Multi-Agent Orchestration & DAG Control API Endpoint
 * Supports listing all 15 agents, executing parallel DAG objectives,
 * polling status/checkpoints, and Pause/Resume/Cancel/Retry/Approve controls.
 */

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  extensionJsonResponse,
  handleExtensionOptions,
} from "@/lib/extension-cors.server";
import { verifyBearer } from "@/lib/supabase-bearer.server";
import {
  buildObjectiveDagPlan,
  listSpecializedAgents,
  selectAgentsForObjective,
} from "@/lib/agents/agent-registry";
import {
  executeAgentDag,
  getDagController,
  skipDagSubtask,
} from "@/lib/agents/dag-executor";
import { createSpecializedSubtaskRunner } from "@/lib/agents/specialized-agents";
import {
  dagControlActionSchema,
  type AgentDagRunState,
} from "@/lib/agents/types";
import {
  readScopedCollection,
  updateScopedCollection,
} from "@/lib/persistence/store.server";

const runObjectiveSchema = z.object({
  objective: z.string().min(2).max(2000),
  fileName: z.string().max(260).optional(),
  comparisonFileName: z.string().max(260).optional(),
  keyField: z.string().max(120).optional(),
  compareFields: z.array(z.string().max(120)).max(20).optional(),
  rows: z.array(z.record(z.unknown())).max(5000).optional(),
  comparisonRows: z.array(z.record(z.unknown())).max(5000).optional(),
  uploadedBufferBase64: z.string().max(16_000_000).optional(),
  outputFormats: z.array(z.enum(["xlsx", "docx", "pdf", "csv", "json"])).optional(),
  researchSources: z
    .array(
      z.object({
        id: z.string(),
        url: z.string(),
        title: z.string(),
        domain: z.string(),
        snippets: z.array(z.string()),
      }),
    )
    .optional(),
  messages: z
    .array(
      z.object({
        sender: z.string(),
        timestamp: z.string().optional(),
        text: z.string(),
      }),
    )
    .optional(),
  snapshot: z.any().optional(),
  maxConcurrency: z.number().int().min(1).max(8).optional(),
  requiresSendApproval: z.boolean().optional(),
  privacyMode: z.boolean().optional(),
});

const patchControlSchema = z.object({
  runId: z.string().min(1),
  action: dagControlActionSchema,
  subtaskId: z.string().optional(),
});

async function resolveScopeUserId(request: Request): Promise<{ userId: string; isGuest: boolean }> {
  try {
    const auth = await verifyBearer(request.headers.get("authorization"));
    if (auth) return { userId: auth.userId, isGuest: false };
  } catch {
    // Guest fallback allowed for local/side-panel extension sessions
  }
  return { userId: "guest", isGuest: true };
}

async function persistRun(userId: string, run: AgentDagRunState): Promise<void> {
  await updateScopedCollection<AgentDagRunState[]>(userId, "dag_runs", [], (runs) => {
    const idx = runs.findIndex((r) => r.runId === run.runId);
    if (idx >= 0) {
      const next = [...runs];
      next[idx] = run;
      return next;
    }
    return [run, ...runs.slice(0, 29)];
  });
}

export const Route = createFileRoute("/api/public/extension/agents")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => handleExtensionOptions(request),
      GET: async ({ request }) => {
        const { userId, isGuest } = await resolveScopeUserId(request);
        const url = new URL(request.url);
        const runId = url.searchParams.get("runId");

        const runs = await readScopedCollection<AgentDagRunState[]>(userId, "dag_runs", []);
        if (runId) {
          const found = runs.find((r) => r.runId === runId);
          if (!found) {
            return extensionJsonResponse(request, { ok: false, error: "DAG run not found" }, 404);
          }
          return extensionJsonResponse(request, { ok: true, run: found, isGuest });
        }

        return extensionJsonResponse(request, {
          ok: true,
          agents: listSpecializedAgents(),
          runs,
          isGuest,
        });
      },

      POST: async ({ request }) => {
        const { userId, isGuest } = await resolveScopeUserId(request);
        let body: z.infer<typeof runObjectiveSchema>;
        try {
          body = runObjectiveSchema.parse(await request.json());
        } catch (err) {
          return extensionJsonResponse(
            request,
            {
              ok: false,
              error: err instanceof Error ? err.message : "Invalid multi-agent payload",
            },
            400,
          );
        }

        const runId = `dag_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
        const selectedAgents = selectAgentsForObjective(body.objective, {
          hasFiles: Boolean(body.fileName || body.uploadedBufferBase64),
          hasSpreadsheet: Boolean(body.rows?.length || /\.(xlsx|csv)$/i.test(body.fileName || "")),
          hasComparisonFiles: Boolean(body.comparisonRows?.length || body.comparisonFileName),
          hasSnapshot: Boolean(body.snapshot),
          hasResearchSources: Boolean(body.researchSources?.length),
          hasCommunications: Boolean(body.messages?.length),
        });

        const subtasks = buildObjectiveDagPlan({
          runId,
          objective: body.objective,
          selectedAgents,
          fileName: body.fileName,
          comparisonFileName: body.comparisonFileName,
          requiresSendApproval: body.requiresSendApproval,
          outputFormats: body.outputFormats?.filter(
            (f): f is "xlsx" | "docx" | "pdf" => f === "xlsx" || f === "docx" || f === "pdf",
          ),
        });

        const runner = createSpecializedSubtaskRunner({
          userId,
          objective: body.objective,
          snapshot: (body.snapshot as never) ?? null,
          rows: body.rows,
          comparisonRows: body.comparisonRows,
          fileName: body.fileName,
          comparisonFileName: body.comparisonFileName,
          uploadedBufferBase64: body.uploadedBufferBase64,
          keyField: body.keyField,
          compareFields: body.compareFields,
          researchSources: body.researchSources,
          messages: body.messages,
          outputFormats: body.outputFormats,
          privacyMode: body.privacyMode,
        });

        const run = await executeAgentDag({
          runId,
          userId,
          objective: body.objective,
          subtasks,
          runner,
          maxConcurrency: body.maxConcurrency ?? 4,
          onCheckpoint: async (state) => {
            await persistRun(userId, state);
          },
        });

        return extensionJsonResponse(request, { ok: true, run, isGuest });
      },

      PATCH: async ({ request }) => {
        const { userId, isGuest } = await resolveScopeUserId(request);
        let body: z.infer<typeof patchControlSchema>;
        try {
          body = patchControlSchema.parse(await request.json());
        } catch {
          return extensionJsonResponse(request, { ok: false, error: "Invalid DAG control payload" }, 400);
        }

        const runs = await readScopedCollection<AgentDagRunState[]>(userId, "dag_runs", []);
        const existing = runs.find((r) => r.runId === body.runId);
        if (!existing) {
          return extensionJsonResponse(request, { ok: false, error: "DAG run not found" }, 404);
        }

        const ctrl = getDagController(body.runId);

        if (body.action === "pause") {
          ctrl?.pause();
          existing.status = "paused";
          existing.updatedAt = new Date().toISOString();
          await persistRun(userId, existing);
          return extensionJsonResponse(request, { ok: true, run: existing, isGuest });
        }

        if (body.action === "cancel") {
          ctrl?.cancel();
          if (existing.subtasks.some((s) => s.status === "running")) {
            existing.unconfirmedStopNote =
              "Cancelled while in-flight step(s) were active; external actions already dispatched cannot be rolled back automatically.";
          }
          existing.status = "cancelled";
          for (const st of existing.subtasks) {
            if (
              st.status === "pending" ||
              st.status === "ready" ||
              st.status === "paused" ||
              st.status === "awaiting_approval"
            ) {
              st.status = "cancelled";
            }
          }
          existing.updatedAt = new Date().toISOString();
          await persistRun(userId, existing);
          return extensionJsonResponse(request, { ok: true, run: existing, isGuest });
        }

        if (body.action === "skip_step") {
          if (!body.subtaskId) {
            return extensionJsonResponse(
              request,
              { ok: false, error: "subtaskId is required for skip_step" },
              400,
            );
          }
          const skipRes = ctrl
            ? ctrl.skipStep(body.subtaskId)
            : skipDagSubtask(existing, body.subtaskId);
          if (!skipRes.ok) {
            return extensionJsonResponse(
              request,
              { ok: false, error: skipRes.reason || "Cannot skip this subtask" },
              409,
            );
          }
          if (ctrl) {
            const target = existing.subtasks.find((s) => s.id === body.subtaskId);
            if (target) {
              target.status = "skipped";
              target.error = "Skipped by user.";
            }
          }
          await persistRun(userId, existing);
          if (skipRes.completedRun || existing.status !== "running") {
            return extensionJsonResponse(request, { ok: true, run: existing, isGuest });
          }
        }

        // Resume, retry_failed, or approve_step — re-run remaining DAG safely
        if (body.action === "approve_step" && body.subtaskId) {
          ctrl?.approveStep(body.subtaskId);
          for (const st of existing.subtasks) {
            if (st.id === body.subtaskId) {
              st.approved = true;
              st.status = "pending";
            }
          }
        } else if (body.action === "retry_failed") {
          for (const st of existing.subtasks) {
            if (st.status === "failed") {
              st.status = "pending";
              st.retryCount = 0;
              st.error = undefined;
            }
          }
        } else if (body.action === "resume") {
          ctrl?.resume();
          for (const st of existing.subtasks) {
            if (st.status === "paused") st.status = "pending";
          }
        }

        const runner = createSpecializedSubtaskRunner({
          userId,
          objective: existing.objective,
        });

        const updatedRun = await executeAgentDag({
          runId: existing.runId,
          userId,
          objective: existing.objective,
          subtasks: existing.subtasks,
          runner,
          existingRunState: existing,
          onCheckpoint: async (state) => {
            await persistRun(userId, state);
          },
        });

        return extensionJsonResponse(request, { ok: true, run: updatedRun, isGuest });
      },
    },
  },
});
