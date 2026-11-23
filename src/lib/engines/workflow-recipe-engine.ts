/**
 * PROACTIVE TASK ASSISTANCE & WORKFLOW RECIPES — PHASE 3 EVOLUTION
 *
 * Responsibilities:
 * - Detects repeated automation patterns from recent tasks
 * - Synthesizes reusable, parameterized workflow definitions
 * - Enforces explicit user review & approval before saving or running recipes
 * - Replays approved recipes with parameters, step dependencies, and safety gates
 * - Records structured execution history and audit logs
 */

import { type BrowserActionType } from "@/shared/browser-action";

export interface RecipeParameter {
  key: string;
  label: string;
  type: "string" | "number" | "boolean" | "select";
  defaultValue?: string | number | boolean | undefined;
  required?: boolean | undefined;
  options?: string[] | undefined;
  description?: string | undefined;
}

export interface RecipeStep {
  id: string;
  order: number;
  label: string;
  actionType: BrowserActionType;
  targetSelector?: string | undefined;
  parameterKey?: string | undefined;
  defaultValue?: string | undefined;
  isConsequential?: boolean | undefined;
}

export interface ScheduleConfig {
  type: "manual" | "once" | "recurring" | "condition_trigger";
  cronExpression?: string | undefined;
  intervalMinutes?: number | undefined;
  timeOfDay?: string | undefined;
  dayOfWeek?: string | undefined;
  runAtIso?: string | undefined;
  conditionExpression?: string | undefined;
  nextRunAtIso?: string | undefined;
  frequency?: "daily" | "weekly" | "hourly" | "manual" | undefined;
}

export interface RetryPolicy {
  maxRetries: number;
  backoffMs: number;
  notifyOnFailure: boolean;
}

export interface WorkflowExecutionRun {
  runId: string;
  recipeId: string;
  executedAt: string;
  durationMs: number;
  status: "completed" | "failed" | "cancelled" | "paused";
  stepsCompleted: number;
  outputSummary?: string | undefined;
  error?: string | undefined;
  triggeredBy?: "manual" | "schedule" | "condition" | "api" | undefined;
}

export interface WorkflowRecipe {
  id: string;
  userId?: string | undefined;
  name: string;
  description: string;
  origin: string;
  triggerPhrases: string[];
  parameters?: RecipeParameter[] | undefined;
  steps: RecipeStep[];
  confidence: number;
  approvedByUser: boolean;
  enabled?: boolean | undefined;
  createdAt: string;
  lastExecutedAt?: string | undefined;
  executionCount: number;
  executionHistory?: WorkflowExecutionRun[] | undefined;
  schedule?: ScheduleConfig | undefined;
  retryPolicy?: RetryPolicy | undefined;
  requiredConnectors?: string[] | undefined;
  requiredFiles?: string[] | undefined;
  missingDetails?: string[] | undefined;
}

export interface TaskLogEntry {
  id: string;
  title: string;
  intent: string;
  pageUrl?: string | undefined;
  pageOrigin?: string | undefined;
  status: string;
  createdAt: string;
}

/**
 * Standard predefined workflow recipes for popular platforms and universal tasks
 */
