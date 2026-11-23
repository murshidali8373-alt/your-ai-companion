/**
 * UNIFIED CENTRAL ORCHESTRATOR (AI Buddy 2.0 — Phase 1 Core Intelligence)
 *
 * Connects:
 * - Request Classifier (`classifyUserRequest`)
 * - Central AI Buddy Brain (`classifyBrainIntent`, `determineCollaboratingBuddies`, `recommendOptimalModel`)
 * - Typed Capability Registry (`CAPABILITY_REGISTRY`, `canExecuteCapability`)
 * - Shared TaskSessionContext & Dependency DAG (`TaskNode`, `Subtask`, `validateTaskGraphDependencies`, locks)
 * - Existing 11 Specialized Engines (`src/lib/engines/*`)
 * - Self-Healing Error Telemetry (`sanitizeDiagnosticReport`, `planDeterministicRecovery`, shared store)
 *
 * Maintains two cleanly separated execution paths:
 * - `fast_path`: general chat, simple Q&A, single lightweight queries (minimal overhead)
 * - `multi_agent_path`: complex workflows, ecommerce portals, spreadsheets, research, forms, multi-step tasks
 */

import { type PageSnapshot } from "@/shared/page-snapshot";
import { type PermissionLevel } from "@/shared/permissions";
import { canExecuteCapability, getCapability } from "@/shared/capability-registry";
import {
  createTaskSessionContext,
  isolateSessionContext,
  recordCostTelemetry,
  syncSessionSubtaskBuckets,
  type ExecutionPath,
  type SpecialistAgentId,
  type Subtask,
  type TaskNode,
  type TaskSessionContext,
} from "@/shared/task-context";
import {
  planDeterministicRecovery,
  sanitizeDiagnosticReport,
  type DiagnosticReportInput,
  type LocalRecoveryAction,
  type MonitoredComponent,
  type SanitizedDiagnosticReport,
} from "@/shared/self-healing";
import { appendSanitizedReport, getSelfHealingStore } from "@/lib/self-healing/store.server";
import { classifyUserRequest, type RequestClassification } from "@/lib/ai/request-classifier";
import {
  buildEpistemicBreakdown,
  classifyBrainIntent,
  determineCollaboratingBuddies,
  generatePlanAlternatives,
  parseTaskControlCommand,
  recommendOptimalModel,
  type BrainIntent,
  type EpistemicStatement,
  type PlanAlternative,
  type SpecialistCollaboration,
  type TaskControlCommand,
} from "./ai-buddy-brain";
import {
  analyzePageIntelligence,
  detectVisualUiState,
  findSemanticTarget,
  type StructuredPageRepresentation,
} from "./page-intelligence-engine";
import { evaluatePagination, resolveOrdinalTarget, searchContent } from "./navigation-engine";
import {
  type DataAggregationResult,
  type SpreadsheetAnalysisResult,
} from "./data-intelligence-engine";
import { type CrossFileComparisonResult, type WorkspaceDocument } from "./file-workspace-engine";
import { type ResearchSource, type StructuredResearchReport } from "./research-engine";
import {
  detectMemoryContradictions,
  retrieveContextualMemories,
  type MemoryContradictionAlert,
  type MemoryRecord,
} from "./memory-engine";
import { buildBudgetedTaskContext, isSnapshotStale } from "./context-manager";
import {
  findReusablePatterns,
  recordVerifiedExecutionPattern,
  type VerifiedExecutionPattern,
} from "./adaptive-learning";
import { executeTaskDag } from "./dag-executor";
import { getAgentDefinition } from "@/lib/agents/agents-registry";
import {
  generateProactiveSuggestions,
  type ProactivePreferences,
  type ProactiveSuggestion,
} from "./proactive-engine";
import { parseNaturalLanguageWorkflow, type ParsedNaturalWorkflow } from "./workflow-recipe-engine";

export interface ExecutionPathDecision {
  path: ExecutionPath;
  reason: string;
  requestClassification: RequestClassification;
  brainIntent: BrainIntent;
  taskControl: TaskControlCommand | null;
  collaboration: SpecialistCollaboration;
  recommendedModel: string;
  capabilityIds: string[];
  agentsAssigned: SpecialistAgentId[];
}

export interface UnifiedOrchestratorInput {
  instruction: string;
  userId?: string | null;
  intentHint?: string | null;
  snapshot?: PageSnapshot | null;
  history?: Array<{ role: string; content: string }> | null;
  buddySlug?: string | null;
  customBuddyId?: string | null;
  permissionLevel?: PermissionLevel;
  privacyMode?: boolean;
  consentGranted?: boolean;
  activeTabId?: number | null;
  sessionContext?: TaskSessionContext | null;
  spreadsheetData?: Array<Record<string, unknown>> | null;
  comparisonData?: Array<Record<string, unknown>> | null;
  documents?: WorkspaceDocument[] | null;
  researchSources?: ResearchSource[] | null;
  userMemories?: MemoryRecord[];
  proactivePreferences?: Partial<ProactivePreferences> | null;
  uploadedDocumentSummary?: {
    fileName: string;
    documentType: string;
    availableFields: string[];
  } | null;
  actionContext?: {
    lastTargetField?: string | null;
    lastActionType?: string | null;
    pendingSlotType?: string | null;
    activeElementLabel?: string | null;
    recentFields?: string[];
  } | null;
  hasVision?: boolean;
}

export interface SubtaskDetailView {
  taskId: string;
  title: string;
  agentId: SpecialistAgentId;
  agentName: string;
  responsibility: string;
  status: string;
  dependencies: string[];
  retryCount: number;
  verified: boolean;
  durationMs?: number;
  error?: string;
}

export interface OrchestrationMetadata {
  path: ExecutionPath;
  reason: string;
  brainIntent: BrainIntent;
  sessionId: string;
  taskId: string | null;
  agentsAssigned: SpecialistAgentId[];
  capabilityIds: string[];
  collaborationNotice: string;
  recommendedModel: string;
  subtaskCounts: {
    total: number;
    completed: number;
    pending: number;
    failed: number;
    awaitingApproval: number;
  };
  subtaskDetails?: SubtaskDetailView[];
  dagSummary?: {
    parallelWaves: number;
    maxObservedConcurrency: number;
    replannedSubtasks: string[];
  };
  blockedCapabilities: Array<{ capabilityId: string; reason: string }>;
}

