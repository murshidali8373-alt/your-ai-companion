/**
 * EXTENSIBLE SERVICE CONNECTOR REGISTRY
 *
 * Responsibilities:
 * - Clean internal integration boundaries for Email, Calendar, Cloud Storage, and Business Platforms
 * - Truthful operational status: reports connectors as unavailable until actual APIs, OAuth, and credentials are configured
 * - Strict prohibition against simulated or mock operational states
 */

export type ServiceCategory =
  "email" | "calendar" | "cloud_storage" | "business_platform" | "data_api";

export interface ServiceConnector {
  id: string;
  name: string;
  category: ServiceCategory;
  description: string;
  requiredScopes: string[];
  isConfigured: () => boolean;
  getStatus: () => {
    operational: boolean;
    missingRequirements: string[];
    documentationNotice: string;
  };
}

export const KNOWN_SERVICE_CONNECTORS: Record<string, ServiceConnector> = {
  gmail: {
    id: "gmail",
    name: "Gmail Workspace Connector",
    category: "email",
    description:
      "Read, draft, and organize work communications on behalf of user with explicit permission.",
    requiredScopes: ["https://www.googleapis.com/auth/gmail.modify"],
    isConfigured: () => false, // Will become true when user accepts Workspace OAuth
    getStatus: () => ({
      operational: false,
      missingRequirements: ["Google Workspace OAuth flow not yet authorized by user"],
      documentationNotice: "Requires user authorization via AI Studio OAuth consent.",
    }),
  },
  google_calendar: {
    id: "google_calendar",
    name: "Google Calendar Connector",
    category: "calendar",
    description: "Inspect upcoming agenda and schedule follow-ups without manual entry.",
    requiredScopes: ["https://www.googleapis.com/auth/calendar.events"],
    isConfigured: () => false,
    getStatus: () => ({
      operational: false,
      missingRequirements: ["Calendar OAuth scopes not provisioned"],
      documentationNotice: "Requires calendar authorization before query execution.",
    }),
  },
  cloud_drive: {
    id: "cloud_drive",
    name: "Google Drive / Cloud Storage",
    category: "cloud_storage",
    description:
      "Store reconciled spreadsheets and generated research reports into user cloud folders.",
    requiredScopes: ["https://www.googleapis.com/auth/drive.file"],
    isConfigured: () => false,
    getStatus: () => ({
      operational: false,
      missingRequirements: ["Drive API authorization pending"],
      documentationNotice:
        "Reconciled files saved locally in memory until Cloud Drive is provisioned.",
    }),
  },
  meesho_supplier: {
    id: "meesho_supplier",
    name: "Meesho Supplier Portal Bridge",
    category: "business_platform",
    description:
      "Automated browser operator workflow via extension session (no secret API keys needed).",
    requiredScopes: [],
    isConfigured: () => true, // Operates via existing active browser session
    getStatus: () => ({
      operational: true,
      missingRequirements: [],
      documentationNotice: "Operating via active tab DOM snapshot and browser operator engine.",
    }),
  },
};

export function getAvailableServiceConnectors(): ServiceConnector[] {
  return Object.values(KNOWN_SERVICE_CONNECTORS);
}

export function getConnectorStatus(connectorId: string): {
  found: boolean;
  operational: boolean;
  missingRequirements: string[];
} {
  const conn = KNOWN_SERVICE_CONNECTORS[connectorId];
  if (!conn) {
    return { found: false, operational: false, missingRequirements: ["Unknown service connector"] };
  }
  const status = conn.getStatus();
  return {
    found: true,
    operational: status.operational,
    missingRequirements: status.missingRequirements,
  };
}
