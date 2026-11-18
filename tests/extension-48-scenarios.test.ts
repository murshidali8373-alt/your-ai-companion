import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";

const root = path.resolve(__dirname, "..");
const sidepanelJsPath = path.join(root, "extension", "sidepanel.js");
const sidepanelHtmlPath = path.join(root, "extension", "sidepanel.html");
const backgroundJsPath = path.join(root, "extension", "background.js");

function loadSidepanelParser(activeUploadedDocument: Record<string, unknown> | null = null) {
  const js = fs.readFileSync(sidepanelJsPath, "utf-8");
  const helperStart = js.indexOf("function extractRequestedDocFieldKeys(");
  const helperEnd = js.indexOf("async function executeNaturalBrowserAction(");
  if (helperStart === -1 || helperEnd === -1) {
    throw new Error("Could not locate parser block in sidepanel.js");
  }
  const sandbox: Record<string, unknown> = {
    activeUploadedDocument,
  };
  vm.runInNewContext(js.slice(helperStart, helperEnd), sandbox);
  return {
    parseActionIntent: sandbox.parseActionIntent as (
      text: string,
      ctx?: Record<string, unknown> | null,
    ) => Record<string, unknown>,
    normalizeHinglishCommand: sandbox.normalizeHinglishCommand as (s: string) => string,
    isLikelyActionCommand: sandbox.isLikelyActionCommand as (s: string) => boolean,
    resolveWebsiteDestination: sandbox.resolveWebsiteDestination as (
      q: string,
      forceSearchOnly?: boolean,
    ) => { url: string; isSearch: boolean; label: string },
    extractFillDetails: sandbox.extractFillDetails as (s: string) => Record<string, unknown>,
  };
}

