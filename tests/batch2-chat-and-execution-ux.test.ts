import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parseMarkdownBlocks } from "../src/components/chat-markdown";
import {
  DEFAULT_SCROLL_THRESHOLD_PX,
  evaluateScrollUpdate,
  getAutoScrollBehavior,
  isNearBottom,
} from "../src/hooks/use-smart-auto-scroll";
import {
  INSPECTOR_SOURCE_LABELS,
  deriveExtractedItemsFromSnapshot,
  parseCapturedSnapshotJson,
} from "../src/components/webpage-inspector";
import {
  executeAgentDag,
  getDagController,
  isDagRunActive,
  skipDagSubtask,
} from "../src/lib/agents/dag-executor";
import type { AgentDagRunState, AgentSubtaskSpec } from "../src/lib/agents/types";

const ROOT = process.cwd();

function readProjectFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8");
}

function makeSubtask(overrides: Partial<AgentSubtaskSpec> & { id: string }): AgentSubtaskSpec {
  return {
    id: overrides.id,
    title: overrides.title || `Subtask ${overrides.id}`,
    description: overrides.description || "Test subtask",
    agentId: overrides.agentId || "research",
    dependencies: overrides.dependencies || [],
    priority: overrides.priority ?? 5,
    status: overrides.status || "pending",
    requiresApproval: overrides.requiresApproval ?? false,
    approved: overrides.approved ?? false,
    retryLimit: overrides.retryLimit ?? 0,
    retryCount: overrides.retryCount ?? 0,
  };
}

describe("Batch 2 — Chat Bubbles, Markdown Safety & Smart Sticky Auto-Scroll", () => {
  it("parses headings, lists, blockquotes, tables, fenced code blocks, and paragraphs accurately", () => {
    const sample = [
      "# Heading One",
      "",
      "Intro line with **bold**, `inline()`, and https://example.com/docs.",
      "",
      "> Quoted guidance",
      "",
      "- Bullet A",
      "- Bullet B",
      "",
      "1. Step One",
      "2. Step Two",
      "",
      "| Order | Status |",
      "| --- | --- |",
      "| ORD-101 | Pending |",
      "",
      "```ts",
      "const ok = true;",
      "```",
    ].join("\n");

    const blocks = parseMarkdownBlocks(sample);
    expect(blocks.map((b) => b.type)).toEqual([
      "heading",
      "paragraph",
      "blockquote",
      "ul",
      "ol",
      "table",
      "code",
    ]);

    const codeBlock = blocks.find((b) => b.type === "code");
    expect(codeBlock).toEqual({
      type: "code",
      language: "ts",
      content: "const ok = true;",
    });

    const tableBlock = blocks.find((b) => b.type === "table");
    expect(tableBlock).toEqual({
      type: "table",
      headers: ["Order", "Status"],
      rows: [["ORD-101", "Pending"]],
    });
  });

  it("rejects javascript: and data: URLs and enforces safe wrapping in web and extension renderers", () => {
    const chatMd = readProjectFile("src/components/chat-markdown.tsx");
    expect(chatMd).toContain("function sanitizeHref");
    expect(chatMd).toContain('parsed.protocol !== "http:" && parsed.protocol !== "https:"');
    expect(chatMd).toContain("[overflow-wrap:anywhere]");
    expect(chatMd).toContain('rel="noopener noreferrer"');

    const spJs = readProjectFile("extension/sidepanel.js");
    expect(spJs).toContain("function sanitizeHttpUrl");
    expect(spJs).toContain("function renderSafeMarkdownFragment");
    expect(spJs).toContain('parsed.protocol !== "http:" && parsed.protocol !== "https:"');
    expect(spJs).toContain('a.rel = "noopener noreferrer"');

    const spHtml = readProjectFile("extension/sidepanel.html");
    expect(spHtml).toContain("overflow-wrap: anywhere;");
    expect(spHtml).toContain("max-width: 92%;");
    expect(spHtml).toContain(".history-jump-btn");
  });

  it("tracks sticky bottom state cleanly, pauses auto-scroll when scrolled up, and honors reduced motion", () => {
    expect(isNearBottom({ scrollTop: 500, scrollHeight: 800, clientHeight: 280 })).toBe(true);
    expect(
      isNearBottom(
        { scrollTop: 200, scrollHeight: 800, clientHeight: 280 },
        DEFAULT_SCROLL_THRESHOLD_PX,
      ),
    ).toBe(false);
    expect(isNearBottom({ scrollTop: 0, scrollHeight: 200, clientHeight: 300 })).toBe(true);

    expect(getAutoScrollBehavior(true)).toBe("auto");
    expect(getAutoScrollBehavior(false)).toBe("smooth");

    // When scrolled up and background/streaming message arrives, do NOT yank viewport down; flag unread
    expect(evaluateScrollUpdate({ wasAtBottom: false, userSentMessage: false })).toEqual({
      shouldScroll: false,
      markUnread: true,
    });
    // Sending a new user message re-anchors to bottom even if previously scrolled up
    expect(evaluateScrollUpdate({ wasAtBottom: false, userSentMessage: true })).toEqual({
      shouldScroll: true,
      markUnread: false,
    });
    // Staying near bottom auto-scrolls silently
    expect(evaluateScrollUpdate({ wasAtBottom: true, userSentMessage: false })).toEqual({
      shouldScroll: true,
      markUnread: false,
    });

    const spJs = readProjectFile("extension/sidepanel.js");
    expect(spJs).toContain("const BuddyChatScroll");
    expect(spJs).toContain("ResizeObserver");
    expect(spJs).toContain("prefers-reduced-motion: reduce");
    expect(spJs).toContain("historyJumpBtn");
    expect(spJs).toContain("BuddyChatScroll.afterAppend");

    const voiceDemo = readProjectFile("src/components/voice-demo.tsx");
    expect(voiceDemo).toContain("useSmartAutoScroll");
    expect(voiceDemo).toContain("ChatMarkdown");
    expect(voiceDemo).toContain("Jump to latest");
    expect(voiceDemo).toContain("New messages");
  });
});

