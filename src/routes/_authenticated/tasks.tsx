import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Play, RotateCw, CheckCircle2, AlertTriangle, Activity, Sparkles } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  TalkingBuddyCharacter,
  type TalkingBuddyState,
} from "@/components/talking-buddy-character";
import { useBuddyStateManager, BUDDY_EMOTION_STATES } from "@/hooks/use-buddy-state-manager";
import { listTasks } from "@/lib/app.functions";

export const Route = createFileRoute("/_authenticated/tasks")({
  component: Tasks,
});

function Tasks() {
  const load = useServerFn(listTasks);
  const q = useQuery({ queryKey: ["tasks"], queryFn: () => load() });
  const buddy = useBuddyStateManager(BUDDY_EMOTION_STATES.IDLE);
  const [activeSimulation, setActiveSimulation] = useState<string | null>(null);

  const { setEmotion } = buddy;

  // Sync query loading and error states to Buddy's emotional state
  useEffect(() => {
    if (q.isLoading) {
      setEmotion(BUDDY_EMOTION_STATES.WORKING, {
        reason: "Observing task execution trace…",
      });
    } else if (q.isError) {
      setEmotion(BUDDY_EMOTION_STATES.ERROR, {
        reason: "Failed to load task history.",
      });
    } else if (q.data) {
      const hasFailed = q.data.tasks.some((t: { status: string }) => t.status === "failed");
      if (hasFailed) {
        setEmotion(BUDDY_EMOTION_STATES.CONFUSED, {
          durationMs: 3000,
          revertTo: BUDDY_EMOTION_STATES.IDLE,
          reason: "Noted previous task errors in log.",
        });
      } else if (q.data.tasks.length > 0) {
        setEmotion(BUDDY_EMOTION_STATES.HAPPY, {
          durationMs: 2000,
          revertTo: BUDDY_EMOTION_STATES.IDLE,
          reason: "Tasks are healthy and synced.",
        });
      }
    }
  }, [q.isLoading, q.isError, q.data, setEmotion]);

  // Execute a task action with automatic emotion transition
  const handleSimulateTask = async (taskName: string) => {
    setActiveSimulation(taskName);
    try {
      await buddy.runTask(
        async () => {
          // Simulate multi-phase task execution (DOM observe -> process -> complete)
          await new Promise((r) => setTimeout(r, 1200));
        },
        {
          taskName,
          workingEmotion: BUDDY_EMOTION_STATES.WORKING,
          successEmotion: BUDDY_EMOTION_STATES.SUCCESS,
          successDurationMs: 2500,
        },
      );
    } finally {
      setActiveSimulation(null);
    }
  };

  return (
    <AppShell
      title="Tasks"
      description="Every request with its full trace: observe, understand, verify, recover."
    >
      {/* Live Buddy Task Monitor */}
      <div className="panel mb-6 flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <div className="shrink-0">
            <TalkingBuddyCharacter
              state={buddy.emotion}
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
            disabled={activeSimulation !== null}
            onClick={() => handleSimulateTask("Page DOM Snapshot")}
            className="text-xs"
          >
            <Activity className="mr-1.5 size-3.5 text-primary" />
            Snapshot DOM
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={activeSimulation !== null}
            onClick={() => handleSimulateTask("Form Autofill Audit")}
            className="text-xs"
          >
            <Sparkles className="mr-1.5 size-3.5 text-accent-foreground" />
            Verify Form
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              buddy.setEmotion(BUDDY_EMOTION_STATES.WORKING, { reason: "Refreshing tasks…" });
              void q.refetch();
            }}
            className="text-xs"
          >
            <RotateCw className="mr-1.5 size-3.5" />
            Sync
          </Button>
        </div>
      </div>
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
        <p className="text-sm text-muted-foreground">No tasks yet.</p>
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
              <div className="mt-3 space-y-2 text-sm">
                {task.page_url && (
                  <p className="truncate text-xs text-muted-foreground">{task.page_url}</p>
                )}
                {task.answer && <p className="whitespace-pre-wrap">{task.answer}</p>}
                {task.error && <p className="text-destructive">{task.error}</p>}
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