export const BUILTIN_RECIPES: WorkflowRecipe[] = [
  {
    id: "recipe_meesho_orders_audit",
    name: "Meesho: Pending Orders Audit",
    description:
      "Navigate to Supplier Orders, filter today's pending items, and extract order IDs.",
    origin: "supplier.meesho.com",
    triggerPhrases: [
      "check meesho orders",
      "open meesho pending orders",
      "meesho supplier orders report",
    ],
    confidence: 0.98,
    approvedByUser: true,
    createdAt: new Date().toISOString(),
    executionCount: 14,
    parameters: [
      {
        key: "orderStatus",
        label: "Order Status Filter",
        type: "select",
        defaultValue: "Pending",
        options: ["Pending", "Ready to Ship", "Shipped", "Cancelled"],
        required: true,
      },
    ],
    steps: [
      {
        id: "step_1",
        order: 1,
        label: "Open Meesho Supplier Panel",
        actionType: "navigate",
        defaultValue: "https://supplier.meesho.com/panel/orders",
      },
      {
        id: "step_2",
        order: 2,
        label: "Select Orders tab",
        actionType: "click",
        targetSelector: 'button:has-text("Pending"), [data-tab="pending"], a[href*="pending"]',
        parameterKey: "orderStatus",
      },
      {
        id: "step_3",
        order: 3,
        label: "Extract Order IDs & status",
        actionType: "extract_table",
        targetSelector: "table, .order-card, .data-grid",
      },
    ],
  },
  {
    id: "recipe_table_clipboard_export",
    name: "Page Table & Grid Scraper",
    description:
      "Scan active page for data tables, deduplicate rows, and format for spreadsheet paste.",
    origin: "*",
    triggerPhrases: [
      "copy table",
      "extract all rows",
      "export page data",
      "scrape table to clipboard",
    ],
    confidence: 0.95,
    approvedByUser: true,
    createdAt: new Date().toISOString(),
    executionCount: 8,
    steps: [
      {
        id: "step_1",
        order: 1,
        label: "Scan table elements",
        actionType: "locate",
        targetSelector: "table, [role='table'], [role='grid']",
      },
      {
        id: "step_2",
        order: 2,
        label: "Extract rows and columns",
        actionType: "extract_table",
      },
    ],
  },
  {
    id: "recipe_reconcile_orders_spreadsheet",
    name: "Cross-Platform Order & Price Reconciliation",
    description:
      "Compare portal order IDs and pricing against local spreadsheet and highlight anomalies non-destructively.",
    origin: "*",
    triggerPhrases: [
      "reconcile orders with spreadsheet",
      "compare live orders to excel",
      "check missing order ids",
    ],
    confidence: 0.97,
    approvedByUser: true,
    createdAt: new Date().toISOString(),
    executionCount: 5,
    parameters: [
      {
        key: "keyColumn",
        label: "Order Key Column",
        type: "string",
        defaultValue: "order_id",
        required: true,
      },
      {
        key: "priceColumn",
        label: "Price Column Name",
        type: "string",
        defaultValue: "amount",
        required: true,
      },
    ],
    steps: [
      {
        id: "rec_step_1",
        order: 1,
        label: "Extract Live Orders from Page",
        actionType: "extract_table",
      },
      {
        id: "rec_step_2",
        order: 2,
        label: "Compare with Spreadsheet Data",
        actionType: "extract",
        parameterKey: "keyColumn",
      },
      {
        id: "rec_step_3",
        order: 3,
        label: "Produce Reconciliation Audit Report",
        actionType: "highlight",
      },
    ],
  },
  {
    id: "recipe_multisource_research",
    name: "Multi-Source Market Research & Fact Check",
    description:
      "Cross-reference product information across multiple domains, extract verifiable citations, and categorize consensus vs conflicting evidence.",
    origin: "*",
    triggerPhrases: [
      "research product across sources",
      "fact check competitor pricing",
      "multi source research report",
    ],
    confidence: 0.94,
    approvedByUser: true,
    createdAt: new Date().toISOString(),
    executionCount: 3,
    steps: [
      {
        id: "rs_step_1",
        order: 1,
        label: "Collect Multiple Source Snippets",
        actionType: "extract",
      },
      {
        id: "rs_step_2",
        order: 2,
        label: "Categorize Claims & Citations",
        actionType: "locate",
      },
    ],
  },
];

/**
 * Creates a new custom workflow recipe with strict validation and user approval gate.
 */
