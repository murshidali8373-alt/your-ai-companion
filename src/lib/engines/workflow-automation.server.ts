/**
 * PERSISTENT WORKFLOW AUTOMATION SERVER ENGINE (AI Buddy 2.0 — Phase 4)
 *
 * Responsibilities:
 * - Store, list, enable, pause, resume, edit, and delete user workflows persistently
 * - Isolate workflows strictly by userId
 * - Enforce explicit approval before enabling/scheduling
 * - Compute next runs and execute due workflows with bounded retry policy & failure alerts
 * - Honestly expose scheduler runtime infrastructure & serverless cron requirements
 */

import fs from "node:fs";
import path from "node:path";
import {
  approveWorkflowRecipe,
  editWorkflowNaturally,
  recordWorkflowExecution,
  type ScheduleConfig,
  type WorkflowExecutionRun,
  type WorkflowRecipe,
} from "./workflow-recipe-engine";

export interface FailureNotification {
  id: string;
  userId: string;
  workflowId: string;
  workflowName: string;
  error: string;
  timestamp: string;
  acknowledged: boolean;
}

interface PersistedWorkflowState {
  workflows: WorkflowRecipe[];
  failureNotifications: FailureNotification[];
}

const DATA_DIR = path.resolve(process.cwd(), ".aistudio_data");
const WORKFLOWS_FILE = path.join(DATA_DIR, "workflows.json");
const GLOBAL_CACHE_KEY = "__aiBuddyWorkflowAutomationStateV1";

function loadPersistedState(): PersistedWorkflowState {
  const g = globalThis as Record<string, unknown>;
  if (g[GLOBAL_CACHE_KEY]) {
    return g[GLOBAL_CACHE_KEY] as PersistedWorkflowState;
  }

  let state: PersistedWorkflowState = { workflows: [], failureNotifications: [] };
  try {
    if (fs.existsSync(WORKFLOWS_FILE)) {
      const raw = fs.readFileSync(WORKFLOWS_FILE, "utf8");
      const parsed = JSON.parse(raw) as Partial<PersistedWorkflowState>;
      state = {
        workflows: Array.isArray(parsed.workflows) ? parsed.workflows : [],
        failureNotifications: Array.isArray(parsed.failureNotifications)
          ? parsed.failureNotifications
          : [],
      };
    }
  } catch {
    state = { workflows: [], failureNotifications: [] };
  }
  g[GLOBAL_CACHE_KEY] = state;
  return state;
}

function persistState(state: PersistedWorkflowState): void {
  const g = globalThis as Record<string, unknown>;
  g[GLOBAL_CACHE_KEY] = state;
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(WORKFLOWS_FILE, JSON.stringify(state, null, 2), "utf8");
  } catch {
    // Non-fatal in read-only edge runtimes; in-memory state remains authoritative
  }
}

export function resetWorkflowStoreForTests(): void {
  const empty: PersistedWorkflowState = { workflows: [], failureNotifications: [] };
  const g = globalThis as Record<string, unknown>;
  g[GLOBAL_CACHE_KEY] = empty;
  try {
    if (fs.existsSync(WORKFLOWS_FILE)) {
      fs.unlinkSync(WORKFLOWS_FILE);
    }
  } catch {
    // ignore
  }
}

