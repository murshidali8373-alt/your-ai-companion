/**
 * SHARED WORKSPACE COLLABORATION & RBAC ENGINE (Phase 8)
 *
 * Manages team workspaces with role-based access control ("owner" | "editor" | "viewer"),
 * mandatory approval gates for shared consequential actions, and member-attributed audit trails.
 */

export type WorkspaceRole = "owner" | "editor" | "viewer";

export type WorkspaceActionKind =
  | "read_data"
  | "run_analysis"
  | "edit_draft"
  | "share_report"
  | "execute_shared_workflow"
  | "manage_members"
  | "delete_artifact";

export interface WorkspaceMember {
  userId: string;
  role: WorkspaceRole;
  addedAt: string;
  addedBy: string;
}

export interface WorkspaceAuditEntry {
  id: string;
  workspaceId: string;
  actorUserId: string;
  actorRole: WorkspaceRole | "non_member";
  action: WorkspaceActionKind;
  allowed: boolean;
  detail: string;
  timestamp: string;
}

export interface SharedActionApproval {
  approvalId: string;
  workspaceId: string;
  action: WorkspaceActionKind;
  requestedBy: string;
  summary: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  decidedBy?: string | undefined;
  decidedAt?: string | undefined;
}

export interface SharedWorkspace {
  id: string;
  name: string;
  ownerId: string;
  createdAt: string;
  members: WorkspaceMember[];
  auditLog: WorkspaceAuditEntry[];
  approvals: SharedActionApproval[];
}

const ROLE_PERMISSIONS: Record<WorkspaceRole, Set<WorkspaceActionKind>> = {
  viewer: new Set(["read_data"]),
  editor: new Set([
    "read_data",
    "run_analysis",
    "edit_draft",
    "share_report",
    "execute_shared_workflow",
  ]),
  owner: new Set([
    "read_data",
    "run_analysis",
    "edit_draft",
    "share_report",
    "execute_shared_workflow",
    "manage_members",
    "delete_artifact",
  ]),
};

const APPROVAL_REQUIRED_ACTIONS = new Set<WorkspaceActionKind>([
  "share_report",
  "execute_shared_workflow",
  "delete_artifact",
]);

const workspaceStore = new Map<string, SharedWorkspace>();

export function resetWorkspaceCollaborationForTests(): void {
  workspaceStore.clear();
}

