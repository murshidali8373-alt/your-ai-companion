/**
 * TASK PERSISTENCE & EXECUTION CHECKPOINT SYSTEM
 *
 * Responsibilities:
 * - Persistent checkpoint creation and serialization
 * - Current step and pending action tracking
 * - Safe recovery across browser reloads, side panel closes, and service-worker restarts
 * - Duplicate action prevention via deterministic action hashing
 * - Safe rollback to last verified checkpoint on recoverable failure
 * - User attention notification tracking
 */

export type CheckpointStatus =
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled"
  | "awaiting_approval"
  | "waiting_for_user_assistance";

export interface TaskCheckpointStep {
  id: string;
  order: number;
  label: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  actionHash?: string | undefined;
  result?: unknown | undefined;
  error?: string | undefined;
  completedAt?: string | undefined;
}

export interface TaskCheckpoint {
  taskId: string;
  title: string;
  goal: string;
  status: CheckpointStatus;
  currentStepIndex: number;
  totalSteps: number;
  steps: TaskCheckpointStep[];
  completedStepIds: string[];
  executedActionHashes: string[];
  pageUrl?: string | undefined;
  pageOrigin?: string | undefined;
  buddySlug?: string | undefined;
  requiresUserApproval: boolean;
  approvalPrompt?: string | undefined;
  pendingConsequentialAction?:
    | {
        type: string;
        selector?: string | undefined;
        description?: string | undefined;
      }
    | undefined;
  needsUserAttention: boolean;
  attentionReason?: string | undefined;
  stateData: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  checkpointNumber: number;
}

/**
 * Computes a deterministic hash for an action to prevent duplicate execution during task resumption.
 */
export function computeActionHash(
  actionType: string,
  targetSelector = "",
  value = "",
  stepIndex = 0,
): string {
  const normType = actionType.trim().toLowerCase();
  const normSelector = targetSelector.trim();
  const normValue = value.trim();
  return `act_${normType}_${stepIndex}_${normSelector}_${normValue}`.replace(
    /[^a-zA-Z0-9_-]/g,
    "_",
  );
}

/**
 * Creates an initial checkpoint for a new task.
 */
