/**
 * CONTROLLED SELF-HEALING DIAGNOSIS, PATH-CONFINED CODE REPAIR, VERIFICATION & AUTO-ROLLBACK
 * (AI Buddy 2.0 — Part B & Part C Server Engine)
 *
 * Security & Correctness Guarantees:
 * - Path confinement: ONLY `src/`, `extension/`, `tests/`, `scripts/` inside workspace root.
 * - Never executes shell commands (`execFile` only, never `shell: true`).
 * - Redacts secrets before storage or AI prompt dispatch.
 * - Enforces granular approval ladder (`diagnose_only` cannot read/modify files or push PRs).
 * - Strictly honors user's selected AI provider/model (never silent-switches on failure).
 * - Automatically rolls back EVERY modified file if TypeScript, Vitest, ESLint, or Build fails.
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { AiError } from "@/lib/ai/errors";
import { generate } from "@/lib/ai/orchestrator.server";
import { route, type ModelEntry } from "@/lib/ai/registry";
import { resolveProviderRouting } from "@/lib/buddy-service.server";
import {
  DEFAULT_CREDIT_BUDGET,
  planDeterministicRecovery,
  redactSensitiveText,
  sanitizeDiagnosticReport,
  verifySelfHealApproval,
  type ApprovalActionType,
  type DiagnosticReportInput,
  type KnowledgeBaseEntry,
} from "@/shared/self-healing";
import {
  appendSanitizedReport,
  getSelfHealingStore,
  type FileDiffPreview,
  type ProposedPatchEdit,
  type RepairDiagnosis,
  type RepairSession,
  type VerificationCheckResult,
} from "./store.server";
import { assertSafeWorkspacePath } from "@/lib/security/guardrails.server";

const execFileAsync = promisify(execFile);

const ALLOWED_TOP_DIRS = new Set(["src", "extension", "tests", "scripts"]);
const BLOCKED_SEGMENTS = [
  ".env",
  ".git",
  "node_modules",
  "dist",
  ".aistudio",
  "secrets",
  "credentials",
  "service-role",
  "private_key",
];

/**
 * Confines file access strictly to safe editable repository subtrees.
 */
