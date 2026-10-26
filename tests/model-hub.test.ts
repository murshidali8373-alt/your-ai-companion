import { describe, expect, it } from "vitest";
import { MODEL_CATALOG, PROVIDERS, filterModels, findCatalogModel } from "../src/lib/ai/model-hub";

describe("AI Model Hub Catalog", () => {
  it("contains more than 100 distinct production and open-source models", () => {
    expect(MODEL_CATALOG.length).toBeGreaterThanOrEqual(100);
  });

  it("registers all 8 required major providers with truthful configurations", () => {
    const providerIds = Object.keys(PROVIDERS);
    expect(providerIds).toContain("gemini");
    expect(providerIds).toContain("groq");
    expect(providerIds).toContain("openrouter");
    expect(providerIds).toContain("openai");
    expect(providerIds).toContain("ollama");
    expect(providerIds).toContain("huggingface");
    expect(providerIds).toContain("cloudflare");
    expect(providerIds).toContain("github");
  });

  it("includes Google Gemini 3.8 Flash as the primary default model", () => {
    const defaultModel = MODEL_CATALOG.find((m) => m.isDefault);
    expect(defaultModel).toBeDefined();
    expect(defaultModel?.id).toBe("gemini-3.8-flash");
    expect(defaultModel?.provider).toBe("gemini");
    expect(defaultModel?.capabilities).toContain("vision");
    expect(defaultModel?.contextWindow).toBeGreaterThanOrEqual(1_000_000);
  });

  it("filters models correctly by provider, tier, and capability", () => {
    const groqModels = filterModels({ provider: "groq" });
    expect(groqModels.length).toBeGreaterThan(0);
    expect(groqModels.every((m) => m.provider === "groq")).toBe(true);

    const localModels = filterModels({ tier: "local" });
    expect(localModels.length).toBeGreaterThan(0);
    expect(localModels.every((m) => m.tier === "local")).toBe(true);

    const visionModels = filterModels({ hasCapability: "vision" });
    expect(visionModels.length).toBeGreaterThan(0);
    expect(visionModels.every((m) => m.capabilities.includes("vision"))).toBe(true);
  });

  it("searches models by keyword across names, IDs, and uses", () => {
    const deepseek = filterModels({ searchQuery: "deepseek" });
    expect(deepseek.length).toBeGreaterThan(0);
    expect(deepseek.some((m) => m.name.toLowerCase().includes("deepseek"))).toBe(true);
  });

  it("finds a model by catalog ID or provider model ID", () => {
    const found = findCatalogModel("gemini-3.8-flash");
    expect(found).toBeDefined();
    expect(found?.name).toBe("Gemini 3.8 Flash");

    const groqModel = findCatalogModel("llama-3.3-70b-versatile");
    expect(groqModel).toBeDefined();
  });
});
