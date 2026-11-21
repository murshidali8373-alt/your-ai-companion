/**
 * SELF-HEALING AI DEBUGGING, CLASSIFICATION, LOCAL RECOVERY, KNOWLEDGE BASE & CREDIT OPTIMIZER
 * (AI Buddy 2.0 — Part B & Part C Shared Core)
 *
 * Shared pure TypeScript module usable across backend routes, orchestrator, and tests.
 * Enforces:
 * - Accurate error attribution (never blames AI Buddy for website/network/provider issues)
 * - Strict redaction of API keys, tokens, passwords, OTPs, Aadhaar/PAN, and cookies
 * - Priority ladder: local detection -> deterministic recovery -> known rules -> KB cache -> dedupe -> AI
 * - Granular approval state machine (diagnose_only vs show_affected_code vs prepare_repair vs apply vs PR)
 */

import type { SpecialistAgentId } from "./task-context";

export type MonitoredComponent =
  | "background_sw"
  | "side_panel"
  | "content_script"
  | "browser_automation"
  | "agent_execution"
  | "api_communication"
  | "ai_provider"
  | "task_orchestration"
  | "form_filling"
  | "dom_interaction"
  | "file_operations"
  | "downloads"
  | "runtime_exception"
  | "unhandled_rejection"
  | "build_and_test";

export type ErrorAttribution =
  | "ai_buddy_code"
  | "website_behavior"
  | "network"
  | "api_provider"
  | "authentication"
  | "permissions"
  | "invalid_input"
  | "unsupported_operation"
  | "temporary_browser_failure";

export type ApprovalActionType =
  | "diagnose_only"
  | "show_affected_code"
  | "prepare_repair"
  | "apply_repair_and_test"
  | "create_github_pr"
  | "cancel";

export interface DiagnosticReportInput {
  errorMessage: string;
  errorType?: string;
  stackTrace?: string;
  file?: string;
  line?: number;
  column?: number;
  relatedFunction?: string;
  component: MonitoredComponent;
  agentId?: SpecialistAgentId | string;
  taskId?: string;
  currentOperation?: string;
  recentHistory?: string[];
  relevantLogs?: string[];
  extensionVersion?: string;
  recentCodeChanges?: string[];
  reproductionSteps?: string[];
  pageUrl?: string;
  capabilityId?: string;
  httpStatus?: number;
}

export interface SanitizedDiagnosticReport {
  id: string;
  fingerprint: string;
  timestamp: string;
  component: MonitoredComponent;
  attribution: ErrorAttribution;
  confidence: number;
  attributionReason: string;
  errorMessage: string;
  errorType: string;
  stackTrace?: string;
  file?: string;
  line?: number;
  column?: number;
  relatedFunction?: string;
  agentId?: string;
  taskId?: string;
  currentOperation?: string;
  recentHistory: string[];
  relevantLogs: string[];
  extensionVersion: string;
  recentCodeChanges: string[];
  reproductionSteps: string[];
  pageUrl?: string;
  capabilityId?: string;
  httpStatus?: number;
  redactionCount: number;
}

export interface LocalRecoveryAction {
  strategy:
    | "retry_with_backoff"
    | "refresh_snapshot_and_relocate"
    | "wait_for_page_settle"
    | "reinject_bridge_script"
    | "reconnect_backend_host"
    | "restore_last_checkpoint"
    | "prompt_user_auth"
    | "prompt_permission_upgrade"
    | "report_website_change"
    | "escalate_to_ai_diagnosis"
    | "no_recovery_possible";
  canAutoExecute: boolean;
  maxAttempts: number;
  waitMs?: number;
  description: string;
  shouldCallAi: boolean;
}

