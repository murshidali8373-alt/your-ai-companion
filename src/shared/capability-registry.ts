/**
 * UNIFIED TYPED CAPABILITY REGISTRY (AI Buddy 2.0 — Phase 1 Core Intelligence)
 *
 * Single source of truth for every browser, file, research, analysis, communication,
 * and self-healing capability in AI Buddy. Each capability declares:
 * - ID & category
 * - Input & output validation metadata (Zod schemas)
 * - Minimum PermissionLevel required
 * - Execution target (extension DOM, extension SW, server orchestrator, hybrid)
 * - Verification strategy & consequential-action flag
 * - Honest availability status ("implemented" | "partially_supported" | "planned" | "unavailable")
 */

import { z } from "zod";
import { can, type PermissionLevel } from "./permissions";

export type CapabilityStatus = "implemented" | "partially_supported" | "planned" | "unavailable";

export type CapabilityCategory =
  | "perception"
  | "navigation"
  | "interaction"
  | "forms"
  | "data_extraction"
  | "files_and_spreadsheets"
  | "research_and_analysis"
  | "communication"
  | "workflow_control"
  | "self_healing"
  | "system";

export type ExecutionTarget =
  "extension_dom" | "extension_sw" | "server_orchestrator" | "server_self_heal" | "hybrid";

export interface RetryPolicy {
  maxRetries: number;
  backoffMs: number;
  retryOn: string[];
}

export interface CapabilityDefinition<TInput extends z.ZodTypeAny = z.ZodTypeAny> {
  id: string;
  name: string;
  category: CapabilityCategory;
  description: string;
  inputSchema: TInput;
  outputSchema?: z.ZodTypeAny;
  outputDescription: string;
  requiredPermission: PermissionLevel;
  executionTarget: ExecutionTarget;
  timeoutMs?: number;
  retryPolicy?: RetryPolicy;
  verificationStrategy: string;
  isConsequential: boolean;
  status: CapabilityStatus;
  notes?: string;
}

const selectorInput = z.object({
  selector: z.string().min(1).max(600),
  textTarget: z.string().max(300).optional(),
  frameId: z.number().optional(),
});

const emptyOrAny = z.record(z.unknown()).default({});
const genericActionOutput = z.object({
  ok: z.boolean(),
  verified: z.boolean().optional(),
  message: z.string().optional(),
  selector: z.string().optional(),
  error: z.string().optional(),
});