export interface UnifiedOrchestratorResult {
  decision: ExecutionPathDecision;
  sessionContext: TaskSessionContext;
  orchestration: OrchestrationMetadata;
  structuredPage?: StructuredPageRepresentation;
  spreadsheetAnalysis?: SpreadsheetAnalysisResult;
  crossFileResult?: CrossFileComparisonResult;
  researchReport?: StructuredResearchReport;
  dataAggregation?: DataAggregationResult;
  suggestedHighlightSelector?: string;
  memoryContextBlock?: string;
  memoryContradictions?: MemoryContradictionAlert[];
  reusablePatterns?: VerifiedExecutionPattern[];
  staleSnapshotWarning?: string;
  alternativePlans?: PlanAlternative[];
  epistemicBreakdown?: EpistemicStatement[];
  contextBudgetStats?: {
    estimatedTokens: number;
    truncatedSections: string[];
    trimmedHistoryCount: number;
    untrustedSignals: string[];
  };
  engineInsightsBlock?: string;
  proactiveSuggestions?: ProactiveSuggestion[];
  workflowDraft?: ParsedNaturalWorkflow;
  costTelemetry?: TaskSessionContext["costTelemetry"];
  blockedByCapability?: { capabilityId: string; reason: string } | null;
  recoveredErrors: Array<{
    report: SanitizedDiagnosticReport;
    recovery: LocalRecoveryAction;
  }>;
}

const SESSION_MAP_KEY = "__aiBuddySessionContextsV1";

function getSessionMap(): Map<string, TaskSessionContext> {
  const g = globalThis as Record<string, unknown>;
  if (!g[SESSION_MAP_KEY]) {
    g[SESSION_MAP_KEY] = new Map<string, TaskSessionContext>();
  }
  return g[SESSION_MAP_KEY] as Map<string, TaskSessionContext>;
}

export function getOrchestratorSession(sessionId: string): TaskSessionContext | undefined {
  return getSessionMap().get(sessionId);
}

export function clearOrchestratorSessionsForTests(): void {
  getSessionMap().clear();
}

function mapBuddySlugToAgents(collaboration: SpecialistCollaboration): SpecialistAgentId[] {
  const agents = new Set<SpecialistAgentId>(["planning"]);
  const slugs = [
    collaboration.primarySpecialist.slug,
    ...collaboration.contributingSpecialists.map((c) => c.slug),
  ];
  for (const s of slugs) {
    if (s === "developer") agents.add("browser");
    else if (s === "data") agents.add("spreadsheet");
    else if (s === "research") agents.add("research");
    else if (s === "operations") agents.add("verification");
    else if (s === "content") agents.add("communication");
    else if (s === "ca") agents.add("analysis");
  }
  return Array.from(agents);
}