export interface KnowledgeBaseEntry {
  id: string;
  fingerprint: string;
  category: MonitoredComponent;
  attribution: ErrorAttribution;
  rootCause: string;
  affectedFiles: string[];
  repairStrategy: string;
  testResults?: {
    passed: boolean;
    summary: string;
  };
  extensionVersion: string;
  status: "verified" | "superseded" | "rolled_back" | "draft";
  requiresRevalidation: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreditBudgetConfig {
  maxAiCallsPerHour: number;
  maxEstimatedCostUsdPerDay: number;
  maxDiagnosticCharsForAi: number;
  dedupeCooldownMs: number;
}

export interface CreditUsageSnapshot {
  aiCallsThisHour: number;
  estimatedTokensUsedToday: number;
  estimatedCostUsdToday: number;
  localRecoveriesCount: number;
  kbCacheHitsCount: number;
  suppressedDuplicatesCount: number;
}

export const DEFAULT_CREDIT_BUDGET: CreditBudgetConfig = {
  maxAiCallsPerHour: 12,
  maxEstimatedCostUsdPerDay: 0.75,
  maxDiagnosticCharsForAi: 4500,
  dedupeCooldownMs: 60_000,
};

/**
 * Redacts secrets, API keys, passwords, OTPs, tokens, cookies, and Indian PII (Aadhaar/PAN).
 */
export function redactSensitiveText(raw: string): { text: string; redactions: number } {
  let out = String(raw || "");
  let redactions = 0;

  const replaceCount = (
    re: RegExp,
    replacement: string | ((m: string, ...g: string[]) => string),
  ) => {
    out = out.replace(re, (...args) => {
      redactions++;
      if (typeof replacement === "function") {
        return replacement(args[0] as string, ...(args.slice(1) as string[]));
      }
      return replacement;
    });
  };

  // Bearer / Authorization headers & JWTs
  replaceCount(/\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi, "Bearer [REDACTED_TOKEN]");
  replaceCount(
    /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{8,}\b/g,
    "[REDACTED_JWT]",
  );

  // Known provider key prefixes (Google AIza, OpenAI/OpenRouter sk-, GitHub ghp_/github_pat_/gho_, HuggingFace hf_, Groq gsk_)
  replaceCount(/\bAIza[0-9A-Za-z_-]{20,}\b/g, "[REDACTED_GEMINI_KEY]");
  replaceCount(/\bsk-(?:proj-|or-v1-)?[0-9A-Za-z_-]{16,}\b/g, "[REDACTED_API_KEY]");
  replaceCount(/\b(?:ghp|gho|ghu|ghs)_[0-9A-Za-z]{20,}\b/g, "[REDACTED_GITHUB_TOKEN]");
  replaceCount(/\bgithub_pat_[0-9A-Za-z_]{20,}\b/g, "[REDACTED_GITHUB_TOKEN]");
  replaceCount(/\bgsk_[0-9A-Za-z]{20,}\b/g, "[REDACTED_GROQ_KEY]");
  replaceCount(/\bhf_[0-9A-Za-z]{20,}\b/g, "[REDACTED_HF_KEY]");

  // Key=value / JSON secrets
  replaceCount(
    /((?:api[_-]?key|secret|password|passwd|pwd|otp|cvv|cvc|pin|token|access[_-]?token|refresh[_-]?token|session[_-]?id|cookie|authorization|service[_-]?role[_-]?key)\s*[:=]\s*["']?)([^\s"',;}\]]{2,})(["']?)/gi,
    (_full, prefix, _val, suffix) => `${prefix}[REDACTED]${suffix || ""}`,
  );

  // Explicit env var assignments
  replaceCount(
    /\b([A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*)\s*=\s*([^\s\n]+)/g,
    (_full, key) => `${key}=[REDACTED]`,
  );

  // Strip query string auth params from URLs
  replaceCount(
    /([?&](?:token|key|apiKey|code|secret|auth|session|access_token)=)([^&\s#]+)/gi,
    (_full, prefix) => `${prefix}[REDACTED]`,
  );

  // Indian PAN & Aadhaar patterns
  replaceCount(/\b[A-Z]{5}[0-9]{4}[A-Z]\b/g, "[REDACTED_PAN]");
  replaceCount(/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, (match) => {
    const digits = match.replace(/\D/g, "");
    return digits.length === 12 ? "[REDACTED_AADHAAR]" : match;
  });

  return { text: out, redactions };
}

/**
 * Extracts file path, line, and function from a JS/TS stack trace or error message.
 */
export function parseStackLocation(stackTrace?: string): {
  file?: string;
  line?: number;
  column?: number;
  relatedFunction?: string;
} {
  if (!stackTrace) return {};
  const lines = stackTrace.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    // Format: at fnName (path/file.ts:123:45) or at path/file.ts:123:45
    const fnMatch = line.match(
      /^at\s+([A-Za-z0-9_.$<>]+)\s+\((?:chrome-extension:\/\/[^/]+\/|file:\/\/\/|\/app\/applet\/)?([^():\s]+\.(?:ts|tsx|js|mjs|cjs)):(\d+):(\d+)\)/,
    );
    if (fnMatch) {
      return {
        relatedFunction: fnMatch[1],
        file: fnMatch[2]!.replace(/^\/+/, ""),
        line: Number(fnMatch[3]),
        column: Number(fnMatch[4]),
      };
    }
    const bareMatch = line.match(
      /^at\s+(?:chrome-extension:\/\/[^/]+\/|file:\/\/\/|\/app\/applet\/)?([^():\s]+\.(?:ts|tsx|js|mjs|cjs)):(\d+):(\d+)/,
    );
    if (bareMatch) {
      return {
        file: bareMatch[1]!.replace(/^\/+/, ""),
        line: Number(bareMatch[2]),
        column: Number(bareMatch[3]),
      };
    }
  }
  return {};
}

/**
 * Computes stable normalized fingerprint so recurring identical errors deduplicate reliably.
 */
export function computeErrorFingerprint(input: {
  component: MonitoredComponent;
  errorMessage: string;
  file?: string;
  relatedFunction?: string;
}): string {
  const normMsg = String(input.errorMessage || "")
    .toLowerCase()
    .replace(/\b\d+\b/g, "#")
    .replace(/https?:\/\/[^\s]+/g, "<url>")
    .replace(/["'][^"']{1,60}["']/g, '"*"')
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
  const raw = `${input.component}|${input.file || "unknown"}|${input.relatedFunction || "anon"}|${normMsg}`;
  let hash = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `fp_${(hash >>> 0).toString(16)}`;
}

/**
 * Classifies root cause attribution honestly without blaming extension code for site/network/provider issues.
 */
export function classifyRuntimeError(input: DiagnosticReportInput): {
  attribution: ErrorAttribution;
  confidence: number;
  reason: string;
} {
  const msg = `${input.errorMessage || ""} ${input.errorType || ""}`.toLowerCase();
  const status = input.httpStatus;

  // 1. Permissions / Restricted URLs / Safety blocks
  if (
    /restricted browser page|permission level|cannot automate|password.*cannot be automated|requires explicit.*approval|missing permission|host permission/i.test(
      msg,
    )
  ) {
    return {
      attribution: "permissions",
      confidence: 0.94,
      reason:
        "Blocked by AI Buddy permission ladder, restricted browser scheme, or sensitive-field security boundary.",
    };
  }

  // 2. Unsupported / Planned capabilities
  if (
    /currently planned|not supported yet|unsupported operation|unknown browser action/i.test(msg)
  ) {
    return {
      attribution: "unsupported_operation",
      confidence: 0.92,
      reason: "Requested operation maps to a planned or unsupported capability.",
    };
  }

  // 3. Authentication (user session / GitHub / service auth)
  if (
    status === 401 ||
    /unauthorized|invalid bearer|session expired|not signed in|sign in required|bad credentials/i.test(
      msg,
    )
  ) {
    return {
      attribution: "authentication",
      confidence: 0.91,
      reason: "Authentication or user session token is missing, invalid, or expired.",
    };
  }

  // 4. API Provider issues (Gemini/OpenAI/Groq rate limit, key, quota, outage)
  if (
    input.component === "ai_provider" ||
    /gemini|openai|groq|openrouter|rate limit|quota|insufficient credits|provider unavailable|not configured on the server|invalid api key/i.test(
      msg,
    ) ||
    status === 429 ||
    status === 402
  ) {
    return {
      attribution: "api_provider",
      confidence: 0.9,
      reason:
        "Failure originated from external AI model provider credentials, quota, or availability.",
    };
  }

  // 5. Network failures
  if (
    /failed to fetch|networkerror|err_network|econnrefused|enotfound|etimedout|aborterror|network timeout|net::err_/i.test(
      msg,
    ) ||
    status === 502 ||
    status === 503 ||
    status === 504
  ) {
    return {
      attribution: "network",
      confidence: 0.89,
      reason: "Connectivity failure or timeout while communicating with remote host/backend.",
    };
  }

  // 6. Temporary browser runtime hiccups (SW sleep, closed tab, bfcache port disconnect)
  if (
    /receiving end does not exist|could not establish connection|message port closed|no tab with id|tab was closed|frame was removed|extension context invalidated/i.test(
      msg,
    )
  ) {
    return {
      attribution: "temporary_browser_failure",
      confidence: 0.91,
      reason: "Transient Chromium tab/frame lifecycle or service-worker message port interruption.",
    };
  }

  // 7. Website behavior / layout shift / external site validation
  if (
    (input.component === "dom_interaction" ||
      input.component === "form_filling" ||
      input.component === "browser_automation") &&
    /element not found|no matching.*found|element is obstructed|hidden input|cross-origin iframe|captcha|otp required|validation error on page/i.test(
      msg,
    )
  ) {
    return {
      attribution: "website_behavior",
      confidence: 0.86,
      reason:
        "Target website DOM structure, cross-origin boundary, CAPTCHA/OTP, or site validation blocked interaction.",
    };
  }

  // 8. Invalid user/caller input
  if (
    status === 400 ||
    /malformed|missing.*value|which field|kis field|cannot parse.*empty|invalid url structure/i.test(
      msg,
    )
  ) {
    return {
      attribution: "invalid_input",
      confidence: 0.88,
      reason: "User instruction or request payload was incomplete or failed input validation.",
    };
  }

  // 9. AI Buddy code defects (SyntaxError, TypeError, ReferenceError, build/test failure, unhandled bug)
  if (
    input.component === "build_and_test" ||
    /typeerror|referenceerror|syntaxerror|is not a function|cannot read properties of|maximum call stack|assertionerror|invalid selector/i.test(
      msg,
    ) ||
    Boolean(input.file && /^(src|extension|tests)\//.test(input.file))
  ) {
    return {
      attribution: "ai_buddy_code",
      confidence: 0.9,
      reason: "Internal code exception or selector/logic defect detected inside AI Buddy modules.",
    };
  }

  return {
    attribution:
      input.component === "dom_interaction" || input.component === "form_filling"
        ? "website_behavior"
        : "ai_buddy_code",
    confidence: 0.65,
    reason:
      "Classified from execution component context; further diagnosis recommended if deterministic recovery fails.",
  };
}

/**
 * Produces a fully redacted, normalized SanitizedDiagnosticReport ready for logs, KB, or AI.
 */
export function sanitizeDiagnosticReport(
  input: DiagnosticReportInput,
  extensionVersion = "0.1.0",
): SanitizedDiagnosticReport {
  let redactionCount = 0;
  const clean = (s?: string): string | undefined => {
    if (!s) return undefined;
    const res = redactSensitiveText(s);
    redactionCount += res.redactions;
    return res.text;
  };

  const stackLoc = parseStackLocation(input.stackTrace);
  const file = input.file || stackLoc.file;
  const line = input.line ?? stackLoc.line;
  const column = input.column ?? stackLoc.column;
  const relatedFunction = input.relatedFunction || stackLoc.relatedFunction;

  const cleanMsg = clean(input.errorMessage) || "Unknown error";
  const cleanStack = clean(input.stackTrace);
  const cleanPageUrl = clean(input.pageUrl);

  const cleanHistory = (input.recentHistory || []).slice(-10).map((h) => clean(h) || "");
  const cleanLogs = (input.relevantLogs || []).slice(-20).map((l) => clean(l) || "");
  const cleanChanges = (input.recentCodeChanges || []).slice(-10).map((c) => clean(c) || "");
  const cleanRepro = (input.reproductionSteps || []).slice(-10).map((r) => clean(r) || "");

  const classification = classifyRuntimeError({
    ...input,
    errorMessage: cleanMsg,
    file,
  });

  const fingerprint = computeErrorFingerprint({
    component: input.component,
    errorMessage: cleanMsg,
    file,
    relatedFunction,
  });

  return {
    id: `diag_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    fingerprint,
    timestamp: new Date().toISOString(),
    component: input.component,
    attribution: classification.attribution,
    confidence: classification.confidence,
    attributionReason: classification.reason,
    errorMessage: cleanMsg.slice(0, 1200),
    errorType: input.errorType || "Error",
    stackTrace: cleanStack ? cleanStack.slice(0, 3000) : undefined,
    file,
    line,
    column,
    relatedFunction,
    agentId: input.agentId,
    taskId: input.taskId,
    currentOperation: input.currentOperation,
    recentHistory: cleanHistory,
    relevantLogs: cleanLogs,
    extensionVersion: input.extensionVersion || extensionVersion,
    recentCodeChanges: cleanChanges,
    reproductionSteps: cleanRepro,
    pageUrl: cleanPageUrl,
    capabilityId: input.capabilityId,
    httpStatus: input.httpStatus,
    redactionCount,
  };
}

/**
 * Priority 1 & 2 deterministic local recovery BEFORE ever spending AI credits.
 */
export function planDeterministicRecovery(
  report: SanitizedDiagnosticReport,
  attemptSoFar = 0,
): LocalRecoveryAction {
  if (report.attribution === "permissions") {
    return {
      strategy: "prompt_permission_upgrade",
      canAutoExecute: false,
      maxAttempts: 0,
      description:
        "Respect permission boundary and guide the user to adjust permission settings or operate manually.",
      shouldCallAi: false,
    };
  }

  if (report.attribution === "authentication") {
    return {
      strategy: "prompt_user_auth",
      canAutoExecute: false,
      maxAttempts: 0,
      description: "Prompt user to reconnect session or configure valid credentials.",
      shouldCallAi: false,
    };
  }

  if (report.attribution === "temporary_browser_failure" && attemptSoFar < 2) {
    if (/receiving end does not exist|could not establish connection/i.test(report.errorMessage)) {
      return {
        strategy: "reinject_bridge_script",
        canAutoExecute: true,
        maxAttempts: 2,
        waitMs: 150,
        description: "Re-inject content bridge script and retry tab IPC.",
        shouldCallAi: false,
      };
    }
    return {
      strategy: "restore_last_checkpoint",
      canAutoExecute: true,
      maxAttempts: 1,
      waitMs: 300,
      description: "Restore task state from last verified checkpoint.",
      shouldCallAi: false,
    };
  }

  if (report.attribution === "website_behavior") {
    if (attemptSoFar < 1) {
      return {
        strategy: "refresh_snapshot_and_relocate",
        canAutoExecute: true,
        maxAttempts: 1,
        waitMs: 450,
        description:
          "Wait for DOM settle, take fresh snapshot, and retry alternate semantic locators without modifying source code.",
        shouldCallAi: false,
      };
    }
    return {
      strategy: "report_website_change",
      canAutoExecute: false,
      maxAttempts: 0,
      description:
        "Website layout/CAPTCHA/validation blocked action — report honestly to user without modifying extension code.",
      shouldCallAi: false,
    };
  }

  if (report.attribution === "network" && attemptSoFar < 2) {
    const isBackend = report.component === "api_communication";
    return {
      strategy: isBackend ? "reconnect_backend_host" : "retry_with_backoff",
      canAutoExecute: true,
      maxAttempts: 2,
      waitMs: 600 * (attemptSoFar + 1),
      description: isBackend
        ? "Re-probe active backend origin health and reconnect."
        : "Retry transient network request with exponential backoff.",
      shouldCallAi: false,
    };
  }

  if (report.attribution === "invalid_input" || report.attribution === "unsupported_operation") {
    return {
      strategy: "no_recovery_possible",
      canAutoExecute: false,
      maxAttempts: 0,
      description: report.attributionReason,
      shouldCallAi: false,
    };
  }

  if (report.attribution === "api_provider") {
    return {
      strategy: "no_recovery_possible",
      canAutoExecute: false,
      maxAttempts: 0,
      description:
        "Report provider issue honestly; respect user's strict provider selection without silent AI switches.",
      shouldCallAi: false,
    };
  }

  // Only genuine unresolved AI Buddy code / build bugs escalate to KB lookup or selected AI
  return {
    strategy: "escalate_to_ai_diagnosis",
    canAutoExecute: false,
    maxAttempts: 1,
    description:
      "Unresolved internal defect — check Repair Knowledge Base first, then consult selected AI provider with approval.",
    shouldCallAi: true,
  };
}

/**
 * Knowledge Base + Error Deduplication + Credit Budget Manager.
 */
export class SelfHealingKnowledgeAndBudget {
  private readonly kb: KnowledgeBaseEntry[] = [];
  private readonly recentFingerprints = new Map<
    string,
    { lastSeenMs: number; count: number; cachedReportId: string }
  >();
  private aiCallTimestamps: number[] = [];
  private estimatedTokensToday = 0;
  private estimatedCostUsdToday = 0;
  private localRecoveriesCount = 0;
  private kbCacheHitsCount = 0;
  private suppressedDuplicatesCount = 0;

  constructor(private readonly budget: CreditBudgetConfig = DEFAULT_CREDIT_BUDGET) {}

  seedKnowledgeBase(entries: KnowledgeBaseEntry[]): void {
    for (const e of entries) {
      if (!this.kb.some((existing) => existing.id === e.id)) {
        this.kb.push(e);
      }
    }
  }

  /**
   * Checks duplicate suppression within cooldown window.
   */
  recordOccurrence(
    report: SanitizedDiagnosticReport,
    nowMs = Date.now(),
  ): {
    isDuplicate: boolean;
    occurrenceCount: number;
    suppressedReason?: string;
  } {
    const prev = this.recentFingerprints.get(report.fingerprint);
    if (prev && nowMs - prev.lastSeenMs < this.budget.dedupeCooldownMs) {
      prev.count += 1;
      prev.lastSeenMs = nowMs;
      this.suppressedDuplicatesCount += 1;
      return {
        isDuplicate: true,
        occurrenceCount: prev.count,
        suppressedReason: `Duplicate error suppressed within ${Math.round(this.budget.dedupeCooldownMs / 1000)}s cooldown (seen ${prev.count}x).`,
      };
    }
    const nextCount = (prev?.count ?? 0) + 1;
    this.recentFingerprints.set(report.fingerprint, {
      lastSeenMs: nowMs,
      count: nextCount,
      cachedReportId: report.id,
    });
    return { isDuplicate: false, occurrenceCount: nextCount };
  }

  recordLocalRecovery(): void {
    this.localRecoveriesCount += 1;
  }

  /**
   * Searches Knowledge Base for compatible previous verified repairs.
   * Always marks matches as requiresRevalidation=true so stale patches are never blindly applied.
   */
  findMatchingRepairs(
    fingerprint: string,
    currentExtensionVersion: string,
  ): Array<KnowledgeBaseEntry & { versionCompatible: boolean }> {
    const matches = this.kb
      .filter((e) => e.fingerprint === fingerprint && e.status === "verified")
      .map((e) => ({
        ...e,
        requiresRevalidation: true,
        versionCompatible: e.extensionVersion === currentExtensionVersion,
      }));
    if (matches.length > 0) {
      this.kbCacheHitsCount += 1;
    }
    return matches;
  }

  searchKnowledgeBase(query: string): KnowledgeBaseEntry[] {
    const q = query.trim().toLowerCase();
    if (!q) return [...this.kb];
    return this.kb.filter(
      (e) =>
        e.fingerprint.toLowerCase().includes(q) ||
        e.rootCause.toLowerCase().includes(q) ||
        e.repairStrategy.toLowerCase().includes(q) ||
        e.affectedFiles.some((f) => f.toLowerCase().includes(q)),
    );
  }

  addRepairRecord(entry: KnowledgeBaseEntry): void {
    const idx = this.kb.findIndex((e) => e.id === entry.id);
    if (idx >= 0) {
      this.kb[idx] = entry;
    } else {
      this.kb.unshift(entry);
    }
  }

  listKnowledgeBase(): KnowledgeBaseEntry[] {
    return [...this.kb];
  }

  /**
   * Enforces configurable AI debugging hourly & daily budget limits.
   */
  canSpendAiCall(nowMs = Date.now()): { allowed: boolean; reason?: string } {
    const oneHourAgo = nowMs - 3_600_000;
    this.aiCallTimestamps = this.aiCallTimestamps.filter((ts) => ts >= oneHourAgo);

    if (this.aiCallTimestamps.length >= this.budget.maxAiCallsPerHour) {
      return {
        allowed: false,
        reason: `Hourly AI debugging call limit (${this.budget.maxAiCallsPerHour}/hr) reached. Use local recovery or inspect KB.`,
      };
    }
    if (this.estimatedCostUsdToday >= this.budget.maxEstimatedCostUsdPerDay) {
      return {
        allowed: false,
        reason: `Daily AI debugging budget ($${this.budget.maxEstimatedCostUsdPerDay.toFixed(2)}) reached.`,
      };
    }
    return { allowed: true };
  }

  recordAiUsage(tokensUsed: number, estimatedUsd: number, nowMs = Date.now()): void {
    this.aiCallTimestamps.push(nowMs);
    this.estimatedTokensToday += Math.max(0, Math.round(tokensUsed));
    this.estimatedCostUsdToday += Math.max(0, estimatedUsd);
  }

  getUsageSnapshot(nowMs = Date.now()): CreditUsageSnapshot {
    const oneHourAgo = nowMs - 3_600_000;
    const recentCalls = this.aiCallTimestamps.filter((ts) => ts >= oneHourAgo).length;
    return {
      aiCallsThisHour: recentCalls,
      estimatedTokensUsedToday: this.estimatedTokensToday,
      estimatedCostUsdToday: Number(this.estimatedCostUsdToday.toFixed(4)),
      localRecoveriesCount: this.localRecoveriesCount,
      kbCacheHitsCount: this.kbCacheHitsCount,
      suppressedDuplicatesCount: this.suppressedDuplicatesCount,
    };
  }
}

/**
 * Granular approval enforcement: diagnosing NEVER grants permission to modify files or push PRs.
 */
export function verifySelfHealApproval(
  requestedOperation:
    "diagnose" | "show_code" | "prepare_repair" | "apply_repair_and_test" | "create_github_pr",
  grantedAction?: ApprovalActionType | null,
): { allowed: boolean; reason?: string } {
  if (requestedOperation === "diagnose") {
    if (grantedAction === "cancel") {
      return { allowed: false, reason: "Diagnosis cancelled by user." };
    }
    return { allowed: true };
  }
  if (requestedOperation === "show_code") {
    if (
      grantedAction === "show_affected_code" ||
      grantedAction === "prepare_repair" ||
      grantedAction === "apply_repair_and_test"
    ) {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason:
        "Explicit 'show_affected_code' approval is required before reading repository source code.",
    };
  }
  if (requestedOperation === "prepare_repair") {
    if (grantedAction === "prepare_repair" || grantedAction === "apply_repair_and_test") {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: "Explicit 'prepare_repair' approval is required before generating a patch preview.",
    };
  }
  if (requestedOperation === "apply_repair_and_test") {
    if (grantedAction === "apply_repair_and_test") {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason:
        "Permission to diagnose does not grant permission to modify code. Explicit 'apply_repair_and_test' approval is required.",
    };
  }
  if (requestedOperation === "create_github_pr") {
    if (grantedAction === "create_github_pr") {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason:
        "Explicit 'create_github_pr' approval is required before pushing a branch or opening a GitHub Pull Request.",
    };
  }
  return { allowed: false, reason: "Unknown self-healing operation." };
}
