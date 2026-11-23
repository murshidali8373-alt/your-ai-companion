/**
 * DECLARATIVE REUSABLE SKILLS ECOSYSTEM (Phase 9)
 *
 * Strictly zero-eval declarative skill contracts with Zod schemas, version history,
 * permission gates, connector allowlists, timeout enforcement, and safe rollback.
 */

import { z } from "zod";
import { levelRank, type PermissionLevel } from "@/shared/permissions";
import {
  compareBusinessPeriods,
  computeBusinessMetrics,
  filterSortGroupRecords,
  type FilterRule,
} from "@/lib/engines/data-intelligence-engine";

export type SkillRiskLevel = "read_only" | "assist" | "consequential";

export type DeclarativeStepOp =
  | "validate_input"
  | "compute_kpis"
  | "compare_periods"
  | "filter_rows"
  | "extract_fields"
  | "format_summary"
  | "require_approval";

export interface DeclarativeSkillStep {
  id: string;
  op: DeclarativeStepOp;
  label: string;
  params?: Record<string, unknown> | undefined;
}

export interface SkillContract<
  TInput extends z.ZodTypeAny = z.ZodTypeAny,
  TOutput extends z.ZodTypeAny = z.ZodTypeAny,
> {
  id: string;
  version: string;
  name: string;
  description: string;
  inputSchema: TInput;
  outputSchema: TOutput;
  riskLevel: SkillRiskLevel;
  requiredPermissions: PermissionLevel;
  timeoutMs: number;
  allowedConnectors: string[];
  deprecated?: boolean | undefined;
  previousVersion?: string | undefined;
  steps: DeclarativeSkillStep[];
}

export interface SkillExecutionContext {
  permissionLevel: PermissionLevel;
  consentGranted?: boolean | undefined;
  requestedConnectors?: string[] | undefined;
  timeoutOverrideMs?: number | undefined;
}

export interface SkillExecutionResult {
  ok: boolean;
  skillId: string;
  version: string;
  output?: Record<string, unknown> | undefined;
  trace: Array<{
    stepId: string;
    op: DeclarativeStepOp;
    status: "ok" | "blocked" | "error";
    detail: string;
  }>;
  provenance: "calculated" | "extracted" | "unknown";
  requiresApproval?: boolean | undefined;
  error?: string | undefined;
}

const rowsInputSchema = z.object({
  rows: z.array(z.record(z.unknown())).default([]),
  previousRows: z.array(z.record(z.unknown())).optional(),
  threshold: z.number().optional(),
  filters: z
    .array(
      z.object({
        column: z.string(),
        operator: z.enum(["eq", "neq", "contains", "gt", "gte", "lt", "lte"]),
        value: z.unknown(),
      }),
    )
    .optional(),
  fields: z.array(z.string()).optional(),
});

const genericOutputSchema = z.record(z.unknown());

