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

export type { DataProvenance } from "@/shared/task-context";

export const SPECIALIZED_AGENT_IDS = [
  "planning",
  "browser",
  "research",
  "data_intelligence",
  "spreadsheet",
  "document",
  "file_workspace",
  "form_filling",
  "navigation",
  "visual_intelligence",
  "workflow_automation",
  "verification",
  "memory",
  "communication",
  "self_healing",
] as const;

export type Phase3AgentId = (typeof SPECIALIZED_AGENT_IDS)[number];

export interface SpecializedAgentDefinition {
  id: Phase3AgentId;
  name: string;
  role: string;
  capabilities: string[];
  requiredPermission: PermissionLevel;
  supportsParallelExecution: boolean;
  requiresApprovalForSideEffects: boolean;
}

export interface AgentArtifact {
  id: string;
  kind: "xlsx" | "docx" | "pdf" | "csv" | "json" | "draft_message" | "report" | string;
  title: string;
  fileName?: string | undefined;
  downloadUrl?: string | undefined;
  summary?: string | undefined;
  verified?: boolean | undefined;
  content?: unknown | undefined;
}

export interface AgentVerificationCheck {
  checkName: string;
  passed: boolean;
  detail: string;
  provenance: DataProvenance;
}

export interface AgentCitation {
  title: string;
  url: string;
  domain: string;
  quote?: string | undefined;
}

export interface AgentSubtaskResult {
  ok: boolean;
  summary: string;
  provenance: DataProvenance;
  data?: unknown | undefined;
  artifacts?: AgentArtifact[] | undefined;
  verifications?: AgentVerificationCheck[] | undefined;
  citations?: AgentCitation[] | undefined;
  requiresApproval?:
    | boolean
    | {
        actionLabel: string;
        reason: string;
        preview?: string | undefined;
      }
    | undefined;
  error?: string | undefined;
}

export type AgentSubtaskStatus =
  | "pending"
  | "ready"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "skipped"
  | "cancelled"
  | "awaiting_approval";

export interface AgentSubtaskSpec {
  id: string;
  title: string;
  agentId: Phase3AgentId;
  capabilityId: string;
  dependencies: string[];
  priority: number;
  retryLimit: number;
  retryCount: number;
  status: AgentSubtaskStatus;
  fileOwnership?: string | null | undefined;
  tabOwnership?: number | string | null | undefined;
  requiresApproval?: boolean | undefined;
  approved?: boolean | undefined;
  output?: AgentSubtaskResult | undefined;
  error?: string | undefined;
  startedAt?: string | undefined;
  completedAt?: string | undefined;
  durationMs?: number | undefined;
}

export interface DagCheckpointSnapshot {
  checkpointId: string;
  runId: string;
  capturedAt: string;
  completedIds: string[];
  failedIds: string[];
  pendingIds: string[];
  awaitingApprovalIds: string[];
  partialOutputs: Record<string, unknown>;
}

export type AgentDagRunStatus =
  | "planned"
  | "running"
  | "paused"
  | "completed"
  | "partially_completed"
  | "failed"
  | "cancelled"
  | "awaiting_approval";

export interface AgentDagRunState {
  runId: string;
  userId: string;
  objective: string;
  status: AgentDagRunStatus;
  selectedAgents: Phase3AgentId[];
  subtasks: AgentSubtaskSpec[];
  checkpoints: DagCheckpointSnapshot[];
  artifacts: AgentArtifact[];
  verifications: AgentVerificationCheck[];
  replanCount: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | undefined;
  finalSummary?: string | undefined;
  unconfirmedStopNote?: string | undefined;
}

export const dagControlActionSchema = z.enum([
  "pause",
  "resume",
  "cancel",
  "retry_failed",
  "approve_step",
  "skip_step",
]);

export type DagControlAction = z.infer<typeof dagControlActionSchema>;

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
