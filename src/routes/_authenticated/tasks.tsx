import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import {
  Activity,
  Bot,
  Pause,
  Play,
  RefreshCw,
  RotateCw,
  ShieldAlert,
  SkipForward,
  Sparkles,
  Square,
} from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { ChatMarkdown } from "@/components/chat-markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { TalkingBuddyCharacter } from "@/components/talking-buddy-character";
import { useBuddyStateManager, BUDDY_EMOTION_STATES } from "@/hooks/use-buddy-state-manager";
import {
  controlWebDagRun,
  diagnose,
  getPhase4WorkCenterOverview,
  listTasks,
  runWebMultiAgentObjective,
} from "@/lib/app.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/tasks")({
  component: Tasks,
});

function Tasks() {
  const queryClient = useQueryClient();
  const load = useServerFn(listTasks);
  const fetchOverview = useServerFn(getPhase4WorkCenterOverview);
  const runDiag = useServerFn(diagnose);
  const runAgentAudit = useServerFn(runWebMultiAgentObjective);
  const ctrlDag = useServerFn(controlWebDagRun);

  const q = useQuery({ queryKey: ["tasks"], queryFn: () => load() });
  const overview = useQuery({
    queryKey: ["phase4-work-center"],
    queryFn: () => fetchOverview(),
    refetchInterval: (query) =>
      query.state.data?.dagRuns.some((r) => r.status === "running") ? 800 : false,
  });

  const buddy = useBuddyStateManager(BUDDY_EMOTION_STATES.IDLE);
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [objectiveInput, setObjectiveInput] = useState("");
  const [diagChecks, setDiagChecks] = useState<Array<{
    name: string;
    ok: boolean;
    detail: string;
  }> | null>(null);

  const { setProcessingStage } = buddy;

  const hasRunningDag = Boolean(overview.data?.dagRuns.some((r) => r.status === "running"));
  const hasAwaitingApprovalDag = Boolean(
    overview.data?.dagRuns.some((r) => r.status === "awaiting_approval"),
  );

  // Sync live DAG and query states to Buddy's processing stage & emotional state
  useEffect(() => {
    if (hasRunningDag) {
      setProcessingStage("working", {
        reason: "Executing multi-agent subtasks…",
      });
    } else if (hasAwaitingApprovalDag) {
      setProcessingStage("awaiting_approval", {
        reason: "Waiting for user confirmation on a consequential step.",
      });
    } else if (q.isLoading) {
      setProcessingStage("analyzing", {
        reason: "Observing task execution trace…",
      });
    } else if (q.isError) {
      setProcessingStage("error", {
        reason: "Failed to load task history.",
      });
    } else if (q.data) {
      const hasFailed = q.data.tasks.some((t: { status: string }) => t.status === "failed");
      if (hasFailed) {
        setProcessingStage("confused", {
          durationMs: 3000,
          revertTo: BUDDY_EMOTION_STATES.IDLE,
          reason: "Noted previous task errors in log.",
        });
      } else if (q.data.tasks.length > 0) {
        setProcessingStage("completed", {
          durationMs: 2000,
          revertTo: BUDDY_EMOTION_STATES.IDLE,
          reason: "Tasks are healthy and synced.",
        });
      }
    }
  }, [hasRunningDag, hasAwaitingApprovalDag, q.isLoading, q.isError, q.data, setProcessingStage]);

  const launchObjective = useMutation({
    mutationFn: async () => {
      const text = objectiveInput.trim();
      if (text.length < 2) throw new Error("Enter an objective first.");
      setProcessingStage("planning", { reason: "Planning multi-agent subtasks…" });
      return await runAgentAudit({
        data: {
          objective: text,
          asyncMode: true,
        },
      });
    },
    onSuccess: (run) => {
      setObjectiveInput("");
      toast.success(`Launched DAG run (${run.subtasks.length} subtask(s)).`);
      void queryClient.invalidateQueries({ queryKey: ["phase4-work-center"] });
      void q.refetch();
    },
    onError: (err) => {
      setProcessingStage("error", { reason: "Could not launch objective." });
      toast.error(err instanceof Error ? err.message : "Could not launch objective.");
    },
  });

  const controlDagMutation = useMutation({
    mutationFn: (vars: {
      runId: string;
      action: "pause" | "resume" | "cancel" | "retry_failed" | "approve_step" | "skip_step";
      subtaskId?: string;
    }) => ctrlDag({ data: vars }),
    onSuccess: (updatedRun, vars) => {
      if (vars.action === "cancel") {
        setProcessingStage("idle", { reason: "Run cancelled by user." });
      }
      toast.info(`Run "${updatedRun.objective.slice(0, 32)}": ${updatedRun.status}`);
      void queryClient.invalidateQueries({ queryKey: ["phase4-work-center"] });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Control command failed.");
    },
  });

  const handleRunDiagnostics = async () => {
    setActiveAction("diagnose");
    try {
      await buddy.runTask(
        async () => {
          const res = await runDiag();
          setDiagChecks(res.checks);
          toast[res.ok ? "success" : "info"](
            res.ok ? "All system checks passed." : "Diagnostics found items needing attention.",
          );
        },
        {
          taskName: "System Diagnostics",
          workingEmotion: BUDDY_EMOTION_STATES.ANALYZING,
          successEmotion: BUDDY_EMOTION_STATES.SUCCESS,
          successDurationMs: 2500,
        },
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Diagnostics failed.");
    } finally {
      setActiveAction(null);
    }
  };

  const handleRunVerificationPipeline = async () => {
    setActiveAction("verify_pipeline");
    try {
      await buddy.runTask(
        async () => {
          const run = await runAgentAudit({
            data: { objective: "Verify active workspace & task provenance audit" },
          });
          toast.success(
            `Multi-agent verification ${run.status} (${run.verifications.length} check(s)).`,
          );
          await queryClient.invalidateQueries({ queryKey: ["phase4-work-center"] });
          await q.refetch();
        },
        {
          taskName: "Multi-Agent Provenance Audit",
          workingEmotion: BUDDY_EMOTION_STATES.VERIFYING,
          successEmotion: BUDDY_EMOTION_STATES.SUCCESS,
          successDurationMs: 2500,
        },
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Verification pipeline failed.");
    } finally {
      setActiveAction(null);
    }
  };

  const dagRuns = overview.data?.dagRuns ?? [];

  return (
    <AppShell
      title="Tasks"
      description="Live multi-agent execution, interactive task controls, and full request trace."
    >
      {/* Live Buddy Task Monitor */}
      <div className="panel mb-6 flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <div className="shrink-0">
            <TalkingBuddyCharacter
              state={buddy.emotion}
              stage={buddy.stage}
              size={76}
              interactive={true}
              onTap={() => buddy.poke()}
            />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-foreground">Task Companion State:</span>
              <Badge
                variant={
                  buddy.isError
                    ? "destructive"
                    : buddy.isWorking
                      ? "default"
                      : buddy.isSuccess
                        ? "outline"
                        : "secondary"
                }
                className="font-mono text-xs uppercase"
              >
                {buddy.emotionUpper}
              </Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{buddy.statusMessage}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={activeAction !== null}
            onClick={handleRunDiagnostics}
            className="text-xs"
          >
            <Activity className="mr-1.5 size-3.5 text-primary" />
            Run Diagnostics
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={activeAction !== null}
            onClick={handleRunVerificationPipeline}
            className="text-xs"
          >
            <Sparkles className="mr-1.5 size-3.5 text-accent-foreground" />
            Run Agent Audit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              buddy.setProcessingStage("working", { reason: "Refreshing tasks…" });
              void q.refetch();
              void overview.refetch();
            }}
            className="text-xs"
          >
            <RotateCw className="mr-1.5 size-3.5" />
            Sync
          </Button>
        </div>
      </div>

      {/* Live Multi-Agent Objective Launcher & Execution Monitor */}
      <section className="panel mb-6 p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <Bot className="size-4 text-primary" />
              Live Multi-Agent Task Execution
            </h2>
            <p className="text-xs text-muted-foreground">
              Launch server-side multi-agent DAG objectives and control running steps directly.
            </p>
          </div>
          <span className="text-[11px] text-muted-foreground">
            Active Browser Tab DOM actions: Unavailable in Web Dashboard (use Chrome Extension Side
            Panel)
          </span>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (objectiveInput.trim().length >= 2 && !launchObjective.isPending) {
              launchObjective.mutate();
            }
          }}
          className="flex flex-col gap-2 sm:flex-row"
        >
          <Textarea
            rows={2}
            value={objectiveInput}
            onChange={(e) => setObjectiveInput(e.target.value)}
            placeholder="Enter a task objective (e.g., Research and summarize Q1 workspace metrics or verify pending draft checks)…"
            className="flex-1 text-sm"
          />
          <Button
            type="submit"
            size="sm"
            disabled={launchObjective.isPending || objectiveInput.trim().length < 2}
            className="sm:self-end"
          >
            <Play className="mr-1.5 size-3.5" />
            {launchObjective.isPending ? "Starting…" : "Run Objective"}
          </Button>
        </form>

        {overview.isLoading && <Skeleton className="h-24 w-full" />}

        {dagRuns.length > 0 && (
          <div className="space-y-3">
            {dagRuns.slice(0, 5).map((run) => {
              const completedCount = run.subtasks.filter((s) => s.status === "completed").length;
              const skippedCount = run.subtasks.filter((s) => s.status === "skipped").length;
              const doneTotal = completedCount + skippedCount;
              const pct =
                run.subtasks.length > 0 ? Math.round((doneTotal / run.subtasks.length) * 100) : 0;
              const hasFailed = run.subtasks.some((s) => s.status === "failed");

              return (
                <div key={run.runId} className="rounded-lg border border-border p-4 space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium break-words">{run.objective}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground font-mono tabular-nums">
                        {completedCount}/{run.subtasks.length} completed
                        {skippedCount > 0 ? ` · ${skippedCount} skipped` : ""} · Agents:{" "}
                        {run.selectedAgents.join(", ")}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                      <Badge
                        variant={
                          run.status === "failed"
                            ? "destructive"
                            : run.status === "completed"
                              ? "secondary"
                              : "outline"
                        }
                        className="uppercase text-[10px]"
                      >
                        {run.status}
                      </Badge>
                      {run.status === "running" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs"
                          disabled={controlDagMutation.isPending}
                          onClick={() =>
                            controlDagMutation.mutate({ runId: run.runId, action: "pause" })
                          }
                        >
                          <Pause className="size-3 mr-1" />
                          Pause
                        </Button>
                      )}
                      {run.status === "paused" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs"
                          disabled={controlDagMutation.isPending}
                          onClick={() =>
                            controlDagMutation.mutate({ runId: run.runId, action: "resume" })
                          }
                        >
                          <Play className="size-3 mr-1" />
                          Resume
                        </Button>
                      )}
                      {hasFailed && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs"
                          disabled={controlDagMutation.isPending}
                          onClick={() =>
                            controlDagMutation.mutate({
                              runId: run.runId,
                              action: "retry_failed",
                            })
                          }
                        >
                          <RefreshCw className="size-3 mr-1" />
                          Retry Failed
                        </Button>
                      )}
                      {run.status !== "completed" && run.status !== "cancelled" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs text-destructive"
                          disabled={controlDagMutation.isPending}
                          onClick={() =>
                            controlDagMutation.mutate({ runId: run.runId, action: "cancel" })
                          }
                        >
                          <Square className="size-3 mr-1" />
                          Stop
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Real progress bar */}
                  <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full bg-primary transition-[width] duration-200"
                      style={{ width: `${pct}%` }}
                    />
                  </div>

                  {run.unconfirmedStopNote && (
                    <div className="rounded border border-warning/40 bg-warning/10 p-2 text-xs text-foreground flex items-start gap-2">
                      <ShieldAlert className="size-4 text-warning shrink-0 mt-0.5" />
                      <span>{run.unconfirmedStopNote}</span>
                    </div>
                  )}

                  <ul className="grid gap-1.5 sm:grid-cols-2">
                    {run.subtasks.map((st) => {
                      const canSkip =
                        st.status === "pending" ||
                        st.status === "ready" ||
                        st.status === "paused" ||
                        st.status === "awaiting_approval" ||
                        st.status === "failed";
                      return (
                        <li
                          key={st.id}
                          className="flex items-center justify-between gap-2 rounded border border-border/70 px-2.5 py-1.5 text-xs min-w-0"
                        >
                          <div className="min-w-0">
                            <p className="truncate font-medium">
                              <span className="font-mono text-[10px] text-muted-foreground mr-1.5">
                                [{st.agentId}]
                              </span>
                              {st.title}
                            </p>
                            {st.error && (
                              <p className="text-[11px] text-destructive truncate">{st.error}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {st.status === "awaiting_approval" && (
                              <Button
                                size="sm"
                                variant="secondary"
                                className="h-6 px-2 text-[10px]"
                                disabled={controlDagMutation.isPending}
                                onClick={() =>
                                  controlDagMutation.mutate({
                                    runId: run.runId,
                                    action: "approve_step",
                                    subtaskId: st.id,
                                  })
                                }
                              >
                                Approve
                              </Button>
                            )}
                            {canSkip &&
                              run.status !== "completed" &&
                              run.status !== "cancelled" && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 px-1.5 text-[10px]"
                                  disabled={controlDagMutation.isPending}
                                  onClick={() =>
                                    controlDagMutation.mutate({
                                      runId: run.runId,
                                      action: "skip_step",
                                      subtaskId: st.id,
                                    })
                                  }
                                >
                                  <SkipForward className="size-3 mr-0.5" />
                                  Skip
                                </Button>
                              )}
                            <Badge variant="outline" className="text-[10px]">
                              {st.status}
                            </Badge>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {diagChecks && (
        <div className="panel mb-6 p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Live Backend Diagnostic Checks
          </h2>
          <ul className="grid gap-2 sm:grid-cols-2 text-xs">
            {diagChecks.map((chk) => (
              <li
                key={chk.name}
                className="flex items-center justify-between gap-2 rounded border border-border px-3 py-2"
              >
                <span className="font-medium">{chk.name}</span>
                <span className={chk.ok ? "text-foreground" : "text-destructive"}>
                  {chk.detail}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {q.isLoading && <Skeleton className="h-40 w-full" />}
      {q.isError && (
        <div className="panel p-6 text-sm">
          <p className="text-destructive">Tasks could not load.</p>
          <Button className="mt-3" size="sm" onClick={() => q.refetch()}>
            Try again
          </Button>
        </div>
      )}
      {q.data && q.data.tasks.length === 0 && (
        <p className="text-sm text-muted-foreground">No historical request logs yet.</p>
      )}
      <div className="space-y-3">
        {q.data?.tasks.map(
          (task: {
            id: string;
            title: string;
            status: string;
            created_at: string;
            page_url?: string | null;
            answer?: string | null;
            error?: string | null;
            model?: string | null;
            latency_ms?: number | null;
          }) => (
            <details key={task.id} className="panel p-4">
              <summary className="flex cursor-pointer items-center justify-between gap-3">
                <span className="truncate font-medium">{task.title}</span>
                <span
                  suppressHydrationWarning
                  className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground"
                >
                  {new Date(task.created_at).toLocaleString()}
                  <Badge variant={task.status === "failed" ? "destructive" : "secondary"}>
                    {task.status}
                  </Badge>
                </span>
              </summary>
              <div className="mt-3 space-y-2 text-sm min-w-0">
                {task.page_url && (
                  <p className="truncate text-xs text-muted-foreground">{task.page_url}</p>
                )}
                {task.answer && (
                  <div className="rounded-lg border border-border/60 bg-muted/20 p-3 min-w-0">
                    <ChatMarkdown content={task.answer} variant="assistant" />
                  </div>
                )}
                {task.error && <p className="text-destructive break-words">{task.error}</p>}
                <ol className="mt-2 space-y-1 border-l border-border pl-3 text-xs text-muted-foreground">
                  {q.data.events
                    .filter((e: { task_id: string }) => e.task_id === task.id)
                    .map((e: { phase: string; detail: string | null }, i: number) => (
                      <li key={i}>
                        <span className="font-medium uppercase text-foreground">{e.phase}</span>
                        {e.detail ? ` — ${e.detail}` : ""}
                      </li>
                    ))}
                </ol>
                {task.model && (
                  <p className="text-xs text-muted-foreground">
                    Model: {task.model}
                    {task.latency_ms ? ` · ${task.latency_ms} ms` : ""}
                  </p>
                )}
              </div>
            </details>
          ),
        )}
      </div>
    </AppShell>
  );
}