export function createWorkflowRecipe(params: {
  name: string;
  description: string;
  origin?: string;
  triggerPhrases: string[];
  steps: RecipeStep[];
  parameters?: RecipeParameter[];
}): { recipe: WorkflowRecipe | null; error?: string } {
  const validation = validateWorkflowRecipe(params);
  if (!validation.valid) {
    return { recipe: null, error: validation.reason };
  }

  const id = `recipe_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const recipe: WorkflowRecipe = {
    id,
    name: params.name.trim(),
    description: params.description.trim(),
    origin: params.origin || "*",
    triggerPhrases: params.triggerPhrases,
    steps: params.steps,
    parameters: params.parameters || [],
    confidence: 1.0,
    approvedByUser: false, // Explicit user approval required before automatic execution
    createdAt: new Date().toISOString(),
    executionCount: 0,
    executionHistory: [],
  };

  return { recipe };
}

/**
 * Explicit user confirmation gate to approve a recipe for execution.
 */
export function approveWorkflowRecipe(recipe: WorkflowRecipe): WorkflowRecipe {
  return {
    ...recipe,
    approvedByUser: true,
  };
}

/**
 * Updates an existing recipe safely.
 */
export function updateWorkflowRecipe(
  recipe: WorkflowRecipe,
  updates: Partial<
    Pick<WorkflowRecipe, "name" | "description" | "steps" | "parameters" | "schedule">
  >,
): WorkflowRecipe {
  return {
    ...recipe,
    ...updates,
  };
}

/**
 * Records a completed or failed execution run in the recipe history.
 */
export function recordWorkflowExecution(
  recipe: WorkflowRecipe,
  run: WorkflowExecutionRun,
): WorkflowRecipe {
  const history = recipe.executionHistory ? [...recipe.executionHistory] : [];
  history.unshift(run);
  if (history.length > 20) history.pop();

  return {
    ...recipe,
    executionCount: recipe.executionCount + 1,
    lastExecutedAt: run.executedAt,
    executionHistory: history,
  };
}

/**
 * Analyzes task logs to detect repeated workflow patterns
 */
export function detectRepeatedWorkflowPattern(
  history: TaskLogEntry[],
  minRepetitions = 2,
): WorkflowRecipe | null {
  if (!history || history.length < minRepetitions) return null;

  // Group by normalized title / intent / origin
  const counts = new Map<string, { count: number; sample: TaskLogEntry }>();

  for (const task of history) {
    if (task.status !== "completed") continue;
    const norm = task.title
      .toLowerCase()
      .replace(/[0-9#_-]+/g, "")
      .replace(/\s+/g, " ")
      .trim();

    if (!norm) continue;
    const existing = counts.get(norm) ?? { count: 0, sample: task };
    existing.count += 1;
    counts.set(norm, existing);
  }

  // Find candidate exceeding repetition threshold
  for (const [pattern, item] of counts.entries()) {
    if (item.count >= minRepetitions) {
      const id = `recipe_auto_${Date.now()}`;
      return {
        id,
        name: capitalizeWords(item.sample.title),
        description: `Automated repeated workflow identified from ${item.count} recent successful runs.`,
        origin: item.sample.pageOrigin || "*",
        triggerPhrases: [pattern, `run ${pattern}`, `execute ${pattern}`],
        confidence: Math.min(0.95, 0.7 + item.count * 0.1),
        approvedByUser: false, // Requires explicit user approval before auto-running
        createdAt: new Date().toISOString(),
        executionCount: item.count,
        steps: [
          {
            id: `${id}_s1`,
            order: 1,
            label: `Execute ${item.sample.title}`,
            actionType: "multi_step",
          },
        ],
      };
    }
  }

  return null;
}

/**
 * Validates a workflow recipe before saving
 */
export function validateWorkflowRecipe(recipe: Partial<WorkflowRecipe>): {
  valid: boolean;
  reason?: string;
} {
  if (!recipe.name?.trim()) {
    return { valid: false, reason: "Recipe must have a descriptive name." };
  }
  if (!recipe.steps || recipe.steps.length === 0) {
    return { valid: false, reason: "Recipe must contain at least one step." };
  }

  // Block hardcoded passwords/secrets in parameters or defaults
  for (const step of recipe.steps) {
    const val = (step.defaultValue || "") + (step.parameterKey || "");
    if (/password|pin|otp|cvv|secret_key/i.test(val)) {
      return {
        valid: false,
        reason: "Security block: Workflow recipes cannot store credentials or security secrets.",
      };
    }
  }

  return { valid: true };
}

function capitalizeWords(str: string): string {
  return str
    .split(/\s+/)
    .map((w) => (w[0] ? w[0].toUpperCase() + w.slice(1).toLowerCase() : ""))
    .join(" ");
}

export interface ParsedNaturalWorkflow {
  name: string;
  scheduleType: ScheduleConfig["type"];
  scheduleSummary: string;
  steps: RecipeStep[];
  needsClarification: boolean;
  missingDetails: string[];
  requiredConnectors: string[];
  requiredFiles: string[];
  recipe: WorkflowRecipe;
}

function parseTimeOfDay(text: string): string | undefined {
  const m = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|baje)?\b/i);
  if (!m) return undefined;
  let hh = Number(m[1]);
  const mm = m[2] ? Number(m[2]) : 0;
  const suffix = (m[3] || "").toLowerCase();
  if (Number.isNaN(hh) || hh > 24 || mm > 59) return undefined;
  if (suffix === "pm" && hh < 12) hh += 12;
  if (suffix === "am" && hh === 12) hh = 0;
  if (!suffix && /\b(?:shaam|evening|raat|night)\b/i.test(text) && hh < 12) hh += 12;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/**
 * Conversational Workflow Builder: parses English/Hinglish prompts into a
 * parameterized, safety-gated WorkflowRecipe requiring explicit approval before enabling.
 */
export function parseNaturalLanguageWorkflow(
  prompt: string,
  options?: {
    availableFiles?: string[] | undefined;
    availableConnectors?: string[] | undefined;
  },
): ParsedNaturalWorkflow {
  const clean = prompt.trim();
  const lower = clean.toLowerCase();
  const missingDetails: string[] = [];

  // 1. Determine Schedule
  const timeOfDay = parseTimeOfDay(lower);
  let schedule: ScheduleConfig = { type: "manual", frequency: "manual" };
  let scheduleSummary = "Manual execution (on demand)";

  if (/\b(?:every\s+hour|hourly|har\s+ghante|every\s+(\d+)\s+min)/i.test(lower)) {
    const minMatch = lower.match(/every\s+(\d+)\s+min/i);
    const intervalMinutes = minMatch ? Math.max(5, Number(minMatch[1])) : 60;
    schedule = {
      type: "recurring",
      frequency: "hourly",
      intervalMinutes,
      cronExpression: intervalMinutes === 60 ? "0 * * * *" : `*/${intervalMinutes} * * * *`,
    };
    scheduleSummary =
      intervalMinutes === 60
        ? "Recurring every hour"
        : `Recurring every ${intervalMinutes} minutes`;
  } else if (
    /\b(?:every\s+week|weekly|har\s+hafte|every\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i.test(
      lower,
    )
  ) {
    const dayMatch = lower.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
    schedule = {
      type: "recurring",
      frequency: "weekly",
      dayOfWeek: dayMatch ? dayMatch[1]!.toLowerCase() : "monday",
      timeOfDay: timeOfDay ?? "09:00",
      cronExpression: `0 ${(timeOfDay ?? "09:00").split(":")[0]} * * 1`,
    };
    scheduleSummary = `Weekly on ${capitalizeWords(schedule.dayOfWeek || "Monday")} at ${schedule.timeOfDay}`;
  } else if (/\b(?:every\s+day|daily|har\s+roz|rozana|subah|daily\s+at)\b/i.test(lower)) {
    const t = timeOfDay ?? "09:00";
    const [hh, mm] = t.split(":");
    schedule = {
      type: "recurring",
      frequency: "daily",
      timeOfDay: t,
      cronExpression: `${Number(mm ?? 0)} ${Number(hh ?? 9)} * * *`,
    };
    scheduleSummary = `Daily at ${t}`;
  } else if (/\b(?:tomorrow|once|kal|ek\s+baar)\b/i.test(lower)) {
    const runAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    if (timeOfDay) {
      const [hh, mm] = timeOfDay.split(":").map(Number);
      runAt.setHours(hh || 9, mm || 0, 0, 0);
    }
    schedule = {
      type: "once",
      frequency: "manual",
      timeOfDay,
      runAtIso: runAt.toISOString(),
    };
    scheduleSummary = `One-time run (${runAt.toISOString().slice(0, 16).replace("T", " ")})`;
  } else if (
    /\b(?:when|if|agar|jab)\b/i.test(lower) &&
    /[><=]|\b(?:exceeds|drops|changes|arrives)\b/i.test(lower)
  ) {
    schedule = {
      type: "condition_trigger",
      frequency: "manual",
      conditionExpression: clean.slice(0, 160),
    };
    scheduleSummary = `Condition-triggered: ${clean.slice(0, 80)}`;
  }

  // 2. Identify Connectors & Files referenced
  const requiredConnectors: string[] = [];
  if (/\b(?:gmail|email|mail)\b/i.test(lower)) requiredConnectors.push("gmail");
  if (/\b(?:google\s+sheets?|spreadsheet)\b/i.test(lower)) requiredConnectors.push("google_sheets");
  if (/\b(?:google\s+drive|drive)\b/i.test(lower)) requiredConnectors.push("google_drive");
  if (/\b(?:slack)\b/i.test(lower)) requiredConnectors.push("slack");
  if (/\b(?:github|repo|pull\s+request|issue)\b/i.test(lower)) requiredConnectors.push("github");
  if (/\b(?:meesho)\b/i.test(lower)) requiredConnectors.push("meesho_supplier");

  const requiredFiles: string[] = [];
  const fileMatches = clean.match(/[\w.-]+\.(?:xlsx|csv|docx|pdf|json|tsv)/gi) ?? [];
  for (const fm of fileMatches) {
    if (!requiredFiles.includes(fm)) requiredFiles.push(fm);
  }

  if (options?.availableFiles && requiredFiles.length > 0) {
    for (const reqFile of requiredFiles) {
      if (!options.availableFiles.some((f) => f.toLowerCase() === reqFile.toLowerCase())) {
        missingDetails.push(`Required file "${reqFile}" is not uploaded in workspace yet.`);
      }
    }
  }
  if (options?.availableConnectors && requiredConnectors.length > 0) {
    for (const conn of requiredConnectors) {
      if (conn !== "meesho_supplier" && !options.availableConnectors.includes(conn)) {
        missingDetails.push(`Connector "${conn}" is not connected yet.`);
      }
    }
  }

  // 3. Build Workflow Steps
  const steps: RecipeStep[] = [];
  let order = 1;
  if (/\b(?:open|check|visit|meesho|orders|portal|website)\b/i.test(lower)) {
    steps.push({
      id: `wf_s${order}`,
      order: order++,
      label: "Observe & collect live portal records",
      actionType: "extract_table",
    });
  }
  if (/\b(?:compare|reconcile|spreadsheet|excel|xlsx|csv)\b/i.test(lower)) {
    steps.push({
      id: `wf_s${order}`,
      order: order++,
      label: "Compare & analyze spreadsheet dataset",
      actionType: "extract",
    });
  }
  if (/\b(?:report|summary|pdf|docx|export)\b/i.test(lower)) {
    steps.push({
      id: `wf_s${order}`,
      order: order++,
      label: "Generate structured summary artifact",
      actionType: "multi_step",
    });
  }
  if (/\b(?:send|email|notify|slack|post|submit|delete)\b/i.test(lower)) {
    steps.push({
      id: `wf_s${order}`,
      order: order++,
      label: "Send notification or apply consequential update (approval gated)",
      actionType: "click",
      isConsequential: true,
    });
  }
  if (steps.length === 0) {
    if (clean.length < 8) {
      missingDetails.push("Please specify what action steps this workflow should perform.");
    } else {
      steps.push({
        id: "wf_s1",
        order: 1,
        label: clean.slice(0, 100),
        actionType: "multi_step",
      });
    }
  }

  const name = capitalizeWords(
    clean
      .replace(
        /\b(?:every\s+day|daily|weekly|hourly|har\s+roz|rozana|subah|at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm|baje)?)\b/gi,
        "",
      )
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 56) || "Custom Scheduled Workflow",
  );

  const id = `recipe_nl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`;
  const recipe: WorkflowRecipe = {
    id,
    name,
    description: clean.slice(0, 240),
    origin: requiredConnectors.includes("meesho_supplier") ? "supplier.meesho.com" : "*",
    triggerPhrases: [clean.toLowerCase().slice(0, 80)],
    steps:
      steps.length > 0
        ? steps
        : [{ id: "wf_s1", order: 1, label: clean.slice(0, 80), actionType: "multi_step" }],
    confidence: missingDetails.length === 0 ? 0.92 : 0.6,
    approvedByUser: false,
    enabled: false,
    createdAt: new Date().toISOString(),
    executionCount: 0,
    executionHistory: [],
    schedule,
    retryPolicy: {
      maxRetries: 2,
      backoffMs: 1500,
      notifyOnFailure: true,
    },
    requiredConnectors,
    requiredFiles,
    missingDetails,
  };

  return {
    name: recipe.name,
    scheduleType: schedule.type,
    scheduleSummary,
    steps: recipe.steps,
    needsClarification: missingDetails.length > 0,
    missingDetails,
    requiredConnectors,
    requiredFiles,
    recipe,
  };
}

/**
 * Edits a saved workflow naturally (pause, resume, change time/frequency, update retries, rename).
 */
export function editWorkflowNaturally(
  recipe: WorkflowRecipe,
  instruction: string,
): { recipe: WorkflowRecipe; changeSummary: string } {
  const lower = instruction.toLowerCase();
  const updated: WorkflowRecipe = {
    ...recipe,
    schedule: recipe.schedule ? { ...recipe.schedule } : { type: "manual", frequency: "manual" },
    retryPolicy: recipe.retryPolicy
      ? { ...recipe.retryPolicy }
      : { maxRetries: 2, backoffMs: 1500, notifyOnFailure: true },
  };
  const changes: string[] = [];

  if (/\b(?:pause|stop|disable|band\s+karo|rok\s+do)\b/i.test(lower)) {
    updated.enabled = false;
    changes.push("Paused workflow");
  } else if (/\b(?:resume|enable|start|chalu\s+karo)\b/i.test(lower)) {
    if (updated.approvedByUser) {
      updated.enabled = true;
      changes.push("Resumed workflow");
    } else {
      changes.push("Cannot enable until explicitly approved");
    }
  }

  const newTime = parseTimeOfDay(lower);
  if (newTime) {
    updated.schedule = {
      ...updated.schedule,
      type: "recurring",
      frequency: updated.schedule?.frequency === "weekly" ? "weekly" : "daily",
      timeOfDay: newTime,
      cronExpression: `${Number(newTime.split(":")[1] ?? 0)} ${Number(newTime.split(":")[0] ?? 9)} * * *`,
    };
    changes.push(`Updated schedule time to ${newTime}`);
  }

  const retryMatch = lower.match(/\b(\d+)\s*retr(?:y|ies)\b/i);
  if (retryMatch) {
    updated.retryPolicy!.maxRetries = Math.min(5, Math.max(0, Number(retryMatch[1])));
    changes.push(`Updated maxRetries to ${updated.retryPolicy!.maxRetries}`);
  }

  const renameMatch = instruction.match(/\brename\s+(?:it\s+)?to\s+["']?([^"'\n]+)["']?/i);
  if (renameMatch?.[1]) {
    updated.name = renameMatch[1].trim();
    changes.push(`Renamed workflow to "${updated.name}"`);
  }

  return {
    recipe: updated,
    changeSummary:
      changes.length > 0 ? changes.join("; ") : "No editable fields matched instruction.",
  };
}

export interface BusinessWorkflowTemplate {
  id: string;
  name: string;
  category: "finance" | "ecommerce" | "inventory" | "procurement" | "executive";
  description: string;
  requiredConnectors: string[];
  parameters: RecipeParameter[];
  steps: RecipeStep[];
  defaultSchedule: ScheduleConfig;
}

export const BUSINESS_WORKFLOW_TEMPLATES: BusinessWorkflowTemplate[] = [
  {
    id: "tpl_gst_invoice_reconciliation",
    name: "GST Invoice & Ledger Reconciliation",
    category: "finance",
    description:
      "Extract invoice rows, verify GST tax totals against uploaded accounting ledger, and flag mismatches without modifying source records.",
    requiredConnectors: ["google_sheets"],
    parameters: [
      {
        key: "gstRatePercent",
        label: "Expected GST Rate (%)",
        type: "number",
        defaultValue: 18,
        required: true,
      },
      {
        key: "invoiceColumn",
        label: "Invoice ID Column",
        type: "string",
        defaultValue: "invoice_no",
        required: true,
      },
    ],
    defaultSchedule: {
      type: "recurring",
      frequency: "weekly",
      dayOfWeek: "friday",
      timeOfDay: "17:00",
    },
    steps: [
      {
        id: "gst_s1",
        order: 1,
        label: "Extract invoice table from portal or workspace",
        actionType: "extract_table",
      },
      {
        id: "gst_s2",
        order: 2,
        label: "Reconcile GST sums & missing invoices",
        actionType: "extract",
        parameterKey: "invoiceColumn",
      },
      {
        id: "gst_s3",
        order: 3,
        label: "Prepare discrepancy audit summary",
        actionType: "multi_step",
      },
    ],
  },
  {
    id: "tpl_order_returns_audit",
    name: "E-Commerce Order & Returns Audit",
    category: "ecommerce",
    description:
      "Compute return rate, RTO counts, and SKU return anomalies from seller order exports.",
    requiredConnectors: ["google_sheets"],
    parameters: [
      {
        key: "returnThresholdPct",
        label: "Alert Threshold (%)",
        type: "number",
        defaultValue: 12,
        required: true,
      },
    ],
    defaultSchedule: { type: "recurring", frequency: "daily", timeOfDay: "09:30" },
    steps: [
      {
        id: "ret_s1",
        order: 1,
        label: "Collect seller orders & return status rows",
        actionType: "extract_table",
      },
      {
        id: "ret_s2",
        order: 2,
        label: "Calculate SKU return & RTO rate",
        actionType: "extract",
        parameterKey: "returnThresholdPct",
      },
      {
        id: "ret_s3",
        order: 3,
        label: "Draft returns escalation report (approval required before send)",
        actionType: "click",
        isConsequential: true,
      },
    ],
  },
  {
    id: "tpl_inventory_low_stock_alert",
    name: "Inventory Low-Stock & Reorder Alert",
    category: "inventory",
    description:
      "Scan stock quantities across warehouse sheets, flag SKUs below threshold, and stage supplier reorder draft.",
    requiredConnectors: ["slack"],
    parameters: [
      {
        key: "minStockUnits",
        label: "Low Stock Threshold",
        type: "number",
        defaultValue: 10,
        required: true,
      },
    ],
    defaultSchedule: { type: "recurring", frequency: "daily", timeOfDay: "08:00" },
    steps: [
      {
        id: "inv_s1",
        order: 1,
        label: "Read inventory sheet & stock levels",
        actionType: "extract_table",
      },
      {
        id: "inv_s2",
        order: 2,
        label: "Flag SKUs at or below threshold",
        actionType: "extract",
        parameterKey: "minStockUnits",
      },
      {
        id: "inv_s3",
        order: 3,
        label: "Notify purchasing channel after approval",
        actionType: "click",
        isConsequential: true,
      },
    ],
  },
  {
    id: "tpl_supplier_price_variance",
    name: "Supplier Cost & Price Variance Check",
    category: "procurement",
    description:
      "Compare current supplier quotes against historical PO rates and surface price hikes cleanly.",
    requiredConnectors: ["google_drive"],
    parameters: [
      {
        key: "maxVariancePct",
        label: "Allowed Price Variance (%)",
        type: "number",
        defaultValue: 5,
        required: true,
      },
    ],
    defaultSchedule: { type: "manual", frequency: "manual" },
    steps: [
      {
        id: "sup_s1",
        order: 1,
        label: "Load supplier price sheet & historical baseline",
        actionType: "extract",
      },
      {
        id: "sup_s2",
        order: 2,
        label: "Compute SKU-level price delta & variance %",
        actionType: "multi_step",
        parameterKey: "maxVariancePct",
      },
    ],
  },
  {
    id: "tpl_daily_executive_kpi",
    name: "Daily Executive KPI Summary",
    category: "executive",
    description:
      "Aggregate revenue, gross margin, return rate, and open alerts into an executive digest.",
    requiredConnectors: ["gmail", "google_sheets"],
    parameters: [
      {
        key: "recipientEmail",
        label: "Digest Recipient",
        type: "string",
        defaultValue: "",
        required: false,
      },
    ],
    defaultSchedule: { type: "recurring", frequency: "daily", timeOfDay: "19:00" },
    steps: [
      {
        id: "kpi_s1",
        order: 1,
        label: "Compute daily business KPIs deterministically",
        actionType: "extract",
      },
      {
        id: "kpi_s2",
        order: 2,
        label: "Format executive digest & await send confirmation",
        actionType: "click",
        isConsequential: true,
      },
    ],
  },
];

export function listBusinessWorkflowTemplates(): BusinessWorkflowTemplate[] {
  return BUSINESS_WORKFLOW_TEMPLATES.map((t) => ({
    ...t,
    parameters: t.parameters.map((p) => ({ ...p })),
    steps: t.steps.map((s) => ({ ...s })),
  }));
}

/**
 * Instantiates a parameterized business template into a safety-gated WorkflowRecipe.
 * Always initializes approvedByUser=false and enabled=false so the user must explicitly approve.
 */
export function instantiateBusinessTemplate(
  templateId: string,
  overrides?: {
    name?: string | undefined;
    userId?: string | undefined;
    parameterValues?: Record<string, string | number | boolean> | undefined;
    schedule?: ScheduleConfig | undefined;
  },
): { recipe: WorkflowRecipe | null; error?: string } {
  const tpl = BUSINESS_WORKFLOW_TEMPLATES.find((t) => t.id === templateId);
  if (!tpl) {
    return { recipe: null, error: `Unknown business template: ${templateId}` };
  }
  const paramValues = overrides?.parameterValues ?? {};
  const parameters: RecipeParameter[] = tpl.parameters.map((p) => ({
    ...p,
    defaultValue: paramValues[p.key] ?? p.defaultValue,
  }));
  const steps: RecipeStep[] = tpl.steps.map((s) => ({
    ...s,
    defaultValue:
      s.parameterKey && paramValues[s.parameterKey] !== undefined
        ? String(paramValues[s.parameterKey])
        : s.defaultValue,
  }));

  const recipe: WorkflowRecipe = {
    id: `recipe_${tpl.id}_${Date.now().toString(36)}`,
    userId: overrides?.userId,
    name: overrides?.name?.trim() || tpl.name,
    description: tpl.description,
    origin: "*",
    triggerPhrases: [tpl.name.toLowerCase(), tpl.id],
    parameters,
    steps,
    confidence: 0.96,
    approvedByUser: false,
    enabled: false,
    createdAt: new Date().toISOString(),
    executionCount: 0,
    executionHistory: [],
    schedule: overrides?.schedule ?? { ...tpl.defaultSchedule },
    retryPolicy: { maxRetries: 2, backoffMs: 1500, notifyOnFailure: true },
    requiredConnectors: [...tpl.requiredConnectors],
  };

  return { recipe };
}

export interface CompiledNaturalLanguageWorkflow {
  draftRecipe: WorkflowRecipe;
  triggerType: "cron" | "interval" | "one_time" | "event" | "manual";
  cronExpression?: string | undefined;
  intervalMinutes?: number | undefined;
  runAtIso?: string | undefined;
  missingParameters: string[];
  clarificationPrompt?: string | undefined;
  previewSummary: string;
}

/**
 * Compiles a natural-language automation instruction into a safety-gated draft workflow
 * (always initialized approvedByUser=false) with cron expression extraction and missing parameter detection.
 */
export function compileNaturalLanguageWorkflow(
  instruction: string,
  options?: {
    targetUrl?: string | undefined;
    sourceDomain?: string | undefined;
    availableFiles?: string[] | undefined;
    availableConnectors?: string[] | undefined;
  },
): CompiledNaturalLanguageWorkflow {
  const clean = instruction.trim();
  const lower = clean.toLowerCase();
  const parsed = parseNaturalLanguageWorkflow(clean, {
    availableFiles: options?.availableFiles,
    availableConnectors: options?.availableConnectors,
  });

  const missingParameters = [...parsed.missingDetails];
  const hasConcreteTarget =
    /\b(?:order|orders|meesho|amazon|flipkart|spreadsheet|excel|xlsx|csv|report|summary|invoice|gst|email|gmail|slack|github|table|portal|inventory|sku|backup)\b/i.test(
      lower,
    );
  const hasScheduleSignal =
    /\b(?:every\s+(?:morning|evening|night|day|hour|week|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d+\s*(?:min|minute|hour))|daily|weekly|hourly|har\s+roz|rozana|tomorrow|once)\b/i.test(
      lower,
    );
  const isVague =
    /\bsomething\b/i.test(lower) ||
    (!hasConcreteTarget && clean.split(/\s+/).length < 6) ||
    (!hasScheduleSignal && /\bschedule\b/i.test(lower));

  if (isVague && missingParameters.length === 0) {
    if (!hasConcreteTarget) {
      missingParameters.push("Specify the target portal, file, or report action.");
    }
    if (!hasScheduleSignal) {
      missingParameters.push("Specify schedule cadence or time (e.g., every morning at 9 AM).");
    }
  }

  // Normalize "every morning at 9" / "daily" schedules to cron
  const timeOfDay = parseTimeOfDay(lower);
  let triggerType: CompiledNaturalLanguageWorkflow["triggerType"] = "manual";
  let cronExpression = parsed.recipe.schedule?.cronExpression;
  const intervalMinutes = parsed.recipe.schedule?.intervalMinutes;
  const runAtIso = parsed.recipe.schedule?.runAtIso;

  if (parsed.scheduleType === "recurring" && cronExpression) {
    triggerType = "cron";
  } else if (/\bevery\s+(?:morning|evening|night|afternoon)\b/i.test(lower)) {
    const t = timeOfDay ?? (/evening|night/i.test(lower) ? "18:00" : "09:00");
    const [hh, mm] = t.split(":");
    triggerType = "cron";
    cronExpression = `${Number(mm ?? 0)} ${Number(hh ?? 9)} * * *`;
    parsed.recipe.schedule = {
      type: "recurring",
      frequency: "daily",
      timeOfDay: t,
      cronExpression,
    };
  } else if (parsed.scheduleType === "once") {
    triggerType = "one_time";
  } else if (parsed.scheduleType === "condition_trigger") {
    triggerType = "event";
  }

  if (options?.sourceDomain) {
    parsed.recipe.origin = options.sourceDomain;
  }

  const clarificationPrompt =
    missingParameters.length > 0
      ? `Please clarify before activating: ${missingParameters.join(" ")}`
      : undefined;

  const previewSummary = [
    `Workflow: ${parsed.name}`,
    `Trigger: ${triggerType}${cronExpression ? ` (${cronExpression})` : ""}`,
    `Steps: ${parsed.steps.map((s) => `${s.order}. ${s.label}`).join(" -> ")}`,
    missingParameters.length > 0
      ? `Missing details: ${missingParameters.join("; ")}`
      : "Approval required before activation.",
  ].join("\n");

  return {
    draftRecipe: {
      ...parsed.recipe,
      approvedByUser: false,
    },
    triggerType,
    cronExpression,
    intervalMinutes,
    runAtIso,
    missingParameters,
    clarificationPrompt,
    previewSummary,
  };
}