const BUILTIN_SKILLS: SkillContract[] = [
  {
    id: "order_returns_audit",
    version: "1.0.0",
    name: "Order & Returns Audit Skill",
    description:
      "Calculates return rate, RTO counts, revenue, and missing columns deterministically.",
    inputSchema: rowsInputSchema,
    outputSchema: genericOutputSchema,
    riskLevel: "read_only",
    requiredPermissions: "observe",
    timeoutMs: 5000,
    allowedConnectors: ["google_sheets"],
    steps: [
      { id: "s1", op: "validate_input", label: "Validate order rows payload" },
      { id: "s2", op: "compute_kpis", label: "Compute return rate & revenue metrics" },
      { id: "s3", op: "format_summary", label: "Format structured audit summary" },
    ],
  },
  {
    id: "invoice_gst_summary",
    version: "1.0.0",
    name: "Invoice & GST Summary Skill",
    description:
      "Filters invoice ledger rows, computes revenue/expense totals, and summarizes missing metrics.",
    inputSchema: rowsInputSchema,
    outputSchema: genericOutputSchema,
    riskLevel: "read_only",
    requiredPermissions: "observe",
    timeoutMs: 5000,
    allowedConnectors: ["google_sheets", "google_drive"],
    steps: [
      { id: "s1", op: "validate_input", label: "Validate invoice records" },
      { id: "s2", op: "filter_rows", label: "Apply optional ledger filters" },
      { id: "s3", op: "compute_kpis", label: "Aggregate invoice financials" },
      { id: "s4", op: "format_summary", label: "Generate GST ledger summary" },
    ],
  },
  {
    id: "inventory_restock_check",
    version: "1.0.0",
    name: "Inventory Restock Check Skill",
    description:
      "Identifies low-stock SKUs below threshold and calculates inventory turnover honestly.",
    inputSchema: rowsInputSchema,
    outputSchema: genericOutputSchema,
    riskLevel: "read_only",
    requiredPermissions: "observe",
    timeoutMs: 5000,
    allowedConnectors: ["google_sheets", "slack"],
    steps: [
      { id: "s1", op: "validate_input", label: "Validate inventory rows" },
      { id: "s2", op: "compute_kpis", label: "Detect low-stock SKUs & turnover" },
      { id: "s3", op: "format_summary", label: "Summarize restock recommendations" },
    ],
  },
  {
    id: "tab_comparison_summary",
    version: "1.0.0",
    name: "Period / Tab Comparison Summary Skill",
    description: "Compares current vs previous period rows and outputs deltas & percentage shifts.",
    inputSchema: rowsInputSchema,
    outputSchema: genericOutputSchema,
    riskLevel: "read_only",
    requiredPermissions: "observe",
    timeoutMs: 5000,
    allowedConnectors: [],
    steps: [
      { id: "s1", op: "validate_input", label: "Validate current and baseline rows" },
      { id: "s2", op: "compare_periods", label: "Compute period-over-period deltas" },
      { id: "s3", op: "format_summary", label: "Format comparison summary" },
    ],
  },
];

// Map<skillId, SkillContract[]> ordered oldest -> newest (active is last non-deprecated or explicit active version)
const skillVersions = new Map<string, SkillContract[]>();
const activeSkillVersion = new Map<string, string>();

function seedBuiltinSkills(): void {
  if (skillVersions.size > 0) return;
  for (const sk of BUILTIN_SKILLS) {
    skillVersions.set(sk.id, [{ ...sk, steps: [...sk.steps] }]);
    activeSkillVersion.set(sk.id, sk.version);
  }
}

export function resetSkillsRegistryForTests(): void {
  skillVersions.clear();
  activeSkillVersion.clear();
  seedBuiltinSkills();
}

