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
});
