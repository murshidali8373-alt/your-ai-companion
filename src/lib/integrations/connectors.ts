/**
 * MODULAR CONNECTED APPS ARCHITECTURE (Phase 4)
 *
 * Truthful health checks, OAuth/credential verification, confirmation gates
 * before write/send actions, audit logging, and reconnect guidance.
 *
 * Supported connectors:
 * - Gmail (Google Workspace OAuth or user Bearer token)
 * - Google Drive (Google Workspace OAuth or user Bearer token)
 * - Google Sheets (Google Workspace OAuth or user Bearer token)
 * - Google Calendar (Google Workspace OAuth or user Bearer token)
 * - Slack (SLACK_BOT_TOKEN or user Bearer token)
 * - Microsoft Excel / OneDrive (MICROSOFT_GRAPH_TOKEN or user Bearer token)
 * - GitHub (GITHUB_TOKEN or user Bearer token)
 * - Meesho Supplier Portal Bridge (active browser extension session)
 */

import { recordConnectorAudit, readConnectorAuditLog } from "./service-registry";

export type ConnectorId =
  | "gmail"
  | "google_drive"
  | "google_sheets"
  | "google_calendar"
  | "slack"
  | "microsoft_excel"
  | "github"
  | "meesho_supplier";

export type ConnectorConnectionStatus =
  | "connected"
  | "requires_oauth"
  | "missing_credentials"
  | "expired_or_invalid"
  | "browser_session_only";

export interface ConnectorHealthResult {
  id: ConnectorId;
  name: string;
  category:
    | "email"
    | "cloud_storage"
    | "spreadsheet"
    | "calendar"
    | "messaging"
    | "developer"
    | "browser_bridge";
  operational: boolean;
  status: ConnectorConnectionStatus;
  requiredScopes: string[];
  missingRequirements: string[];
  supportsLiveHealthTest: boolean;
  requiresApprovalForWrites: boolean;
  documentationNotice: string;
  reconnectUrl?: string | undefined;
  lastCheckedAt: string;
}

export interface ConnectorDefinition {
  id: ConnectorId;
  name: string;
  category: ConnectorHealthResult["category"];
  description: string;
  requiredScopes: string[];
  envTokenKeys: string[];
  healthEndpoint?: string | undefined;
  requiresApprovalForWrites: boolean;
  documentationNotice: string;
}

export const MODULAR_CONNECTORS: Record<ConnectorId, ConnectorDefinition> = {
  gmail: {
    id: "gmail",
    name: "Gmail Workspace Connector",
    category: "email",
    description:
      "Read threads, summarize updates, draft replies, and send only after user approval.",
    requiredScopes: [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.compose",
    ],
    envTokenKeys: ["GOOGLE_GMAIL_ACCESS_TOKEN"],
    healthEndpoint: "https://gmail.googleapis.com/gmail/v1/users/me/profile",
    requiresApprovalForWrites: true,
    documentationNotice: "Requires Google Workspace OAuth authorization from the user.",
  },
  google_drive: {
    id: "google_drive",
    name: "Google Drive",
    category: "cloud_storage",
    description: "Search files and upload verified reports or spreadsheets to user Drive folders.",
    requiredScopes: ["https://www.googleapis.com/auth/drive.file"],
    envTokenKeys: ["GOOGLE_DRIVE_ACCESS_TOKEN"],
    healthEndpoint: "https://www.googleapis.com/drive/v3/about?fields=user",
    requiresApprovalForWrites: true,
    documentationNotice: "Requires Google Drive OAuth authorization before remote reads/writes.",
  },
  google_sheets: {
    id: "google_sheets",
    name: "Google Sheets",
    category: "spreadsheet",
    description: "Read ranges, reconcile SKU rows, and update approved cells in cloud sheets.",
    requiredScopes: ["https://www.googleapis.com/auth/spreadsheets"],
    envTokenKeys: ["GOOGLE_SHEETS_ACCESS_TOKEN"],
    healthEndpoint: "https://www.googleapis.com/oauth2/v3/userinfo",
    requiresApprovalForWrites: true,
    documentationNotice: "Requires Google Sheets OAuth authorization.",
  },
  google_calendar: {
    id: "google_calendar",
    name: "Google Calendar",
    category: "calendar",
    description: "Inspect upcoming schedule and create follow-up events with confirmation.",
    requiredScopes: ["https://www.googleapis.com/auth/calendar.events"],
    envTokenKeys: ["GOOGLE_CALENDAR_ACCESS_TOKEN"],
    healthEndpoint: "https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=1",
    requiresApprovalForWrites: true,
    documentationNotice: "Requires Google Calendar OAuth authorization.",
  },
  slack: {
    id: "slack",
    name: "Slack",
    category: "messaging",
    description: "Read channel updates, extract action items, and post drafts after approval.",
    requiredScopes: ["channels:read", "chat:write"],
    envTokenKeys: ["SLACK_BOT_TOKEN"],
    healthEndpoint: "https://slack.com/api/auth.test",
    requiresApprovalForWrites: true,
    documentationNotice: "Requires SLACK_BOT_TOKEN or user Slack OAuth Bearer token.",
  },
  microsoft_excel: {
    id: "microsoft_excel",
    name: "Microsoft Excel / OneDrive",
    category: "spreadsheet",
    description: "Sync cloud Excel workbooks via Microsoft Graph API with explicit user consent.",
    requiredScopes: ["Files.ReadWrite"],
    envTokenKeys: ["MICROSOFT_GRAPH_TOKEN"],
    healthEndpoint: "https://graph.microsoft.com/v1.0/me",
    requiresApprovalForWrites: true,
    documentationNotice:
      "Local .xlsx editing works immediately via File Workspace; cloud Graph requires Microsoft OAuth.",
  },
  github: {
    id: "github",
    name: "GitHub",
    category: "developer",
    description: "Inspect repositories, issues, and PR status with truthful rate/scope checks.",
    requiredScopes: ["repo", "read:user"],
    envTokenKeys: ["GITHUB_TOKEN"],
    healthEndpoint: "https://api.github.com/user",
    requiresApprovalForWrites: true,
    documentationNotice: "Requires GITHUB_TOKEN on server or a user-supplied OAuth token.",
  },
  meesho_supplier: {
    id: "meesho_supplier",
    name: "Meesho Supplier Portal Bridge",
    category: "browser_bridge",
    description:
      "Operates via active authenticated Chrome tab snapshot and browser agent controls.",
    requiredScopes: [],
    envTokenKeys: [],
    requiresApprovalForWrites: true,
    documentationNotice: "Operating via active browser extension tab session.",
  },
};

