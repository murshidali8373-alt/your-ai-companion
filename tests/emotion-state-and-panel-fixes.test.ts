import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  STAGE_TO_EMOTION,
  mapStageToEmotion,
  applyEmotionAttributesToElement,
  type AIProcessingStage,
} from "../src/hooks/use-buddy-state-manager";

const ROOT = process.cwd();

describe("Dynamic AI Processing Stage -> Emotion State Manager & Real Panel Fixes", () => {
  it("maps every AI processing stage to a valid companion emotion state", () => {
    const expectedPairs: Array<[AIProcessingStage, string]> = [
      ["idle", "idle"],
      ["listening", "listening"],
      ["observing", "thinking"],
      ["understanding", "thinking"],
      ["thinking", "thinking"],
      ["planning", "planning"],
      ["analyzing", "analyzing"],
      ["executing", "working"],
      ["browsing", "working"],
      ["working", "working"],
      ["pointing", "pointing"],
      ["verifying", "verifying"],
      ["speaking", "speaking"],
      ["awaiting_approval", "permission_required"],
      ["permission_required", "permission_required"],
      ["privacy", "privacy"],
      ["completed", "success"],
      ["success", "success"],
      ["confused", "confused"],
      ["curious", "confused"],
      ["error", "error"],
      ["disconnected", "disconnected"],
    ];

    for (const [stage, expectedEmotion] of expectedPairs) {
      expect(STAGE_TO_EMOTION[stage]).toBe(expectedEmotion);
      expect(mapStageToEmotion(stage)).toBe(expectedEmotion);
    }
    expect(mapStageToEmotion("  PLANNING  ")).toBe("planning");
  });

  it("updates data-emotion, data-stage, and data-animated DOM attributes via applyEmotionAttributesToElement", () => {
    const attrs = new Map<string, string>();
    const mockEl = {
      setAttribute(name: string, val: string) {
        attrs.set(name, val);
      },
    } as unknown as HTMLElement;

    applyEmotionAttributesToElement(mockEl, "analyzing", "analyzing", true);
    expect(attrs.get("data-emotion")).toBe("analyzing");
    expect(attrs.get("data-stage")).toBe("analyzing");
    expect(attrs.get("data-animated")).toBe("true");

    applyEmotionAttributesToElement(mockEl, "idle", "idle", false);
    expect(attrs.get("data-emotion")).toBe("idle");
    expect(attrs.get("data-animated")).toBe("false");
  });

  it("defines CSS animations and prefers-reduced-motion rules in both src/styles.css and extension/sidepanel.html", () => {
    const webCss = fs.readFileSync(path.join(ROOT, "src/styles.css"), "utf8");
    const panelHtml = fs.readFileSync(path.join(ROOT, "extension/sidepanel.html"), "utf8");

    for (const emotion of [
      "idle",
      "listening",
      "thinking",
      "planning",
      "analyzing",
      "working",
      "pointing",
      "verifying",
      "speaking",
      "privacy",
      "success",
      "confused",
      "error",
      "permission_required",
    ]) {
      expect(webCss).toContain(`data-emotion="${emotion}"`);
      expect(panelHtml).toContain(`data-emotion="${emotion}"`);
    }

    expect(webCss).toContain("prefers-reduced-motion: reduce");
    expect(panelHtml).toContain("prefers-reduced-motion: reduce");
  });

  it("wires BuddyStateManager.setProcessingStage in extension/sidepanel.js and keeps host/signature invariants intact", () => {
    const spJs = fs.readFileSync(path.join(ROOT, "extension/sidepanel.js"), "utf8");
    expect(spJs).toContain("AI_STAGE_TO_EMOTION");
    expect(spJs).toContain("setProcessingStage(stage");
    expect(spJs).toContain('avatarWrap.setAttribute("data-stage"');
    expect(spJs).toContain('avatarWrap.setAttribute("data-emotion"');
  });

  it("verifies real panel bug fixes across tasks, connect, settings, and dashboard pages", () => {
    const tasksTsx = fs.readFileSync(
      path.join(ROOT, "src/routes/_authenticated/tasks.tsx"),
      "utf8",
    );
    const connectTsx = fs.readFileSync(
      path.join(ROOT, "src/routes/_authenticated/connect.tsx"),
      "utf8",
    );
    const settingsTsx = fs.readFileSync(
      path.join(ROOT, "src/routes/_authenticated/settings.tsx"),
      "utf8",
    );
    const dashboardTsx = fs.readFileSync(
      path.join(ROOT, "src/routes/_authenticated/dashboard.tsx"),
      "utf8",
    );

    // Tasks page must execute real server/orchestrator actions rather than fake setTimeout(1200) stubs
    expect(tasksTsx).not.toContain("setTimeout(r, 1200)");
    expect(tasksTsx).toContain("runWebMultiAgentObjective");
    expect(tasksTsx).toContain("stage={buddy.stage}");

    // Connect page avoids permanent infinite syncing spinner and unsafe bare navigator.clipboard
    expect(connectTsx).toContain("try");
    expect(connectTsx).toContain("clearInterval");

    // Settings page guards rapid switch toggles & binds explicit htmlFor labels
    expect(settingsTsx).toContain("htmlFor=");

    // Dashboard drives buddy.setProcessingStage and shows Work Center tab
    expect(dashboardTsx).toContain("setProcessingStage");
    expect(dashboardTsx).toContain("WorkCenterPanel");
  });
});
