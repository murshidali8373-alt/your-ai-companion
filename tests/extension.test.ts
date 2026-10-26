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
  });

  it("sidepanel.js wires speech, messaging, and emotion states", () => {
    expect(fs.existsSync(sidepanelJsPath)).toBe(true);
    const js = fs.readFileSync(sidepanelJsPath, "utf-8");
    expect(js).toContain("chrome.runtime.sendMessage");
    expect(js).toContain('type: "ASK"');
    expect(js).toContain("SpeechRecognition");
    expect(js).toContain("setEmotion");
  });

  it("packaged extension zip exists and is ready for download", () => {
    expect(fs.existsSync(zipPath)).toBe(true);
    const stat = fs.statSync(zipPath);
    expect(stat.size).toBeGreaterThan(5000);
  });
});
