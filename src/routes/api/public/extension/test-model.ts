/**
 * Public extension endpoint to test provider connectivity and measure real latency.
 */

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { verifyProviderConnection } from "@/lib/ai/provider-adapters.server";
import type { ProviderId } from "@/lib/ai/model-hub";
import {
  extensionJsonResponse,
  handleExtensionOptions,
} from "@/lib/extension-cors.server";

const testSchema = z.object({
  provider: z.enum([
    "gemini",
    "groq",
    "openrouter",
    "openai",
    "ollama",
    "huggingface",
    "cloudflare",
    "github",
    "lovable-gateway",
  ]),
  userApiKey: z.string().max(300).optional(),
  customBaseUrl: z.string().max(300).optional(),
});

export const Route = createFileRoute("/api/public/extension/test-model")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => handleExtensionOptions(request),
      POST: async ({ request }) => {
        let body: z.infer<typeof testSchema>;
        try {
          body = testSchema.parse(await request.json());
        } catch {
          return extensionJsonResponse(
            request,
            { ok: false, message: "Invalid provider verification request" },
            400,
          );
        }

        try {
          const result = await verifyProviderConnection(
            body.provider as ProviderId,
            body.userApiKey,
            body.customBaseUrl,
          );
          return extensionJsonResponse(request, result);
        } catch (error) {
          return extensionJsonResponse(request, {
            providerId: body.provider,
            ok: false,
            status: "error",
            latencyMs: 0,
            message: error instanceof Error ? error.message : "Verification failed",
          });
        }
      },
    },
  },
});
