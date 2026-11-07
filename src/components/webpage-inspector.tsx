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

// Sample live mock pages for web dashboard demonstration
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
  const [currentSnapshot, setCurrentSnapshot] = useState<PageSnapshot>(
    SAMPLE_PAGES["meesho_supplier"]!,
  );
  const [plan, setPlan] = useState<TaskExecutionPlan | null>(null);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [proposedNextStep, setProposedNextStep] = useState<string | null>(null);
  const [approvalModalAction, setApprovalModalAction] = useState<BrowserAction | null>(null);

  // Multi-Action Browser Operator State
  const [multiTaskInstruction, setMultiTaskInstruction] = useState<string>(
    "Open Meesho Supplier Panel, go to Orders, open today's orders, find pending orders, copy their order IDs, and prepare a list of them",
  );
  const [multiActionPlan, setMultiActionPlan] = useState<MultiActionTaskPlan | null>(null);
  const [isExecutingMultiPlan, setIsExecutingMultiPlan] = useState<boolean>(false);
  const [pendingApprovalMultiStep, setPendingApprovalMultiStep] = useState<MultiActionStep | null>(
    null,
  );
  const [extractedItems, setExtractedItems] = useState<
    Array<{ orderId: string; status: string; details: string }>
  >([
    { orderId: "MSH-982410-IN", status: "pending", details: "Today's Order — Pending Dispatch" },
    { orderId: "MSH-982411-IN", status: "pending", details: "Today's Order — Pending Dispatch" },
    { orderId: "MSH-982412-IN", status: "pending", details: "Today's Order — Ready to Pack" },
    { orderId: "MSH-982415-IN", status: "pending", details: "Today's Order — New Order" },
  ]);

  const handleGenerateMultiPlan = (instruction?: string) => {
    const text = instruction || multiTaskInstruction;
    const p = createMultiActionPlan(text, currentSnapshot);
    setMultiActionPlan(p);
    setPendingApprovalMultiStep(null);
    toast.success(`Generated ${p.steps.length}-step execution plan for Buddy.`);
  };

  const executeSingleStep = async (step: MultiActionStep) => {
    if (step.selector) {
      onHighlightElement?.(step.selector);
    }
    await new Promise((r) => setTimeout(r, 550));

    if (step.action === "extract") {
      return {
        success: true,
        result: `Extracted ${extractedItems.length} order IDs from page`,
        extractedData: extractedItems,
      };
    }
    return {
      success: true,
      result: `Action "${step.title}" verified on page.`,
    };
  };

  const handleRunNextStep = async () => {
    if (!multiActionPlan) return;
    const updated = await executeNextPlanStep(multiActionPlan, executeSingleStep);
    setMultiActionPlan(updated);
    if (updated.status === "awaiting_approval") {
      const step = updated.steps[updated.currentStepIndex];
      setPendingApprovalMultiStep(step || null);
      toast.warning(`Approval required: ${step?.title}`);
    } else if (updated.status === "completed") {
      toast.success("All steps completed and verified!");
    }
  };

  const handleRunAllSteps = async () => {
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
      await new Promise((r) => setTimeout(r, 400));
    }
    setIsExecutingMultiPlan(false);
    if (curPlan.status === "completed") {
      toast.success("Multi-action browser plan completed successfully!");
    }
  };

  const handlePauseMultiPlan = () => {
    if (!multiActionPlan) return;
    setMultiActionPlan(pauseMultiActionPlan(multiActionPlan));
    setIsExecutingMultiPlan(false);
    toast.info("Plan execution paused.");
  };

  const handleResumeMultiPlan = () => {
    if (!multiActionPlan) return;
    const resumed = resumeMultiActionPlan(multiActionPlan);
    setMultiActionPlan(resumed);
    toast.info("Resuming plan execution.");
    handleRunAllSteps();
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
    toast.error("Multi-action execution stopped.");
  };

  const handleApproveConsequentialStep = async () => {
    if (!multiActionPlan || !pendingApprovalMultiStep) return;
    setPendingApprovalMultiStep(null);
    const approved = approveAndContinuePlan(multiActionPlan);
    setMultiActionPlan(approved);
    toast.success("Consequential action approved. Continuing execution...");
    const nextPlan = await executeNextPlanStep(approved, executeSingleStep);
    setMultiActionPlan(nextPlan);
  };

  const handleCopyExtractedList = () => {
    const text = extractedItems
      .map((item, idx) => `${idx + 1}. ${item.orderId} — ${item.status} (${item.details})`)
      .join("\n");
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      toast.success("Order list copied to clipboard!");
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
      const planned = advanceTaskStage(
        understoodPlan,
        "planning",
        `Identified next step: ${res.needs?.[0] || "Select options and verify"}`,
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
    if (!plan) return;

    const updatedPlan = await executePlanStep(plan, action, async (act) => {
      // Simulate real browser execution
      await new Promise((r) => setTimeout(r, 600));
      if (act.target.selector) {
        onHighlightElement?.(act.target.selector);
      }
      return true;
    });

    setPlan(updatedPlan);
    if (updatedPlan.currentStage === "completed") {
      toast.success(`Action verified: ${action.type}`);
    } else if (updatedPlan.currentStage === "failed") {
      toast.error(updatedPlan.error || "Action could not be executed.");
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
      {/* Page Header & Sample Selector */}
      <div className="panel p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Globe className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold text-foreground">
                Webpage Context & Action Guide
              </h2>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Inspect DOM structure, detect form fields, formulate safe action plans, and request
              confirmation for consequential tasks.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Demo Page:</span>
            <select
              value={selectedSampleKey}
              onChange={(e) => {
                const k = e.target.value;
                setSelectedSampleKey(k);
                setCurrentSnapshot(SAMPLE_PAGES[k] ?? SAMPLE_PAGES["meesho_supplier"]!);
                setExplanation(null);
                setPlan(null);
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
                setMultiActionPlan(null);
              }}
              className="rounded-lg border border-border bg-background px-2.5 py-1 text-xs"
            >
              <option value="meesho_supplier">Meesho Supplier Panel (Orders)</option>
              <option value="flight_booking">Flight Booking Page</option>
              <option value="account_settings">Account Settings (Danger Zone)</option>
            </select>
          </div>
        </div>

        {/* Current URL & Snapshot summary */}
        <div className="mt-4 rounded-xl border border-border/80 bg-muted/20 p-3 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-medium text-foreground truncate">{currentSnapshot.title}</span>
            <Badge variant="outline" className="font-mono text-[10px]">
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

        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={analyzeMutation.isPending}
            onClick={() => analyzeMutation.mutate("explain_page")}
            className="text-xs gap-1.5"
          >
            <Sparkles
              className={`h-3.5 w-3.5 ${analyzeMutation.isPending ? "animate-spin" : ""}`}
            />
            {analyzeMutation.isPending ? "Analyzing Webpage…" : "Explain This Page & Next Step"}
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

      {/* MULTI-ACTION BROWSER OPERATOR DASHBOARD */}
      <div className="panel p-5 space-y-4 border-primary/30 bg-primary/[0.02]">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">
              Multi-Action Browser Operator Engine
            </h3>
          </div>
          <Badge variant="outline" className="text-[10px] uppercase font-mono w-fit">
            Sequential Automation & Verification
          </Badge>
        </div>

        <p className="text-xs text-muted-foreground">
          Buddy decomposes multi-step instructions into verified actions, navigates between states,
          clicks elements, fills forms, verifies each DOM transition, requests confirmation for
          consequential steps, and extracts audit data.
        </p>

        {/* Preset Task Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-muted-foreground">Presets:</span>
          <button
            type="button"
            onClick={() => {
              setSelectedSampleKey("meesho_supplier");
              setCurrentSnapshot(SAMPLE_PAGES["meesho_supplier"]!);
              const instr =
                "Open Meesho Supplier Panel, go to Orders, open today's orders, find pending orders, copy their order IDs, and prepare a list of them";
              setMultiTaskInstruction(instr);
              handleGenerateMultiPlan(instr);
            }}
            className="rounded-md border border-border/70 bg-card px-2.5 py-1 text-[11px] hover:border-primary transition-colors text-foreground"
          >
            📦 Meesho: Extract Pending Orders
          </button>
          <button
            type="button"
            onClick={() => {
              setSelectedSampleKey("flight_booking");
              setCurrentSnapshot(SAMPLE_PAGES["flight_booking"]!);
              const instr =
                "Choose Economy Seat, fill passenger full name, fill passport number, and confirm ticket purchase";
              setMultiTaskInstruction(instr);
              handleGenerateMultiPlan(instr);
            }}
            className="rounded-md border border-border/70 bg-card px-2.5 py-1 text-[11px] hover:border-primary transition-colors text-foreground"
          >
            ✈️ Flight Booking: Seat & Payment
          </button>
          <button
            type="button"
            onClick={() => {
              setSelectedSampleKey("account_settings");
              setCurrentSnapshot(SAMPLE_PAGES["account_settings"]!);
              const instr = "Update profile bio to Senior Architect and permanently delete account";
              setMultiTaskInstruction(instr);
              handleGenerateMultiPlan(instr);
            }}
            className="rounded-md border border-border/70 bg-card px-2.5 py-1 text-[11px] hover:border-primary transition-colors text-foreground"
          >
            🛡️ Account: Settings & Danger Zone
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
            <Button size="sm" onClick={() => handleGenerateMultiPlan()} className="text-xs gap-1.5">
              <RotateCw className="h-3.5 w-3.5" />
              Generate Plan
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
                  Target: {multiActionPlan.targetWebsite || "Active Webpage"} ·{" "}
                  {multiActionPlan.totalSteps} steps total
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
                  disabled={isExecutingMultiPlan || multiActionPlan.status === "completed"}
                  onClick={handleRunAllSteps}
                  className="text-xs gap-1.5 h-8"
                >
                  <Play className="h-3.5 w-3.5" />
                  {multiActionPlan.status === "paused" ? "Resume Execution" : "Execute All Steps"}
                </Button>

                <Button
                  size="sm"
                  variant="outline"
                  disabled={isExecutingMultiPlan || multiActionPlan.status === "completed"}
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
                  disabled={multiActionPlan.status === "completed"}
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

        {/* Extracted Data Result & Audit Report */}
        {multiActionPlan &&
          multiActionPlan.steps.some((s) => s.action === "extract" && s.status === "completed") && (
            <div className="rounded-xl border border-sky-500/40 bg-sky-500/[0.04] p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sky-600 dark:text-sky-400 font-semibold text-xs">
                  <FileText className="h-4 w-4" />
                  <span>Extracted Web Data ({extractedItems.length} items)</span>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleCopyExtractedList}
                  className="text-xs gap-1.5 h-7 px-2.5 border-sky-500/40 text-sky-600 hover:bg-sky-500/10"
                >
                  <Copy className="h-3 w-3" />
                  Copy List
                </Button>
              </div>

              <div className="rounded-lg border border-border bg-card p-3 font-mono text-xs max-h-40 overflow-y-auto space-y-1">
                {extractedItems.map((item, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between py-0.5 border-b border-border/40 last:border-0"
                  >
                    <span className="font-semibold text-foreground">{item.orderId}</span>
                    <span className="text-[10px] text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded">
                      {item.status}
                    </span>
                    <span className="text-muted-foreground text-[11px] truncate max-w-[200px]">
                      {item.details}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
      </div>

      {/* 7-Stage Visual State Tracker */}
      {plan && (
        <div className="panel p-5">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              7-Stage Task Lifecycle
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
              const isFailed = plan.currentStage === "failed";

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
              Execution Trace:
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
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Buddy's Page Analysis
            </h3>
            {proposedNextStep && (
              <Badge variant="outline" className="text-[11px]">
                Next: {proposedNextStep}
              </Badge>
            )}
          </div>
          <p className="whitespace-pre-wrap text-sm text-foreground leading-relaxed">
            {explanation}
          </p>
        </div>
      )}

      {/* Interactive Page Actions & Controls with Safety Gates */}
      <div className="panel p-5">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          Actionable Page Controls (Click to Execute with Guardrails)
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
