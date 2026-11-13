export const COMPANION_EMOTION_STATES = [
  "idle",
  "happy",
  "excited",
  "thinking",
  "pointing",
  "talking",
  "listening",
  "confused",
  "concerned",
  "privacy",
  "success",
  "error",
] as const;

export type CompanionEmotionState = (typeof COMPANION_EMOTION_STATES)[number];

export interface PrivacyDetectionInput {
  userText?: string | null | undefined;
  activeFieldLabel?: string | null | undefined;
  activeFieldType?: string | null | undefined;
  actionTarget?: string | null | undefined;
  pageTitle?: string | null | undefined;
  pageHasPasswordFocused?: boolean | undefined;
}

export interface PrivacyDetectionResult {
  isPrivacy: boolean;
  reason:
    "explicit_request" | "sensitive_field" | "sensitive_prompt" | "payment_or_identity" | null;
}

export interface AutoEmotionContext extends PrivacyDetectionInput {
  event?:
    | "idle"
    | "listening"
    | "thinking"
    | "locating"
    | "located"
    | "pointing"
    | "clicking"
    | "filling"
    | "working"
    | "talking"
    | "speech_end"
    | "task_complete"
    | "error"
    | "clarify"
    | "praise"
    | "privacy"
    | undefined;
  verified?: boolean | undefined;
  hasError?: boolean | undefined;
  isSpeaking?: boolean | undefined;
  isListening?: boolean | undefined;
}

const EXPLICIT_PRIVACY_RE =
  /\b(?:privacy(?:\s+mode)?|look\s+away|turn\s+away|close\s+(?:your\s+)?eyes|hide\s+(?:your\s+)?eyes|don'?t\s+look|do\s+not\s+look|mat\s+dekho|nazar\s+hatao|aankh(?:ein|en)?\s+band|muh\s+ghuma)\b/i;

const SENSITIVE_FIELD_RE =
  /\b(?:password|passcode|passphrase|pin\s*(?:code|number)?|otp|one[\s-]*time|cvv|cvc|security\s*code|card\s*(?:number|no|num)|credit\s*card|debit\s*card|atm\s*pin|aadhaar|aadhar|pan\s*(?:card|number|no)|bank\s*account|account\s*number|ifsc|routing\s*number|secret\s*key|api\s*key|private\s*key|ssn|social\s*security)\b/i;

const POSITIVE_NEWS_RE =
  /\b(?:awesome|great\s+job|well\s+done|thank\s*you|thanks|shukriya|dhanyavaad|bahut\s+badiya|mast|shabash|yay|congrats|approved|order\s+placed|payment\s+received)\b/i;

/**
 * Normalizes any emotion/rig string (from TalkingBuddyState, BuddyEmotion,
 * backend replies, or internal events) to one of the 12 core 3D companion states.
 */
export function normalizeCompanionState(raw?: string | null): CompanionEmotionState {
  const key = String(raw || "idle")
    .trim()
    .toLowerCase();

  switch (key) {
    case "happy":
    case "laughing":
    case "laugh":
    case "giggle":
    case "waving":
    case "wave":
      return "happy";
    case "excited":
    case "celebrate":
      return "excited";
    case "thinking":
    case "think":
    case "working":
    case "executing":
    case "task":
    case "planning":
      return "thinking";
    case "pointing":
    case "point":
      return "pointing";
    case "talking":
    case "speaking":
    case "speak":
      return "talking";
    case "listening":
    case "listen":
      return "listening";
    case "confused":
    case "curious":
      return "confused";
    case "concerned":
    case "sad":
    case "scared":
    case "permission_required":
    case "disconnected":
    case "surprised":
      return "concerned";
    case "privacy":
    case "look_away":
    case "private":
      return "privacy";
    case "success":
    case "done":
      return "success";
    case "error":
    case "failed":
      return "error";
    case "idle":
    case "neutral":
    case "sleepy":
    default:
      return "idle";
  }
}

/**
 * Detects privacy-sensitive interaction contexts without exposing or logging sensitive values.
 */
export function detectPrivacyTrigger(input: PrivacyDetectionInput): PrivacyDetectionResult {
  const userText = String(input.userText || "");
  if (EXPLICIT_PRIVACY_RE.test(userText)) {
    return { isPrivacy: true, reason: "explicit_request" };
  }

  if (input.pageHasPasswordFocused) {
    return { isPrivacy: true, reason: "sensitive_field" };
  }

  const fieldType = String(input.activeFieldType || "").toLowerCase();
  if (fieldType === "password") {
    return { isPrivacy: true, reason: "sensitive_field" };
  }

  const fieldLabel = String(input.activeFieldLabel || "");
  const actionTarget = String(input.actionTarget || "");
  if (SENSITIVE_FIELD_RE.test(fieldLabel) || SENSITIVE_FIELD_RE.test(actionTarget)) {
    return { isPrivacy: true, reason: "sensitive_field" };
  }

  if (SENSITIVE_FIELD_RE.test(userText)) {
    return { isPrivacy: true, reason: "sensitive_prompt" };
  }

  return { isPrivacy: false, reason: null };
}

/**
 * Context-aware automatic state resolver.
 * Never claims success prior to verification and automatically prioritizes privacy.
 */
export function resolveAutoCompanionState(ctx: AutoEmotionContext): CompanionEmotionState {
  const privacy = detectPrivacyTrigger(ctx);
  if (privacy.isPrivacy || ctx.event === "privacy") {
    return "privacy";
  }

  if (ctx.hasError || ctx.event === "error") {
    return "error";
  }

  switch (ctx.event) {
    case "listening":
      return "listening";
    case "thinking":
    case "locating":
    case "working":
    case "filling":
      return "thinking";
    case "located":
    case "pointing":
      return "pointing";
    case "clicking":
      return ctx.verified === false ? "concerned" : "pointing";
    case "talking":
      return "talking";
    case "speech_end":
      return ctx.verified ? "happy" : "idle";
    case "task_complete":
      return ctx.verified ? "success" : "concerned";
    case "clarify":
      return "confused";
    case "praise":
      return "excited";
    case "idle":
    default:
      if (ctx.isSpeaking) return "talking";
      if (ctx.isListening) return "listening";
      if (ctx.userText && POSITIVE_NEWS_RE.test(ctx.userText)) return "happy";
      return "idle";
  }
}

/**
 * Maps any of the 12 core companion states to the base GLB animation clip name
 * (`Idle`, `Wave`, `Point`, `Talk`) while procedural blend offsets handle nuanced expressions.
 */
export function clipNameForCompanionState(
  state: CompanionEmotionState,
): "Idle" | "Wave" | "Point" | "Talk" {
  switch (state) {
    case "pointing":
      return "Point";
    case "talking":
      return "Talk";
    case "happy":
    case "excited":
    case "success":
      return "Wave";
    default:
      return "Idle";
  }
}

/**
 * Prevents repetitive jitter by throttling rapid non-urgent state changes.
 */
export function shouldTransitionCompanionState(
  current: CompanionEmotionState,
  next: CompanionEmotionState,
  elapsedMs: number,
  priority: "low" | "normal" | "high" = "normal",
): boolean {
  if (current === next) return false;
  if (next === "privacy" || next === "error" || next === "pointing" || priority === "high") {
    return true;
  }
  if (current === "privacy" && next === "idle" && elapsedMs < 1200) {
    return false;
  }
  return elapsedMs >= 160;
}
