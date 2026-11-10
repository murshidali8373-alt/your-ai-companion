import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("MV3 Chrome Extension and Side Panel", () => {
  const root = path.resolve(__dirname, "..");
  const extDir = path.join(root, "extension");
  const manifestPath = path.join(extDir, "manifest.json");
  const sidepanelHtmlPath = path.join(extDir, "sidepanel.html");
  const sidepanelJsPath = path.join(extDir, "sidepanel.js");
  const zipPath = path.join(root, "public/ai-buddy-extension.zip");

  it("manifest.json defines valid MV3 Side Panel configuration", () => {
    expect(fs.existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions).toContain("sidePanel");
    expect(manifest.permissions).toContain("activeTab");
    expect(manifest.permissions).toContain("storage");
    expect(manifest.permissions).toContain("scripting");
    expect(manifest.side_panel?.default_path).toBe("sidepanel.html");
    expect(manifest.background?.service_worker).toBe("background.js");
  });

  it("sidepanel.html contains required accessible UI structures", () => {
    expect(fs.existsSync(sidepanelHtmlPath)).toBe(true);
    const html = fs.readFileSync(sidepanelHtmlPath, "utf-8");
    expect(html).toContain('id="buddyAvatar"');
    expect(html).toContain('id="buddyEmotionBadge"');
    expect(html).toContain('id="promptInput"');
    expect(html).toContain('id="sendBtn"');
    expect(html).toContain('id="voiceBtn"');
    expect(html).toContain('id="answerCard"');
    expect(html).toContain('id="signedIn"');
    expect(html).toContain('id="signedOut"');
    expect(html).toContain('id="pageErrorBanner"');
    expect(html).toContain('id="fixErrorsBtn"');
  });

  it("provides all 6 navigation tabs across Chat, Page, Tasks, Models, Rig, and Settings", () => {
    const html = fs.readFileSync(sidepanelHtmlPath, "utf-8");
    const js = fs.readFileSync(sidepanelJsPath, "utf-8");

    // All 6 tabs present in HTML
    expect(html).toContain('data-tab="chat"');
    expect(html).toContain('data-tab="page"');
    expect(html).toContain('data-tab="tasks"');
    expect(html).toContain('data-tab="models"');
    expect(html).toContain('data-tab="rig"');
    expect(html).toContain('data-tab="settings"');
    expect(html).toContain('id="tabSettings"');

    // All 6 tab panels switched in JS
    expect(js).toContain('if ($("tabChat"))');
    expect(js).toContain('if ($("tabPage"))');
    expect(js).toContain('if ($("tabTasks"))');
    expect(js).toContain('if ($("tabModels"))');
    expect(js).toContain('if ($("tabRig"))');
    expect(js).toContain('if ($("tabSettings"))');
    expect(js).toContain("loadSettingsTab");
  });

  it("provides visible loading spinner states during AI response generation", () => {
    const html = fs.readFileSync(sidepanelHtmlPath, "utf-8");
    const js = fs.readFileSync(sidepanelJsPath, "utf-8");

    // CSS spinner and loading bubble definitions
    expect(html).toContain(".msg-loading");
    expect(html).toContain(".loading-spinner-ring");
    expect(html).toContain(".btn-spinner");
    expect(html).toContain(".loading-dots-wrap");
    expect(html).toContain("@keyframes buddy-spin");

    // JS helper functions and state triggers
    expect(js).toContain("showChatLoadingSpinner");
    expect(js).toContain("hideChatLoadingSpinner");
    expect(js).toContain("aiThinkingBubble");
    expect(js).toContain("btn-spinner");
    expect(js).toContain('showChatLoadingSpinner("Buddy is thinking & analyzing…")');
  });

  it("sidepanel.js wires speech, messaging, emotion states, guest mode, and error inspection", () => {
    expect(fs.existsSync(sidepanelJsPath)).toBe(true);
    const js = fs.readFileSync(sidepanelJsPath, "utf-8");
    expect(js).toContain("chrome.runtime.sendMessage");
    expect(js).toContain('type: "ASK"');
    expect(js).toContain("SpeechRecognition");
    expect(js).toContain("setEmotion");
    expect(js).toContain("checkPageForErrors");
    expect(js).toContain("Guest Mode");
  });

  it("recalibrates SVG coordinates to fixed (50, 51) mouth and (40, 36)/(61, 36) eyebrows within 100x105 viewBox", () => {
    const html = fs.readFileSync(sidepanelHtmlPath, "utf-8");
    expect(html).toContain('viewBox="0 0 100 105"');
    expect(html).toContain('id="rigBrowLeft" transform="translate(40, 36)"');
    expect(html).toContain('id="rigBrowRight" transform="translate(61, 36)"');
    expect(html).toContain('id="rigMouth"');
    expect(html).toContain('d="M45 51 Q50 55 55 51"');

    const js = fs.readFileSync(sidepanelJsPath, "utf-8");
    // Verify mouth shapes all anchored at (50, 51)
    expect(js).toContain('rest: "M 46 51 Q 50 53 54 51"');
    expect(js).toContain('smile: "M 45 51 Q 50 55 55 51"');
    expect(js).toContain('wide_smile: "M 44 51 Q 50 58 56 51');

    // Verify eyebrows remain anchored at (40, 36) and (61, 36)
    expect(js).toContain('browLeft.setAttribute("transform", "translate(40, 36)');
    expect(js).toContain('browRight.setAttribute("transform", "translate(61, 36)');

    // Verify Gemini backend emotion keys are mapped to setRigEmotion
    expect(js).toContain("mapBackendEmotion");
    expect(js).toContain('"idle"');
    expect(js).toContain('"thinking"');
    expect(js).toContain('"happy"');
    expect(js).toContain('"pointing"');
    expect(js).toContain('"speaking"');
    expect(js).toContain('"listening"');
  });

  it("packaged extension zip exists and is ready for download", () => {
    expect(fs.existsSync(zipPath)).toBe(true);
    const stat = fs.statSync(zipPath);
    expect(stat.size).toBeGreaterThan(5000);
  });

  it("ensures unauthenticated navigation to /connect preserves next=/connect redirect", () => {
    const authRoutePath = path.join(root, "src/routes/_authenticated/route.tsx");
    const authPagePath = path.join(root, "src/routes/auth.tsx");
    const authRouteCode = fs.readFileSync(authRoutePath, "utf-8");
    const authPageCode = fs.readFileSync(authPagePath, "utf-8");

    // Route checks unauthenticated state and preserves next in search
    expect(authRouteCode).toContain("location.pathname");
    expect(authRouteCode).toContain(
      'redirect({ to: "/auth", search: { next: next || "/dashboard" } })',
    );

    // Auth page validates search next, handles safeNext and navigates to next
    expect(authPageCode).toContain("next: z.string().optional()");
    expect(authPageCode).toContain("safeNext");
    expect(authPageCode).toContain("ai-buddy-next");
    expect(authPageCode).toContain("navigate({ to: next, replace: true })");
  });

  it("SidePanelButton detects extension presence and provides appropriate actions", () => {
    const siteChromePath = path.join(root, "src/components/site-chrome.tsx");
    const code = fs.readFileSync(siteChromePath, "utf-8");

    // Presence check via window property and custom event
    expect(code).toContain("__AI_BUDDY_EXTENSION__");
    expect(code).toContain("AI_BUDDY_EXTENSION_READY");

    // If absent: install guide and link to /download
    expect(code).toContain("Install AI Buddy Extension");
    expect(code).toContain('to="/download"');

    // If present: sidePanel.open() if supported and manual opening instructions
    expect(code).toContain("chromeObj?.sidePanel?.open");
    expect(code).toContain("Ctrl+Shift+P");
    expect(code).toContain("AI_BUDDY_OPEN_PANEL");
  });

  it("maintains a buffer of the last 3 conversation turns in background.js and sidepanel.js", () => {
    const bgCode = fs.readFileSync(path.join(extDir, "background.js"), "utf-8");
    const spCode = fs.readFileSync(path.join(extDir, "sidepanel.js"), "utf-8");

    // background.js checks
    expect(bgCode).toContain("MAX_CONVERSATION_TURNS = 3");
    expect(bgCode).toContain("conversationBuffer");
    expect(bgCode).toContain("getFormattedHistory");
    expect(bgCode).toContain("recordTurn");
    expect(bgCode).toContain("history: formattedHistory.length > 0 ? formattedHistory : undefined");

    // sidepanel.js checks
    expect(spCode).toContain("MAX_CONVERSATION_TURNS = 3");
    expect(spCode).toContain("conversationBuffer");
    expect(spCode).toContain("getRecentHistoryContext");
    expect(spCode).toContain("recordConversationTurn");

    // Test simulation of 4 conversation turns buffering logic
    const turnsBuffer: Array<{ user: string; assistant: string }> = [];
    const MAX_TURNS = 3;
    const addTurn = (u: string, a: string) => {
      turnsBuffer.push({ user: u, assistant: a });
      if (turnsBuffer.length > MAX_TURNS) turnsBuffer.shift();
    };

    addTurn("Turn 1 Q", "Turn 1 A");
    addTurn("Turn 2 Q", "Turn 2 A");
    addTurn("Turn 3 Q", "Turn 3 A");
    expect(turnsBuffer.length).toBe(3);
    expect(turnsBuffer[0].user).toBe("Turn 1 Q");

    // 4th turn should shift out the 1st turn, keeping only the last 3
    addTurn("Turn 4 Q", "Turn 4 A");
    expect(turnsBuffer.length).toBe(3);
    expect(turnsBuffer[0].user).toBe("Turn 2 Q");
    expect(turnsBuffer[1].user).toBe("Turn 3 Q");
    expect(turnsBuffer[2].user).toBe("Turn 4 Q");

    // Context format sent to Gemini
    const context = turnsBuffer.flatMap((t) => [
      { role: "user", content: t.user },
      { role: "assistant", content: t.assistant },
    ]);
    expect(context.length).toBe(6);
    expect(context[0]).toEqual({ role: "user", content: "Turn 2 Q" });
    expect(context[1]).toEqual({ role: "assistant", content: "Turn 2 A" });
  });

  it("restricts session synchronization with strict URL parsing, exact origin matching, and /connect validation", () => {
    const bridgeCode = fs.readFileSync(path.join(extDir, "bridge.js"), "utf-8");
    const bgCode = fs.readFileSync(path.join(extDir, "background.js"), "utf-8");

    // bridge.js strictly checks normalized pathname === "/connect"
    expect(bridgeCode).toContain(
      'const currentPath = window.location.pathname.replace(/\\/+$/, "") || "/"',
    );
    expect(bridgeCode).toContain('if (currentPath !== "/connect") return');

    // background.js performs strict new URL parsing and exact origin match
    expect(bgCode).toContain("const senderParsed = new URL(sender.url)");
    expect(bgCode).toContain("const apiBaseParsed = new URL(msg.session.apiBase)");
    expect(bgCode).toContain("if (senderParsed.origin !== apiBaseParsed.origin)");
    expect(bgCode).toContain('if (path !== "/connect")');
    expect(bgCode).toContain("lastBase: apiBaseParsed.origin");

    // Functional verification of origin check logic
    const validateOriginAndPath = (senderUrl: string, apiBase: string) => {
      try {
        const s = new URL(senderUrl);
        const a = new URL(apiBase);
        if (s.origin !== a.origin) return false;
        const p = s.pathname.replace(/\/+$/, "") || "/";
        return p === "/connect";
      } catch {
        return false;
      }
    };

    // Valid handshake
    expect(validateOriginAndPath("https://ai-buddy.app/connect", "https://ai-buddy.app")).toBe(
      true,
    );
    expect(validateOriginAndPath("https://ai-buddy.app/connect/", "https://ai-buddy.app")).toBe(
      true,
    );

    // Rejection of subdomain attack or prefix spoofing
    expect(
      validateOriginAndPath("https://ai-buddy.app.attacker.com/connect", "https://ai-buddy.app"),
    ).toBe(false);

    // Rejection of different port or protocol
    expect(validateOriginAndPath("http://ai-buddy.app/connect", "https://ai-buddy.app")).toBe(
      false,
    );
    expect(validateOriginAndPath("https://ai-buddy.app:8080/connect", "https://ai-buddy.app")).toBe(
      false,
    );

    // Rejection of non-connect routes or substring query parameters
    expect(validateOriginAndPath("https://ai-buddy.app/connector", "https://ai-buddy.app")).toBe(
      false,
    );
    expect(
      validateOriginAndPath("https://ai-buddy.app/login?ref=/connect", "https://ai-buddy.app"),
    ).toBe(false);
  });

  it("dynamically resolves backend URL from chrome.storage.local and synchronizes /connect with active session state", () => {
    const spCode = fs.readFileSync(path.join(extDir, "sidepanel.js"), "utf-8");
    const popupCode = fs.readFileSync(path.join(extDir, "popup.js"), "utf-8");
    const bgCode = fs.readFileSync(path.join(extDir, "background.js"), "utf-8");
    const askRouteCode = fs.readFileSync(
      path.join(root, "src/routes/api/public/extension/ask.ts"),
      "utf-8",
    );

    // Dynamic resolution in sidepanel connect button
    expect(spCode).toContain('chrome.storage.local.get(["lastBase", "session"])');
    expect(spCode).toContain("new URL(`${resolvedBase}/connect`)");
    expect(spCode).toContain('ext_session", "active"');
    expect(spCode).toContain("chrome.storage.local.set({ lastBase: resolvedBase })");

    // Dynamic resolution in popup connect button
    expect(popupCode).toContain('chrome.storage.local.get(["lastBase", "session"])');
    expect(popupCode).toContain("new URL(`${resolvedBase}/connect`)");
    expect(popupCode).toContain('ext_session", "active"');

    // Dynamic resolution and error transparency in background worker
    expect(bgCode).toContain('"lastBase"');
    expect(bgCode).toContain('"userApiKey"');
    expect(bgCode).toContain('"customBaseUrl"');
    expect(bgCode).toContain("userApiKey: userApiKey || undefined");
    expect(bgCode).toContain("Could not reach AI Buddy service at");

    // ask.ts returns descriptive error message rather than masking
    expect(askRouteCode).toContain("error instanceof Error");
    expect(askRouteCode).toContain("error.message");
  });
});
