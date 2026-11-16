/**
 * Public extension endpoint to discover available AI models, active providers,
 * and current fallback sequencing.
 * Does NOT leak API keys.
 */

import { createFileRoute } from "@tanstack/react-router";
import { MODEL_CATALOG, PROVIDERS, type ProviderId } from "@/lib/ai/model-hub";
import { isProviderConfigured } from "@/lib/ai/provider-keys.server";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

export const Route = createFileRoute("/api/public/extension/models")({
  server: {
    handlers: {
      GET: async () => {
        const providerStatuses: Array<{
          id: ProviderId;
          name: string;
          configured: boolean;
          status: "connected" | "missing_api" | "not_connected";
          statusLabel: "Connected" | "Missing API" | "Not Connected";
          missingKeyName?: string;
          isDefault: boolean;
          freeTier: boolean;
          supportsLocal: boolean;
          rateLimitNote: string;
        }> = Object.values(PROVIDERS)
          .filter((p) => p.id !== "lovable-gateway")
          .sort((a, b) => (a.id === "gemini" ? -1 : b.id === "gemini" ? 1 : 0))
          .map((p) => {
            const configured = isProviderConfigured(p.id);
            const status = configured
              ? "connected"
              : p.supportsLocal
                ? "not_connected"
                : "missing_api";
            const statusLabel = configured
              ? "Connected"
              : p.supportsLocal
                ? "Not Connected"
                : "Missing API";
            return {
              id: p.id,
              name: p.name,
              configured,
              status,
              statusLabel,
              missingKeyName: configured
                ? undefined
                : p.supportsLocal
                  ? "Local Ollama Server (OLLAMA_BASE_URL)"
                  : p.envKeyName,
              isDefault: p.id === "gemini",
              freeTier: p.freeTierAvailable,
              supportsLocal: p.supportsLocal,
              rateLimitNote: p.rateLimitNote,
            };
          });

        // Curate top 30 featured models for side panel dropdown
        const featuredModels = MODEL_CATALOG.slice(0, 35).map((m) => ({
          id: m.id,
          name: m.name,
          provider: m.provider,
          tier: m.tier,
          capabilities: m.capabilities,
          speedRating: m.speedRating,
          costRating: m.costRating,
          recommendedUse: m.recommendedUse,
          isDefault: Boolean(m.isDefault),
        }));

        const fallbackSequence = [
          "gemini-4-hydrogen",
          "gemini-3.8-flash",
          "groq-llama-3.3-70b",
          "openrouter-free-gemini-2.0-flash",
          "lovable-gateway",
        ];

        return json({
          ok: true,
          defaultProvider: "gemini",
          defaultModel: "gemini-3.8-flash",
          providers: providerStatuses,
          models: featuredModels,
          totalAvailableCount: MODEL_CATALOG.length,
          fallbackSequence,
        });
      },
    },
  },
});
