import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { detectPreferredSpeechLang, pickBestVoice, SingleSpeaker } from "../src/shared/voice-turn";
import { executeFormFill } from "../src/hooks/use-form-filler";

describe("AI Buddy System Repair Verification", () => {
  const root = path.resolve(__dirname, "..");

  it("removes personal fallback emails from web connect handshake", () => {
    const connectTsx = fs.readFileSync(
      path.join(root, "src/routes/_authenticated/connect.tsx"),
      "utf-8",
    );
    expect(connectTsx).not.toContain("sk8404530@gmail.com");
    expect(connectTsx).toContain("Signed-in user");
  });

  it("uses live asfavkynho Cloud Run host and blocks stale 5t53lwemhepi host in extension", () => {
    const files = [
      path.join(root, "extension/background.js"),
      path.join(root, "extension/sidepanel.js"),
      path.join(root, "extension/popup.js"),
    ];
    for (const f of files) {
      const src = fs.readFileSync(f, "utf-8");
      expect(src).toMatch(
        /DEFAULT_(?:HOST|BASE)\s*=\s*"https:\/\/ais-dev-asfavkynho62d5znlmqa5n-711254288483\.asia-southeast1\.run\.app"/,
      );
      expect(src).toMatch(/LEGACY_BROKEN_HOST\s*=\s*"5t53lwemhepi2nbkqb2reo"/);
      expect(src).toContain("aistudio.google.com");
    }
  });

  it("eliminates fabricated order IDs and invented user defaults", () => {
    const bg = fs.readFileSync(path.join(root, "extension/background.js"), "utf-8");
    const sp = fs.readFileSync(path.join(root, "extension/sidepanel.js"), "utf-8");

    expect(bg).not.toContain("MSH-982410-IN");
    expect(bg).not.toContain("ORD-${i + 1}");
    expect(sp).not.toContain("Murshid Ali");
    expect(sp).not.toContain("27AABCU9603R1ZM");
  });

  it("uses updated Gemini models, passes conversation history, and handles missing elements honestly", () => {
    const bg = fs.readFileSync(path.join(root, "extension/background.js"), "utf-8");
    expect(bg).toContain("gemini-4-hydrogen");
    expect(bg).toContain("gemini-3.8-flash");
    expect(bg).toContain("gemini-3.1-flash-lite");
    expect(bg).toContain("historyContents");
    expect(bg).toContain("return bestScore > 0 ? best : null;");
    expect(bg).toContain('act === "open_link"');
    expect(bg).toContain('addEventListener("scroll", onViewportChange');
    expect(bg).toContain("el.isConnected");
  });

  it("fixes sidepanel toggles, SVG arm bounds, and model label", () => {
    const html = fs.readFileSync(path.join(root, "extension/sidepanel.html"), "utf-8");
    const sp = fs.readFileSync(path.join(root, "extension/sidepanel.js"), "utf-8");

    expect(html).toContain('id="headerModelLabel">Auto Model</span>');
    expect(html).toContain('id="rigArmRightSleeve" d="m69 60-11 6 4 12 9-12"');
    expect(sp).toContain('pageToggleEl.classList.contains("active")');
    expect(sp).not.toContain('$("voiceToggleBtn")?.click()');
    expect(sp).toContain("onboundary");
  });

  it("eliminates ReferenceErrors, alert() dialogs, missing DOM IDs, and auth token mismatches in sidepanel", () => {
    const html = fs.readFileSync(path.join(root, "extension/sidepanel.html"), "utf-8");
    const sp = fs.readFileSync(path.join(root, "extension/sidepanel.js"), "utf-8");
    const bg = fs.readFileSync(path.join(root, "extension/background.js"), "utf-8");
    const memoriesRoute = fs.readFileSync(
      path.join(root, "src/routes/api/public/extension/memories.ts"),
      "utf-8",
    );
    const runtimeTs = fs.readFileSync(
      path.join(root, "src/lib/extension-buddy-3d-runtime.ts"),
      "utf-8",
    );

    // No calls to removed/undefined functions
    expect(sp).not.toMatch(/\baskQuestion\s*\(/);
    expect(sp).not.toMatch(/\bstartMultiStepWorkflow\s*\(/);

    // No window.alert / alert() calls (avoid matching prose like "alert(s)")
    expect(sp).not.toMatch(/\bwindow\.alert\s*\(/);
    expect(sp).not.toMatch(/(?:^|[^\w$])alert\s*\((?!s\))/m);

    // Required side panel cards and controls exist in HTML
    expect(html).toContain('id="planRetryBtn"');
    expect(html).toContain('id="extractedDataCard"');
    expect(html).toContain('id="extractedCountTitle"');
    expect(html).toContain('id="extractedContent"');
    expect(html).toContain('id="copyExtractedBtn"');
    expect(html).toContain('id="memErrorMsg"');
    expect(html).toContain('id="scrollDownBannerBtn"');
    expect(html).toContain("[hidden] {\n        display: none !important;\n      }");

    // taskPlanCard must sit outside tabTasks so workflows launched from Chat are visible
    const tabTasksIdx = html.indexOf('id="tabTasks"');
    const tabModelsIdx = html.indexOf('id="tabModels"');
    const taskPlanCardIdx = html.indexOf('id="taskPlanCard"');
    expect(taskPlanCardIdx).toBeGreaterThan(tabModelsIdx);
    expect(tabTasksIdx).toBeLessThan(tabModelsIdx);

    // Auth bearer tokens read camelCase accessToken (with fallback)
    expect(sp).toContain("session?.accessToken || session?.access_token");

    // Real task checkpoint resumption & tab switch CLEAR_HIGHLIGHT
    expect(sp).toContain("ai_buddy_active_plan");
    expect(sp).toContain('type: "CLEAR_HIGHLIGHT"');
    expect(bg).toContain('if (msg.type === "CLEAR_HIGHLIGHT")');
    expect(sp).toContain("cleanTextForSpeech");
    expect(sp).toContain("fetchWithTimeout");

    // 3D WebGL context recovery + visibility throttling + UUID memories
    expect(runtimeTs).toContain("webglcontextlost");
    expect(runtimeTs).toContain("visibilitychange");
    expect(memoriesRoute).toContain("randomUUID()");
    expect(memoriesRoute).not.toContain("mem_${Date.now()}");
  });

  describe("Voice Turn Detection, Voice Selection & Lip Sync", () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it("detects Devanagari and Hinglish phrases as hi-IN and English as en-IN", () => {
      expect(detectPreferredSpeechLang("नमस्ते, यह पेज कैसे काम करता है?")).toBe("hi-IN");
      expect(detectPreferredSpeechLang("Bhai ye button kahan hai, please page par dikhao")).toBe(
        "hi-IN",
      );
      expect(detectPreferredSpeechLang("Please click the submit button on this page.")).toBe(
        "en-IN",
      );
    });

    it("picks best natural/local voice matching preferred language", () => {
      const voices = [
        { name: "US Default", lang: "en-US" } as SpeechSynthesisVoice,
        { name: "Microsoft Heera - Hindi", lang: "hi-IN" } as SpeechSynthesisVoice,
        { name: "Google हिन्दी", lang: "hi-IN" } as SpeechSynthesisVoice,
        { name: "English (India)", lang: "en-IN" } as SpeechSynthesisVoice,
      ];
      const synth = { getVoices: () => voices } as unknown as SpeechSynthesis;
      expect(pickBestVoice(synth, "hi-IN")?.name).toBe("Microsoft Heera - Hindi");
      expect(pickBestVoice(synth, "en-IN")?.name).toBe("English (India)");
    });

    it("drives onBoundary intensity and cleans up on end", () => {
      let createdUtterance: Record<string, unknown> | null = null;
      const mockSynth = {
        cancel: vi.fn(),
        getVoices: () => [{ name: "Google हिन्दी", lang: "hi-IN" }],
        speak: vi.fn((u: Record<string, unknown>) => {
          createdUtterance = u;
        }),
      };

      vi.stubGlobal("window", {
        speechSynthesis: mockSynth,
      });
      vi.stubGlobal(
        "SpeechSynthesisUtterance",
        class {
          text: string;
          lang = "";
          rate = 1;
          voice: unknown = null;
          onboundary: (() => void) | null = null;
          onend: (() => void) | null = null;
          onerror: (() => void) | null = null;
          constructor(t: string) {
            this.text = t;
          }
        },
      );

      const speaker = new SingleSpeaker(mockSynth as unknown as SpeechSynthesis);
      const boundaries: number[] = [];
      const onEnd = vi.fn();
      speaker.speak("Main aapki help kar raha hoon", "auto", onEnd, (intensity) => {
        boundaries.push(intensity);
      });

      expect(mockSynth.cancel).toHaveBeenCalledTimes(1);
      expect(mockSynth.speak).toHaveBeenCalledTimes(1);
      expect(createdUtterance).not.toBeNull();
      expect((createdUtterance as { lang?: string }).lang).toBe("hi-IN");

      (createdUtterance as { onboundary?: () => void }).onboundary?.();
      expect(boundaries.length).toBe(1);
      expect(boundaries[0]).toBeGreaterThan(0);

      (createdUtterance as { onend?: () => void }).onend?.();
      expect(onEnd).toHaveBeenCalledTimes(1);

      vi.unstubAllGlobals();
    });
  });

  describe("Web Form Filler aria-labelledby, combobox, and validation verification", () => {
    it("reads aria-labelledby and detects aria-invalid validation errors", async () => {
      const labelNode = { innerText: "Customer GSTIN", textContent: "Customer GSTIN" };
      const inputEl = {
        tagName: "INPUT",
        type: "text",
        name: "tax_field",
        id: "tax_1",
        value: "",
        disabled: false,
        readOnly: false,
        isConnected: true,
        innerText: "",
        attributes: {
          "aria-labelledby": "lbl_gst",
          "aria-invalid": "true",
        },
        getAttribute(k: string) {
          return this.attributes[k] || null;
        },
        setAttribute(k: string, v: string) {
          this.attributes[k] = v;
        },
        getBoundingClientRect: () => ({
          width: 120,
          height: 32,
          top: 10,
          left: 10,
          bottom: 42,
          right: 130,
        }),
        scrollIntoView: vi.fn(),
        focus: vi.fn(),
        blur: vi.fn(),
        dispatchEvent: vi.fn(() => true),
        click: vi.fn(),
        closest: () => null,
        getRootNode: () => ({
          getElementById: (id: string) => (id === "lbl_gst" ? labelNode : null),
          querySelector: () => null,
        }),
      };

      const formRoot = {
        querySelectorAll: (sel: string) => (sel.includes("input") ? [inputEl] : []),
      } as unknown as HTMLElement;

      vi.stubGlobal("window", {
        HTMLInputElement: class {},
        HTMLTextAreaElement: class {},
        HTMLSelectElement: class {},
        getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1" }),
      });
      vi.stubGlobal("document", {
        getElementById: (id: string) => (id === "lbl_gst" ? labelNode : null),
        querySelector: () => null,
      });
      const MockEvt = class {
        type: string;
        constructor(t: string) {
          this.type = t;
        }
      };
      vi.stubGlobal("Event", MockEvt);
      vi.stubGlobal("FocusEvent", MockEvt);

      const report = await executeFormFill(
        { gstin: "27INVALID0000Z5" },
        { requireConfirmationBeforeSubmit: false },
        formRoot,
      );
      expect(report.filled).toHaveLength(1);
      expect(report.errors.length).toBeGreaterThan(0);
      expect(report.errors[0].error).toContain("validation");

      vi.unstubAllGlobals();
    });
  });

  describe("Chrome Extension Communication Chain & Diagnostic Logging", () => {
    it("validates payloads, guards async reply ports, prefers normal windows in activeTab(), and targets frameId 0 cleanly", () => {
      const bg = fs.readFileSync(path.join(root, "extension/background.js"), "utf-8");
      const sp = fs.readFileSync(path.join(root, "extension/sidepanel.js"), "utf-8");
      const bridge = fs.readFileSync(path.join(root, "extension/bridge.js"), "utf-8");
      const popup = fs.readFileSync(path.join(root, "extension/popup.js"), "utf-8");

      // Background service worker hardening & structured logging
      expect(bg).toContain('if (!msg || typeof msg !== "object" || typeof msg.type !== "string")');
      expect(bg).toContain("const safeReply =");
      expect(bg).toContain("swLog");
      expect(bg).toContain("summarizeMessagePayload");
      expect(bg).toContain('if (msg.type === "GET_COMM_LOGS")');
      expect(bg).toContain('windowType: "normal"');
      expect(bg).toContain("sendTabMessageToBridge");
      expect(bg).toContain("{ frameId: 0 }");
      expect(bg).toContain("runTabScript");
      expect(bg).toContain("onMessage:reply_port_closed");

      // Ensure SAVE_SESSION and SIGN_OUT always catch storage rejections so ports never hang
      expect(bg).toMatch(
        /set\(\{\s*session:\s*msg\.session[\s\S]*?\.catch\(\(err\)\s*=>\s*safeReply/,
      );
      expect(bg).toMatch(
        /remove\(\["session",\s*"conversationBuffer"\]\)[\s\S]*?\.catch\(\(err\)\s*=>\s*safeReply/,
      );

      // Content script bridge.js logging, idempotency, and lastError handling
      expect(bridge).toContain("__AI_BUDDY_BRIDGE_BOUND__");
      expect(bridge).toContain("[AI Buddy][Bridge]");
      expect(bridge).toContain("chrome.runtime?.lastError");
      expect(bridge).toContain("session_sync:rejected_route");
      expect(bridge).toContain(
        'if (!msg || typeof msg !== "object" || typeof msg.type !== "string")',
      );

      // Sidepanel & popup IPC wrappers with traceId + lastError checks
      expect(sp).toContain("async function sendRuntimeMessage(payload");
      expect(sp).toContain("__traceId: traceId");
      expect(sp).toContain("[AI Buddy][SidePanel]");
      expect(sp).toContain("chrome.runtime?.lastError");
      expect(sp).toContain('msg.type === "PLAN_STEP_PROGRESS"');
      expect(sp).toContain("msg.active !== false");
      expect(popup).toContain("sendPopupRuntimeMessage");
      expect(popup).toContain("chrome.runtime?.lastError");
    });

    it("supports full AI action planning, TTS watchdog, 3D pause/resume, OCR compression, and verified host detection", () => {
      const promptSrc = fs.readFileSync(path.join(root, "src/lib/ai/prompt.ts"), "utf-8");
      const serviceSrc = fs.readFileSync(
        path.join(root, "src/lib/buddy-service.server.ts"),
        "utf-8",
      );
      const runtimeSrc = fs.readFileSync(
        path.join(root, "src/lib/extension-buddy-3d-runtime.ts"),
        "utf-8",
      );
      const vendorSrc = fs.readFileSync(
        path.join(root, "extension/vendor/buddy-3d-runtime.js"),
        "utf-8",
      );
      const sp = fs.readFileSync(path.join(root, "extension/sidepanel.js"), "utf-8");

      // Prompt & server support real action planning without defaulting Q&A to click
      expect(promptSrc).toContain('"open_link"');
      expect(promptSrc).toContain('"multi_step"');
      expect(promptSrc).not.toContain("you cannot act in this phase beyond pointing at things");
      expect(serviceSrc).toContain("scrollDirection");
      expect(serviceSrc).toContain("steps");

      // SidePanel executes point/select/check/uncheck/type/form_fill/steps & gates consequential actions
      expect(sp).toContain('res.actionType === "point"');
      expect(sp).toContain('res.actionType === "select"');
      expect(sp).toContain("speechWatchdogTimer");
      expect(sp).toContain("compressImageFileForOcr");
      expect(sp).toContain("/api/public/extension/health");
      expect(sp).toContain("setPaused");

      // 3D runtime + rebuilt bundle expose setPaused
      expect(runtimeSrc).toContain("function setPaused(paused: boolean)");
      expect(vendorSrc).toContain("setPaused");
    });

    it("persists mute/stageSize/conversationBuffer, honors permission ladder, and keeps Tasks/Models resilient offline", () => {
      const html = fs.readFileSync(path.join(root, "extension/sidepanel.html"), "utf-8");
      const sp = fs.readFileSync(path.join(root, "extension/sidepanel.js"), "utf-8");
      const bg = fs.readFileSync(path.join(root, "extension/background.js"), "utf-8");

      // State hydration & persistence
      expect(sp).toContain("hasBootHydrated");
      expect(sp).toContain("persistMutedState");
      expect(sp).toContain("applyStageSize");
      expect(sp).toContain("getPermissionSettings");

      // Guest / offline Tasks & Memories resilience
      expect(sp).toContain("getLocalMemoriesStore");
      expect(sp).toContain("recordTaskExecution");
      expect(sp).toContain("localTaskHistory");

      // Models tab offline fallback + userApiKey ping forwarding + Gemini 4 Hydrogen copy
      expect(sp).toContain("bodyPayload.userApiKey = userApiKey");
      expect(html).toContain("Gemini 4 Hydrogen recommended for fast DOM grounding");

      // Semantic table/list clipboard copy and non-duplicating copy_list plan step
      expect(bg).toContain('queryAllDeep("table tr")');
      expect(bg).toContain("copyExtractedList");
    });

    it("enforces extension CORS preflight, stops buddy-switch storage loop, respects read-only form fill guard, and grounds table Q&A", async () => {
      const { buildExtensionCorsHeadersForOrigin, handleExtensionOptions } =
        await import("../src/lib/extension-cors.server");

      const extHeaders = buildExtensionCorsHeadersForOrigin("chrome-extension://abcdefghijklmnop");
      expect(extHeaders["access-control-allow-origin"]).toBe("chrome-extension://abcdefghijklmnop");
      expect(extHeaders["access-control-allow-credentials"]).toBe("true");
      expect(extHeaders["access-control-allow-methods"]).toContain("OPTIONS");

      const optsRes = handleExtensionOptions(
        new Request("http://localhost:3000/api/public/extension/ask", {
          method: "OPTIONS",
          headers: { Origin: "chrome-extension://abcdefghijklmnop" },
        }),
      );
      expect(optsRes.status).toBe(204);
      expect(optsRes.headers.get("access-control-allow-origin")).toBe(
        "chrome-extension://abcdefghijklmnop",
      );

      const extensionRoutes = [
        "ask.ts",
        "buddies.ts",
        "extract-document.ts",
        "health.ts",
        "memories.ts",
        "models.ts",
        "tasks.ts",
        "test-model.ts",
      ];
      for (const routeFile of extensionRoutes) {
        const routeSrc = fs.readFileSync(
          path.join(root, "src/routes/api/public/extension", routeFile),
          "utf-8",
        );
        expect(routeSrc).toContain("OPTIONS:");
        expect(routeSrc).toContain("extensionJsonResponse");
      }

      const sp = fs.readFileSync(path.join(root, "extension/sidepanel.js"), "utf-8");
      const bg = fs.readFileSync(path.join(root, "extension/background.js"), "utf-8");
      const snap = fs.readFileSync(path.join(root, "extension/snapshot.js"), "utf-8");

      expect(sp).toContain("function switchBuddy(slugOrId, { persist = true, silent = false }");
      expect(sp).toContain("normalizeExtensionAssetUrl");
      expect(sp).toContain("probeBuddyHealthOrigin");
      expect(sp).toContain("localMemories");
      expect(sp).toContain("let planLoopRunning = false;");
      expect(sp).toContain('activePlan.status === "cancelled"');
      expect(sp).toContain(String.raw`\bsubmit\b|file\s*return`);
      expect(bg).toContain('credentials: "omit"');
      expect(bg).toContain("snapshot.tables");
      expect(snap).toContain("tables,");
    });
  });
});
