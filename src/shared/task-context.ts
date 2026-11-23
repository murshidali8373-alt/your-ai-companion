/**
 * UNIFIED TASK SESSION CONTEXT & TASK GRAPH CONTRACTS
 * (AI Buddy 2.0 — Phase 1 Core Intelligence)
 *
 * Shared structured runtime context & dependency-aware task DAG contracts
 * designed for safe sequential today and parallel multi-agent execution.
 */

import type { PermissionLevel } from "./permissions";
import type { TaskCheckpoint } from "./task-checkpoint";

export type SpecialistAgentId =
  | "planning"
  | "browser"
  | "visual_understanding"
  | "visual_intelligence"
  | "research"
  | "data_intelligence"
  | "spreadsheet"
  | "document"
  | "file_workspace"
  | "file_management"
  | "ecommerce"
  | "data_extraction"
  | "communication"
  | "verification"
  | "analysis"
  | "form_filling"
  | "form_automation"
  | "navigation"
  | "workflow_automation"
  | "workflow_recovery"
  | "memory"
  | "quality_control"
  | "self_healing";

export const CANONICAL_15_AGENTS = [
  "planning",
  "browser",
  "research",
  "data_intelligence",
  "spreadsheet",
  "document",
  "file_workspace",
  "form_filling",
  "navigation",
  "visual_intelligence",
  "workflow_automation",
  "verification",
  "memory",
  "communication",
  "self_healing",
] as const;

export type CanonicalAgentId = (typeof CANONICAL_15_AGENTS)[number];

export type DataProvenance = "extracted" | "calculated" | "estimated" | "unknown";

export type SubtaskStatus =
  | "pending"
  | "ready"
  | "running"
  | "awaiting_approval"
  | "completed"
  | "failed"
  | "cancelled"
  | "skipped";

export type ExecutionPath = "fast_path" | "multi_agent_path";

export interface TaskErrorInfo {
  code: string;
  message: string;
  attribution?: string;
  recoverable: boolean;
  timestamp: string;
  fingerprint?: string;
}

export interface Subtask {
  taskId: string;
  parentTaskId: string;
  title: string;
  agentId: SpecialistAgentId;
  capabilityId: string;
  dependencies: string[];
  status: SubtaskStatus;
  priority?: number; // 1 (lowest) to 10 (highest), default 5
  retryLimit: number;
  retryCount: number;
  tabOwnership?: number | string | null;
  fileOwnership?: string | null;
  permissions: {
    requiredLevel: PermissionLevel;
    isConsequential: boolean;
    approved: boolean;
  };
  input?: Record<string, unknown>;
  checkpoint?: Partial<TaskCheckpoint> | null;
  output?: unknown;
  error?: TaskErrorInfo | null;
  verification?: {
    verified: boolean;
    strategy: string;
    detail: string;
  } | null;
  durationMs?: number;
  startedAt?: string;
  completedAt?: string;
}

