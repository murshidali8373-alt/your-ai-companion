/**
 * Task Lifecycle & Safe Browser Action Engine
 *
 * Implements the 7-stage state machine:
 * OBSERVING → UNDERSTANDING → PLANNING → AWAITING_APPROVAL → ACTING → VERIFYING → COMPLETED (or FAILED)
 *
 * Enforces:
 * - High-impact action gates (form submits, deletions, purchases, external navigations)
 * - Sensitive field blocklist (passwords, card numbers, OTPs, auth tokens)
 * - Pre-check target verification before any DOM operation
 * - Post-check result verification after action
 * - Truthful recovery and execution trace logging
 */

import { type PageSnapshot, type SnapshotElement } from "./page-snapshot";
import {
  classifyAction,
  verifyTargetElement,
  verifyActionResult,
  type BrowserAction,
  type BrowserActionType,
  type ActionTarget,
} from "./browser-action";

export type TaskLifecycleStage =
  | "observing"
  | "understanding"
  | "planning"
  | "awaiting_approval"
  | "acting"
  | "verifying"
  | "completed"
  | "failed";

export interface TaskLifecycleStep {
  stage: TaskLifecycleStage;
  timestamp: string;
  detail: string;
  elementRef?: string;
  data?: Record<string, unknown>;
}

export interface TaskExecutionPlan {
  id: string;
  title: string;
  goal: string;
  currentStage: TaskLifecycleStage;
  actions: BrowserAction[];
  currentActionIndex: number;
  steps: TaskLifecycleStep[];
  snapshot: PageSnapshot | null;
  requiresUserApproval: boolean;
  approvalPrompt?: string;
  pendingConsequentialAction?: BrowserAction;
  verificationReport?: string;
  error?: string;
}

/**
 * Creates a new task execution plan initialized to "observing"
 */
export function createTaskPlan(
  title: string,
  goal: string,
  snapshot: PageSnapshot | null,
): TaskExecutionPlan {
  const now = new Date().toISOString();
  return {
    id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    title,
    goal,
    currentStage: "observing",
    actions: [],
    currentActionIndex: 0,
    steps: [
      {
        stage: "observing",
        timestamp: now,
        detail: snapshot
          ? `Observed ${snapshot.title} (${snapshot.forms.length} inputs, ${snapshot.controls.length} controls)`
          : "Initial task created without snapshot.",
      },
    ],
    snapshot,
    requiresUserApproval: false,
  };
}

/**
 * Transitions the plan to the next stage and logs an audit step
 */
export function advanceTaskStage(
  plan: TaskExecutionPlan,
  nextStage: TaskLifecycleStage,
  detail: string,
  extra?: { elementRef?: string; data?: Record<string, unknown> },
): TaskExecutionPlan {
  const now = new Date().toISOString();
  return {
    ...plan,
    currentStage: nextStage,
    steps: [
      ...plan.steps,
      {
        stage: nextStage,
        timestamp: now,
        detail,
        elementRef: extra?.elementRef,
        data: extra?.data,
      },
    ],
  };
}

/**
 * Evaluates whether an action requires explicit user confirmation
 */
export function checkActionSafety(
  action: BrowserAction,
  snapshot: PageSnapshot | null,
): {
  isSafe: boolean;
  requiresConfirmation: boolean;
  reason: string;
} {
  const classification = classifyAction(action.type);

  // 1. Consequential action check
  if (classification.tier === "consequential") {
    return {
      isSafe: true,
      requiresConfirmation: true,
      reason: `This action (${action.type}) will submit data or make changes. Please review and confirm.`,
    };
  }

  // 2. Sensitive input check
  if (action.type === "input" && snapshot) {
    const el = snapshot.forms.find(
      (f) => f.ref === action.target.ref || f.selector === action.target.selector,
    );
    if (el?.sensitive) {
      return {
        isSafe: false,
        requiresConfirmation: false,
        reason: "Blocked: Cannot automate input into password, OTP, or credit card fields.",
      };
    }
  }

  return {
    isSafe: true,
    requiresConfirmation: false,
    reason: "Action is safe to proceed automatically.",
  };
}

/**
 * Pre-checks and executes a browser action against a snapshot or mock DOM
 */
export async function executePlanStep(
  plan: TaskExecutionPlan,
  action: BrowserAction,
  executor: (action: BrowserAction) => Promise<boolean>,
): Promise<TaskExecutionPlan> {
  // 1. Safety check
  const safety = checkActionSafety(action, plan.snapshot);
  if (!safety.isSafe) {
    const failed = advanceTaskStage(plan, "failed", `Security violation: ${safety.reason}`);
    failed.error = safety.reason;
    return failed;
  }

  if (safety.requiresConfirmation) {
    const awaiting = advanceTaskStage(
      plan,
      "awaiting_approval",
      `Waiting for user approval: ${action.description || action.type}`,
    );
    awaiting.requiresUserApproval = true;
    awaiting.pendingConsequentialAction = action;
    awaiting.approvalPrompt = safety.reason;
    return awaiting;
  }

  // 2. Pre-check target
  const actingPlan = advanceTaskStage(
    plan,
    "acting",
    `Executing: ${action.description || action.type}`,
  );
  const preCheck = verifyTargetElement(action.target, plan.snapshot);
  if (!preCheck.exists) {
    const failed = advanceTaskStage(
      actingPlan,
      "failed",
      `Pre-check failed: Target element '${action.target.selector}' was not found on page.`,
    );
    failed.error = preCheck.reason;
    return failed;
  }

  // 3. Act
  try {
    const success = await executor(action);
    if (!success) {
      const failed = advanceTaskStage(
        actingPlan,
        "failed",
        `Action execution failed: ${action.type}`,
      );
      return failed;
    }

    // 4. Verify post-condition
    const verifyingPlan = advanceTaskStage(
      actingPlan,
      "verifying",
      `Verifying result of ${action.type}...`,
    );
    const postCheck = verifyActionResult(action, plan.snapshot);
    verifyingPlan.verificationReport = postCheck.detail;

    // 5. Complete step
    const completed = advanceTaskStage(
      verifyingPlan,
      "completed",
      `Step completed and verified: ${postCheck.detail}`,
    );
    completed.currentActionIndex = plan.currentActionIndex + 1;
    return completed;
  } catch (err) {
    const failed = advanceTaskStage(
      actingPlan,
      "failed",
      `Execution error: ${err instanceof Error ? err.message : "Unknown error"}`,
    );
    failed.error = String(err);
    return failed;
  }
}