function resolveCapabilitiesAndAgents(
  brainIntent: BrainIntent,
  instruction: string,
  hasSnapshot: boolean,
  collaboration: SpecialistCollaboration,
): { capabilityIds: string[]; agents: SpecialistAgentId[] } {
  const lower = instruction.toLowerCase();
  const caps = new Set<string>();
  const agents = new Set<SpecialistAgentId>(mapBuddySlugToAgents(collaboration));

  if (/\b(?:hover|mouseover)\b/i.test(lower)) {
    caps.add("hover_element");
    agents.add("browser");
  } else if (/\bdouble[\s-]?click\b/i.test(lower)) {
    caps.add("double_click");
    agents.add("browser");
  } else if (/\b(?:right[\s-]?click|context\s*menu)\b/i.test(lower)) {
    caps.add("right_click");
    agents.add("browser");
  } else if (/\b(?:drag\s+and\s+drop|drag\s+.*\s+to|drop\s+on)\b/i.test(lower)) {
    caps.add("drag_and_drop");
    agents.add("browser");
  } else if (/\b(?:focus\s+on|focus\s+element)\b/i.test(lower)) {
    caps.add("focus_element");
    agents.add("browser");
  } else if (/\b(?:clear\s+(?:the\s+)?field|empty\s+input|saaf\s+karo)\b/i.test(lower)) {
    caps.add("clear_field");
    agents.add("form_automation");
  } else if (/\b(?:scroll\s+until|scroll\s+till|scroll\s+down\s+until)\b/i.test(lower)) {
    caps.add("scroll_until_text");
    agents.add("browser");
  } else if (/\b(?:infinite\s+scroll|keep\s+scrolling)\b/i.test(lower)) {
    caps.add("infinite_scroll");
    agents.add("browser");
  } else if (/\b(?:scroll\s+to\s+element|scroll\s+to)\b/i.test(lower)) {
    caps.add("scroll_to_element");
    agents.add("browser");
  } else if (/\b(?:scroll\s+container|scroll\s+panel|scroll\s+table)\b/i.test(lower)) {
    caps.add("scroll_container");
    agents.add("browser");
  } else if (
    /\b(?:last\s+page|next\s+page|prev(?:ious)?\s+page|paginate|go\s+to\s+page)\b/i.test(lower)
  ) {
    caps.add("paginate");
    agents.add("browser");
  } else if (/\b(?:open\s+(?:in\s+)?(?:a\s+)?(?:new|another)\s+tab|open\s+tab)\b/i.test(lower)) {
    caps.add("open_tab");
    agents.add("browser");
  } else if (/\b(?:close\s+(?:this\s+|that\s+)?tab)\b/i.test(lower)) {
    caps.add("close_tab");
    agents.add("browser");
  } else if (/\b(?:switch\s+tab|return\s+to\s+original\s+tab|previous\s+tab)\b/i.test(lower)) {
    caps.add("switch_tab");
    agents.add("browser");
  } else if (/\b(?:undo|revert|wapas\s+pehle\s+jaisa)\b/i.test(lower)) {
    caps.add("undo_reversible_action");
    agents.add("workflow_recovery");
  } else if (/\b(?:validate\s+form|check\s+(?:form\s+)?errors|missing\s+fields)\b/i.test(lower)) {
    caps.add("validate_form_errors");
    agents.add("form_automation");
  } else if (
    /\b(?:autocomplete|suggestion|dropdown|combobox|listbox|select\s+option)\b/i.test(lower)
  ) {
    caps.add("select_custom_dropdown");
    agents.add("form_automation");
  } else if (/\b(?:extract\s+table|read\s+table)\b/i.test(lower)) {
    caps.add("extract_table");
    agents.add("data_extraction");
  }

  switch (brainIntent) {
    case "locate_element":
      if (hasSnapshot) caps.add("observe_webpage");
      caps.add("locate_element");
      caps.add("highlight_element");
      caps.add("point_to_element");
      agents.add("browser");
      agents.add("visual_understanding");
      break;
    case "smart_form_fill":
      if (hasSnapshot) caps.add("observe_webpage");
      caps.add("fill_form");
      caps.add("verify_outcome");
      agents.add("form_automation");
      agents.add("verification");
      break;
    case "aggregate_data":
      if (hasSnapshot) caps.add("observe_webpage");
      caps.add("extract_structured_data");
      caps.add("calculate_values");
      agents.add("data_extraction");
      agents.add("analysis");
      break;
    case "spreadsheet_audit":
      caps.add("process_spreadsheet");
      agents.add("spreadsheet");
      agents.add("analysis");
      break;
    case "cross_file_comparison":
      caps.add("compare_datasets");
      agents.add("spreadsheet");
      agents.add("file_management");
      agents.add("verification");
      break;
    case "multi_source_research":
      caps.add("search_web");
      caps.add("generate_report");
      agents.add("research");
      agents.add("analysis");
      break;
    case "universal_task":
      if (hasSnapshot) caps.add("observe_webpage");
      caps.add("extract_structured_data");
      caps.add("compare_datasets");
      caps.add("generate_report");
      agents.add("ecommerce");
      agents.add("data_extraction");
      agents.add("spreadsheet");
      agents.add("verification");
      break;
    case "multi_step_task":
    case "workflow_recipe_exec":
    case "plan":
      if (hasSnapshot) caps.add("observe_webpage");
      caps.add("maintain_checkpoints");
      caps.add("verify_outcome");
      agents.add("browser");
      agents.add("verification");
      break;
    case "explain_page":
      if (hasSnapshot) {
        caps.add("observe_webpage");
        caps.add("read_visible_content");
      }
      agents.add("visual_understanding");
      break;
    case "task_control_command":
      caps.add("pause_resume_task");
      agents.add("workflow_recovery");
      break;
    default:
      if (hasSnapshot && /\b(?:scroll|neeche|upar)\b/i.test(lower)) {
        caps.add("scroll_intelligent");
        agents.add("browser");
      } else if (hasSnapshot && /\b(?:click|open|kholo|dabao)\b/i.test(lower)) {
        caps.add("click_element");
        agents.add("browser");
      } else {
        caps.add("read_visible_content");
        agents.add("communication");
      }
      break;
  }

  return {
    capabilityIds: Array.from(caps),
    agents: Array.from(agents),
  };
}

/**
 * Classifies whether a request should take the low-overhead Fast Path or full Multi-Agent Path.
 */
export function decideExecutionPath(
  instruction: string,
  opts: {
    intentHint?: string | null;
    snapshot?: PageSnapshot | null;
    history?: Array<{ role: string; content: string }> | null;
    buddySlug?: string | null;
    hasPendingSlot?: boolean;
    hasSpreadsheet?: boolean;
    hasComparison?: boolean;
    hasResearch?: boolean;
    hasUploadedDoc?: boolean;
    hasVision?: boolean;
  } = {},
): ExecutionPathDecision {
  const requestClassification = classifyUserRequest(instruction, {
    snapshot: opts.snapshot,
    history: opts.history,
    intentHint: opts.intentHint,
    hasPendingSlot: opts.hasPendingSlot,
  });

  const taskControl = parseTaskControlCommand(instruction);
  const brainIntent = classifyBrainIntent(instruction);
  const collaboration = determineCollaboratingBuddies(instruction, opts.buddySlug ?? undefined);
  const recommendedModel = recommendOptimalModel(brainIntent, Boolean(opts.hasVision));

  const { capabilityIds, agents } = resolveCapabilitiesAndAgents(
    brainIntent,
    instruction,
    Boolean(opts.snapshot),
    collaboration,
  );

  const lower = instruction.toLowerCase();
  const multiStepSignals =
    Boolean(opts.hasSpreadsheet || opts.hasComparison || opts.hasResearch || opts.hasUploadedDoc) ||
    brainIntent === "universal_task" ||
    brainIntent === "cross_file_comparison" ||
    brainIntent === "multi_source_research" ||
    brainIntent === "spreadsheet_audit" ||
    brainIntent === "multi_step_task" ||
    brainIntent === "aggregate_data" ||
    brainIntent === "smart_form_fill" ||
    brainIntent === "plan" ||
    /\b(?:and then|uske baad|step by step|reconcile|compare|extract all|duplicate entries|meesho|multi[-\s]?page)\b/i.test(
      lower,
    );

  // Fast Path: general conversations, explanations, single lightweight queries, or in-flight simple task controls
  const isFastPath =
    !multiStepSignals &&
    (requestClassification.category === "general_chat" ||
      brainIntent === "answer" ||
      brainIntent === "explain_page" ||
      brainIntent === "locate_element");

  return {
    path: isFastPath ? "fast_path" : "multi_agent_path",
    reason: isFastPath
      ? `Fast path (${requestClassification.reason}; intent=${brainIntent})`
      : `Multi-agent path (intent=${brainIntent}; agents=${agents.join(",")})`,
    requestClassification,
    brainIntent,
    taskControl,
    collaboration,
    recommendedModel,
    capabilityIds,
    agentsAssigned: agents,
  };
}

/**
 * Shared error reporting hook connecting Orchestrator / Engines / Agents to the Self-Healing Engine.
 */
