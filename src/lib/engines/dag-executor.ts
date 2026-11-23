/**
 * DAG EXECUTION ENGINE (AI Buddy 2.0 — Phase 3)
 *
 * Responsibilities:
 * - Build dependency-aware task DAGs with parallel independent branches & dependent merges
 * - Validate graphs via Kahn's topological cycle detection
 * - Execute independent subtasks concurrently with bounded concurrency & priority ordering
 * - Enforce tab/file resource locks
 * - Support pause, resume, cancel, bounded retries, failure isolation, & partial result retention
 * - Support dynamic replanning on recoverable failures without losing completed work
 */

import {
  acquireSubtaskLocks,
  getExecutableParallelSubtasks,
  releaseSubtaskLocks,
  syncSessionSubtaskBuckets,
  validateTaskGraphDependencies,
  type Subtask,
  type TaskNode,
  type TaskSessionContext,
} from "@/shared/task-context";
import {
  createTaskCheckpoint,
  recordStepCheckpoint,
  type TaskCheckpoint,
} from "@/shared/task-checkpoint";
import { executeSpecializedAgent } from "@/lib/agents/agents-registry";
import type { AgentExecutionResult, AgentRuntimeEnv } from "@/lib/agents/types";
import { planDeterministicRecovery, sanitizeDiagnosticReport } from "@/shared/self-healing";
import { startTelemetrySpan } from "@/lib/telemetry/observability.server";

export interface DagExecutionOptions {
  maxConcurrency?: number;
  enableDynamicReplanning?: boolean;
  onCheckpoint?: (checkpoint: TaskCheckpoint) => void;
  onSubtaskComplete?: (subtask: Subtask, result: AgentExecutionResult) => void;
  customExecutor?: (subtask: Subtask, env: AgentRuntimeEnv) => Promise<AgentExecutionResult>;
}

export interface DagExecutionSummary {
  taskNode: TaskNode;
  checkpoint: TaskCheckpoint;
  parallelWaves: number;
  maxObservedConcurrency: number;
  completedIds: string[];
  failedIds: string[];
  awaitingApprovalIds: string[];
  cancelledIds: string[];
  replannedSubtasks: string[];
  agentResults: Record<string, AgentExecutionResult>;
  cycleError?: string;
}

/**
 * Executes a validated TaskNode DAG on the shared TaskSessionContext.
 * Independent ready subtasks run concurrently via bounded Promise batches;
 * dependent subtasks wait until all upstream dependencies succeed.
 */
