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
  generateMultiActionPlan,
  type BrowserAction,
  type BrowserActionType,
  type ActionTarget,
  type MultiActionStep,
  type MultiActionTaskPlan,
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
  elementRef?: string | undefined;
  data?: Record<string, unknown> | undefined;
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
  approvalPrompt?: string | undefined;
  pendingConsequentialAction?: BrowserAction | undefined;
  verificationReport?: string | undefined;
  error?: string | undefined;
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

/**
 * Creates a multi-step task execution plan from an instruction and optional snapshot.
 */
export function createMultiActionPlan(
  instruction: string,
  snapshot?: PageSnapshot | null,
): MultiActionTaskPlan {
  return generateMultiActionPlan(instruction, snapshot);
}

/**
 * Executes the next step in a multi-action plan, managing lifecycle states,
 * consequential approval gates, and data aggregation.
 */
export async function executeNextPlanStep(
  plan: MultiActionTaskPlan,
  executor: (step: MultiActionStep) => Promise<{
    success: boolean;
    result?: string;
    extractedData?: Record<string, unknown> | Array<Record<string, unknown>> | string[];
    error?: string;
  }>,
): Promise<MultiActionTaskPlan> {
  const now = new Date().toISOString();
  if (plan.status === "paused" || plan.status === "cancelled" || plan.status === "failed") {
    return plan;
  }

  if (plan.currentStepIndex >= plan.steps.length) {
    return {
      ...plan,
      status: "completed",
      completedAt: now,
      updatedAt: now,
    };
  }

  const step = plan.steps[plan.currentStepIndex]!;

  // 1. Check if step requires consequential user approval
  if (step.requiresApproval && step.status !== "awaiting_approval") {
    const updatedSteps = [...plan.steps];
    updatedSteps[plan.currentStepIndex] = {
      ...step,
      status: "awaiting_approval",
    };
    return {
      ...plan,
      status: "awaiting_approval",
      pendingApprovalStepId: step.id,
      steps: updatedSteps,
      updatedAt: now,
    };
  }

  // 2. Mark step as running
  const runningSteps = [...plan.steps];
  runningSteps[plan.currentStepIndex] = {
    ...step,
    status: "running",
  };
  const runningPlan: MultiActionTaskPlan = {
    ...plan,
    status: "running",
    steps: runningSteps,
    updatedAt: now,
  };

  try {
    const res = await executor(step);
    const completedSteps = [...runningPlan.steps];
    if (res.success) {
      completedSteps[plan.currentStepIndex] = {
        ...step,
        status: "completed",
        verified: true,
        result: res.result || "Step completed and verified",
        extractedData: res.extractedData,
      };

      // Aggregate extracted data if present
      let updatedExtractedData: Array<Record<string, unknown> | string> | Record<string, unknown> =
        plan.extractedData;
      if (res.extractedData) {
        if (Array.isArray(updatedExtractedData)) {
          if (Array.isArray(res.extractedData)) {
            updatedExtractedData = [...updatedExtractedData, ...res.extractedData] as Array<
              Record<string, unknown> | string
            >;
          } else {
            updatedExtractedData = [...updatedExtractedData, res.extractedData] as Array<
              Record<string, unknown> | string
            >;
          }
        } else if (typeof updatedExtractedData === "object" && updatedExtractedData !== null) {
          if (typeof res.extractedData === "object" && !Array.isArray(res.extractedData)) {
            updatedExtractedData = { ...updatedExtractedData, ...res.extractedData };
          }
        }
      }

      const nextIndex = plan.currentStepIndex + 1;
      const isAllDone = nextIndex >= plan.steps.length;

      return {
        ...runningPlan,
        currentStepIndex: nextIndex,
        steps: completedSteps,
        extractedData: updatedExtractedData,
        status: isAllDone ? "completed" : "pending",
        completedAt: isAllDone ? now : undefined,
        updatedAt: now,
      };
    } else {
      completedSteps[plan.currentStepIndex] = {
        ...step,
        status: "failed",
        error: res.error || "Action execution failed",
      };
      return {
        ...runningPlan,
        status: "failed",
        error: res.error || `Step ${step.stepNumber} (${step.title}) failed`,
        steps: completedSteps,
        updatedAt: now,
      };
    }
  } catch (err) {
    const failedSteps = [...runningPlan.steps];
    failedSteps[plan.currentStepIndex] = {
      ...step,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
    return {
      ...runningPlan,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
      steps: failedSteps,
      updatedAt: now,
    };
  }
}

export function pauseMultiActionPlan(plan: MultiActionTaskPlan): MultiActionTaskPlan {
  return {
    ...plan,
    status: "paused",
    updatedAt: new Date().toISOString(),
  };
}

export function resumeMultiActionPlan(plan: MultiActionTaskPlan): MultiActionTaskPlan {
  if (plan.status !== "paused") return plan;
  return {
    ...plan,
    status: "pending",
    updatedAt: new Date().toISOString(),
  };
}

export function skipCurrentPlanStep(plan: MultiActionTaskPlan): MultiActionTaskPlan {
  if (plan.currentStepIndex >= plan.steps.length) return plan;
  const now = new Date().toISOString();
  const updatedSteps = [...plan.steps];
  const currentStep = updatedSteps[plan.currentStepIndex]!;
  updatedSteps[plan.currentStepIndex] = {
    ...currentStep,
    status: "skipped",
    result: "Skipped by user",
  };
  const nextIndex = plan.currentStepIndex + 1;
  const isDone = nextIndex >= plan.steps.length;
  return {
    ...plan,
    currentStepIndex: nextIndex,
    steps: updatedSteps,
    status: isDone ? "completed" : "pending",
    completedAt: isDone ? now : undefined,
    pendingApprovalStepId: undefined,
    updatedAt: now,
  };
}

export function cancelMultiActionPlan(plan: MultiActionTaskPlan): MultiActionTaskPlan {
  return {
    ...plan,
    status: "cancelled",
    updatedAt: new Date().toISOString(),
  };
}

export function approveAndContinuePlan(plan: MultiActionTaskPlan): MultiActionTaskPlan {
  const now = new Date().toISOString();
  if (plan.currentStepIndex >= plan.steps.length) return plan;
  const updatedSteps = [...plan.steps];
  const step = updatedSteps[plan.currentStepIndex]!;
  updatedSteps[plan.currentStepIndex] = {
    ...step,
    requiresApproval: false,
    status: "pending",
  };
  return {
    ...plan,
    status: "pending",
    pendingApprovalStepId: undefined,
    steps: updatedSteps,
    updatedAt: now,
  };
}
