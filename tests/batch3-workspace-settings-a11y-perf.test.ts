import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  clearScopedStoreForTests,
  deleteWorkspaceBinaryFile,
  listWorkspaceFiles,
  saveWorkspaceBinaryFile,
} from "../src/lib/persistence/store.server";

const ROOT = process.cwd();
const TEST_SCOPE = "batch3_workspace_delete_scope";

function readProjectFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8");
}

afterEach(() => {
  clearScopedStoreForTests(TEST_SCOPE);
});

describe("Batch 3 — Workspace Persistence & Safe Deletion", () => {
  it("lists, deletes, and confines workspace files safely inside the user scope directory", async () => {
    const saved = await saveWorkspaceBinaryFile(
      TEST_SCOPE,
      "orders.csv",
      Buffer.from("order_id,status\nORD-1,pending\n", "utf8"),
    );
    expect(saved.safeName).toBe("orders.csv");

    const before = await listWorkspaceFiles(TEST_SCOPE);
    expect(before.map((f) => f.fileName)).toContain("orders.csv");

    const deleted = await deleteWorkspaceBinaryFile(TEST_SCOPE, "orders.csv");
    expect(deleted).toBe(true);
    expect(await deleteWorkspaceBinaryFile(TEST_SCOPE, "orders.csv")).toBe(false);

    const after = await listWorkspaceFiles(TEST_SCOPE);
    expect(after).toEqual([]);

    // Path traversal attempts sanitize to safe basename inside scope dir instead of escaping
    await saveWorkspaceBinaryFile(TEST_SCOPE, "../escape.txt", Buffer.from("safe", "utf8"));
    const scopedFiles = await listWorkspaceFiles(TEST_SCOPE);
    expect(scopedFiles.map((f) => f.fileName)).toEqual(["escape.txt"]);
  });

  it("wires web workspace delete confirmation, loading/empty/error states, and status feedback", () => {
    const workCenter = readProjectFile("src/components/work-center-panel.tsx");
    expect(workCenter).toContain("deleteWebWorkspaceFile");
    expect(workCenter).toContain("pendingDeleteFileName");
    expect(workCenter).toContain("pendingDeleteWorkflowId");
    expect(workCenter).toContain("workspaceFeedback");
    expect(workCenter).toContain("overview.isError");
    expect(workCenter).toContain("isUploadingFile");
  });
});

describe("Batch 3 — Workflows, Memory, Buddies & Settings Confirmation & States", () => {
  it("adds inline confirmation before destructive deletes/resets across web and extension without window.confirm/alert", () => {
    const dashboard = readProjectFile("src/routes/_authenticated/dashboard.tsx");
    const buddies = readProjectFile("src/routes/_authenticated/buddies.tsx");
    const settings = readProjectFile("src/routes/_authenticated/settings.tsx");
    const spHtml = readProjectFile("extension/sidepanel.html");
    const spJs = readProjectFile("extension/sidepanel.js");

    // Web routes: inline confirmations & loading/error states
    expect(dashboard).toContain("confirmClearMemories");
    expect(dashboard).toContain("pendingDeleteMemoryId");
    expect(dashboard).toContain('role="alertdialog"');
    expect(buddies).toContain("pendingDeleteId");
    expect(settings).toContain("isLoading");
    expect(settings).toContain("isError");
    expect(settings).toContain("refetch");
    expect(settings).toContain("savingProfile");

    // Extension: inline confirmation for workspace artifacts, workflows, memories, and storage reset
    expect(spJs).toContain("pendingDeleteArtifactId");
    expect(spJs).toContain("pendingDeleteWorkflowId");
    expect(spJs).toContain("pendingDeleteMemoryKey");
    expect(spHtml).toContain("settingsClearStorageConfirmRow");
    expect(spJs).toContain("settingsConfirmClearStorageBtn");

    // Never use native blocking browser dialogs
    for (const src of [dashboard, buddies, settings, spJs]) {
      expect(src).not.toMatch(/\bwindow\.(alert|confirm)\s*\(/);
    }

    // Batch 1 secret hygiene preserved in extension settings & connectors
    expect(spJs).toContain("settingsHasSavedApiKey");
    expect(spJs).toContain("settingsApiKeyMaskedLabel");
    expect(spHtml).toContain('id="settingsApiKeyInput"');
    expect(spHtml).toContain('type="password"');
  });
});

describe("Batch 3 — Extension Accessibility, Narrow 320–360px Responsiveness & Performance", () => {
  it("enforces ARIA tablist/tabpanel semantics, button carousel items, associated labels, and 320-360px responsive styles", () => {
    const spHtml = readProjectFile("extension/sidepanel.html");
    const spJs = readProjectFile("extension/sidepanel.js");

    expect(spHtml).toContain('role="tablist"');
    expect(spHtml).toContain('role="tab"');
    expect(spHtml).toContain('role="tabpanel"');
    expect(spHtml).toContain('aria-controls="tabChat"');
    expect(spHtml).toContain('for="avatarRenderMode"');
    expect(spHtml).toContain('for="sizeSelect"');
    expect(spHtml).toContain('for="muteToggle"');
    expect(spHtml).toContain('for="settingsPermissionLevel"');
    expect(spHtml).toContain('for="settingsConsequentialGate"');
    expect(spHtml).toContain("@media (max-width: 360px)");
    expect(spHtml).toContain(
      '<button\n            type="button"\n            id="headerModelPill"',
    );

    // Keyboard tab navigation and semantic button buddy cards
    expect(spJs).toContain("aria-selected");
    expect(spJs).toContain('document.createElement("button")');
    expect(spJs).toContain("aria-pressed");
    expect(spJs).toContain("ArrowRight");
    expect(spJs).toContain("ArrowLeft");
  });

  it("throttles gaze mousemove tracking and pauses timers/observers when hidden or unloaded", () => {
    const spJs = readProjectFile("extension/sidepanel.js");
    const buddyHealth = readProjectFile("src/hooks/use-buddy-health.ts");
    const talkingBuddy = readProjectFile("src/components/talking-buddy-character.tsx");

    expect(spJs).toContain("requestAnimationFrame(applyGazeTrackingFrame)");
    expect(spJs).toContain("cancelAnimationFrame(gazeRafId)");
    expect(spJs).toContain("stopBlinking()");
    expect(spJs).toContain("stopRotatingPlaceholders()");
    expect(spJs).toContain('window.addEventListener("pagehide"');

    expect(buddyHealth).toContain("document.hidden");
    expect(talkingBuddy).toContain("document.hidden");
  });
});