export const CAPABILITY_REGISTRY: CapabilityDefinition[] = [
  // 1-4: Perception
  {
    id: "observe_webpage",
    name: "Observe Webpage",
    category: "perception",
    description:
      "Capture bounded, privacy-filtered snapshot of headings, forms, controls, alerts, and visible text.",
    inputSchema: z
      .object({ tabId: z.number().optional(), includeHidden: z.boolean().optional() })
      .default({}),
    outputDescription: "Structured PageSnapshot with element refs and pageCompleteness.",
    requiredPermission: "observe",
    executionTarget: "extension_dom",
    verificationStrategy: "Confirm non-empty snapshot URL and valid DOM capture timestamp.",
    isConsequential: false,
    status: "implemented",
  },
  {
    id: "read_visible_content",
    name: "Read Visible Content",
    category: "perception",
    description: "Extract readable page sections, headings, alerts, and selected region text.",
    inputSchema: z
      .object({ query: z.string().max(300).optional(), maxChars: z.number().max(50000).optional() })
      .default({}),
    outputDescription: "Clean normalized text and structured sections.",
    requiredPermission: "observe",
    executionTarget: "extension_dom",
    verificationStrategy: "Verify extracted character count > 0 on accessible pages.",
    isConsequential: false,
    status: "implemented",
  },
  {
    id: "inspect_dom",
    name: "Inspect DOM & Shadow DOM",
    category: "perception",
    description: "Inspect accessible DOM, same-origin iframes, and open Shadow DOM roots safely.",
    inputSchema: z.object({ selector: z.string().max(600).optional() }).default({}),
    outputDescription: "Element metadata, role, attributes, and >>> shadow selector chain.",
    requiredPermission: "observe",
    executionTarget: "extension_dom",
    verificationStrategy:
      "Confirm element bounding rect and tag/role attribution without exposing passwords.",
    isConsequential: false,
    status: "implemented",
  },
  {
    id: "capture_screenshot",
    name: "Capture Tab Screenshot",
    category: "perception",
    description:
      "Capture visible browser tab screenshot for multimodal visual inspection when DOM is sparse.",
    inputSchema: z.object({ windowId: z.number().optional() }).default({}),
    outputDescription: "JPEG base64 data URL of visible viewport.",
    requiredPermission: "observe",
    executionTarget: "extension_sw",
    verificationStrategy: "Confirm data:image payload size > 0 and non-restricted active tab.",
    isConsequential: false,
    status: "implemented",
  },
  // 5-9: Navigation & Pointing
  {
    id: "scroll_intelligent",
    name: "Scroll Webpage or Container",
    category: "navigation",
    description:
      "Scroll viewport or nested scrollable container up, down, top, bottom, or by pixel amount.",
    inputSchema: z.object({
      direction: z.enum(["up", "down", "left", "right", "top", "bottom"]).default("down"),
      amount: z.number().optional(),
      containerSelector: z.string().max(600).optional(),
    }),
    outputDescription: "Updated scrollTop/scrollLeft offsets and remaining content indicator.",
    requiredPermission: "assist",
    executionTarget: "extension_dom",
    verificationStrategy: "Compare scroll offset before vs after scroll event.",
    isConsequential: false,
    status: "implemented",
  },
  {
    id: "locate_element",
    name: "Locate Element",
    category: "perception",
    description:
      "Resolve exact button, link, tab, row, or field via semantic label, role, or alternate targets.",
    inputSchema: z.object({ query: z.string().min(1).max(300), role: z.string().optional() }),
    outputDescription: "Matched selector, element rect, confidence score, and strategy used.",
    requiredPermission: "explain",
    executionTarget: "hybrid",
    verificationStrategy: "Re-verify element visibility and non-zero rect in live DOM.",
    isConsequential: false,
    status: "implemented",
  },
  {
    id: "find_text",
    name: "Find Text on Page",
    category: "perception",
    description:
      "Search visible DOM and tables for matching text snippets without triggering clicks.",
    inputSchema: z.object({ query: z.string().min(1).max(300) }),
    outputDescription: "Match count, snippet context, and best element selector.",
    requiredPermission: "observe",
    executionTarget: "extension_dom",
    verificationStrategy: "Confirm literal text occurrence in live text/element index.",
    isConsequential: false,
    status: "implemented",
  },
  {
    id: "highlight_element",
    name: "Highlight Element",
    category: "perception",
    description: "Render target highlight ring and explanatory callout over located element.",
    inputSchema: selectorInput.extend({
      title: z.string().max(120).optional(),
      description: z.string().max(300).optional(),
    }),
    outputDescription: "Overlay mount confirmation and target coordinates.",
    requiredPermission: "explain",
    executionTarget: "extension_dom",
    verificationStrategy: "Confirm overlay rendered aligned to element getBoundingClientRect.",
    isConsequential: false,
    status: "implemented",
  },
  {
    id: "point_to_element",
    name: "Point Connected 3D Buddy Arm",
    category: "perception",
    description:
      "Point the connected 3D Buddy arm directly toward a located element without clicking it.",
    inputSchema: selectorInput.extend({ title: z.string().max(120).optional() }),
    outputDescription: "Connected arm kinematics coordinates and pointing confirmation.",
    requiredPermission: "explain",
    executionTarget: "extension_dom",
    verificationStrategy:
      "Verify arm target endpoint matches element rect and no click was dispatched.",
    isConsequential: false,
    status: "implemented",
  },
  // 10-17: Interactions & Forms
  {
    id: "click_element",
    name: "Click Element",
    category: "interaction",
    description:
      "Click a verified button, tab, or link with obstruction guard and post-click mutation verification.",
    inputSchema: selectorInput.extend({ isConsequential: z.boolean().optional() }),
    outputDescription: "State change summary (clicked / navigated / dom_mutation).",
    requiredPermission: "assist",
    executionTarget: "extension_dom",
    verificationStrategy: "Verify DOM mutation, URL change, or ARIA state change after click.",
    isConsequential: false,
    status: "implemented",
  },
  {
    id: "hover_element",
    name: "Hover Element",
    category: "interaction",
    description: "Dispatch pointer/mouse hover events to reveal menus or tooltips.",
    inputSchema: selectorInput,
    outputSchema: genericActionOutput.extend({ hovered: z.boolean().optional() }),
    outputDescription: "Hover confirmation and newly surfaced elements.",
    requiredPermission: "assist",
    executionTarget: "extension_dom",
    timeoutMs: 4000,
    retryPolicy: { maxRetries: 1, backoffMs: 250, retryOn: ["element_not_found"] },
    verificationStrategy: "Inspect DOM delta or tooltip visibility after mouseenter/mouseover.",
    isConsequential: false,
    status: "implemented",
  },
  {
    id: "double_click",
    name: "Double Click Element",
    category: "interaction",
    description: "Dispatch dblclick event sequence on editable cells or file rows.",
    inputSchema: selectorInput,
    outputSchema: genericActionOutput.extend({ focused: z.boolean().optional() }),
    outputDescription: "Double-click state transition confirmation.",
    requiredPermission: "assist",
    executionTarget: "extension_dom",
    timeoutMs: 4000,
    retryPolicy: { maxRetries: 1, backoffMs: 250, retryOn: ["element_not_found"] },
    verificationStrategy: "Check element focus or inline edit state change.",
    isConsequential: false,
    status: "implemented",
  },
  {
    id: "right_click",
    name: "Right Click / Context Menu",
    category: "interaction",
    description: "Trigger contextmenu event on targeted element.",
    inputSchema: selectorInput,
    outputSchema: genericActionOutput.extend({ contextMenuTriggered: z.boolean().optional() }),
    outputDescription: "Context menu event dispatch status.",
    requiredPermission: "assist",
    executionTarget: "extension_dom",
    timeoutMs: 4000,
    retryPolicy: { maxRetries: 1, backoffMs: 250, retryOn: ["element_not_found"] },
    verificationStrategy: "Detect context menu overlay or DOM mutation.",
    isConsequential: false,
    status: "implemented",
  },
  {
    id: "type_text",
    name: "Type Text",
    category: "forms",
    description:
      "Enter text into a specific input, textarea, search box, or contentEditable editor without submitting.",
    inputSchema: z.object({
      selector: z.string().max(600).optional(),
      targetField: z.string().max(200).optional(),
      value: z.string().max(5000),
    }),
    outputDescription: "Verified field value matching requested text.",
    requiredPermission: "assist",
    executionTarget: "extension_dom",
    verificationStrategy:
      "Read back element.value or innerText and confirm exact match; reject sensitive fields.",
    isConsequential: false,
    status: "implemented",
  },
  {
    id: "fill_form",
    name: "Smart Form Filling",
    category: "forms",
    description:
      "Map user or uploaded-document fields into form inputs step-by-step without submitting.",
    inputSchema: z.object({
      fields: z.record(z.string()).optional(),
      explicitPairs: z
        .array(
          z.object({ target: z.string(), value: z.string(), overwrite: z.boolean().optional() }),
        )
        .optional(),
    }),
    outputDescription:
      "List of filled, preserved, and skipped fields with post-blur validation check.",
    requiredPermission: "assist",
    executionTarget: "extension_dom",
    verificationStrategy:
      "Read back every filled input value and scan for validation error messages.",
    isConsequential: false,
    status: "implemented",
  },
  {
    id: "select_dropdown",
    name: "Select Dropdown Option",
    category: "forms",
    description: "Choose option inside native <select> elements or ARIA/React/MUI/AntD dropdowns.",
    inputSchema: z.object({ selector: z.string().max(600), value: z.string().min(1).max(300) }),
    outputSchema: genericActionOutput.extend({ selectedText: z.string().optional() }),
    outputDescription: "Confirmed selected option value and label.",
    requiredPermission: "assist",
    executionTarget: "extension_dom",
    timeoutMs: 6000,
    retryPolicy: {
      maxRetries: 2,
      backoffMs: 300,
      retryOn: ["option_not_loaded", "element_not_found"],
    },
    verificationStrategy: "Read back selectedIndex / aria-selected / displayed dropdown text.",
    isConsequential: false,
    status: "implemented",
  },
  {
    id: "toggle_checkbox",
    name: "Toggle Checkbox / Radio",
    category: "forms",
    description: "Check or uncheck checkboxes, switches, and radio options accurately.",
    inputSchema: z.object({ selector: z.string().max(600), checked: z.boolean() }),
    outputDescription: "Verified checked boolean state.",
    requiredPermission: "assist",
    executionTarget: "extension_dom",
    verificationStrategy: "Read back element.checked or aria-checked post-click.",
    isConsequential: false,
    status: "implemented",
  },
  // 18-21: Navigation & Tabs
  {
    id: "navigate_url",
    name: "Navigate URL / Open Website",
    category: "navigation",
    description: "Open validated https/http website URL or navigate back/forward/reload.",
    inputSchema: z.object({
      url: z.string().url().optional(),
      historyDirection: z.enum(["back", "forward", "reload"]).optional(),
    }),
    outputDescription: "Final landed URL and tab load completion status.",
    requiredPermission: "assist",
    executionTarget: "extension_sw",
    verificationStrategy:
      "Wait for tab status 'complete' and check URL matches intended origin (block restricted/lookalike).",
    isConsequential: false,
    status: "implemented",
  },
  {
    id: "manage_tabs",
    name: "Manage Browser Tabs",
    category: "navigation",
    description: "List, open, switch, read, and safely close browser tabs with tab locks.",
    inputSchema: z.object({
      action: z.enum(["list", "switch", "open", "close", "read"]),
      tabId: z.number().optional(),
      url: z.string().optional(),
    }),
    outputSchema: genericActionOutput.extend({ tabId: z.number().optional() }),
    outputDescription: "Tab inventory, opened tabId, or active tab confirmation.",
    requiredPermission: "assist",
    executionTarget: "extension_sw",
    timeoutMs: 8000,
    retryPolicy: { maxRetries: 1, backoffMs: 250, retryOn: ["tab_load_timeout"] },
    verificationStrategy: "Confirm chrome.tabs state after switch/create/close.",
    isConsequential: false,
    status: "implemented",
  },
  {
    id: "search_in_page",
    name: "Search Within Page",
    category: "navigation",
    description: "Enter query into page search box and submit or filter page elements.",
    inputSchema: z.object({ query: z.string().min(1).max(300), selector: z.string().optional() }),
    outputDescription: "Search execution status and resulting content count.",
    requiredPermission: "assist",
    executionTarget: "extension_dom",
    verificationStrategy: "Verify search input value and post-submit DOM change.",
    isConsequential: false,
    status: "implemented",
  },
  {
    id: "search_web",
    name: "Search Across Websites",
    category: "research_and_analysis",
    description: "Run search queries across Google or supported portals and capture results.",
    inputSchema: z.object({ query: z.string().min(1).max(400), engine: z.string().optional() }),
    outputDescription: "Navigated search URL and extracted result links/titles.",
    requiredPermission: "assist",
    executionTarget: "extension_sw",
    verificationStrategy: "Verify results page loaded and query present in search input/URL.",
    isConsequential: false,
    status: "implemented",
  },
  // 22-25: Data & Pagination
  {
    id: "read_table",
    name: "Read Tables",
    category: "data_extraction",
    description: "Parse HTML tables, ARIA grids, and structured cards into normalized rows.",
    inputSchema: z
      .object({ selector: z.string().max(600).optional(), maxRows: z.number().optional() })
      .default({}),
    outputDescription: "Headers array, normalized row objects, and rowCount.",
    requiredPermission: "observe",
    executionTarget: "hybrid",
    verificationStrategy: "Compare extracted column count and row count against live DOM.",
    isConsequential: false,
    status: "implemented",
  },
  {
    id: "extract_structured_data",
    name: "Extract Structured Data",
    category: "data_extraction",
    description:
      "Extract order IDs, SKUs, statuses, prices, or custom list entities with status filters.",
    inputSchema: z.object({
      extractType: z.string().default("order_id"),
      statusFilter: z.string().optional(),
      selector: z.string().optional(),
    }),
    outputDescription: "Deduplicated record array with coverage notice.",
    requiredPermission: "observe",
    executionTarget: "extension_dom",
    verificationStrategy: "Verify non-empty structured output and record deduplication.",
    isConsequential: false,
    status: "implemented",
  },
  {
    id: "handle_pagination",
    name: "Handle Multi-Page Pagination",
    category: "data_extraction",
    description: "Detect next/previous/last/numbered page controls and navigate or iterate pages.",
    inputSchema: z.object({
      maxPages: z.number().min(1).max(20).default(5),
      targetPage: z.union([z.number(), z.enum(["next", "prev", "last"])]).optional(),
    }),
    outputSchema: genericActionOutput.extend({
      currentPage: z.union([z.number(), z.string()]).optional(),
    }),
    outputDescription: "Updated page navigation or aggregated multi-page records.",
    requiredPermission: "assist",
    executionTarget: "hybrid",
    timeoutMs: 12000,
    retryPolicy: { maxRetries: 1, backoffMs: 400, retryOn: ["navigation_pending"] },
    verificationStrategy: "Verify page indicator or URL incremented cleanly.",
    isConsequential: false,
    status: "implemented",
  },
  {
    id: "handle_infinite_scroll",
    name: "Handle Infinite Scrolling",
    category: "data_extraction",
    description:
      "Incrementally scroll feeds, deduplicate loaded items, detect end-of-feed, and enforce bounds.",
    inputSchema: z.object({
      maxScrolls: z.number().min(1).max(25).default(8),
      targetText: z.string().optional(),
      maxItems: z.number().min(1).max(200).optional(),
    }),
    outputSchema: genericActionOutput.extend({
      iterations: z.number().optional(),
      collectedCount: z.number().optional(),
      endOfFeed: z.boolean().optional(),
    }),
    outputDescription: "Loaded height delta, collected item count, and end-of-feed status.",
    requiredPermission: "assist",
    executionTarget: "extension_dom",
    timeoutMs: 15000,
    retryPolicy: { maxRetries: 1, backoffMs: 300, retryOn: ["scroll_stalled"] },
    verificationStrategy: "Compare scrollHeight and collected unique items across iterations.",
    isConsequential: false,
    status: "implemented",
  },
  // 26-31: Files, Spreadsheets, Analysis
  {
    id: "download_file",
    name: "Download File",
    category: "files_and_spreadsheets",
    description:
      "Trigger safe file download via URL or download button and track chrome.downloads completion.",
    inputSchema: z.object({
      url: z.string().optional(),
      filenameHint: z.string().optional(),
      selector: z.string().optional(),
    }),
    outputDescription: "Download ID, filename, state ('complete' | 'in_progress' | 'interrupted').",
    requiredPermission: "assist",
    executionTarget: "extension_sw",
    verificationStrategy: "Query chrome.downloads.search to verify file state.",
    isConsequential: false,
    status: "implemented",
  },
  {
    id: "upload_authorized_file",
    name: "Read User-Uploaded Document",
    category: "files_and_spreadsheets",
    description:
      "Ingest user-selected file in side panel (CSV, TSV, TXT, JSON, image, PDF) safely.",
    inputSchema: z.object({ fileName: z.string(), mimeType: z.string() }),
    outputDescription: "Extracted document type, sanitized fields, or parsed table.",
    requiredPermission: "observe",
    executionTarget: "hybrid",
    verificationStrategy:
      "Verify extracted field count or table rows without inventing missing data.",
    isConsequential: false,
    status: "partially_supported",
    notes:
      "CSV, TSV, TXT, JSON, images, and Vision-OCR PDFs are implemented; binary .xlsx/.docx libraries arrive in Phase 4.",
  },
  {
    id: "read_document",
    name: "Read Supported Documents",
    category: "files_and_spreadsheets",
    description: "Parse Aadhaar, PAN, invoice, shipping label, CSV, TSV, TXT, or JSON documents.",
    inputSchema: z.object({
      fileName: z.string(),
      textContent: z.string().optional(),
      base64Data: z.string().optional(),
    }),
    outputDescription: "Structured ExtractedDocumentResult with ambiguousFields list.",
    requiredPermission: "observe",
    executionTarget: "server_orchestrator",
    verificationStrategy:
      "Validate fields against document-extractor schema and mask sensitive previews.",
    isConsequential: false,
    status: "partially_supported",
    notes:
      "Local CSV/TSV/KV parsing + Gemini Vision OCR work today; native binary .docx/.pdf text extraction in Phase 4.",
  },
  {
    id: "process_spreadsheet",
    name: "Process Spreadsheets & Anomalies",
    category: "files_and_spreadsheets",
    description:
      "Infer column types, detect pricing/null anomalies, and compute column summaries on CSV/TSV/tables.",
    inputSchema: z.object({
      rows: z.array(z.record(z.unknown())).min(1),
      idKey: z.string().optional(),
    }),
    outputDescription: "SpreadsheetAnalysisResult with column schemas and anomaly list.",
    requiredPermission: "observe",
    executionTarget: "server_orchestrator",
    verificationStrategy: "Deterministic numeric verification via data-intelligence-engine.",
    isConsequential: false,
    status: "implemented",
  },
  {
    id: "compare_datasets",
    name: "Compare & Reconcile Datasets",
    category: "files_and_spreadsheets",
    description:
      "Compare two datasets (e.g. live orders vs spreadsheet) for missing records and value discrepancies.",
    inputSchema: z.object({
      baseData: z.array(z.record(z.unknown())),
      compareData: z.array(z.record(z.unknown())),
      keyField: z.string().default("id"),
    }),
    outputDescription:
      "CrossFileComparisonResult with matchedRecords, missing IDs, and diff amounts.",
    requiredPermission: "observe",
    executionTarget: "server_orchestrator",
    verificationStrategy: "Deterministic exact key matching without mutating source files.",
    isConsequential: false,
    status: "implemented",
  },
  {
    id: "calculate_values",
    name: "Calculate Deterministic Values",
    category: "research_and_analysis",
    description:
      "Compute exact sums, averages, min/max, tax totals, and counts without LLM arithmetic guessing.",
    inputSchema: z.object({
      records: z.array(z.record(z.unknown())),
      numericFields: z.array(z.string()).optional(),
    }),
    outputDescription: "DataAggregationResult with deterministic summaries.",
    requiredPermission: "observe",
    executionTarget: "server_orchestrator",
    verificationStrategy: "Verify finite numeric results and exact record counts.",
    isConsequential: false,
    status: "implemented",
  },
  // 32-40: Reporting, Verification, Lifecycle, Self-Healing
  {
    id: "generate_report",
    name: "Generate Structured Report",
    category: "research_and_analysis",
    description:
      "Produce Markdown/CSV/JSON summary reports from verified extracted and analyzed records.",
    inputSchema: z.object({
      title: z.string(),
      format: z.enum(["markdown", "csv", "json"]).default("markdown"),
    }),
    outputDescription: "Formatted report payload grounded strictly in verified outputs.",
    requiredPermission: "explain",
    executionTarget: "server_orchestrator",
    verificationStrategy: "Check report only cites verified record counts and sources.",
    isConsequential: false,
    status: "implemented",
  },
  {
    id: "draft_communication",
    name: "Draft Emails & Support Messages",
    category: "communication",
    description:
      "Prepare clear replies, complaint drafts, or follow-up emails for user review (never sends automatically).",
    inputSchema: z.object({
      topic: z.string().min(1),
      recipientContext: z.string().optional(),
      tone: z.string().optional(),
    }),
    outputDescription: "Editable draft text awaiting user approval before any send action.",
    requiredPermission: "explain",
    executionTarget: "server_orchestrator",
    verificationStrategy:
      "Verify draft contains no unverified order IDs or external auto-send side effects.",
    isConsequential: false,
    status: "implemented",
  },
  {
    id: "detect_validation_errors",
    name: "Detect Validation & Page Errors",
    category: "forms",
    description:
      "Scan active page alerts, aria-invalid attributes, and post-fill validation feedback.",
    inputSchema: emptyOrAny,
    outputDescription: "Structured list of validation errors and visible warnings.",
    requiredPermission: "observe",
    executionTarget: "extension_dom",
    verificationStrategy: "Verify alert role/error selector provenance on live page.",
    isConsequential: false,
    status: "implemented",
  },
  {
    id: "retry_failed_action",
    name: "Retry Failed Action with Alternate Locator",
    category: "workflow_control",
    description:
      "Re-snapshot DOM after failure and retry bounded times with semantic/alternate locators.",
    inputSchema: z.object({ stepId: z.string(), maxRetries: z.number().max(3).default(1) }),
    outputDescription: "Recovery status and resolved alternate selector.",
    requiredPermission: "assist",
    executionTarget: "hybrid",
    verificationStrategy:
      "Verify step succeeds on retry or halts cleanly with clear diagnostic reason.",
    isConsequential: false,
    status: "implemented",
  },
  {
    id: "verify_outcome",
    name: "Verify Action Outcome",
    category: "workflow_control",
    description:
      "Compare pre- and post-action page URL, field values, and DOM mutations to prevent false success claims.",
    inputSchema: emptyOrAny,
    outputDescription:
      "Verification verdict with exact proof type (url_change | value_match | dom_mutation).",
    requiredPermission: "observe",
    executionTarget: "hybrid",
    verificationStrategy:
      "Independent check via action-engine compareActionStates or read-back check.",
    isConsequential: false,
    status: "implemented",
  },
  {
    id: "undo_reversible",
    name: "Undo Reversible Change",
    category: "workflow_control",
    description:
      "Revert reversible UI state such as field edits, navigation back, or checkpoint rollback.",
    inputSchema: z.object({
      targetScope: z.enum(["last_field", "navigation_back", "checkpoint"]).default("last_field"),
    }),
    outputSchema: genericActionOutput.extend({ restoredValue: z.string().optional() }),
    outputDescription: "Rollback confirmation to previous verified state.",
    requiredPermission: "assist",
    executionTarget: "hybrid",
    timeoutMs: 5000,
    retryPolicy: { maxRetries: 0, backoffMs: 0, retryOn: [] },
    verificationStrategy: "Confirm restored state matches recorded prior snapshot/value.",
    isConsequential: false,
    status: "implemented",
  },
  {
    id: "pause_resume_task",
    name: "Pause & Resume Tasks",
    category: "workflow_control",
    description:
      "Safely pause, skip, stop, or resume long-running multi-step workflows via token isolation.",
    inputSchema: z.object({ command: z.enum(["pause", "resume", "skip", "stop"]) }),
    outputDescription: "Updated TaskSessionContext status.",
    requiredPermission: "assist",
    executionTarget: "hybrid",
    verificationStrategy:
      "Verify run token invalidates cancelled loops and resets stale running flags on resume.",
    isConsequential: false,
    status: "implemented",
  },
  {
    id: "maintain_checkpoints",
    name: "Maintain Persistent Checkpoints",
    category: "workflow_control",
    description:
      "Persist task checkpoints with deterministic action hashes to prevent duplicate execution.",
    inputSchema: z.object({ taskId: z.string() }),
    outputDescription: "Saved TaskCheckpoint record in extension/server storage.",
    requiredPermission: "observe",
    executionTarget: "hybrid",
    verificationStrategy: "Read back stored checkpoint and confirm hash deduplication.",
    isConsequential: false,
    status: "implemented",
  },
  {
    id: "generate_completion_summary",
    name: "Generate Verified Completion Summary",
    category: "workflow_control",
    description:
      "Compile honest summary reporting only verified completed, skipped, and failed steps.",
    inputSchema: z.object({ taskId: z.string() }),
    outputDescription: "Structured execution report with counts and extracted data summary.",
    requiredPermission: "observe",
    executionTarget: "server_orchestrator",
    verificationStrategy: "Cross-check summary counts against TaskNode status array.",
    isConsequential: false,
    status: "implemented",
  },
  // Consequential & Self-Healing capabilities
  {
    id: "consequential_submit_or_delete",
    name: "Submit / Delete / Purchase Gate",
    category: "interaction",
    description:
      "Consequential actions (form submit, order cancel/delete, payment/checkout) gated by explicit approval.",
    inputSchema: selectorInput.extend({
      actionType: z.enum(["click_submit", "click_delete", "purchase", "send_message"]),
    }),
    outputDescription: "Approval prompt or executed verified state.",
    requiredPermission: "assist",
    executionTarget: "extension_dom",
    verificationStrategy: "Block execution unless user explicitly approves the specific step.",
    isConsequential: true,
    status: "implemented",
  },
  {
    id: "self_heal_diagnose",
    name: "Self-Healing Error Diagnosis",
    category: "self_healing",
    description:
      "Detect, redact, classify, locally recover, or diagnose AI Buddy errors using selected AI provider.",
    inputSchema: z.object({
      errorMessage: z.string().min(1),
      component: z.string().optional(),
      useAi: z.boolean().optional(),
    }),
    outputDescription: "Sanitized DiagnosticReport, root cause attribution, and repair plan.",
    requiredPermission: "observe",
    executionTarget: "server_self_heal",
    verificationStrategy:
      "Confirm secrets redacted and root cause attributed cleanly without mutating files.",
    isConsequential: false,
    status: "implemented",
  },
  {
    id: "self_heal_prepare_patch",
    name: "Prepare & Apply Verified Code Patch",
    category: "self_healing",
    description:
      "With explicit user approval, stage a minimal patch, run tsc/eslint/vitest/build, and auto-rollback on any failure.",
    inputSchema: z.object({
      repairId: z.string(),
      approvedAction: z.enum(["prepare_repair", "apply_repair_and_test"]),
    }),
    outputDescription:
      "Diff comparison, test/lint/build verification results, or clean rollback report.",
    requiredPermission: "execute",
    executionTarget: "server_self_heal",
    verificationStrategy:
      "Verify TypeScript, ESLint, Vitest, and build pass before accepting patch; rollback on failure.",
    isConsequential: true,
    status: "implemented",
  },
  {
    id: "self_heal_github_pr",
    name: "Create Development Branch & GitHub Pull Request",
    category: "self_healing",
    description:
      "Create an isolated fix branch (never main), push verified repair, and open a GitHub PR with user approval.",
    inputSchema: z.object({
      repairId: z.string(),
      owner: z.string(),
      repo: z.string(),
      approvedAction: z.literal("create_github_pr"),
    }),
    outputDescription:
      "Created branch name, commit SHA, PR URL, or honest missing-credential notice.",
    requiredPermission: "execute",
    executionTarget: "server_self_heal",
    verificationStrategy:
      "Reject direct main/master targets and verify PR URL from GitHub API response.",
    isConsequential: true,
    status: "implemented",
  },
  // Phase 2 Explicit Computer Interaction & Visual Intelligence Capabilities
  {
    id: "focus_element",
    name: "Focus Element",
    category: "interaction",
    description: "Focus a specific visible form control or interactive element cleanly.",
    inputSchema: selectorInput,
    outputSchema: genericActionOutput.extend({ isFocused: z.boolean().optional() }),
    outputDescription: "Focus verification matching document.activeElement.",
    requiredPermission: "assist",
    executionTarget: "extension_dom",
    timeoutMs: 3000,
    retryPolicy: { maxRetries: 1, backoffMs: 200, retryOn: ["element_not_found"] },
    verificationStrategy: "Verify activeElement matches target element.",
    isConsequential: false,
    status: "implemented",
  },
  {
    id: "clear_field",
    name: "Clear Input Field",
    category: "forms",
    description: "Record previous value for undo and cleanly empty a target field.",
    inputSchema: selectorInput,
    outputSchema: genericActionOutput.extend({ previousValue: z.string().optional() }),
    outputDescription: "Empty value verification plus undo record.",
    requiredPermission: "assist",
    executionTarget: "extension_dom",
    timeoutMs: 4000,
    retryPolicy: { maxRetries: 1, backoffMs: 200, retryOn: ["element_not_found"] },
    verificationStrategy: "Read back element value === '' and verify sensitive guard.",
    isConsequential: false,
    status: "implemented",
  },
  {
    id: "drag_and_drop",
    name: "Drag and Drop Element",
    category: "interaction",
    description:
      "Dispatch pointer/drag-and-drop sequence between source and destination selectors.",
    inputSchema: z.object({
      selector: z.string().min(1).max(600),
      targetSelector: z.string().min(1).max(600),
    }),
    outputSchema: genericActionOutput,
    outputDescription: "Drag/drop event sequence status and post-drop DOM verification.",
    requiredPermission: "assist",
    executionTarget: "extension_dom",
    timeoutMs: 6000,
    retryPolicy: { maxRetries: 1, backoffMs: 300, retryOn: ["element_not_found"] },
    verificationStrategy: "Verify DOM hierarchy change or bounding rect shift after drop.",
    isConsequential: false,
    status: "partially_supported",
    notes:
      "HTML5 & pointer drag events supported; OS-level native file drop outside browser unsupported.",
  },
  {
    id: "scroll_to_element",
    name: "Scroll to Element",
    category: "navigation",
    description: "Scroll nearest scrollable container or window until element enters viewport.",
    inputSchema: selectorInput,
    outputSchema: genericActionOutput.extend({ inViewport: z.boolean().optional() }),
    outputDescription: "Element viewport visibility confirmation.",
    requiredPermission: "suggest",
    executionTarget: "extension_dom",
    timeoutMs: 5000,
    retryPolicy: { maxRetries: 1, backoffMs: 250, retryOn: ["element_not_found"] },
    verificationStrategy: "Check getBoundingClientRect lies within visible viewport.",
    isConsequential: false,
    status: "implemented",
  },
  {
    id: "scroll_until_text",
    name: "Scroll Until Text Visible",
    category: "navigation",
    description:
      "Incrementally scroll page or container until requested text appears or max attempts hit.",
    inputSchema: z.object({
      text: z.string().min(1).max(300),
      containerSelector: z.string().max(600).optional(),
      maxScrolls: z.number().min(1).max(20).default(10),
    }),
    outputSchema: genericActionOutput.extend({
      found: z.boolean(),
      iterations: z.number().optional(),
    }),
    outputDescription: "Match status, matched element selector, and scroll count.",
    requiredPermission: "suggest",
    executionTarget: "extension_dom",
    timeoutMs: 12000,
    retryPolicy: { maxRetries: 1, backoffMs: 300, retryOn: ["scroll_stalled"] },
    verificationStrategy: "Verify literal target text is present in visible DOM.",
    isConsequential: false,
    status: "implemented",
  },
  {
    id: "scroll_container",
    name: "Scroll Nested Container",
    category: "navigation",
    description:
      "Scroll a nested overflow container horizontally or vertically without moving body.",
    inputSchema: z.object({
      containerSelector: z.string().min(1).max(600),
      direction: z.enum(["up", "down", "left", "right", "top", "bottom"]).default("down"),
      amount: z.number().optional(),
    }),
    outputSchema: genericActionOutput.extend({
      scrollTop: z.number().optional(),
      scrollLeft: z.number().optional(),
    }),
    outputDescription: "Container scroll offset before vs after scroll.",
    requiredPermission: "suggest",
    executionTarget: "extension_dom",
    timeoutMs: 4000,
    retryPolicy: { maxRetries: 1, backoffMs: 200, retryOn: ["element_not_found"] },
    verificationStrategy: "Verify container scrollTop/scrollLeft delta.",
    isConsequential: false,
    status: "implemented",
  },
  {
    id: "select_custom_dropdown",
    name: "Select Custom UI Dropdown",
    category: "forms",
    description:
      "Open and select options in React Select, MUI, Ant Design, or custom JS dropdowns.",
    inputSchema: z.object({
      selector: z.string().max(600).optional(),
      targetField: z.string().max(200).optional(),
      value: z.string().min(1).max(300),
    }),
    outputSchema: genericActionOutput.extend({ selectedText: z.string().optional() }),
    outputDescription: "Verified displayed selection value inside custom dropdown control.",
    requiredPermission: "assist",
    executionTarget: "extension_dom",
    timeoutMs: 7000,
    retryPolicy: { maxRetries: 2, backoffMs: 300, retryOn: ["option_not_loaded"] },
    verificationStrategy: "Read back visible selected tag/value text after menu close.",
    isConsequential: false,
    status: "implemented",
  },
  {
    id: "select_combobox_option",
    name: "Select ARIA Combobox Option",
    category: "forms",
    description:
      "Interact with role=combobox controls to search/open popup and choose exact option.",
    inputSchema: z.object({
      selector: z.string().min(1).max(600),
      value: z.string().min(1).max(300),
    }),
    outputSchema: genericActionOutput.extend({ selectedText: z.string().optional() }),
    outputDescription: "Selected combobox value confirmation.",
    requiredPermission: "assist",
    executionTarget: "extension_dom",
    timeoutMs: 6000,
    retryPolicy: { maxRetries: 2, backoffMs: 300, retryOn: ["option_not_loaded"] },
    verificationStrategy: "Verify combobox text/value matches requested option.",
    isConsequential: false,
    status: "implemented",
  },
  {
    id: "interact_with_listbox",
    name: "Interact With ARIA Listbox",
    category: "forms",
    description: "Choose single or multiple items from role=listbox controls.",
    inputSchema: z.object({
      selector: z.string().min(1).max(600),
      value: z.string().min(1).max(300),
      multi: z.boolean().optional(),
    }),
    outputSchema: genericActionOutput.extend({ selectedItems: z.array(z.string()).optional() }),
    outputDescription: "Confirmed aria-selected option(s).",
    requiredPermission: "assist",
    executionTarget: "extension_dom",
    timeoutMs: 5000,
    retryPolicy: { maxRetries: 1, backoffMs: 250, retryOn: ["element_not_found"] },
    verificationStrategy: "Verify aria-selected='true' on matched option node.",
    isConsequential: false,
    status: "implemented",
  },
  {
    id: "interact_with_autocomplete",
    name: "Interact With Autocomplete Input",
    category: "forms",
    description:
      "Type query into autocomplete/tag input, wait for async suggestions, and select match.",
    inputSchema: z.object({
      selector: z.string().min(1).max(600),
      value: z.string().min(1).max(300),
    }),
    outputSchema: genericActionOutput.extend({ selectedText: z.string().optional() }),
    outputDescription: "Confirmed selected suggestion or input text.",
    requiredPermission: "assist",
    executionTarget: "extension_dom",
    timeoutMs: 8000,
    retryPolicy: { maxRetries: 2, backoffMs: 400, retryOn: ["option_not_loaded"] },
    verificationStrategy: "Confirm input value or chip tag reflects selected suggestion.",
    isConsequential: false,
    status: "implemented",
  },
  {
    id: "open_tab",
    name: "Open Browser Tab",
    category: "navigation",
    description: "Open a safe http/https URL in a new browser tab and record ownership context.",
    inputSchema: z.object({ url: z.string().url(), active: z.boolean().default(true) }),
    outputSchema: genericActionOutput.extend({
      tabId: z.number().optional(),
      url: z.string().optional(),
    }),
    outputDescription: "Newly opened tabId and initial URL.",
    requiredPermission: "assist",
    executionTarget: "extension_sw",
    timeoutMs: 10000,
    retryPolicy: { maxRetries: 1, backoffMs: 300, retryOn: ["tab_load_timeout"] },
    verificationStrategy: "Verify chrome.tabs.create returned valid tabId on allowed origin.",
    isConsequential: false,
    status: "implemented",
  },
  {
    id: "close_tab",
    name: "Close Browser Tab Safely",
    category: "navigation",
    description:
      "Safely close an authorized non-critical tab without closing extension panel or pinned tabs.",
    inputSchema: z.object({
      tabId: z.number().optional(),
      url: z.string().optional(),
      allowCloseUserTab: z.boolean().optional(),
    }),
    outputSchema: genericActionOutput.extend({ closedTabId: z.number().optional() }),
    outputDescription: "Closed tab ID or safety rejection reason.",
    requiredPermission: "assist",
    executionTarget: "extension_sw",
    timeoutMs: 4000,
    retryPolicy: { maxRetries: 0, backoffMs: 0, retryOn: [] },
    verificationStrategy: "Confirm tab no longer exists in chrome.tabs.query.",
    isConsequential: true,
    status: "implemented",
  },
  {
    id: "switch_tab",
    name: "Switch Active Browser Tab",
    category: "navigation",
    description: "Activate another open browser tab by tabId, index, or title/URL match.",
    inputSchema: z.object({
      tabId: z.number().optional(),
      query: z.string().optional(),
      returnToOriginal: z.boolean().optional(),
    }),
    outputSchema: genericActionOutput.extend({
      tabId: z.number().optional(),
      url: z.string().optional(),
    }),
    outputDescription: "Focused tab ID, title, and URL.",
    requiredPermission: "assist",
    executionTarget: "extension_sw",
    timeoutMs: 4000,
    retryPolicy: { maxRetries: 1, backoffMs: 200, retryOn: ["tab_not_found"] },
    verificationStrategy: "Confirm tab.active === true in window.",
    isConsequential: false,
    status: "implemented",
  },
  {
    id: "extract_table",
    name: "Extract Structured Table",
    category: "data_extraction",
    description: "Extract normalized headers and rows from HTML tables or ARIA grids.",
    inputSchema: z.object({
      selector: z.string().max(600).optional(),
      maxRows: z.number().min(1).max(500).default(100),
    }),
    outputSchema: genericActionOutput.extend({
      headers: z.array(z.string()).optional(),
      rowCount: z.number().optional(),
    }),
    outputDescription: "Headers array, normalized row objects, and rowCount.",
    requiredPermission: "observe",
    executionTarget: "extension_dom",
    timeoutMs: 6000,
    retryPolicy: { maxRetries: 1, backoffMs: 250, retryOn: ["dom_busy"] },
    verificationStrategy: "Verify extracted header & row counts against DOM rows.",
    isConsequential: false,
    status: "implemented",
  },
  {
    id: "paginate",
    name: "Paginate Across Pages",
    category: "navigation",
    description: "Click next, previous, last, or specific numbered pagination control cleanly.",
    inputSchema: z.object({
      targetPage: z.union([z.number(), z.enum(["next", "prev", "last"])]).default("next"),
    }),
    outputSchema: genericActionOutput.extend({
      pageText: z.string().optional(),
      urlChanged: z.boolean().optional(),
    }),
    outputDescription: "Pagination action outcome and updated page indicator.",
    requiredPermission: "assist",
    executionTarget: "extension_dom",
    timeoutMs: 8000,
    retryPolicy: { maxRetries: 1, backoffMs: 400, retryOn: ["element_not_found"] },
    verificationStrategy: "Compare pagination active page / table content before vs after click.",
    isConsequential: false,
    status: "implemented",
  },
  {
    id: "infinite_scroll",
    name: "Infinite Scroll Collector",
    category: "navigation",
    description:
      "Execute bounded infinite scroll iterations, deduplicating loaded items and stopping at plateau or target.",
    inputSchema: z.object({
      maxIterations: z.number().min(1).max(20).default(8),
      targetText: z.string().optional(),
      maxItems: z.number().min(1).max(200).optional(),
    }),
    outputSchema: genericActionOutput.extend({
      iterations: z.number(),
      uniqueItemsCount: z.number(),
      endOfFeed: z.boolean(),
    }),
    outputDescription: "Iterations executed, unique items collected, and endOfFeed flag.",
    requiredPermission: "suggest",
    executionTarget: "extension_dom",
    timeoutMs: 15000,
    retryPolicy: { maxRetries: 1, backoffMs: 300, retryOn: ["scroll_stalled"] },
    verificationStrategy: "Track scrollHeight growth and item deduplication across steps.",
    isConsequential: false,
    status: "implemented",
  },
  {
    id: "undo_reversible_action",
    name: "Undo Reversible Field or Navigation",
    category: "workflow_control",
    description: "Revert last field modification, history navigation, or task checkpoint safely.",
    inputSchema: z.object({
      scope: z.enum(["field", "navigation", "checkpoint"]).default("field"),
      selector: z.string().optional(),
    }),
    outputSchema: genericActionOutput.extend({ restoredValue: z.string().optional() }),
    outputDescription: "Confirmed restored prior state.",
    requiredPermission: "assist",
    executionTarget: "hybrid",
    timeoutMs: 5000,
    retryPolicy: { maxRetries: 0, backoffMs: 0, retryOn: [] },
    verificationStrategy: "Verify restored field value or previous URL matches undo record.",
    isConsequential: false,
    status: "implemented",
  },
  {
    id: "validate_form_errors",
    name: "Validate Form & Page Errors",
    category: "forms",
    description:
      "Inspect required empty inputs, invalid formats (email/phone), invalid dropdowns, inline errors, and disabled submit buttons.",
    inputSchema: z.object({ formSelector: z.string().max(600).optional() }).default({}),
    outputSchema: genericActionOutput.extend({
      valid: z.boolean(),
      errorCount: z.number(),
      submitDisabled: z.boolean().optional(),
    }),
    outputDescription: "Structured list of form validation blockers and warnings.",
    requiredPermission: "observe",
    executionTarget: "extension_dom",
    timeoutMs: 4000,
    retryPolicy: { maxRetries: 1, backoffMs: 200, retryOn: [] },
    verificationStrategy: "Cross-check HTML5 validity, aria-invalid, and visible alert nodes.",
    isConsequential: false,
    status: "implemented",
  },
  {
    id: "desktop_os_automation",
    name: "Native Desktop OS Automation",
    category: "system",
    description:
      "Operate native OS applications outside the Chrome browser sandbox via a future native messaging bridge.",
    inputSchema: z.object({ app: z.string().min(1), command: z.string().min(1) }),
    outputSchema: genericActionOutput,
    outputDescription: "Native host execution result.",
    requiredPermission: "execute",
    executionTarget: "server_orchestrator",
    timeoutMs: 10000,
    retryPolicy: { maxRetries: 0, backoffMs: 0, retryOn: [] },
    verificationStrategy: "Not executed in browser MV3 sandbox without Native Messaging host.",
    isConsequential: true,
    status: "planned",
    notes: "Chrome MV3 browser sandbox does not control external desktop OS applications yet.",
  },
];

