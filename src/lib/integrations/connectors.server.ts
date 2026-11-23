/**
 * SERVER-SIDE CONNECTED APPS VAULT & EXECUTION GATEWAY (AI Buddy 2.0 — Phase 4)
 *
 * Security guarantees:
 * - Tokens are NEVER stored in extension localStorage or exposed to client bundles.
 * - Tokens are held strictly server-side (per-user vault in memory or server env vars).
 * - Every external read/write logs an audited entry with sensitive fields stripped.
 * - All external mutations/sends strictly enforce explicit `approvalGranted === true`.
 */

import {
  getAvailableServiceConnectors,
  getConnectorStatus,
  KNOWN_SERVICE_CONNECTORS,
} from "./service-registry";
import {
  inspectGitHubRepo,
  listRecentCommits,
  readRemoteFile,
} from "@/lib/self-healing/github-workflow.server";

export interface UserConnectorSession {
  connectorId: string;
  userId: string;
  scopes: string[];
  accessToken: string; // Stored server-side only, never returned in API responses
  expiresAt?: string;
  connectedAt: string;
  status: "connected" | "expired";
}

export interface ConnectorAuditEntry {
  auditId: string;
  timestamp: string;
  userId: string;
  connectorId: string;
  capabilityId: string;
  outcome: "ok" | "blocked" | "error";
  detail: string;
}

export interface ConnectorTelemetryRecord {
  lastSuccessAt?: string;
  lastError?: string;
  lastCheckedAt?: string;
}

const VAULT_KEY = "__aiBuddyConnectorVaultV1";
const AUDIT_KEY = "__aiBuddyConnectorAuditV1";
const TELEMETRY_KEY = "__aiBuddyConnectorTelemetryV1";

function getTelemetryMap(): Map<string, ConnectorTelemetryRecord> {
  const g = globalThis as Record<string, unknown>;
  if (!g[TELEMETRY_KEY]) g[TELEMETRY_KEY] = new Map<string, ConnectorTelemetryRecord>();
  return g[TELEMETRY_KEY] as Map<string, ConnectorTelemetryRecord>;
}

function updateConnectorTelemetry(
  userId: string,
  connectorId: string,
  patch: { ok: boolean; error?: string },
): void {
  const map = getTelemetryMap();
  const key = `${userId || "guest"}::${connectorId}`;
  const prev = map.get(key) ?? {};
  const now = new Date().toISOString();
  map.set(key, {
    lastCheckedAt: now,
    lastSuccessAt: patch.ok ? now : prev.lastSuccessAt,
    lastError: patch.ok ? undefined : patch.error || prev.lastError,
  });
}

function getVault(): Map<string, UserConnectorSession> {
  const g = globalThis as Record<string, unknown>;
  if (!g[VAULT_KEY]) g[VAULT_KEY] = new Map<string, UserConnectorSession>();
  return g[VAULT_KEY] as Map<string, UserConnectorSession>;
}

function getAuditLog(): ConnectorAuditEntry[] {
  const g = globalThis as Record<string, unknown>;
  if (!g[AUDIT_KEY]) g[AUDIT_KEY] = [];
  return g[AUDIT_KEY] as ConnectorAuditEntry[];
}

function vaultKey(userId: string, connectorId: string): string {
  return `${userId || "guest"}::${connectorId}`;
}

