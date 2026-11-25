/**
 * Public extension endpoint to fetch, add, and delete memories & user preferences.
 */

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  extensionJsonResponse,
  handleExtensionOptions,
} from "@/lib/extension-cors.server";
import {
  readScopedCollection,
  updateScopedCollection,
} from "@/lib/persistence/store.server";
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

interface StoredGuestMemory {
  id: string;
  key: string;
  value: string;
  kind: string;
  source: string;
  scope?: "short_term" | "long_term";
  outdated?: boolean;
  created_at: string;
}

function getDefaultGuestMemories(): StoredGuestMemory[] {
  const now = new Date().toISOString();
  return [
    {
      id: "guest_mem_1",
      key: "preferred_language",
      value: "Hinglish / English friendly mix",
      kind: "communication_preference",
      source: "default",
      scope: "long_term",
      created_at: now,
    },
    {
      id: "guest_mem_2",
      key: "ecommerce_platform",
      value: "Meesho & Amazon Seller Central",
      kind: "business_context",
      source: "default",
      scope: "long_term",
      created_at: now,
    },
  ];
}

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
            return extensionJsonResponse(
              request,
              { ok: false, error: "Failed to fetch memories", memories: [] },
              500,
            );
          }

          return extensionJsonResponse(request, { ok: true, memories: data || [], isGuest: false });
        }

        const stored = await readScopedCollection<StoredGuestMemory[]>(
          "guest",
          "memories",
          getDefaultGuestMemories(),
        );
        return extensionJsonResponse(request, {
          ok: true,
          memories: stored.filter((m) => !m.outdated),
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
                key: body.key.trim(),
                value: body.value.trim(),
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

        const memItem: StoredGuestMemory = {
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
        let resolvedMemory: StoredGuestMemory = memItem;

        await updateScopedCollection<StoredGuestMemory[]>(
          "guest",
          "memories",
          getDefaultGuestMemories(),
          (current) => {
            const active = current.filter((m) => !m.outdated);
            const existingIdx = active.findIndex(
              (m) => m.key.toLowerCase() === memItem.key.toLowerCase(),
            );
            if (existingIdx >= 0) {
              const existing = active[existingIdx]!;
              if (existing.value.toLowerCase() === memItem.value.toLowerCase()) {
                deduplicated = true;
                resolvedMemory = existing;
                return active;
              }
              replacedOutdated = true;
              const remaining = active.filter((_, idx) => idx !== existingIdx);
              return [memItem, ...remaining].slice(0, 100);
            }
            return [memItem, ...active].slice(0, 100);
          },
        );

        if (deduplicated) {
          return extensionJsonResponse(request, {
            ok: true,
            memory: resolvedMemory,
            deduplicated: true,
            isGuest: true,
          });
        }

        return extensionJsonResponse(request, {
          ok: true,
          memory: resolvedMemory,
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
          return extensionJsonResponse(
            request,
            { ok: false, message: "Must provide memory id or key to delete" },
            400,
          );
        }

        if (auth) {
          let query = auth.db.from("memories").delete().eq("user_id", auth.userId);
          if (id) {
            query = query.eq("id", id);
          } else if (key) {
            query = query.eq("key", key);
          }

          const { data, error } = await query.select("id");
          if (error) {
            return extensionJsonResponse(request, { ok: false, error: error.message }, 500);
          }
          if (!data || data.length === 0) {
            return extensionJsonResponse(
              request,
              { ok: false, deleted: false, message: "Memory not found." },
              404,
            );
          }
          return extensionJsonResponse(request, { ok: true, deleted: true });
        }

        let removed = false;
        await updateScopedCollection<StoredGuestMemory[]>(
          "guest",
          "memories",
          getDefaultGuestMemories(),
          (current) => {
            const idx = current.findIndex((m) => (id && m.id === id) || (key && m.key === key));
            if (idx < 0) return current;
            removed = true;
            return current.filter((_, i) => i !== idx);
          },
        );

        if (!removed) {
          return extensionJsonResponse(
            request,
            { ok: false, deleted: false, message: "Memory not found.", isGuest: true },
            404,
          );
        }

        return extensionJsonResponse(request, { ok: true, deleted: true, isGuest: true });
      },
    },
  },
});