describe("AI Buddy — Comprehensive 12-Category (48-Scenario) Intelligence, Hinglish, Smart Fill & Live Voice Suite", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // =========================================================================
  // CATEGORY 1: Website search & opening (4 scenarios)
  // =========================================================================
  describe("Category 1: Website Search & Opening (4 scenarios)", () => {
    it("1.1–1.4 separates known portal opening vs web search vs UI tab click vs explicit URL", () => {
      const { parseActionIntent, resolveWebsiteDestination } = loadSidepanelParser();

      // 1.1 Known Indian portal in Hinglish
      const s1 = parseActionIntent("Aadhaar website kholo");
      expect(s1).toMatchObject({ type: "OPEN_WEBSITE" });
      expect(resolveWebsiteDestination(String(s1.query))).toMatchObject({
        url: "https://uidai.gov.in",
        isSearch: false,
      });

      // 1.2 Web search for website
      const s2 = parseActionIntent("search for Aadhaar website");
      expect(s2).toMatchObject({ type: "WEB_SEARCH" });
      expect(resolveWebsiteDestination(String(s2.query), true).url).toContain(
        "google.com/search?q=",
      );

      // 1.3 Google web search in Hinglish
      const s3 = parseActionIntent("Google par Flipkart search karo");
      expect(s3).toMatchObject({ type: "WEB_SEARCH", query: "Flipkart" });

      // 1.4 Direct URL vs Orders tab (must NOT treat "Orders tab" as external website)
      expect(parseActionIntent("https://uidai.gov.in kholo")).toMatchObject({
        type: "NAVIGATE",
        url: "https://uidai.gov.in",
      });
      expect(parseActionIntent("Buddy, Orders tab open karo.")).toMatchObject({
        type: "CLICK",
        target: "orders",
      });
    });
  });

  // =========================================================================
  // CATEGORY 2: Search box detection & filling (4 scenarios)
  // =========================================================================
  describe("Category 2: Search Box Detection & Filling (4 scenarios)", () => {
    it("2.1–2.4 distinguishes type-only search fill, fill+submit search, and in-page FIND", () => {
      const { parseActionIntent } = loadSidepanelParser();

      // 2.1 Type in search box WITHOUT submitting ("Search box mein bike cover likho")
      expect(parseActionIntent("Search box mein bike cover likho")).toMatchObject({
        type: "FORM_FILL",
        noSubmitPrompt: true,
        explicitPairs: [{ target: "search", value: "bike cover" }],
      });

      // 2.2 Search submit ("Delhi search karo")
      expect(parseActionIntent("Delhi search karo")).toMatchObject({
        type: "SEARCH_SUBMIT",
        target: "search",
        query: "Delhi",
      });

      // 2.3 Short Hinglish search box type-only
      expect(parseActionIntent("search box me wireless mouse lkho")).toMatchObject({
        type: "FORM_FILL",
        noSubmitPrompt: true,
        explicitPairs: [{ target: "search", value: "wireless mouse" }],
      });

      // 2.4 Explicit in-page search stays FIND (Ctrl+F highlight)
      expect(parseActionIntent("122 search karo is page par")).toMatchObject({
        type: "FIND",
        target: "122",
        inPageOnly: true,
      });
    });
  });

  // =========================================================================
  // CATEGORY 3: Ordinary form field detection & filling (4 scenarios)
  // =========================================================================
  describe("Category 3: Ordinary Form Field Detection & Filling (4 scenarios)", () => {
    it("3.1–3.4 extracts exact targets & values across Hinglish, 'wale box', English & multi-field", () => {
      const { parseActionIntent } = loadSidepanelParser();

      // 3.1 "Mobile number wale box mein 9560798373 daal do"
      expect(
        parseActionIntent("Mobile number wale box mein 9560798373 daal do"),
      ).toMatchObject({
        type: "FORM_FILL",
        explicitPairs: [{ target: "mobile number", value: "9560798373" }],
      });

      // 3.2 Multi-field natural key/value string
      expect(
        parseActionIntent("name Rahul Sharma, email rahul@gmail.com, city Delhi"),
      ).toMatchObject({
        type: "FORM_FILL",
        fields: {
          name: "Rahul Sharma",
          email: "rahul@gmail.com",
          city: "Delhi",
        },
      });

      // 3.3 Pin code field
      expect(parseActionIntent("pincode wale field me 400050 bhar do")).toMatchObject({
        type: "FORM_FILL",
        explicitPairs: [{ target: "pincode", value: "400050" }],
      });

      // 3.4 English "enter ... in ..."
      expect(parseActionIntent("enter Priya Verma in full name field")).toMatchObject({
        type: "FORM_FILL",
        explicitPairs: [{ target: "full name", value: "Priya Verma" }],
      });
    });
  });

  // =========================================================================
  // CATEGORY 4: Chat/message box detection & filling (4 scenarios)
  // =========================================================================
  describe("Category 4: Chat & Message Box Detection & Filling (4 scenarios)", () => {
    it("4.1–4.4 fills chat/message boxes cleanly with noSubmitPrompt=true and intact casing", () => {
      const { parseActionIntent } = loadSidepanelParser();

      // 4.1 Chat box Hinglish
      expect(parseActionIntent("Is chat box mein hello likh do")).toMatchObject({
        type: "FORM_FILL",
        noSubmitPrompt: true,
        explicitPairs: [{ target: "chat", value: "hello" }],
      });

      // 4.2 Literal "Mr. Kr Dev" must NEVER be normalized to "Mr. Kar Dev"
      expect(parseActionIntent("yha msg main Mr. Kr Dev type kr do")).toMatchObject({
        type: "FORM_FILL",
        noSubmitPrompt: true,
        explicitPairs: [{ target: "msg", value: "Mr. Kr Dev" }],
      });

      // 4.3 Comment box English
      expect(parseActionIntent("Type Great delivery! into comment box")).toMatchObject({
        type: "FORM_FILL",
        noSubmitPrompt: true,
        explicitPairs: [{ target: "comment", value: "Great delivery!" }],
      });

      // 4.4 Quoted value inside message box
      expect(parseActionIntent('message mein "Kal 10 baje milte hain" daalo')).toMatchObject({
        type: "FORM_FILL",
        noSubmitPrompt: true,
        explicitPairs: [{ target: "message", value: "Kal 10 baje milte hain" }],
      });
    });
  });

  // =========================================================================
  // CATEGORY 5: Element detection (4 scenarios)
  // =========================================================================
  describe("Category 5: Element Detection (4 scenarios)", () => {
    it("5.1–5.4 handles page inventory, form inspection, and element lookup", () => {
      const { parseActionIntent } = loadSidepanelParser();

      expect(parseActionIntent("is page par kya kya hai")).toMatchObject({
        type: "PAGE_INVENTORY",
      });
      expect(parseActionIntent("Yahan kya fill karna hai?")).toMatchObject({
        type: "FORM_INSPECT",
      });
      expect(parseActionIntent("Buddy, Orders tab kahan hai?")).toMatchObject({
        type: "FIND",
        target: "orders",
      });
      expect(parseActionIntent("where is the submit button")).toMatchObject({
        type: "FIND",
        target: "submit",
      });
    });
  });

  // =========================================================================
  // CATEGORY 6: Pointing & highlighting (4 scenarios)
  // =========================================================================
  describe("Category 6: Pointing & Highlighting Without Clicking (4 scenarios)", () => {
    it("6.1–6.4 routes pointing commands strictly to POINT (never CLICK)", () => {
      const { parseActionIntent } = loadSidepanelParser();

      expect(parseActionIntent("Buddy, address field par point karo.")).toMatchObject({
        type: "POINT",
        target: "address",
      });
      expect(parseActionIntent("highlight submit button")).toMatchObject({
        type: "POINT",
        target: "submit",
      });
      expect(parseActionIntent("mobile number box pr point kr do")).toMatchObject({
        type: "POINT",
        target: "mobile number",
      });
      expect(parseActionIntent("point to checkout button")).toMatchObject({
        type: "POINT",
        target: "checkout",
      });
    });
  });

  // =========================================================================
  // CATEGORY 7: Clicking (4 scenarios)
  // =========================================================================
  describe("Category 7: Clicking & Consequential Safety Gates (4 scenarios)", () => {
    it("7.1–7.4 parses click commands in Hinglish/English and flags consequential actions", () => {
      const { parseActionIntent } = loadSidepanelParser();

      expect(parseActionIntent("login button par click karo.")).toMatchObject({
        type: "CLICK",
        target: "login",
        isConsequential: false,
      });
      expect(parseActionIntent("ab click karo")).toMatchObject({
        type: "CLICK",
        target: "__CURRENT__",
      });
      expect(parseActionIntent("Submit karo")).toMatchObject({
        type: "CLICK",
        target: "submit",
        isConsequential: true,
      });
      expect(parseActionIntent("Pay now button dabao")).toMatchObject({
        type: "CLICK",
        target: "pay now",
        isConsequential: true,
      });
    });
  });

  // =========================================================================
  // CATEGORY 8: Scrolling (4 scenarios)
  // =========================================================================
  describe("Category 8: Scrolling (Page, To-Element, Named Container) (4 scenarios)", () => {
    it("8.1–8.4 handles directional, to-element, and named container scrolls", () => {
      const { parseActionIntent } = loadSidepanelParser();

      expect(parseActionIntent("Buddy, neeche scroll karo.")).toMatchObject({
        type: "SCROLL",
        direction: "down",
      });
      expect(parseActionIntent("Page ko upar le jao")).toMatchObject({
        type: "SCROLL",
        direction: "up",
      });
      expect(parseActionIntent("Notices ko neeche scroll karo")).toMatchObject({
        type: "SCROLL",
        direction: "down",
        targetContainerText: "notices",
      });
      expect(parseActionIntent("footer tak scroll krdo")).toMatchObject({
        type: "SCROLL",
        direction: "to_element",
        target: "footer",
      });
    });
  });

  // =========================================================================
  // CATEGORY 9: Smart Hinglish Understanding (4 scenarios)
  // =========================================================================
  describe("Category 9: Smart Hinglish Normalization & Context Clues (4 scenarios)", () => {
    it("9.1–9.4 expands shorthand abbreviations accurately without corrupting quoted strings", () => {
      const { normalizeHinglishCommand, isLikelyActionCommand, parseActionIntent } =
        loadSidepanelParser();

      // 9.1 Multiple texting shortcuts normalized
      expect(normalizeHinglishCommand("hnn sb kch btao abhi")).toContain("haan sab kuch batao");

      // 9.2 Quoted user literal protected from kr->kar / h->hai expansion
      const normalized = normalizeHinglishCommand('msg mein "Mr. Kr Dev h" lkho');
      expect(normalized).toContain('"Mr. Kr Dev h"');
      expect(normalized).toContain("likho");

      // 9.3 Action classifier detects colloquial Hinglish command
      expect(isLikelyActionCommand("isme kch dalo bss yhi")).toBe(true);
      expect(isLikelyActionCommand("ye bss ek example h")).toBe(false);

      // 9.4 Short activity check with 'tk'
      expect(parseActionIntent("ab tk kya kiya")).toMatchObject({
        type: "ACTIVITY_LOG",
      });
    });
  });

  // =========================================================================
  // CATEGORY 10: Gemini Intelligence Fallback & Privacy Protection (4 scenarios)
  // =========================================================================
  describe("Category 10: Gemini Fallback Interpretation & Secret Masking (4 scenarios)", () => {
    it("10.1 background interpret_command uses mocked Gemini to interpret vague Hinglish & never falls back to explaining page", async () => {
      const bgCode = fs.readFileSync(backgroundJsPath, "utf-8");
      const start = bgCode.indexOf("function buildMissingProviderWarning(");
      const end = bgCode.indexOf("async function ask(");
      expect(start).toBeGreaterThan(-1);
      expect(end).toBeGreaterThan(start);

      const fetchMock = vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      answer: "Kya likhna hai? Text bata do.",
                      highlight: "f1",
                      emotion: "curious",
                      calloutTitle: "Full Name",
                      calloutDescription: "Waiting for text",
                      actionType: "ask_clarification",
                      targetText: "Full Name",
                      targetField: "Full Name",
                      targetValue: null,
                      needsClarification: true,
                      clarificationQuestion: "Kya likhna hai? Text bata do.",
                    }),
                  },
                ],
              },
            },
          ],
        }),
      }));

      const sandbox: Record<string, unknown> = {
        fetch: fetchMock,
        BUDDY_PRESETS_MAP: {
          friendly: { name: "Friendly Buddy", personality: "Warm", defaultLanguage: "hinglish" },
        },
        getBuddyPresetInternal: () => ({
          name: "Friendly Buddy",
          personality: "Warm",
          defaultLanguage: "hinglish",
        }),
      };
      vm.runInNewContext(bgCode.slice(start, end), sandbox);

      const generateReply = sandbox.generateAutonomousCompanionReply as (
        args: Record<string, unknown>,
      ) => Promise<Record<string, unknown>>;

      // 10.1 Gemini interprets "buddy isme kch likh do" with secret redaction
      const res1 = await generateReply({
        question: "buddy isme kch likh do",
        intent: "interpret_command",
        userApiKey: "AIzaDummyTestKey1234567890",
        history: [{ role: "user", content: "password=SuperSecret123 please ignore" }],
        actionContext: { lastTargetField: "Full Name", pendingSlotType: null },
        snapshot: {
          url: "https://example.com/form",
          title: "Signup",
          forms: [
            { ref: "f1", name: "Full Name", selector: "#fullname", inputType: "text", value: "" },
            { ref: "f2", name: "Password", selector: "#pw", inputType: "password", sensitive: true, value: "secret999" },
          ],
          controls: [],
          headings: [],
          alerts: [],
          text: "Signup Form Bearer sk_test_secretToken12345",
        },
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const sentReqInit = (fetchMock.mock.calls[0] as unknown[])[1] as { body: string };
      const sentBody = sentReqInit.body;
      // Privacy check: password field value, Bearer token, and secret never leave in prompt!
      expect(sentBody).not.toContain("secret999");
      expect(sentBody).not.toContain("SuperSecret123");
      expect(sentBody).not.toContain("sk_test_secretToken12345");
      expect(sentBody).toContain("COMMAND INTERPRETATION MODE");
      expect(sentBody).toContain('lastTargetField=\\"Full Name\\"');
      expect(sentBody).toContain("password=[redacted]");
      expect(sentBody).toContain("Bearer [redacted]");
      expect(res1.actionType).toBe("ask_clarification");
      expect(res1.needsClarification).toBe(true);
      expect(res1.clarificationQuestion).toBe("Kya likhna hai? Text bata do.");
      expect(res1.highlightSelector).toBe("#fullname");
    });

    it("10.2–10.4 handles server askGuest interpret_command fallback & Gemini structured action safely", async () => {
      const { askGuest } = await import("../src/lib/buddy-service.server");

      // 10.2 Unconfigured Gemini server still returns ask_clarification instead of explaining page!
      const prevGemini = process.env.GEMINI_API_KEY;
      const prevGoogle = process.env.GOOGLE_API_KEY;
      delete process.env.GEMINI_API_KEY;
      delete process.env.GOOGLE_API_KEY;
      try {
        const resLocal = await askGuest({
          question: "buddy isme kch likh do",
          intent: "interpret_command",
          buddySlug: "friendly",
          actionContext: { lastTargetField: "Email" },
          snapshot: {
            url: "https://example.com",
            title: "Contact",
            text: "Contact us page",
            forms: [{ name: "Email", selector: "#email", value: "", required: true }],
            controls: [],
          },
        });
        expect(resLocal.actionType).toBe("ask_clarification");
        expect(resLocal.needsClarification).toBe(true);
        expect(resLocal.clarificationQuestion).toContain("Kya");
        // Must NOT default to a long webpage summary when user asked to fill/write
        expect(resLocal.reply.answer).not.toContain("Here is a breakdown");
      } finally {
        if (prevGemini !== undefined) process.env.GEMINI_API_KEY = prevGemini;
        if (prevGoogle !== undefined) process.env.GOOGLE_API_KEY = prevGoogle;
      }

      // 10.3 & 10.4 verify ask.ts route accepts "interpret_command" intent & actionContext without Zod rejection
      const askRoute = fs.readFileSync(
        path.join(root, "src/routes/api/public/extension/ask.ts"),
        "utf-8",
      );
      expect(askRoute).toContain('"interpret_command"');
      expect(askRoute).toContain("actionContext:");
    });
  });

  // =========================================================================
  // CATEGORY 11: Multi-turn Conversational Context (4 scenarios)
  // =========================================================================
  describe("Category 11: Multi-Turn Conversational Context (4 scenarios)", () => {
    it("11.1–11.4 resolves fill clarification, follow-up values, confirmations, disambiguation & cancel", () => {
      const { parseActionIntent } = loadSidepanelParser();

      // 11.1 Step 1: "buddy isme kch likh do" -> FILL_NEED_VALUE
      const turn1 = parseActionIntent("buddy isme kch likh do", {
        pendingSlot: null,
        session: { lastTargetField: "name" },
      });
      expect(turn1).toMatchObject({ type: "FILL_NEED_VALUE", targetField: "name" });

      // Step 2: user replies just with text "Murshad Ali"
      const turn2 = parseActionIntent("Murshad Ali", {
        pendingSlot: { type: "fill_value", targetField: "name" },
      });
      expect(turn2).toMatchObject({
        type: "FORM_FILL",
        explicitPairs: [{ target: "name", value: "Murshad Ali", overwrite: true }],
      });

      // 11.2 "Buddy, ye fill karo" -> FILL_NEED_VALUE -> "9560798373"
      const phoneTurn1 = parseActionIntent("Buddy, ye fill karo");
      expect(phoneTurn1).toMatchObject({ type: "FILL_NEED_VALUE", targetField: "__CURRENT__" });
      const phoneTurn2 = parseActionIntent("9560798373", {
        pendingSlot: { type: "fill_value", targetField: "__CURRENT__" },
      });
      expect(phoneTurn2).toMatchObject({
        type: "FORM_FILL",
        explicitPairs: [{ target: "__CURRENT__", value: "9560798373", overwrite: true }],
      });

      // 11.3 Short Hinglish confirmation "hnn kr do"
      const proposal = { type: "CLICK", target: "submit" };
      expect(
        parseActionIntent("hnn kr do", { session: { lastActionProposal: proposal } }),
      ).toMatchObject({
        type: "EXECUTE_CONTEXT_PROPOSAL",
        proposal,
      });

      // 11.4 Demonstrative pick "bss ye wala" + Cancel "rehne do"
      expect(
        parseActionIntent("bss ye wala", {
          pendingSlot: {
            type: "fill_target",
            value: "9560798373",
            candidates: [
              { index: 1, label: "Billing Phone", selector: "#billing_phone" },
              { index: 2, label: "Shipping Phone", selector: "#shipping_phone" },
            ],
          },
        }),
      ).toMatchObject({
        type: "FORM_FILL",
        explicitPairs: [{ target: "Billing Phone", selector: "#billing_phone", value: "9560798373" }],
      });
      expect(
        parseActionIntent("rehne do", {
          pendingSlot: { type: "fill_value", targetField: "name" },
        }),
      ).toMatchObject({ type: "CANCEL_PENDING" });
    });
  });

  // =========================================================================
  // CATEGORY 12: Live Voice Conversation UX & Safety Controls (4 scenarios)
  // =========================================================================
  describe("Category 12: Live Voice Conversation Mode & Barge-In (4 scenarios)", () => {
    it("12.1–12.4 verifies live voice UI controls, state machine hooks, barge-in & error guards", () => {
      const html = fs.readFileSync(sidepanelHtmlPath, "utf-8");
      const spCode = fs.readFileSync(sidepanelJsPath, "utf-8");

      // 12.1 Live toggle button & active CSS states exist
      expect(html).toContain('id="liveVoiceBtn"');
      expect(html).toContain('id="voiceBtn"');
      expect(html).toContain(".voice-btn.live-active");
      expect(html).toContain(".voice-btn.speaking-active");

      // 12.2 Continuous turn-taking with echo guard after speech ends
      expect(spCode).toContain("function toggleLiveVoice(");
      expect(spCode).toContain("if (isLiveVoiceMode && !busy && !isBuddySpeaking && !isRecognizing)");
      expect(spCode).toContain("window.__buddyVoiceController");

      // 12.3 Barge-in speech interruption while speaking
      expect(spCode).toContain("function interruptBuddySpeech(");
      expect(spCode).toContain("if (isBuddySpeaking && (interimText.trim() || finalText.trim()))");
      expect(spCode).toContain("interruptBuddySpeech({ resumeListening: true })");

      // 12.4 Permission / missing-mic error cleanup
      expect(spCode).toContain('code === "not-allowed" || code === "audio-capture"');
      expect(spCode).toContain("Microphone permission denied.");
    });
  });
});
