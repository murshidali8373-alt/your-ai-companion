import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  ClipboardCheck,
  Cpu,
  Globe,
  Send,
  Sparkles,
  Stethoscope,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { Buddy3D } from "@/components/buddy-3d";
import { BuddyAvatar, type BuddyEmotion } from "@/components/buddy-avatar";
import { VoiceBar } from "@/components/voice-bar";
import { AiModelHub } from "@/components/ai-model-hub";
import { WebpageInspector } from "@/components/webpage-inspector";
import { BuddyEmotionControlPanel } from "@/components/buddy-emotion-control-panel";
import { VerificationDashboard } from "@/components/verification-dashboard";
import { useBuddyStateManager, BUDDY_EMOTION_STATES } from "@/hooks/use-buddy-state-manager";
import { SingleSpeaker } from "@/shared/voice-turn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  addMemory,
  askBuddy,
  clearMemory,
  deleteMemory,
  diagnose,
  getDashboard,
  listBuddies,
  selectBuddy,
} from "@/lib/app.functions";
import { PERMISSION_DESCRIPTIONS } from "@/shared/permissions";
import { findCatalogModel } from "@/lib/ai/model-hub";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
});

function trialLabel(subscription: { status: string; trial_ends_at: string | null } | null) {
  if (!subscription) return "No plan on record";
  if (subscription.status === "trialing" && subscription.trial_ends_at) {
    const days = Math.ceil(
      (new Date(subscription.trial_ends_at).getTime() - Date.now()) / 86_400_000,
    );
    return days > 0 ? `Trial · ${days} day${days === 1 ? "" : "s"} left` : "Trial ended";
  }
  return subscription.status === "active" ? "Pro" : `Plan: ${subscription.status}`;
}

