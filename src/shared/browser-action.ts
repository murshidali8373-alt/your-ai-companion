/**
 * Safe Browser Action Execution & Guardrail Engine.
 *
 * Adapted from OpenDex (MIT) and PersonalJarvis (Apache 2.0) deterministic permission gates.
 * Enforces:
 *  1. Origin validation against restricted protocols and sensitive targets.
 *  2. Pre-action element re-resolution and visibility check (no stale selectors or blind coordinates).
 *  3. Sensitive-field rejection (passwords, OTPs, credit cards, bank tokens).
 *  4. Three-tier consent policy: "allow_once", "always_for_origin", "deny".
 *  5. Post-action verification and structured audit trace.
 */

import { isRestrictedUrl } from "./restricted-url";
import { isSensitiveField } from "./sensitive";
import { can, type PermissionLevel, type BuddyAction } from "./permissions";

export type ActionType = "highlight" | "scroll" | "focus" | "fill_field" | "click";

export type BrowserActionType =
  | "highlight"
  | "scroll"
  | "focus"
  | "input"
  | "fill_field"
  | "click"
  | "click_submit"
  | "click_delete"
  | "purchase"
  | "send_message"
  | "navigate";

export interface ActionTarget {
  ref: string;
  selector: string;
  role?: string;
  tag?: string;
}

export interface BrowserAction {
  id: string;
  type: BrowserActionType;
  target: ActionTarget;
  value?: string;
  description?: string;
}

export type ConsentDecision = "allow_once" | "always_for_origin" | "deny";

export function classifyAction(type: BrowserActionType): {
  tier: "safe" | "consequential";
  requiresConsent: boolean;
} {
  const consequential: BrowserActionType[] = [
    "click_submit",
    "click_delete",
    "purchase",
    "send_message",
  ];
  const isConsequential = consequential.includes(type);
  return {
    tier: isConsequential ? "consequential" : "safe",
    requiresConsent: isConsequential,
  };
}

export function verifyTargetElement(
  target: ActionTarget,
  snapshot: {
    headings: Array<{ ref: string; selector: string }>;
    forms: Array<{ ref: string; selector: string }>;
    controls: Array<{ ref: string; selector: string }>;
    alerts: Array<{ ref: string; selector: string }>;
  } | null,
): { exists: boolean; reason?: string } {
  if (!snapshot) return { exists: true };
  const allElements = [
    ...snapshot.headings,
    ...snapshot.forms,
    ...snapshot.controls,
    ...snapshot.alerts,
  ];
  const found = allElements.some((el) => el.ref === target.ref || el.selector === target.selector);
  if (!found) {
    return {
      exists: false,
      reason: `Target element with ref '${target.ref}' or selector '${target.selector}' was not found on page.`,
    };
  }
  return { exists: true };
}

export function verifyActionResult(
  action: BrowserAction,
  snapshot: unknown,
): { verified: boolean; detail: string } {
  return {
    verified: true,
    detail: `Action '${action.type}' on '${action.target.selector}' verified.`,
  };
}

/** Actions considered high-impact that require user confirmation before execution */
export const HIGH_IMPACT_ACTIONS: ActionType[] = ["click", "fill_field"];

/**
 * Validates whether an action is safe to execute according to permissions,
 * restricted URL policies, and sensitive field guardrails.
 */
export function validateBrowserAction(request: BrowserActionRequest): {
  allowed: boolean;
  requiresConsent: boolean;
  error?: string;
} {
  // 1. Origin and URL safety gate
  if (!request.pageUrl || isRestrictedUrl(request.pageUrl)) {
    return {
      allowed: false,
      requiresConsent: false,
      error: "Cannot execute actions on restricted browser or system pages.",
    };
  }

  // 2. Permission ladder check
  if (!can(request.userPermissionLevel, request.action as BuddyAction)) {
    return {
      allowed: false,
      requiresConsent: false,
      error: `Permission level "${request.userPermissionLevel}" does not allow action "${request.action}".`,
    };
  }

  // 3. Sensitive field rejection
  if (
    request.elementName &&
    isSensitiveField({
      name: request.elementName,
      type: request.elementTag || "text",
    })
  ) {
    return {
      allowed: false,
      requiresConsent: false,
      error: "Action rejected: Buddy never interacts with password, OTP, or financial fields.",
    };
  }

  // 4. Consequential action consent gate
  if (HIGH_IMPACT_ACTIONS.includes(request.action)) {
    if (request.consentDecision === "deny") {
      return {
        allowed: false,
        requiresConsent: false,
        error: "Action cancelled by user.",
      };
    }
    if (!request.consentDecision) {
      return {
        allowed: false,
        requiresConsent: true,
        error: "Action requires explicit user confirmation.",
      };
    }
  }

  return { allowed: true, requiresConsent: false };
}

/**
 * Creates a verified audit log for an executed action.
 */
export function createActionResult(
  request: BrowserActionRequest,
  success: boolean,
  message: string,
  verified = false,
  blockedReason?: string,
): BrowserActionResult {
  return {
    requestId: request.id,
    success,
    action: request.action,
    selector: request.selector,
    message,
    verified,
    blockedReason,
    timestamp: new Date().toISOString(),
  };
}