export function createSharedWorkspace(params: {
  name: string;
  ownerId: string;
  workspaceId?: string | undefined;
}): SharedWorkspace {
  const id =
    params.workspaceId || `ws_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const now = new Date().toISOString();
  const ws: SharedWorkspace = {
    id,
    name: params.name.trim() || "Untitled Workspace",
    ownerId: params.ownerId,
    createdAt: now,
    members: [{ userId: params.ownerId, role: "owner", addedAt: now, addedBy: params.ownerId }],
    auditLog: [
      {
        id: `aud_${Date.now().toString(36)}_init`,
        workspaceId: id,
        actorUserId: params.ownerId,
        actorRole: "owner",
        action: "manage_members",
        allowed: true,
        detail: `Workspace "${params.name.trim() || "Untitled Workspace"}" created.`,
        timestamp: now,
      },
    ],
    approvals: [],
  };
  workspaceStore.set(id, ws);
  return ws;
}

export function getSharedWorkspace(workspaceId: string): SharedWorkspace | null {
  return workspaceStore.get(workspaceId) ?? null;
}

export function addWorkspaceMember(params: {
  workspaceId: string;
  actorUserId: string;
  targetUserId: string;
  role: WorkspaceRole;
}): { ok: boolean; error?: string; workspace?: SharedWorkspace } {
  const ws = workspaceStore.get(params.workspaceId);
  if (!ws) return { ok: false, error: "Workspace not found." };
  const actor = ws.members.find((m) => m.userId === params.actorUserId);
  if (!actor || !ROLE_PERMISSIONS[actor.role].has("manage_members")) {
    recordWorkspaceAuditEvent(
      ws.id,
      params.actorUserId,
      "manage_members",
      false,
      `Denied member add for ${params.targetUserId}`,
    );
    return { ok: false, error: "Only workspace owners can manage members." };
  }
  const existing = ws.members.find((m) => m.userId === params.targetUserId);
  if (existing) {
    existing.role = params.role;
  } else {
    ws.members.push({
      userId: params.targetUserId,
      role: params.role,
      addedAt: new Date().toISOString(),
      addedBy: params.actorUserId,
    });
  }
  recordWorkspaceAuditEvent(
    ws.id,
    params.actorUserId,
    "manage_members",
    true,
    `Assigned role "${params.role}" to ${params.targetUserId}.`,
  );
  return { ok: true, workspace: ws };
}

export function canPerformWorkspaceAction(params: {
  workspaceId: string;
  userId: string;
  action: WorkspaceActionKind;
  approvalId?: string | undefined;
}): {
  allowed: boolean;
  requiresApproval: boolean;
  role: WorkspaceRole | "non_member";
  reason: string;
} {
  const ws = workspaceStore.get(params.workspaceId);
  if (!ws) {
    return {
      allowed: false,
      requiresApproval: false,
      role: "non_member",
      reason: "Workspace not found.",
    };
  }
  const member = ws.members.find((m) => m.userId === params.userId);
  if (!member) {
    recordWorkspaceAuditEvent(
      ws.id,
      params.userId,
      params.action,
      false,
      "Blocked non-member access.",
    );
    return {
      allowed: false,
      requiresApproval: false,
      role: "non_member",
      reason: "User is not a member of this workspace.",
    };
  }
  if (!ROLE_PERMISSIONS[member.role].has(params.action)) {
    recordWorkspaceAuditEvent(
      ws.id,
      params.userId,
      params.action,
      false,
      `Role "${member.role}" lacks permission for "${params.action}".`,
    );
    return {
      allowed: false,
      requiresApproval: false,
      role: member.role,
      reason: `Role "${member.role}" does not permit "${params.action}".`,
    };
  }
  if (APPROVAL_REQUIRED_ACTIONS.has(params.action)) {
    const approval = params.approvalId
      ? ws.approvals.find((a) => a.approvalId === params.approvalId && a.action === params.action)
      : undefined;
    if (!approval || approval.status !== "approved") {
      recordWorkspaceAuditEvent(
        ws.id,
        params.userId,
        params.action,
        false,
        `Action "${params.action}" blocked pending shared approval.`,
      );
      return {
        allowed: false,
        requiresApproval: true,
        role: member.role,
        reason: `Shared action "${params.action}" requires explicit approval before execution.`,
      };
    }
  }
  recordWorkspaceAuditEvent(
    ws.id,
    params.userId,
    params.action,
    true,
    `Authorized "${params.action}".`,
  );
  return { allowed: true, requiresApproval: false, role: member.role, reason: "Authorized." };
}

export function requestSharedActionApproval(params: {
  workspaceId: string;
  requestedBy: string;
  action: WorkspaceActionKind;
  summary: string;
}): { ok: boolean; approval?: SharedActionApproval; error?: string } {
  const ws = workspaceStore.get(params.workspaceId);
  if (!ws) return { ok: false, error: "Workspace not found." };
  const member = ws.members.find((m) => m.userId === params.requestedBy);
  if (!member || !ROLE_PERMISSIONS[member.role].has(params.action)) {
    return { ok: false, error: "Requester lacks permission to propose this action." };
  }
  const approval: SharedActionApproval = {
    approvalId: `appr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    workspaceId: ws.id,
    action: params.action,
    requestedBy: params.requestedBy,
    summary: params.summary.slice(0, 200),
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  ws.approvals.push(approval);
  return { ok: true, approval };
}

export function approveSharedAction(params: {
  workspaceId: string;
  approvalId: string;
  approverUserId: string;
  decision: "approved" | "rejected";
}): { ok: boolean; approval?: SharedActionApproval; error?: string } {
  const ws = workspaceStore.get(params.workspaceId);
  if (!ws) return { ok: false, error: "Workspace not found." };
  const approver = ws.members.find((m) => m.userId === params.approverUserId);
  if (!approver || (approver.role !== "owner" && approver.role !== "editor")) {
    return { ok: false, error: "Only owners or editors can decide shared action approvals." };
  }
  const approval = ws.approvals.find((a) => a.approvalId === params.approvalId);
  if (!approval) return { ok: false, error: "Approval request not found." };
  approval.status = params.decision;
  approval.decidedBy = params.approverUserId;
  approval.decidedAt = new Date().toISOString();
  recordWorkspaceAuditEvent(
    ws.id,
    params.approverUserId,
    approval.action,
    params.decision === "approved",
    `Approval ${approval.approvalId} ${params.decision} by ${params.approverUserId}.`,
  );
  return { ok: true, approval };
}

export function recordWorkspaceAuditEvent(
  workspaceId: string,
  actorUserId: string,
  action: WorkspaceActionKind,
  allowed: boolean,
  detail: string,
): WorkspaceAuditEntry | null {
  const ws = workspaceStore.get(workspaceId);
  if (!ws) return null;
  const member = ws.members.find((m) => m.userId === actorUserId);
  const entry: WorkspaceAuditEntry = {
    id: `aud_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
    workspaceId,
    actorUserId,
    actorRole: member?.role ?? "non_member",
    action,
    allowed,
    detail,
    timestamp: new Date().toISOString(),
  };
  ws.auditLog.push(entry);
  if (ws.auditLog.length > 200) ws.auditLog.shift();
  return entry;
}

export function getWorkspaceAuditLog(workspaceId: string): WorkspaceAuditEntry[] {
  return [...(workspaceStore.get(workspaceId)?.auditLog ?? [])];
}