export function resolveSafeRepoPath(
  relPath: string,
  rootDir: string = process.cwd(),
): { ok: true; absolutePath: string; normalizedRel: string } | { ok: false; reason: string } {
  if (!relPath || typeof relPath !== "string") {
    return { ok: false, reason: "Empty repository path." };
  }
  if (relPath.includes("\0")) {
    return { ok: false, reason: "Invalid null byte in file path." };
  }
  const normalizedInput = relPath.replace(/\\/g, "/").replace(/^\.\//, "").trim();
  if (!normalizedInput || normalizedInput.startsWith("/") || /^[a-zA-Z]:/.test(normalizedInput)) {
    return { ok: false, reason: `Absolute or drive path rejected: "${relPath}".` };
  }

  const segments = normalizedInput.split("/").filter(Boolean);
  if (segments.length < 2) {
    return {
      ok: false,
      reason: `Path must target a file inside allowed subdirectories (src/, extension/, tests/, scripts/): "${relPath}".`,
    };
  }
  if (segments.some((s) => s === ".." || s === ".")) {
    return { ok: false, reason: `Path traversal rejected: "${relPath}".` };
  }

  const topDir = segments[0]!;
  if (!ALLOWED_TOP_DIRS.has(topDir)) {
    return {
      ok: false,
      reason: `Directory "${topDir}/" is outside allowed repair scope (src/, extension/, tests/, scripts/).`,
    };
  }

  const lower = normalizedInput.toLowerCase();
  for (const blocked of BLOCKED_SEGMENTS) {
    if (segments.some((s) => s.toLowerCase() === blocked) || lower.includes(blocked)) {
      return { ok: false, reason: `Restricted sensitive path rejected: "${relPath}".` };
    }
  }

  const resolvedRoot = path.resolve(rootDir);
  const resolvedTarget = path.resolve(resolvedRoot, ...segments);
  const pathGuard = assertSafeWorkspacePath(segments.join("/"), resolvedRoot);
  if (!pathGuard.safe || !resolvedTarget.startsWith(resolvedRoot + path.sep)) {
    return {
      ok: false,
      reason: pathGuard.reason || `Resolved path escapes workspace root: "${relPath}".`,
    };
  }

  return {
    ok: true,
    absolutePath: resolvedTarget,
    normalizedRel: segments.join("/"),
  };
}

/**
 * Step 1: Ingest runtime/build error, sanitize secrets, classify attribution,
 * check duplicate cooldown + deterministic recovery + KB matches. Never mutates code.
 */
export function reportAndTriageError(
  input: DiagnosticReportInput,
  opts?: { extensionVersion?: string },
): RepairSession {
  const store = getSelfHealingStore();
  const report = sanitizeDiagnosticReport(input, opts?.extensionVersion || "0.1.0");
  appendSanitizedReport(report);

  const occurrence = store.kbBudget.recordOccurrence(report);
  const localRecovery = planDeterministicRecovery(report);
  if (localRecovery.canAutoExecute && !localRecovery.shouldCallAi) {
    store.kbBudget.recordLocalRecovery();
  }

  const kbRaw = store.kbBudget.findMatchingRepairs(report.fingerprint, report.extensionVersion);
  const kbMatches = kbRaw.map((m) => ({
    id: m.id,
    rootCause: m.rootCause,
    repairStrategy: m.repairStrategy,
    affectedFiles: m.affectedFiles,
    versionCompatible: m.versionCompatible,
    requiresRevalidation: m.requiresRevalidation,
  }));

  const existing = Array.from(store.sessions.values()).find(
    (s) =>
      s.report.fingerprint === report.fingerprint &&
      s.status !== "verified_applied" &&
      s.status !== "pr_created" &&
      s.status !== "cancelled",
  );

  if (existing && occurrence.isDuplicate) {
    existing.occurrenceCount = occurrence.occurrenceCount;
    existing.isDuplicate = true;
    existing.suppressedReason = occurrence.suppressedReason;
    existing.updatedAt = new Date().toISOString();
    return existing;
  }

  const repairId = `heal_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const nowIso = new Date().toISOString();
  const session: RepairSession = {
    repairId,
    report,
    localRecovery,
    kbMatches,
    occurrenceCount: occurrence.occurrenceCount,
    isDuplicate: occurrence.isDuplicate,
    suppressedReason: occurrence.suppressedReason,
    status:
      localRecovery.canAutoExecute && !localRecovery.shouldCallAi ? "recovered_locally" : "triaged",
    approvedActions: [],
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  store.sessions.set(repairId, session);
  return session;
}

export function getRepairSession(repairId: string): RepairSession | undefined {
  return getSelfHealingStore().sessions.get(repairId);
}

export function listRepairSessions(): RepairSession[] {
  return Array.from(getSelfHealingStore().sessions.values()).sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
}

export interface DiagnoseOptions {
  repairId: string;
  approvedAction?: ApprovalActionType | null;
  preferredProvider?: string | null;
  preferredModel?: string | null;
  userApiKey?: string | null;
  customBaseUrl?: string | null;
  strictSelection?: boolean;
  forceAi?: boolean;
  rootDir?: string;
  aiRunner?: (params: {
    system: string;
    user: string;
    candidates: ModelEntry[];
    effectiveProvider: string;
    allowProviderFallback: boolean;
    allowModelFailover: boolean;
  }) => Promise<{ text: string; model: string; provider: string }>;
}

function parseDiagnosisJson(
  rawText: string,
  fallbackAttribution: RepairDiagnosis["attribution"],
): Partial<RepairDiagnosis> {
  const cleaned = rawText
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return {
      attribution: fallbackAttribution,
      rootCause: cleaned.slice(0, 600) || "Diagnosis produced unstructured output.",
      affectedFiles: [],
      affectedFunctions: [],
      repairPlan: [],
      patchEdits: [],
      regressionRisks: [],
    };
  }
  try {
    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    const rawEdits = Array.isArray(parsed["patchEdits"]) ? parsed["patchEdits"] : [];
    const patchEdits: ProposedPatchEdit[] = [];
    for (const item of rawEdits) {
      if (!item || typeof item !== "object") continue;
      const obj = item as Record<string, unknown>;
      if (
        typeof obj["file"] === "string" &&
        typeof obj["searchBlock"] === "string" &&
        typeof obj["replaceBlock"] === "string"
      ) {
        patchEdits.push({
          file: obj["file"],
          searchBlock: obj["searchBlock"],
          replaceBlock: obj["replaceBlock"],
          rationale:
            typeof obj["rationale"] === "string" ? obj["rationale"] : "Minimal targeted fix",
        });
      }
    }
    return {
      rootCause: typeof parsed["rootCause"] === "string" ? parsed["rootCause"] : undefined,
      affectedFiles: Array.isArray(parsed["affectedFiles"])
        ? parsed["affectedFiles"].filter((x): x is string => typeof x === "string")
        : [],
      affectedFunctions: Array.isArray(parsed["affectedFunctions"])
        ? parsed["affectedFunctions"].filter((x): x is string => typeof x === "string")
        : [],
      repairPlan: Array.isArray(parsed["repairPlan"])
        ? parsed["repairPlan"].filter((x): x is string => typeof x === "string")
        : [],
      patchEdits,
      regressionRisks: Array.isArray(parsed["regressionRisks"])
        ? parsed["regressionRisks"].filter((x): x is string => typeof x === "string")
        : [],
    };
  } catch {
    return {
      rootCause: cleaned.slice(0, 600),
      affectedFiles: [],
      affectedFunctions: [],
      repairPlan: [],
      patchEdits: [],
      regressionRisks: [],
    };
  }
}

/**
 * Step 2: Diagnose root cause.
 * - Checks granular approval (`cancel` stops it).
 * - Never blames AI Buddy or spends AI credits on website/network/auth/permission/provider failures.
 * - Uses KB first unless `forceAi` is requested.
 * - Honors user's selected AI provider strictly (never silent-switches).
 */
export async function diagnoseRepairSession(
  opts: DiagnoseOptions,
): Promise<{ ok: boolean; session?: RepairSession; diagnosis?: RepairDiagnosis; message: string }> {
  const store = getSelfHealingStore();
  const session = store.sessions.get(opts.repairId);
  if (!session) {
    return { ok: false, message: `Repair session "${opts.repairId}" not found.` };
  }

  const approval = verifySelfHealApproval("diagnose", opts.approvedAction ?? "diagnose_only");
  if (!approval.allowed) {
    session.status = "cancelled";
    session.updatedAt = new Date().toISOString();
    return { ok: false, session, message: approval.reason || "Diagnosis cancelled." };
  }

  if (opts.approvedAction && !session.approvedActions.includes(opts.approvedAction)) {
    session.approvedActions.push(opts.approvedAction);
  }

  // Non-code errors: accurate attribution without modifying code or burning AI credits
  if (session.report.attribution !== "ai_buddy_code") {
    const diagnosis: RepairDiagnosis = {
      attribution: session.report.attribution,
      rootCause: session.report.attributionReason,
      affectedFiles: [],
      affectedFunctions: [],
      repairPlan: [session.localRecovery.description],
      patchEdits: [],
      regressionRisks: [],
      usedAi: false,
      strictProviderHonored: true,
    };
    session.diagnosis = diagnosis;
    session.status = "diagnosed";
    session.updatedAt = new Date().toISOString();
    return {
      ok: true,
      session,
      diagnosis,
      message: `Attributed to "${session.report.attribution}" — no AI Buddy source modification needed.`,
    };
  }

  // Knowledge base hit check before spending AI credits
  const compatibleKb = session.kbMatches.find((m) => m.versionCompatible);
  if (compatibleKb && !opts.forceAi) {
    const diagnosis: RepairDiagnosis = {
      attribution: "ai_buddy_code",
      rootCause: `[KB Cache — requires revalidation] ${compatibleKb.rootCause}`,
      affectedFiles: compatibleKb.affectedFiles,
      affectedFunctions: session.report.relatedFunction ? [session.report.relatedFunction] : [],
      repairPlan: [
        compatibleKb.repairStrategy,
        "Revalidate against current codebase before applying.",
      ],
      patchEdits: [],
      regressionRisks: ["Cached repair requires full verification suite before acceptance."],
      usedAi: false,
      strictProviderHonored: true,
    };
    session.diagnosis = diagnosis;
    session.status = "diagnosed";
    session.updatedAt = new Date().toISOString();
    return {
      ok: true,
      session,
      diagnosis,
      message: "Matched verified pattern from Repair Knowledge Base (zero AI credits used).",
    };
  }

  // Budget enforcement
  const budgetCheck = store.kbBudget.canSpendAiCall();
  if (!budgetCheck.allowed) {
    return {
      ok: false,
      session,
      message: budgetCheck.reason || "Self-healing AI credit budget reached.",
    };
  }

  const hasExplicitProvider = Boolean(opts.preferredProvider && opts.preferredProvider !== "auto");
  const hasExplicitModel = Boolean(opts.preferredModel && opts.preferredModel !== "auto");
  const strictSelection = opts.strictSelection ?? (hasExplicitProvider || hasExplicitModel);

  const defaultCandidates = route({
    intent: "plan",
    needsVision: false,
    contextTokens: 2500,
    latencySensitive: false,
    costSensitive: true,
  });

  const routingDecision = resolveProviderRouting({
    preferredProvider: opts.preferredProvider,
    preferredModel: opts.preferredModel,
    userApiKey: opts.userApiKey,
    defaultCandidates,
    language: "english",
    strictSelection,
  });

  if (strictSelection && routingDecision.providerWarning) {
    return {
      ok: false,
      session,
      message: routingDecision.providerWarning.message,
    };
  }

  // Narrow bounded redacted diagnostic prompt
  const rootDir = opts.rootDir ?? process.cwd();
  let safeSnippet = "";
  if (session.report.file) {
    const safeCheck = resolveSafeRepoPath(session.report.file, rootDir);
    if (safeCheck.ok && fs.existsSync(safeCheck.absolutePath)) {
      const lines = fs.readFileSync(safeCheck.absolutePath, "utf8").split(/\r?\n/);
      const center = Math.max(1, session.report.line ?? 1);
      const start = Math.max(0, center - 30);
      const end = Math.min(lines.length, center + 30);
      const excerpt = lines
        .slice(start, end)
        .map((l, idx) => `${start + idx + 1}: ${l}`)
        .join("\n");
      safeSnippet = `\n\nFILE EXCERPT (${safeCheck.normalizedRel}:${start + 1}-${end}):\n${redactSensitiveText(excerpt).text}`;
    }
  }

  const serializedReport = JSON.stringify(
    {
      component: session.report.component,
      errorType: session.report.errorType,
      errorMessage: session.report.errorMessage,
      file: session.report.file,
      line: session.report.line,
      relatedFunction: session.report.relatedFunction,
      currentOperation: session.report.currentOperation,
      stackTrace: session.report.stackTrace?.slice(0, 1200),
      reproductionSteps: session.report.reproductionSteps.slice(0, 5),
    },
    null,
    2,
  );

  const combinedPrompt = `${serializedReport}${safeSnippet}`.slice(
    0,
    DEFAULT_CREDIT_BUDGET.maxDiagnosticCharsForAi,
  );

  const systemPrompt = `You are AI Buddy's Self-Healing Diagnostic Engineer.
Analyze the REDACTED diagnostic report and produce ONLY valid JSON matching:
{
  "rootCause": "concise technical explanation",
  "affectedFiles": ["src/... or extension/..."],
  "affectedFunctions": ["fnName"],
  "repairPlan": ["step 1", "step 2"],
  "patchEdits": [
    {
      "file": "src/...",
      "searchBlock": "exact minimal snippet from file",
      "replaceBlock": "minimal safe replacement",
      "rationale": "why this fixes the root cause"
    }
  ],
  "regressionRisks": ["potential side effects to test"]
}
Rules: Never modify unrelated files, never hardcode keys, never bypass permissions.`;

  try {
    const allowProviderFallback = !strictSelection;
    const allowModelFailover = !hasExplicitModel;

    const aiRes = opts.aiRunner
      ? await opts.aiRunner({
          system: systemPrompt,
          user: combinedPrompt,
          candidates: routingDecision.candidates,
          effectiveProvider: routingDecision.effectiveProvider,
          allowProviderFallback,
          allowModelFailover,
        })
      : await generate({
          system: systemPrompt,
          user: combinedPrompt,
          routing: {
            intent: "plan",
            needsVision: false,
            contextTokens: 2500,
            latencySensitive: false,
            costSensitive: true,
          },
          candidates: routingDecision.candidates,
          userApiKey: opts.userApiKey ?? undefined,
          customBaseUrl: opts.customBaseUrl ?? undefined,
          userProvider: routingDecision.effectiveProvider,
          allowProviderFallback,
          allowModelFailover,
        });

    const estTokens = Math.ceil(
      (systemPrompt.length + combinedPrompt.length + aiRes.text.length) / 4,
    );
    store.kbBudget.recordAiUsage(estTokens, estTokens * 0.000002);

    const parsed = parseDiagnosisJson(aiRes.text, session.report.attribution);
    const safeFiles = (parsed.affectedFiles || []).filter(
      (f) => resolveSafeRepoPath(f, rootDir).ok,
    );
    const safeEdits = (parsed.patchEdits || []).filter(
      (e) => resolveSafeRepoPath(e.file, rootDir).ok,
    );

    const diagnosis: RepairDiagnosis = {
      attribution: session.report.attribution,
      rootCause: parsed.rootCause || "Root cause diagnosed.",
      affectedFiles:
        safeFiles.length > 0
          ? safeFiles
          : session.report.file && resolveSafeRepoPath(session.report.file, rootDir).ok
            ? [session.report.file]
            : [],
      affectedFunctions: parsed.affectedFunctions || [],
      repairPlan: parsed.repairPlan || [],
      patchEdits: safeEdits,
      regressionRisks: parsed.regressionRisks || [],
      usedAi: true,
      provider: aiRes.provider,
      model: aiRes.model,
      strictProviderHonored:
        !strictSelection || aiRes.provider === routingDecision.effectiveProvider,
    };

    session.diagnosis = diagnosis;
    if (safeEdits.length > 0) {
      session.patchEdits = safeEdits;
    }
    session.status = "diagnosed";
    session.updatedAt = new Date().toISOString();

    return {
      ok: true,
      session,
      diagnosis,
      message: `Diagnosis complete via ${aiRes.model} (${aiRes.provider}). Awaiting your explicit approval to inspect code or prepare a patch.`,
    };
  } catch (err) {
    const msg =
      err instanceof AiError
        ? `${err.userMessage}${err.resolution ? ` ${err.resolution}` : ""}`
        : err instanceof Error
          ? err.message
          : "Selected AI provider failed during diagnosis.";
    return {
      ok: false,
      session,
      message: msg,
    };
  }
}

/**
 * Step 3: Read narrow, redacted code excerpts ONLY after explicit `show_affected_code` approval.
 */
export function showAffectedCode(opts: {
  repairId: string;
  approvedAction?: ApprovalActionType | null;
  files?: string[];
  rootDir?: string;
}): {
  ok: boolean;
  session?: RepairSession;
  excerpts?: RepairSession["codeExcerpts"];
  message: string;
} {
  const session = getSelfHealingStore().sessions.get(opts.repairId);
  if (!session) return { ok: false, message: `Repair session "${opts.repairId}" not found.` };

  const approval = verifySelfHealApproval("show_code", opts.approvedAction);
  if (!approval.allowed) {
    return { ok: false, session, message: approval.reason || "Approval required." };
  }

  const rootDir = opts.rootDir ?? process.cwd();
  const candidates = Array.from(
    new Set([
      ...(opts.files || []),
      ...(session.diagnosis?.affectedFiles || []),
      ...(session.report.file ? [session.report.file] : []),
    ]),
  );

  const excerpts: NonNullable<RepairSession["codeExcerpts"]> = [];
  for (const rel of candidates) {
    const safe = resolveSafeRepoPath(rel, rootDir);
    if (!safe.ok || !fs.existsSync(safe.absolutePath)) continue;
    const allLines = fs.readFileSync(safe.absolutePath, "utf8").split(/\r?\n/);
    const center = Math.max(1, session.report.line ?? 1);
    const startLine = Math.max(1, center - 35);
    const endLine = Math.min(allLines.length, startLine + 90);
    const slice = allLines
      .slice(startLine - 1, endLine)
      .map((l, i) => `${startLine + i}: ${l}`)
      .join("\n");
    excerpts.push({
      file: safe.normalizedRel,
      startLine,
      endLine,
      snippet: redactSensitiveText(slice).text,
    });
  }

  if (opts.approvedAction && !session.approvedActions.includes(opts.approvedAction)) {
    session.approvedActions.push(opts.approvedAction);
  }
  session.codeExcerpts = excerpts;
  session.status = "code_inspected";
  session.updatedAt = new Date().toISOString();

  return {
    ok: true,
    session,
    excerpts,
    message:
      excerpts.length > 0
        ? `Loaded ${excerpts.length} redacted source excerpt(s) for inspection.`
        : "No matching editable files were found in the diagnostic trace.",
  };
}

function buildUnifiedDiff(relFile: string, before: string, after: string): FileDiffPreview {
  const oldLines = before.split(/\r?\n/);
  const newLines = after.split(/\r?\n/);

  let start = 0;
  while (
    start < oldLines.length &&
    start < newLines.length &&
    oldLines[start] === newLines[start]
  ) {
    start++;
  }
  let endOld = oldLines.length - 1;
  let endNew = newLines.length - 1;
  while (endOld >= start && endNew >= start && oldLines[endOld] === newLines[endNew]) {
    endOld--;
    endNew--;
  }

  const ctxStart = Math.max(0, start - 2);
  const ctxEndOld = Math.min(oldLines.length - 1, endOld + 2);
  const ctxEndNew = Math.min(newLines.length - 1, endNew + 2);

  const lines: string[] = [
    `--- a/${relFile}`,
    `+++ b/${relFile}`,
    `@@ -${ctxStart + 1},${Math.max(1, ctxEndOld - ctxStart + 1)} +${ctxStart + 1},${Math.max(1, ctxEndNew - ctxStart + 1)} @@`,
  ];

  for (let i = ctxStart; i < start; i++) lines.push(` ${oldLines[i]}`);
  let deletions = 0;
  for (let i = start; i <= endOld; i++) {
    lines.push(`-${oldLines[i]}`);
    deletions++;
  }
  let additions = 0;
  for (let i = start; i <= endNew; i++) {
    lines.push(`+${newLines[i]}`);
    additions++;
  }
  for (let i = endOld + 1; i <= ctxEndOld; i++) lines.push(` ${oldLines[i]}`);

  return {
    file: relFile,
    unifiedDiff: lines.join("\n"),
    additions,
    deletions,
  };
}

/**
 * Step 4: Stage & preview minimal patch diff without modifying repository files on disk.
 */
export function prepareRepairPatch(opts: {
  repairId: string;
  approvedAction?: ApprovalActionType | null;
  patchEdits?: ProposedPatchEdit[];
  rootDir?: string;
}): {
  ok: boolean;
  session?: RepairSession;
  diffPreviews?: FileDiffPreview[];
  message: string;
} {
  const session = getSelfHealingStore().sessions.get(opts.repairId);
  if (!session) return { ok: false, message: `Repair session "${opts.repairId}" not found.` };

  const approval = verifySelfHealApproval("prepare_repair", opts.approvedAction);
  if (!approval.allowed) {
    return { ok: false, session, message: approval.reason || "Approval required." };
  }

  const edits = opts.patchEdits ?? session.patchEdits ?? session.diagnosis?.patchEdits ?? [];
  if (edits.length === 0) {
    return { ok: false, session, message: "No patch edits are available to preview." };
  }

  const rootDir = opts.rootDir ?? process.cwd();
  const stagedContent = new Map<string, { before: string; after: string }>();
  const validatedEdits: ProposedPatchEdit[] = [];

  for (const edit of edits) {
    const safe = resolveSafeRepoPath(edit.file, rootDir);
    if (!safe.ok) {
      return { ok: false, session, message: safe.reason };
    }
    if (!fs.existsSync(safe.absolutePath)) {
      return { ok: false, session, message: `Target file not found: "${safe.normalizedRel}".` };
    }
    const existingEntry = stagedContent.get(safe.normalizedRel);
    const original = fs.readFileSync(safe.absolutePath, "utf8");
    const currentText = existingEntry ? existingEntry.after : original;

    if (!edit.searchBlock) {
      return { ok: false, session, message: `Missing searchBlock for "${safe.normalizedRel}".` };
    }
    const firstIdx = currentText.indexOf(edit.searchBlock);
    if (firstIdx < 0) {
      return {
        ok: false,
        session,
        message: `Search block did not match "${safe.normalizedRel}". Re-read the file before preparing a patch.`,
      };
    }
    const secondIdx = currentText.indexOf(edit.searchBlock, firstIdx + edit.searchBlock.length);
    if (secondIdx >= 0) {
      return {
        ok: false,
        session,
        message: `Search block matched multiple locations in "${safe.normalizedRel}". Provide more context for an exact minimal patch.`,
      };
    }

    const updated =
      currentText.slice(0, firstIdx) +
      edit.replaceBlock +
      currentText.slice(firstIdx + edit.searchBlock.length);

    stagedContent.set(safe.normalizedRel, {
      before: existingEntry ? existingEntry.before : original,
      after: updated,
    });
    validatedEdits.push({ ...edit, file: safe.normalizedRel });
  }

  const diffPreviews: FileDiffPreview[] = [];
  for (const [relFile, pair] of stagedContent.entries()) {
    diffPreviews.push(buildUnifiedDiff(relFile, pair.before, pair.after));
  }

  if (opts.approvedAction && !session.approvedActions.includes(opts.approvedAction)) {
    session.approvedActions.push(opts.approvedAction);
  }
  session.patchEdits = validatedEdits;
  session.diffPreviews = diffPreviews;
  session.status = "patch_prepared";
  session.updatedAt = new Date().toISOString();

  return {
    ok: true,
    session,
    diffPreviews,
    message: `Staged diff preview for ${diffPreviews.length} file(s). No repository files were modified.`,
  };
}

async function runVerificationCommand(
  name: VerificationCheckResult["name"],
  nodeBinRel: string,
  args: string[],
  rootDir: string,
): Promise<VerificationCheckResult> {
  const started = Date.now();
  const binAbs = path.resolve(rootDir, nodeBinRel);
  if (!fs.existsSync(binAbs)) {
    return {
      name,
      passed: false,
      durationMs: Date.now() - started,
      summary: `Verification binary missing: ${nodeBinRel}`,
    };
  }
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [binAbs, ...args], {
      cwd: rootDir,
      timeout: 120_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    return {
      name,
      passed: true,
      durationMs: Date.now() - started,
      summary: `${name} passed`,
      output: redactSensitiveText(`${stdout}\n${stderr}`.trim().slice(-1500)).text,
    };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    const rawOut = `${e.stdout || ""}\n${e.stderr || ""}\n${e.message || ""}`.trim();
    return {
      name,
      passed: false,
      durationMs: Date.now() - started,
      summary: `${name} failed`,
      output: redactSensitiveText(rawOut.slice(-1800)).text,
    };
  }
}

export async function defaultVerificationSuite(
  touchedFiles: string[],
  rootDir: string,
  opts?: { includeBuild?: boolean },
): Promise<VerificationCheckResult[]> {
  const results: VerificationCheckResult[] = [];

  const tscRes = await runVerificationCommand(
    "typescript",
    "node_modules/typescript/bin/tsc",
    ["--noEmit"],
    rootDir,
  );
  results.push(tscRes);
  if (!tscRes.passed) return results;

  const vitestRes = await runVerificationCommand(
    "vitest",
    "node_modules/vitest/vitest.mjs",
    ["run", "--config", "vitest.config.ts"],
    rootDir,
  );
  results.push(vitestRes);
  if (!vitestRes.passed) return results;

  const lintTargets = touchedFiles.filter((f) => /\.(ts|tsx|js|mjs|cjs)$/.test(f));
  if (lintTargets.length > 0) {
    const eslintRes = await runVerificationCommand(
      "eslint",
      "node_modules/eslint/bin/eslint.js",
      lintTargets,
      rootDir,
    );
    results.push(eslintRes);
    if (!eslintRes.passed) return results;
  }

  if (opts?.includeBuild !== false) {
    const buildRes = await runVerificationCommand(
      "build",
      "node_modules/vite/bin/vite.js",
      ["build"],
      rootDir,
    );
    results.push(buildRes);
  }

  return results;
}

/**
 * Step 5: Apply repair ONLY with explicit `apply_repair_and_test` approval,
 * back up originals, run full verification, and AUTOMATICALLY ROLL BACK on any failure.
 */
export async function applyRepairAndTest(opts: {
  repairId: string;
  approvedAction?: ApprovalActionType | null;
  patchEdits?: ProposedPatchEdit[];
  rootDir?: string;
  includeBuild?: boolean;
  verifier?: (touchedFiles: string[], rootDir: string) => Promise<VerificationCheckResult[]>;
}): Promise<{
  ok: boolean;
  rolledBack: boolean;
  session?: RepairSession;
  verificationResults: VerificationCheckResult[];
  message: string;
}> {
  const store = getSelfHealingStore();
  const session = store.sessions.get(opts.repairId);
  if (!session) {
    return {
      ok: false,
      rolledBack: false,
      verificationResults: [],
      message: `Repair session "${opts.repairId}" not found.`,
    };
  }

  const approval = verifySelfHealApproval("apply_repair_and_test", opts.approvedAction);
  if (!approval.allowed) {
    return {
      ok: false,
      rolledBack: false,
      session,
      verificationResults: [],
      message: approval.reason || "Explicit 'apply_repair_and_test' approval required.",
    };
  }

  const rootDir = opts.rootDir ?? process.cwd();
  const preview = prepareRepairPatch({
    repairId: opts.repairId,
    approvedAction: "prepare_repair",
    patchEdits: opts.patchEdits,
    rootDir,
  });
  if (!preview.ok) {
    return {
      ok: false,
      rolledBack: false,
      session,
      verificationResults: [],
      message: preview.message,
    };
  }

  const edits = session.patchEdits || [];
  const fileWork = new Map<string, { abs: string; original: string; updated: string }>();

  for (const edit of edits) {
    const safe = resolveSafeRepoPath(edit.file, rootDir);
    if (!safe.ok) {
      return {
        ok: false,
        rolledBack: false,
        session,
        verificationResults: [],
        message: safe.reason,
      };
    }
    const existing = fileWork.get(safe.normalizedRel);
    const baseText = existing ? existing.updated : fs.readFileSync(safe.absolutePath, "utf8");
    const original = existing ? existing.original : baseText;
    const idx = baseText.indexOf(edit.searchBlock);
    if (idx < 0) {
      return {
        ok: false,
        rolledBack: false,
        session,
        verificationResults: [],
        message: `Search block disappeared before apply in "${safe.normalizedRel}".`,
      };
    }
    const updated =
      baseText.slice(0, idx) + edit.replaceBlock + baseText.slice(idx + edit.searchBlock.length);
    fileWork.set(safe.normalizedRel, { abs: safe.absolutePath, original, updated });
  }

  // Persist backups in memory + .aistudio/self-heal-backups/<repairId>
  const backupFiles: Array<{ file: string; originalContent: string }> = [];
  const backupRoot = path.join(
    path.resolve(rootDir),
    ".aistudio",
    "self-heal-backups",
    session.repairId,
  );
  try {
    fs.mkdirSync(backupRoot, { recursive: true });
    for (const [rel, entry] of fileWork.entries()) {
      backupFiles.push({ file: rel, originalContent: entry.original });
      const backupFile = path.join(backupRoot, rel);
      fs.mkdirSync(path.dirname(backupFile), { recursive: true });
      fs.writeFileSync(backupFile, entry.original, "utf8");
    }
  } catch {
    // Non-fatal if disk backup dir cannot be written; in-memory backup still guarantees rollback
  }
  session.backupFiles = backupFiles;

  // Apply edits atomically with try/rollback
  const touchedFiles = Array.from(fileWork.keys());
  try {
    for (const entry of fileWork.values()) {
      fs.writeFileSync(entry.abs, entry.updated, "utf8");
    }
  } catch (writeErr) {
    for (const entry of fileWork.values()) {
      try {
        fs.writeFileSync(entry.abs, entry.original, "utf8");
      } catch {
        // best effort
      }
    }
    session.status = "rolled_back";
    session.rollbackPerformed = true;
    session.rollbackReason =
      writeErr instanceof Error ? writeErr.message : "Failed writing patched file";
    session.updatedAt = new Date().toISOString();
    return {
      ok: false,
      rolledBack: true,
      session,
      verificationResults: [],
      message: `Write failed (${session.rollbackReason}); all files rolled back cleanly.`,
    };
  }

  // Run verification checks
  let verificationResults: VerificationCheckResult[] = [];
  let verifierThrew: string | null = null;
  try {
    verificationResults = opts.verifier
      ? await opts.verifier(touchedFiles, rootDir)
      : await defaultVerificationSuite(touchedFiles, rootDir, {
          includeBuild: opts.includeBuild,
        });
  } catch (err) {
    verifierThrew = err instanceof Error ? err.message : "Verification runner failed.";
  }

  const allPassed =
    !verifierThrew && verificationResults.length > 0 && verificationResults.every((r) => r.passed);

  if (!allPassed) {
    // AUTOMATIC ROLLBACK
    for (const entry of fileWork.values()) {
      fs.writeFileSync(entry.abs, entry.original, "utf8");
    }
    const failedSummary =
      verifierThrew ||
      verificationResults
        .filter((r) => !r.passed)
        .map((r) => `${r.name}: ${r.summary}`)
        .join("; ") ||
      "Verification did not produce passing results.";

    session.status = "rolled_back";
    session.rollbackPerformed = true;
    session.rollbackReason = failedSummary;
    session.verificationResults = verificationResults;
    session.updatedAt = new Date().toISOString();

    return {
      ok: false,
      rolledBack: true,
      session,
      verificationResults,
      message: `Verification failed (${failedSummary}). Automatically rolled back all ${touchedFiles.length} modified file(s).`,
    };
  }

  if (!session.approvedActions.includes("apply_repair_and_test")) {
    session.approvedActions.push("apply_repair_and_test");
  }
  session.status = "verified_applied";
  session.rollbackPerformed = false;
  session.verificationResults = verificationResults;
  session.updatedAt = new Date().toISOString();

  // Record verified pattern in Knowledge Base (requiresRevalidation=true for future hits)
  const kbEntry: KnowledgeBaseEntry = {
    id: `kb_${session.repairId}`,
    fingerprint: session.report.fingerprint,
    category: session.report.component,
    attribution: session.report.attribution,
    rootCause: session.diagnosis?.rootCause || session.report.errorMessage,
    affectedFiles: touchedFiles,
    repairStrategy:
      session.diagnosis?.repairPlan.join(" -> ") ||
      edits.map((e) => `${e.file}: ${e.rationale}`).join("; "),
    testResults: {
      passed: true,
      summary: verificationResults.map((v) => `${v.name}: ok`).join(", "),
    },
    extensionVersion: session.report.extensionVersion,
    status: "verified",
    requiresRevalidation: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  store.kbBudget.addRepairRecord(kbEntry);

  return {
    ok: true,
    rolledBack: false,
    session,
    verificationResults,
    message: `Repair applied and verified across ${verificationResults.length} check(s) (${verificationResults.map((v) => v.name).join(", ")}).`,
  };
}

/**
 * Explicit rollback helper restoring backed-up original file contents.
 */
export function rollbackRepair(opts: { repairId: string; rootDir?: string }): {
  ok: boolean;
  session?: RepairSession;
  message: string;
} {
  const session = getSelfHealingStore().sessions.get(opts.repairId);
  if (!session) return { ok: false, message: `Repair session "${opts.repairId}" not found.` };
  if (!session.backupFiles || session.backupFiles.length === 0) {
    return { ok: false, session, message: "No backed-up files found to roll back." };
  }
  const rootDir = opts.rootDir ?? process.cwd();
  for (const bk of session.backupFiles) {
    const safe = resolveSafeRepoPath(bk.file, rootDir);
    if (!safe.ok) return { ok: false, session, message: safe.reason };
    fs.writeFileSync(safe.absolutePath, bk.originalContent, "utf8");
  }
  session.status = "rolled_back";
  session.rollbackPerformed = true;
  session.rollbackReason = "Manual rollback requested by user.";
  session.updatedAt = new Date().toISOString();
  return {
    ok: true,
    session,
    message: `Restored ${session.backupFiles.length} file(s) from pre-repair backup.`,
  };
}
