/**
 * TYPED SPECIALIZED AGENT CONTRACTS (AI Buddy 2.0 — Phase 3)
 *
 * Defines formal input/output Zod schemas, lifecycle states, capabilities,
 * permission boundaries, and verification contracts for all 15 agents.
 */

import { z } from "zod";
import type { PageSnapshot } from "@/shared/page-snapshot";
import type { PermissionLevel } from "@/shared/permissions";
import type {
  CanonicalAgentId,
  DataProvenance,
  SpecialistAgentId,
  Subtask,
  TaskSessionContext,
} from "@/shared/task-context";
import type { MemoryRecord } from "@/lib/engines/memory-engine";
import type { ResearchSource } from "@/lib/engines/research-engine";
import type { WorkspaceDocument } from "@/lib/engines/file-workspace-engine";

export type AgentLifecycleState =
  "idle" | "observing" | "executing" | "verifying" | "completed" | "failed" | "awaiting_approval";

export const agentBaseInputSchema = z.object({
  instruction: z.string().min(1),
  subtaskTitle: z.string().optional(),
  capabilityId: z.string().optional(),
  payload: z.record(z.unknown()).optional(),
});

export const agentBaseOutputSchema = z.object({
  ok: z.boolean(),
  agentId: z.string(),
  summary: z.string(),
  provenance: z.enum(["extracted", "calculated", "estimated", "unknown"]).default("calculated"),
  verified: z.boolean().default(false),
  requiresApproval: z.boolean().default(false),
  approvalPrompt: z.string().optional(),
  data: z.record(z.unknown()).optional(),
  error: z.string().optional(),
});

export interface AgentRuntimeEnv {
  instruction: string;
  sessionContext: TaskSessionContext;
  permissionLevel: PermissionLevel;
  consentGranted: boolean;
  privacyMode?: boolean;
  snapshot?: PageSnapshot | null;
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
  buddySlug?: string | null;
}

export interface AgentExecutionResult {
  ok: boolean;
  agentId: CanonicalAgentId;
  summary: string;
  provenance: DataProvenance;
  verified: boolean;
  verificationDetail: string;
  requiresApproval?: boolean;
  approvalPrompt?: string;
  data?: Record<string, unknown>;
  recoverable?: boolean;
  error?: string;
}

export interface AgentDefinition {
  id: CanonicalAgentId;
  name: string;
  aliases: SpecialistAgentId[];
  responsibility: string;
  capabilityIds: string[];
  minPermission: PermissionLevel;
  inputSchema: z.ZodTypeAny;
  outputSchema: z.ZodTypeAny;
  execute: (subtask: Subtask, env: AgentRuntimeEnv) => Promise<AgentExecutionResult>;
}