export async function executeTaskDag(
  sessionCtx: TaskSessionContext,
  taskNode: TaskNode,
  env: AgentRuntimeEnv,
  options: DagExecutionOptions = {},
): Promise<DagExecutionSummary> {
  const maxConcurrency = Math.max(1, Math.min(8, options.maxConcurrency ?? 3));
  const executor = options.customExecutor ?? executeSpecializedAgent;
  const agentResults: Record<string, AgentExecutionResult> = {};
  const replannedSubtasks: string[] = [];

  sessionCtx.currentTask = taskNode;

  // 1. Validate DAG structure (Kahn's cycle check + missing dep check)
  const validation = validateTaskGraphDependencies(taskNode.subtasks);
  let checkpoint = createTaskCheckpoint({
    taskId: taskNode.taskId,
    title: taskNode.goal.slice(0, 80),
    goal: taskNode.goal,
    steps: taskNode.subtasks.map((s) => ({
      id: s.taskId,
      label: s.title,
      actionType: s.capabilityId,
    })),
    pageUrl: env.snapshot?.url,
    pageOrigin: env.snapshot?.origin,
    buddySlug: env.buddySlug ?? undefined,
  });

  if (!validation.valid) {
    taskNode.status = "failed";
    taskNode.updatedAt = new Date().toISOString();
    return {
      taskNode,
      checkpoint,
      parallelWaves: 0,
      maxObservedConcurrency: 0,
      completedIds: [],
      failedIds: taskNode.subtasks.map((s) => s.taskId),
      awaitingApprovalIds: [],
      cancelledIds: [],
      replannedSubtasks,
      agentResults,
      cycleError: validation.errors.join("; "),
    };
  }

  let parallelWaves = 0;
  let maxObservedConcurrency = 0;
  const maxPasses = Math.max(4, taskNode.subtasks.length * 3 + 4);

  for (let pass = 0; pass < maxPasses; pass++) {
    // Check pause or cancel before starting next wave
    if (sessionCtx.cancelRequested || taskNode.status === "cancelled") {
      for (const st of taskNode.subtasks) {
        if (st.status === "pending" || st.status === "ready") {
          st.status = "cancelled";
        }
      }
      taskNode.status = "cancelled";
      break;
    }
    if (sessionCtx.pauseRequested || taskNode.status === "paused") {
      taskNode.status = "paused";
      checkpoint.status = "paused";
      break;
    }

    // Check if any ready subtasks require approval before execution
    for (const st of taskNode.subtasks) {
      if (
        (st.status === "pending" || st.status === "ready") &&
        st.permissions.isConsequential &&
        !st.permissions.approved
      ) {
        const depsDone = st.dependencies.every((d) => {
          const dep = taskNode.subtasks.find((x) => x.taskId === d);
          return dep && (dep.status === "completed" || dep.status === "skipped");
        });
        if (depsDone) {
          st.status = "awaiting_approval";
          sessionCtx.approvalState.pendingSubtaskId = st.taskId;
          sessionCtx.approvalState.prompt = `Approval required for "${st.title}" (${st.capabilityId}).`;
        }
      }
    }

    const readyAll = getExecutableParallelSubtasks(sessionCtx).sort(
      (a, b) => (b.priority ?? 5) - (a.priority ?? 5),
    );

    if (readyAll.length === 0) break;

    // Dispatch up to maxConcurrency tasks in parallel (respecting resource locks)
    const batch: Subtask[] = [];
    for (const candidate of readyAll) {
      if (batch.length >= maxConcurrency) break;
      if (acquireSubtaskLocks(sessionCtx, candidate)) {
        candidate.status = "running";
        candidate.startedAt = new Date().toISOString();
        batch.push(candidate);
      }
    }

    if (batch.length === 0) break;

    parallelWaves += 1;
    maxObservedConcurrency = Math.max(maxObservedConcurrency, batch.length);

    await Promise.all(
      batch.map(async (st) => {
        const startMs = Date.now();
        const span = startTelemetrySpan({
          correlationId: taskNode.taskId,
          type: "agent.execute",
          userId: sessionCtx.userId ?? undefined,
          detail: `${st.agentId}:${st.capabilityId} (${st.title})`,
        });
        let attempt = 0;
        const maxAttempts = Math.max(1, (st.retryLimit ?? 1) + 1);
        let finalRes: AgentExecutionResult | null = null;
        let lastErrMsg = "";

        while (attempt < maxAttempts) {
          if (sessionCtx.cancelRequested) {
            st.status = "cancelled";
            break;
          }
          attempt += 1;
          try {
            const res = await executor(st, env);
            finalRes = res;
            if (res.ok) {
              break;
            }
            lastErrMsg = res.error || res.summary;
            if (res.requiresApproval) {
              st.status = "awaiting_approval";
              sessionCtx.approvalState.pendingSubtaskId = st.taskId;
              sessionCtx.approvalState.prompt = res.approvalPrompt || res.summary;
              break;
            }
            if (!res.recoverable || attempt >= maxAttempts) {
              break;
            }
            st.retryCount += 1;
          } catch (err) {
            lastErrMsg = err instanceof Error ? err.message : String(err);
            st.retryCount += 1;
            if (attempt >= maxAttempts) break;
          }
        }

        st.durationMs = Date.now() - startMs;

        try {
          if (st.status === "cancelled" || st.status === "awaiting_approval") {
            if (finalRes) agentResults[st.taskId] = finalRes;
            return;
          }

          if (finalRes && finalRes.ok) {
            st.status = "completed";
            st.completedAt = new Date().toISOString();
            st.output = finalRes.data ?? { summary: finalRes.summary };
            st.verification = {
              verified: finalRes.verified,
              strategy: `agent:${finalRes.agentId}`,
              detail: finalRes.verificationDetail,
            };
            agentResults[st.taskId] = finalRes;

            sessionCtx.executionHistory.push({
              timestamp: st.completedAt,
              agentId: st.agentId,
              subtaskId: st.taskId,
              action: st.capabilityId,
              outcome: "ok",
              detail: finalRes.summary,
            });
            checkpoint = recordStepCheckpoint(checkpoint, st.taskId, st.output);
            span.finish("ok", finalRes.summary, {
              agentId: st.agentId,
              capabilityId: st.capabilityId,
              verified: finalRes.verified,
            });
            options.onSubtaskComplete?.(st, finalRes);
          } else {
            st.status = "failed";
            const diag = sanitizeDiagnosticReport({
              component: "agent_execution",
              errorMessage: lastErrMsg || "Subtask execution failed",
              taskId: st.taskId,
              agentId: st.agentId,
              capabilityId: st.capabilityId,
            });
            const recovery = planDeterministicRecovery(diag);
            st.error = {
              code: diag.attribution,
              message: diag.errorMessage,
              attribution: diag.attribution,
              recoverable: recovery.canAutoExecute,
              timestamp: diag.timestamp,
              fingerprint: diag.fingerprint,
            };
            if (finalRes) agentResults[st.taskId] = finalRes;
            sessionCtx.executionHistory.push({
              timestamp: diag.timestamp,
              agentId: st.agentId,
              subtaskId: st.taskId,
              action: st.capabilityId,
              outcome: "error",
              detail: diag.errorMessage,
            });
            span.finish("error", diag.errorMessage, {
              agentId: st.agentId,
              capabilityId: st.capabilityId,
              failureCategory: diag.failureCategory,
            });

            // Optional dynamic replanning: append isolated self-healing/fallback subtask once
            if (
              options.enableDynamicReplanning &&
              recovery.canAutoExecute &&
              (taskNode.replannedCount ?? 0) < 2
            ) {
              taskNode.replannedCount = (taskNode.replannedCount ?? 0) + 1;
              const healId = `${st.taskId}_replan_${taskNode.replannedCount}`;
              taskNode.subtasks.push({
                taskId: healId,
                parentTaskId: taskNode.taskId,
                title: `Recover & diagnose "${st.title}"`,
                agentId: "self_healing",
                capabilityId: "undo_reversible_action",
                dependencies: [],
                status: "pending",
                priority: 8,
                retryLimit: 0,
                retryCount: 0,
                permissions: {
                  requiredLevel: "observe",
                  isConsequential: false,
                  approved: true,
                },
              });
              replannedSubtasks.push(healId);
            }
          }
        } finally {
          releaseSubtaskLocks(sessionCtx, st.taskId);
        }
      }),
    );

    options.onCheckpoint?.(checkpoint);
  }

  // Isolate downstream dependents of failed subtasks without clobbering unrelated branches
  const failedSet = new Set(
    taskNode.subtasks.filter((s) => s.status === "failed").map((s) => s.taskId),
  );
  for (const st of taskNode.subtasks) {
    if (st.status === "pending" && st.dependencies.some((d) => failedSet.has(d))) {
      st.status = "skipped";
      st.error = {
        code: "upstream_failed",
        message: "Skipped because an upstream dependency failed.",
        recoverable: false,
        timestamp: new Date().toISOString(),
      };
    }
  }

  syncSessionSubtaskBuckets(sessionCtx);

  const completedIds = taskNode.subtasks
    .filter((s) => s.status === "completed")
    .map((s) => s.taskId);
  const failedIds = taskNode.subtasks.filter((s) => s.status === "failed").map((s) => s.taskId);
  const awaitingApprovalIds = taskNode.subtasks
    .filter((s) => s.status === "awaiting_approval")
    .map((s) => s.taskId);
  const cancelledIds = taskNode.subtasks
    .filter((s) => s.status === "cancelled")
    .map((s) => s.taskId);

  if (taskNode.status !== "cancelled" && taskNode.status !== "paused") {
    if (awaitingApprovalIds.length > 0) {
      taskNode.status = "awaiting_approval";
    } else if (failedIds.length > 0) {
      taskNode.status = completedIds.length > 0 ? "partially_completed" : "failed";
    } else if (completedIds.length === taskNode.subtasks.length) {
      taskNode.status = "completed";
    } else {
      taskNode.status = "planned";
    }
  }

  taskNode.updatedAt = new Date().toISOString();
  sessionCtx.checkpoints = [checkpoint, ...sessionCtx.checkpoints].slice(0, 10);

  return {
    taskNode,
    checkpoint,
    parallelWaves,
    maxObservedConcurrency,
    completedIds,
    failedIds,
    awaitingApprovalIds,
    cancelledIds,
    replannedSubtasks,
    agentResults,
  };
}
