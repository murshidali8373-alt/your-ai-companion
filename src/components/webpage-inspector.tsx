import React, { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Search,
  Globe,
  CheckCircle2,
  AlertTriangle,
  Play,
  Layers,
  ArrowRight,
  ShieldAlert,
  Volume2,
  Sparkles,
  MousePointer,
  FileText,
  RotateCw,
  Pause,
  SkipForward,
  Square,
  Copy,
  Check,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChatMarkdown } from "@/components/chat-markdown";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { askBuddy } from "@/lib/app.functions";
import { type PageSnapshot } from "@/shared/page-snapshot";
import {
  createTaskPlan,
  advanceTaskStage,
  executePlanStep,
  createMultiActionPlan,
  executeNextPlanStep,
  pauseMultiActionPlan,
  resumeMultiActionPlan,
  skipCurrentPlanStep,
  cancelMultiActionPlan,
  approveAndContinuePlan,
  type TaskExecutionPlan,
  type TaskLifecycleStage,
} from "@/shared/task-lifecycle";
import {
  type BrowserAction,
  type MultiActionTaskPlan,
  type MultiActionStep,
} from "@/shared/browser-action";
import { findCatalogModel } from "@/lib/ai/model-hub";

export type InspectorSourceKind =
  "live_webpage" | "captured_snapshot" | "sandbox_fixture" | "sample_data" | "unavailable";

export interface ExtractedInspectorItem extends Record<string, unknown> {
  orderId: string;
  status: string;
  details: string;
}

export const INSPECTOR_SOURCE_LABELS: Record<
  InspectorSourceKind,
  { badge: string; title: string; detail: string }
> = {
  live_webpage: {
    badge: "Live Webpage",
    title: "Connected to active browser tab",
    detail: "Actions execute against the live DOM with re-grounding and verification.",
  },
  captured_snapshot: {
    badge: "Captured Snapshot",
    title: "Inspecting imported PageSnapshot JSON (Read-Only Analysis)",
    detail:
      "AI page analysis uses the supplied DOM snapshot; interactive clicks run as sandbox dry-runs because no live browser tab is attached.",
  },
  sandbox_fixture: {
    badge: "Sandbox Dry-Run Fixture",
    title: "Sandbox Dry-Run Fixture (Offline)",
    detail:
      "Steps simulate sequentially against a static fixture without touching a live browser tab.",
  },
  sample_data: {
    badge: "Sample Data",
    title: "Sample Data Preview (No Live Browser Tab Connected)",
    detail:
      "This web inspector is previewing built-in sample data. Multi-step executions are simulated dry-runs; use the Chrome Extension side panel for live webpage actions.",
  },
  unavailable: {
    badge: "Unavailable",
    title: "Unavailable — Live Browser Tab Not Connected",
    detail:
      "The web dashboard cannot directly inspect or mutate open Chrome tabs. Select Sample Data or paste a Captured PageSnapshot JSON to analyze a snapshot.",
  },
};

export function deriveExtractedItemsFromSnapshot(
  snapshot: PageSnapshot | null | undefined,
): ExtractedInspectorItem[] {
  if (!snapshot || !snapshot.text) return [];
  const matches = snapshot.text.match(/\b[A-Z]{2,6}-\d{4,10}(?:-[A-Z]{2,4})?\b/g) || [];
  const unique = Array.from(new Set(matches));
  return unique.map((orderId) => ({
    orderId,
    status: /pending/i.test(snapshot.text) ? "pending (from snapshot)" : "detected",
    details: `Parsed from "${snapshot.title}"`,
  }));
}

export function parseCapturedSnapshotJson(rawJson: string): PageSnapshot {
  const parsed = JSON.parse(rawJson) as Partial<PageSnapshot>;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Snapshot JSON must be an object.");
  }
  const url = typeof parsed.url === "string" && parsed.url.trim() ? parsed.url.trim() : "";
  const title = typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim() : "";
  if (!url || !title) {
    throw new Error('Snapshot JSON requires non-empty "url" and "title" fields.');
  }
  let origin = typeof parsed.origin === "string" ? parsed.origin : "";
  if (!origin) {
    try {
      origin = new URL(url).origin;
    } catch {
      origin = url;
    }
  }
  return {
    url,
    origin,
    title,
    capturedAt:
      typeof parsed.capturedAt === "string" ? parsed.capturedAt : new Date().toISOString(),
    headings: Array.isArray(parsed.headings) ? parsed.headings : [],
    forms: Array.isArray(parsed.forms) ? parsed.forms : [],
    controls: Array.isArray(parsed.controls) ? parsed.controls : [],
    alerts: Array.isArray(parsed.alerts) ? parsed.alerts : [],
    text: typeof parsed.text === "string" ? parsed.text : "",
    truncated: Boolean(parsed.truncated),
  };
}

