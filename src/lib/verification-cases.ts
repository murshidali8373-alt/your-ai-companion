export type TestResultStatus = "pending" | "pass" | "fail";

export interface VerificationChecklistStep {
  id: string;
  label: string;
}

export interface VerificationTestCase {
  id: string;
  number: string;
  title: string;
  category: string;
  summary: string;
  commands: string[];
  expectedResult: string;
  steps: VerificationChecklistStep[];
}

export interface VerificationEntry {
  result: TestResultStatus;
  checks: Record<string, boolean>;
  notes: string;
  updatedAt: string | null;
}

export interface VerificationStore {
  version: number;
  environment: string;
  entries: Record<string, VerificationEntry>;
}

export const VERIFICATION_STORAGE_KEY = "ai_buddy_desktop_chrome_verification_v1";

export const CHROME_VERIFICATION_CASES: VerificationTestCase[] = [
  {
    id: "test-1-chat",
    number: "01",
    title: "General AI Chat & Provider Switching",
    category: "Conversation",
    summary:
      "Verify general knowledge prompts answer directly without page-summary override and reflect the selected AI model/provider.",
    commands: [
      "What is Apple?",
      "Explain GST.",
      "Write a professional email.",
      "Switch model/provider in Side Panel and repeat: Explain GST in 2 lines.",
    ],
    expectedResult:
      "Direct conversational replies appear without hijacking into active-tab explanation; changing the model routes to the selected provider or displays a clear provider error.",
    steps: [
      {
        id: "t1-direct-qa",
        label: "General questions answer directly instead of explaining the open webpage",
      },
      {
        id: "t1-model-switch",
        label: "Switching selected model/provider invokes that provider cleanly",
      },
      {
        id: "t1-multilingual",
        label: "English, Hindi, and Hinglish context stays coherent across turns",
      },
    ],
  },
  {
    id: "test-2-click",
    number: "02",
    title: "Real Element Finding, Clicking & Recovery",
    category: "DOM Actions",
    summary:
      "Verify finding highlights the real element without clicking, clicking triggers verified navigation, and failed clicks offer recovery.",
    commands: [
      "Orders tab kahan hai?",
      "Orders tab par click karo",
      "Doosre method se try karo (if a click fails or misses)",
    ],
    expectedResult:
      "Find highlights and points at the Orders tab without clicking; click opens the target section and verifies DOM/URL transition.",
    steps: [
      {
        id: "t2-find-no-click",
        label: "Find/highlight targets the exact Orders tab without triggering a click",
      },
      {
        id: "t2-click-verify",
        label: "Click opens the Orders view and confirms actual page/section change",
      },
      {
        id: "t2-failed-recovery",
        label: "Unresponsive or blocked click reports honestly and supports alternate retry",
      },
    ],
  },
  {
    id: "test-3-form",
    number: "03",
    title: "Real Multi-Turn Form Filling & Corrections",
    category: "Forms",
    summary:
      "Verify step-by-step non-sensitive form entry, dropdown selection, mid-flow value correction, and read-back verification.",
    commands: [
      "Ye form fill kar do",
      "First name mein Murshad",
      "Last name mein Ali",
      "Phone number 9560798373",
      "Country dropdown mein India select karo",
      "Nahi, Murshad ki jagah Murshid likho",
    ],
    expectedResult:
      "Each field receives the exact intended value on the live page, passes read-back verification, updates cleanly on correction, and never auto-submits.",
    steps: [
      {
        id: "t3-text-fields",
        label: "First name, last name, and phone number fill into the exact matching inputs",
      },
      {
        id: "t3-dropdown",
        label: "Dropdown selection updates the target select control cleanly",
      },
      {
        id: "t3-correction-safe",
        label: "Correction updates only the intended field and never auto-submits the form",
      },
    ],
  },
  {
    id: "test-4-downloads",
    number: "04",
    title: "Real File Downloads (PDF, CSV & Page Buttons)",
    category: "Downloads",
    summary:
      "Verify direct PDF/CSV downloads and webpage button-triggered exports register in Chrome Downloads and open cleanly.",
    commands: [
      "Is PDF ko download karo: <direct-pdf-url>",
      "CSV download karo: <direct-csv-url>",
      "Download report button par click karo",
    ],
    expectedResult:
      "Files appear in Chrome Downloads (chrome://downloads), complete without corruption, and open in Desktop Chrome.",
    steps: [
      {
        id: "t4-pdf",
        label: "PDF download completes and opens from Chrome Downloads",
      },
      {
        id: "t4-csv",
        label: "CSV download completes and opens with intact tabular data",
      },
      {
        id: "t4-button-trigger",
        label: "Webpage button-triggered export is detected and verified in Chrome Downloads",
      },
    ],
  },
  {
    id: "test-5-navigation",
    number: "05",
    title: "Official Portal & Website Navigation",
    category: "Navigation",
    summary:
      "Verify natural-language commands open Aadhaar, GST Portal, Meesho Supplier Panel, Flipkart Seller Hub, and Google Sheets.",
    commands: [
      "Aadhaar website kholo",
      "GST portal kholo",
      "Open Meesho Supplier Panel",
      "Open Flipkart Seller Hub",
      "Open Google Sheets",
    ],
    expectedResult:
      "Active tab navigates to each official URL (uidai.gov.in, gst.gov.in, supplier.meesho.com, seller.flipkart.com, docs.google.com/spreadsheets) and confirms load completion.",
    steps: [
      {
        id: "t5-gov-portals",
        label: "Aadhaar (uidai.gov.in) and GST Portal (www.gst.gov.in) open cleanly",
      },
      {
        id: "t5-seller-panels",
        label: "Meesho Supplier Panel and Flipkart Seller Hub open cleanly",
      },
      {
        id: "t5-google-sheets",
        label: "Google Sheets (docs.google.com/spreadsheets) opens and reports completion",
      },
    ],
  },
  {
    id: "test-6-workflow",
    number: "06",
    title: "Multi-Step Workflow & Approval Gate",
    category: "Orchestration",
    summary:
      "Verify end-to-end multi-step execution across navigate, find, fill, and verify while pausing before consequential submission.",
    commands: [
      "Open <safe test form site>, find <section>, fill Name Aman and Phone 9560798373, verify, and pause before submit",
    ],
    expectedResult:
      "Intermediate steps complete in sequence with verified DOM values, and Buddy pauses for explicit approval before any final submit or irreversible action.",
    steps: [
      {
        id: "t6-sequence",
        label: "Multi-step plan executes navigate, find, and fill steps in correct order",
      },
      {
        id: "t6-verify-state",
        label: "Each step verifies page state before advancing to the next step",
      },
      {
        id: "t6-approval-gate",
        label: "Execution pauses cleanly before final submit awaiting user approval",
      },
    ],
  },
];