export function registerSkill(contract: SkillContract): {
  ok: boolean;
  skill?: SkillContract;
  error?: string;
} {
  seedBuiltinSkills();
  if (!/^[a-z0-9_]{3,64}$/.test(contract.id)) {
    return {
      ok: false,
      error: "Skill id must be 3-64 lowercase alphanumeric/underscore characters.",
    };
  }
  if (!/^\d+\.\d+\.\d+$/.test(contract.version)) {
    return { ok: false, error: "Skill version must follow semver format (e.g. 1.0.0)." };
  }
  if (!contract.steps || contract.steps.length === 0) {
    return { ok: false, error: "Declarative skill must contain at least one step." };
  }
  const serialized = JSON.stringify(contract.steps);
  if (/eval\(|new\s+Function|password|secret_key|__proto__/i.test(serialized)) {
    return { ok: false, error: "Security block: Disallowed pattern inside skill definition." };
  }

  const history = skillVersions.get(contract.id) ?? [];
  const prevActive = activeSkillVersion.get(contract.id);
  const stored: SkillContract = {
    ...contract,
    previousVersion: contract.previousVersion ?? prevActive,
    steps: contract.steps.map((s) => ({ ...s })),
  };
  const idx = history.findIndex((h) => h.version === stored.version);
  if (idx >= 0) {
    history[idx] = stored;
  } else {
    history.push(stored);
  }
  skillVersions.set(contract.id, history);
  activeSkillVersion.set(contract.id, stored.version);
  return { ok: true, skill: stored };
}

export function rollbackSkillVersion(
  skillId: string,
  targetVersion?: string,
): { ok: boolean; activeVersion?: string; skill?: SkillContract; error?: string } {
  seedBuiltinSkills();
  const history = skillVersions.get(skillId);
  if (!history || history.length === 0) {
    return { ok: false, error: `Skill "${skillId}" not found.` };
  }
  const currentVer = activeSkillVersion.get(skillId);
  const current = history.find((h) => h.version === currentVer) ?? history[history.length - 1]!;
  const desiredVersion = targetVersion ?? current.previousVersion;
  if (!desiredVersion) {
    return { ok: false, error: `No previous version available to roll back "${skillId}".` };
  }
  const target = history.find((h) => h.version === desiredVersion);
  if (!target) {
    return { ok: false, error: `Target version "${desiredVersion}" not found for "${skillId}".` };
  }
  activeSkillVersion.set(skillId, target.version);
  return { ok: true, activeVersion: target.version, skill: target };
}

export function getSkillContract(skillId: string, version?: string): SkillContract | null {
  seedBuiltinSkills();
  const history = skillVersions.get(skillId);
  if (!history || history.length === 0) return null;
  const targetVer = version ?? activeSkillVersion.get(skillId);
  return history.find((h) => h.version === targetVer) ?? history[history.length - 1] ?? null;
}

export function listSkills(includeDeprecated = false): SkillContract[] {
  seedBuiltinSkills();
  const list: SkillContract[] = [];
  for (const id of skillVersions.keys()) {
    const sk = getSkillContract(id);
    if (sk && (includeDeprecated || !sk.deprecated)) {
      list.push(sk);
    }
  }
  return list;
}

/**
 * Pure declarative step runner (never uses eval or arbitrary code execution).
 */
export async function executeDeclarativeSkill(
  skillId: string,
  input: unknown,
  context: SkillExecutionContext,
): Promise<SkillExecutionResult> {
  seedBuiltinSkills();
  const skill = getSkillContract(skillId);
  if (!skill) {
    return {
      ok: false,
      skillId,
      version: "unknown",
      trace: [],
      provenance: "unknown",
      error: `Skill "${skillId}" is not registered.`,
    };
  }
  if (skill.deprecated) {
    return {
      ok: false,
      skillId: skill.id,
      version: skill.version,
      trace: [],
      provenance: "unknown",
      error: `Skill "${skill.id}" v${skill.version} is deprecated.`,
    };
  }

  // Permission enforcement
  if (levelRank(context.permissionLevel) < levelRank(skill.requiredPermissions)) {
    return {
      ok: false,
      skillId: skill.id,
      version: skill.version,
      trace: [
        {
          stepId: "gate",
          op: "require_approval",
          status: "blocked",
          detail: "Insufficient permission level",
        },
      ],
      provenance: "unknown",
      requiresApproval: true,
      error: `Permission denied: "${skill.id}" requires "${skill.requiredPermissions}" (current: "${context.permissionLevel}").`,
    };
  }
  if (skill.riskLevel === "consequential" && !context.consentGranted) {
    return {
      ok: false,
      skillId: skill.id,
      version: skill.version,
      trace: [
        {
          stepId: "gate",
          op: "require_approval",
          status: "blocked",
          detail: "Missing user consent",
        },
      ],
      provenance: "unknown",
      requiresApproval: true,
      error: `Consequential skill "${skill.id}" requires explicit consentGranted=true.`,
    };
  }

  // Connector allowlist enforcement
  if (context.requestedConnectors?.length) {
    const disallowed = context.requestedConnectors.filter(
      (c) => !skill.allowedConnectors.includes(c),
    );
    if (disallowed.length > 0) {
      return {
        ok: false,
        skillId: skill.id,
        version: skill.version,
        trace: [
          {
            stepId: "connectors",
            op: "validate_input",
            status: "blocked",
            detail: `Disallowed connector(s): ${disallowed.join(", ")}`,
          },
        ],
        provenance: "unknown",
        error: `Connector(s) not allowlisted for skill "${skill.id}": ${disallowed.join(", ")}.`,
      };
    }
  }

  const parsedInput = skill.inputSchema.safeParse(input ?? {});
  if (!parsedInput.success) {
    return {
      ok: false,
      skillId: skill.id,
      version: skill.version,
      trace: [
        {
          stepId: "schema",
          op: "validate_input",
          status: "error",
          detail: parsedInput.error.message,
        },
      ],
      provenance: "unknown",
      error: `Skill input validation failed: ${parsedInput.error.message}`,
    };
  }

  const data = (parsedInput.data ?? {}) as {
    rows?: Array<Record<string, unknown>>;
    previousRows?: Array<Record<string, unknown>>;
    threshold?: number;
    filters?: FilterRule[];
    fields?: string[];
  };

  let workingRows = Array.isArray(data.rows) ? [...data.rows] : [];
  const state: Record<string, unknown> = {};
  const trace: SkillExecutionResult["trace"] = [];
  const start = Date.now();
  const maxMs = Math.max(100, context.timeoutOverrideMs ?? skill.timeoutMs);

  for (const step of skill.steps) {
    if (Date.now() - start > maxMs) {
      trace.push({
        stepId: step.id,
        op: step.op,
        status: "error",
        detail: "Skill execution timed out.",
      });
      return {
        ok: false,
        skillId: skill.id,
        version: skill.version,
        trace,
        provenance: "unknown",
        error: `Skill "${skill.id}" exceeded timeout of ${maxMs}ms.`,
      };
    }

    if (step.op === "validate_input") {
      trace.push({
        stepId: step.id,
        op: step.op,
        status: "ok",
        detail: `Validated ${workingRows.length} row(s).`,
      });
    } else if (step.op === "filter_rows") {
      const filters = data.filters ?? (step.params?.["filters"] as FilterRule[] | undefined);
      if (filters && filters.length > 0) {
        const res = filterSortGroupRecords(workingRows, { filters });
        workingRows = res.filteredRows;
        state["filteredRowCount"] = workingRows.length;
      }
      trace.push({
        stepId: step.id,
        op: step.op,
        status: "ok",
        detail: `${workingRows.length} row(s) after filter.`,
      });
    } else if (step.op === "compute_kpis") {
      const kpis = computeBusinessMetrics(workingRows, {
        lowStockThreshold:
          data.threshold ??
          (typeof step.params?.["threshold"] === "number" ? step.params["threshold"] : undefined),
      });
      state["kpis"] = kpis;
      trace.push({ stepId: step.id, op: step.op, status: "ok", detail: kpis.summary });
    } else if (step.op === "compare_periods") {
      const prevRows = Array.isArray(data.previousRows) ? data.previousRows : [];
      const cmp = compareBusinessPeriods(workingRows, prevRows);
      state["periodComparison"] = cmp;
      trace.push({ stepId: step.id, op: step.op, status: "ok", detail: cmp.summary });
    } else if (step.op === "extract_fields") {
      const fields =
        data.fields ??
        (Array.isArray(step.params?.["fields"]) ? (step.params["fields"] as string[]) : []);
      const extracted = workingRows.map((r) => {
        if (!fields.length) return r;
        const proj: Record<string, unknown> = {};
        for (const f of fields) proj[f] = r[f];
        return proj;
      });
      state["extracted"] = extracted;
      trace.push({
        stepId: step.id,
        op: step.op,
        status: "ok",
        detail: `Extracted ${extracted.length} record(s).`,
      });
    } else if (step.op === "require_approval") {
      if (!context.consentGranted) {
        trace.push({
          stepId: step.id,
          op: step.op,
          status: "blocked",
          detail: "Approval gate reached without consent.",
        });
        return {
          ok: false,
          skillId: skill.id,
          version: skill.version,
          output: state,
          trace,
          provenance: "calculated",
          requiresApproval: true,
          error: `Step "${step.label}" requires explicit user approval.`,
        };
      }
      trace.push({ stepId: step.id, op: step.op, status: "ok", detail: "Consent verified." });
    } else if (step.op === "format_summary") {
      const kpiSummary = (state["kpis"] as { summary?: string } | undefined)?.summary;
      const cmpSummary = (state["periodComparison"] as { summary?: string } | undefined)?.summary;
      state["summary"] =
        cmpSummary || kpiSummary || `Processed ${workingRows.length} row(s) via ${skill.name}.`;
      trace.push({ stepId: step.id, op: step.op, status: "ok", detail: String(state["summary"]) });
    }
  }

  const parsedOutput = skill.outputSchema.safeParse(state);
  if (!parsedOutput.success) {
    return {
      ok: false,
      skillId: skill.id,
      version: skill.version,
      trace,
      provenance: "unknown",
      error: `Skill output schema check failed: ${parsedOutput.error.message}`,
    };
  }

  return {
    ok: true,
    skillId: skill.id,
    version: skill.version,
    output: state,
    trace,
    provenance: "calculated",
  };
}
