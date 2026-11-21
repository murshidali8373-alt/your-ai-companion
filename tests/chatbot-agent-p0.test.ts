import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, afterEach, beforeEach } from "vitest";
import { classifyUserRequest } from "../src/lib/ai/request-classifier";
import { MODELS } from "../src/lib/ai/registry";
import {
  buildGroundedSnapshotFallback,
  resolveProviderRouting,
} from "../src/lib/buddy-service.server";
import { generate } from "../src/lib/ai/orchestrator.server";
import { AiError } from "../src/lib/ai/errors";

describe("AI Buddy Chatbot + Intent Router + Strict Provider Control (P0)", () => {
  const root = path.resolve(__dirname, "..");
  const sidepanelJs = fs.readFileSync(path.join(root, "extension/sidepanel.js"), "utf-8");
  const sidepanelHtml = fs.readFileSync(path.join(root, "extension/sidepanel.html"), "utf-8");
  const backgroundJs = fs.readFileSync(path.join(root, "extension/background.js"), "utf-8");

  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {
      GEMINI_API_KEY: process.env.GEMINI_API_KEY,
      GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
      GROQ_API_KEY: process.env.GROQ_API_KEY,
    };
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("routes general knowledge/writing queries as general chat and webpage queries as page mode", () => {
    const generalSamples = [
      "What is Apple?",
      "Explain photosynthesis.",
      "Who was Albert Einstein?",
      "Write a professional email.",
      "Give me business ideas.",
      "Explain the difference between iPhone 15 and Samsung S24.",
    ];
    for (const q of generalSamples) {
      const res = classifyUserRequest(q, {
        snapshot: { url: "https://example.com", title: "Example" },
      });
      expect(res.category, `expected general_chat for "${q}"`).toBe("general_chat");
      expect(res.includePageContext).toBe(false);
    }

    const pageSamples = [
      { q: "What is on this page?", expectCtx: true },
      { q: "Explain this webpage", expectCtx: true },
      { q: "Find the login button", expectCtx: true },
      { q: "Orders tab kahan hai?", expectCtx: true },
      { q: "First Name mein Murshad fill kar do", expectCtx: true },
      { q: "Is page par koi error hai?", expectCtx: true },
      { q: "Ab doosre wale par click karo", expectCtx: true },
    ];
    for (const { q, expectCtx } of pageSamples) {
      const res = classifyUserRequest(q, {
        snapshot: { url: "https://example.com", title: "Example" },
      });
      expect(res.includePageContext, `expected page context for "${q}"`).toBe(expectCtx);
      expect(res.category).not.toBe("general_chat");
    }

    // Active form session keeps short follow-ups in browser_action mode
    const followUp = classifyUserRequest("Ali", {
      snapshot: { url: "https://example.com/form", title: "Form" },
      hasActiveFormSession: true,
      hasPendingSlot: true,
    });
    expect(followUp.category).toBe("browser_action");
    expect(followUp.includePageContext).toBe(true);
  });

  it("enforces strict provider selection when strictSelection / allowProviderFallback=false is active", async () => {
    process.env.GEMINI_API_KEY = "AIzaSyTestGeminiKeyValid123";
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENROUTER_API_KEY;

    const strictFail = resolveProviderRouting({
      preferredProvider: "openai",
      preferredModel: null,
      userApiKey: null,
      defaultCandidates: MODELS,
      language: "english",
      strictSelection: true,
    });

    expect(strictFail.strictSelection).toBe(true);
    expect(strictFail.effectiveProvider).toBe("openai");
    expect(strictFail.providerWarning).not.toBeNull();
    expect(strictFail.providerWarning?.missingKey).toBe("OPENAI_API_KEY");
    expect(strictFail.providerWarning?.fallbackUsed).toBe("None (Strict selection)");

    await expect(
      generate({
        system: "You are a helpful assistant.",
        user: "What is Apple?",
        routing: { capability: "page-qa", estimatedPromptTokens: 200 },
        candidates: strictFail.candidates,
        userProvider: "openai",
        allowProviderFallback: false,
      }),
    ).rejects.toThrow(/openai/i);
  });

  it("extracts value-first Hinglish fills in server fallback instead of asking 'Kya fill karna hai?'", () => {
    const sampleSnapshot = {
      url: "https://example.com/form",
      title: "Test Form",
      forms: [
        {
          ref: "f1",
          name: "phone",
          placeholder: "Mobile Number",
          selector: "#phone",
          role: "textbox",
          tag: "input",
        },
      ],
      controls: [],
      headings: [],
      alerts: [],
      text: "Enter mobile number",
    };

    const dummyErr = new AiError("auth", "No Gemini API key configured", {
      provider: "gemini",
    });

    for (const q of ["1234 FILL KR DO", "9560798373 YE FILL KR DO", "fill kar do 9560798373"]) {
      const res = buildGroundedSnapshotFallback({
        question: q,
        snapshot: sampleSnapshot,
        buddyName: "Friendly Buddy",
        language: "hinglish",
        aiError: dummyErr,
      });
      expect(res.actionType).toBe("type");
      expect(res.reply.answer).not.toContain("Kya fill karna hai");
      expect(res.targetValue).toBeTruthy();
    }
  });

  it("wires Auto default provider, general-mode snapshot skipping, and honest error surface in extension", () => {
    expect(sidepanelHtml).toContain('<option value="auto" selected>');
    expect(sidepanelHtml).toContain('value="openrouter-claude-3.5-sonnet"');
    expect(sidepanelJs).toContain('let selectedProvider = "auto"');
    expect(sidepanelJs).toContain("isGeneralChatQuery");
    expect(sidepanelJs).toContain('res.activeProvider === "error"');

    expect(backgroundJs).toContain('if (intent !== "general")');
    expect(backgroundJs).toContain('if (intent === "general" || isStrictNonAutoProvider)');
    expect(backgroundJs).toContain('activeProvider: "error"');
  });
});