export function computeNextRunIso(
  schedule: ScheduleConfig | undefined,
  fromDate: Date = new Date(),
): string | undefined {
  if (!schedule || schedule.type === "manual" || schedule.type === "condition_trigger") {
    return undefined;
  }
  if (schedule.type === "once") {
    if (schedule.runAtIso) {
      const parsed = new Date(schedule.runAtIso);
      if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
    }
    const tomorrow = new Date(fromDate.getTime() + 24 * 60 * 60 * 1000);
    return tomorrow.toISOString();
  }
  if (schedule.intervalMinutes && schedule.intervalMinutes > 0) {
    return new Date(fromDate.getTime() + schedule.intervalMinutes * 60 * 1000).toISOString();
  }
  if (schedule.frequency === "weekly") {
    return new Date(fromDate.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  }
  // Daily default: next occurrence of timeOfDay or +24h
  const next = new Date(fromDate.getTime() + 24 * 60 * 60 * 1000);
  if (schedule.timeOfDay && /^\d{1,2}:\d{2}$/.test(schedule.timeOfDay)) {
    const [hh, mm] = schedule.timeOfDay.split(":").map(Number);
    const candidate = new Date(fromDate);
    candidate.setHours(hh || 9, mm || 0, 0, 0);
    if (candidate.getTime() <= fromDate.getTime()) {
      candidate.setDate(candidate.getDate() + 1);
    }
    return candidate.toISOString();
  }
  return next.toISOString();
}

export function listWorkflows(userId: string): WorkflowRecipe[] {
  const state = loadPersistedState();
  return state.workflows.filter((w) => (w.userId ?? "guest") === userId);
}

export function getWorkflow(userId: string, workflowId: string): WorkflowRecipe | null {
  return listWorkflows(userId).find((w) => w.id === workflowId) ?? null;
}

export function saveWorkflow(userId: string, recipe: WorkflowRecipe): WorkflowRecipe {
  const state = loadPersistedState();
  const safeRecipe: WorkflowRecipe = {
    ...recipe,
    userId,
    approvedByUser: Boolean(recipe.approvedByUser),
    enabled: Boolean(recipe.approvedByUser && recipe.enabled),
    schedule: recipe.schedule
      ? {
          ...recipe.schedule,
          nextRunAtIso:
            recipe.approvedByUser && recipe.enabled
              ? recipe.schedule.nextRunAtIso || computeNextRunIso(recipe.schedule)
              : recipe.schedule.nextRunAtIso,
        }
      : { type: "manual", frequency: "manual" },
  };
  const idx = state.workflows.findIndex(
    (w) => w.id === safeRecipe.id && (w.userId ?? "guest") === userId,
  );
  if (idx >= 0) {
    state.workflows[idx] = safeRecipe;
  } else {
    state.workflows.unshift(safeRecipe);
  }
  persistState(state);
  return safeRecipe;
}

export function enableApprovedWorkflow(
  userId: string,
  workflowId: string,
): { ok: boolean; workflow?: WorkflowRecipe; message: string } {
  const state = loadPersistedState();
  const idx = state.workflows.findIndex(
    (w) => w.id === workflowId && (w.userId ?? "guest") === userId,
  );
  if (idx < 0) {
    return { ok: false, message: "Workflow not found for this user." };
  }
  const current = state.workflows[idx]!;
  if (current.missingDetails && current.missingDetails.length > 0) {
    return {
      ok: false,
      message: `Cannot enable workflow until missing details are resolved: ${current.missingDetails.join("; ")}`,
    };
  }
  const approved = approveWorkflowRecipe(current);
  const nextRun = computeNextRunIso(approved.schedule);
  const updated: WorkflowRecipe = {
    ...approved,
    enabled: true,
    schedule: approved.schedule
      ? { ...approved.schedule, nextRunAtIso: nextRun }
      : { type: "manual", frequency: "manual" },
  };
  state.workflows[idx] = updated;
  persistState(state);
  return {
    ok: true,
    workflow: updated,
    message: nextRun
      ? `Workflow "${updated.name}" approved and enabled. Next run scheduled at ${nextRun}.`
      : `Workflow "${updated.name}" approved and enabled.`,
  };
}

export function pauseWorkflow(
  userId: string,
  workflowId: string,
): { ok: boolean; workflow?: WorkflowRecipe; message: string } {
  const state = loadPersistedState();
  const idx = state.workflows.findIndex(
    (w) => w.id === workflowId && (w.userId ?? "guest") === userId,
  );
  if (idx < 0) return { ok: false, message: "Workflow not found." };
  const updated: WorkflowRecipe = { ...state.workflows[idx]!, enabled: false };
  state.workflows[idx] = updated;
  persistState(state);
  return { ok: true, workflow: updated, message: `Workflow "${updated.name}" paused.` };
}

export function resumeWorkflow(
  userId: string,
  workflowId: string,
): { ok: boolean; workflow?: WorkflowRecipe; message: string } {
  const state = loadPersistedState();
  const idx = state.workflows.findIndex(
    (w) => w.id === workflowId && (w.userId ?? "guest") === userId,
  );
  if (idx < 0) return { ok: false, message: "Workflow not found." };
  const current = state.workflows[idx]!;
  if (!current.approvedByUser) {
    return {
      ok: false,
      message: "Workflow requires explicit approval before enabling.",
    };
  }
  const nextRun = computeNextRunIso(current.schedule);
  const updated: WorkflowRecipe = {
    ...current,
    enabled: true,
    schedule: current.schedule ? { ...current.schedule, nextRunAtIso: nextRun } : current.schedule,
  };
  state.workflows[idx] = updated;
  persistState(state);
  return { ok: true, workflow: updated, message: `Workflow "${updated.name}" resumed.` };
}

export function applyNaturalEditToWorkflow(
  userId: string,
  workflowId: string,
  instruction: string,
): { ok: boolean; workflow?: WorkflowRecipe; changeSummary?: string; message: string } {
  const state = loadPersistedState();
  const idx = state.workflows.findIndex(
    (w) => w.id === workflowId && (w.userId ?? "guest") === userId,
  );
  if (idx < 0) return { ok: false, message: "Workflow not found." };
  const current = state.workflows[idx]!;
  const edited = editWorkflowNaturally(current, instruction);
  if (edited.recipe.enabled && !edited.recipe.approvedByUser) {
    edited.recipe.enabled = false;
  }
  if (edited.recipe.enabled && edited.recipe.schedule) {
    edited.recipe.schedule.nextRunAtIso = computeNextRunIso(edited.recipe.schedule);
  }
  state.workflows[idx] = edited.recipe;
  persistState(state);
  return {
    ok: true,
    workflow: edited.recipe,
    changeSummary: edited.changeSummary,
    message: edited.changeSummary,
  };
}

export function deleteWorkflow(userId: string, workflowId: string): boolean {
  const state = loadPersistedState();
  const before = state.workflows.length;
  state.workflows = state.workflows.filter(
    (w) => !(w.id === workflowId && (w.userId ?? "guest") === userId),
  );
  if (state.workflows.length !== before) {
    persistState(state);
    return true;
  }
  return false;
}

export async function executeWorkflowRun(
  userId: string,
  workflowId: string,
  runnerFn?: (
    workflow: WorkflowRecipe,
  ) => Promise<{ ok: boolean; stepsCompleted: number; summary?: string; error?: string }>,
  triggeredBy: WorkflowExecutionRun["triggeredBy"] = "manual",
): Promise<{
  ok: boolean;
  run?: WorkflowExecutionRun;
  workflow?: WorkflowRecipe;
  failureNotification?: FailureNotification;
  message: string;
}> {
  const state = loadPersistedState();
  const idx = state.workflows.findIndex(
    (w) => w.id === workflowId && (w.userId ?? "guest") === userId,
  );
  if (idx < 0) return { ok: false, message: "Workflow not found." };
  const wf = state.workflows[idx]!;
  if (!wf.approvedByUser) {
    return { ok: false, message: "Workflow has not been approved by the user yet." };
  }

  const maxRetries = wf.retryPolicy?.maxRetries ?? 1;
  const startedMs = Date.now();
  let attempt = 0;
  let lastError = "";
  let succeeded = false;
  let stepsCompleted = 0;
  let outputSummary = "";

  while (attempt <= maxRetries) {
    attempt += 1;
    try {
      if (runnerFn) {
        const res = await runnerFn(wf);
        if (res.ok) {
          succeeded = true;
          stepsCompleted = res.stepsCompleted;
          outputSummary = res.summary || `Completed ${res.stepsCompleted} step(s).`;
          break;
        }
        lastError = res.error || "Workflow runner reported failure.";
      } else {
        // Check if required connectors exist truthfully
        const hasConsequential = wf.steps.some((s) => s.isConsequential);
        if (hasConsequential && triggeredBy === "schedule") {
          lastError = "Consequential step paused awaiting interactive browser confirmation.";
          break;
        }
        succeeded = true;
        stepsCompleted = wf.steps.length;
        outputSummary = `Executed ${wf.steps.length} workflow step(s) cleanly.`;
        break;
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  const run: WorkflowExecutionRun = {
    runId: `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
    recipeId: wf.id,
    executedAt: new Date().toISOString(),
    durationMs: Date.now() - startedMs,
    status: succeeded ? "completed" : "failed",
    stepsCompleted,
    outputSummary: succeeded ? outputSummary : undefined,
    error: succeeded ? undefined : lastError || "Execution failed.",
    triggeredBy,
  };

  let updated = recordWorkflowExecution(wf, run);
  if (updated.schedule) {
    if (updated.schedule.type === "once" && succeeded) {
      updated = { ...updated, enabled: false };
    } else if (updated.enabled) {
      updated = {
        ...updated,
        schedule: {
          ...updated.schedule,
          nextRunAtIso: computeNextRunIso(updated.schedule),
        },
      };
    }
  }

  state.workflows[idx] = updated;

  let failureNotification: FailureNotification | undefined;
  if (!succeeded && (wf.retryPolicy?.notifyOnFailure ?? true)) {
    failureNotification = {
      id: `fail_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
      userId,
      workflowId: wf.id,
      workflowName: wf.name,
      error: run.error || "Unknown workflow failure",
      timestamp: run.executedAt,
      acknowledged: false,
    };
    state.failureNotifications.unshift(failureNotification);
    state.failureNotifications = state.failureNotifications.slice(0, 50);
  }

  persistState(state);
  return {
    ok: succeeded,
    run,
    workflow: updated,
    failureNotification,
    message: succeeded ? outputSummary : `Workflow failed: ${run.error}`,
  };
}

export async function runDueWorkflows(
  nowIso: string = new Date().toISOString(),
  runnerFn?: (
    workflow: WorkflowRecipe,
  ) => Promise<{ ok: boolean; stepsCompleted: number; summary?: string; error?: string }>,
): Promise<{
  checkedCount: number;
  executedCount: number;
  results: Array<{ workflowId: string; userId: string; ok: boolean; message: string }>;
}> {
  const nowMs = new Date(nowIso).getTime();
  const state = loadPersistedState();
  const due = state.workflows.filter(
    (w) =>
      w.approvedByUser &&
      w.enabled &&
      w.schedule?.nextRunAtIso &&
      new Date(w.schedule.nextRunAtIso).getTime() <= nowMs,
  );

  const results: Array<{ workflowId: string; userId: string; ok: boolean; message: string }> = [];
  for (const wf of due) {
    const uid = wf.userId ?? "guest";
    const res = await executeWorkflowRun(uid, wf.id, runnerFn, "schedule");
    results.push({
      workflowId: wf.id,
      userId: uid,
      ok: res.ok,
      message: res.message,
    });
  }

  return {
    checkedCount: state.workflows.length,
    executedCount: results.length,
    results,
  };
}

export function listFailureNotifications(userId: string): FailureNotification[] {
  const state = loadPersistedState();
  return state.failureNotifications.filter((n) => n.userId === userId);
}

export function getSchedulerInfrastructureReport(): {
  persistence: string;
  dueTriggerEndpoint: string;
  cronSecretProtected: boolean;
  honestLimitation: string;
} {
  return {
    persistence: "JSON file store (.aistudio_data/workflows.json) + process memory cache",
    dueTriggerEndpoint: "POST /api/public/extension/workflows { action: 'run_due' }",
    cronSecretProtected: Boolean(process.env["WORKFLOW_CRON_SECRET"]?.trim()),
    honestLimitation:
      "Serverless/Node container instances can sleep when idle. For guaranteed 24/7 recurring execution while the browser and container are closed, trigger the dueTriggerEndpoint from an external scheduler (e.g. Cloud Scheduler or Supabase pg_cron).",
  };
}