function resolveRuntimeToken(def: ConnectorDefinition, userToken?: string | null): string | null {
  const direct = userToken?.trim();
  if (direct && !direct.startsWith("MY_")) return direct;
  for (const key of def.envTokenKeys) {
    const val = process.env[key]?.trim();
    if (val && !val.startsWith("MY_") && !val.includes("your-")) return val;
  }
  return null;
}

export function getModularConnectorHealthSnapshot(
  connectorId: ConnectorId,
  userToken?: string | null,
): ConnectorHealthResult {
  const def = MODULAR_CONNECTORS[connectorId];
  const now = new Date().toISOString();

  if (connectorId === "meesho_supplier") {
    return {
      id: def.id,
      name: def.name,
      category: def.category,
      operational: true,
      status: "browser_session_only",
      requiredScopes: [],
      missingRequirements: [],
      supportsLiveHealthTest: false,
      requiresApprovalForWrites: def.requiresApprovalForWrites,
      documentationNotice: def.documentationNotice,
      lastCheckedAt: now,
    };
  }

  const token = resolveRuntimeToken(def, userToken);
  if (!token) {
    const isGoogle = def.id.startsWith("google_") || def.id === "gmail";
    return {
      id: def.id,
      name: def.name,
      category: def.category,
      operational: false,
      status: isGoogle ? "requires_oauth" : "missing_credentials",
      requiredScopes: def.requiredScopes,
      missingRequirements: [
        isGoogle
          ? `Google Workspace OAuth authorization missing for ${def.name}`
          : `${def.envTokenKeys.join(" or ")} not configured`,
      ],
      supportsLiveHealthTest: Boolean(def.healthEndpoint),
      requiresApprovalForWrites: def.requiresApprovalForWrites,
      documentationNotice: def.documentationNotice,
      reconnectUrl: "/connect",
      lastCheckedAt: now,
    };
  }

  return {
    id: def.id,
    name: def.name,
    category: def.category,
    operational: true,
    status: "connected",
    requiredScopes: def.requiredScopes,
    missingRequirements: [],
    supportsLiveHealthTest: Boolean(def.healthEndpoint),
    requiresApprovalForWrites: def.requiresApprovalForWrites,
    documentationNotice: `${def.name} credential detected. Run health test to verify live API reachability.`,
    lastCheckedAt: now,
  };
}

export async function testModularConnectorConnection(params: {
  connectorId: ConnectorId;
  userId?: string | undefined;
  userToken?: string | null | undefined;
}): Promise<
  ConnectorHealthResult & { httpStatus?: number; accountLabel?: string; liveChecked: boolean }
