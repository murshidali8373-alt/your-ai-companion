/**
 * ENGINE 3: ACTION ENGINE & AUTONOMOUS WORKFLOWS
 *
 * Responsibilities:
 * - 5-level permission enforcement (Observe, Explain, Suggest, Assist, Execute)
 * - Safe pre-check target validation and post-check state verification
 * - High-impact consequential action gating (submit, delete, pay, purchase)
 * - Intelligent step dependency and precondition management
 * - Page state comparison before vs after actions
 * - Error recovery without restarting entire multi-step tasks
 */

import {
  type BrowserAction,
  type BrowserActionType,
  type ActionTarget,
} from "@/shared/browser-action";
import { type PermissionLevel } from "@/shared/permissions";
import { isRestrictedUrl } from "@/shared/restricted-url";
import { isSensitiveField } from "@/shared/sensitive";

export interface ActionExecutionRequest {
  id: string;
  type: BrowserActionType;
  target: ActionTarget;
  value?: string | undefined;
  pageUrl: string;
  pageOrigin: string;
  userPermissionLevel: PermissionLevel;
  consentDecision?: "allow_once" | "always_for_origin" | "deny" | undefined;
}

export interface ActionExecutionValidation {
  allowed: boolean;
  requiresConsent: boolean;
  isConsequential: boolean;
  reason?: string | undefined;
}

export interface ActionExecutionResult {
  actionId: string;
  type: BrowserActionType;
  success: boolean;
  verified: boolean;
  message: string;
  timestamp: string;
  previousState?: string | undefined;
  newState?: string | undefined;
}

export type AutonomousStepState =
  | "pending"
  | "waiting_for_page_load"
  | "waiting_for_user_assistance"
  | "awaiting_approval"
  | "in_progress"
  | "completed"
  | "failed_recoverable"
  | "failed_terminal"
  | "skipped";

export interface StepPreconditionContext {
  isPageLoading?: boolean | undefined;
  isBlockedByAuth?: boolean | undefined;
  userConsentGranted?: boolean | undefined;
  elementVisible?: boolean | undefined;
}

export interface StepPreconditionEvaluation {
  ready: boolean;
  state: AutonomousStepState;
  guidanceMessage: string;
}

const CONSEQUENTIAL_ACTIONS = new Set<BrowserActionType>([
  "click_submit",
  "click_delete",
  "purchase",
  "send_message",
]);

/**
 * Validates an action request against permissions, restricted URLs, sensitive targets, and consequential gates
 */
export function validateAction(req: ActionExecutionRequest): ActionExecutionValidation {
  // 1. Restricted URL check
  if (isRestrictedUrl(req.pageUrl)) {
    return {
      allowed: false,
      requiresConsent: false,
      isConsequential: false,
      reason: "Action blocked on restricted or internal browser page.",
    };
  }

  // 2. Sensitive field check
  if (req.target.role === "textbox" || req.target.role === "textarea") {
    if (isSensitiveField(req.target.text ?? "", req.target.selector)) {
      return {
        allowed: false,
        requiresConsent: false,
        isConsequential: true,
        reason: "Security block: password, OTP, or financial security fields cannot be automated.",
      };
    }
  }

  const isConsequential = CONSEQUENTIAL_ACTIONS.has(req.type);

  // 3. Permission Level Check
  switch (req.userPermissionLevel) {
    case "observe":
      return {
        allowed: false,
        requiresConsent: true,
        isConsequential,
        reason: 'Permission level "observe" only permits reading page content.',
      };
    case "explain":
      return {
        allowed: false,
        requiresConsent: true,
        isConsequential,
        reason: 'Permission level "explain" does not permit interactive browser actions.',
      };
    case "suggest":
      return {
        allowed: false,
        requiresConsent: true,
        isConsequential,
        reason: 'Permission level "suggest" requires user confirmation before executing actions.',
      };
    case "assist":
      if (
        isConsequential &&
        req.consentDecision !== "allow_once" &&
        req.consentDecision !== "always_for_origin"
      ) {
        return {
          allowed: false,
          requiresConsent: true,
          isConsequential: true,
          reason: "High-impact consequential action requires explicit user approval.",
        };
      }
      return {
        allowed: true,
        requiresConsent: false,
        isConsequential,
      };
    case "execute":
      if (
        isConsequential &&
        req.consentDecision !== "allow_once" &&
        req.consentDecision !== "always_for_origin"
      ) {
        return {
          allowed: false,
          requiresConsent: true,
          isConsequential: true,
          reason: "Confirmation required for submission, payment, or deletion.",
        };
      }
      return {
        allowed: true,
        requiresConsent: false,
        isConsequential,
      };
    default:
      return {
        allowed: false,
        requiresConsent: true,
        isConsequential,
        reason: "Unknown permission level.",
      };
  }
}

/**
 * Creates structured execution trace result
 */
export function createActionResult(
  actionId: string,
  type: BrowserActionType,
  success: boolean,
  verified: boolean,
  message: string,
  state?: { before?: string; after?: string },
): ActionExecutionResult {
  return {
    actionId,
    type,
    success,
    verified,
    message,
    timestamp: new Date().toISOString(),
    previousState: state?.before,
    newState: state?.after,
  };
}

/**
 * Evaluates step preconditions before dispatching to browser DOM
 */
export function evaluateStepPrecondition(
  step: { isConsequential?: boolean; label: string },
  ctx: StepPreconditionContext,
): StepPreconditionEvaluation {
  if (ctx.isPageLoading) {
    return {
      ready: false,
      state: "waiting_for_page_load",
      guidanceMessage: "Waiting for page assets and DOM elements to settle…",
    };
  }

  if (ctx.isBlockedByAuth) {
    return {
      ready: false,
      state: "waiting_for_user_assistance",
      guidanceMessage:
        "Authentication or login is required on this website. Please sign in to continue.",
    };
  }

  if (step.isConsequential && !ctx.userConsentGranted) {
    return {
      ready: false,
      state: "awaiting_approval",
      guidanceMessage: `Consequential action "${step.label}" requires your explicit approval before proceeding.`,
    };
  }

  return {
    ready: true,
    state: "ready" as AutonomousStepState,
    guidanceMessage: `Preconditions verified. Ready to execute step "${step.label}".`,
  };
}

/**
 * Compares page state before vs after action execution to verify genuine mutations
 */
export function compareActionStates(
  before: { text: string; url?: string },
  after: { text: string; url?: string },
): { mutated: boolean; urlChanged: boolean; lengthDelta: number; verified: boolean } {
  const urlChanged = Boolean(before.url && after.url && before.url !== after.url);
  const lengthDelta = after.text.length - before.text.length;
  const mutated = urlChanged || Math.abs(lengthDelta) > 10 || before.text !== after.text;

  return {
    mutated,
    urlChanged,
    lengthDelta,
    verified: mutated,
  };
}
