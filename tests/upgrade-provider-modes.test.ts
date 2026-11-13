import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BUDDY_PRESETS } from "../src/lib/ai/buddy-personas";
import { recommendSpecialistBuddy } from "../src/lib/ai/mode-recommendations";
import { MODELS } from "../src/lib/ai/registry";
import { resolveProviderRouting } from "../src/lib/buddy-service.server";
import { Route as modelsRoute } from "../src/routes/api/public/extension/models";

describe("Minimal Existing Project Upgrade — AI Providers & Buddy Modes", () => {
  const root = path.resolve(__dirname, "..");
  const sidepanelHtml = fs.readFileSync(path.join(root, "extension/sidepanel.html"), "utf-8");
  const sidepanelJs = fs.readFileSync(path.join(root, "extension/sidepanel.js"), "utf-8");
  const backgroundJs = fs.readFileSync(path.join(root, "extension/background.js"), "utf-8");

  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {
      GEMINI_API_KEY: process.env.GEMINI_API_KEY,
      GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      GROQ_API_KEY: process.env.GROQ_API_KEY,
      OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL,
    };
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    vi.restoreAllMocks();
  });

  it("reports truthful Connected, Missing API, and Not Connected provider statuses from /api/public/extension/models", async () => {
    process.env.GEMINI_API_KEY = "AIzaSyTestGeminiKeyValid123";
    delete process.env.OPENAI_API_KEY;
    delete process.env.GROQ_API_KEY;
    delete process.env.OLLAMA_BASE_URL;

    const getHandler = (
      modelsRoute.options.server as { handlers: { GET: () => Promise<Response> } }
    ).handlers.GET;
    const res = await getHandler();
    const data = await res.json();

    expect(data.ok).toBe(true);
    expect(data.defaultProvider).toBe("gemini");
    expect(data.providers[0].id).toBe("gemini");
    expect(data.providers[0].statusLabel).toBe("Connected");
    expect(data.providers[0].configured).toBe(true);

    const openai = data.providers.find((p: { id: string }) => p.id === "openai");
    expect(openai).toBeDefined();
    expect(openai.configured).toBe(false);
    expect(openai.status).toBe("missing_api");
    expect(openai.statusLabel).toBe("Missing API");
    expect(openai.missingKeyName).toBe("OPENAI_API_KEY");

    const ollama = data.providers.find((p: { id: string }) => p.id === "ollama");
    expect(ollama).toBeDefined();
    expect(ollama.configured).toBe(false);
    expect(ollama.status).toBe("not_connected");
    expect(ollama.statusLabel).toBe("Not Connected");
  });

  it("keeps Gemini working safely and explains exact missing API when unconfigured provider is selected", () => {
    process.env.GEMINI_API_KEY = "AIzaSyTestGeminiKeyValid123";
    delete process.env.OPENAI_API_KEY;
    delete process.env.GROQ_API_KEY;
    delete process.env.OLLAMA_BASE_URL;

    const openaiDecision = resolveProviderRouting({
      preferredProvider: "openai",
      preferredModel: null,
      userApiKey: "AIzaSyUserDirectGeminiKey",
      defaultCandidates: MODELS,
      language: "hinglish",
    });

    expect(openaiDecision.effectiveProvider).toBe("gemini");
    expect(openaiDecision.candidates[0].provider).toBe("gemini");
    expect(openaiDecision.providerWarning).not.toBeNull();
    expect(openaiDecision.providerWarning?.status).toBe("missing_api");
    expect(openaiDecision.providerWarning?.missingKey).toBe("OPENAI_API_KEY");
    expect(openaiDecision.providerWarning?.fallbackUsed).toBe("Google Gemini");
    expect(openaiDecision.providerWarning?.message).toContain("OPENAI_API_KEY");

    const ollamaDecision = resolveProviderRouting({
      preferredProvider: "ollama",
      preferredModel: null,
      userApiKey: null,
      defaultCandidates: MODELS,
      language: "english",
    });

    expect(ollamaDecision.effectiveProvider).toBe("gemini");
    expect(ollamaDecision.providerWarning?.status).toBe("not_connected");
    expect(ollamaDecision.providerWarning?.message).toContain("OLLAMA_BASE_URL");

    const geminiDecision = resolveProviderRouting({
      preferredProvider: "gemini",
      preferredModel: null,
      userApiKey: null,
      defaultCandidates: MODELS,
      language: "hinglish",
    });

    expect(geminiDecision.effectiveProvider).toBe("gemini");
    expect(geminiDecision.providerWarning).toBeNull();
  });

  it("preserves all 15 Buddy presets + Custom Buddy across UI and background fallback", () => {
    expect(BUDDY_PRESETS.length).toBeGreaterThanOrEqual(15);
    for (const preset of BUDDY_PRESETS) {
      expect(sidepanelJs).toContain(`slug: "${preset.slug}"`);
      expect(backgroundJs).toContain(`${preset.slug}:`);
    }
    expect(sidepanelJs).toContain('slug: "custom:user_custom_buddy_1"');
  });

  it("recommends a better specialist Buddy for domain questions without auto-switching", () => {
    const rec = recommendSpecialistBuddy({
      question: "Meesho par product listing aur pricing kaise improve karun?",
      activeSlug: "friendly",
      language: "hinglish",
    });

    expect(rec).not.toBeNull();
    expect(rec?.slug).toBe("ecommerce");
    expect(rec?.name).toBe("E-commerce Buddy");
    expect(rec?.suggestionText).toContain("E-commerce Buddy");
    expect(rec?.suggestionText.toLowerCase()).toContain("select");

    const sameRec = recommendSpecialistBuddy({
      question: "Meesho par product listing aur pricing kaise improve karun?",
      activeSlug: "ecommerce",
      language: "hinglish",
    });
    expect(sameRec).toBeNull();

    const greetingRec = recommendSpecialistBuddy({
      question: "Hello Buddy",
      activeSlug: "friendly",
      language: "hinglish",
    });
    expect(greetingRec).toBeNull();

    const actionRec = recommendSpecialistBuddy({
      question: "Neeche scroll karo",
      activeSlug: "friendly",
      language: "hinglish",
    });
    expect(actionRec).toBeNull();
  });

  it("wires AI Provider Selection in sidepanel UI, deduped warnings, and non-auto-switching recommendation prompts", () => {
    expect(sidepanelHtml).toContain('id="providerSelector"');
    expect(sidepanelHtml).toContain('id="activeProviderStatusBadge"');
    expect(sidepanelHtml).toContain('id="providerSelectionNotice"');

    expect(sidepanelJs).toContain("selectProvider(");
    expect(sidepanelJs).toContain("warnedMissingProviders");
    expect(sidepanelJs).toContain("recommendedModesShown");
    expect(sidepanelJs).toContain("appendModeRecommendationNotice");
    expect(sidepanelJs).toContain("preferredProvider: activeProv");

    // Existing browser actions remain intact
    expect(sidepanelJs).toContain("executeNaturalBrowserAction");
    expect(sidepanelJs).toContain("startSmartFormFill");
    expect(sidepanelJs).toContain("executeScroll");
  });
});
