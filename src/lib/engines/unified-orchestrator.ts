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
  acquireSubtaskLocks,
  createTaskSessionContext,
  getExecutableParallelSubtasks,
  releaseSubtaskLocks,
  syncSessionSubtaskBuckets,
  validateTaskGraphDependencies,
  type ExecutionPath,
  type SpecialistAgentId,
  type Subtask,
  type TaskNode,
  type TaskSessionContext,
} from "@/shared/task-context";
import { createTaskCheckpoint } from "@/shared/task-checkpoint";
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
  classifyBrainIntent,
  determineCollaboratingBuddies,
  parseTaskControlCommand,
  recommendOptimalModel,
  type BrainIntent,
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
  aggregateRecords,
  analyzeSpreadsheetData,
  type DataAggregationResult,
  type SpreadsheetAnalysisResult,
} from "./data-intelligence-engine";
import {
  compareSpreadsheetFiles,
  type CrossFileComparisonResult,
  type WorkspaceDocument,
} from "./file-workspace-engine";
import {
  analyzeMultiSourceResearch,
  type ResearchSource,
  type StructuredResearchReport,
} from "./research-engine";
import { retrieveContextualMemories, type MemoryRecord } from "./memory-engine";

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
  engineInsightsBlock?: string;
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
  let prevId: string | null = null;

  const pushTask = (
    suffix: string,
    title: string,
    agentId: SpecialistAgentId,
    capabilityId: string,
    opts?: { fileOwnership?: string | null; tabOwnership?: number | null },
  ) => {
    const cap = getCapability(capabilityId);
    const id = `${parentTaskId}_${suffix}`;
    subtasks.push({
      taskId: id,
      parentTaskId,
      title,
      agentId,
      capabilityId,
      dependencies: prevId ? [prevId] : [],
      status: "pending",
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
    prevId = id;
  };

  if (input.snapshot) {
    pushTask("observe", "Observe active webpage DOM", "browser", "observe_webpage");
  }

  if (decision.brainIntent === "smart_form_fill") {
    pushTask("fill", "Resolve target form fields and enter values", "form_automation", "fill_form");
    pushTask(
      "verify",
      "Verify field values without accidental submit",
      "verification",
      "verify_outcome",
    );
  } else if (decision.brainIntent === "spreadsheet_audit") {
    pushTask(
      "sheet",
      "Analyze spreadsheet columns and anomalies",
      "spreadsheet",
      "process_spreadsheet",
      {
        fileOwnership: input.uploadedDocumentSummary?.fileName ?? "active_spreadsheet",
      },
    );
  } else if (
    decision.brainIntent === "cross_file_comparison" ||
    decision.brainIntent === "universal_task"
  ) {
    pushTask(
      "compare",
      "Compare datasets and detect discrepancies",
      "spreadsheet",
      "compare_datasets",
      {
        fileOwnership: input.uploadedDocumentSummary?.fileName ?? "comparison_dataset",
      },
    );
    pushTask(
      "report",
      "Synthesize structured reconciliation report",
      "analysis",
      "generate_report",
    );
  } else if (decision.brainIntent === "multi_source_research") {
    pushTask("research", "Cross-reference multi-source evidence", "research", "search_web");
  } else if (decision.brainIntent === "aggregate_data") {
    pushTask(
      "agg",
      "Aggregate webpage records deterministically",
      "data_extraction",
      "calculate_values",
    );
  } else {
    const primaryCap = decision.capabilityIds[0] || "maintain_checkpoints";
    const primaryAgent = decision.agentsAssigned[0] || "planning";
    pushTask("exec", "Execute orchestrated workflow step", primaryAgent, primaryCap);
    pushTask("verify", "Verify task outcome against state", "verification", "verify_outcome");
  }

  return subtasks;
}

/**
 * Executes the Unified Central Orchestrator over an incoming request,
 * updating TaskSessionContext, dispatching engines, checking capabilities,
 * and hooking errors into Self-Healing.
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

  // Restore or initialize shared TaskSessionContext
  const sessionMap = getSessionMap();
  const existingSession = input.sessionContext?.sessionId
    ? (sessionMap.get(input.sessionContext.sessionId) ?? input.sessionContext)
    : (input.sessionContext ?? null);

  const sessionCtx =
    existingSession ??
    createTaskSessionContext({
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

  // Check planned / unavailable or permission-gated capabilities honestly
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

  // Retrieve contextual memories if available
  let memoryContextBlock: string | undefined;
  if (input.userMemories && input.userMemories.length > 0) {
    try {
      const memRes = retrieveContextualMemories(input.userMemories, input.instruction, {
        privacyMode: input.privacyMode,
        maxCount: 4,
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

  let structuredPage: StructuredPageRepresentation | undefined;
  let suggestedHighlightSelector: string | undefined;
  let spreadsheetAnalysis: SpreadsheetAnalysisResult | undefined;
  let crossFileResult: CrossFileComparisonResult | undefined;
  let researchReport: StructuredResearchReport | undefined;
  let dataAggregation: DataAggregationResult | undefined;
  const insightLines: string[] = [];

  // Run lightweight page intelligence even on fast_path when page snapshot is relevant
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
    sessionCtx.executionHistory.push({
      timestamp: new Date().toISOString(),
      agentId: decision.agentsAssigned[0] || "communication",
      action: `fast_path:${decision.brainIntent}`,
      outcome: "ok",
      detail: decision.reason,
    });
    sessionMap.set(sessionCtx.sessionId, sessionCtx);

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
      engineInsightsBlock: insightLines.length > 0 ? insightLines.join("\n") : undefined,
      blockedByCapability,
      recoveredErrors,
    };
  }

  // MULTI-AGENT PATH: Build TaskNode DAG, validate dependencies, enforce locks, run relevant engines
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
  const dagCheck = validateTaskGraphDependencies(subtasks);
  if (!dagCheck.valid) {
    recoveredErrors.push(
      reportExecutionError(
        {
          component: "task_orchestration",
          error: new Error(`Invalid task DAG: ${dagCheck.errors.join("; ")}`),
          agentId: "planning",
          taskId,
          currentOperation: "validate_task_graph",
        },
        sessionCtx,
      ),
    );
  }

  const taskNode: TaskNode = {
    taskId,
    goal: input.instruction.slice(0, 300),
    executionPath: "multi_agent_path",
    status: "executing",
    subtasks,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  sessionCtx.currentTask = taskNode;

  // Execute ready DAG subtasks safely with tab/file lock acquisition
  for (let pass = 0; pass < subtasks.length + 2; pass++) {
    const ready = getExecutableParallelSubtasks(sessionCtx);
    if (ready.length === 0) break;

    for (const st of ready) {
      if (!acquireSubtaskLocks(sessionCtx, st)) continue;
      st.status = "running";
      st.startedAt = new Date().toISOString();

      try {
        if (st.capabilityId === "process_spreadsheet" && input.spreadsheetData) {
          spreadsheetAnalysis = analyzeSpreadsheetData(input.spreadsheetData);
          st.output = {
            rowCount: spreadsheetAnalysis.rowCount,
            anomalies: spreadsheetAnalysis.anomalies.length,
          };
          insightLines.push(`Spreadsheet Analysis: ${spreadsheetAnalysis.summary}`);
        } else if (
          st.capabilityId === "compare_datasets" &&
          input.spreadsheetData &&
          input.comparisonData
        ) {
          crossFileResult = compareSpreadsheetFiles({
            baseData: input.spreadsheetData,
            compareData: input.comparisonData,
            keyField: "id",
            compareFields: ["price", "status"],
            baseFileName: "Primary Dataset",
            compareFileName: "Comparison Dataset",
          });
          st.output = {
            discrepancies: crossFileResult.discrepancies.length,
            missingInComparison: crossFileResult.missingInComparison.length,
          };
          insightLines.push(`Dataset Comparison: ${crossFileResult.auditSummary}`);
        } else if (st.capabilityId === "search_web" && input.researchSources?.length) {
          researchReport = analyzeMultiSourceResearch({
            topic: input.instruction,
            sources: input.researchSources,
            claimsToEvaluate: [{ claim: input.instruction, suggestedCategory: "hypothesis" }],
          });
          st.output = { sourcesAnalyzed: researchReport.sourcesAnalyzed };
          insightLines.push(`Research Summary: ${researchReport.executiveSummary}`);
        } else if (st.capabilityId === "calculate_values" && input.snapshot?.statusCounts) {
          const counts = input.snapshot.statusCounts;
          const total = Object.values(counts).reduce((a, b) => a + b, 0);
          dataAggregation = aggregateRecords([], {
            pagesInspected: 1,
            hasMorePages: Boolean(input.snapshot.pagination?.hasNextPage),
          });
          dataAggregation.statusCounts = counts;
          dataAggregation.totalRecords = total;
          dataAggregation.uniqueRecords = total;
          st.output = { totalRecords: total };
          insightLines.push(`Aggregated page records: ${total} item(s).`);
        } else if (st.capabilityId === "observe_webpage" && structuredPage) {
          st.output = {
            forms: structuredPage.formInputCount,
            controls: structuredPage.interactiveControlCount,
          };
        } else {
          st.output = { planned: true };
        }

        st.status = "completed";
        st.completedAt = new Date().toISOString();
        sessionCtx.executionHistory.push({
          timestamp: st.completedAt,
          agentId: st.agentId,
          subtaskId: st.taskId,
          action: st.capabilityId,
          outcome: "ok",
          detail: st.title,
        });
      } catch (err) {
        st.status = "failed";
        const { report, recovery } = reportExecutionError(
          {
            component: "agent_execution",
            error: err,
            agentId: st.agentId,
            taskId: st.taskId,
            capabilityId: st.capabilityId,
            currentOperation: st.title,
            pageUrl: input.snapshot?.url,
          },
          sessionCtx,
        );
        st.error = {
          code: report.attribution,
          message: report.errorMessage,
          attribution: report.attribution,
          recoverable: recovery.canAutoExecute,
          timestamp: report.timestamp,
          fingerprint: report.fingerprint,
        };
        recoveredErrors.push({ report, recovery });
      } finally {
        releaseSubtaskLocks(sessionCtx, st.taskId);
      }
    }
  }

  // Persist TaskCheckpoint on session
  const checkpoint = createTaskCheckpoint({
    taskId,
    title: input.instruction.slice(0, 60),
    goal: input.instruction,
    steps: subtasks.map((s) => ({
      id: s.taskId,
      label: s.title,
      actionType: s.capabilityId,
    })),
    pageUrl: input.snapshot?.url,
    pageOrigin: input.snapshot?.origin,
    buddySlug: input.buddySlug ?? undefined,
  });
  sessionCtx.checkpoints.unshift(checkpoint);
  sessionCtx.checkpoints = sessionCtx.checkpoints.slice(0, 10);

  syncSessionSubtaskBuckets(sessionCtx);

  const awaitingApproval = subtasks.filter((s) => s.status === "awaiting_approval").length;
  taskNode.status =
    sessionCtx.failedSubtasks.length > 0
      ? sessionCtx.completedSubtasks.length > 0
        ? "partially_completed"
        : "failed"
      : sessionCtx.pendingSubtasks.length > 0
        ? "planned"
        : "completed";
  taskNode.updatedAt = new Date().toISOString();

  sessionMap.set(sessionCtx.sessionId, sessionCtx);

  return {
    decision,
    sessionContext: sessionCtx,
    orchestration: {
      path: "multi_agent_path",
      reason: decision.reason,
      brainIntent: decision.brainIntent,
      sessionId: sessionCtx.sessionId,
      taskId: taskNode.taskId,
      agentsAssigned: decision.agentsAssigned,
      capabilityIds: decision.capabilityIds,
      collaborationNotice: decision.collaboration.collaborationNotice,
      recommendedModel: decision.recommendedModel,
      subtaskCounts: {
        total: subtasks.length,
        completed: sessionCtx.completedSubtasks.length,
        pending: sessionCtx.pendingSubtasks.length,
        failed: sessionCtx.failedSubtasks.length,
        awaitingApproval,
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
    engineInsightsBlock: insightLines.length > 0 ? insightLines.join("\n") : undefined,
    blockedByCapability,
    recoveredErrors,
  };
}
