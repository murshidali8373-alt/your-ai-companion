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
  type TaskExecutionPlan,
  type TaskLifecycleStage,
} from "@/shared/task-lifecycle";
import { type BrowserAction } from "@/shared/browser-action";
import { findCatalogModel } from "@/lib/ai/model-hub";

// Sample live mock pages for web dashboard demonstration
const SAMPLE_PAGES: Record<string, PageSnapshot> = {
  flight_booking: {
    url: "https://travel-demo.com/flights/search",
    origin: "https://travel-demo.com",
    title: "Book Flight — New Delhi (DEL) to London (LHR)",
    capturedAt: new Date().toISOString(),
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
    capturedAt: new Date().toISOString(),
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
  const [selectedSampleKey, setSelectedSampleKey] = useState<string>("flight_booking");
  const [currentSnapshot, setCurrentSnapshot] = useState<PageSnapshot>(
    SAMPLE_PAGES["flight_booking"]!,
  );
  const [plan, setPlan] = useState<TaskExecutionPlan | null>(null);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [proposedNextStep, setProposedNextStep] = useState<string | null>(null);
  const [approvalModalAction, setApprovalModalAction] = useState<BrowserAction | null>(null);

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
                setCurrentSnapshot(SAMPLE_PAGES[k] ?? SAMPLE_PAGES["flight_booking"]!);
                setExplanation(null);
                setPlan(null);
              }}
              className="rounded-lg border border-border bg-background px-2.5 py-1 text-xs"
            >
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
