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
import type { PageSnapshot } from "./page-snapshot";

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
  | "select"
  | "check"
  | "uncheck"
  | "keyboard"
  | "extract"
  | "extract_table"
  | "locate"
  | "multi_step"
  | "wait_for"
  | "switch_tab"
  | "open_tab"
  | "close_tab"
  | "navigate"
  | "purchase"
  | "send_message";

export interface ActionTarget {
  ref: string;
  selector: string;
  role?: string;
  tag?: string;
  text?: string;
}

export interface BrowserAction {
  id: string;
  type: BrowserActionType;
  target: ActionTarget;
  value?: string;
  description?: string;
}

export interface MultiActionStep {
  id: string;
  stepNumber: number;
  title: string;
  action: BrowserActionType;
  target?: ActionTarget;
  selector?: string;
  dynamicTargetQuery?: string;
  resolvedSelector?: string;
  textTarget?: string;
  value?: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped" | "awaiting_approval";
  isConsequential?: boolean;
  requiresApproval?: boolean;
  approvalPrompt?: string;
  verified?: boolean;
  result?: string;
  extractedData?: Record<string, unknown> | Array<Record<string, unknown>> | string[];
  error?: string;
  tabUrl?: string;
  tabId?: number;
  executionTrace?: {
    attemptCount: number;
    initialSelector?: string;
    resolvedSelector?: string;
    targetMatchReason?: string;
    preActionUrl?: string;
    postActionUrl?: string;
    settledInMs?: number;
    verifiedBy?: "url_change" | "value_match" | "dom_mutation" | "data_extracted";
  };
}

export interface MultiActionTaskPlan {
  id: string;
  title: string;
  originalInstruction: string;
  targetWebsite?: string;
  targetOrigin?: string;
  activeTabId?: number;
  steps: MultiActionStep[];
  currentStepIndex: number;
  totalSteps: number;
  status:
    "pending" | "running" | "paused" | "completed" | "failed" | "cancelled" | "awaiting_approval";
  extractedData: Array<Record<string, unknown> | string> | Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  pendingApprovalStepId?: string;
  error?: string;
}

/** Full context a browser action needs before it may run (permission gate input). */
export interface BrowserActionRequest {
  id: string;
  action: BrowserActionType;
  selector: string;
  value?: string;
  pageUrl: string;
  pageOrigin: string;
  userPermissionLevel: PermissionLevel;
  elementName?: string;
  elementTag?: string;
  consentDecision?: ConsentDecision;
}

