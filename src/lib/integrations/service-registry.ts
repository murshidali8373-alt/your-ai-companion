/**
 * EXTENSIBLE SERVICE CONNECTOR REGISTRY (AI Buddy 2.0 — Phase 4)
 *
 * Modular Connected Apps Architecture:
 * - Gmail, Google Drive, Google Sheets, Google Calendar
 * - Slack
 * - Microsoft Excel, Microsoft OneDrive
 * - GitHub
 * - Meesho Supplier Portal Bridge
 *
 * Truthful status reporting:
 * - Never fakes operational state when OAuth / server credentials are missing.
 * - Explicitly documents least-privilege scopes, auth mechanisms, and capabilities.
 */

export type ServiceCategory =
  | "email"
  | "calendar"
  | "cloud_storage"
  | "spreadsheet"
  | "messaging"
  | "developer_platform"
  | "business_platform"
  | "data_api";

export interface ConnectorCapabilitySpec {
  id: string;
  description: string;
  consequential: boolean;
}

export interface ServiceConnector {
  id: string;
  name: string;
  category: ServiceCategory;
  description: string;
  authType: "oauth2" | "token" | "browser_bridge";
  requiredScopes: string[];
  capabilities: ConnectorCapabilitySpec[];
  envTokenKeys?: string[];
  isConfigured: () => boolean;
  getStatus: () => {
    operational: boolean;
    authState: "connected" | "not_authorized" | "expired" | "browser_session";
    missingRequirements: string[];
    documentationNotice: string;
  };
}

function hasServerEnvToken(keys: string[]): boolean {
  if (typeof process === "undefined" || !process.env) return false;
  return keys.some((k) => {
    const val = process.env[k]?.trim();
    return Boolean(val && !val.startsWith("MY_") && !val.includes("your-key"));
  });
}

