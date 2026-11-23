/**
 * CUSTOM AGENT BUILDER SDK & SANDBOX (Phase 9)
 *
 * Allows building custom declarative agents from natural language prompts,
 * validating typed contracts, dry-running in an isolated sandbox, and requiring
 * explicit user approval before registering into runtime execution.
 */

import { z } from "zod";
import { levelRank, type PermissionLevel } from "@/shared/permissions";
import type { CanonicalAgentId, Subtask } from "@/shared/task-context";
import {
  executeDeclarativeSkill,
  getSkillContract,
  listSkills,
} from "@/lib/skills/skills-registry";
import type { AgentExecutionResult, AgentRuntimeEnv } from "@/lib/agents/types";

export interface CustomAgentSpec {
  id: string;
  version: string;
  name: string;
  description: string;
  responsibility: string;
  minPermission: PermissionLevel;
  toolsAllowed: string[];
  skillIds: string[];
  requiresApprovalBeforeExternal: boolean;
  approvedByUser: boolean;
  approvedBy?: string | undefined;
  approvedAt?: string | undefined;
  createdAt: string;
  previousVersion?: string | undefined;
  status: "draft" | "sandbox_tested" | "approved" | "deprecated";
}

export interface AgentContractValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface AgentSandboxResult {
  ok: boolean;
  sandboxPassed: boolean;
  specId: string;
  outputs: Array<{ skillId: string; ok: boolean; summary: string }>;
  warnings: string[];
  errors: string[];
}

const customAgentSpecSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]{2,48}$/),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  name: z.string().min(3).max(80),
  description: z.string().min(8).max(400),
  responsibility: z.string().min(8).max(400),
  minPermission: z.enum(["observe", "explain", "suggest", "assist", "execute"]),
  toolsAllowed: z.array(z.string()).default([]),
  skillIds: z.array(z.string()).default([]),
  requiresApprovalBeforeExternal: z.boolean().default(true),
  approvedByUser: z.boolean().default(false),
});

const registeredCustomAgents = new Map<string, CustomAgentSpec>();

export function resetAgentSdkForTests(): void {
  registeredCustomAgents.clear();
}

/**
 * Generates a structured CustomAgentSpec draft from natural language (always unapproved by default).
 */
export function buildAgentFromNaturalLanguage(prompt: string): CustomAgentSpec {
  const clean = prompt.trim();
  const lower = clean.toLowerCase();

  const slugBase = lower
    .replace(/[^a-z0-9\s]/g, " ")
    .trim()
    .split(/\s+/)
    .slice(0, 4)
    .join("_") || "helper";
  const id = `custom_${slugBase}`.slice(0, 42);

  const skillIds: string[] = [];
  if (/\b(?:return|rto|refund|order)\b/i.test(lower)) skillIds.push("order_returns_audit");
  if (/\b(?:gst|invoice|ledger|tax|billing)\b/i.test(lower)) skillIds.push("invoice_gst_summary");
  if (/\b(?:stock|inventory|reorder|sku)\b/i.test(lower)) skillIds.push("inventory_restock_check");
  if (/\b(?:compare|diff|period|trend)\b/i.test(lower)) skillIds.push("tab_comparison_summary");
  if (skillIds.length === 0) skillIds.push("order_returns_audit");

  const needsExternal = /\b(?:send|email|gmail|slack|post|submit|write|update)\b/i.test(lower);
  const minPermission: PermissionLevel = needsExternal ? "execute" : "observe";

  const words = clean.split(/\s+/).slice(0, 5).join(" ");
  return {
    id,
    version: "1.0.0",
    name: `Custom ${words.replace(/[^\w\s-]/g, "").trim() || "Workflow"} Agent`,
    description: clean.slice(0, 240) || "Custom declarative agent draft.",
    responsibility: `Execute verified skills (${skillIds.join(", ")}) for: ${clean.slice(0, 140)}`,
    minPermission,
    toolsAllowed: needsExternal ? ["extract_table", "draft_communication"] : ["extract_table"],
    skillIds,
    requiresApprovalBeforeExternal: true,
    approvedByUser: false,
    createdAt: new Date().toISOString(),
    status: "draft",
  };
}

