/**
 * Public extension endpoint to list recent tasks and record execution progress.
 */

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { verifyBearer } from "@/lib/supabase-bearer.server";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

const postSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(1).max(300),
  intent: z.string().default("multi_action"),
  buddySlug: z.string().optional(),
  pageUrl: z.string().optional(),
  pageTitle: z.string().optional(),
  status: z
    .enum([
      "running",
      "completed",
      "failed",
      "cancelled",
      "paused",
      "awaiting_approval",
      "waiting_for_user_assistance",
    ])
    .default("completed"),
  answer: z.string().optional(),
  error: z.string().optional(),
  latencyMs: z.number().optional(),
  checkpoint: z.record(z.unknown()).optional(),
  needsUserAttention: z.boolean().optional(),
  attentionReason: z.string().optional(),
  idempotencyKey: z.string().optional(),
  steps: z
    .array(
      z.object({
        id: z.string().optional(),
        phase: z.string(),
        detail: z.string().optional(),
        status: z.string().optional(),
        actionHash: z.string().optional(),
      }),
    )
    .optional(),
});

// In-memory guest store for temporary recent tasks during unauthenticated sessions
const guestTasksStore: Array<{
  id: string;
  title: string;
  intent: string;
  buddySlug?: string;
  pageUrl?: string;
  pageTitle?: string;
  status: string;
  answer?: string;
  error?: string;
  latencyMs?: number;
  checkpoint?: Record<string, unknown>;
  needsUserAttention?: boolean;
  attentionReason?: string;
  idempotencyKey?: string;
  created_at: string;
}> = [];

export const Route = createFileRoute("/api/public/extension/tasks")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const requestedTaskId = url.searchParams.get("taskId");

        let auth = null;
        try {
          auth = await verifyBearer(request.headers.get("authorization"));
        } catch {
          auth = null;
        }

        if (auth) {
          if (requestedTaskId) {
            const { data, error } = await auth.db
              .from("tasks")
              .select("id, title, intent, buddy_slug, page_url, page_title, status, answer, error, latency_ms, created_at")
              .eq("id", requestedTaskId)
              .eq("user_id", auth.userId)
              .single();

            if (error || !data) {
              return json({ ok: false, error: "Task not found" }, 404);
            }
            return json({ ok: true, task: data, isGuest: false });
          }

          const { data, error } = await auth.db
            .from("tasks")
            .select("id, title, intent, buddy_slug, page_url, page_title, status, answer, error, latency_ms, created_at")
            .eq("user_id", auth.userId)
            .order("created_at", { ascending: false })
            .limit(20);

          if (error) {
            return json({ ok: false, error: "Failed to fetch tasks", tasks: [] }, 500);
          }

          return json({ ok: true, tasks: data || [], isGuest: false });
        }

        // Guest handling
        if (requestedTaskId) {
          const match = guestTasksStore.find((t) => t.id === requestedTaskId);
          if (!match) {
            return json({ ok: false, error: "Task not found" }, 404);
          }
          return json({ ok: true, task: match, isGuest: true });
        }

        return json({
          ok: true,
          tasks: guestTasksStore.slice(0, 20),
          isGuest: true,
        });
      },

      POST: async ({ request }) => {
        let auth = null;
        try {
          auth = await verifyBearer(request.headers.get("authorization"));
        } catch {
          auth = null;
        }

        let body: z.infer<typeof postSchema>;
        try {
          body = postSchema.parse(await request.json());
        } catch {
          return json({ ok: false, message: "Invalid task data" }, 400);
        }

        const taskId = body.id || `task_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

        if (auth) {
          const { error } = await auth.db.from("tasks").upsert({
            id: taskId,
            user_id: auth.userId,
            title: body.title,
            intent: body.intent,
            buddy_slug: body.buddySlug || "friendly",
            page_url: body.pageUrl || null,
            page_title: body.pageTitle || null,
            status: body.status,
            answer: body.answer || null,
            error: body.error || null,
            latency_ms: body.latencyMs || null,
            updated_at: new Date().toISOString(),
          });

          if (error) {
            console.error("[extension/tasks] db error:", error);
          }

          if (body.steps && body.steps.length > 0) {
            const events = body.steps.map((s) => ({
              task_id: taskId,
              user_id: auth.userId,
              phase: s.phase,
              detail: s.detail || null,
              payload: {
                status: s.status || "completed",
                actionHash: s.actionHash || null,
              },
            }));
            await auth.db.from("task_events").insert(events).catch(() => undefined);
          }

          return json({ ok: true, taskId, status: body.status, checkpoint: body.checkpoint });
        }

        // Guest handling
        const existingIdx = guestTasksStore.findIndex((t) => t.id === taskId);
        const taskEntry = {
          id: taskId,
          title: body.title,
          intent: body.intent,
          buddySlug: body.buddySlug,
          pageUrl: body.pageUrl,
          pageTitle: body.pageTitle,
          status: body.status,
          answer: body.answer,
          error: body.error,
          latencyMs: body.latencyMs,
          checkpoint: body.checkpoint,
          needsUserAttention: body.needsUserAttention,
          attentionReason: body.attentionReason,
          idempotencyKey: body.idempotencyKey,
          created_at: new Date().toISOString(),
        };

        if (existingIdx >= 0) {
          guestTasksStore[existingIdx] = taskEntry;
        } else {
          guestTasksStore.unshift(taskEntry);
          if (guestTasksStore.length > 50) guestTasksStore.pop();
        }

        return json({
          ok: true,
          taskId,
          status: body.status,
          checkpoint: body.checkpoint,
          isGuest: true,
        });
      },
    },
  },
});