// Ensure every capability has explicit default outputSchema, timeoutMs, and retryPolicy
for (const cap of CAPABILITY_REGISTRY) {
  if (!cap.outputSchema) cap.outputSchema = genericActionOutput;
  if (typeof cap.timeoutMs !== "number") {
    cap.timeoutMs =
      cap.executionTarget === "extension_sw"
        ? 8000
        : cap.executionTarget === "server_orchestrator"
          ? 12000
          : 5000;
  }
  if (!cap.retryPolicy) {
    cap.retryPolicy = {
      maxRetries: cap.isConsequential ? 0 : 1,
      backoffMs: 250,
      retryOn: cap.isConsequential ? [] : ["transient_timeout"],
    };
  }
}

const CAPABILITY_INDEX = new Map<string, CapabilityDefinition>(
  CAPABILITY_REGISTRY.map((cap) => [cap.id, cap]),
);

export function getCapability(id: string): CapabilityDefinition | undefined {
  return CAPABILITY_INDEX.get(id);
}

export function listCapabilities(filter?: {
  category?: CapabilityCategory;
  status?: CapabilityStatus;
  executionTarget?: ExecutionTarget;
}): CapabilityDefinition[] {
  return CAPABILITY_REGISTRY.filter((cap) => {
    if (filter?.category && cap.category !== filter.category) return false;
    if (filter?.status && cap.status !== filter.status) return false;
    if (filter?.executionTarget && cap.executionTarget !== filter.executionTarget) return false;
    return true;
  });
}