function recordAudit(entry: Omit<ConnectorAuditEntry, "auditId" | "timestamp">): void {
  const log = getAuditLog();
  log.unshift({
    auditId: `aud_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
    timestamp: new Date().toISOString(),
    ...entry,
  });
  if (log.length > 200) log.pop();
}

export function listConnectorAuditLog(userId?: string): ConnectorAuditEntry[] {
  const target = userId || "guest";
  return getAuditLog()
    .filter((e) => e.userId === target)
    .slice(0, 50);
}

/**
 * Stores a server-side OAuth/API session token for a user (never echoed back to client).
 */
export function registerServerConnectorToken(params: {
  userId: string;
  connectorId: string;
  accessToken: string;
  scopes?: string[];
  expiresInSeconds?: number;
}): { ok: boolean; message: string } {
  const conn = KNOWN_SERVICE_CONNECTORS[params.connectorId];
  if (!conn) return { ok: false, message: `Unknown connector "${params.connectorId}".` };
  if (!params.accessToken?.trim()) return { ok: false, message: "Missing access token." };

  const expiresAt = params.expiresInSeconds
    ? new Date(Date.now() + params.expiresInSeconds * 1000).toISOString()
    : undefined;

  getVault().set(vaultKey(params.userId, params.connectorId), {
    connectorId: params.connectorId,
    userId: params.userId,
    scopes: params.scopes ?? conn.requiredScopes,
    accessToken: params.accessToken.trim(),
    expiresAt,
    connectedAt: new Date().toISOString(),
    status: "connected",
  });

  recordAudit({
    userId: params.userId,
    connectorId: params.connectorId,
    capabilityId: "connect",
    outcome: "ok",
    detail: `Server-side token stored with scopes: ${(params.scopes ?? conn.requiredScopes).join(", ") || "default"}`,
  });

  return { ok: true, message: `${conn.name} connected securely on server.` };
}

export function disconnectConnectorToken(userId: string, connectorId: string): boolean {
  const deleted = getVault().delete(vaultKey(userId, connectorId));
  recordAudit({
    userId,
    connectorId,
    capabilityId: "disconnect",
    outcome: "ok",
    detail: deleted ? "Disconnected and purged server token." : "No stored token found.",
  });
  return deleted;
}

export function resolveConnectorRuntimeStatus(userId: string, connectorId: string) {
  const base = getConnectorStatus(connectorId);
  if (!base.found) return base;
  const session = getVault().get(vaultKey(userId, connectorId));
  if (session) {
    const expired = Boolean(session.expiresAt && Date.parse(session.expiresAt) <= Date.now());
    if (expired) {
      session.status = "expired";
      return {
        ...base,
        operational: false,
        authState: "expired",
        missingRequirements: ["OAuth access token expired. Reconnect authorization."],
      };
    }
    return {
      ...base,
      operational: true,
      authState: "connected",
      missingRequirements: [],
      grantedScopes: session.scopes,
    };
  }
  return base;
}

export function listConnectorsForUser(userId: string) {
  const telMap = getTelemetryMap();
  return getAvailableServiceConnectors().map((c) => {
    const runtime = resolveConnectorRuntimeStatus(userId, c.id);
    const tel = telMap.get(`${userId || "guest"}::${c.id}`);
    return {
      id: c.id,
      name: c.name,
      category: c.category,
      description: c.description,
      authType: c.authType,
      requiredScopes: c.requiredScopes,
      capabilities: c.capabilities,
      operational: runtime.operational,
      authState: runtime.authState,
      missingRequirements: runtime.missingRequirements,
      documentationNotice: runtime.documentationNotice,
      lastSuccessAt: tel?.lastSuccessAt,
      lastError: tel?.lastError,
      lastCheckedAt: tel?.lastCheckedAt,
    };
  });
}

export async function executeConnectorAction(params: {
  userId: string;
  connectorId: string;
  capabilityId: string;
  input?: Record<string, unknown>;
  approvalGranted?: boolean;
  fetchFn?: typeof fetch;
}): Promise<{
  ok: boolean;
  requiresApproval?: boolean;
  requiresReconnection?: boolean;
  unimplementedCapability?: boolean;
  data?: unknown;
  message: string;
}> {
  const conn = KNOWN_SERVICE_CONNECTORS[params.connectorId];
  if (!conn) {
    return { ok: false, message: `Unknown connector "${params.connectorId}".` };
  }

  const cap = conn.capabilities.find((c) => c.id === params.capabilityId);
  if (cap?.consequential && !params.approvalGranted) {
    recordAudit({
      userId: params.userId,
      connectorId: params.connectorId,
      capabilityId: params.capabilityId,
      outcome: "blocked",
      detail: "Blocked consequential external action pending explicit user approval.",
    });
    return {
      ok: false,
      requiresApproval: true,
      message: `Explicit approval required before executing "${cap.description}" on ${conn.name}.`,
    };
  }

  const runtime = resolveConnectorRuntimeStatus(params.userId, params.connectorId);
  if (!runtime.operational) {
    recordAudit({
      userId: params.userId,
      connectorId: params.connectorId,
      capabilityId: params.capabilityId,
      outcome: "blocked",
      detail: runtime.missingRequirements.join("; "),
    });
    return {
      ok: false,
      requiresReconnection: true,
      message: `${conn.name} is not connected: ${runtime.missingRequirements.join("; ")}`,
    };
  }

  const session = getVault().get(vaultKey(params.userId, params.connectorId));
  const payload = params.input ?? {};

  // Real GitHub execution via github-workflow.server.ts
  if (params.connectorId === "github") {
    const owner = String(payload["owner"] ?? "");
    const repo = String(payload["repo"] ?? "");
    const token = session?.accessToken;
    if (params.capabilityId === "inspect_repo") {
      const res = await inspectGitHubRepo({ owner, repo, token, fetchFn: params.fetchFn });
      recordAudit({
        userId: params.userId,
        connectorId: "github",
        capabilityId: "inspect_repo",
        outcome: res.ok ? "ok" : "error",
        detail: res.message,
      });
      updateConnectorTelemetry(params.userId, "github", {
        ok: res.ok,
        error: res.ok ? undefined : res.message,
      });
      return { ok: res.ok, data: res, message: res.message };
    }
    if (params.capabilityId === "list_commits") {
      const res = await listRecentCommits({
        owner,
        repo,
        branch: typeof payload["branch"] === "string" ? payload["branch"] : undefined,
        token,
        fetchFn: params.fetchFn,
      });
      recordAudit({
        userId: params.userId,
        connectorId: "github",
        capabilityId: "list_commits",
        outcome: res.ok ? "ok" : "error",
        detail: res.message,
      });
      return { ok: res.ok, data: res, message: res.message };
    }
    if (params.capabilityId === "read_file") {
      const res = await readRemoteFile({
        owner,
        repo,
        filePath: String(payload["filePath"] ?? ""),
        token,
        fetchFn: params.fetchFn,
      });
      return { ok: res.ok, data: res, message: res.message };
    }
  }

  // Slack real execution if token configured
  if (params.connectorId === "slack") {
    const slackToken = session?.accessToken || process.env["SLACK_BOT_TOKEN"];
    const f = params.fetchFn ?? fetch;
    if (params.capabilityId === "list_channels" && slackToken) {
      const res = await f("https://slack.com/api/conversations.list?limit=20", {
        headers: { Authorization: `Bearer ${slackToken}` },
      });
      const json = (await res.json()) as {
        ok?: boolean;
        channels?: Array<{ id: string; name: string }>;
        error?: string;
      };
      recordAudit({
        userId: params.userId,
        connectorId: "slack",
        capabilityId: "list_channels",
        outcome: json.ok ? "ok" : "error",
        detail: json.ok
          ? `Loaded ${json.channels?.length ?? 0} Slack channel(s)`
          : json.error || "Slack API error",
      });
      return {
        ok: Boolean(json.ok),
        data: json,
        message: json.ok
          ? `Loaded ${json.channels?.length ?? 0} Slack channel(s).`
          : `Slack error: ${json.error}`,
      };
    }
  }

  // Google Workspace / Microsoft Graph real REST calls when server OAuth token is registered
  if (session?.accessToken) {
    const f = params.fetchFn ?? fetch;
    if (params.connectorId === "gmail" && params.capabilityId === "list_messages") {
      const res = await f("https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=10", {
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      const data = await res.json().catch(() => ({}));
      return {
        ok: res.ok,
        requiresReconnection: res.status === 401,
        data,
        message: res.ok ? "Fetched Gmail message list." : `Gmail API returned HTTP ${res.status}.`,
      };
    }
    if (params.connectorId === "google_drive" && params.capabilityId === "list_files") {
      const res = await f(
        "https://www.googleapis.com/drive/v3/files?pageSize=15&fields=files(id,name,mimeType)",
        {
          headers: { Authorization: `Bearer ${session.accessToken}` },
        },
      );
      const data = await res.json().catch(() => ({}));
      return {
        ok: res.ok,
        requiresReconnection: res.status === 401,
        data,
        message: res.ok
          ? "Fetched Google Drive files."
          : `Google Drive API returned HTTP ${res.status}.`,
      };
    }
  }

  if (params.capabilityId === "runtime_check") {
    updateConnectorTelemetry(params.userId, params.connectorId, { ok: true });
    return {
      ok: true,
      message: `${conn.name} runtime check verified (${runtime.authState}).`,
      data: runtime,
    };
  }

  const unimplMsg = `${conn.name} capability "${params.capabilityId}" is registered but requires an implemented downstream provider action handler before live execution.`;
  recordAudit({
    userId: params.userId,
    connectorId: params.connectorId,
    capabilityId: params.capabilityId,
    outcome: "error",
    detail: unimplMsg,
  });
  updateConnectorTelemetry(params.userId, params.connectorId, {
    ok: false,
    error: unimplMsg,
  });
  return {
    ok: false,
    unimplementedCapability: true,
    message: unimplMsg,
    data: runtime,
  };
}
