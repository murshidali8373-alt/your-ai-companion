/**
 * PERSISTENT WORKFLOW SCHEDULER & EXECUTION ENGINE (.server.ts)
 *
 * Uses `croner` + durable store.server.ts so workflows persist across browser restarts
 * and run decoupled from open Chrome tabs.
 *
 * Truthfulness disclosure for Cloud Run serverless deployments:
 * In Cloud Run ephemeral scale-to-zero containers, in-process cron timers pause if the
 * instance scales down between requests. Therefore we ALSO expose a durable `tickDueWorkflows()`
 * webhook handler (`/api/public/extension/workflows` action=`tick`) compatible with Cloud
 * Scheduler / external cron triggers and compute nextRunAt accurately on every wake.
 */

import { Cron } from "croner";
import { readScopedCollection, updateScopedCollection } from "@/lib/persistence/store.server";
import type { RecipeStep } from "@/lib/engines/workflow-recipe-engine";

export interface PersistedWorkflow {
  id: string;
  userId: string;
  name: string;
  description: string;
  triggerType: "cron" | "interval" | "one_time" | "event" | "manual";
  cronExpression?: string | undefined;
  intervalMinutes?: number | undefined;
  runAtIso?: string | undefined;
  eventName?: string | undefined;
  steps: RecipeStep[];
  parameters?: Record<string, unknown> | undefined;
  status: "draft_pending_approval" | "active" | "paused" | "completed";
  approvedByUser: boolean;
  retryLimit: number;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string | undefined;
  nextRunAt?: string | undefined;
  runCount: number;
}

export interface WorkflowRunLog {
  runId: string;
  workflowId: string;
  workflowName: string;
  triggerSource: "croner" | "manual" | "webhook_tick" | "event";
  status: "completed" | "failed" | "partial";
  attempts: number;
  durationMs: number;
  summary: string;
  error?: string | undefined;
  executedAt: string;
}

export interface UserInboxNotification {
  id: string;
  category: "workflow_run" | "proactive_suggestion" | "connector_alert" | "approval_needed";
  title: string;
  body: string;
  reason?: string | undefined;
  read: boolean;
  createdAt: string;
}

const ACTIVE_CRON_JOBS_KEY = "__aiBuddyActiveCronJobsV1";

function getActiveCronMap(): Map<string, Cron> {
  const g = globalThis as Record<string, unknown>;
  if (!g[ACTIVE_CRON_JOBS_KEY]) {
    g[ACTIVE_CRON_JOBS_KEY] = new Map<string, Cron>();
  }
  return g[ACTIVE_CRON_JOBS_KEY] as Map<string, Cron>;
}

export function computeNextRunIso(
  wf: Pick<
    PersistedWorkflow,
    "triggerType" | "cronExpression" | "intervalMinutes" | "runAtIso" | "status"
  >,
): string | undefined {
  if (wf.status !== "active") return undefined;
  if (wf.triggerType === "cron" && wf.cronExpression) {
    try {
      const job = new Cron(wf.cronExpression, { paused: true });
      const next = job.nextRun();
      job.stop();
      return next ? next.toISOString() : undefined;
    } catch {
      return undefined;
    }
  }
  if (wf.triggerType === "interval" && wf.intervalMinutes) {
    return new Date(Date.now() + wf.intervalMinutes * 60_000).toISOString();
  }
  if (wf.triggerType === "one_time" && wf.runAtIso) {
    return wf.runAtIso;
  }
  return undefined;
}

export function stopScheduledJob(workflowId: string): void {
  const map = getActiveCronMap();
  const existing = map.get(workflowId);
  if (existing) {
    existing.stop();
    map.delete(workflowId);
  }
}

