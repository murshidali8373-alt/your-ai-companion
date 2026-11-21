/**
 * SHARED SELF-HEALING RUNTIME STORE (SERVER SINGLETON)
 *
 * Keeps one consistent in-memory instance across unified-orchestrator, buddy-service,
 * code-repair, github-workflow, and HTTP API routes (survives Vite SSR hot reloads).
 */

import {
  DEFAULT_CREDIT_BUDGET,
  SelfHealingKnowledgeAndBudget,
  type ApprovalActionType,
  type LocalRecoveryAction,
  type SanitizedDiagnosticReport,
} from "@/shared/self-healing";

export interface ProposedPatchEdit {
  file: string;
  searchBlock: string;
  replaceBlock: string;
  rationale: string;
}

export interface RepairDiagnosis {
  attribution: SanitizedDiagnosticReport["attribution"];
  rootCause: string;
  affectedFiles: string[];
  affectedFunctions: string[];
  repairPlan: string[];
  patchEdits: ProposedPatchEdit[];
  regressionRisks: string[];
  usedAi: boolean;
  provider?: string;
  model?: string;
  strictProviderHonored: boolean;
}

export interface FileDiffPreview {
  file: string;
  unifiedDiff: string;
  additions: number;
  deletions: number;
}

export interface VerificationCheckResult {
  name: "typescript" | "vitest" | "eslint" | "build";
  passed: boolean;
  durationMs: number;
  summary: string;
  output?: string;
}

export interface GitHubPrResult {
  ok: boolean;
  requiresUserAction?: boolean;
  branchName?: string;
  baseBranch?: string;
  commitSha?: string;
  prNumber?: number;
  prUrl?: string;
  preparedPatch?: string;
  message: string;
}

export interface RepairSession {
  repairId: string;
  report: SanitizedDiagnosticReport;
  localRecovery: LocalRecoveryAction;
  kbMatches: Array<{
    id: string;
    rootCause: string;
    repairStrategy: string;
    affectedFiles: string[];
    versionCompatible: boolean;
    requiresRevalidation: boolean;
  }>;
  occurrenceCount: number;
  isDuplicate: boolean;
  suppressedReason?: string;
  status:
    | "triaged"
    | "recovered_locally"
    | "diagnosed"
    | "code_inspected"
    | "patch_prepared"
    | "verified_applied"
    | "rolled_back"
    | "pr_created"
    | "cancelled";
  approvedActions: ApprovalActionType[];
  diagnosis?: RepairDiagnosis;
  codeExcerpts?: Array<{
    file: string;
    startLine: number;
    endLine: number;
    snippet: string;
  }>;
  patchEdits?: ProposedPatchEdit[];
  diffPreviews?: FileDiffPreview[];
  verificationResults?: VerificationCheckResult[];
  rollbackPerformed?: boolean;
  rollbackReason?: string;
  backupFiles?: Array<{ file: string; originalContent: string }>;
  githubResult?: GitHubPrResult;
  createdAt: string;
  updatedAt: string;
}

export interface SelfHealingStoreState {
  kbBudget: SelfHealingKnowledgeAndBudget;
  sessions: Map<string, RepairSession>;
  reports: SanitizedDiagnosticReport[];
  maxReports: number;
}

const GLOBAL_STORE_KEY = "__aiBuddySelfHealingStoreV1";

function createInitialStore(): SelfHealingStoreState {
  return {
    kbBudget: new SelfHealingKnowledgeAndBudget(DEFAULT_CREDIT_BUDGET),
    sessions: new Map<string, RepairSession>(),
    reports: [],
    maxReports: 120,
  };
}

export function getSelfHealingStore(): SelfHealingStoreState {
  const g = globalThis as Record<string, unknown>;
  if (!g[GLOBAL_STORE_KEY]) {
    g[GLOBAL_STORE_KEY] = createInitialStore();
  }
  return g[GLOBAL_STORE_KEY] as SelfHealingStoreState;
}

export function resetSelfHealingStoreForTests(): void {
  const g = globalThis as Record<string, unknown>;
  g[GLOBAL_STORE_KEY] = createInitialStore();
}

export function appendSanitizedReport(report: SanitizedDiagnosticReport): void {
  const store = getSelfHealingStore();
  store.reports.unshift(report);
  if (store.reports.length > store.maxReports) {
    store.reports.length = store.maxReports;
  }
}
