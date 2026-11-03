import { describe, expect, it } from "vitest";
import { AiError, isFallbackWorthy, normalizeProviderError } from "../src/lib/ai/errors";
import { generate } from "../src/lib/ai/orchestrator.server";
import { route, type ModelEntry } from "../src/lib/ai/registry";

describe("Phase 1: Provider Authentication & Fallback", () => {
  it("treats auth and credits failures as fallback-worthy across providers", () => {
    expect(isFallbackWorthy(new AiError("auth", "Missing API key"))).toBe(true);
    expect(isFallbackWorthy(new AiError("credits", "Quota exhausted"))).toBe(true);
    expect(isFallbackWorthy(new AiError("rate_limit", "Rate limited"))).toBe(true);
    expect(isFallbackWorthy(new AiError("outage", "Service down"))).toBe(true);
    expect(isFallbackWorthy(new AiError("timeout", "Request timed out"))).toBe(true);
    expect(isFallbackWorthy(new AiError("network", "Connection refused"))).toBe(true);
    expect(isFallbackWorthy(new AiError("bad_request", "Invalid JSON syntax"))).toBe(false);
  });

  it("normalizes Google GenAI API key errors into typed auth AiError with resolution guidance", () => {
    const rawGoogleError = new Error(
      '{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT"}}',
    );
    const normalized = normalizeProviderError(rawGoogleError, "gemini");
    expect(normalized).toBeInstanceOf(AiError);
    expect(normalized.kind).toBe("auth");
    expect(normalized.provider).toBe("gemini");
    expect(normalized.userMessage).toContain("authentication failed");
    expect(normalized.resolution).toContain("Settings > AI Model Hub");
  });

  it("falls back to secondary provider when primary provider has an authentication error", async () => {
    const candidates: ModelEntry[] = [
      {
        id: "gemini-3.8-flash",
        provider: "gemini",
        api: "chat",
        vision: true,
        contextTokens: 1_000_000,
        cost: 2,
        speed: 1,
      },
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

    const result = await generate({
      system: "You are a test assistant.",
      user: "ping",
      routing: {
        intent: "answer",
        needsVision: false,
        contextTokens: 100,
        latencySensitive: false,
        costSensitive: false,
      },
      candidates,
      call: async (model) => {
        if (model.provider === "gemini") {
          throw new AiError("auth", "API key not valid", { provider: "gemini" });
        }
        return "pong from groq";
      },
    });

    expect(result.text).toBe("pong from groq");
    expect(result.provider).toBe("groq");
    expect(result.model).toBe("llama-3.3-70b-versatile");
    expect(result.fellBack).toBe(true);
    expect(result.attempts).toBe(2);
  });

  it("does not repeat attempts on the same provider once an auth failure occurs", async () => {
    const candidates: ModelEntry[] = [
      {
        id: "gemini-3.8-flash",
        provider: "gemini",
        api: "chat",
        vision: true,
        contextTokens: 1_000_000,
        cost: 2,
        speed: 1,
      },
      {
        id: "gemini-3.1-flash-lite",
        provider: "gemini", // same provider!
        api: "chat",
        vision: false,
        contextTokens: 500_000,
        cost: 1,
        speed: 1,
      },
      {
        id: "claude-3.5-sonnet",
        provider: "openrouter",
        api: "custom_adapter",
        vision: true,
        contextTokens: 200_000,
        cost: 3,
        speed: 3,
      },
    ];

    const attemptedModels: string[] = [];
    const result = await generate({
      system: "Test system",
      user: "Test user",
      routing: {
        intent: "answer",
        needsVision: false,
        contextTokens: 100,
        latencySensitive: false,
        costSensitive: false,
      },
      candidates,
      call: async (model) => {
        attemptedModels.push(model.id);
        if (model.provider === "gemini") {
          throw new AiError("auth", "Gemini key invalid", { provider: "gemini" });
        }
        return "reply from openrouter";
      },
    });

    // gemini-3.8-flash was attempted, gemini-3.1-flash-lite was skipped because gemini already failed auth,
    // and claude-3.5-sonnet on openrouter succeeded!
    expect(attemptedModels).toEqual(["gemini-3.8-flash", "claude-3.5-sonnet"]);
    expect(result.provider).toBe("openrouter");
  });

  it("attaches full execution trace when all candidate providers fail", async () => {
    const candidates: ModelEntry[] = [
      {
        id: "gemini-3.8-flash",
        provider: "gemini",
        api: "chat",
        vision: true,
        contextTokens: 1_000_000,
        cost: 2,
        speed: 1,
      },
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
        user: "hi",
        routing: {
          intent: "answer",
          needsVision: false,
          contextTokens: 100,
          latencySensitive: false,
          costSensitive: false,
        },
        candidates,
        call: async (model) => {
          throw new AiError("auth", `${model.provider} key missing`, { provider: model.provider });
        },
      });
      expect.unreachable("Should have thrown error");
    } catch (err: unknown) {
      const errorWithTrace = err as Error & {
        executionTrace?: Array<{ provider: string; kind: string }>;
      };
      expect(errorWithTrace).toBeInstanceOf(AiError);
      expect(errorWithTrace.executionTrace).toBeDefined();
      expect(errorWithTrace.executionTrace?.length).toBe(2);
      expect(errorWithTrace.executionTrace?.[0].provider).toBe("gemini");
      expect(errorWithTrace.executionTrace?.[1].provider).toBe("groq");
    }
  });

  it("forwards userApiKey and customBaseUrl to the target provider call", async () => {
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

    let receivedOptions: { userApiKey?: string; customBaseUrl?: string } | undefined;

    const result = await generate({
      system: "sys",
      user: "hi",
      routing: {
        intent: "answer",
        needsVision: false,
        contextTokens: 100,
        latencySensitive: false,
        costSensitive: false,
      },
      candidates,
      userApiKey: "gsk_test_user_key_12345",
      customBaseUrl: "https://custom.groq.internal/v1",
      userProvider: "groq",
      call: async (_model, _sys, _usr, options) => {
        receivedOptions = options;
        return "reply from custom groq";
      },
    });

    expect(result.text).toBe("reply from custom groq");
    expect(receivedOptions?.userApiKey).toBe("gsk_test_user_key_12345");
    expect(receivedOptions?.customBaseUrl).toBe("https://custom.groq.internal/v1");
  });

  it("does not leak primary provider userApiKey to fallback provider", async () => {
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

    const calls: Array<{ provider: string; options?: { userApiKey?: string } }> = [];

    const result = await generate({
      system: "sys",
      user: "hi",
      routing: {
        intent: "answer",
        needsVision: false,
        contextTokens: 100,
        latencySensitive: false,
        costSensitive: false,
      },
      candidates,
      userApiKey: "gsk_user_groq_key",
      userProvider: "groq",
      call: async (model, _sys, _usr, options) => {
        calls.push({ provider: model.provider, options });
        if (model.provider === "groq") {
          throw new AiError("auth", "Groq user key invalid", { provider: "groq" });
        }
        return "gemini response";
      },
    });

    expect(result.text).toBe("gemini response");
    expect(calls.length).toBe(2);
    expect(calls[0].provider).toBe("groq");
    expect(calls[0].options?.userApiKey).toBe("gsk_user_groq_key");
    expect(calls[1].provider).toBe("gemini");
    expect(calls[1].options?.userApiKey).toBeUndefined(); // Did not leak Groq key to Gemini!
  });

  it("Phase 3: route() draws candidates from MODEL_CATALOG with provider diversity", () => {
    const candidates = route({
      intent: "answer",
      needsVision: false,
      contextTokens: 1000,
      latencySensitive: false,
      costSensitive: false,
    });

    expect(candidates.length).toBeGreaterThanOrEqual(10);
    // Top candidates contain distinct providers to prevent single-provider lock-in
    const topProviders = candidates.slice(0, 4).map((c) => c.provider);
    const uniqueTopProviders = new Set(topProviders);
    expect(uniqueTopProviders.size).toBeGreaterThanOrEqual(3);
  });

  it("Phase 4: preferred model is tried first and falls back with fellBack flag set", async () => {
    const preferred: ModelEntry = {
      id: "deepseek/deepseek-r1",
      provider: "openrouter",
      api: "custom_adapter",
      vision: false,
      contextTokens: 64_000,
      cost: 1,
      speed: 3,
    };
    const fallback: ModelEntry = {
      id: "gemini-3.8-flash",
      provider: "gemini",
      api: "chat",
      vision: true,
      contextTokens: 1_000_000,
      cost: 2,
      speed: 1,
    };

    const callOrder: string[] = [];
    const result = await generate({
      system: "system prompt",
      user: "user prompt",
      routing: {
        intent: "answer",
        needsVision: false,
        contextTokens: 100,
        latencySensitive: false,
        costSensitive: false,
      },
      candidates: [preferred, fallback],
      call: async (model) => {
        callOrder.push(model.id);
        if (model.id === "deepseek/deepseek-r1") {
          throw new AiError("rate_limit", "OpenRouter rate limited", { provider: "openrouter" });
        }
        return "fallback answer";
      },
    });

    expect(callOrder).toEqual(["deepseek/deepseek-r1", "gemini-3.8-flash"]);
    expect(result.text).toBe("fallback answer");
    expect(result.model).toBe("gemini-3.8-flash");
    expect(result.fellBack).toBe(true);
  });
});