export const KNOWN_SERVICE_CONNECTORS: Record<string, ServiceConnector> = {
  gmail: {
    id: "gmail",
    name: "Gmail",
    category: "email",
    description:
      "Read, summarize, and draft work communications with explicit approval before external send.",
    authType: "oauth2",
    requiredScopes: [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.compose",
    ],
    capabilities: [
      {
        id: "list_messages",
        description: "List & summarize recent inbox threads",
        consequential: false,
      },
      { id: "create_draft", description: "Create a draft reply safely", consequential: false },
      {
        id: "send_message",
        description: "Send email externally (approval required)",
        consequential: true,
      },
    ],
    isConfigured: () => false,
    getStatus: () => ({
      operational: false,
      authState: "not_authorized",
      missingRequirements: ["Google Workspace OAuth flow not yet authorized by user"],
      documentationNotice: "Requires user OAuth authorization via Workspace OAuth consent.",
    }),
  },
  google_drive: {
    id: "google_drive",
    name: "Google Drive",
    category: "cloud_storage",
    description: "Search, inspect metadata, and save generated reports into user Drive folders.",
    authType: "oauth2",
    requiredScopes: ["https://www.googleapis.com/auth/drive.file"],
    capabilities: [
      { id: "list_files", description: "List authorized workspace files", consequential: false },
      { id: "upload_report", description: "Upload generated report", consequential: true },
    ],
    isConfigured: () => false,
    getStatus: () => ({
      operational: false,
      authState: "not_authorized",
      missingRequirements: ["Google Drive OAuth authorization pending"],
      documentationNotice:
        "Reconciled files are held in confined Workspace store until Drive is authorized.",
    }),
  },
  // Backward-compatible alias key used in Phase 3 tests
  cloud_drive: {
    id: "cloud_drive",
    name: "Google Drive / Cloud Storage",
    category: "cloud_storage",
    description: "Store reconciled spreadsheets and generated research reports into cloud folders.",
    authType: "oauth2",
    requiredScopes: ["https://www.googleapis.com/auth/drive.file"],
    capabilities: [
      { id: "list_files", description: "List authorized Drive files", consequential: false },
      { id: "upload_report", description: "Save artifact to Drive", consequential: true },
    ],
    isConfigured: () => false,
    getStatus: () => ({
      operational: false,
      authState: "not_authorized",
      missingRequirements: ["Drive API authorization pending"],
      documentationNotice:
        "Reconciled files saved in confined Workspace store until Cloud Drive is authorized.",
    }),
  },
  google_sheets: {
    id: "google_sheets",
    name: "Google Sheets",
    category: "spreadsheet",
    description: "Read tabular ranges and append verified audit rows into Google Sheets.",
    authType: "oauth2",
    requiredScopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    capabilities: [
      { id: "read_range", description: "Read spreadsheet values", consequential: false },
      { id: "append_rows", description: "Append rows (approval required)", consequential: true },
    ],
    isConfigured: () => false,
    getStatus: () => ({
      operational: false,
      authState: "not_authorized",
      missingRequirements: ["Google Sheets OAuth authorization pending"],
      documentationNotice:
        "Upload .xlsx/.csv into File Workspace or authorize Google Sheets OAuth.",
    }),
  },
  google_calendar: {
    id: "google_calendar",
    name: "Google Calendar",
    category: "calendar",
    description: "Inspect upcoming schedule and prepare follow-up event drafts.",
    authType: "oauth2",
    requiredScopes: ["https://www.googleapis.com/auth/calendar.events"],
    capabilities: [
      { id: "list_events", description: "List upcoming events", consequential: false },
      {
        id: "create_event",
        description: "Create calendar event (approval required)",
        consequential: true,
      },
    ],
    isConfigured: () => false,
    getStatus: () => ({
      operational: false,
      authState: "not_authorized",
      missingRequirements: ["Calendar OAuth scopes not provisioned"],
      documentationNotice: "Requires Calendar OAuth authorization before query execution.",
    }),
  },
  slack: {
    id: "slack",
    name: "Slack",
    category: "messaging",
    description: "Read channel updates, summarize threads, and post approved status notifications.",
    authType: "oauth2",
    requiredScopes: ["channels:read", "chat:write"],
    envTokenKeys: ["SLACK_BOT_TOKEN"],
    capabilities: [
      { id: "list_channels", description: "List accessible Slack channels", consequential: false },
      {
        id: "post_message",
        description: "Post Slack message (approval required)",
        consequential: true,
      },
    ],
    isConfigured: () => hasServerEnvToken(["SLACK_BOT_TOKEN"]),
    getStatus: () => {
      const ok = hasServerEnvToken(["SLACK_BOT_TOKEN"]);
      return ok
        ? {
            operational: true,
            authState: "connected",
            missingRequirements: [],
            documentationNotice: "Connected via server-side SLACK_BOT_TOKEN.",
          }
        : {
            operational: false,
            authState: "not_authorized",
            missingRequirements: ["SLACK_BOT_TOKEN not configured and Slack OAuth not connected"],
            documentationNotice:
              "Configure SLACK_BOT_TOKEN in server environment or connect Slack OAuth.",
          };
    },
  },
  microsoft_excel: {
    id: "microsoft_excel",
    name: "Microsoft Excel (Microsoft 365)",
    category: "spreadsheet",
    description: "Read and update Excel workbooks stored in Microsoft 365 via Microsoft Graph.",
    authType: "oauth2",
    requiredScopes: ["Files.ReadWrite"],
    capabilities: [
      {
        id: "read_workbook",
        description: "Read Microsoft 365 Excel workbook",
        consequential: false,
      },
      {
        id: "update_range",
        description: "Update workbook cells (approval required)",
        consequential: true,
      },
    ],
    isConfigured: () => false,
    getStatus: () => ({
      operational: false,
      authState: "not_authorized",
      missingRequirements: ["Microsoft Graph OAuth (Files.ReadWrite) not authorized"],
      documentationNotice:
        "Local .xlsx workbooks work directly via File Workspace; cloud sync needs Microsoft OAuth.",
    }),
  },
  microsoft_onedrive: {
    id: "microsoft_onedrive",
    name: "Microsoft OneDrive",
    category: "cloud_storage",
    description: "Access and export files stored in OneDrive via Microsoft Graph.",
    authType: "oauth2",
    requiredScopes: ["Files.ReadWrite"],
    capabilities: [
      { id: "list_drive_items", description: "List OneDrive items", consequential: false },
      { id: "upload_drive_item", description: "Upload file to OneDrive", consequential: true },
    ],
    isConfigured: () => false,
    getStatus: () => ({
      operational: false,
      authState: "not_authorized",
      missingRequirements: ["Microsoft OneDrive OAuth not authorized"],
      documentationNotice: "Connect Microsoft Graph OAuth to browse or export to OneDrive.",
    }),
  },
  github: {
    id: "github",
    name: "GitHub",
    category: "developer_platform",
    description:
      "Inspect repositories, commits, and files, and open isolated fix PRs with explicit approval.",
    authType: "token",
    requiredScopes: ["repo"],
    envTokenKeys: ["GITHUB_TOKEN"],
    capabilities: [
      {
        id: "inspect_repo",
        description: "Inspect repository metadata & default branch",
        consequential: false,
      },
      { id: "list_commits", description: "List recent commits", consequential: false },
      { id: "read_file", description: "Read repository file contents", consequential: false },
      {
        id: "create_pr",
        description: "Open isolated PR (explicit approval required)",
        consequential: true,
      },
    ],
    isConfigured: () => hasServerEnvToken(["GITHUB_TOKEN"]),
    getStatus: () => {
      const ok = hasServerEnvToken(["GITHUB_BOT_TOKEN", "GITHUB_TOKEN"]);
      return ok
        ? {
            operational: true,
            authState: "connected",
            missingRequirements: [],
            documentationNotice: "Connected via server-side GITHUB_TOKEN.",
          }
        : {
            operational: false,
            authState: "not_authorized",
            missingRequirements: ["GITHUB_TOKEN not configured on server"],
            documentationNotice:
              "Set GITHUB_TOKEN in server environment to inspect repos and open PRs.",
          };
    },
  },
  meesho_supplier: {
    id: "meesho_supplier",
    name: "Meesho Supplier Portal Bridge",
    category: "business_platform",
    description:
      "Automated browser operator workflow via extension session (no secret API keys needed).",
    authType: "browser_bridge",
    requiredScopes: [],
    capabilities: [
      {
        id: "extract_orders",
        description: "Extract visible order tables from active Meesho tab",
        consequential: false,
      },
    ],
    isConfigured: () => true,
    getStatus: () => ({
      operational: true,
      authState: "browser_session",
      missingRequirements: [],
      documentationNotice: "Operating via active tab DOM snapshot and browser operator engine.",
    }),
  },
};

export function getAvailableServiceConnectors(): ServiceConnector[] {
  // Deduplicate cloud_drive alias in primary UI listings while preserving direct lookup
  return Object.values(KNOWN_SERVICE_CONNECTORS).filter((c) => c.id !== "cloud_drive");
}

export function getConnectorStatus(connectorId: string): {
  found: boolean;
  operational: boolean;
  authState?: string;
  missingRequirements: string[];
  requiredScopes?: string[];
  documentationNotice?: string;
} {
  const conn = KNOWN_SERVICE_CONNECTORS[connectorId];
  if (!conn) {
    return { found: false, operational: false, missingRequirements: ["Unknown service connector"] };
  }
  const status = conn.getStatus();
  return {
    found: true,
    operational: status.operational,
    authState: status.authState,
    missingRequirements: status.missingRequirements,
    requiredScopes: conn.requiredScopes,
    documentationNotice: status.documentationNotice,
  };
}