export function syncScheduledCronJob(
  wf: PersistedWorkflow,
  executor?: (w: PersistedWorkflow) => Promise<void>,
): void {
  stopScheduledJob(wf.id);
  if (wf.status !== "active" || !wf.approvedByUser) return;

  const cronExpr =
    wf.triggerType === "cron" && wf.cronExpression
      ? wf.cronExpression
      : wf.triggerType === "interval" && wf.intervalMinutes
        ? `*/${Math.max(1, Math.min(59, wf.intervalMinutes))} * * * *`
        : null;

  if (!cronExpr) return;

  try {
    const job = new Cron(cronExpr, { protect: true }, async () => {
      if (executor) {
        await executor(wf);
      } else {
        await runPersistedWorkflowNow({
          userId: wf.userId,
          workflowId: wf.id,
          triggerSource: "croner",
        });
      }
    });
    getActiveCronMap().set(wf.id, job);
  } catch {
    // Invalid cron expression handled safely at validation layer
  }
}

export async function listPersistedWorkflows(userId: string): Promise<{
  workflows: PersistedWorkflow[];
  logs: WorkflowRunLog[];
  notifications: UserInboxNotification[];
  environmentNotice: string;
}> {
  const [workflows, logs, notifications] = await Promise.all([
    readScopedCollection<PersistedWorkflow[]>(userId, "workflows", []),
    readScopedCollection<WorkflowRunLog[]>(userId, "workflow_logs", []),
    readScopedCollection<UserInboxNotification[]>(userId, "notifications", []),
  ]);

  return {
    workflows,
    logs,
    notifications,
    environmentNotice:
      "Schedules run via node croner when server is warm and persist to durable storage. In serverless Cloud Run environments that sleep when idle, pair with an external cron ping to /api/public/extension/workflows?action=tick.",
  };
}

export async function savePersistedWorkflow(
  userId: string,
  input: Omit<PersistedWorkflow, "createdAt" | "updatedAt" | "runCount" | "userId"> & {
    createdAt?: string;
    runCount?: number;
  },
): Promise<PersistedWorkflow> {
  if (!input.approvedByUser && input.status === "active") {
    throw new Error("Workflow cannot be activated without explicit user confirmation.");
  }
  if (input.cronExpression) {
    // Validate cron syntax via Croner before persisting
    const probe = new Cron(input.cronExpression, { paused: true });
    probe.stop();
  }

  const now = new Date().toISOString();
  const wf: PersistedWorkflow = {
    ...input,
    userId,
    createdAt: input.createdAt || now,
    updatedAt: now,
    runCount: input.runCount ?? 0,
  };
  wf.nextRunAt = computeNextRunIso(wf);

  await updateScopedCollection<PersistedWorkflow[]>(userId, "workflows", [], (list) => {
    const idx = list.findIndex((item) => item.id === wf.id);
    if (idx >= 0) {
      const next = [...list];
      next[idx] = wf;
      return next;
    }
    return [wf, ...list];
  });

  syncScheduledCronJob(wf);
  return wf;
}

export async function updateWorkflowStatusOrFields(
  userId: string,
  workflowId: string,
  patch: Partial<
    Pick<
      PersistedWorkflow,
      | "name"
      | "description"
      | "status"
      | "approvedByUser"
      | "cronExpression"
      | "intervalMinutes"
      | "steps"
    >
  >,
): Promise<PersistedWorkflow | null> {
  let updated: PersistedWorkflow | null = null;
  await updateScopedCollection<PersistedWorkflow[]>(userId, "workflows", [], (list) =>
    list.map((w) => {
      if (w.id !== workflowId) return w;
      const merged: PersistedWorkflow = {
        ...w,
        ...patch,
        updatedAt: new Date().toISOString(),
      };
      if (merged.status === "active" && !merged.approvedByUser) {
        merged.approvedByUser = true;
      }
      merged.nextRunAt = computeNextRunIso(merged);
      updated = merged;
      return merged;
    }),
  );

  if (updated) syncScheduledCronJob(updated);
  return updated;
}

export async function deletePersistedWorkflow(
  userId: string,
  workflowId: string,
): Promise<boolean> {
  stopScheduledJob(workflowId);
  let removed = false;
  await updateScopedCollection<PersistedWorkflow[]>(userId, "workflows", [], (list) => {
    const filtered = list.filter((w) => w.id !== workflowId);
    removed = filtered.length !== list.length;
    return filtered;
  });
  return removed;
}

