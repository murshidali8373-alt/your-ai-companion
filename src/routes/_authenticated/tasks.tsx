import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";

import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { listTasks } from "@/lib/app.functions";

export const Route = createFileRoute("/_authenticated/tasks")({
  component: Tasks,
});

function Tasks() {
  const load = useServerFn(listTasks);
  const q = useQuery({ queryKey: ["tasks"], queryFn: () => load() });

  return (
    <AppShell title="Tasks" description="Every request with its full trace: observe, understand, verify, recover.">
      {q.isLoading && <Skeleton className="h-40 w-full" />}
      {q.isError && (
        <div className="panel p-6 text-sm">
          <p className="text-destructive">Tasks could not load.</p>
          <Button className="mt-3" size="sm" onClick={() => q.refetch()}>Try again</Button>
        </div>
      )}
      {q.data && q.data.tasks.length === 0 && <p className="text-sm text-muted-foreground">No tasks yet.</p>}
      <div className="space-y-3">
        {q.data?.tasks.map((task) => (
          <details key={task.id} className="panel p-4">
            <summary className="flex cursor-pointer items-center justify-between gap-3">
              <span className="truncate font-medium">{task.title}</span>
              <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                {new Date(task.created_at).toLocaleString()}
                <Badge variant={task.status === "failed" ? "destructive" : "secondary"}>{task.status}</Badge>
              </span>
            </summary>
            <div className="mt-3 space-y-2 text-sm">
              {task.page_url && <p className="truncate text-xs text-muted-foreground">{task.page_url}</p>}
              {task.answer && <p className="whitespace-pre-wrap">{task.answer}</p>}
              {task.error && <p className="text-destructive">{task.error}</p>}
              <ol className="mt-2 space-y-1 border-l border-border pl-3 text-xs text-muted-foreground">
                {q.data.events.filter((e) => e.task_id === task.id).map((e, i) => (
                  <li key={i}><span className="font-medium uppercase text-foreground">{e.phase}</span> — {e.detail}</li>
                ))}
              </ol>
              {task.model && <p className="text-xs text-muted-foreground">Model: {task.model}{task.latency_ms ? ` · ${task.latency_ms} ms` : ""}</p>}
            </div>
          </details>
        ))}
      </div>
    </AppShell>
  );
}