export function reportExecutionError(
  errorInput:
    | DiagnosticReportInput
    | {
        component: MonitoredComponent;
        error: unknown;
        currentOperation?: string;
        taskId?: string;
        pageUrl?: string;
        capabilityId?: string;
        agentId?: SpecialistAgentId;
      },
  sessionCtx?: TaskSessionContext | null,
): { report: SanitizedDiagnosticReport; recovery: LocalRecoveryAction } {
  const normalizedInput: DiagnosticReportInput =
    "errorMessage" in errorInput
      ? errorInput
      : {
          component: errorInput.component,
          errorMessage:
            errorInput.error instanceof Error
              ? errorInput.error.message
              : typeof errorInput.error === "string"
                ? errorInput.error
                : "Execution failure",
          errorType: errorInput.error instanceof Error ? errorInput.error.name : "Error",
          stackTrace: errorInput.error instanceof Error ? errorInput.error.stack : undefined,
          currentOperation: errorInput.currentOperation,
          taskId: errorInput.taskId,
          pageUrl: errorInput.pageUrl,
          capabilityId: errorInput.capabilityId,
          agentId: errorInput.agentId,
        };

  const report = sanitizeDiagnosticReport(normalizedInput);
  const store = getSelfHealingStore();
  store.kbBudget.recordOccurrence(report);
  appendSanitizedReport(report);

  const recovery = planDeterministicRecovery(report);
  if (recovery.canAutoExecute && !recovery.shouldCallAi) {
    store.kbBudget.recordLocalRecovery();
  }

  if (sessionCtx) {
    sessionCtx.executionHistory.push({
      timestamp: report.timestamp,
      agentId: (report.agentId as SpecialistAgentId) || "workflow_recovery",
      subtaskId: report.taskId,
      action: report.currentOperation || report.capabilityId || "execution",
      outcome: "error",
      detail: `${report.attribution}: ${report.errorMessage.slice(0, 200)}`,
    });
  }

  return { report, recovery };
}