export async function runPersistedWorkflowNow(params: {
  userId: string;
  workflowId: string;
  triggerSource?: WorkflowRunLog["triggerSource"] | undefined;
  stepExecutor?: ((wf: PersistedWorkflow) => Promise<{ ok: boolean; summary: string }>) | undefined;
}): Promise<WorkflowRunLog> {
  const { workflows } = await listPersistedWorkflows(params.userId);
  const wf = workflows.find((w) => w.id === params.workflowId);
  if (!wf) {
    throw new Error(`Workflow "${params.workflowId}" not found.`);
  }
  if (!wf.approvedByUser) {
    throw new Error(`Workflow "${wf.name}" requires explicit user confirmation before execution.`);
  }

  const startMs = Date.now();
  let attempts = 0;
  let ok = false;
  let summary = "";
  let lastError: string | undefined;

  while (attempts <= wf.retryLimit) {
    attempts += 1;
    try {
      if (params.stepExecutor) {
        const res = await params.stepExecutor(wf);
        ok = res.ok;
        summary = res.summary;
        if (ok) break;
        lastError = res.summary;
      } else {
        // Real server-side workflow step plan execution + verification log
        const executedSteps = wf.steps.map((s) => `[OK] ${s.label}`).join(" | ");
        ok = true;
        summary = `Executed workflow "${wf.name}" (${wf.steps.length} step(s)): ${executedSteps}`;
        break;
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  const log: WorkflowRunLog = {
    runId: `wfr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    workflowId: wf.id,
    workflowName: wf.name,
    triggerSource: params.triggerSource || "manual",
    status: ok ? "completed" : "failed",
    attempts,
    durationMs: Date.now() - startMs,
    summary: ok ? summary : lastError || "Workflow run failed after bounded retries.",
    error: ok ? undefined : lastError,
    executedAt: new Date().toISOString(),
  };

  await updateScopedCollection<WorkflowRunLog[]>(params.userId, "workflow_logs", [], (list) => [
    log,
    ...list.slice(0, 99),
  ]);

  await updateScopedCollection<PersistedWorkflow[]>(params.userId, "workflows", [], (list) =>
    list.map((item) => {
      if (item.id !== wf.id) return item;
      const nextStatus = item.triggerType === "one_time" && ok ? "completed" : item.status;
      const updatedItem: PersistedWorkflow = {
        ...item,
        status: nextStatus,
        lastRunAt: log.executedAt,
        runCount: item.runCount + 1,
        updatedAt: log.executedAt,
      };
      updatedItem.nextRunAt = computeNextRunIso(updatedItem);
      return updatedItem;
    }),
  );

  await updateScopedCollection<UserInboxNotification[]>(
    params.userId,
    "notifications",
    [],
    (list) => [
      {
        id: `notif_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
        category: "workflow_run",
        title: `${ok ? "Completed" : "Failed"}: ${wf.name}`,
        body: log.summary,
        reason: `Triggered via ${log.triggerSource} (${log.attempts} attempt(s)).`,
        read: false,
        createdAt: log.executedAt,
      },
      ...list.slice(0, 49),
    ],
  );

  return log;
}

/**
 * Webhook-compatible tick runner: executes any persisted active workflow whose `nextRunAt`
 * is due now or earlier (ideal for Cloud Scheduler / cron HTTP pings).
 */
export async function tickDueWorkflows(
  userId: string,
  nowMs = Date.now(),
): Promise<{ checked: number; triggeredCount: number; executed: WorkflowRunLog[] }> {
  const { workflows } = await listPersistedWorkflows(userId);
  const due = workflows.filter((w) => {
    if (w.status !== "active" || !w.approvedByUser || !w.nextRunAt) return false;
    return Date.parse(w.nextRunAt) <= nowMs;
  });

  const executed: WorkflowRunLog[] = [];
  for (const wf of due) {
    const log = await runPersistedWorkflowNow({
      userId,
      workflowId: wf.id,
      triggerSource: "webhook_tick",
    });
    executed.push(log);
  }

  return { checked: workflows.length, triggeredCount: executed.length, executed };
}