// Built-in sample pages for web dashboard preview (explicitly labeled as Sample Data / Sandbox Fixture)
const SAMPLE_PAGES: Record<string, PageSnapshot> = {
  meesho_supplier: {
    url: "https://supplier.meesho.com/panel/orders",
    origin: "https://supplier.meesho.com",
    title: "Meesho Supplier Panel — Orders Dashboard",
    capturedAt: "2026-01-01T00:00:00.000Z",
    headings: [
      {
        ref: "h1",
        role: "heading",
        name: "Orders Dashboard",
        tag: "h1",
        selector: "h1",
        level: 1,
      },
      {
        ref: "h2",
        role: "heading",
        name: "Today's Orders",
        tag: "h2",
        selector: "h2",
        level: 2,
      },
    ],
    forms: [
      {
        ref: "f1",
        role: "textbox",
        name: "Search Orders by ID or SKU",
        tag: "input",
        selector: "#searchOrders",
        placeholder: "Search order ID...",
      },
      {
        ref: "f2",
        role: "select",
        name: "Date Filter",
        tag: "select",
        selector: "#dateFilter",
        options: ["Today", "Yesterday", "Last 7 Days"],
      },
    ],
    controls: [
      {
        ref: "c1",
        role: "button",
        name: "All Orders (142)",
        tag: "button",
        selector: "#tabAll",
      },
      {
        ref: "c2",
        role: "button",
        name: "Pending Orders (8)",
        tag: "button",
        selector: "#tabPending",
      },
      {
        ref: "c3",
        role: "button",
        name: "Ready to Ship (34)",
        tag: "button",
        selector: "#tabReady",
      },
      {
        ref: "c4",
        role: "button",
        name: "Download Order Report (CSV)",
        tag: "button",
        selector: "#btnDownload",
      },
    ],
    alerts: [],
    text: "Meesho Supplier Panel: 8 pending orders awaiting packaging. Order IDs: MSH-982410-IN, MSH-982411-IN, MSH-982412-IN, MSH-982415-IN.",
    truncated: false,
  },
  flight_booking: {
    url: "https://travel-demo.com/flights/search",
    origin: "https://travel-demo.com",
    title: "Book Flight — New Delhi (DEL) to London (LHR)",
    capturedAt: "2026-01-01T00:00:00.000Z",
    headings: [
      {
        ref: "e1",
        role: "heading",
        name: "Select your outbound flight",
        tag: "h1",
        selector: "h1",
        level: 1,
      },
      {
        ref: "e2",
        role: "heading",
        name: "Passenger Details",
        tag: "h2",
        selector: "h2",
        level: 2,
      },
    ],
    forms: [
      {
        ref: "e3",
        role: "textbox",
        name: "Passenger Full Name",
        tag: "input",
        selector: "#passengerName",
        placeholder: "e.g. John Doe",
        required: true,
      },
      {
        ref: "e4",
        role: "textbox",
        name: "Passport Number",
        tag: "input",
        selector: "#passportNo",
        placeholder: "A12345678",
        required: true,
      },
      {
        ref: "e5",
        role: "textbox",
        name: "Password",
        tag: "input",
        selector: "#accountPass",
        sensitive: true,
      },
    ],
    controls: [
      {
        ref: "e6",
        role: "button",
        name: "Choose Economy Seat ($450)",
        tag: "button",
        selector: "#btnEconomy",
      },
      {
        ref: "e7",
        role: "button",
        name: "Choose Business Seat ($1,200)",
        tag: "button",
        selector: "#btnBusiness",
      },
      {
        ref: "e8",
        role: "button",
        name: "Confirm & Purchase Tickets",
        tag: "button",
        selector: "#btnPurchase",
      },
    ],
    alerts: [],
    text: "Flight AI-121 from DEL to LHR departing at 02:45 AM. 2 seats remaining at discount fare.",
    truncated: false,
  },
  account_settings: {
    url: "https://myaccount-demo.com/profile",
    origin: "https://myaccount-demo.com",
    title: "User Profile & Security Settings",
    capturedAt: "2026-01-01T00:00:00.000Z",
    headings: [
      {
        ref: "e1",
        role: "heading",
        name: "Account Information",
        tag: "h1",
        selector: "h1",
        level: 1,
      },
      { ref: "e2", role: "heading", name: "Danger Zone", tag: "h2", selector: "h2", level: 2 },
    ],
    forms: [
      {
        ref: "e3",
        role: "textbox",
        name: "Display Name",
        tag: "input",
        selector: "#displayName",
        value: "Murshid",
      },
      {
        ref: "e4",
        role: "textbox",
        name: "Bio",
        tag: "textarea",
        selector: "#bio",
        value: "Software Engineer",
      },
    ],
    controls: [
      { ref: "e5", role: "button", name: "Update Profile", tag: "button", selector: "#btnSave" },
      {
        ref: "e6",
        role: "button",
        name: "Permanently Delete Account",
        tag: "button",
        selector: "#btnDelete",
      },
    ],
    alerts: [],
    text: "Manage your display name, public bio, and account deletion options.",
    truncated: false,
  },
};

