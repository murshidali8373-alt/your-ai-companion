/**
 * Registry of all 15 specialized autonomous agents for AI Buddy 2.0.
 * Maps user objectives cleanly to agent teams and initial DAG topologies.
 */

import {
  SPECIALIZED_AGENT_IDS,
  type AgentSubtaskSpec,
  type Phase3AgentId,
  type SpecializedAgentDefinition,
} from "./types";

export const SPECIALIZED_AGENT_REGISTRY: Record<Phase3AgentId, SpecializedAgentDefinition> = {
  planning: {
    id: "planning",
    name: "Planning Agent",
    role: "Decomposes complex objectives into dependency-aware parallel and sequential subtasks.",
    capabilities: ["plan_dag", "replan_on_failure", "assign_agents"],
    requiredPermission: "explain",
    supportsParallelExecution: false,
    requiresApprovalForSideEffects: false,
  },
  browser: {
    id: "browser",
    name: "Browser Agent",
    role: "Executes grounded clicks, toggles, tab switches, and DOM interactions safely.",
    capabilities: ["observe_webpage", "click_element", "hover_element", "switch_tab"],
    requiredPermission: "assist",
    supportsParallelExecution: false,
    requiresApprovalForSideEffects: true,
  },
  research: {
    id: "research",
    name: "Research Agent",
    role: "Synthesizes multi-source findings, flags contradictions, and preserves verifiable citations.",
    capabilities: ["search_web", "cross_reference_sources", "detect_contradictions"],
    requiredPermission: "explain",
    supportsParallelExecution: true,
    requiresApprovalForSideEffects: false,
  },
  data_intelligence: {
    id: "data_intelligence",
    name: "Data Intelligence Agent",
    role: "Extracts, normalizes, deduplicates, detects outliers/missing values, and computes exact stats.",
    capabilities: [
      "extract_structured_data",
      "normalize_records",
      "detect_outliers",
      "calculate_values",
    ],
    requiredPermission: "explain",
    supportsParallelExecution: true,
    requiresApprovalForSideEffects: false,
  },
  spreadsheet: {
    id: "spreadsheet",
    name: "Spreadsheet Agent",
    role: "Understands XLSX/CSV formulas, anomalies, and applies non-destructive style-preserving updates.",
    capabilities: ["process_spreadsheet", "compare_datasets", "edit_xlsx_cells"],
    requiredPermission: "explain",
    supportsParallelExecution: true,
    requiresApprovalForSideEffects: true,
  },
  document: {
    id: "document",
    name: "Document Agent",
    role: "Reads and generates structured DOCX, PDF, and Markdown deliverables with real re-open checks.",
    capabilities: ["parse_docx_pdf", "generate_docx", "generate_pdf", "generate_report"],
    requiredPermission: "explain",
    supportsParallelExecution: true,
    requiresApprovalForSideEffects: false,
  },
  file_workspace: {
    id: "file_workspace",
    name: "File Workspace Agent",
    role: "Manages scoped file storage, comparison, merge, and downloadable artifact lifecycle.",
    capabilities: ["read_workspace_file", "compare_files", "export_workspace_artifact"],
    requiredPermission: "explain",
    supportsParallelExecution: true,
    requiresApprovalForSideEffects: false,
  },
  form_filling: {
    id: "form_filling",
    name: "Form Filling Agent",
    role: "Maps profile or uploaded document data onto web forms with sensitive-field protection.",
    capabilities: ["fill_form", "validate_form_errors", "select_custom_dropdown"],
    requiredPermission: "assist",
    supportsParallelExecution: false,
    requiresApprovalForSideEffects: true,
  },
  navigation: {
    id: "navigation",
    name: "Navigation Agent",
    role: "Handles multi-page pagination, ordinal selection, scrolling, and multi-tab navigation.",
    capabilities: ["paginate", "scroll_until_text", "open_tab", "resolve_ordinal"],
    requiredPermission: "assist",
    supportsParallelExecution: false,
    requiresApprovalForSideEffects: false,
  },
  visual_intelligence: {
    id: "visual_intelligence",
    name: "Visual Intelligence Agent",
    role: "Detects blockers, modals, spinners, layout state, and visual DOM coordinates.",
    capabilities: ["locate_element", "highlight_element", "detect_visual_state"],
    requiredPermission: "explain",
    supportsParallelExecution: true,
    requiresApprovalForSideEffects: false,
  },
  workflow_automation: {
    id: "workflow_automation",
    name: "Workflow Automation Agent",
    role: "Compiles natural language into recurring schedules, triggers, and parameterizable recipes.",
    capabilities: ["compile_workflow", "schedule_workflow", "execute_recipe"],
    requiredPermission: "assist",
    supportsParallelExecution: true,
    requiresApprovalForSideEffects: true,
  },
  verification: {
    id: "verification",
    name: "Verification Agent",
    role: "Audits subtask outputs, verifies exported files re-open cleanly, and enforces provenance.",
    capabilities: ["verify_outcome", "audit_provenance", "verify_file_reopen"],
    requiredPermission: "explain",
    supportsParallelExecution: true,
    requiresApprovalForSideEffects: false,
  },
  memory: {
    id: "memory",
    name: "Memory Agent",
    role: "Retrieves and updates 8-category long-term preferences and active projects while blocking secrets.",
    capabilities: ["retrieve_memory", "update_memory", "detect_memory_conflict"],
    requiredPermission: "explain",
    supportsParallelExecution: true,
    requiresApprovalForSideEffects: false,
  },
  communication: {
    id: "communication",
    name: "Communication Agent",
    role: "Summarizes threads, extracts action items, and drafts external messages with mandatory send approval.",
    capabilities: [
      "summarize_thread",
      "extract_action_items",
      "draft_reply",
      "send_approved_message",
    ],
    requiredPermission: "assist",
    supportsParallelExecution: true,
    requiresApprovalForSideEffects: true,
  },
  self_healing: {
    id: "self_healing",
    name: "Self-Healing Agent",
    role: "Captures sanitized failures, diagnoses root causes, and recommends bounded recovery strategies.",
    capabilities: ["diagnose_failure", "plan_recovery", "trigger_replan"],
    requiredPermission: "explain",
    supportsParallelExecution: true,
    requiresApprovalForSideEffects: false,
  },
};