function buildMultiAgentSubtasks(
  parentTaskId: string,
  decision: ExecutionPathDecision,
  input: UnifiedOrchestratorInput,
): Subtask[] {
  const perm = input.permissionLevel ?? "explain";
  const tabId = input.activeTabId ?? null;
  const subtasks: Subtask[] = [];

  const pushTask = (
    suffix: string,
    title: string,
    agentId: SpecialistAgentId,
    capabilityId: string,
    opts?: {
      dependencies?: string[];
      priority?: number;
      fileOwnership?: string | null;
      tabOwnership?: number | null;
    },
  ): string => {
    const cap = getCapability(capabilityId);
    const id = `${parentTaskId}_${suffix}`;
    subtasks.push({
      taskId: id,
      parentTaskId,
      title,
      agentId,
      capabilityId,
      dependencies: opts?.dependencies ?? [],
      status: "pending",
      priority: opts?.priority ?? 5,
      retryLimit: 2,
      retryCount: 0,
      tabOwnership: opts?.tabOwnership ?? tabId,
      fileOwnership: opts?.fileOwnership ?? null,
      permissions: {
        requiredLevel: cap?.requiredPermission ?? perm,
        isConsequential: cap?.isConsequential ?? false,
        approved: Boolean(input.consentGranted),
      },
    });
    return id;
  };

  // Root parallel-ready branches where appropriate (no artificial sequential chaining)
  let observeId: string | null = null;
  if (input.snapshot) {
    observeId = pushTask("observe", "Observe active webpage DOM", "browser", "observe_webpage", {
      priority: 9,
      tabOwnership: tabId,
    });
  }

  let memoryId: string | null = null;
  if (input.userMemories && input.userMemories.length > 0) {
    memoryId = pushTask(
      "memory",
      "Load relevant contextual memories",
      "memory",
      "manage_long_term_memory",
      {
        priority: 8,
        tabOwnership: null, // Independent of browser tab lock so it runs truly in parallel!
      },
    );
  }

  const isScheduleWorkflow =
    /\b(?:every\s+day|daily|weekly|hourly|schedule|har\s+roz|workflow\s+create|automate\s+daily)\b/i.test(
      input.instruction,
    );

  const hasMultiDomainAttachments =
    Boolean(input.spreadsheetData?.length) ||
    Boolean(input.comparisonData?.length) ||
    Boolean(input.researchSources?.length) ||
    Boolean(input.documents?.length);

  if (isScheduleWorkflow && !hasMultiDomainAttachments) {
    const wfId = pushTask(
      "workflow",
      "Parse conversational schedule and safety preview",
      "workflow_automation",
      "manage_workflow_automation",
      { priority: 9, tabOwnership: null },
    );
    pushTask(
      "verify",
      "Confirm approval gate before enabling schedule",
      "verification",
      "verify_outcome",
      { dependencies: [wfId], tabOwnership: null },
    );
  } else if (isScheduleWorkflow && hasMultiDomainAttachments) {
    const upstream: string[] = [];
    if (observeId) upstream.push(observeId);
    if (memoryId) upstream.push(memoryId);

    if (input.spreadsheetData?.length || input.comparisonData?.length) {
      upstream.push(
        pushTask(
          "compare",
          input.comparisonData?.length
            ? "Compare datasets and detect discrepancies"
            : "Analyze spreadsheet columns and anomalies",
          "spreadsheet",
          input.comparisonData?.length ? "compare_datasets" : "process_spreadsheet",
          {
            dependencies: [],
            priority: 8,
            tabOwnership: null,
            fileOwnership: input.uploadedDocumentSummary?.fileName ?? "comparison_dataset",
          },
        ),
      );
    }
    if (input.researchSources?.length) {
      upstream.push(
        pushTask(
          "research",
          "Cross-reference multi-source evidence & contradictions",
          "research",
          "search_web",
          { dependencies: [], priority: 8, tabOwnership: null },
        ),
      );
    }
    if (input.documents?.length) {
      upstream.push(
        pushTask("docs", "Extract & merge workspace documents", "document", "generate_report", {
          dependencies: [],
          priority: 7,
          tabOwnership: null,
        }),
      );
    }
    upstream.push(
      pushTask(
        "workflow",
        "Parse conversational schedule and safety preview",
        "workflow_automation",
        "manage_workflow_automation",
        { dependencies: [], priority: 8, tabOwnership: null },
      ),
    );
    pushTask(
      "verify",
      "Verify combined multi-agent outputs & schedule gate",
      "verification",
      "verify_outcome",
      {
        dependencies: upstream,
        priority: 6,
        tabOwnership: null,
      },
    );
  } else if (decision.brainIntent === "smart_form_fill") {
    const fillId = pushTask(
      "fill",
      "Resolve target form fields and enter values",
      "form_filling",
      "fill_form",
      { dependencies: observeId ? [observeId] : [], priority: 9 },
    );
    pushTask(
      "verify",
      "Verify field values without accidental submit",
      "verification",
      "verify_outcome",
      { dependencies: [fillId], tabOwnership: null },
    );
  } else if (decision.brainIntent === "spreadsheet_audit") {
    const sheetId = pushTask(
      "sheet",
      "Analyze spreadsheet columns and anomalies",
      "spreadsheet",
      "process_spreadsheet",
      {
        dependencies: [],
        priority: 8,
        tabOwnership: null,
        fileOwnership: input.uploadedDocumentSummary?.fileName ?? "active_spreadsheet",
      },
    );
    const dataId = pushTask(
      "data",
      "Compute data intelligence & outlier report",
      "data_intelligence",
      "calculate_values",
      {
        dependencies: [sheetId],
        tabOwnership: null,
      },
    );
    pushTask("verify", "Verify spreadsheet audit completeness", "verification", "verify_outcome", {
      dependencies: [dataId],
      tabOwnership: null,
    });
  } else if (
    decision.brainIntent === "cross_file_comparison" ||
    decision.brainIntent === "universal_task"
  ) {
    // True parallel independent branches: browser observation + spreadsheet inspection + document merge
    const upstream: string[] = [];
    if (observeId) upstream.push(observeId);
    if (memoryId) upstream.push(memoryId);

    const compareId = pushTask(
      "compare",
      "Compare datasets and detect discrepancies",
      "spreadsheet",
      "compare_datasets",
      {
        dependencies: [], // Can run in parallel with DOM observation when tabOwnership is null!
        priority: 8,
        tabOwnership: null,
        fileOwnership: input.uploadedDocumentSummary?.fileName ?? "comparison_dataset",
      },
    );
    upstream.push(compareId);

    if (input.documents?.length) {
      const docId = pushTask(
        "docs",
        "Extract & merge workspace documents",
        "document",
        "generate_report",
        {
          dependencies: [],
          priority: 7,
          tabOwnership: null,
        },
      );
      upstream.push(docId);
    }

    const reportId = pushTask(
      "report",
      "Synthesize structured reconciliation report",
      "data_intelligence",
      "generate_report",
      {
        dependencies: upstream,
        priority: 7,
        tabOwnership: null,
      },
    );
    pushTask(
      "verify",
      "Verify reconciliation completeness & provenance",
      "verification",
      "verify_outcome",
      {
        dependencies: [reportId],
        priority: 6,
        tabOwnership: null,
      },
    );
  } else if (decision.brainIntent === "multi_source_research") {
    const resId = pushTask(
      "research",
      "Cross-reference multi-source evidence & contradictions",
      "research",
      "search_web",
      {
        dependencies: [],
        priority: 8,
        tabOwnership: null,
      },
    );
    const deps = [resId, ...(observeId ? [observeId] : []), ...(memoryId ? [memoryId] : [])];
    pushTask("verify", "Verify research citations & unknowns", "verification", "verify_outcome", {
      dependencies: deps,
      tabOwnership: null,
    });
  } else if (decision.brainIntent === "aggregate_data") {
    const aggId = pushTask(
      "agg",
      "Aggregate webpage records deterministically",
      "data_intelligence",
      "calculate_values",
      {
        dependencies: observeId ? [observeId] : [],
        priority: 8,
      },
    );
    pushTask("verify", "Verify aggregated totals", "verification", "verify_outcome", {
      dependencies: [aggId],
      tabOwnership: null,
    });
  } else {
    const primaryCap = decision.capabilityIds[0] || "maintain_checkpoints";
    const primaryAgent = decision.agentsAssigned[0] || "planning";
    const execId = pushTask(
      "exec",
      "Execute orchestrated workflow step",
      primaryAgent,
      primaryCap,
      {
        dependencies: observeId ? [observeId] : [],
      },
    );
    pushTask("verify", "Verify task outcome against state", "verification", "verify_outcome", {
      dependencies: [execId],
      tabOwnership: null,
    });
  }

  return subtasks;
}

/**
 * Executes the Unified Central Orchestrator over an incoming request,
 * updating TaskSessionContext, dispatching engines via DAG executor, checking capabilities,
 * generating proactive suggestions, tracking token/cost telemetry, and hooking errors into Self-Healing.
 */