> {
  const snapshot = getModularConnectorHealthSnapshot(params.connectorId, params.userToken);
  const def = MODULAR_CONNECTORS[params.connectorId];

  if (params.connectorId === "meesho_supplier") {
    await recordConnectorAudit(params.userId || "guest", {
      connectorId: params.connectorId,
      action: "health_check",
      status: "ok",
      detail: "Browser session bridge active when seller tab is open.",
    });
    return { ...snapshot, liveChecked: false };
  }

  const token = resolveRuntimeToken(def, params.userToken);
  if (!token || !def.healthEndpoint) {
    await recordConnectorAudit(params.userId || "guest", {
      connectorId: params.connectorId,
      action: "health_check",
      status: "blocked",
      detail: snapshot.missingRequirements[0] || "Missing credentials/OAuth token.",
    });
    return { ...snapshot, operational: false, liveChecked: false };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(def.healthEndpoint, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": "ai-buddy-connector-check",
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    clearTimeout(timer);

    let ok = res.ok;
    let accountLabel: string | undefined;
    if (res.ok) {
      const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (params.connectorId === "slack" && json && json["ok"] === false) {
        ok = false;
      } else if (json) {
        accountLabel =
          (typeof json["emailAddress"] === "string" && json["emailAddress"]) ||
          (typeof json["email"] === "string" && json["email"]) ||
          (typeof json["login"] === "string" && json["login"]) ||
          (typeof json["user"] === "string" && json["user"]) ||
          undefined;
      }
    }

    const updated: ConnectorHealthResult & {
      httpStatus?: number;
      accountLabel?: string;
      liveChecked: boolean;
    } = {
      ...snapshot,
      operational: ok,
      status: ok ? "connected" : "expired_or_invalid",
      missingRequirements: ok
        ? []
        : [`Live probe returned HTTP ${res.status}. Reconnect or refresh OAuth scopes.`],
      httpStatus: res.status,
      accountLabel,
      liveChecked: true,
      lastCheckedAt: new Date().toISOString(),
    };

    await recordConnectorAudit(params.userId || "guest", {
      connectorId: params.connectorId,
      action: "health_check",
      status: ok ? "ok" : "error",
      detail: ok
        ? `Live probe succeeded (${accountLabel || "authorized"}).`
        : `Live probe failed (HTTP ${res.status}).`,
    });

    return updated;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Network error";
    await recordConnectorAudit(params.userId || "guest", {
      connectorId: params.connectorId,
      action: "health_check",
      status: "error",
      detail: `Health check network failure: ${msg}`,
    });
    return {
      ...snapshot,
      operational: false,
      status: "expired_or_invalid",
      missingRequirements: [`Live connection error: ${msg}`],
      liveChecked: true,
      lastCheckedAt: new Date().toISOString(),
    };
  }
}

export async function executeConnectorWriteWithGate(params: {
  userId?: string | undefined;
  connectorId: ConnectorId;
  action: string;
  targetSummary: string;
  confirmedByUser: boolean;
  userToken?: string | null | undefined;
  executor?: (() => Promise<{ ok: boolean; detail: string }>) | undefined;
}): Promise<{
  ok: boolean;
  requiresConfirmation?: boolean;
  reason?: string;
  detail: string;
}> {
  const userId = params.userId || "guest";
  if (!params.confirmedByUser) {
    await recordConnectorAudit(userId, {
      connectorId: params.connectorId,
      action: params.action,
      status: "awaiting_confirmation",
      detail: `Blocked pending user approval: ${params.targetSummary}`,
    });
    return {
      ok: false,
      requiresConfirmation: true,
      reason:
        "Explicit user approval is required before sending messages or writing external data.",
      detail: `Confirmation required to ${params.action} (${params.targetSummary}).`,
    };
  }

  const health = getModularConnectorHealthSnapshot(params.connectorId, params.userToken);
  if (!health.operational) {
    await recordConnectorAudit(userId, {
      connectorId: params.connectorId,
      action: params.action,
      status: "blocked",
      detail: health.missingRequirements[0] || "Connector is not operational.",
    });
    return {
      ok: false,
      reason: health.missingRequirements[0] || `${health.name} is not connected.`,
      detail: `Cannot execute ${params.action}: ${health.missingRequirements[0] || "Reconnect required."}`,
    };
  }

  if (!params.executor) {
    await recordConnectorAudit(userId, {
      connectorId: params.connectorId,
      action: params.action,
      status: "ok",
      detail: `Approved action verified ready (${params.targetSummary}).`,
    });
    return {
      ok: true,
      detail: `Approved & logged ${params.action} for ${params.connectorId}: ${params.targetSummary}`,
    };
  }

  const outcome = await params.executor();
  await recordConnectorAudit(userId, {
    connectorId: params.connectorId,
    action: params.action,
    status: outcome.ok ? "ok" : "error",
    detail: outcome.detail,
  });
  return outcome;
}

export async function listConnectorAuditTrail(userId?: string) {
  return readConnectorAuditLog(userId || "guest");
}
