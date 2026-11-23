/**
 * CENTRALIZED OBSERVABILITY & TELEMETRY LEDGER (Phase 5)
 *
 * - Correlates end-to-end tasks, agent subtasks, model calls, file parsing, connector calls,
 *   security guardrails, and failures via correlationId.
 * - Strictly redacts all sensitive credentials/PII before recording telemetry.
 */

import { redactSensitiveText } from "@/shared/self-healing";

export type TelemetryEventType =
  | "task.start"
  | "task.complete"
  | "agent.execute"
  | "model.call"
  | "browser.action"
  | "file.parse"
  | "connector.call"
  | "approval.gate"
  | "security.flag"
  | "security.block"
  | "workflow.run"
  | "skill.execute"
  | "error.captured";

export type TelemetryOutcome = "ok" | "blocked" | "error" | "skipped" | "pending";

export interface TelemetryEvent {
  eventId: string;
  correlationId: string;
  timestamp: string;
  type: TelemetryEventType;
  outcome: TelemetryOutcome;
  userId?: string | undefined;
  durationMs?: number | undefined;
  detail: string;
  meta?: Record<string, unknown> | undefined;
}

export interface ObservabilityMetricsSummary {
  totalEvents: number;
  errorCount: number;
  blockedCount: number;
  approvalEvents: number;
  avgModelLatencyMs: number;
  avgAgentDurationMs: number;
  byType: Record<string, number>;
}

const OBS_KEY = "__aiBuddyObservabilityLedgerV1";
const MAX_EVENTS = 400;

function getStore(): TelemetryEvent[] {
  const g = globalThis as Record<string, unknown>;
  if (!Array.isArray(g[OBS_KEY])) {
    g[OBS_KEY] = [];
  }
  return g[OBS_KEY] as TelemetryEvent[];
}

export function createCorrelationId(prefix = "cor"): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function sanitizeMeta(meta?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!meta) return undefined;
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (v === undefined) continue;
    if (typeof v === "string") {
      clean[k] = redactSensitiveText(v).text.slice(0, 400);
    } else if (typeof v === "number" || typeof v === "boolean") {
      clean[k] = v;
    } else if (Array.isArray(v)) {
      clean[k] = v
        .slice(0, 15)
        .map((item) =>
          typeof item === "string" ? redactSensitiveText(item).text.slice(0, 120) : item,
        );
    } else if (typeof v === "object" && v !== null) {
      clean[k] = redactSensitiveText(JSON.stringify(v)).text.slice(0, 400);
    }
  }
  return clean;
}

export function recordTelemetry(params: {
  correlationId?: string;
  type: TelemetryEventType;
  outcome: TelemetryOutcome;
  userId?: string;
  durationMs?: number;
  detail: string;
  meta?: Record<string, unknown>;
}): TelemetryEvent {
  const store = getStore();
  const cleanDetail = redactSensitiveText(params.detail).text.slice(0, 500);
  const event: TelemetryEvent = {
    eventId: `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    correlationId: params.correlationId || createCorrelationId(),
    timestamp: new Date().toISOString(),
    type: params.type,
    outcome: params.outcome,
    userId: params.userId,
    durationMs: params.durationMs,
    detail: cleanDetail,
    meta: sanitizeMeta(params.meta),
  };
  store.unshift(event);
  if (store.length > MAX_EVENTS) {
    store.length = MAX_EVENTS;
  }
  return event;
}

export function startTelemetrySpan(params: {
  correlationId?: string;
  type: TelemetryEventType;
  userId?: string;
  detail: string;
}): {
  correlationId: string;
  finish: (
    outcome: TelemetryOutcome,
    extraDetail?: string,
    meta?: Record<string, unknown>,
  ) => TelemetryEvent;
} {
  const correlationId = params.correlationId || createCorrelationId();
  const startedAt = Date.now();
  return {
    correlationId,
    finish(outcome, extraDetail, meta) {
      return recordTelemetry({
        correlationId,
        type: params.type,
        outcome,
        userId: params.userId,
        durationMs: Math.max(0, Date.now() - startedAt),
        detail: extraDetail || params.detail,
        meta,
      });
    },
  };
}

export function getObservabilitySnapshot(options?: {
  correlationId?: string;
  userId?: string;
  limit?: number;
}): {
  events: TelemetryEvent[];
  summary: ObservabilityMetricsSummary;
} {
  let list = getStore();
  if (options?.correlationId) {
    list = list.filter((e) => e.correlationId === options.correlationId);
  }
  if (options?.userId) {
    list = list.filter((e) => !e.userId || e.userId === options.userId);
  }
  const byType: Record<string, number> = {};
  let errorCount = 0;
  let blockedCount = 0;
  let approvalEvents = 0;
  let modelLatSum = 0;
  let modelLatCount = 0;
  let agentDurSum = 0;
  let agentDurCount = 0;

  for (const e of list) {
    byType[e.type] = (byType[e.type] || 0) + 1;
    if (e.outcome === "error" || e.type === "error.captured") errorCount += 1;
    if (e.outcome === "blocked" || e.type === "security.block") blockedCount += 1;
    if (e.type === "approval.gate") approvalEvents += 1;
    if (e.type === "model.call" && typeof e.durationMs === "number") {
      modelLatSum += e.durationMs;
      modelLatCount += 1;
    }
    if (e.type === "agent.execute" && typeof e.durationMs === "number") {
      agentDurSum += e.durationMs;
      agentDurCount += 1;
    }
  }

  return {
    events: list.slice(0, options?.limit ?? 60),
    summary: {
      totalEvents: list.length,
      errorCount,
      blockedCount,
      approvalEvents,
      avgModelLatencyMs: modelLatCount > 0 ? Math.round(modelLatSum / modelLatCount) : 0,
      avgAgentDurationMs: agentDurCount > 0 ? Math.round(agentDurSum / agentDurCount) : 0,
      byType,
    },
  };
}

export function resetObservabilityForTests(): void {
  const g = globalThis as Record<string, unknown>;
  g[OBS_KEY] = [];
}