export function listSpecializedAgents(): SpecializedAgentDefinition[] {
  return SPECIALIZED_AGENT_IDS.map((id) => SPECIALIZED_AGENT_REGISTRY[id]);
}

export function selectAgentsForObjective(
  objective: string,
  context?: {
    hasFiles?: boolean;
    hasSpreadsheet?: boolean;
    hasComparisonFiles?: boolean;
    hasSnapshot?: boolean;
    hasResearchSources?: boolean;
    hasCommunications?: boolean;
    wantsWorkflow?: boolean;
  },
): Phase3AgentId[] {
  const lower = objective.toLowerCase();
  const selected = new Set<Phase3AgentId>(["planning", "memory", "verification"]);

  if (
    context?.hasSpreadsheet ||
    context?.hasComparisonFiles ||
    /\b(?:excel|xlsx|csv|spreadsheet|sheet|sku|price|reconcile|compare|duplicate|anomaly|outliers?)\b/i.test(
      lower,
    )
  ) {
    selected.add("spreadsheet");
    selected.add("data_intelligence");
    selected.add("file_workspace");
  }

  if (
    context?.hasFiles ||
    /\b(?:pdf|docx|word|document|report|export|download|merge|summarize file)\b/i.test(lower)
  ) {
    selected.add("document");
    selected.add("file_workspace");
  }

  if (
    context?.hasResearchSources ||
    /\b(?:research|sources?|citations?|fact[-\s]?check|market|compare\s+vendors|rules|policy)\b/i.test(
      lower,
    )
  ) {
    selected.add("research");
    selected.add("data_intelligence");
  }

  if (
    context?.hasSnapshot ||
    /\b(?:page|click|scroll|navigate|next\s+page|tab|button|portal|meesho|amazon|flipkart)\b/i.test(
      lower,
    )
  ) {
    selected.add("browser");
    selected.add("navigation");
    selected.add("visual_intelligence");
  }

  if (/\b(?:fill|form|checkout|address|kyc|gst|input|dropdown)\b/i.test(lower)) {
    selected.add("form_filling");
  }

  if (
    context?.wantsWorkflow ||
    /\b(?:every\s+(?:day|morning|hour|week|monday)|schedule|cron|automate|recurring|workflow)\b/i.test(
      lower,
    )
  ) {
    selected.add("workflow_automation");
  }

  if (
    context?.hasCommunications ||
    /\b(?:email|gmail|slack|draft|reply|follow[-\s]?up|message|action\s+items|calendar)\b/i.test(
      lower,
    )
  ) {
    selected.add("communication");
  }

  if (selected.size <= 3) {
    selected.add("data_intelligence");
    selected.add("research");
  }

  return Array.from(selected);
}

/**
 * Generates an initial parallelizable DAG plan for a multi-agent objective.
 * Independent read/analysis branches have empty dependencies so they execute in parallel.
 */