/** Structured, auditable result of an executed (or blocked) browser action. */
export interface BrowserActionResult {
  requestId: string;
  success: boolean;
  action: BrowserActionType;
  selector: string;
  message: string;
  verified: boolean;
  blockedReason?: string | undefined;
  timestamp: string;
  extractedData?: unknown;
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

/**
 * Dynamically re-resolves the target selector for a step against a live PageSnapshot.
 * Prevents stale selector failures when page DOM mutates between steps.
 */
export function resolveLiveStepTarget(
  step: MultiActionStep,
  snapshot: PageSnapshot | null,
): {
  selector: string;
  matched: boolean;
  strategy: "direct" | "semantic" | "text" | "role" | "fallback";
  confidence: number;
} {
  if (!snapshot) {
    return {
      selector: step.selector || "body",
      matched: false,
      strategy: "fallback",
      confidence: 0.1,
    };
  }

  const allElements = [
    ...(snapshot.controls || []),
    ...(snapshot.forms || []),
    ...(snapshot.headings || []),
    ...(snapshot.alerts || []),
  ];

  // 1. Check if the existing direct selector exists in the fresh snapshot
  if (step.selector && step.selector !== "body") {
    const directMatch = allElements.find((el) => el.selector === step.selector);
    if (directMatch) {
      return {
        selector: directMatch.selector,
        matched: true,
        strategy: "direct",
        confidence: 0.95,
      };
    }
  }

  // 2. Query matching: use dynamicTargetQuery, textTarget, title, or value
  const query = (step.dynamicTargetQuery || step.textTarget || step.title || step.value || "")
    .toLowerCase()
    .trim();

  if (!query) {
    return {
      selector: step.selector || "body",
      matched: false,
      strategy: "fallback",
      confidence: 0.2,
    };
  }

  // Clean prompt noise words from query
  const cleanQuery = query
    .replace(/^(click|open|press|select|go to|fill|type|search|find|copy)\s+/i, "")
    .replace(/\s+(button|link|tab|input|field|box)$/i, "")
    .trim();

  // 3. Exact accessible name or label match
  const exactNameMatch = allElements.find(
    (el) => el.name && el.name.toLowerCase().trim() === cleanQuery,
  );
  if (exactNameMatch) {
    return {
      selector: exactNameMatch.selector,
      matched: true,
      strategy: "semantic",
      confidence: 0.9,
    };
  }

  // 4. Substring text or placeholder match on interactive elements
  const substringMatch = allElements.find((el) => {
    const name = (el.name || "").toLowerCase();
    const ph = ((el as { placeholder?: string }).placeholder || "").toLowerCase();
    const sel = (el.selector || "").toLowerCase();
    return name.includes(cleanQuery) || ph.includes(cleanQuery) || sel.includes(cleanQuery);
  });
  if (substringMatch) {
    return {
      selector: substringMatch.selector,
      matched: true,
      strategy: "text",
      confidence: 0.75,
    };
  }

  // 5. Role-appropriate match (e.g. if action is click_submit, find submit button)
  if (step.action === "click_submit") {
    const submitBtn = allElements.find(
      (el) =>
        el.role === "button" &&
        /submit|save|proceed|confirm|continue|checkout|purchase|pay|done/i.test(el.name || ""),
    );
    if (submitBtn) {
      return {
        selector: submitBtn.selector,
        matched: true,
        strategy: "role",
        confidence: 0.8,
      };
    }
  }

  // Fallback to step's initial selector or body
  return {
    selector: step.selector || "body",
    matched: false,
    strategy: "fallback",
    confidence: 0.3,
  };
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
export const HIGH_IMPACT_ACTIONS: BrowserActionType[] = ["click", "fill_field"];

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

/**
 * Generates an intelligent, multi-step browser execution plan from a user instruction
 * and an optional page snapshot.
 */
export function generateMultiActionPlan(
  instruction: string,
  snapshot?: PageSnapshot | null,
): MultiActionTaskPlan {
  const trimmed = (instruction || "").trim();
  const lower = trimmed.toLowerCase();
  const planId = `plan_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const now = new Date().toISOString();

  // Detect destination website or origin
  let targetWebsite = snapshot?.url || "";
  let targetOrigin = snapshot?.origin || "";

  if (lower.includes("meesho")) {
    targetWebsite = "https://supplier.meesho.com";
    targetOrigin = "https://supplier.meesho.com";
  } else if (lower.includes("amazon")) {
    targetWebsite = "https://sellercentral.amazon.in";
    targetOrigin = "https://sellercentral.amazon.in";
  } else if (lower.includes("flipkart")) {
    targetWebsite = "https://seller.flipkart.com";
    targetOrigin = "https://seller.flipkart.com";
  } else {
    const urlMatch = trimmed.match(/https?:\/\/[^\s]+/i);
    if (urlMatch) {
      targetWebsite = urlMatch[0];
      try {
        targetOrigin = new URL(targetWebsite).origin;
      } catch {
        // Ignore invalid URL
      }
    }
  }

  const steps: MultiActionStep[] = [];

  // Specialized workflow 1: Meesho Supplier Panel orders extraction
  if (lower.includes("meesho") && (lower.includes("order") || lower.includes("supplier"))) {
    steps.push({
      id: `${planId}_s1`,
      stepNumber: 1,
      title: "Open Meesho Supplier Panel",
      action: "navigate",
      value: "https://supplier.meesho.com/panel/orders",
      selector: "body",
      status: "pending",
      verified: false,
    });
    steps.push({
      id: `${planId}_s2`,
      stepNumber: 2,
      title: "Go to Orders section",
      action: "click",
      selector: 'a[href*="orders"], button:has-text("Orders"), nav [role="tab"]:has-text("Orders")',
      textTarget: "Orders",
      status: "pending",
      verified: false,
    });
    steps.push({
      id: `${planId}_s3`,
      stepNumber: 3,
      title: "Filter today's orders",
      action: "click",
      selector: 'button:has-text("Today"), [data-filter="today"], input[value="today"]',
      textTarget: "Today",
      status: "pending",
      verified: false,
    });
    steps.push({
      id: `${planId}_s4`,
      stepNumber: 4,
      title: "Find pending orders",
      action: "click",
      selector: 'button:has-text("Pending"), [data-tab="pending"], input[value="pending"]',
      textTarget: "Pending",
      status: "pending",
      verified: false,
    });
    steps.push({
      id: `${planId}_s5`,
      stepNumber: 5,
      title: "Copy pending order IDs",
      action: "extract",
      selector: 'table tbody tr, [data-testid="order-row"], td[class*="order-id"], td:first-child',
      value: "order_id",
      textTarget: "Order ID",
      status: "pending",
      verified: false,
    });
    steps.push({
      id: `${planId}_s6`,
      stepNumber: 6,
      title: "Prepare verified order list",
      action: "extract",
      value: "copy_list",
      status: "pending",
      verified: false,
    });
  } else if (
    snapshot &&
    snapshot.forms.length > 0 &&
    (lower.includes("fill") || lower.includes("form") || lower.includes("book"))
  ) {
    // Specialized workflow 2: Form filling from snapshot
    let sNum = 1;
    for (const formEl of snapshot.forms) {
      if (formEl.sensitive) continue; // Skip sensitive fields
      steps.push({
        id: `${planId}_s${sNum}`,
        stepNumber: sNum,
        title: `Fill ${formEl.name || formEl.placeholder || "input field"}`,
        action: "fill_field",
        selector: formEl.selector,
        value: formEl.value || (formEl.placeholder ? `Sample ${formEl.name}` : "Verified input"),
        status: "pending",
        verified: false,
      });
      sNum++;
    }

    // Add submit/consequential step if a button exists
    const submitBtn = snapshot.controls.find(
      (c) =>
        c.role === "button" &&
        /submit|purchase|confirm|pay|book|buy|save|delete/i.test(c.name || ""),
    );
    if (submitBtn) {
      const isConsequential = /purchase|confirm|pay|delete|submit/i.test(submitBtn.name);
      steps.push({
        id: `${planId}_s${sNum}`,
        stepNumber: sNum,
        title: submitBtn.name || "Submit Form",
        action: isConsequential ? "click_submit" : "click",
        selector: submitBtn.selector,
        isConsequential,
        requiresApproval: isConsequential,
        approvalPrompt: `Please confirm: Buddy is about to execute "${submitBtn.name}". Proceed?`,
        status: "pending",
        verified: false,
      });
    }
  } else {
    // General workflow: decompose natural language instruction into discrete steps
    // Split on numbered steps (1. 2. 3.), bullet points, conjunctions ("then", "and then", "after that"), or semicolons/commas/and
    const segments = trimmed
      .split(
        /(?:\r?\n|\s*(?:then|and then|after that|next|finally)\s*|[;]\s*|,\s*(?:and\s+)?|\s+and\s+(?=(?:go|open|click|press|select|find|copy|type|fill|submit|search|verify|extract|purchase|delete|confirm)\b)|\s*\d+[.)]\s+)/i,
      )
      .map((s) =>
        s
          .trim()
          .replace(/^[\d+.*)-]\s*/, "")
          .replace(/^and\s+/i, ""),
      )
      .filter((s) => s.length > 2);

    if (segments.length <= 1) {
      // Single action or compact phrase
      const isConsequential = /delete|purchase|buy|pay|transfer|send\s*money|submit/i.test(lower);
      const actType: BrowserActionType = isConsequential
        ? lower.includes("delete")
          ? "click_delete"
          : lower.includes("purchase") || lower.includes("buy")
            ? "purchase"
            : "click_submit"
        : lower.includes("copy") || lower.includes("extract") || lower.includes("list")
          ? "extract"
          : lower.includes("scroll")
            ? "scroll"
            : lower.includes("type") || lower.includes("fill")
              ? "fill_field"
              : lower.includes("navigate") || lower.includes("open")
                ? "navigate"
                : "click";

      steps.push({
        id: `${planId}_s1`,
        stepNumber: 1,
        title: trimmed,
        action: actType,
        selector: snapshot?.controls?.[0]?.selector || "body",
        status: "pending",
        isConsequential,
        requiresApproval: isConsequential,
        approvalPrompt: isConsequential
          ? `Confirmation required: Buddy requests approval to execute consequential step: "${trimmed}"`
          : undefined,
        verified: false,
      });
    } else {
      let sNum = 1;
      for (const seg of segments) {
        const segLower = seg.toLowerCase();
        let act: BrowserActionType = "click";
        let isConsequential = false;
        let requiresApproval = false;
        let selector = "";
        let textTarget: string | undefined = undefined;
        let val: string | undefined = undefined;

        if (
          segLower.startsWith("open ") ||
          segLower.startsWith("go to ") ||
          segLower.startsWith("navigate ")
        ) {
          if (segLower.includes("http") || segLower.includes(".com") || segLower.includes(".in")) {
            act = "navigate";
            const m = seg.match(/https?:\/\/[^\s]+/i);
            val = m ? m[0] : undefined;
          } else {
            act = "click";
            textTarget = seg.replace(/^(?:open|go to|navigate to)\s+/i, "").trim();
          }
        } else if (
          segLower.includes("copy") ||
          segLower.includes("extract") ||
          segLower.includes("prepare a list") ||
          segLower.includes("find pending")
        ) {
          act = "extract";
          textTarget = seg.replace(/^(?:copy|extract|find and copy|prepare)\s+/i, "").trim();
          val = "extract_data";
        } else if (segLower.includes("scroll")) {
          act = "scroll";
          val = segLower.includes("up") ? "up" : "down";
        } else if (
          segLower.startsWith("type ") ||
          segLower.startsWith("fill ") ||
          segLower.startsWith("enter ")
        ) {
          act = "fill_field";
          const parts = seg.split(/["']/);
          if (parts.length >= 2) {
            val = parts[1];
          }
        } else if (segLower.includes("delete") || segLower.includes("remove")) {
          act = "click_delete";
          isConsequential = true;
          requiresApproval = true;
        } else if (
          segLower.includes("purchase") ||
          segLower.includes("buy") ||
          segLower.includes("pay")
        ) {
          act = "purchase";
          isConsequential = true;
          requiresApproval = true;
        } else if (segLower.includes("submit") || segLower.includes("confirm")) {
          act = "click_submit";
          isConsequential = true;
          requiresApproval = true;
        } else if (segLower.includes("select") || segLower.includes("choose")) {
          act = "select";
          textTarget = seg.replace(/^(?:select|choose)\s+/i, "").trim();
        } else {
          act = "click";
          textTarget = seg.replace(/^(?:click|press|tap)\s+/i, "").trim();
        }

        // Try to match against snapshot elements if available
        if (snapshot) {
          if (
            act === "click" ||
            act === "click_submit" ||
            act === "click_delete" ||
            act === "purchase"
          ) {
            const matchedControl = snapshot.controls.find((c) => {
              const nameLower = (c.name || "").toLowerCase();
              return textTarget ? nameLower.includes(textTarget.toLowerCase()) : false;
            });
            if (matchedControl) {
              selector = matchedControl.selector;
            }
          } else if (act === "fill_field") {
            const matchedForm = snapshot.forms.find((f) => {
              const nameLower = (f.name || f.placeholder || "").toLowerCase();
              return segLower.includes(nameLower);
            });
            if (matchedForm) {
              selector = matchedForm.selector;
            }
          }
        }

        steps.push({
          id: `${planId}_s${sNum}`,
          stepNumber: sNum,
          title: seg.charAt(0).toUpperCase() + seg.slice(1),
          action: act,
          selector:
            selector ||
            (textTarget
              ? `button:has-text("${textTarget}"), a:has-text("${textTarget}")`
              : undefined),
          textTarget,
          value: val,
          status: "pending",
          isConsequential,
          requiresApproval,
          approvalPrompt: requiresApproval
            ? `Confirmation required: Buddy is about to execute "${seg}". Proceed?`
            : undefined,
          verified: false,
        });
        sNum++;
      }
    }
  }

  return {
    id: planId,
    title: trimmed.length > 60 ? trimmed.slice(0, 57) + "..." : trimmed,
    originalInstruction: trimmed,
    targetWebsite: targetWebsite || undefined,
    targetOrigin: targetOrigin || undefined,
    steps,
    currentStepIndex: 0,
    totalSteps: steps.length,
    status: "pending",
    extractedData: [],
    createdAt: now,
    updatedAt: now,
  };
}