export function createTaskCheckpoint(params: {
  taskId?: string;
  title: string;
  goal: string;
  steps: Array<{ id: string; label: string; actionType?: string; targetSelector?: string }>;
  pageUrl?: string;
  pageOrigin?: string;
  buddySlug?: string;
  initialStateData?: Record<string, unknown>;
}): TaskCheckpoint {
  const now = new Date().toISOString();
  const taskId = params.taskId || `task_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  const checkpointSteps: TaskCheckpointStep[] = params.steps.map((s, idx) => ({
    id: s.id || `step_${idx + 1}`,
    order: idx + 1,
    label: s.label,
    status: "pending",
  }));

  return {
    taskId,
    title: params.title,
    goal: params.goal,
    status: "running",
    currentStepIndex: 0,
    totalSteps: checkpointSteps.length,
    steps: checkpointSteps,
    completedStepIds: [],
    executedActionHashes: [],
    pageUrl: params.pageUrl,
    pageOrigin: params.pageOrigin,
    buddySlug: params.buddySlug || "friendly",
    requiresUserApproval: false,
    needsUserAttention: false,
    stateData: params.initialStateData || {},
    createdAt: now,
    updatedAt: now,
    checkpointNumber: 1,
  };
}

/**
 * Advances the checkpoint by recording completion of a step and storing its output.
 */
export function recordStepCheckpoint(
  checkpoint: TaskCheckpoint,
  stepId: string,
  stepResult: unknown,
  actionHash?: string,
): TaskCheckpoint {
  const now = new Date().toISOString();
  const stepIdx = checkpoint.steps.findIndex((s) => s.id === stepId);
  const updatedSteps = [...checkpoint.steps];

  const hash = actionHash || computeActionHash("generic_step", "", "", stepIdx >= 0 ? stepIdx : 0);
  const updatedHashes = checkpoint.executedActionHashes.includes(hash)
    ? checkpoint.executedActionHashes
    : [...checkpoint.executedActionHashes, hash];

  if (stepIdx >= 0) {
    const existing = updatedSteps[stepIdx]!;
    updatedSteps[stepIdx] = {
      ...existing,
      status: "completed",
      actionHash: hash,
      result: stepResult,
      completedAt: now,
    };
  }

  const updatedCompletedIds = checkpoint.completedStepIds.includes(stepId)
    ? checkpoint.completedStepIds
    : [...checkpoint.completedStepIds, stepId];

  const nextIndex = stepIdx >= 0 ? stepIdx + 1 : checkpoint.currentStepIndex + 1;
  const isFinished = nextIndex >= checkpoint.totalSteps;

  return {
    ...checkpoint,
    currentStepIndex: nextIndex,
    steps: updatedSteps,
    completedStepIds: updatedCompletedIds,
    executedActionHashes: updatedHashes,
    status: isFinished ? "completed" : "running",
    requiresUserApproval: false,
    pendingConsequentialAction: undefined,
    needsUserAttention: false,
    attentionReason: undefined,
    updatedAt: now,
    checkpointNumber: checkpoint.checkpointNumber + 1,
  };
}

/**
 * Checks whether an action has already been executed to prevent duplicates upon task resumption.
 */
export function isActionDuplicate(checkpoint: TaskCheckpoint, actionHash: string): boolean {
  return checkpoint.executedActionHashes.includes(actionHash);
}

/**
 * Sets the checkpoint into an awaiting approval state before executing a consequential step.
 */
export function setCheckpointAwaitingApproval(
  checkpoint: TaskCheckpoint,
  action: { type: string; selector?: string; description?: string },
  prompt: string,
): TaskCheckpoint {
  const now = new Date().toISOString();
  return {
    ...checkpoint,
    status: "awaiting_approval",
    requiresUserApproval: true,
    approvalPrompt: prompt,
    pendingConsequentialAction: action,
    needsUserAttention: true,
    attentionReason: prompt,
    updatedAt: now,
    checkpointNumber: checkpoint.checkpointNumber + 1,
  };
}

/**
 * Flags that a task requires user intervention (e.g. CAPTCHA, 2FA, OTP, or missing credentials).
 */
export function setCheckpointNeedsAssistance(
  checkpoint: TaskCheckpoint,
  reason: string,
): TaskCheckpoint {
  const now = new Date().toISOString();
  return {
    ...checkpoint,
    status: "waiting_for_user_assistance",
    needsUserAttention: true,
    attentionReason: reason,
    updatedAt: now,
    checkpointNumber: checkpoint.checkpointNumber + 1,
  };
}

/**
 * Rolls back the checkpoint to the last safely completed step on recoverable failure.
 */
export function rollbackToLastSafeCheckpoint(
  checkpoint: TaskCheckpoint,
  failureReason: string,
): TaskCheckpoint {
  const now = new Date().toISOString();
  const safeIndex = Math.max(0, checkpoint.completedStepIds.length);

  const updatedSteps = checkpoint.steps.map((s, idx) => {
    if (idx >= safeIndex) {
      return { ...s, status: "pending" as const, error: undefined };
    }
    return s;
  });

  return {
    ...checkpoint,
    status: "paused",
    currentStepIndex: safeIndex,
    steps: updatedSteps,
    needsUserAttention: true,
    attentionReason: `Recovered safely: ${failureReason}. Task is paused at last verified step.`,
    updatedAt: now,
    checkpointNumber: checkpoint.checkpointNumber + 1,
  };
}

/**
 * Safely serializes a checkpoint for storage in chrome.storage.local or PostgreSQL.
 */
export function serializeCheckpoint(checkpoint: TaskCheckpoint): string {
  return JSON.stringify(checkpoint);
}

/**
 * Deserializes and validates a saved checkpoint.
 */
export function deserializeCheckpoint(raw: string): TaskCheckpoint | null {
  try {
    const parsed = JSON.parse(raw) as TaskCheckpoint;
    if (!parsed.taskId || !Array.isArray(parsed.steps)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
