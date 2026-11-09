import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Phase 4: Premium Side Panel Redesign & Intelligent Model Experience", () => {
  const root = path.resolve(__dirname, "..");
  const extDir = path.join(root, "extension");
  const sidepanelHtmlPath = path.join(extDir, "sidepanel.html");
  const sidepanelJsPath = path.join(extDir, "sidepanel.js");
  const backgroundJsPath = path.join(extDir, "background.js");

  it("applies the deep midnight glass palette and narrow sidepanel layout", () => {
    const html = fs.readFileSync(sidepanelHtmlPath, "utf-8");
    // Deep midnight canvas and surface tokens
    expect(html).toContain("--bg: #090d16");
    expect(html).toContain("--surface: #101625");
    expect(html).toContain("--primary: #6366f1");
    expect(html).toContain("--accent-cyan: #06b6d4");
    expect(html).toContain("--border: rgba(255, 255, 255, 0.08)");

    // Narrow viewport resilience (320px–420px max constraints and zero horizontal scroll)
    expect(html).toContain("overflow-x: hidden");
    expect(html).toContain("box-sizing: border-box");
  });

  it("provides contextual greeting and 4 quick action cards", () => {
    const html = fs.readFileSync(sidepanelHtmlPath, "utf-8");
    expect(html).toContain('id="greetingTime"');
    expect(html).toContain('id="greetingContext"');
    expect(html).toContain('id="qaExplainPage"');
    expect(html).toContain('id="qaResearch"');
    expect(html).toContain('id="qaWorkWithFiles"');
    expect(html).toContain('id="qaAutomateTask"');

    const js = fs.readFileSync(sidepanelJsPath, "utf-8");
    expect(js).toContain("updateGreetingContext");
    expect(js).toContain("qaExplainPage");
    expect(js).toContain("qaResearch");
    expect(js).toContain("qaWorkWithFiles");
    expect(js).toContain("qaAutomateTask");
  });

  it("includes smart 6-mode selector bar in sidepanel UI and script", () => {
    const html = fs.readFileSync(sidepanelHtmlPath, "utf-8");
    expect(html).toContain('data-mode="auto"');
    expect(html).toContain('data-mode="chat"');
    expect(html).toContain('data-mode="browser"');
    expect(html).toContain('data-mode="research"');
    expect(html).toContain('data-mode="file"');
    expect(html).toContain('data-mode="workflow"');

    const js = fs.readFileSync(sidepanelJsPath, "utf-8");
    expect(js).toContain("currentActiveMode");
    expect(js).toContain(".mode-pill");
  });

  it("features premium command composer with multiline expansion, attachments, context toggle, and rotating placeholders", () => {
    const html = fs.readFileSync(sidepanelHtmlPath, "utf-8");
    expect(html).toContain('id="promptInput"');
    expect(html).toContain('id="attachFileBtn"');
    expect(html).toContain('id="composerFileInput"');
    expect(html).toContain('id="pageContextToggle"');
    expect(html).toContain('id="pageContextStatus"');
    expect(html).toContain('id="voiceBtn"');
    expect(html).toContain('id="sendBtn"');

    const js = fs.readFileSync(sidepanelJsPath, "utf-8");
    expect(js).toContain("NATURAL_PLACEHOLDERS");
    expect(js).toContain("startRotatingPlaceholders");
    expect(js).toContain("promptInputEl.style.height");
    expect(js).toContain("composerFileInput");
    expect(js).toContain("pageContextToggle");
  });

  it("integrates top-bar model quick-pill and dynamic multi-model command center", () => {
    const html = fs.readFileSync(sidepanelHtmlPath, "utf-8");
    expect(html).toContain('id="headerModelPill"');
    expect(html).toContain('id="headerModelLabel"');
    expect(html).toContain('id="modelSelector"');
    expect(html).toContain('id="providerStatusList"');
    expect(html).toContain('id="activeModelRecommendation"');
    expect(html).toContain('id="toggleModelComparisonBtn"');
    expect(html).toContain('id="modelComparisonView"');

    const js = fs.readFileSync(sidepanelJsPath, "utf-8");
    expect(js).toContain("loadModelHubStatus");
    expect(js).toContain("headerModelPill");
    expect(js).toContain("toggleModelComparisonBtn");
    expect(js).toContain("activeModelRecommendation");
    expect(js).toContain("testActiveProviderBtn");
  });

  it("forwards preferredModel and detached page intent to background and server API", () => {
    const spJs = fs.readFileSync(sidepanelJsPath, "utf-8");
    expect(spJs).toContain(
      'preferredModel: preferredModel && preferredModel !== "auto" ? preferredModel : undefined',
    );

    const bgJs = fs.readFileSync(backgroundJsPath, "utf-8");
    expect(bgJs).toMatch(
      /ask\(\s*msg\.question,\s*msg\.intent,\s*msg\.history,\s*msg\.buddySlug,\s*msg\.customBuddyId,\s*msg\.preferredModel\s*\)/,
    );
    expect(bgJs).toContain("preferredModel: preferredModel || undefined");
  });

  it("preserves task recovery, live checkpoints, and all 16 Buddies in sidepanel", () => {
    const html = fs.readFileSync(sidepanelHtmlPath, "utf-8");
    expect(html).toContain('id="buddyAvatar"');
    expect(html).toContain('id="savedCheckpointCard"');
    expect(html).toContain('id="taskProgressBar"');
    expect(html).toContain('id="planPauseResumeBtn"');
    expect(html).toContain('id="planSkipBtn"');
    expect(html).toContain('id="planStopBtn"');

    const js = fs.readFileSync(sidepanelJsPath, "utf-8");
    expect(js).toContain("BUDDIES_REGISTRY");
    expect(js).toContain("handleInFlightControlCommand");
  });
});
