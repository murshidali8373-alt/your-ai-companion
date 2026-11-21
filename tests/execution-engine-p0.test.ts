import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildSystemPrompt, parseBuddyReply } from "../src/lib/ai/prompt";

describe("AI Buddy Core Execution Engine + Downloads + Scoped Isolation (P0)", () => {
  const root = path.resolve(__dirname, "..");
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "extension/manifest.json"), "utf-8"));
  const sidepanelJs = fs.readFileSync(path.join(root, "extension/sidepanel.js"), "utf-8");
  const backgroundJs = fs.readFileSync(path.join(root, "extension/background.js"), "utf-8");
  const popupHtml = fs.readFileSync(path.join(root, "extension/popup.html"), "utf-8");
  const popupJs = fs.readFileSync(path.join(root, "extension/popup.js"), "utf-8");

  it("declares downloads permission in MV3 manifest and extended planner schema", () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions).toContain("downloads");

    const promptText = buildSystemPrompt({
      persona: {
        name: "Friendly Buddy",
        personality: "helpful",
        teachingStyle: "direct",
        humorLevel: 2,
        seriousness: 3,
        language: "hinglish",
        expertise: ["browser"],
        systemPrompt: "Help the user.",
      },
      permission: "interact",
      memories: [],
      privacyMode: false,
      chatMode: "page",
    });
    expect(promptText).toContain('"download"');
    expect(promptText).toContain('"open_website"');
    expect(promptText).toContain('"verify_page"');

    const parsed = parseBuddyReply(
      JSON.stringify({
        answer: "Opening Flipkart seller portal and downloading invoice.",
        highlight: null,
        confidence: "high",
        needs: null,
        emotion: "happy",
        actionType: "download",
        steps: [
          { title: "Open portal", action: "open_website", url: "https://seller.flipkart.com" },
          { title: "Fill field", action: "fill_field", textTarget: "email", value: "a@b.com" },
          { title: "Download report", action: "download", textTarget: "Download PDF" },
          { title: "Verify", action: "verify_page", expectedText: "Completed" },
          { title: "Wait", action: "wait_for", waitMs: 500 },
        ],
      }),
    );
    expect(parsed.actionType).toBe("download");
    expect(parsed.steps?.map((s) => s.action)).toEqual([
      "open_website",
      "fill_field",
      "download",
      "verify_page",
      "wait_for",
    ]);
  });

  it("supports chrome.downloads tracking, safe URL validation, and obstruction-aware alternate clicks in background.js", () => {
    expect(backgroundJs).toContain('msg.type === "GET_HEALTH"');
    expect(backgroundJs).toContain('msg.type === "DOWNLOAD_FILE"');
    expect(backgroundJs).toContain('msg.type === "GET_DOWNLOAD_STATUS"');
    expect(backgroundJs).toContain("function isAllowedDownloadUrl");
    expect(backgroundJs).toContain("chrome.downloads.download");
    expect(backgroundJs).toContain("waitForTriggeredDownload");

    expect(backgroundJs).toContain("document.elementFromPoint");
    expect(backgroundJs).toContain('opts?.clickMethod === "alternate"');
    expect(backgroundJs).toContain("validationError");
    expect(backgroundJs).toContain('step.action === "open_website"');
    expect(backgroundJs).toContain('step.action === "download"');
    expect(backgroundJs).toContain('step.action === "verify_page"');
  });

  it("implements AI planner consultation, auth-wall pause, alternate click recovery, portal disambiguation, and user-scoped storage in sidepanel.js", () => {
    expect(sidepanelJs).toContain("normalizePlannerSteps");
    expect(sidepanelJs).toContain("authWallDetected");
    expect(sidepanelJs).toContain('clickMethod: "alternate"');
    expect(sidepanelJs).toContain("_aiRecovered");
    expect(sidepanelJs).toContain("lastExecutionAttempt");
    expect(sidepanelJs).toContain("RETRY_LAST_CLICK");

    // Curated portals & Amazon/Flipkart consumer-vs-seller ambiguity handling
    expect(sidepanelJs).toContain("https://seller.flipkart.com");
    expect(sidepanelJs).toContain("https://sellercentral.amazon.in");
    expect(sidepanelJs).toContain("OPEN_WEBSITE");
    expect(sidepanelJs).toContain("DOWNLOAD");

    // Comma-safe & value-first Hinglish fill extraction
    expect(sidepanelJs).toContain("bareVerbStartRe");

    // User-scoped profile/memories/history isolation
    expect(sidepanelJs).toContain("function getActiveScopeKey");
    expect(sidepanelJs).toContain("async function getScopedProfile");
    expect(sidepanelJs).toContain("async function setScopedProfile");
    expect(sidepanelJs).toContain("scopedLocalMemories");
    expect(sidepanelJs).toContain("scopedTaskHistory");
    expect(sidepanelJs).toContain("localCustomBuddies");
  });

  it("exposes live health probe and Guest Mode controls in extension popup", () => {
    expect(popupHtml).toContain('id="healthLine"');
    expect(popupHtml).toContain('id="useGuest"');
    expect(popupHtml).toContain('id="upgradeConnect"');
    expect(popupJs).toContain('type: "GET_HEALTH"');
    expect(popupJs).toContain("Guest Mode");
  });
});