export function validateCapabilityInput(
  id: string,
  payload: unknown,
): { ok: true; data: unknown } | { ok: false; error: string } {
  const cap = CAPABILITY_INDEX.get(id);
  if (!cap) {
    return { ok: false, error: `Unknown capability "${id}".` };
  }
  const parsed = cap.inputSchema.safeParse(payload ?? {});
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues
        .map((i) => `${i.path.join(".") || "input"}: ${i.message}`)
        .join("; "),
    };
  }
  return { ok: true, data: parsed.data };
}

export function canExecuteCapability(
  id: string,
  userPermissionLevel: PermissionLevel,
  consentGranted = false,
): {
  allowed: boolean;
  requiresApproval: boolean;
  available: boolean;
  reason?: string;
} {
  const cap = CAPABILITY_INDEX.get(id);
  if (!cap) {
    return {
      allowed: false,
      requiresApproval: false,
      available: false,
      reason: `Unknown capability: ${id}`,
    };
  }

  if (cap.status === "planned" || cap.status === "unavailable") {
    return {
      allowed: false,
      requiresApproval: false,
      available: false,
      reason: `Capability "${cap.name}" is currently ${cap.status}${cap.notes ? ` (${cap.notes})` : ""}.`,
    };
  }

  const requiredAction =
    cap.requiredPermission === "observe"
      ? "read_page"
      : cap.requiredPermission === "explain"
        ? "answer"
        : cap.requiredPermission === "suggest"
          ? "highlight"
          : cap.requiredPermission === "execute"
            ? "submit"
            : "fill_field";

  if (!can(userPermissionLevel, requiredAction)) {
    return {
      allowed: false,
      requiresApproval: true,
      available: true,
      reason: `Permission level "${userPermissionLevel}" cannot run "${cap.name}" (requires "${cap.requiredPermission}").`,
    };
  }

  if (cap.isConsequential && !consentGranted) {
    return {
      allowed: false,
      requiresApproval: true,
      available: true,
      reason: `Explicit user approval is required before executing consequential capability "${cap.name}".`,
    };
  }

  return { allowed: true, requiresApproval: false, available: true };
}
