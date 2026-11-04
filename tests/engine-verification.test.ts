import { describe, expect, it, vi } from "vitest";
import { AiError, normalizeProviderError, isFallbackWorthy } from "../src/lib/ai/errors";
import { generate } from "../src/lib/ai/orchestrator.server";
import { findModel, route, type ModelEntry } from "../src/lib/ai/registry";
import { findCatalogModel, MODEL_CATALOG, PROVIDERS } from "../src/lib/ai/model-hub";
import { verifyProviderConnection } from "../src/lib/ai/provider-adapters.server";

describe("Post-Repair Verification: AI Provider Engine", () => {
  describe("Verification 1: Real AI Response & Credential Availability", () => {
    it("reports honest status when server keys are not configured in environment", async () => {
      vi.stubEnv("GEMINI_API_KEY", "");
      vi.stubEnv("GOOGLE_API_KEY", "");
      const geminiCheck = await verifyProviderConnection("gemini");
      vi.unstubAllEnvs();
      expect(geminiCheck.ok).toBe(false);
      expect(geminiCheck.status).toBe("needs_key");
      expect(geminiCheck.message).toContain("GEMINI_API_KEY");
    });
  });

  describe("Verification 2: Fallback Scenarios", () => {
    const mockPreferred: ModelEntry = {
      id: "groq/llama-3.3-70b",
      provider: "groq",
      api: "custom_adapter",
      vision: false,
      contextTokens: 131_072,
      cost: 0,
      speed: 5,
    };

    const mockAlternative: ModelEntry = {
      id: "gemini-3.8-flash",
      provider: "gemini",
      api: "chat",
      vision: true,
      contextTokens: 1_000_000,
      cost: 2,
      speed: 1,
    };

    it("Scenario A: Preferred provider succeeds (no fallback)", async () => {
      const result = await generate({
        system: "sys",
        user: "hello",
        routing: {
          intent: "answer",
          needsVision: false,
          contextTokens: 100,
          latencySensitive: false,
          costSensitive: false,
        },
        candidates: [mockPreferred, mockAlternative],
        call: async (m) => `Response from ${m.id}`,
      });

      expect(result.text).toBe("Response from groq/llama-3.3-70b");
      expect(result.model).toBe("groq/llama-3.3-70b");
      expect(result.provider).toBe("groq");
      expect(result.attempts).toBe(1);
      expect(result.fellBack).toBe(false);
    });

    it("Scenario B: Preferred provider has missing key -> falls back to alternative", async () => {
      const result = await generate({
        system: "sys",
        user: "hello",
        routing: {
          intent: "answer",
          needsVision: false,
          contextTokens: 100,
          latencySensitive: false,
          costSensitive: false,
        },
        candidates: [mockPreferred, mockAlternative],
        call: async (m) => {
          if (m.provider === "groq") {
            throw new AiError("auth", "Missing Groq API key", { provider: "groq" });
          }
          return `Fallback response from ${m.id}`;
        },
      });

      expect(result.text).toBe("Fallback response from gemini-3.8-flash");
      expect(result.model).toBe("gemini-3.8-flash");
      expect(result.provider).toBe("gemini");
      expect(result.fellBack).toBe(true);
      expect(result.attempts).toBe(2);
    });

    it("Scenario C: Preferred provider has invalid key -> normalizes & falls back", async () => {
      const result = await generate({
        system: "sys",
        user: "hello",
        routing: {
          intent: "answer",
          needsVision: false,
          contextTokens: 100,
          latencySensitive: false,
          costSensitive: false,
        },
        candidates: [mockPreferred, mockAlternative],
        call: async (m) => {
          if (m.provider === "groq") {
            const rawError = new Error("HTTP 401: Invalid API Key provided");
            throw normalizeProviderError(rawError, "groq");
          }
          return `Fallback from ${m.id}`;
        },
      });

      expect(result.fellBack).toBe(true);
      expect(result.provider).toBe("gemini");
      expect(result.model).toBe("gemini-3.8-flash");
    });

    it("Scenario D: Preferred provider is rate limited -> pauses & falls back", async () => {
      const result = await generate({
        system: "sys",
        user: "hello",
        routing: {
          intent: "answer",
          needsVision: false,
          contextTokens: 100,
          latencySensitive: false,
          costSensitive: false,
        },
        candidates: [mockPreferred, mockAlternative],
        call: async (m) => {
          if (m.provider === "groq") {
            throw new AiError("rate_limit", "Rate limit reached", {
              provider: "groq",
              retryAfterSeconds: 0,
            });
          }
          return `Fallback after rate limit from ${m.id}`;
        },
      });

      expect(result.fellBack).toBe(true);
      expect(result.provider).toBe("gemini");
    });

    it("Scenario E: Preferred provider is unavailable (outage/network) -> falls back", async () => {
      const result = await generate({
        system: "sys",
        user: "hello",
        routing: {
          intent: "answer",
          needsVision: false,
          contextTokens: 100,
          latencySensitive: false,
          costSensitive: false,
        },
        candidates: [mockPreferred, mockAlternative],
        call: async (m) => {
          if (m.provider === "groq") {
            throw new AiError("outage", "Groq service unavailable (503)", {
              provider: "groq",
            });
          }
          return `Fallback after outage from ${m.id}`;
        },
      });

      expect(result.fellBack).toBe(true);
      expect(result.provider).toBe("gemini");
    });
  });

  describe("Verification 3: User API Key Privacy & Isolation", () => {
    it("ensures user key is dispatched only to intended provider and not leaked to fallback", async () => {
      const candidates: ModelEntry[] = [
        {
          id: "llama-3.3-70b-versatile",
          provider: "groq",
          api: "custom_adapter",
          vision: false,
          contextTokens: 131_072,
          cost: 0,
          speed: 5,
        },
        {
          id: "gemini-3.8-flash",
          provider: "gemini",
          api: "chat",
          vision: true,
          contextTokens: 1_000_000,
          cost: 2,
          speed: 1,
        },
      ];

      const recordedCalls: Array<{
        provider: string;
        options?: { userApiKey?: string; customBaseUrl?: string };
      }> = [];

      await generate({
        system: "sys",
        user: "test",
        routing: {
          intent: "answer",
          needsVision: false,
          contextTokens: 100,
          latencySensitive: false,
          costSensitive: false,
        },
        candidates,
        userApiKey: "gsk_secret_user_key_9999",
        userProvider: "groq",
        call: async (model, _sys, _usr, options) => {
          recordedCalls.push({ provider: model.provider, options });
          if (model.provider === "groq") {
            throw new AiError("auth", "Groq authentication failed", { provider: "groq" });
          }
          return "ok from fallback";
        },
      });

      expect(recordedCalls.length).toBe(2);
      // Primary got user key
      expect(recordedCalls[0].provider).toBe("groq");
      expect(recordedCalls[0].options?.userApiKey).toBe("gsk_secret_user_key_9999");
      // Secondary fallback did NOT receive Groq user key
      expect(recordedCalls[1].provider).toBe("gemini");
      expect(recordedCalls[1].options?.userApiKey).toBeUndefined();
    });

    it("does not expose API keys in execution trace when all providers fail", async () => {
      const candidates: ModelEntry[] = [
        {
          id: "llama-3.3-70b-versatile",
          provider: "groq",
          api: "custom_adapter",
          vision: false,
          contextTokens: 131_072,
          cost: 0,
          speed: 5,
        },
      ];

      try {
        await generate({
          system: "sys",
          user: "test",
          routing: {
            intent: "answer",
            needsVision: false,
            contextTokens: 100,
            latencySensitive: false,
            costSensitive: false,
          },
          candidates,
          userApiKey: "gsk_super_secret_key_888",
          userProvider: "groq",
          call: async () => {
            throw new AiError("auth", "Invalid key provided", { provider: "groq" });
          },
        });
        expect.unreachable("Should fail");
      } catch (err: unknown) {
        const errorWithTrace = err as Error & {
          executionTrace?: Array<{ model: string; provider: string; error: string; kind: string }>;
        };
        const serialized = JSON.stringify(errorWithTrace.executionTrace);
        expect(serialized).not.toContain("gsk_super_secret_key_888");
        expect(errorWithTrace.executionTrace?.[0].error).toBe("Invalid key provided");
      }
    });
  });

  describe("Verification 4: Model Hub & Catalog Resolution", () => {
    it("resolves catalog models to their appropriate provider adapters", () => {
      const groqEntry = findModel("llama-3.3-70b-versatile");
      expect(groqEntry).toBeDefined();
      expect(groqEntry?.provider).toBe("groq");
      expect(groqEntry?.api).toBe("custom_adapter");

      const geminiEntry = findModel("gemini-3.8-flash");
      expect(geminiEntry).toBeDefined();
      expect(geminiEntry?.provider).toBe("gemini");

      const openRouterEntry = findModel("meta-llama/llama-3.3-70b-instruct:free");
      expect(openRouterEntry).toBeDefined();
      expect(openRouterEntry?.provider).toBe("openrouter");
    });

    it("rejects unknown models gracefully", () => {
      const unknown = findModel("unknown-model-xyz-12345");
      expect(unknown).toBeUndefined();
    });

    it("does not falsely claim providers are connected when keys are absent", () => {
      const providers = Object.keys(PROVIDERS);
      expect(providers.length).toBeGreaterThanOrEqual(8);
      // Providers that require keys have requiresKey: true
      expect(PROVIDERS.gemini.requiresKey).toBe(true);
      expect(PROVIDERS.groq.requiresKey).toBe(true);
      expect(PROVIDERS.openai.requiresKey).toBe(true);
      expect(PROVIDERS.openrouter.requiresKey).toBe(true);
    });
  });
});