describe("Batch 2 — WebpageInspector De-Simulation & Source Classification", () => {
  it("provides explicit source labels including Live, Captured Snapshot, Sandbox Fixture, Sample Data, and Unavailable", () => {
    expect(INSPECTOR_SOURCE_LABELS.live_webpage.badge).toBe("Live Webpage");
    expect(INSPECTOR_SOURCE_LABELS.captured_snapshot.badge).toBe("Captured Snapshot");
    expect(INSPECTOR_SOURCE_LABELS.sandbox_fixture.badge).toBe("Sandbox Dry-Run Fixture");
    expect(INSPECTOR_SOURCE_LABELS.sample_data.badge).toBe("Sample Data");
    expect(INSPECTOR_SOURCE_LABELS.unavailable.badge).toBe("Unavailable");
  });

  it("derives extracted items dynamically from snapshot text without leaking hardcoded sample IDs", () => {
    const flightItems = deriveExtractedItemsFromSnapshot({
      url: "https://travel-demo.com/flights",
      origin: "https://travel-demo.com",
      title: "Book Flight",
      capturedAt: "2026-01-01T00:00:00.000Z",
      headings: [],
      forms: [],
      controls: [],
      alerts: [],
      text: "Flight itinerary DEL-LHR has no order codes.",
      truncated: false,
    });
    expect(flightItems).toEqual([]);

    const meeshoItems = deriveExtractedItemsFromSnapshot({
      url: "https://supplier.meesho.com/panel/orders",
      origin: "https://supplier.meesho.com",
      title: "Meesho Orders",
      capturedAt: "2026-01-01T00:00:00.000Z",
      headings: [],
      forms: [],
      controls: [],
      alerts: [],
      text: "Pending IDs: MSH-982410-IN and MSH-982411-IN.",
      truncated: false,
    });
    expect(meeshoItems.map((i) => i.orderId)).toEqual(["MSH-982410-IN", "MSH-982411-IN"]);
  });

  it("validates captured snapshot JSON payloads and rejects malformed input", () => {
    const valid = parseCapturedSnapshotJson(
      JSON.stringify({
        url: "https://orders.example.com/list",
        title: "Orders Table",
        text: "Order ORD-445512 pending review",
      }),
    );
    expect(valid.origin).toBe("https://orders.example.com");
    expect(valid.headings).toEqual([]);

    expect(() => parseCapturedSnapshotJson("{invalid")).toThrow();
    expect(() => parseCapturedSnapshotJson(JSON.stringify({ url: "https://x.com" }))).toThrow();
  });

  it("removes misleading verification claims and fake Demo Page copy from webpage-inspector.tsx", () => {
    const inspector = readProjectFile("src/components/webpage-inspector.tsx");
    expect(inspector).not.toContain("verified on page.");
    expect(inspector).not.toContain("// Simulate real browser execution");
    expect(inspector).not.toContain("Demo Page:");
    expect(inspector).toContain("Snapshot Source:");
    expect(inspector).toContain("Sandbox dry-run simulated");
    expect(inspector).toContain("ChatMarkdown");
  });
});

