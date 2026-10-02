import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Send, Stethoscope, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { BuddyAvatar, type BuddyEmotion } from "@/components/buddy-avatar";
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
} from "@/lib/app.functions";
import { PERMISSION_DESCRIPTIONS } from "@/shared/permissions";

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

  const ask = useMutation({
    mutationFn: (text: string) => runAsk({ data: { question: text } }),
    onSuccess: (result) => {
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
    onError: () =>
      toast.error("Buddy could not answer that just now. Please try again in a moment."),
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
    customBuddies.find((b) => b.id === profile?.selected_custom_buddy_id)?.name ??
    profile?.selected_buddy_slug ??
    "friendly";

  return (
    <AppShell
      title={`Hello${profile?.display_name ? `, ${profile.display_name}` : ""}.`}
      description="Ask your Buddy anything here. On a real page, use the extension side panel so it can see the screen."
    >
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="panel p-6 lg:col-span-2">
          <div className="flex items-start gap-4">
            <BuddyAvatar
              emotion={ask.isPending ? "thinking" : (answer?.emotion ?? "neutral")}
              size={84}
            />
            <div className="flex-1">
              <p className="text-sm text-muted-foreground">
                Current Buddy: <span className="font-medium text-foreground">{activeBuddy}</span>
              </p>
              <Textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Ask your Buddy — “explain GST input credit in simple Hinglish”"
                className="mt-2"
                rows={3}
                maxLength={2000}
              />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button
                  onClick={() => ask.mutate(question.trim())}
                  disabled={ask.isPending || question.trim().length === 0}
                >
                  <Send className="mr-2 size-4" />
                  {ask.isPending ? "Thinking…" : "Ask"}
                </Button>
                <span className="text-xs text-muted-foreground">
                  {requestsToday}/300 requests today
                </span>
              </div>
            </div>
          </div>

          {answer && (
            <div className="mt-5 rounded-lg border border-border bg-muted/40 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {answer.buddy}
                {answer.blocked ? " · blocked by your permission level" : ""}
              </p>
              <p className="mt-2 whitespace-pre-wrap text-sm">{answer.text}</p>
              {answer.needs.length > 0 && (
                <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                  {answer.needs.map((need) => (
                    <li key={need}>{need}</li>
                  ))}
                </ul>
              )}
              {!answer.blocked && (
                <p className="mt-3 text-xs text-muted-foreground">
                  Confidence: {answer.confidence}. Buddy is not a licensed
                  professional — check anything that carries risk.
                </p>
              )}
            </div>
          )}
        </section>

        <aside className="space-y-4">
          <div className="panel p-5">
            <h2 className="font-semibold">Plan</h2>
            <p className="mt-1 text-sm text-muted-foreground">{trialLabel(subscription)}</p>
            <Badge variant="secondary" className="mt-3">
              {permissions?.level ?? "explain"}
            </Badge>
            <p className="mt-2 text-xs text-muted-foreground">
              {PERMISSION_DESCRIPTIONS[permissions?.level ?? "explain"]}
            </p>
            <Button asChild variant="outline" size="sm" className="mt-4 w-full">
              <Link to="/settings">Change permissions</Link>
            </Button>
          </div>

          <div className="panel p-5">
            <h2 className="font-semibold">Self-check</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              “Buddy, diagnose yourself.” Runs real checks against the backend and AI provider.
            </p>
            <Button
              variant="secondary"
              size="sm"
              className="mt-3 w-full"
              onClick={() => diagnosis.mutate()}
              disabled={diagnosis.isPending}
            >
              <Stethoscope className="mr-2 size-4" />
              {diagnosis.isPending ? "Checking…" : "Run diagnostics"}
            </Button>
            {checks && (
              <ul className="mt-3 space-y-1.5 text-sm">
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
            <p className="mt-3 text-sm text-muted-foreground">Nothing yet. Ask something above.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {tasks.slice(0, 6).map((task) => (
                <li key={task.id} className="rounded-md border border-border/70 p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">{task.title}</span>
                    <Badge variant={task.status === "failed" ? "destructive" : "secondary"}>
                      {task.status}
                    </Badge>
                  </div>
                  {task.page_title && (
                    <p className="mt-1 truncate text-xs text-muted-foreground">{task.page_title}</p>
                  )}
                  {task.error && <p className="mt-1 text-xs text-destructive">{task.error}</p>}
                </li>
              ))}
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
              disabled={
                memoryMutation.isPending || !memoryKey.trim() || !memoryValue.trim()
              }
            >
              Save
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Passwords, OTPs, PINs, cards and keys are refused — by the app and by the database.
          </p>
          <ul className="mt-3 space-y-2">
            {memories.slice(0, 8).map((memory) => (
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
    </AppShell>
  );
}