export async function runUnifiedOrchestrator(
  input: UnifiedOrchestratorInput,
): Promise<UnifiedOrchestratorResult> {
  const permissionLevel: PermissionLevel = input.permissionLevel ?? "explain";
  const decision = decideExecutionPath(input.instruction, {
    intentHint: input.intentHint,
    snapshot: input.snapshot,
    history: input.history,
    buddySlug: input.buddySlug,
    hasPendingSlot: Boolean(input.actionContext?.pendingSlotType),
    hasSpreadsheet: Boolean(input.spreadsheetData?.length),
    hasComparison: Boolean(input.comparisonData?.length),
    hasResearch: Boolean(input.researchSources?.length),
    hasUploadedDoc: Boolean(input.uploadedDocumentSummary),
    hasVision: input.hasVision,
  });

  // Restore or initialize shared TaskSessionContext with strict user isolation
  const sessionMap = getSessionMap();
  const rawExisting = input.sessionContext?.sessionId
    ? (sessionMap.get(input.sessionContext.sessionId) ?? input.sessionContext)
    : (input.sessionContext ?? null);
  const isolatedExisting =
    rawExisting && input.userId !== undefined
      ? isolateSessionContext(rawExisting, input.userId ?? null)
      : rawExisting;

  const sessionCtx =
    isolatedExisting ??
    createTaskSessionContext({
      userId: input.userId ?? null,
      activeWebpage: input.snapshot
        ? {
            url: input.snapshot.url,
            origin: input.snapshot.origin,
            title: input.snapshot.title,
            capturedAt: input.snapshot.capturedAt,
          }
        : null,
      activeBrowserTab:
        input.activeTabId !== undefined && input.activeTabId !== null
          ? {
              tabId: input.activeTabId,
              url: input.snapshot?.url,
              title: input.snapshot?.title,
            }
          : null,
    });

  if (input.snapshot) {
    sessionCtx.activeWebpage = {
      url: input.snapshot.url,
      origin: input.snapshot.origin,
      title: input.snapshot.title,
      capturedAt: input.snapshot.capturedAt,
    };
  }
  if (input.uploadedDocumentSummary) {
    const docId = `doc_${input.uploadedDocumentSummary.fileName}`;
    if (!sessionCtx.relevantFiles.some((f) => f.fileId === docId)) {
      sessionCtx.relevantFiles.push({
        fileId: docId,
        fileName: input.uploadedDocumentSummary.fileName,
        documentType: input.uploadedDocumentSummary.documentType,
        availableFields: input.uploadedDocumentSummary.availableFields,
      });
    }
  }

  const recoveredErrors: UnifiedOrchestratorResult["recoveredErrors"] = [];
  const blockedCapabilities: Array<{ capabilityId: string; reason: string }> = [];
  let blockedByCapability: { capabilityId: string; reason: string } | null = null;

  for (const capId of decision.capabilityIds) {
    const check = canExecuteCapability(capId, permissionLevel, Boolean(input.consentGranted));
    if (!check.available) {
      blockedCapabilities.push({
        capabilityId: capId,
        reason: check.reason || `Capability "${capId}" is not currently executable.`,
      });
      if (!blockedByCapability) {
        blockedByCapability = {
          capabilityId: capId,
          reason: check.reason || `Capability "${capId}" is currently planned/unavailable.`,
        };
      }
    }
  }

  let memoryContextBlock: string | undefined;
  let memoryContradictions: MemoryContradictionAlert[] = [];
  if (input.userMemories && input.userMemories.length > 0) {
    try {
      memoryContradictions = detectMemoryContradictions(input.userMemories);
      const memRes = retrieveContextualMemories(input.userMemories, input.instruction, {
        privacyMode: input.privacyMode,
        maxCount: 4,
        userId: input.userId ?? undefined,
      });
      if (memRes.formattedContext) {
        memoryContextBlock = memRes.formattedContext;
      }
    } catch (err) {
      recoveredErrors.push(
        reportExecutionError(
          {
            component: "agent_execution",
            error: err,
            agentId: "planning",
            currentOperation: "retrieve_contextual_memories",
          },
          sessionCtx,
        ),
      );
    }
  }

  let staleSnapshotWarning: string | undefined;
  if (input.snapshot && decision.requestClassification.includePageContext) {
    const staleCheck = isSnapshotStale(input.snapshot);
    if (staleCheck.stale) {
      staleSnapshotWarning = staleCheck.reason;
    }
  }

  const reusablePatterns = findReusablePatterns(
    input.instruction,
    input.snapshot?.origin || "*",
  );
  const contextBudgetResult = buildBudgetedTaskContext({
    instruction: input.instruction,
    memoriesText: memoryContextBlock,
    snapshotText: input.snapshot?.text?.slice(0, 8000),
    documentSummaryText: input.uploadedDocumentSummary
      ? `${input.uploadedDocumentSummary.fileName}: ${input.uploadedDocumentSummary.availableFields.join(", ")}`
      : undefined,
    history: input.history ?? undefined,
  });
  const alternativePlans = generatePlanAlternatives({
    intent: decision.brainIntent,
    instruction: input.instruction,
    hasSnapshot: Boolean(input.snapshot),
    hasDocument: Boolean(input.uploadedDocumentSummary || input.documents?.length || input.spreadsheetData?.length),
  });

  let structuredPage: StructuredPageRepresentation | undefined;
  let suggestedHighlightSelector: string | undefined;
  let spreadsheetAnalysis: SpreadsheetAnalysisResult | undefined;
  let crossFileResult: CrossFileComparisonResult | undefined;
  let researchReport: StructuredResearchReport | undefined;
  let dataAggregation: DataAggregationResult | undefined;
  let workflowDraft: ParsedNaturalWorkflow | undefined;
  const insightLines: string[] = [];

  if (input.snapshot && decision.requestClassification.includePageContext) {
    try {
      structuredPage = analyzePageIntelligence(input.snapshot);
      const pagination = evaluatePagination(input.snapshot);
      if (
        decision.brainIntent === "locate_element" ||
        /\b(?:click|open|hover|select)\b/i.test(input.instruction)
      ) {
        const ordinalMatch = resolveOrdinalTarget(input.snapshot, input.instruction);
        if (ordinalMatch) {
          suggestedHighlightSelector = ordinalMatch.selector;
          sessionCtx.lastTargetRef = {
            selector: ordinalMatch.selector,
            text: ordinalMatch.name,
            index: ordinalMatch.index,
            url: input.snapshot.url,
          };
          insightLines.push(
            `Ordinal target #${ordinalMatch.index + 1}: "${ordinalMatch.name}" (${ordinalMatch.selector})`,
          );
        } else if (
          /\b(?:this|that|it|use|iske|isko|ise)\b/i.test(input.instruction) &&
          sessionCtx.lastTargetRef?.selector
        ) {
          suggestedHighlightSelector = sessionCtx.lastTargetRef.selector;
          insightLines.push(
            `Resolved contextual reference to previous target: ${sessionCtx.lastTargetRef.text || sessionCtx.lastTargetRef.selector}`,
          );
        } else {
          const semantic = findSemanticTarget(structuredPage, input.instruction);
          if (semantic && (semantic.element.selector || semantic.element.ref)) {
            suggestedHighlightSelector =
              semantic.element.selector || `[data-buddy-ref="${semantic.element.ref}"]`;
            sessionCtx.lastTargetRef = {
              selector: suggestedHighlightSelector,
              text: semantic.element.name,
              role: semantic.element.role,
              url: input.snapshot.url,
            };
            insightLines.push(
              `Page Intelligence semantic match: ${semantic.element.name || semantic.element.role} (${suggestedHighlightSelector})`,
            );
          } else {
            const searchRes = searchContent(input.snapshot, input.instruction);
            if (searchRes.matched && searchRes.bestMatchSelector) {
              suggestedHighlightSelector = searchRes.bestMatchSelector;
            }
          }
        }
      }
      const visualState = detectVisualUiState(input.snapshot);
      if (visualState.warnings.length > 0) {
        insightLines.push(`Visual UI Alerts: ${visualState.warnings.join(" ")}`);
      }
      if (pagination.canGoNext) {
        insightLines.push("Pagination detected: additional pages exist beyond the current view.");
      }
      if (structuredPage.warnings.length > 0) {
        insightLines.push(`Page warnings: ${structuredPage.warnings.slice(0, 2).join("; ")}`);
      }
    } catch (err) {
      recoveredErrors.push(
        reportExecutionError(
          {
            component: "dom_interaction",
            error: err,
            agentId: "visual_understanding",
            currentOperation: "analyze_page_intelligence",
            pageUrl: input.snapshot.url,
          },
          sessionCtx,
        ),
      );
    }
  }

  if (decision.path === "fast_path") {
    const estTokens = Math.max(12, Math.ceil(input.instruction.length / 4));
    const telemetry = recordCostTelemetry(sessionCtx, {
      tokens: estTokens,
      path: "fast_path",
      costUsd: Number((estTokens * 0.0000004).toFixed(6)),
    });
    sessionCtx.executionHistory.push({
      timestamp: new Date().toISOString(),
      agentId: decision.agentsAssigned[0] || "communication",
      action: `fast_path:${decision.brainIntent}`,
      outcome: "ok",
      detail: decision.reason,
    });
    const proactiveSuggestions = generateProactiveSuggestions({
      preferences: input.proactivePreferences ?? undefined,
      checkpoints: sessionCtx.checkpoints,
      activeProjects: (input.userMemories ?? [])
        .filter((m) => m.kind === "active_project")
        .map((m) => ({ key: m.key, value: m.value })),
    });
    sessionMap.set(sessionCtx.sessionId, sessionCtx);
    const fastEpistemic = buildEpistemicBreakdown({ structuredPage });

    return {
      decision,
      sessionContext: sessionCtx,
      orchestration: {
        path: "fast_path",
        reason: decision.reason,
        brainIntent: decision.brainIntent,
        sessionId: sessionCtx.sessionId,
        taskId: sessionCtx.currentTask?.taskId ?? null,
        agentsAssigned: decision.agentsAssigned,
        capabilityIds: decision.capabilityIds,
        collaborationNotice: decision.collaboration.collaborationNotice,
        recommendedModel: decision.recommendedModel,
        subtaskCounts: {
          total: 0,
          completed: 0,
          pending: 0,
          failed: 0,
          awaitingApproval: 0,
        },
        blockedCapabilities,
      },
      structuredPage,
      suggestedHighlightSelector,
      memoryContextBlock,
      memoryContradictions: memoryContradictions.length > 0 ? memoryContradictions : undefined,
      reusablePatterns: reusablePatterns.length > 0 ? reusablePatterns : undefined,
      staleSnapshotWarning,
      alternativePlans,
      epistemicBreakdown: fastEpistemic,
      contextBudgetStats: {
        estimatedTokens: contextBudgetResult.estimatedTokens,
        truncatedSections: contextBudgetResult.truncatedSections,
        trimmedHistoryCount: contextBudgetResult.trimmedHistoryCount,
        untrustedSignals: contextBudgetResult.untrustedSignals,
      },
      engineInsightsBlock: insightLines.length > 0 ? insightLines.join("\n") : undefined,
      proactiveSuggestions,
      costTelemetry: telemetry,
      blockedByCapability,
      recoveredErrors,
    };
  }

  // MULTI-AGENT PATH: Build TaskNode DAG & execute via parallel DAG executor across 15 specialized agents
  const nowIso = new Date().toISOString();
  const taskId = `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  if (sessionCtx.currentTask && sessionCtx.currentTask.status === "completed") {
    sessionCtx.previousTasks.unshift({
      taskId: sessionCtx.currentTask.taskId,
      goal: sessionCtx.currentTask.goal,
      status: sessionCtx.currentTask.status,
      completedAt: sessionCtx.currentTask.updatedAt,
    });
    sessionCtx.previousTasks = sessionCtx.previousTasks.slice(0, 15);
  }

  const subtasks = buildMultiAgentSubtasks(taskId, decision, input);
  const taskNode: TaskNode = {
    taskId,
    goal: input.instruction.slice(0, 300),
    executionPath: "multi_agent_path",
    status: "executing",
    subtasks,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  const dagSummary = await executeTaskDag(
    sessionCtx,
    taskNode,
    {
      instruction: input.instruction,
      permissionLevel,
      consentGranted: Boolean(input.consentGranted),
      privacyMode: input.privacyMode,
      buddySlug: input.buddySlug,
      snapshot: input.snapshot,
      spreadsheetData: input.spreadsheetData,
      comparisonData: input.comparisonData,
      documents: input.documents,
      researchSources: input.researchSources,
      userMemories: input.userMemories,
      sessionContext: sessionCtx,
    },
    { maxConcurrency: 3, enableDynamicReplanning: true },
  );

  if (dagSummary.cycleError) {
    recoveredErrors.push(
      reportExecutionError(
        {
          component: "task_orchestration",
          error: new Error(`Invalid task DAG: ${dagSummary.cycleError}`),
          agentId: "planning",
          taskId,
          currentOperation: "validate_task_graph",
        },
        sessionCtx,
      ),
    );
  }

  // Hydrate structured results produced by the specialized agents
  const inter = sessionCtx.intermediateOutputs ?? {};
  if (inter["spreadsheetAnalysis"]) {
    spreadsheetAnalysis = inter["spreadsheetAnalysis"] as SpreadsheetAnalysisResult;
    insightLines.push(`Spreadsheet Analysis: ${spreadsheetAnalysis.summary}`);
  }
  if (inter["crossFileResult"]) {
    crossFileResult = inter["crossFileResult"] as CrossFileComparisonResult;
    insightLines.push(`Dataset Comparison: ${crossFileResult.auditSummary}`);
  }
  if (inter["researchReport"]) {
    researchReport = inter["researchReport"] as StructuredResearchReport;
    insightLines.push(`Research Summary: ${researchReport.executiveSummary}`);
  }
  if (inter["dataAggregation"]) {
    dataAggregation = inter["dataAggregation"] as DataAggregationResult;
    insightLines.push(`Aggregated page records: ${dataAggregation.totalRecords} item(s).`);
  }
  for (const res of Object.values(dagSummary.agentResults)) {
    if (res.data?.["parsedWorkflow"]) {
      workflowDraft = res.data["parsedWorkflow"] as ParsedNaturalWorkflow;
    }
    if (!res.ok && res.error) {
      recoveredErrors.push(
        reportExecutionError(
          {
            component: "agent_execution",
            error: new Error(res.error),
            agentId: res.agentId,
            taskId,
            currentOperation: res.summary,
            pageUrl: input.snapshot?.url,
          },
          sessionCtx,
        ),
      );
    }
  }
  if (
    !workflowDraft &&
    /\b(?:every\s+day|daily|weekly|hourly|schedule|har\s+roz|workflow\s+create)\b/i.test(
      input.instruction,
    )
  ) {
    workflowDraft = parseNaturalLanguageWorkflow(input.instruction);
  }

  syncSessionSubtaskBuckets(sessionCtx);

  const estTokens = Math.max(40, Math.ceil(input.instruction.length / 4) + subtasks.length * 45);
  const telemetry = recordCostTelemetry(sessionCtx, {
    tokens: estTokens,
    path: "multi_agent_path",
    costUsd: Number((estTokens * 0.0000012).toFixed(6)),
  });

  const proactiveSuggestions = generateProactiveSuggestions({
    preferences: input.proactivePreferences ?? undefined,
    checkpoints: sessionCtx.checkpoints,
    spreadsheetAnalysis,
    crossFileResult,
    activeProjects: (input.userMemories ?? [])
      .filter((m) => m.kind === "active_project")
      .map((m) => ({ key: m.key, value: m.value })),
  });

  const awaitingApproval = dagSummary.awaitingApprovalIds.length;
  const subtaskDetails: SubtaskDetailView[] = taskNode.subtasks.map((st) => {
    const def = getAgentDefinition(st.agentId);
    return {
      taskId: st.taskId,
      title: st.title,
      agentId: st.agentId,
      agentName: def.name,
      responsibility: def.responsibility,
      status: st.status,
      dependencies: st.dependencies,
      retryCount: st.retryCount,
      verified: Boolean(st.verification?.verified),
      durationMs: st.durationMs,
      error: st.error?.message,
    };
  });

  sessionMap.set(sessionCtx.sessionId, sessionCtx);
  const fullEpistemic = buildEpistemicBreakdown({
    structuredPage,
    dataAggregation,
    researchReport,
    crossFileResult,
  });

  if (dagSummary.failedIds.length === 0 && dagSummary.completedIds.length > 0 && !input.privacyMode) {
    recordVerifiedExecutionPattern({
      intent: input.instruction,
      domainOrigin: input.snapshot?.origin || "*",
      actionSequence: taskNode.subtasks
        .filter((s) => s.status === "completed")
        .map((s) => `${s.agentId}:${s.capabilityId}`),
      summary: `Verified ${dagSummary.completedIds.length} subtask(s) via ${decision.brainIntent}`,
      ok: true,
      verified: true,
    });
  }

  return {
    decision,
    sessionContext: sessionCtx,
    orchestration: {
      path: "multi_agent_path",
      reason: decision.reason,
      brainIntent: decision.brainIntent,
      sessionId: sessionCtx.sessionId,
      taskId: taskNode.taskId,
      agentsAssigned: Array.from(
        new Set([...decision.agentsAssigned, ...taskNode.subtasks.map((s) => s.agentId)]),
      ),
      capabilityIds: decision.capabilityIds,
      collaborationNotice: decision.collaboration.collaborationNotice,
      recommendedModel: decision.recommendedModel,
      subtaskCounts: {
        total: taskNode.subtasks.length,
        completed: sessionCtx.completedSubtasks.length,
        pending: sessionCtx.pendingSubtasks.length,
        failed: sessionCtx.failedSubtasks.length,
        awaitingApproval,
      },
      subtaskDetails,
      dagSummary: {
        parallelWaves: dagSummary.parallelWaves,
        maxObservedConcurrency: dagSummary.maxObservedConcurrency,
        replannedSubtasks: dagSummary.replannedSubtasks,
      },
      blockedCapabilities,
    },
    structuredPage,
    spreadsheetAnalysis,
    crossFileResult,
    researchReport,
    dataAggregation,
    suggestedHighlightSelector,
    memoryContextBlock,
    memoryContradictions: memoryContradictions.length > 0 ? memoryContradictions : undefined,
    reusablePatterns: reusablePatterns.length > 0 ? reusablePatterns : undefined,
    staleSnapshotWarning,
    alternativePlans,
    epistemicBreakdown: fullEpistemic,
    contextBudgetStats: {
      estimatedTokens: contextBudgetResult.estimatedTokens,
      truncatedSections: contextBudgetResult.truncatedSections,
      trimmedHistoryCount: contextBudgetResult.trimmedHistoryCount,
      untrustedSignals: contextBudgetResult.untrustedSignals,
    },
    engineInsightsBlock: insightLines.length > 0 ? insightLines.join("\n") : undefined,
    proactiveSuggestions,
    workflowDraft,
    costTelemetry: telemetry,
    blockedByCapability,
    recoveredErrors,
  };
}
