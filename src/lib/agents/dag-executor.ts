/**
 * Parallel Multi-Agent DAG Execution Engine (Phase 3).
 *
 * Features:
 * - Topological validation & strict cycle rejection (Kahn's algorithm)
 * - Parallel execution of dependency-ready subtasks with bounded concurrency
 * - Exclusive tab & file lock enforcement so concurrent agents never collide
 * - Priority ordering across ready subtasks
 * - Pause, resume, cancel, bounded retry, and human-approval gates
 * - Failure isolation preserving partial results from healthy branches
 * - Dynamic replanning hook on failure & checkpoint persistence
 */

import type {
  AgentArtifact,
  AgentDagRunState,
  AgentSubtaskResult,
  AgentSubtaskSpec,
  AgentVerificationCheck,
  DagCheckpointSnapshot,
  Phase3AgentId,
} from "./types";

export interface DagExecutionLocks {
  tabs: Map<string, string>;
  files: Map<string, string>;
}

export interface DagController {
  runId: string;
  pause: () => void;
  resume: () => void;
  cancel: () => void;
  approveStep: (subtaskId: string) => void;
  skipStep: (subtaskId: string) => { ok: boolean; reason?: string; completedRun?: boolean };
  retryFailed: () => boolean;
  getRunState: () => AgentDagRunState;
  isPaused: () => boolean;
  isCancelled: () => boolean;
}

export type SubtaskRunnerFn = (
  subtask: AgentSubtaskSpec,
  runState: AgentDagRunState,
) => Promise<AgentSubtaskResult>;

export type ReplanHookFn = (
  failedSubtask: AgentSubtaskSpec,
  runState: AgentDagRunState,
) => Promise<AgentSubtaskSpec[] | null>;

export type CheckpointHookFn = (runState: AgentDagRunState) => Promise<void> | void;

export function validateAgentDag(subtasks: AgentSubtaskSpec[]): {
  valid: boolean;
  errors: string[];
  topologicalOrder: string[];
} {
  const errors: string[] = [];
  const byId = new Map<string, AgentSubtaskSpec>();

  for (const s of subtasks) {
    if (byId.has(s.id)) {
      errors.push(`Duplicate subtask ID "${s.id}".`);
    } else {
      byId.set(s.id, s);
    }
  }

  for (const s of subtasks) {
    for (const dep of s.dependencies) {
      if (dep === s.id) {
        errors.push(`Subtask "${s.id}" cannot depend on itself.`);
      } else if (!byId.has(dep)) {
        errors.push(`Subtask "${s.id}" depends on unknown subtask "${dep}".`);
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors, topologicalOrder: [] };
  }

  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const s of subtasks) {
    inDegree.set(s.id, s.dependencies.length);
    for (const dep of s.dependencies) {
      const list = dependents.get(dep) ?? [];
      list.push(s.id);
      dependents.set(dep, list);
    }
  }

  const queue = subtasks
    .filter((s) => s.dependencies.length === 0)
    .sort((a, b) => b.priority - a.priority)
    .map((s) => s.id);
  const topologicalOrder: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    topologicalOrder.push(current);
    for (const depId of dependents.get(current) ?? []) {
      const next = (inDegree.get(depId) ?? 1) - 1;
      inDegree.set(depId, next);
      if (next === 0) queue.push(depId);
    }
  }

  if (topologicalOrder.length !== subtasks.length) {
    errors.push("Cycle detected in agent execution DAG.");
    return { valid: false, errors, topologicalOrder: [] };
  }

  return { valid: true, errors: [], topologicalOrder };
}