describe("Batch 2 — Multi-Agent DAG Execution, Skip Step Integrity & Stop Caveats", () => {
  it("refuses skipping a required step when incomplete downstream steps depend on it, and completes cleanly on final skip", () => {
    const runState: AgentDagRunState = {
      runId: "run_skip_test",
      userId: "user_1",
      objective: "Test skip semantics",
      status: "paused",
      selectedAgents: ["research", "verification"],
      subtasks: [
        makeSubtask({ id: "s1", title: "Fetch Dataset", status: "pending" }),
        makeSubtask({
          id: "s2",
          title: "Verify Report",
          agentId: "verification",
          dependencies: ["s1"],
          status: "pending",
        }),
      ],
      checkpoints: [],
      artifacts: [],
      verifications: [],
      replanCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const blocked = skipDagSubtask(runState, "s1");
    expect(blocked.ok).toBe(false);
    expect(blocked.reason).toContain("depend on it");
    expect(runState.subtasks[0]!.status).toBe("pending");

    // Skipping leaf s2 succeeds, then skipping s1 becomes valid and completes the run cleanly
    const skipLeaf = skipDagSubtask(runState, "s2");
    expect(skipLeaf.ok).toBe(true);
    expect(skipLeaf.completedRun).toBe(false);

    const skipRoot = skipDagSubtask(runState, "s1");
    expect(skipRoot.ok).toBe(true);
    expect(skipRoot.completedRun).toBe(true);
    expect(runState.status).toBe("completed");
  });

  it("records unconfirmedStopNote and keeps status cancelled when stopped mid-flight", async () => {
    const runId = "run_cancel_midflight";
    let resolveStep!: (res: {
      ok: boolean;
      summary: string;
      confidence: number;
      provenance: string;
    }) => void;

    const subtasks = [
      makeSubtask({ id: "step_a", title: "In-flight step" }),
      makeSubtask({ id: "step_b", title: "Queued step", dependencies: ["step_a"] }),
    ];

    const execPromise = executeAgentDag({
      runId,
      userId: "user_1",
      objective: "Test mid-flight cancellation",
      subtasks,
      runner: () =>
        new Promise((resolve) => {
          resolveStep = resolve;
        }),
    });

    // Wait a tick for step_a to enter runner
    await new Promise((r) => setTimeout(r, 15));
    const ctrl = getDagController(runId);
    expect(ctrl).toBeDefined();
    ctrl!.cancel();

    // Finish step_a asynchronously after cancel was clicked
    resolveStep({
      ok: true,
      summary: "Finished after stop",
      confidence: 0.9,
      provenance: "test",
    });

    const finalState = await execPromise;
    expect(finalState.status).toBe("cancelled");
    expect(finalState.unconfirmedStopNote).toContain("in flight");
    expect(finalState.subtasks.find((s) => s.id === "step_b")?.status).toBe("cancelled");
  });

  it("keeps retry_failed strictly scoped to failed steps, wires skip_step across server/extension, and fixes extension Stop/Skip bugs", () => {
    const appFns = readProjectFile("src/lib/app.functions.ts");
    const agentsApi = readProjectFile("src/routes/api/public/extension/agents.ts");
    const tasksTsx = readProjectFile("src/routes/_authenticated/tasks.tsx");
    const workCenter = readProjectFile("src/components/work-center-panel.tsx");
    const spJs = readProjectFile("extension/sidepanel.js");

    // retry_failed must only reset failed steps (never re-run skipped or completed steps)
    expect(appFns).toContain('if (st.status === "failed")');
    expect(agentsApi).toContain('if (st.status === "failed")');

    // skip_step and asyncMode wired end-to-end
    expect(appFns).toContain('data.action === "skip_step"');
    expect(agentsApi).toContain('body.action === "skip_step"');
    expect(appFns).toContain("asyncMode");
    expect(tasksTsx).toContain("controlWebDagRun");
    expect(tasksTsx).toContain("skip_step");
    expect(workCenter).toContain("skip_step");

    // Extension #planSkipBtn checks completion on last step and #planStopBtn notes in-flight actions
    expect(spJs).toContain("if (activePlan.currentStepIndex >= activePlan.steps.length)");
    expect(spJs).toContain("Skipped final step");
    expect(spJs).toContain("const hadInFlight =");
    expect(spJs).toContain("already-dispatched browser action cannot be automatically rolled back");
  });

  it("preserves Batch 1 secret hygiene controls in extension/sidepanel.js and model hub", () => {
    const spJs = readProjectFile("extension/sidepanel.js");
    const modelHub = readProjectFile("src/components/ai-model-hub.tsx");

    expect(spJs).toContain("settingsHasSavedApiKey");
    expect(spJs).toContain("settingsApiKeyMaskedLabel");
    expect(spJs).toContain("syncSettingsApiKeyUi");
    expect(spJs).not.toContain('settingsApiKeyInput").value = userApiKey');
    expect(modelHub).toContain("••••••••");
  });

  it("enforces Batch 2 review fixes: active-run guard, skip_step/retryFailed sync, MutationObserver cleanup, and Buddy scroll reset", async () => {
    const hookSrc = readProjectFile("src/hooks/use-smart-auto-scroll.ts");
    expect(hookSrc).toContain("MutationObserver");
    expect(hookSrc).toContain("mo?.disconnect()");
    expect(hookSrc).toContain("ro?.disconnect()");

    const spJs = readProjectFile("extension/sidepanel.js");
    expect(spJs).toContain("_mutationObserver");
    expect(spJs).toContain("BuddyChatScroll.destroy()");

    const voiceDemo = readProjectFile("src/components/voice-demo.tsx");
    expect(voiceDemo).toContain("smartScroll.notifyUserMessageSent()");

    const appFns = readProjectFile("src/lib/app.functions.ts");
    const agentsApi = readProjectFile("src/routes/api/public/extension/agents.ts");
    expect(appFns).toContain("isDagRunActive");
    expect(appFns).toContain("ctrl?.retryFailed()");
    expect(agentsApi).toContain("isDagRunActive");
    expect(agentsApi).toContain("ctrl?.retryFailed()");

    // Verify controller active-run tracking + skip/retryFailed behavior in live DAG execution
    const runId = "run_batch2_review_regression";
    expect(isDagRunActive(runId)).toBe(false);
    let releaseFirst!: () => void;
    let calls = 0;

    const p = executeAgentDag({
      runId,
      userId: "user_1",
      objective: "Batch 2 review verification",
      subtasks: [
        makeSubtask({ id: "a", title: "Step A" }),
        makeSubtask({ id: "b", title: "Step B", dependencies: ["a"] }),
      ],
      runner: async (sub) => {
        calls++;
        if (sub.id === "a" && calls === 1) {
          await new Promise<void>((r) => {
            releaseFirst = r;
          });
          return { ok: false, summary: "First failure", confidence: 0, provenance: "test" };
        }
        return { ok: true, summary: "Done", confidence: 0.9, provenance: "test" };
      },
    });

    await new Promise((r) => setTimeout(r, 15));
    expect(isDagRunActive(runId)).toBe(true);
    const ctrl = getDagController(runId);
    expect(ctrl).toBeDefined();
    expect(ctrl!.retryFailed()).toBe(false);

    releaseFirst();
    const state = await p;
    expect(isDagRunActive(runId)).toBe(false);
    expect(state.status).toBe("failed");
    expect(state.subtasks[0]!.status).toBe("failed");
    expect(state.subtasks[1]!.status).toBe("skipped");

    // retryFailed on ctrl resets only the failed step and preserves non-failed steps
    const didReset = ctrl!.retryFailed();
    expect(didReset).toBe(true);
    expect(ctrl!.getRunState().subtasks[0]!.status).toBe("pending");
    expect(ctrl!.getRunState().subtasks[1]!.status).toBe("skipped");
  });
});