export function WebpageInspector({
  activeModelId,
  onHighlightElement,
}: {
  activeModelId?: string;
  onHighlightElement?: (selector: string | null) => void;
}) {
  const runAsk = useServerFn(askBuddy);
  const [selectedSampleKey, setSelectedSampleKey] = useState<string>("meesho_supplier");
  const [sourceKind, setSourceKind] = useState<InspectorSourceKind>("sample_data");
  const [currentSnapshot, setCurrentSnapshot] = useState<PageSnapshot>(
    SAMPLE_PAGES["meesho_supplier"]!,
  );
  const [snapshotJsonInput, setSnapshotJsonInput] = useState<string>("");
  const [snapshotJsonError, setSnapshotJsonError] = useState<string | null>(null);
  const [plan, setPlan] = useState<TaskExecutionPlan | null>(null);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [proposedNextStep, setProposedNextStep] = useState<string | null>(null);
  const [approvalModalAction, setApprovalModalAction] = useState<BrowserAction | null>(null);

  // Multi-Action Browser Operator State (Sandbox Dry-Run on web dashboard)
  const [multiTaskInstruction, setMultiTaskInstruction] = useState<string>(
    "Open Meesho Supplier Panel, go to Orders, open today's orders, find pending orders, copy their order IDs, and prepare a list of them",
  );
  const [multiActionPlan, setMultiActionPlan] = useState<MultiActionTaskPlan | null>(null);
  const [isExecutingMultiPlan, setIsExecutingMultiPlan] = useState<boolean>(false);
  const [pendingApprovalMultiStep, setPendingApprovalMultiStep] = useState<MultiActionStep | null>(
    null,
  );
  const [extractedItems, setExtractedItems] = useState<ExtractedInspectorItem[]>(() =>
    deriveExtractedItemsFromSnapshot(SAMPLE_PAGES["meesho_supplier"]),
  );

  const handleApplyCapturedSnapshot = () => {
    try {
      const parsed = parseCapturedSnapshotJson(snapshotJsonInput);
      setSnapshotJsonError(null);
      setCurrentSnapshot(parsed);
      setSourceKind("captured_snapshot");
      setExplanation(null);
      setPlan(null);
      setMultiActionPlan(null);
      setExtractedItems(deriveExtractedItemsFromSnapshot(parsed));
      toast.success(`Loaded captured snapshot: ${parsed.title}`);
    } catch (err) {
      setSnapshotJsonError(err instanceof Error ? err.message : "Invalid PageSnapshot JSON.");
    }
  };

  const handleGenerateMultiPlan = (instruction?: string) => {
    if (sourceKind === "unavailable") {
      toast.error("Unavailable: select a sample fixture or load a captured snapshot JSON first.");
      return;
    }
    const text = instruction || multiTaskInstruction;
    const p = createMultiActionPlan(text, currentSnapshot);
    setMultiActionPlan(p);
    setPendingApprovalMultiStep(null);
    if (sourceKind === "sample_data") {
      setSourceKind("sandbox_fixture");
    }
    toast.success(`Generated ${p.steps.length}-step sandbox dry-run plan.`);
  };

  const executeSingleStep = async (step: MultiActionStep) => {
    if (sourceKind === "unavailable") {
      return {
        success: false,
        result: "Unavailable: no live browser tab or snapshot connected.",
      };
    }
    if (step.selector) {
      onHighlightElement?.(step.selector);
    }
    await new Promise((r) => setTimeout(r, 350));

    if (step.action === "extract") {
      const parsed = deriveExtractedItemsFromSnapshot(currentSnapshot);
      setExtractedItems(parsed);
      return {
        success: true,
        result:
          parsed.length > 0
            ? `Sandbox dry-run parsed ${parsed.length} item(s) from snapshot text`
            : "Sandbox dry-run finished (no structured order IDs present in this snapshot)",
        extractedData: parsed,
      };
    }
    return {
      success: true,
      result: `Sandbox dry-run simulated "${step.title}" against fixture (not executed on a live tab).`,
    };
  };

  const handleRunNextStep = async () => {
    if (!multiActionPlan || sourceKind === "unavailable") return;
    const updated = await executeNextPlanStep(multiActionPlan, executeSingleStep);
    setMultiActionPlan(updated);
    if (updated.status === "awaiting_approval") {
      const step = updated.steps[updated.currentStepIndex];
      setPendingApprovalMultiStep(step || null);
      toast.warning(`Approval required: ${step?.title}`);
    } else if (updated.status === "completed") {
      toast.success("Sandbox dry-run completed.");
    }
  };

  const handleRunAllSteps = async () => {
    if (sourceKind === "unavailable") {
      toast.error("Unavailable: live browser tab is not connected.");
      return;
    }
    if (!multiActionPlan) {
      handleGenerateMultiPlan();
      return;
    }
    setIsExecutingMultiPlan(true);
    let curPlan = multiActionPlan;
    if (curPlan.status === "paused") {
      curPlan = resumeMultiActionPlan(curPlan);
      setMultiActionPlan(curPlan);
    }

    while (
      curPlan.currentStepIndex < curPlan.steps.length &&
      curPlan.status !== "failed" &&
      curPlan.status !== "paused" &&
      curPlan.status !== "cancelled"
    ) {
      const step = curPlan.steps[curPlan.currentStepIndex];
      if (step?.requiresApproval && step.status !== "awaiting_approval") {
        const waitingPlan = await executeNextPlanStep(curPlan, executeSingleStep);
        setMultiActionPlan(waitingPlan);
        setPendingApprovalMultiStep(step);
        setIsExecutingMultiPlan(false);
        return;
      }

      curPlan = await executeNextPlanStep(curPlan, executeSingleStep);
      setMultiActionPlan(curPlan);
      await new Promise((r) => setTimeout(r, 250));
    }
    setIsExecutingMultiPlan(false);
    if (curPlan.status === "completed") {
      toast.success("Sandbox dry-run completed (fixture only).");
    }
  };

  const handlePauseMultiPlan = () => {
    if (!multiActionPlan) return;
    setMultiActionPlan(pauseMultiActionPlan(multiActionPlan));
    setIsExecutingMultiPlan(false);
    toast.info("Sandbox plan paused.");
  };

  const handleSkipMultiPlanStep = () => {
    if (!multiActionPlan) return;
    setPendingApprovalMultiStep(null);
    const skipped = skipCurrentPlanStep(multiActionPlan);
    setMultiActionPlan(skipped);
    toast.info("Step skipped by user.");
  };

  const handleCancelMultiPlan = () => {
    if (!multiActionPlan) return;
    setPendingApprovalMultiStep(null);
    setIsExecutingMultiPlan(false);
    setMultiActionPlan(cancelMultiActionPlan(multiActionPlan));
    toast.error("Sandbox execution stopped.");
  };

  const handleApproveConsequentialStep = async () => {
    if (!multiActionPlan || !pendingApprovalMultiStep) return;
    setPendingApprovalMultiStep(null);
    const approved = approveAndContinuePlan(multiActionPlan);
    setMultiActionPlan(approved);
    toast.success("Consequential step approved for sandbox dry-run.");
    const nextPlan = await executeNextPlanStep(approved, executeSingleStep);
    setMultiActionPlan(nextPlan);
  };

  const handleCopyExtractedList = () => {
    const text = extractedItems
      .map((item, idx) => `${idx + 1}. ${item.orderId} — ${item.status} (${item.details})`)
      .join("\n");
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      toast.success("Parsed snapshot items copied to clipboard.");
    }
  };

  // Mutation to analyze page via AI
  const analyzeMutation = useMutation({
    mutationFn: async (intent: "explain_page" | "locate_element" | "plan") => {
      let userApiKey: string | undefined;
      let customBaseUrl: string | undefined;
      if (typeof window !== "undefined" && activeModelId) {
        const catalogEntry = findCatalogModel(activeModelId);
        const pId =
          catalogEntry?.provider ?? (activeModelId.startsWith("gemini") ? "gemini" : undefined);
        if (pId) {
          userApiKey = localStorage.getItem(`buddy_key_${pId}`) || undefined;
          customBaseUrl = localStorage.getItem(`buddy_url_${pId}`) || undefined;
        }
      }

      return await runAsk({
        data: {
          question:
            intent === "explain_page"
              ? "Explain this webpage in simple terms, highlight the most important form/button, and state what I should do next."
              : "Formulate a step-by-step browser action plan for this page.",
          intent,
          snapshot: currentSnapshot,
          preferredModel: activeModelId,
          userApiKey,
          customBaseUrl,
        },
      });
    },
    onSuccess: (res) => {
      setExplanation(res.answer);
      if (res.highlightSelector) {
        onHighlightElement?.(res.highlightSelector);
      }
      if (res.needs && res.needs.length > 0) {
        setProposedNextStep(res.needs);
      } else {
        setProposedNextStep("Review the highlighted section and proceed.");
      }

      // Initialize a 7-stage plan
      const newPlan = createTaskPlan(
        currentSnapshot.title,
        "Understand webpage and safely guide user",
        currentSnapshot,
      );
      const understoodPlan = advanceTaskStage(
        newPlan,
        "understanding",
        `Parsed ${currentSnapshot.headings.length} headings, ${currentSnapshot.forms.length} inputs, ${currentSnapshot.controls.length} buttons.`,
      );
      const firstNeed = Array.isArray(res.needs) ? res.needs[0] : res.needs;
      const planned = advanceTaskStage(
        understoodPlan,
        "planning",
        `Identified next step: ${firstNeed || "Select options and verify"}`,
      );
      setPlan(planned);
      toast.success("Webpage analyzed by AI Buddy.");
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to analyze page.");
    },
  });

  // Execute a browser action with safety checks
  const handleExecuteAction = async (action: BrowserAction) => {
    if (!plan) return;

    // Check if high-impact requires user approval
    const isConsequential =
      action.type === "click_submit" ||
      action.type === "click_delete" ||
      action.type === "purchase" ||
      action.type === "send_message";

    if (isConsequential) {
      setApprovalModalAction(action);
      setPlan((prev) =>
        prev
          ? advanceTaskStage(prev, "awaiting_approval", `Paused for user approval: ${action.type}`)
          : null,
      );
      return;
    }

    await runActionDirectly(action);
  };

  const runActionDirectly = async (action: BrowserAction) => {
    if (!plan || sourceKind === "unavailable") return;

    const updatedPlan = await executePlanStep(plan, action, async (act) => {
      // Dry-run sandbox inspection against fixture (live execution requires extension bridge)
      await new Promise((r) => setTimeout(r, 300));
      if (act.target.selector) {
        onHighlightElement?.(act.target.selector);
      }
      return true;
    });

    setPlan(updatedPlan);
    if (updatedPlan.currentStage === "completed") {
      toast.info(`Sandbox dry-run finished for "${action.type}" (fixture preview only).`);
    } else if (updatedPlan.currentStage === "failed") {
      toast.error(updatedPlan.error || "Sandbox dry-run step failed.");
    }
  };

  const handleConfirmApproval = async () => {
    if (!approvalModalAction || !plan) return;
    const action = approvalModalAction;
    setApprovalModalAction(null);
    await runActionDirectly(action);
  };

  // Text-to-speech for Buddy reply
  const speakReply = (text: string) => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.0;
      window.speechSynthesis.speak(u);
    }
  };

  const stages: TaskLifecycleStage[] = [
    "observing",
    "understanding",
    "planning",
    "awaiting_approval",
    "acting",
    "verifying",
    "completed",
  ];

  return (
    <div className="space-y-6">
      {/* Page Header & Source State Selector */}
      <div className="panel p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Globe className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold text-foreground">
                Webpage Context & Action Inspector
              </h2>
              <Badge
                variant={sourceKind === "unavailable" ? "destructive" : "outline"}
                className="text-[10px] font-mono"
              >
                {INSPECTOR_SOURCE_LABELS[sourceKind].badge}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Analyze DOM snapshots, preview action plans, and test confirmation guardrails without
              pretending to execute on live Chrome tabs.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-muted-foreground">Snapshot Source:</span>
            <select
              aria-label="Snapshot Source"
              value={selectedSampleKey}
              onChange={(e) => {
                const k = e.target.value;
                setSelectedSampleKey(k);
                setExplanation(null);
                setPlan(null);
                setMultiActionPlan(null);
                setPendingApprovalMultiStep(null);
                if (k === "unavailable") {
                  setSourceKind("unavailable");
                  setExtractedItems([]);
                  return;
                }
                if (k === "captured_json") {
                  setSourceKind("captured_snapshot");
                  return;
                }
                const nextSnap = SAMPLE_PAGES[k] ?? SAMPLE_PAGES["meesho_supplier"]!;
                setCurrentSnapshot(nextSnap);
                setSourceKind("sample_data");
                setExtractedItems(deriveExtractedItemsFromSnapshot(nextSnap));
                if (k === "meesho_supplier") {
                  setMultiTaskInstruction(
                    "Open Meesho Supplier Panel, go to Orders, open today's orders, find pending orders, copy their order IDs, and prepare a list of them",
                  );
                } else if (k === "flight_booking") {
                  setMultiTaskInstruction(
                    "Choose Economy Seat, fill Passenger Full Name, fill Passport Number, and confirm purchase",
                  );
                } else {
                  setMultiTaskInstruction(
                    "Update user bio to Senior Engineer and permanently delete account",
                  );
                }
              }}
              className="rounded-lg border border-border bg-background px-2.5 py-1 text-xs"
            >
              <option value="meesho_supplier">Sample: Meesho Supplier Panel</option>
              <option value="flight_booking">Sample: Flight Booking Page</option>
              <option value="account_settings">Sample: Account Settings</option>
              <option value="captured_json">Captured Snapshot JSON (Paste)</option>
              <option value="unavailable">Unavailable (No Live Tab Connected)</option>
            </select>
          </div>
        </div>

        {/* Truthful Source State Banner */}
        <div
          className={`mt-4 rounded-xl border p-3 text-xs ${
            sourceKind === "unavailable"
              ? "border-destructive/40 bg-destructive/5 text-foreground"
              : "border-border/80 bg-muted/30 text-foreground"
          }`}
        >
          <p className="font-semibold">{INSPECTOR_SOURCE_LABELS[sourceKind].title}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {INSPECTOR_SOURCE_LABELS[sourceKind].detail}
          </p>
        </div>

        {/* Captured PageSnapshot JSON Input Panel */}
        {selectedSampleKey === "captured_json" && (
          <div className="mt-3 rounded-xl border border-border bg-muted/20 p-3 space-y-2">
            <label htmlFor="captured-snapshot-json" className="block text-xs font-medium">
              Paste PageSnapshot JSON (from extension GET_SNAPSHOT)
            </label>
            <textarea
              id="captured-snapshot-json"
              rows={4}
              value={snapshotJsonInput}
              onChange={(e) => setSnapshotJsonInput(e.target.value)}
              placeholder='{"url":"https://example.com","title":"Example Page","headings":[],"forms":[],"controls":[],"alerts":[],"text":"..."}'
              className="w-full rounded-lg border border-border bg-background p-2 font-mono text-[11px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            {snapshotJsonError && <p className="text-xs text-destructive">{snapshotJsonError}</p>}
            <Button size="sm" variant="secondary" onClick={handleApplyCapturedSnapshot}>
              Load Snapshot
            </Button>
          </div>
        )}

        {/* Current URL & Snapshot summary */}
        {sourceKind !== "unavailable" && (
          <div className="mt-4 rounded-xl border border-border/80 bg-muted/20 p-3 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-foreground truncate">{currentSnapshot.title}</span>
              <Badge variant="outline" className="font-mono text-[10px] shrink-0">
                {currentSnapshot.origin}
              </Badge>
            </div>
            <div className="mt-2 flex flex-wrap gap-2 text-muted-foreground text-[11px]">
              <span>{currentSnapshot.forms.length} Form inputs</span>
              <span>·</span>
              <span>{currentSnapshot.controls.length} Clickable controls</span>
              <span>·</span>
              <span>{currentSnapshot.headings.length} Headings</span>
            </div>
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={analyzeMutation.isPending || sourceKind === "unavailable"}
            onClick={() => analyzeMutation.mutate("explain_page")}
            className="text-xs gap-1.5"
          >
            <Sparkles
              className={`h-3.5 w-3.5 ${analyzeMutation.isPending ? "animate-spin" : ""}`}
            />
            {analyzeMutation.isPending ? "Analyzing Snapshot…" : "Analyze Snapshot with AI"}
          </Button>

          {explanation && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => speakReply(explanation)}
              className="text-xs gap-1.5"
            >
              <Volume2 className="h-3.5 w-3.5" />
              Listen to Buddy
            </Button>
          )}
        </div>
      </div>

      {/* MULTI-ACTION SANDBOX OPERATOR PREVIEW */}
      <div className="panel p-5 space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">
              Multi-Action Planner & Sandbox Dry-Run
            </h3>
          </div>
          <Badge variant="outline" className="text-[10px] uppercase font-mono w-fit">
            {sourceKind === "unavailable"
              ? "Unavailable (No Tab)"
              : "Sandbox Dry-Run Fixture (Offline)"}
          </Badge>
        </div>

        <p className="text-xs text-muted-foreground">
          Preview how Buddy decomposes instructions, flags consequential confirmation gates, and
          parses data from a snapshot. Live DOM execution on active websites occurs inside the
          Chrome Extension side panel.
        </p>

        {/* Preset Fixture Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-muted-foreground">Sample Fixtures:</span>
          <button
            type="button"
            onClick={() => {
              setSelectedSampleKey("meesho_supplier");
              setSourceKind("sandbox_fixture");
              const snap = SAMPLE_PAGES["meesho_supplier"]!;
              setCurrentSnapshot(snap);
              setExtractedItems(deriveExtractedItemsFromSnapshot(snap));
              const instr =
                "Open Meesho Supplier Panel, go to Orders, open today's orders, find pending orders, copy their order IDs, and prepare a list of them";
              setMultiTaskInstruction(instr);
              setMultiActionPlan(createMultiActionPlan(instr, snap));
              setPendingApprovalMultiStep(null);
            }}
            className="rounded-md border border-border/70 bg-card px-2.5 py-1 text-[11px] hover:border-primary transition-colors text-foreground"
          >
            Sample: Meesho Orders
          </button>
          <button
            type="button"
            onClick={() => {
              setSelectedSampleKey("flight_booking");
              setSourceKind("sandbox_fixture");
              const snap = SAMPLE_PAGES["flight_booking"]!;
              setCurrentSnapshot(snap);
              setExtractedItems(deriveExtractedItemsFromSnapshot(snap));
              const instr =
                "Choose Economy Seat, fill passenger full name, fill passport number, and confirm ticket purchase";
              setMultiTaskInstruction(instr);
              setMultiActionPlan(createMultiActionPlan(instr, snap));
              setPendingApprovalMultiStep(null);
            }}
            className="rounded-md border border-border/70 bg-card px-2.5 py-1 text-[11px] hover:border-primary transition-colors text-foreground"
          >
            Sample: Flight Booking
          </button>
          <button
            type="button"
            onClick={() => {
              setSelectedSampleKey("account_settings");
              setSourceKind("sandbox_fixture");
              const snap = SAMPLE_PAGES["account_settings"]!;
              setCurrentSnapshot(snap);
              setExtractedItems(deriveExtractedItemsFromSnapshot(snap));
              const instr = "Update profile bio to Senior Architect and permanently delete account";
              setMultiTaskInstruction(instr);
              setMultiActionPlan(createMultiActionPlan(instr, snap));
              setPendingApprovalMultiStep(null);
            }}
            className="rounded-md border border-border/70 bg-card px-2.5 py-1 text-[11px] hover:border-primary transition-colors text-foreground"
          >
            Sample: Account Danger Zone
          </button>
        </div>

        {/* Natural Language Instruction Input */}
        <div className="flex flex-col gap-2 sm:flex-row">
          <textarea
            value={multiTaskInstruction}
            onChange={(e) => setMultiTaskInstruction(e.target.value)}
            rows={2}
            placeholder="Enter complex instruction (e.g. Open panel, filter today's orders, copy pending order IDs...)"
            className="flex-1 rounded-xl border border-border bg-background p-3 text-xs text-foreground focus:border-primary focus:outline-none"
          />
          <div className="flex flex-col gap-1.5 shrink-0 justify-end">
            <Button
              size="sm"
              disabled={sourceKind === "unavailable"}
              onClick={() => handleGenerateMultiPlan()}
              className="text-xs gap-1.5"
            >
              <RotateCw className="h-3.5 w-3.5" />
              Generate Dry-Run Plan
            </Button>
          </div>
        </div>

        {/* Active Multi-Action Plan View */}
        {multiActionPlan && (
          <div className="rounded-xl border border-border bg-card/60 p-4 space-y-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="font-semibold text-xs text-foreground">{multiActionPlan.title}</div>
                <div className="text-[11px] text-muted-foreground">
                  Snapshot Target: {multiActionPlan.targetWebsite || "Sample Fixture"} ·{" "}
                  {multiActionPlan.totalSteps} steps total (Sandbox Dry-Run)
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Badge
                  variant={
                    multiActionPlan.status === "completed"
                      ? "default"
                      : multiActionPlan.status === "failed"
                        ? "destructive"
                        : multiActionPlan.status === "awaiting_approval"
                          ? "secondary"
                          : "outline"
                  }
                  className="capitalize font-mono text-[10px]"
                >
                  Status: {multiActionPlan.status.replace("_", " ")}
                </Badge>
              </div>
            </div>

            {/* Stepper Progress Bar */}
            <div className="space-y-1">
              <div className="flex justify-between text-[11px] text-muted-foreground">
                <span>
                  {multiActionPlan.steps.filter((s) => s.status === "completed").length} of{" "}
                  {multiActionPlan.totalSteps} steps completed
                </span>
                <span>
                  {Math.round(
                    (multiActionPlan.steps.filter((s) => s.status === "completed").length /
                      Math.max(1, multiActionPlan.totalSteps)) *
                      100,
                  )}
                  %
                </span>
              </div>
              <div className="h-2 w-full rounded-full bg-muted/40 overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{
                    width: `${Math.round(
                      (multiActionPlan.steps.filter((s) => s.status === "completed").length /
                        Math.max(1, multiActionPlan.totalSteps)) *
                        100,
                    )}%`,
                  }}
                />
              </div>
            </div>

            {/* Step-by-Step List with Verification Indicators */}
            <div className="space-y-2">
              {multiActionPlan.steps.map((st, idx) => {
                const isCurrent = multiActionPlan.currentStepIndex === idx;
                return (
                  <div
                    key={st.id}
                    className={`flex items-center justify-between rounded-lg border p-2.5 text-xs transition-colors ${
                      st.status === "running"
                        ? "border-primary bg-primary/10"
                        : st.status === "completed"
                          ? "border-emerald-500/40 bg-emerald-500/5 text-muted-foreground"
                          : st.status === "awaiting_approval"
                            ? "border-amber-500/60 bg-amber-500/10"
                            : st.status === "failed"
                              ? "border-destructive/60 bg-destructive/10 text-destructive"
                              : isCurrent
                                ? "border-border bg-secondary/30"
                                : "border-border/60 bg-card/40 text-muted-foreground"
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0 pr-2">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted/60 text-[10px] font-bold">
                        {st.status === "completed" ? (
                          <Check className="h-3.5 w-3.5 text-emerald-500" />
                        ) : (
                          idx + 1
                        )}
                      </span>
                      <div className="min-w-0">
                        <div className="font-medium truncate text-foreground">{st.title}</div>
                        {st.selector && (
                          <div className="font-mono text-[10px] text-muted-foreground truncate">
                            selector: {st.selector}
                          </div>
                        )}
                        {st.result && (
                          <div className="text-[10px] text-emerald-600 dark:text-emerald-400">
                            ✓ {st.result}
                          </div>
                        )}
                        {st.error && (
                          <div className="text-[10px] text-destructive">✗ {st.error}</div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {st.isConsequential && (
                        <Badge
                          variant="outline"
                          className="text-[9px] border-amber-500/50 text-amber-600"
                        >
                          Consequential
                        </Badge>
                      )}
                      <Badge
                        variant={
                          st.status === "completed"
                            ? "default"
                            : st.status === "running"
                              ? "default"
                              : st.status === "awaiting_approval"
                                ? "destructive"
                                : "secondary"
                        }
                        className="text-[9px] uppercase font-mono"
                      >
                        {st.status}
                      </Badge>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Consequential Action Approval Card */}
            {pendingApprovalMultiStep && (
              <div className="rounded-xl border border-amber-500/60 bg-amber-500/10 p-4 space-y-2.5">
                <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 font-semibold text-xs">
                  <ShieldAlert className="h-4 w-4" />
                  <span>Consequential Step Requires Explicit Confirmation</span>
                </div>
                <p className="text-xs text-foreground">
                  {pendingApprovalMultiStep.approvalPrompt ||
                    `Buddy has paused before executing "${pendingApprovalMultiStep.title}". This action creates real-world changes (payment, submit, or delete).`}
                </p>
                <div className="flex items-center gap-2 pt-1">
                  <Button
                    size="sm"
                    onClick={handleApproveConsequentialStep}
                    className="bg-amber-600 hover:bg-amber-700 text-white text-xs h-7 px-3"
                  >
                    Confirm & Proceed
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleSkipMultiPlanStep}
                    className="text-xs h-7 px-3"
                  >
                    Skip This Step
                  </Button>
                </div>
              </div>
            )}

            {/* Execution Control Bar */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-border/60">
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  disabled={
                    sourceKind === "unavailable" ||
                    isExecutingMultiPlan ||
                    multiActionPlan.status === "completed" ||
                    multiActionPlan.status === "cancelled"
                  }
                  onClick={handleRunAllSteps}
                  className="text-xs gap-1.5 h-8"
                >
                  <Play className="h-3.5 w-3.5" />
                  {multiActionPlan.status === "paused" ? "Resume Dry-Run" : "Dry-Run All Steps"}
                </Button>

                <Button
                  size="sm"
                  variant="outline"
                  disabled={
                    sourceKind === "unavailable" ||
                    isExecutingMultiPlan ||
                    multiActionPlan.status === "completed" ||
                    multiActionPlan.status === "cancelled"
                  }
                  onClick={handleRunNextStep}
                  className="text-xs gap-1.5 h-8"
                >
                  <ArrowRight className="h-3.5 w-3.5" />
                  Next Step
                </Button>

                {isExecutingMultiPlan && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={handlePauseMultiPlan}
                    className="text-xs gap-1.5 h-8"
                  >
                    <Pause className="h-3.5 w-3.5" />
                    Pause
                  </Button>
                )}

                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleSkipMultiPlanStep}
                  disabled={
                    multiActionPlan.status === "completed" || multiActionPlan.status === "cancelled"
                  }
                  className="text-xs gap-1.5 h-8"
                >
                  <SkipForward className="h-3.5 w-3.5" />
                  Skip
                </Button>
              </div>

              <Button
                size="sm"
                variant="ghost"
                onClick={handleCancelMultiPlan}
                className="text-xs gap-1.5 h-8 text-destructive hover:bg-destructive/10"
              >
                <Square className="h-3.5 w-3.5" />
                Stop
              </Button>
            </div>
          </div>
        )}

        {/* Parsed Snapshot Data Panel (Explicitly Labeled) */}
        {multiActionPlan &&
          multiActionPlan.steps.some((s) => s.action === "extract" && s.status === "completed") && (
            <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-semibold text-xs text-foreground">
                  <FileText className="h-4 w-4 text-primary" />
                  <span>
                    Parsed Snapshot Data ({extractedItems.length} item(s)) ·{" "}
                    {INSPECTOR_SOURCE_LABELS[sourceKind].badge}
                  </span>
                </div>
                {extractedItems.length > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleCopyExtractedList}
                    className="text-xs gap-1.5 h-7 px-2.5"
                  >
                    <Copy className="h-3 w-3" />
                    Copy List
                  </Button>
                )}
              </div>

              {extractedItems.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No structured order IDs found in the current snapshot text.
                </p>
              ) : (
                <div className="rounded-lg border border-border bg-card p-3 font-mono text-xs max-h-40 overflow-y-auto space-y-1">
                  {extractedItems.map((item, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between gap-2 py-0.5 border-b border-border/40 last:border-0"
                    >
                      <span className="font-semibold text-foreground">{item.orderId}</span>
                      <span className="text-[10px] text-amber-600 dark:text-amber-400">
                        {item.status}
                      </span>
                      <span className="text-muted-foreground text-[11px] truncate max-w-[200px]">
                        {item.details}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
      </div>

      {/* 7-Stage Visual State Tracker */}
      {plan && (
        <div className="panel p-5">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              7-Stage Sandbox Dry-Run Lifecycle
            </span>
            <Badge
              variant={
                plan.currentStage === "completed"
                  ? "default"
                  : plan.currentStage === "failed"
                    ? "destructive"
                    : "secondary"
              }
              className="capitalize text-xs font-mono"
            >
              Stage: {plan.currentStage.replace("_", " ")}
            </Badge>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
            {stages.map((st, i) => {
              const isPast = stages.indexOf(plan.currentStage) > i;
              const isCurrent = plan.currentStage === st;

              return (
                <div
                  key={st}
                  className={`flex flex-col items-center rounded-xl border p-2 text-center text-xs transition-colors ${
                    isCurrent
                      ? "border-primary bg-primary/10 font-medium text-foreground"
                      : isPast
                        ? "border-emerald-500/40 bg-emerald-500/5 text-muted-foreground"
                        : "border-border/60 bg-card/40 text-muted-foreground/60"
                  }`}
                >
                  <div className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold">
                    {isPast ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : i + 1}
                  </div>
                  <span className="mt-1 capitalize text-[11px] truncate w-full">
                    {st.replace("_", " ")}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Audit log steps */}
          <div className="mt-4 space-y-1.5 rounded-lg border border-border/60 bg-muted/10 p-3 text-xs font-mono">
            <div className="text-[10px] uppercase text-muted-foreground font-sans">
              Dry-Run Trace:
            </div>
            {plan.steps.map((s, idx) => (
              <div key={idx} className="flex items-start gap-2 text-muted-foreground">
                <span className="text-emerald-500 shrink-0">✓ [{s.stage}]</span>
                <span>{s.detail}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Buddy's Explanation & Recommendations */}
      {explanation && (
        <div className="panel p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Buddy's Snapshot Analysis ({INSPECTOR_SOURCE_LABELS[sourceKind].badge})
            </h3>
            {proposedNextStep && (
              <span className="text-[11px] text-muted-foreground">Next: {proposedNextStep}</span>
            )}
          </div>
          <ChatMarkdown content={explanation} variant="assistant" />
        </div>
      )}

      {/* Interactive Page Controls (Sandbox Fixture Preview) */}
      {sourceKind !== "unavailable" && (
        <div className="panel p-5">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            Snapshot Controls (Sandbox Dry-Run Preview)
          </h3>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {currentSnapshot.controls.map((ctrl) => {
              const isSensitiveAction =
                ctrl.name.toLowerCase().includes("delete") ||
                ctrl.name.toLowerCase().includes("purchase") ||
                ctrl.name.toLowerCase().includes("confirm");

              return (
                <button
                  key={ctrl.ref}
                  type="button"
                  onClick={() =>
                    handleExecuteAction({
                      id: `act_${ctrl.ref}`,
                      type: isSensitiveAction ? "click_submit" : "click",
                      target: { ref: ctrl.ref, selector: ctrl.selector, role: ctrl.role },
                      description: `Click "${ctrl.name}"`,
                    })
                  }
                  className={`flex items-center justify-between rounded-xl border p-3 text-left text-xs transition-colors hover:border-ring ${
                    isSensitiveAction
                      ? "border-amber-500/40 bg-amber-500/5 hover:bg-amber-500/10"
                      : "border-border/80 bg-card hover:bg-secondary/40"
                  }`}
                >
                  <div className="min-w-0 pr-2">
                    <span className="block font-medium truncate text-foreground">{ctrl.name}</span>
                    <span className="block font-mono text-[10px] text-muted-foreground truncate">
                      {ctrl.selector}
                    </span>
                  </div>
                  {isSensitiveAction ? (
                    <Badge
                      variant="outline"
                      className="border-amber-500/50 text-amber-600 text-[10px] shrink-0"
                    >
                      High Impact
                    </Badge>
                  ) : (
                    <MousePointer className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Confirmation Modal for Consequential Actions */}
      {approvalModalAction && (
        <Dialog open={true} onOpenChange={(open) => !open && setApprovalModalAction(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
                <ShieldAlert className="h-5 w-5" />
                Confirmation Required
              </DialogTitle>
              <DialogDescription className="text-xs">
                Buddy has paused at the <strong>Awaiting Approval</strong> stage. This action
                carries consequences (such as purchasing or deleting data).
              </DialogDescription>
            </DialogHeader>

            <div className="rounded-lg border border-border/80 bg-muted/30 p-3 text-xs space-y-1.5">
              <div>
                <strong>Action:</strong>{" "}
                {approvalModalAction.description || approvalModalAction.type}
              </div>
              <div>
                <strong>Target Selector:</strong>{" "}
                <code className="font-mono text-[11px]">{approvalModalAction.target.selector}</code>
              </div>
              <div className="text-[11px] text-muted-foreground">
                Buddy will re-verify the element before acting and check the result immediately
                afterward.
              </div>
            </div>

            <DialogFooter className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setApprovalModalAction(null);
                  setPlan((prev) =>
                    prev ? advanceTaskStage(prev, "failed", "Action cancelled by user.") : null,
                  );
                }}
              >
                Reject & Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleConfirmApproval}
                className="bg-amber-600 hover:bg-amber-700 text-white"
              >
                Confirm & Allow Action
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