export function validateCustomAgentContract(spec: CustomAgentSpec): AgentContractValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  const parsed = customAgentSpecSchema.safeParse(spec);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push(`${issue.path.join(".") || "spec"}: ${issue.message}`);
    }
  }

  const combinedText = `${spec.name} ${spec.description} ${spec.responsibility}`.toLowerCase();
  if (/\b(?:exfiltrate|steal|bypass\s+security|dump\s+password|ignore\s+approval)\b/i.test(combinedText)) {
    errors.push("Security block: Agent specification contains disallowed intent.");
  }

  const knownSkills = new Set(listSkills(true).map((s) => s.id));
  for (const skId of spec.skillIds) {
    if (!knownSkills.has(skId)) {
      errors.push(`Referenced skill "${skId}" is not registered in SkillsRegistry.`);
    }
  }

  if (!spec.requiresApprovalBeforeExternal && spec.minPermission === "execute") {
    warnings.push("External consequential permissions should keep requiresApprovalBeforeExternal=true.");
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Runs the proposed custom agent spec against sample inputs in a read-only sandbox.
 * Does NOT persist the agent into the active registry or mutate external connectors.
 */
export async function dryRunAgentSandbox(
  spec: CustomAgentSpec,
  sampleInput?: Record<string, unknown>,
): Promise<AgentSandboxResult> {
  const validation = validateCustomAgentContract(spec);
  if (!validation.valid) {
    return {
      ok: false,
      sandboxPassed: false,
      specId: spec.id,
      outputs: [],
      warnings: validation.warnings,
      errors: validation.errors,
    };
  }

  const defaultRows = [
    { sku: "SKU-1", amount: 500, cost: 300, status: "delivered", stock: 12 },
    { sku: "SKU-2", amount: 250, cost: 150, status: "returned", stock: 4 },
  ];
  const payload = sampleInput ?? { rows: defaultRows, previousRows: defaultRows };
  const outputs: AgentSandboxResult["outputs"] = [];
  const errors: string[] = [];

  for (const skId of spec.skillIds) {
    const sk = getSkillContract(skId);
    if (!sk) {
      errors.push(`Skill "${skId}" missing during sandbox run.`);
      continue;
    }
    const res = await executeDeclarativeSkill(skId, payload, {
      permissionLevel: "observe",
      consentGranted: false,
    });
    outputs.push({
      skillId: skId,
      ok: res.ok,
      summary: String(res.output?.["summary"] ?? res.error ?? "Executed"),
    });
    if (!res.ok) errors.push(res.error || `Skill "${skId}" failed in sandbox.`);
  }

  return {
    ok: errors.length === 0,
    sandboxPassed: errors.length === 0,
    specId: spec.id,
    outputs,
    warnings: validation.warnings,
    errors,
  };
}

/**
 * Registers a validated custom agent ONLY when explicit approval is granted (`approved: true`).
 */
export function approveAndRegisterCustomAgent(
  spec: CustomAgentSpec,
  opts: { approved: boolean; approvedBy?: string | undefined },
): { ok: boolean; agent?: CustomAgentSpec; error?: string } {
  if (!opts.approved) {
    return {
      ok: false,
      error: "Approval required: Custom agents cannot register without explicit user approval (approved: true).",
    };
  }
  const validation = validateCustomAgentContract(spec);
  if (!validation.valid) {
    return { ok: false, error: `Invalid custom agent contract: ${validation.errors.join("; ")}` };
  }

  const prev = registeredCustomAgents.get(spec.id);
  const stored: CustomAgentSpec = {
    ...spec,
    approvedByUser: true,
    approvedBy: opts.approvedBy ?? "user",
    approvedAt: new Date().toISOString(),
    previousVersion: prev?.version,
    status: "approved",
  };
  registeredCustomAgents.set(stored.id, stored);
  return { ok: true, agent: stored };
}

export function listRegisteredCustomAgents(): CustomAgentSpec[] {
  return Array.from(registeredCustomAgents.values()).map((a) => ({ ...a }));
}

export function getRegisteredCustomAgent(id: string): CustomAgentSpec | null {
  return registeredCustomAgents.get(id) ?? null;
}

export async function executeCustomAgent(
  agentId: string,
  subtask: Subtask,
  env: AgentRuntimeEnv,
): Promise<AgentExecutionResult> {
  const spec = registeredCustomAgents.get(agentId);
  if (!spec || !spec.approvedByUser || spec.status !== "approved") {
    return {
      ok: false,
      agentId: "planning",
      summary: `Custom agent "${agentId}" is not approved or registered.`,
      provenance: "unknown",
      verified: false,
      verificationDetail: "Approval or registration missing.",
      requiresApproval: true,
      error: "Custom agent requires explicit user approval before execution.",
    };
  }

  if (levelRank(env.permissionLevel) < levelRank(spec.minPermission)) {
    return {
      ok: false,
      agentId: "planning",
      summary: `Permission level "${env.permissionLevel}" insufficient for custom agent "${spec.name}".`,
      provenance: "unknown",
      verified: false,
      verificationDetail: `Requires ${spec.minPermission}.`,
      requiresApproval: true,
      error: `Requires ${spec.minPermission} permission.`,
    };
  }

  const skillId = spec.skillIds[0] || "order_returns_audit";
  const rows = env.spreadsheetData ?? (subtask.input?.["rows"] as Array<Record<string, unknown>> | undefined) ?? [];
  const res = await executeDeclarativeSkill(
    skillId,
    { rows, previousRows: env.comparisonData ?? undefined },
    {
      permissionLevel: env.permissionLevel,
      consentGranted: env.consentGranted,
    },
  );

  return {
    ok: res.ok,
    agentId: (spec.id as unknown as CanonicalAgentId),
    summary: String(res.output?.["summary"] ?? res.error ?? `Executed custom agent ${spec.name}`),
    provenance: res.provenance,
    verified: res.ok,
    verificationDetail: `Executed declarative skill "${skillId}" v${res.version} under ${spec.name} v${spec.version}.`,
    requiresApproval: res.requiresApproval,
    data: { customAgentId: spec.id, skillId, result: res.output },
    error: res.error,
  };
}