export interface TaskNode {
  taskId: string;
  goal: string;
  executionPath: ExecutionPath;
  status:
    | "created"
    | "understood"
    | "planned"
    | "paused"
    | "awaiting_approval"
    | "executing"
    | "verifying"
    | "completed"
    | "partially_completed"
    | "failed"
    | "cancelled";
  subtasks: Subtask[];
  replannedCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ResourceLockTable {
  tabs: Record<string, string>; // tabId -> owning subtaskId
  files: Record<string, string>; // fileId/name -> owning subtaskId
}

export interface OpenTabContextEntry {
  tabId: number;
  url: string;
  title: string;
  origin?: string;
  role?: string;
  openedByBuddy?: boolean;
}

export interface TargetReferenceMemory {
  selector?: string;
  text?: string;
  role?: string;
  index?: number;
  url?: string;
  tag?: string;
}

export interface SessionUndoEntry {
  id: string;
  scope: "field" | "navigation" | "action";
  selector?: string;
  fieldLabel?: string;
  previousValue?: string;
  previousChecked?: boolean;
  previousUrl?: string;
  tabId?: number | null;
  timestamp: string;
}

export interface SessionDecisionEntry {
  decisionId: string;
  summary: string;
  rationale: string;
  madeBy: SpecialistAgentId;
  timestamp: string;
}

export interface SessionCostTelemetry {
  totalEstimatedTokens: number;
  totalModelCalls: number;
  fastPathCount: number;
  multiAgentCount: number;
  estimatedCostUsd: number;
}

export interface TaskSessionContext {
  sessionId: string;
  userId?: string | null;
  taskIsolationKey?: string;
  currentTask: TaskNode | null;
  previousTasks: Array<{ taskId: string; goal: string; status: string; completedAt: string }>;
  activeWebpage: {
    url: string;
    origin: string;
    title: string;
    capturedAt?: string;
  } | null;
  activeBrowserTab: {
    tabId: number | null;
    windowId?: number | null;
    url?: string;
    title?: string;
  } | null;
  originalTabId?: number | null;
  openTabs?: OpenTabContextEntry[];
  lastTargetRef?: TargetReferenceMemory | null;
  undoStack?: SessionUndoEntry[];
  relevantFiles: Array<{
    fileId: string;
    fileName: string;
    documentType: string;
    rowCount?: number;
    availableFields?: string[];
  }>;
  extractedDataRefs: Array<{
    refId: string;
    label: string;
    sourceUrl?: string;
    itemCount: number;
    previewSummary: string;
    provenance?: DataProvenance;
    capturedAt: string;
  }>;
  intermediateOutputs?: Record<string, unknown>;
  decisions?: SessionDecisionEntry[];
  userCorrections: Array<{
    instruction: string;
    targetScope: string;
    timestamp: string;
  }>;
  agentAssignments: Record<string, SpecialistAgentId[]>; // taskId -> active/assigned agents
  pendingSubtasks: string[];
  completedSubtasks: string[];
  failedSubtasks: string[];
  approvalState: {
    pendingSubtaskId?: string | null;
    prompt?: string | null;
    grantedIds: string[];
    deniedIds: string[];
  };
  executionHistory: Array<{
    timestamp: string;
    agentId: SpecialistAgentId;
    subtaskId?: string;
    action: string;
    outcome: "ok" | "error" | "skipped" | "recovered";
    detail: string;
  }>;
  checkpoints: TaskCheckpoint[];
  verificationResults: Array<{
    subtaskId: string;
    verified: boolean;
    strategy: string;
    detail: string;
    timestamp: string;
  }>;
  resourceLocks: ResourceLockTable;
  costTelemetry?: SessionCostTelemetry;
  pauseRequested?: boolean;
  cancelRequested?: boolean;
}

export function createTaskSessionContext(params?: {
  sessionId?: string;
  userId?: string | null;
  taskIsolationKey?: string;
  activeWebpage?: TaskSessionContext["activeWebpage"];
  activeBrowserTab?: TaskSessionContext["activeBrowserTab"];
}): TaskSessionContext {
  return {
    sessionId:
      params?.sessionId ||
      `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    userId: params?.userId ?? null,
    taskIsolationKey:
      params?.taskIsolationKey ||
      `iso_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    currentTask: null,
    previousTasks: [],
    activeWebpage: params?.activeWebpage ?? null,
    activeBrowserTab: params?.activeBrowserTab ?? null,
    originalTabId: params?.activeBrowserTab?.tabId ?? null,
    openTabs: [],
    lastTargetRef: null,
    undoStack: [],
    relevantFiles: [],
    extractedDataRefs: [],
    intermediateOutputs: {},
    decisions: [],
    userCorrections: [],
    agentAssignments: {},
    pendingSubtasks: [],
    completedSubtasks: [],
    failedSubtasks: [],
    approvalState: {
      pendingSubtaskId: null,
      prompt: null,
      grantedIds: [],
      deniedIds: [],
    },
    executionHistory: [],
    checkpoints: [],
    verificationResults: [],
    resourceLocks: {
      tabs: {},
      files: {},
    },
    costTelemetry: {
      totalEstimatedTokens: 0,
      totalModelCalls: 0,
      fastPathCount: 0,
      multiAgentCount: 0,
      estimatedCostUsd: 0,
    },
    pauseRequested: false,
    cancelRequested: false,
  };
}

export function syncSessionSubtaskBuckets(ctx: TaskSessionContext): TaskSessionContext {
  const subtasks = ctx.currentTask?.subtasks ?? [];
  ctx.pendingSubtasks = subtasks
    .filter(
      (s) =>
        s.status === "pending" ||
        s.status === "ready" ||
        s.status === "running" ||
        s.status === "awaiting_approval",
    )
    .map((s) => s.taskId);
  ctx.completedSubtasks = subtasks.filter((s) => s.status === "completed").map((s) => s.taskId);
  ctx.failedSubtasks = subtasks.filter((s) => s.status === "failed").map((s) => s.taskId);
  if (ctx.currentTask) {
    ctx.agentAssignments[ctx.currentTask.taskId] = Array.from(
      new Set(subtasks.map((s) => s.agentId)),
    );
  }
  return ctx;
}

/**
 * Validates DAG dependencies: rejects unknown dependency IDs, self-dependencies,
 * duplicate subtask IDs, and dependency cycles.
 */
export function validateTaskGraphDependencies(subtasks: Subtask[]): {
  valid: boolean;
  errors: string[];
  topologicalOrder: string[];
} {
  const errors: string[] = [];
  const byId = new Map<string, Subtask>();

  for (const s of subtasks) {
    if (byId.has(s.taskId)) {
      errors.push(`Duplicate subtask ID "${s.taskId}".`);
    } else {
      byId.set(s.taskId, s);
    }
  }

  for (const s of subtasks) {
    for (const dep of s.dependencies) {
      if (dep === s.taskId) {
        errors.push(`Subtask "${s.taskId}" cannot depend on itself.`);
      } else if (!byId.has(dep)) {
        errors.push(`Subtask "${s.taskId}" depends on missing subtask "${dep}".`);
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors, topologicalOrder: [] };
  }

  // Kahn's topological sort for deterministic cycle detection
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const s of subtasks) {
    inDegree.set(s.taskId, s.dependencies.length);
    for (const dep of s.dependencies) {
      const list = dependents.get(dep) ?? [];
      list.push(s.taskId);
      dependents.set(dep, list);
    }
  }

  const queue: string[] = subtasks.filter((s) => s.dependencies.length === 0).map((s) => s.taskId);
  const topologicalOrder: string[] = [];

  while (queue.length > 0) {
    const id = queue.shift()!;
    topologicalOrder.push(id);
    for (const nextId of dependents.get(id) ?? []) {
      const nextDeg = (inDegree.get(nextId) ?? 1) - 1;
      inDegree.set(nextId, nextDeg);
      if (nextDeg === 0) queue.push(nextId);
    }
  }

  if (topologicalOrder.length !== subtasks.length) {
    errors.push("Dependency cycle detected in task graph.");
    return { valid: false, errors, topologicalOrder: [] };
  }

  return { valid: true, errors: [], topologicalOrder };
}

/**
 * Returns subtasks ready to run concurrently without violating tab/file ownership locks.
 */
export function getExecutableParallelSubtasks(ctx: TaskSessionContext): Subtask[] {
  const task = ctx.currentTask;
  if (!task) return [];

  const completedOrSkipped = new Set(
    task.subtasks
      .filter((s) => s.status === "completed" || s.status === "skipped")
      .map((s) => s.taskId),
  );

  const ready: Subtask[] = [];
  const claimedTabs = new Set(Object.keys(ctx.resourceLocks.tabs));
  const claimedFiles = new Set(Object.keys(ctx.resourceLocks.files));

  for (const st of task.subtasks) {
    if (st.status !== "pending" && st.status !== "ready") continue;
    const depsMet = st.dependencies.every((d) => completedOrSkipped.has(d));
    if (!depsMet) continue;

    if (st.permissions.isConsequential && !st.permissions.approved) continue;

    const tabKey =
      st.tabOwnership !== undefined && st.tabOwnership !== null ? String(st.tabOwnership) : null;
    const fileKey = st.fileOwnership || null;

    if (tabKey && claimedTabs.has(tabKey)) continue;
    if (fileKey && claimedFiles.has(fileKey)) continue;

    if (tabKey) claimedTabs.add(tabKey);
    if (fileKey) claimedFiles.add(fileKey);
    ready.push(st);
  }

  return ready;
}

export function acquireSubtaskLocks(ctx: TaskSessionContext, subtask: Subtask): boolean {
  const tabKey =
    subtask.tabOwnership !== undefined && subtask.tabOwnership !== null
      ? String(subtask.tabOwnership)
      : null;
  const fileKey = subtask.fileOwnership || null;

  if (
    tabKey &&
    ctx.resourceLocks.tabs[tabKey] &&
    ctx.resourceLocks.tabs[tabKey] !== subtask.taskId
  ) {
    return false;
  }
  if (
    fileKey &&
    ctx.resourceLocks.files[fileKey] &&
    ctx.resourceLocks.files[fileKey] !== subtask.taskId
  ) {
    return false;
  }

  if (tabKey) ctx.resourceLocks.tabs[tabKey] = subtask.taskId;
  if (fileKey) ctx.resourceLocks.files[fileKey] = subtask.taskId;
  return true;
}

export function releaseSubtaskLocks(ctx: TaskSessionContext, subtaskId: string): void {
  for (const [k, owner] of Object.entries(ctx.resourceLocks.tabs)) {
    if (owner === subtaskId) delete ctx.resourceLocks.tabs[k];
  }
  for (const [k, owner] of Object.entries(ctx.resourceLocks.files)) {
    if (owner === subtaskId) delete ctx.resourceLocks.files[k];
  }
}

export function acquireTabLock(ctx: TaskSessionContext, tabId: number, ownerId: string): boolean {
  const key = String(tabId);
  const existing = ctx.resourceLocks.tabs[key];
  if (existing && existing !== ownerId) return false;
  ctx.resourceLocks.tabs[key] = ownerId;
  return true;
}

export function releaseTabLock(ctx: TaskSessionContext, tabId: number, ownerId?: string): void {
  const key = String(tabId);
  if (!ownerId || ctx.resourceLocks.tabs[key] === ownerId) {
    delete ctx.resourceLocks.tabs[key];
  }
}

export function pushUndoRecord(
  ctx: TaskSessionContext,
  entry: Omit<SessionUndoEntry, "id" | "timestamp"> & { id?: string; timestamp?: string },
): SessionUndoEntry {
  const stack = ctx.undoStack ?? [];
  const full: SessionUndoEntry = {
    id: entry.id || `undo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    timestamp: entry.timestamp || new Date().toISOString(),
    scope: entry.scope,
    selector: entry.selector,
    fieldLabel: entry.fieldLabel,
    previousValue: entry.previousValue,
    previousChecked: entry.previousChecked,
    previousUrl: entry.previousUrl,
    tabId: entry.tabId,
  };
  stack.push(full);
  ctx.undoStack = stack.slice(-30);
  return full;
}

export function popUndoRecord(
  ctx: TaskSessionContext,
  scope?: SessionUndoEntry["scope"],
): SessionUndoEntry | null {
  const stack = ctx.undoStack ?? [];
  if (stack.length === 0) return null;
  if (!scope) {
    const popped = stack.pop() ?? null;
    ctx.undoStack = stack;
    return popped;
  }
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i]?.scope === scope) {
      const [removed] = stack.splice(i, 1);
      ctx.undoStack = stack;
      return removed ?? null;
    }
  }
  return null;
}

const SENSITIVE_TEXT_MASK_RE =
  /(-----BEGIN [A-Z ]*PRIVATE KEY-----|\bsk-[A-Za-z0-9]{16,}|gh[ps]_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{25,}|(?:password|passwd|otp|cvv|pin)\s*[:=]\s*[^\s,;]+|\b\d{4}[\s-]?\d{4}[\s-]?\d{4}(?:[\s-]?\d{4})?\b)/gi;

export function maskSensitiveContextText(text: string): string {
  return text.replace(SENSITIVE_TEXT_MASK_RE, "[REDACTED]");
}

export function recordDecision(
  ctx: TaskSessionContext,
  entry: Omit<SessionDecisionEntry, "decisionId" | "timestamp"> & { decisionId?: string },
): SessionDecisionEntry {
  const full: SessionDecisionEntry = {
    decisionId:
      entry.decisionId ||
      `dec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    summary: maskSensitiveContextText(entry.summary),
    rationale: maskSensitiveContextText(entry.rationale),
    madeBy: entry.madeBy,
    timestamp: new Date().toISOString(),
  };
  ctx.decisions = [...(ctx.decisions ?? []), full].slice(-40);
  return full;
}

export function recordExtractedDataWithProvenance(
  ctx: TaskSessionContext,
  entry: {
    refId?: string;
    label: string;
    sourceUrl?: string;
    itemCount: number;
    previewSummary: string;
    provenance: DataProvenance;
  },
): TaskSessionContext["extractedDataRefs"][number] {
  const item: TaskSessionContext["extractedDataRefs"][number] = {
    refId:
      entry.refId || `ext_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
    label: entry.label,
    sourceUrl: entry.sourceUrl,
    itemCount: entry.itemCount,
    previewSummary: maskSensitiveContextText(entry.previewSummary),
    provenance: entry.provenance,
    capturedAt: new Date().toISOString(),
  };
  ctx.extractedDataRefs = [...ctx.extractedDataRefs, item].slice(-30);
  return item;
}

export function recordCostTelemetry(
  ctx: TaskSessionContext,
  delta: { tokens?: number; modelCalls?: number; path?: ExecutionPath; costUsd?: number },
): SessionCostTelemetry {
  const current = ctx.costTelemetry ?? {
    totalEstimatedTokens: 0,
    totalModelCalls: 0,
    fastPathCount: 0,
    multiAgentCount: 0,
    estimatedCostUsd: 0,
  };
  current.totalEstimatedTokens += delta.tokens ?? 0;
  current.totalModelCalls += delta.modelCalls ?? 0;
  if (delta.path === "fast_path") current.fastPathCount += 1;
  if (delta.path === "multi_agent_path") current.multiAgentCount += 1;
  current.estimatedCostUsd = Number((current.estimatedCostUsd + (delta.costUsd ?? 0)).toFixed(6));
  ctx.costTelemetry = current;
  return current;
}

export function isolateSessionContext(
  ctx: TaskSessionContext,
  targetUserId: string | null,
): TaskSessionContext {
  if ((ctx.userId ?? null) === (targetUserId ?? null)) {
    return ctx;
  }
  return createTaskSessionContext({
    userId: targetUserId,
    activeWebpage: ctx.activeWebpage,
    activeBrowserTab: ctx.activeBrowserTab,
  });
}

export function requestTaskPause(ctx: TaskSessionContext): void {
  ctx.pauseRequested = true;
  if (ctx.currentTask && ctx.currentTask.status === "executing") {
    ctx.currentTask.status = "paused";
    ctx.currentTask.updatedAt = new Date().toISOString();
  }
}

export function requestTaskResume(ctx: TaskSessionContext): void {
  ctx.pauseRequested = false;
  if (ctx.currentTask && ctx.currentTask.status === "paused") {
    ctx.currentTask.status = "executing";
    ctx.currentTask.updatedAt = new Date().toISOString();
  }
}

export function requestTaskCancel(ctx: TaskSessionContext): void {
  ctx.cancelRequested = true;
  if (ctx.currentTask) {
    ctx.currentTask.status = "cancelled";
    for (const st of ctx.currentTask.subtasks) {
      if (st.status === "pending" || st.status === "ready" || st.status === "awaiting_approval") {
        st.status = "cancelled";
      }
    }
    ctx.currentTask.updatedAt = new Date().toISOString();
    syncSessionSubtaskBuckets(ctx);
  }
}
