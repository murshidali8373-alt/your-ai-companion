/**
 * Public extension endpoint to fetch, add, and delete memories & user preferences.
 */

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  extensionJsonResponse,
  handleExtensionOptions,
} from "@/lib/extension-cors.server";
import { verifyBearer } from "@/lib/supabase-bearer.server";

const memorySchema = z.object({
  id: z.string().optional(),
  key: z.string().min(1).max(100),
  value: z.string().min(1).max(2000),
  kind: z.string().default("user_preference"),
  source: z.string().default("extension"),
  scope: z.enum(["short_term", "long_term"]).default("long_term"),
  instructionContext: z.string().max(500).optional(),
});

// Ephemeral guest memories
const guestMemoriesStore: Array<{
  id: string;
  key: string;
  value: string;
  kind: string;
  source: string;
  scope?: "short_term" | "long_term";
  outdated?: boolean;
  created_at: string;
}> = [
  {
    id: "guest_mem_1",
    key: "preferred_language",
    value: "Hinglish / English friendly mix",
    kind: "communication_preference",
    source: "default",
    scope: "long_term",
    created_at: new Date().toISOString(),
  },
  {
    id: "guest_mem_2",
    key: "ecommerce_platform",
    value: "Meesho & Amazon Seller Central",
    kind: "business_context",
    source: "default",
    scope: "long_term",
    created_at: new Date().toISOString(),
  },
];

export const Route = createFileRoute("/api/public/extension/memories")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => handleExtensionOptions(request),
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
            return extensionJsonResponse(request, { ok: false, error: "Failed to fetch memories", memories: [] }, 500);
          }

          return extensionJsonResponse(request, { ok: true, memories: data || [], isGuest: false });
        }

        return extensionJsonResponse(request, {
          ok: true,
          memories: guestMemoriesStore.filter((m) => !m.outdated),
          isGuest: true,
        });
      },

      POST: async ({ request }) => {
        const {
          detectDoNotRememberCommand,
          validateMemoryEntry,
        } = await import("@/lib/engines/memory-engine");

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
          return extensionJsonResponse(request, { ok: false, message: "Invalid memory payload" }, 400);
        }

        if (body.instructionContext && detectDoNotRememberCommand(body.instructionContext)) {
          return extensionJsonResponse(
            request,
            { ok: false, message: "Not saved: respected your 'do not remember' instruction." },
            400,
          );
        }

        const validation = validateMemoryEntry(body.key, body.value);
        if (!validation.valid) {
          return extensionJsonResponse(
            request,
            { ok: false, message: validation.reason || "Memory rejected by security policy." },
            400,
          );
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
            return extensionJsonResponse(request, { ok: false, error: error.message }, 500);
          }

          return extensionJsonResponse(request, { ok: true, memory: data });
        }

        // Guest store with duplicate / outdated handling
        const existingIdx = guestMemoriesStore.findIndex(
          (m) => !m.outdated && m.key.toLowerCase() === body.key.trim().toLowerCase(),
        );
        const memItem = {
          id,
          key: body.key.trim(),
          value: body.value.trim(),
          kind: body.kind,
          source: body.source,
          scope: body.scope,
          created_at: new Date().toISOString(),
        };

        let deduplicated = false;
        let replacedOutdated = false;
        if (existingIdx >= 0) {
          if (guestMemoriesStore[existingIdx]!.value.toLowerCase() === memItem.value.toLowerCase()) {
            deduplicated = true;
            return extensionJsonResponse(request, {
              ok: true,
              memory: guestMemoriesStore[existingIdx],
              deduplicated,
              isGuest: true,
            });
          }
          guestMemoriesStore[existingIdx]!.outdated = true;
          replacedOutdated = true;
        }
        guestMemoriesStore.unshift(memItem);

        return extensionJsonResponse(request, {
          ok: true,
          memory: memItem,
          replacedOutdated,
          isGuest: true,
        });
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
          return extensionJsonResponse(request, { ok: false, message: "Must provide memory id or key to delete" }, 400);
        }

        if (auth) {
          let query = auth.db.from("memories").delete().eq("user_id", auth.userId);
          if (id) {
            query = query.eq("id", id);
          } else if (key) {
            query = query.eq("key", key);
          }

          const { error } = await query;
          if (error) return extensionJsonResponse(request, { ok: false, error: error.message }, 500);
          return extensionJsonResponse(request, { ok: true, deleted: true });
        }

        // Guest store deletion
        const idx = guestMemoriesStore.findIndex((m) => (id && m.id === id) || (key && m.key === key));
        if (idx >= 0) {
          guestMemoriesStore.splice(idx, 1);
        }

        return extensionJsonResponse(request, { ok: true, deleted: true, isGuest: true });
      },
    },
  },
});