export function createDefaultEntry(testCase: VerificationTestCase): VerificationEntry {
  const checks: Record<string, boolean> = {};
  for (const step of testCase.steps) {
    checks[step.id] = false;
  }
  return {
    result: "pending",
    checks,
    notes: "",
    updatedAt: null,
  };
}

export function createDefaultVerificationStore(): VerificationStore {
  const entries: Record<string, VerificationEntry> = {};
  for (const tc of CHROME_VERIFICATION_CASES) {
    entries[tc.id] = createDefaultEntry(tc);
  }
  return {
    version: 1,
    environment: "",
    entries,
  };
}

export function normalizeVerificationStore(raw: unknown): VerificationStore {
  const fallback = createDefaultVerificationStore();
  if (!raw || typeof raw !== "object") return fallback;

  const parsed = raw as Partial<VerificationStore>;
  const entries: Record<string, VerificationEntry> = {};

  for (const tc of CHROME_VERIFICATION_CASES) {
    const base = createDefaultEntry(tc);
    const incoming = parsed.entries?.[tc.id];
    if (incoming && typeof incoming === "object") {
      const result: TestResultStatus =
        incoming.result === "pass" || incoming.result === "fail" ? incoming.result : "pending";
      const checks: Record<string, boolean> = { ...base.checks };
      if (incoming.checks && typeof incoming.checks === "object") {
        for (const step of tc.steps) {
          checks[step.id] = Boolean(incoming.checks[step.id]);
        }
      }
      entries[tc.id] = {
        result,
        checks,
        notes: typeof incoming.notes === "string" ? incoming.notes : "",
        updatedAt: typeof incoming.updatedAt === "string" ? incoming.updatedAt : null,
      };
    } else {
      entries[tc.id] = base;
    }
  }

  return {
    version: 1,
    environment: typeof parsed.environment === "string" ? parsed.environment : "",
    entries,
  };
}

export function loadVerificationStore(): VerificationStore {
  if (typeof window === "undefined") return createDefaultVerificationStore();
  try {
    const raw = window.localStorage.getItem(VERIFICATION_STORAGE_KEY);
    if (!raw) return createDefaultVerificationStore();
    return normalizeVerificationStore(JSON.parse(raw));
  } catch {
    return createDefaultVerificationStore();
  }
}

export function saveVerificationStore(store: VerificationStore): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(VERIFICATION_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Storage quota or restricted mode; keep in-memory state working.
  }
}

export interface VerificationSummary {
  totalCases: number;
  passed: number;
  failed: number;
  pending: number;
  completedSteps: number;
  totalSteps: number;
}

export function summarizeVerificationStore(store: VerificationStore): VerificationSummary {
  let passed = 0;
  let failed = 0;
  let pending = 0;
  let completedSteps = 0;
  let totalSteps = 0;

  for (const tc of CHROME_VERIFICATION_CASES) {
    const entry = store.entries[tc.id] ?? createDefaultEntry(tc);
    if (entry.result === "pass") passed += 1;
    else if (entry.result === "fail") failed += 1;
    else pending += 1;

    for (const step of tc.steps) {
      totalSteps += 1;
      if (entry.checks[step.id]) {
        completedSteps += 1;
      }
    }
  }

  return {
    totalCases: CHROME_VERIFICATION_CASES.length,
    passed,
    failed,
    pending,
    completedSteps,
    totalSteps,
  };
}

export function buildVerificationMarkdownReport(store: VerificationStore): string {
  const summary = summarizeVerificationStore(store);
  const lines: string[] = [
    "# AI Buddy — Desktop Chrome Verification Report",
    "",
    `Environment: ${store.environment.trim() || "Desktop Chrome (unspecified build)"}`,
    `Summary: ${summary.passed} Passed · ${summary.failed} Failed · ${summary.pending} Pending · ${summary.completedSteps}/${summary.totalSteps} Checklist Steps`,
    "",
  ];

  for (const tc of CHROME_VERIFICATION_CASES) {
    const entry = store.entries[tc.id] ?? createDefaultEntry(tc);
    const checkedCount = tc.steps.filter((s) => entry.checks[s.id]).length;
    lines.push(`## ${tc.number}. ${tc.title}`);
    lines.push(`- Result: ${entry.result.toUpperCase()}`);
    lines.push(`- Checklist: ${checkedCount}/${tc.steps.length} verified`);
    for (const step of tc.steps) {
      lines.push(`  - [${entry.checks[step.id] ? "x" : " "}] ${step.label}`);
    }
    lines.push(`- Notes / Bugs Observed: ${entry.notes.trim() || "None recorded"}`);
    if (entry.updatedAt) {
      lines.push(`- Last Updated: ${entry.updatedAt}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