export function buildObjectiveDagPlan(params: {
  runId: string;
  objective: string;
  selectedAgents: Phase3AgentId[];
  fileName?: string | undefined;
  comparisonFileName?: string | undefined;
  tabId?: number | null | undefined;
  outputFormats?: Array<"xlsx" | "docx" | "pdf" | "markdown"> | undefined;
  requiresSendApproval?: boolean | undefined;
}): AgentSubtaskSpec[] {
  const { runId, objective, selectedAgents, fileName, comparisonFileName, tabId } = params;
  const subtasks: AgentSubtaskSpec[] = [];
  const has = (id: Phase3AgentId) => selectedAgents.includes(id);

  const memoryId = `${runId}_mem`;
  subtasks.push({
    id: memoryId,
    title: "Retrieve contextual long-term preferences & active projects",
    agentId: "memory",
    capabilityId: "retrieve_memory",
    dependencies: [],
    priority: 100,
    retryLimit: 1,
    retryCount: 0,
    status: "pending",
  });

  const parallelAnalysisIds: string[] = [];

  if (has("browser") || has("navigation")) {
    const navId = `${runId}_nav`;
    subtasks.push({
      id: navId,
      title: "Inspect page structure & navigation targets",
      agentId: "browser",
      capabilityId: "observe_webpage",
      dependencies: [],
      priority: 90,
      retryLimit: 2,
      retryCount: 0,
      tabOwnership: tabId ?? null,
      status: "pending",
    });
    parallelAnalysisIds.push(navId);
  }

  if (has("research")) {
    const resId = `${runId}_research`;
    subtasks.push({
      id: resId,
      title: "Cross-reference sources & categorize verified facts vs unknowns",
      agentId: "research",
      capabilityId: "cross_reference_sources",
      dependencies: [memoryId],
      priority: 85,
      retryLimit: 2,
      retryCount: 0,
      status: "pending",
    });
    parallelAnalysisIds.push(resId);
  }

  if (has("spreadsheet") || has("data_intelligence") || fileName) {
    const dataId = `${runId}_data`;
    subtasks.push({
      id: dataId,
      title: comparisonFileName
        ? `Compare "${fileName || "Base"}" vs "${comparisonFileName}"`
        : `Normalize & analyze dataset${fileName ? ` (${fileName})` : ""}`,
      agentId: has("spreadsheet") ? "spreadsheet" : "data_intelligence",
      capabilityId: comparisonFileName ? "compare_datasets" : "extract_structured_data",
      dependencies: [memoryId],
      priority: 90,
      retryLimit: 2,
      retryCount: 0,
      fileOwnership: fileName || null,
      status: "pending",
    });
    parallelAnalysisIds.push(dataId);
  }

  if (has("form_filling")) {
    const formId = `${runId}_form`;
    subtasks.push({
      id: formId,
      title: "Map profile/document fields safely onto target form controls",
      agentId: "form_filling",
      capabilityId: "fill_form",
      dependencies: parallelAnalysisIds.filter((id) => id.endsWith("_nav")),
      priority: 75,
      retryLimit: 1,
      retryCount: 0,
      tabOwnership: tabId ?? null,
      requiresApproval: false,
      status: "pending",
    });
    parallelAnalysisIds.push(formId);
  }

  if (has("communication")) {
    const commId = `${runId}_comm`;
    subtasks.push({
      id: commId,
      title: "Draft communication & extract action items",
      agentId: "communication",
      capabilityId: "draft_reply",
      dependencies: [memoryId],
      priority: 70,
      retryLimit: 1,
      retryCount: 0,
      requiresApproval: Boolean(params.requiresSendApproval || /\bsend\b/i.test(objective)),
      approved: false,
      status: "pending",
    });
    parallelAnalysisIds.push(commId);
  }

  if (has("workflow_automation")) {
    const wfId = `${runId}_workflow`;
    subtasks.push({
      id: wfId,
      title: "Compile recurring workflow definition for confirmation",
      agentId: "workflow_automation",
      capabilityId: "compile_workflow",
      dependencies: [memoryId],
      priority: 65,
      retryLimit: 1,
      retryCount: 0,
      status: "pending",
    });
    parallelAnalysisIds.push(wfId);
  }

  const docDeps = parallelAnalysisIds.length > 0 ? parallelAnalysisIds : [memoryId];
  const docId = `${runId}_doc`;
  if (has("document") || has("file_workspace") || params.outputFormats?.length) {
    subtasks.push({
      id: docId,
      title: "Synthesize structured findings & build verified artifacts",
      agentId: "document",
      capabilityId: "generate_report",
      dependencies: docDeps,
      priority: 50,
      retryLimit: 1,
      retryCount: 0,
      status: "pending",
    });
  }

  const verifyDeps = subtasks.some((s) => s.id === docId) ? [docId] : docDeps;
  subtasks.push({
    id: `${runId}_verify`,
    title: "Verify provenance, arithmetic totals, & artifact integrity",
    agentId: "verification",
    capabilityId: "verify_outcome",
    dependencies: verifyDeps,
    priority: 10,
    retryLimit: 1,
    retryCount: 0,
    status: "pending",
  });

  return subtasks;
}
