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

export interface WorkflowExecutionRun {
  runId: string;
  recipeId: string;
  executedAt: string;
  durationMs: number;
  status: "completed" | "failed" | "cancelled" | "paused";
  stepsCompleted: number;
  outputSummary?: string | undefined;
  error?: string | undefined;
}

export interface WorkflowRecipe {
  id: string;
  name: string;
  description: string;
  origin: string;
  triggerPhrases: string[];
  parameters?: RecipeParameter[] | undefined;
  steps: RecipeStep[];
  confidence: number;
  approvedByUser: boolean;
  createdAt: string;
  lastExecutedAt?: string | undefined;
  executionCount: number;
  executionHistory?: WorkflowExecutionRun[] | undefined;
  schedule?:
    | {
        frequency?: "daily" | "weekly" | "hourly" | "manual" | undefined;
        timeOfDay?: string | undefined;
      }
    | undefined;
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