function captureCheckpoint(runState: AgentDagRunState): DagCheckpointSnapshot {
  const partialOutputs: Record<string, unknown> = {};
  for (const st of runState.subtasks) {
    if (st.output) {
      partialOutputs[st.id] = {
        ok: st.output.ok,
        summary: st.output.summary,
        provenance: st.output.provenance,
      };
    }
  }
  return {
    checkpointId: `chk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    runId: runState.runId,
    capturedAt: new Date().toISOString(),
    completedIds: runState.subtasks.filter((s) => s.status === "completed").map((s) => s.id),
    failedIds: runState.subtasks.filter((s) => s.status === "failed").map((s) => s.id),
    pendingIds: runState.subtasks
      .filter((s) => s.status === "pending" || s.status === "ready" || s.status === "paused")
      .map((s) => s.id),
    awaitingApprovalIds: runState.subtasks
      .filter((s) => s.status === "awaiting_approval")
      .map((s) => s.id),
    partialOutputs,
  };
}

function tryAcquireLocks(locks: DagExecutionLocks, st: AgentSubtaskSpec): boolean {
  const tabKey =
    st.tabOwnership !== undefined && st.tabOwnership !== null ? String(st.tabOwnership) : null;
  const fileKey = st.fileOwnership || null;

  if (tabKey && locks.tabs.has(tabKey) && locks.tabs.get(tabKey) !== st.id) return false;
  if (fileKey && locks.files.has(fileKey) && locks.files.get(fileKey) !== st.id) return false;

  if (tabKey) locks.tabs.set(tabKey, st.id);
  if (fileKey) locks.files.set(fileKey, st.id);
  return true;
}

function releaseLocks(locks: DagExecutionLocks, subtaskId: string): void {
  for (const [k, owner] of locks.tabs.entries()) {
    if (owner === subtaskId) locks.tabs.delete(k);
  }
  for (const [k, owner] of locks.files.entries()) {
    if (owner === subtaskId) locks.files.delete(k);
  }
}

const CONTROLLERS_KEY = "__aiBuddyDagControllersV1";
const ACTIVE_RUNS_KEY = "__aiBuddyDagActiveRunsV1";

function getControllerRegistry(): Map<string, DagController> {
  const g = globalThis as Record<string, unknown>;
  if (!g[CONTROLLERS_KEY]) {
    g[CONTROLLERS_KEY] = new Map<string, DagController>();
  }
  return g[CONTROLLERS_KEY] as Map<string, DagController>;
}

function getActiveRunsRegistry(): Set<string> {
  const g = globalThis as Record<string, unknown>;
  if (!g[ACTIVE_RUNS_KEY]) {
    g[ACTIVE_RUNS_KEY] = new Set<string>();
  }
  return g[ACTIVE_RUNS_KEY] as Set<string>;
}

export function getDagController(runId: string): DagController | undefined {
  return getControllerRegistry().get(runId);
}

export function isDagRunActive(runId: string): boolean {
  return getActiveRunsRegistry().has(runId);
}

export function skipDagSubtask(
  runState: AgentDagRunState,
  subtaskId: string,
): { ok: boolean; reason?: string; completedRun?: boolean } {
  const target = runState.subtasks.find((s) => s.id === subtaskId);
  if (!target) {
    return { ok: false, reason: `Subtask "${subtaskId}" not found.` };
  }
  if (target.status === "completed" || target.status === "skipped") {
    return {
      ok: false,
      reason: `Subtask "${target.title}" is already ${target.status}.`,
    };
  }
  if (target.status === "running") {
    return {
      ok: false,
      reason: `Cannot skip "${target.title}" while it is actively executing.`,
    };
  }

  const blockingDependents = runState.subtasks.filter(
    (s) =>
      s.dependencies.includes(subtaskId) &&
      s.status !== "completed" &&
      s.status !== "skipped" &&
      s.status !== "cancelled",
  );
  if (blockingDependents.length > 0) {
    return {
      ok: false,
      reason: `Cannot skip required step "${target.title}" because downstream step(s) depend on it: ${blockingDependents
        .map((b) => b.title)
        .join(", ")}`,
    };
  }

  target.status = "skipped";
  target.error = "Skipped by user.";
  target.completedAt = new Date().toISOString();
  runState.updatedAt = new Date().toISOString();

  const hasRemaining = runState.subtasks.some(
    (s) =>
      s.status === "pending" ||
      s.status === "ready" ||
      s.status === "running" ||
      s.status === "paused" ||
      s.status === "awaiting_approval",
  );

  if (!hasRemaining) {
    const hasFailed = runState.subtasks.some((s) => s.status === "failed");
    const hasCompleted = runState.subtasks.some((s) => s.status === "completed");
    runState.status = hasFailed ? (hasCompleted ? "partially_completed" : "failed") : "completed";
    if (runState.status === "completed") {
      runState.completedAt = new Date().toISOString();
    }
    return { ok: true, completedRun: true };
  }

  return { ok: true, completedRun: false };
}

export function createDagController(runState: AgentDagRunState): DagController {
  let paused = runState.status === "paused";
  let cancelled = runState.status === "cancelled";

  const controller: DagController = {
    runId: runState.runId,
    pause() {
      paused = true;
      if (runState.status === "running" || runState.status === "planned") {
        runState.status = "paused";
        runState.updatedAt = new Date().toISOString();
      }
    },
    resume() {
      paused = false;
      if (runState.status === "paused") {
        runState.status = "running";
        runState.updatedAt = new Date().toISOString();
      }
    },
    cancel() {
      cancelled = true;
      paused = false;
      const hadRunning = runState.subtasks.some((s) => s.status === "running");
      if (hadRunning) {
        runState.unconfirmedStopNote =
          "Stop requested while in-flight step(s) were active; external actions already dispatched may still finish.";
      }
      runState.status = "cancelled";
      for (const st of runState.subtasks) {
        if (
          st.status === "pending" ||
          st.status === "ready" ||
          st.status === "paused" ||
          st.status === "awaiting_approval"
        ) {
          st.status = "cancelled";
        }
      }
      runState.updatedAt = new Date().toISOString();
    },
    approveStep(subtaskId: string) {
      const target = runState.subtasks.find((s) => s.id === subtaskId);
      if (target) {
        target.approved = true;
        if (target.status === "awaiting_approval") {
          target.status = "pending";
        }
        if (runState.status === "awaiting_approval") {
          runState.status = "running";
        }
        runState.updatedAt = new Date().toISOString();
      }
    },
    skipStep(subtaskId: string) {
      return skipDagSubtask(runState, subtaskId);
    },
    retryFailed() {
      let reset = false;
      for (const st of runState.subtasks) {
        if (st.status === "failed") {
          st.status = "pending";
          st.retryCount = 0;
          st.error = undefined;
          reset = true;
        }
      }
      if (reset) {
        runState.status = "running";
        runState.updatedAt = new Date().toISOString();
      }
      return reset;
    },
    getRunState: () => runState,
    isPaused: () => paused,
    isCancelled: () => cancelled,
  };

  getControllerRegistry().set(runState.runId, controller);
  return controller;
}

export async function executeAgentDag(params: {
  runId: string;
  userId: string;
  objective: string;
  subtasks: AgentSubtaskSpec[];
  runner: SubtaskRunnerFn;
  maxConcurrency?: number | undefined;
  retryDelayMs?: number | undefined;
  allowReplan?: boolean | undefined;
  onReplan?: ReplanHookFn | undefined;
  onCheckpoint?: CheckpointHookFn | undefined;
  existingRunState?: AgentDagRunState | undefined;
}): Promise<AgentDagRunState> {
  const validation = validateAgentDag(params.subtasks);
  if (!validation.valid) {
    throw new Error(`Invalid multi-agent DAG: ${validation.errors.join("; ")}`);
  }

  const maxConcurrency = Math.max(1, Math.min(params.maxConcurrency ?? 4, 8));
  const retryDelayMs = params.retryDelayMs ?? 15;
  const now = new Date().toISOString();

  const runState: AgentDagRunState = params.existingRunState
    ? {
        ...params.existingRunState,
        subtasks: params.subtasks,
        status: "running",
        updatedAt: now,
      }
    : {
        runId: params.runId,
        userId: params.userId,
        objective: params.objective,
        status: "running",
        selectedAgents: Array.from(new Set(params.subtasks.map((s) => s.agentId as Phase3AgentId))),
        subtasks: params.subtasks.map((s) => ({ ...s })),
        checkpoints: [],
        artifacts: [],
        verifications: [],
        replanCount: 0,
        createdAt: now,
        updatedAt: now,
      };

  const controller = createDagController(runState);
  const activeRuns = getActiveRunsRegistry();
  activeRuns.add(runState.runId);
  const locks: DagExecutionLocks = { tabs: new Map(), files: new Map() };
  const maxIterations = runState.subtasks.length * 4 + 8;

  try {
    for (let pass = 0; pass < maxIterations; pass++) {
      if (controller.isCancelled()) {
        runState.status = "cancelled";
        break;
      }

      if (controller.isPaused()) {
        runState.status = "paused";
        runState.checkpoints.unshift(captureCheckpoint(runState));
        runState.checkpoints = runState.checkpoints.slice(0, 12);
        await params.onCheckpoint?.(runState);
        break;
      }

      const doneIds = new Set(
        runState.subtasks
          .filter((s) => s.status === "completed" || s.status === "skipped")
          .map((s) => s.id),
      );
      const failedIds = new Set(
        runState.subtasks
          .filter((s) => s.status === "failed" || s.status === "cancelled")
          .map((s) => s.id),
      );

      // Isolate downstream nodes whose required dependency permanently failed/cancelled
      for (const st of runState.subtasks) {
        if (st.status === "pending" || st.status === "ready") {
          if (st.dependencies.some((d) => failedIds.has(d))) {
            st.status = "skipped";
            st.error = "Skipped because an upstream dependency did not succeed.";
          }
        }
      }

      // Check approval gates before queuing ready batch
      let blockedForApproval = false;
      const readyBatch: AgentSubtaskSpec[] = [];

      const candidates = runState.subtasks
        .filter((s) => s.status === "pending" || s.status === "ready")
        .sort((a, b) => b.priority - a.priority);

      for (const st of candidates) {
        if (!st.dependencies.every((d) => doneIds.has(d))) continue;

        if (st.requiresApproval && !st.approved) {
          st.status = "awaiting_approval";
          blockedForApproval = true;
          continue;
        }

        if (readyBatch.length >= maxConcurrency) break;
        if (!tryAcquireLocks(locks, st)) continue;

        st.status = "running";
        st.startedAt = new Date().toISOString();
        readyBatch.push(st);
      }

      if (readyBatch.length === 0) {
        if (blockedForApproval || runState.subtasks.some((s) => s.status === "awaiting_approval")) {
          runState.status = "awaiting_approval";
          runState.checkpoints.unshift(captureCheckpoint(runState));
          runState.checkpoints = runState.checkpoints.slice(0, 12);
          await params.onCheckpoint?.(runState);
        }
        break;
      }

      // Execute independent subtasks truly concurrently
      await Promise.all(
        readyBatch.map(async (st) => {
          const startMs = Date.now();
          let attempt = 0;
          let lastErr: unknown = null;

          while (attempt <= st.retryLimit) {
            if (controller.isCancelled()) {
              st.status = "cancelled";
              releaseLocks(locks, st.id);
              return;
            }
            try {
              const result = await params.runner(st, runState);
              st.output = result;

              if (controller.isCancelled()) {
                st.status = result.ok ? "completed" : "cancelled";
                st.completedAt = new Date().toISOString();
                st.durationMs = Date.now() - startMs;
                runState.unconfirmedStopNote =
                  "Stop requested while this step was in flight; side-effects already dispatched cannot be automatically rolled back.";
                releaseLocks(locks, st.id);
                return;
              }

              if (result.requiresApproval && !st.approved) {
                st.status = "awaiting_approval";
                st.requiresApproval = true;
                releaseLocks(locks, st.id);
                return;
              }

              if (result.ok) {
                st.status = "completed";
                st.completedAt = new Date().toISOString();
                st.durationMs = Date.now() - startMs;
                if (result.artifacts?.length) {
                  for (const art of result.artifacts) {
                    if (!runState.artifacts.some((a) => a.id === art.id)) {
                      runState.artifacts.push(art);
                    }
                  }
                }
                if (result.verifications?.length) {
                  runState.verifications.push(...result.verifications);
                }
                releaseLocks(locks, st.id);
                return;
              }

              lastErr = new Error(result.summary || "Agent subtask returned unsuccessful result.");
            } catch (err) {
              lastErr = err;
            }

            if (controller.isCancelled()) {
              st.status = "cancelled";
              runState.unconfirmedStopNote =
                "Stop requested while this step was in flight; any external work started before stop cannot be undone automatically.";
              releaseLocks(locks, st.id);
              return;
            }

            attempt += 1;
            st.retryCount = attempt;
            if (attempt <= st.retryLimit && retryDelayMs > 0) {
              await new Promise((r) => setTimeout(r, retryDelayMs * attempt));
            }
          }

          // Exhausted retries — mark failed safely without crashing sibling branches
          st.status = "failed";
          st.completedAt = new Date().toISOString();
          st.durationMs = Date.now() - startMs;
          st.error =
            lastErr instanceof Error ? lastErr.message : String(lastErr || "Subtask failed.");
          releaseLocks(locks, st.id);

          if (params.allowReplan && params.onReplan && runState.replanCount < 2) {
            try {
              const replacementNodes = await params.onReplan(st, runState);
              if (replacementNodes && replacementNodes.length > 0) {
                const candidateGraph = [...runState.subtasks, ...replacementNodes];
                const check = validateAgentDag(candidateGraph);
                if (check.valid) {
                  runState.subtasks.push(...replacementNodes);
                  runState.replanCount += 1;
                }
              }
            } catch {
              // Replanning failure stays contained
            }
          }
        }),
      );

      runState.updatedAt = new Date().toISOString();
      runState.checkpoints.unshift(captureCheckpoint(runState));
      runState.checkpoints = runState.checkpoints.slice(0, 12);
      await params.onCheckpoint?.(runState);

      if (controller.isCancelled()) {
        runState.status = "cancelled";
        break;
      }
      if (controller.isPaused()) {
        runState.status = "paused";
        break;
      }
    }

    // Final status reconciliation
    if (runState.status !== "cancelled" && runState.status !== "paused") {
      const hasAwaiting = runState.subtasks.some((s) => s.status === "awaiting_approval");
      const hasFailed = runState.subtasks.some((s) => s.status === "failed");
      const hasCompleted = runState.subtasks.some((s) => s.status === "completed");
      const hasPending = runState.subtasks.some(
        (s) => s.status === "pending" || s.status === "ready" || s.status === "running",
      );

      if (hasAwaiting) {
        runState.status = "awaiting_approval";
      } else if (hasFailed) {
        runState.status = hasCompleted ? "partially_completed" : "failed";
      } else if (hasPending) {
        runState.status = "partially_completed";
      } else {
        runState.status = "completed";
        runState.completedAt = new Date().toISOString();
      }
    }

    const completedSummaries = runState.subtasks
      .filter((s) => s.status === "completed" && s.output?.summary)
      .map((s) => `• ${s.title}: ${s.output!.summary}`);

    runState.finalSummary =
      completedSummaries.length > 0
        ? completedSummaries.join("\n")
        : `Task status: ${runState.status}`;

    runState.updatedAt = new Date().toISOString();
    await params.onCheckpoint?.(runState);
    return runState;
  } finally {
    activeRuns.delete(runState.runId);
  }
}
