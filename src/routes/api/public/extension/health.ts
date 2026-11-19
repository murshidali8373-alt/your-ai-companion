/**
 * "Buddy, diagnose yourself." Reports what the extension needs to know without
 * leaking configuration details. Signed-in callers additionally get their own
 * account health.
 */

import { createFileRoute } from "@tanstack/react-router";

import { getGeminiKey, isProviderConfigured } from "@/lib/ai/provider-keys.server";
import {
  extensionJsonResponse,
  handleExtensionOptions,
} from "@/lib/extension-cors.server";
import { verifyBearer } from "@/lib/supabase-bearer.server";

export const Route = createFileRoute("/api/public/extension/health")({
  server: {
    handlers: {
      OPTIONS: async (ctx?: { request?: Request }) => handleExtensionOptions(ctx?.request),
      GET: async (ctx?: { request?: Request }) => {
        const request = ctx?.request;
        const geminiKey = getGeminiKey();
        const hasGemini = Boolean(geminiKey);
        const providerNames = [
          "gemini",
          "lovable-gateway",
          "groq",
          "openrouter",
          "openai",
          "github",
          "cloudflare",
          "huggingface",
          "ollama",
        ] as const;
        const configuredProviders = providerNames.filter((p) => isProviderConfigured(p));
        const hasAnyProvider = configuredProviders.length > 0;

        const checks: Record<string, { ok: boolean; detail: string }> = {
          backend: { ok: false, detail: "not checked" },
          ai: {
            ok: hasAnyProvider,
            detail: hasGemini
              ? "gemini configured"
              : hasAnyProvider
                ? `configured (${configuredProviders.join(", ")})`
                : "not configured — set GEMINI_API_KEY (or GOOGLE_API_KEY) on server or add key in Extension Settings",
          },
          session: { ok: false, detail: "signed out" },
        };

        let auth: Awaited<ReturnType<typeof verifyBearer>> = null;
        try {
          auth = await verifyBearer(request?.headers.get("authorization") ?? null);
        } catch (error) {
          console.error("[extension/health] auth", error);
        }

        if (auth) {
          checks["session"] = { ok: true, detail: "signed in" };
          const { error } = await auth.db
            .from("permission_settings")
            .select("level")
            .eq("user_id", auth.userId)
            .maybeSingle();
          checks["backend"] = error
            ? { ok: false, detail: "database unreachable" }
            : { ok: true, detail: "reachable" };
          const { data: usage } = await auth.db
            .from("usage_counters")
            .select("requests")
            .eq("user_id", auth.userId)
            .order("day", { ascending: false })
            .limit(1)
            .maybeSingle();
          checks["usage"] = {
            ok: true,
            detail: `${usage?.requests ?? 0} requests today`,
          };
        } else {
          checks["backend"] = { ok: true, detail: "reachable" };
        }

        const ok = Object.values(checks).every((c) => c.ok);
        return extensionJsonResponse(
          request,
          {
            ok,
            checks,
            providers: {
              geminiConfigured: hasGemini,
              configuredProviders,
            },
            version: "0.1.0",
          },
          200,
        );
      },
    },
  },
});
