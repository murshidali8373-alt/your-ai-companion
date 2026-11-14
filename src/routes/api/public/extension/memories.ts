/**
 * Public extension endpoint to fetch, add, and delete memories & user preferences.
 */

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { verifyBearer } from "@/lib/supabase-bearer.server";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

const memorySchema = z.object({
  id: z.string().optional(),
  key: z.string().min(1).max(100),
  value: z.string().min(1).max(2000),
  kind: z.string().default("preference"),
  source: z.string().default("extension"),
});

// Ephemeral guest memories
const guestMemoriesStore: Array<{
  id: string;
  key: string;
  value: string;
  kind: string;
  source: string;
  created_at: string;
}> = [
  {
    id: "guest_mem_1",
    key: "preferred_language",
    value: "Hinglish / English friendly mix",
    kind: "preference",
    source: "default",
    created_at: new Date().toISOString(),
  },
  {
    id: "guest_mem_2",
    key: "ecommerce_platform",
    value: "Meesho & Amazon Seller Central",
    kind: "workflow",
    source: "default",
    created_at: new Date().toISOString(),
  },
];

export const Route = createFileRoute("/api/public/extension/memories")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        let auth = null;
        try {
          auth = await verifyBearer(request.headers.get("authorization"));
        } catch {
          auth = null;
        }

        if (auth) {
          const { data, error } = await auth.db
            .from("memories")
            .select("id, key, value, kind, source, created_at, updated_at")
            .eq("user_id", auth.userId)
            .order("updated_at", { ascending: false });

          if (error) {
            return json({ ok: false, error: "Failed to fetch memories", memories: [] }, 500);
          }

          return json({ ok: true, memories: data || [], isGuest: false });
        }

        return json({
          ok: true,
          memories: guestMemoriesStore,
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

        let body: z.infer<typeof memorySchema>;
        try {
          body = memorySchema.parse(await request.json());
        } catch {
          return json({ ok: false, message: "Invalid memory payload" }, 400);
        }

        const id = body.id || globalThis.crypto.randomUUID();

        if (auth) {
          const { data, error } = await auth.db
            .from("memories")
            .upsert(
              {
                id,
                user_id: auth.userId,
                key: body.key,
                value: body.value,
                kind: body.kind,
                source: body.source,
                updated_at: new Date().toISOString(),
              },
              { onConflict: "user_id,key" },
            )
            .select()
            .single();

          if (error) {
            return json({ ok: false, error: error.message }, 500);
          }

          return json({ ok: true, memory: data });
        }

        // Guest store
        const existingIdx = guestMemoriesStore.findIndex((m) => m.key === body.key);
        const memItem = {
          id,
          key: body.key,
          value: body.value,
          kind: body.kind,
          source: body.source,
          created_at: new Date().toISOString(),
        };

        if (existingIdx >= 0) {
          guestMemoriesStore[existingIdx] = memItem;
        } else {
          guestMemoriesStore.unshift(memItem);
        }

        return json({ ok: true, memory: memItem, isGuest: true });
      },

      DELETE: async ({ request }) => {
        let auth = null;
        try {
          auth = await verifyBearer(request.headers.get("authorization"));
        } catch {
          auth = null;
        }

        const url = new URL(request.url);
        const id = url.searchParams.get("id");
        const key = url.searchParams.get("key");

        if (!id && !key) {
          return json({ ok: false, message: "Must provide memory id or key to delete" }, 400);
        }

        if (auth) {
          let query = auth.db.from("memories").delete().eq("user_id", auth.userId);
          if (id) {
            query = query.eq("id", id);
          } else if (key) {
            query = query.eq("key", key);
          }

          const { error } = await query;
          if (error) return json({ ok: false, error: error.message }, 500);
          return json({ ok: true, deleted: true });
        }

        // Guest store deletion
        const idx = guestMemoriesStore.findIndex((m) => (id && m.id === id) || (key && m.key === key));
        if (idx >= 0) {
          guestMemoriesStore.splice(idx, 1);
        }

        return json({ ok: true, deleted: true, isGuest: true });
      },
    },
  },
});