function Dashboard() {
  const queryClient = useQueryClient();
  const loadDashboard = useServerFn(getDashboard);
  const runAsk = useServerFn(askBuddy);
  const runDiagnose = useServerFn(diagnose);
  const saveMemory = useServerFn(addMemory);
  const forgetMemory = useServerFn(deleteMemory);
  const wipeMemory = useServerFn(clearMemory);

  const dashboard = useQuery({ queryKey: ["dashboard"], queryFn: () => loadDashboard() });

  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<{
    text: string;
    buddy: string;
    confidence: string;
    needs: string[];
    emotion: BuddyEmotion;
    blocked: boolean;
  } | null>(null);
  const [memoryKey, setMemoryKey] = useState("");
  const [memoryValue, setMemoryValue] = useState("");
  const [checks, setChecks] = useState<Array<{ name: string; ok: boolean; detail: string }> | null>(
    null,
  );

  const runSelect = useServerFn(selectBuddy);
  const fetchBuddies = useServerFn(listBuddies);
  const buddies = useQuery({ queryKey: ["buddies"], queryFn: () => fetchBuddies() });
  const buddy = useBuddyStateManager(BUDDY_EMOTION_STATES.IDLE);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [manualEmotion, setManualEmotion] = useState<BuddyEmotion | null>(null);
  const speaker = useRef<SingleSpeaker | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    speaker.current = new SingleSpeaker(
      typeof speechSynthesis === "undefined" ? null : speechSynthesis,
    );
    return () => speaker.current?.cancel();
  }, []);

  const stopAll = useCallback(() => {
    requestId.current += 1; // any in-flight reply is ignored
    speaker.current?.cancel();
    setSpeaking(false);
    buddy.setEmotion(BUDDY_EMOTION_STATES.IDLE, { reason: "Conversation reset" });
  }, [buddy]);

  const [activeTab, setActiveTab] = useState<
    "stage" | "hub" | "inspector" | "emotions" | "verification"
  >("stage");
  const [selectedModelId, setSelectedModelId] = useState<string>("gemini-3.8-flash");

  useEffect(() => {
    try {
      const saved = localStorage.getItem("buddy_active_model_id");
      if (saved) setSelectedModelId(saved);
    } catch {
      // Non-fatal
    }
  }, []);

  const choose = useMutation({
    mutationFn: (slug: string) => runSelect({ data: { slug, customId: null } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
    onError: () => toast.error("Could not switch Buddy. Please try again."),
  });

  const ask = useMutation({
    mutationFn: async (text: string) => {
      const id = ++requestId.current;
      buddy.setEmotion(BUDDY_EMOTION_STATES.THINKING, { reason: "Processing question…" });

      let userApiKey: string | undefined;
      let customBaseUrl: string | undefined;
      if (typeof window !== "undefined") {
        const catalogEntry = findCatalogModel(selectedModelId);
        const pId =
          catalogEntry?.provider ?? (selectedModelId.startsWith("gemini") ? "gemini" : undefined);
        if (pId) {
          userApiKey = localStorage.getItem(`buddy_key_${pId}`) || undefined;
          customBaseUrl = localStorage.getItem(`buddy_url_${pId}`) || undefined;
        }
      }

      const result = await runAsk({
        data: {
          question: text,
          preferredModel: selectedModelId,
          userApiKey,
          customBaseUrl,
        },
      });
      return { result, stale: id !== requestId.current };
    },
    onSuccess: ({ result, stale }) => {
      if (stale) return;
      const lang = dashboard.data?.profile?.language === "english" ? "en-IN" : "hi-IN";
      buddy.setEmotion(BUDDY_EMOTION_STATES.SPEAKING, { reason: "Speaking response" });
      if (
        speaker.current?.speak(result.answer, lang, () => {
          setSpeaking(false);
          buddy.setEmotion(result.emotion || BUDDY_EMOTION_STATES.HAPPY, {
            durationMs: 2500,
            revertTo: BUDDY_EMOTION_STATES.IDLE,
            reason: "Completed reply",
          });
        })
      ) {
        setSpeaking(true);
      } else {
        buddy.setEmotion(result.emotion || BUDDY_EMOTION_STATES.HAPPY, {
          durationMs: 2000,
          revertTo: BUDDY_EMOTION_STATES.IDLE,
        });
      }
      setAnswer({
        text: result.answer,
        buddy: result.buddyName,
        confidence: result.confidence,
        needs: result.needs ? [result.needs] : [],
        emotion: (result.emotion as BuddyEmotion) ?? "neutral",
        blocked: result.blocked,
      });
      setQuestion("");
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: () => {
      buddy.setEmotion(BUDDY_EMOTION_STATES.ERROR, {
        durationMs: 3000,
        revertTo: BUDDY_EMOTION_STATES.IDLE,
        reason: "Failed to process request",
      });
      toast.error("Buddy could not answer that just now. Please try again in a moment.");
    },
  });

  const memoryMutation = useMutation({
    mutationFn: () => saveMemory({ data: { key: memoryKey, value: memoryValue } }),
    onSuccess: (result) => {
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setMemoryKey("");
      setMemoryValue("");
      toast.success("Saved to memory.");
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: () => toast.error("Could not save that memory."),
  });

  const diagnosis = useMutation({
    mutationFn: () => runDiagnose(),
    onSuccess: (result) => setChecks(result.checks),
    onError: () => toast.error("Self-check could not run right now."),
  });

  if (dashboard.isLoading) {
    return (
      <AppShell title="Dashboard">
        <div className="grid gap-4 md:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      </AppShell>
    );
  }

  if (dashboard.isError || !dashboard.data) {
    return (
      <AppShell title="Dashboard">
        <div className="panel flex flex-col items-start gap-3 p-6">
          <AlertTriangle className="size-5 text-destructive" />
          <p className="text-sm text-muted-foreground">
            Your dashboard could not load. This is a real failure, not a blank screen.
          </p>
          <Button onClick={() => dashboard.refetch()}>Try again</Button>
        </div>
      </AppShell>
    );
  }

  const { profile, subscription, permissions, tasks, memories, usage, customBuddies } =
    dashboard.data;
  const requestsToday = usage[0]?.requests ?? 0;
  const activeBuddy =
    customBuddies.find(
      (b: { id: string; name: string }) => b.id === profile?.selected_custom_buddy_id,
    )?.name ??
    profile?.selected_buddy_slug ??
    "friendly";

  const lang = profile?.language === "english" ? "en-IN" : "hi-IN";
  const stageEmotion: BuddyEmotion = manualEmotion
    ? manualEmotion
    : listening
      ? "listening"
      : (buddy.emotion as BuddyEmotion) || (answer?.emotion ?? "neutral");
  const graphics = (profile?.graphics_mode ?? "balanced") as "low" | "balanced" | "high";
  const presets = buddies.data?.buddies ?? [];

  return (
    <AppShell
      title={`Hello${profile?.display_name ? `, ${profile.display_name}` : ""}.`}
      description="Talk to your Buddy. On a real web page, open the extension side panel so it can see the screen."
    >
      {/* Dashboard Feature Navigation */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-border/80 pb-3">
        <div className="flex items-center gap-1.5 rounded-xl bg-muted/40 p-1">
          <Button
            variant={activeTab === "stage" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setActiveTab("stage")}
            className="h-8 text-xs font-medium"
          >
            Buddy Stage
          </Button>
          <Button
            variant={activeTab === "emotions" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setActiveTab("emotions")}
            className="h-8 text-xs font-medium gap-1.5"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Emotion Lab (CSS)
          </Button>
          <Button
            variant={activeTab === "hub" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setActiveTab("hub")}
            className="h-8 text-xs font-medium gap-1.5"
          >
            <Cpu className="h-3.5 w-3.5" />
            AI Model Hub
          </Button>
          <Button
            variant={activeTab === "inspector" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setActiveTab("inspector")}
            className="h-8 text-xs font-medium gap-1.5"
          >
            <Globe className="h-3.5 w-3.5" />
            Webpage Assistant
          </Button>
          <Button
            variant={activeTab === "verification" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setActiveTab("verification")}
            className="h-8 text-xs font-medium gap-1.5"
          >
            <ClipboardCheck className="h-3.5 w-3.5" />
            Verification
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground hidden sm:inline">Active Model:</span>
          <Badge variant="outline" className="font-mono text-xs">
            {selectedModelId}
          </Badge>
        </div>
      </div>

      {activeTab === "emotions" && (
        <div className="space-y-4">
          <BuddyEmotionControlPanel
            initialEmotion={manualEmotion || "curious"}
            onEmotionChange={(emo) => setManualEmotion(emo)}
          />
        </div>
      )}

      {activeTab === "hub" && (
        <AiModelHub
          activeModelId={selectedModelId}
          onSelectModel={(m) => {
            setSelectedModelId(m.id);
            if (typeof window !== "undefined") {
              localStorage.setItem("buddy_active_model_id", m.id);
            }
          }}
        />
      )}

      {activeTab === "inspector" && <WebpageInspector activeModelId={selectedModelId} />}

      {activeTab === "verification" && <VerificationDashboard />}

      {activeTab === "stage" && (
        <>
          <div className="grid gap-4 lg:grid-cols-[200px_1fr_280px]">
            {/* BUDDY DOCK */}
            <nav aria-label="Buddy dock" className="glass order-2 p-2 lg:order-1">
              <p className="px-2 py-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Buddies
              </p>
              <ul className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
                {presets.slice(0, 10).map((b) => {
                  const active =
                    !profile?.selected_custom_buddy_id && profile?.selected_buddy_slug === b.slug;
                  return (
                    <li key={b.slug}>
                      <button
                        type="button"
                        disabled={choose.isPending}
                        onClick={() => choose.mutate(b.slug)}
                        aria-pressed={active}
                        className={`flex w-full min-w-36 items-center gap-2 rounded-xl px-2 py-2 text-left text-sm transition-colors ${
                          active
                            ? "bg-secondary text-foreground"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground"
                        }`}
                      >
                        <BuddyAvatar buddyId={b.slug} size={28} variant="2d" animated={false} />
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{b.name}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {b.tagline}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <Link
                to="/buddies"
                className="block px-2 pt-2 text-xs text-muted-foreground underline"
              >
                All Buddies & custom
              </Link>
            </nav>

            {/* MAIN STAGE */}
            <section className="glass stage-glow order-1 flex flex-col items-center gap-4 p-6 lg:order-2">
              <div className="flex w-full items-center justify-between text-xs text-muted-foreground">
                <span>
                  <span className="font-medium text-foreground">{activeBuddy}</span> ·{" "}
                  <span className="font-mono text-primary font-semibold uppercase">
                    {stageEmotion}
                  </span>
                </span>
                <span>{requestsToday}/300 today</span>
              </div>
              <Buddy3D
                slug={
                  profile?.selected_custom_buddy_id ? null : (profile?.selected_buddy_slug ?? null)
                }
                emotion={stageEmotion}
                size={260}
                graphics={graphics}
              />

              {/* Quick Emotion Animation Test Strip */}
              <div className="w-full max-w-md pt-2 border-t border-border/40">
                <div className="flex items-center justify-between mb-1.5 px-1">
                  <span className="text-[11px] font-semibold text-muted-foreground">
                    Quick Emotion Test:
                  </span>
                  {manualEmotion && (
                    <button
                      type="button"
                      onClick={() => setManualEmotion(null)}
                      className="text-[10px] text-primary hover:underline font-medium"
                    >
                      Reset auto
                    </button>
                  )}
                </div>
                <BuddyEmotionControlPanel
                  compact
                  initialEmotion={stageEmotion}
                  onEmotionChange={(emo) => setManualEmotion(emo)}
                />
              </div>

              <VoiceBar
                busy={ask.isPending || speaking}
                lang={lang}
                onListeningChange={setListening}
                onStop={stopAll}
                onSubmit={(text) => ask.mutate(text)}
              />
            </section>

            {/* ACTIVITY */}
            <aside aria-label="Activity" className="glass order-3 space-y-4 p-5">
              <div>
                <h2 className="text-sm font-semibold">Activity</h2>
                {ask.isPending && (
                  <p className="mt-2 text-sm text-muted-foreground">Understanding your request…</p>
                )}
                {!ask.isPending && !answer && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Ask something — the result shows here.
                  </p>
                )}
                {answer && !ask.isPending && (
                  <div className="mt-2 space-y-2">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      {answer.buddy}
                      {answer.blocked ? " · blocked" : ` · confidence ${answer.confidence}`}
                    </p>
                    <p className="max-h-72 overflow-y-auto whitespace-pre-wrap text-sm">
                      {answer.text}
                    </p>
                    {answer.needs.length > 0 && (
                      <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                        {answer.needs.map((need) => (
                          <li key={need}>{need}</li>
                        ))}
                      </ul>
                    )}
                    {!answer.blocked && (
                      <p className="text-xs text-muted-foreground">
                        Buddy is not a licensed professional — check anything that carries risk.
                      </p>
                    )}
                  </div>
                )}
              </div>
              <div className="border-t border-border pt-4">
                <p className="text-sm" suppressHydrationWarning>
                  {trialLabel(subscription)}
                </p>
                <Badge variant="secondary" className="mt-2">
                  {permissions?.level ?? "explain"}
                </Badge>
                <p className="mt-2 text-xs text-muted-foreground">
                  {
                    PERMISSION_DESCRIPTIONS[
                      (permissions?.level as keyof typeof PERMISSION_DESCRIPTIONS) ?? "explain"
                    ]
                  }
                </p>
                <Link
                  to="/settings"
                  className="mt-2 inline-block text-xs underline text-muted-foreground"
                >
                  Change permissions
                </Link>
              </div>
              <div className="border-t border-border pt-4">
                <Button
                  variant="secondary"
                  size="sm"
                  className="w-full"
                  onClick={() => diagnosis.mutate()}
                  disabled={diagnosis.isPending}
                >
                  <Stethoscope className="mr-2 size-4" />
                  {diagnosis.isPending ? "Checking…" : "Buddy, diagnose yourself"}
                </Button>
                {checks && (
                  <ul className="mt-3 space-y-1.5 text-xs">
                    {checks.map((check) => (
                      <li key={check.name} className="flex items-start justify-between gap-2">
                        <span className="text-muted-foreground">{check.name}</span>
                        <span className={check.ok ? "text-foreground" : "text-destructive"}>
                          {check.detail}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </aside>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <section className="panel p-5">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">Recent tasks</h2>
                <Link to="/tasks" className="text-sm text-muted-foreground underline">
                  All tasks
                </Link>
              </div>
              {tasks.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">
                  Nothing yet. Ask something above.
                </p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {tasks
                    .slice(0, 6)
                    .map(
                      (task: {
                        id: string;
                        title: string;
                        status: string;
                        page_title?: string | null;
                        error?: string | null;
                      }) => (
                        <li
                          key={task.id}
                          className="rounded-md border border-border/70 p-3 text-sm"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate font-medium">{task.title}</span>
                            <Badge variant={task.status === "failed" ? "destructive" : "secondary"}>
                              {task.status}
                            </Badge>
                          </div>
                          {task.page_title && (
                            <p className="mt-1 truncate text-xs text-muted-foreground">
                              {task.page_title}
                            </p>
                          )}
                          {task.error && (
                            <p className="mt-1 text-xs text-destructive">{task.error}</p>
                          )}
                        </li>
                      ),
                    )}
                </ul>
              )}
            </section>

            <section className="panel p-5">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">Memory</h2>
                {memories.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      try {
                        await wipeMemory();
                        toast.success("Memory cleared.");
                        queryClient.invalidateQueries({ queryKey: ["dashboard"] });
                      } catch {
                        toast.error("Could not clear memory.");
                      }
                    }}
                  >
                    Clear all
                  </Button>
                )}
              </div>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <Input
                  placeholder="What to remember (e.g. GST state)"
                  value={memoryKey}
                  onChange={(e) => setMemoryKey(e.target.value)}
                  maxLength={120}
                />
                <Input
                  placeholder="Value (e.g. Maharashtra)"
                  value={memoryValue}
                  onChange={(e) => setMemoryValue(e.target.value)}
                  maxLength={1000}
                />
                <Button
                  onClick={() => memoryMutation.mutate()}
                  disabled={memoryMutation.isPending || !memoryKey.trim() || !memoryValue.trim()}
                >
                  Save
                </Button>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Passwords, OTPs, PINs, cards and keys are refused — by the app and by the database.
              </p>
              <ul className="mt-3 space-y-2">
                {memories.slice(0, 8).map((memory: { id: string; key: string; value: string }) => (
                  <li
                    key={memory.id}
                    className="flex items-start justify-between gap-2 rounded-md border border-border/70 p-3 text-sm"
                  >
                    <div>
                      <p className="font-medium">{memory.key}</p>
                      <p className="text-muted-foreground">{memory.value}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Forget ${memory.key}`}
                      onClick={async () => {
                        try {
                          await forgetMemory({ data: { id: memory.id } });
                          queryClient.invalidateQueries({ queryKey: ["dashboard"] });
                        } catch {
                          toast.error("Could not forget that.");
                        }
                      }}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </>
      )}
    </AppShell>
  );
}
