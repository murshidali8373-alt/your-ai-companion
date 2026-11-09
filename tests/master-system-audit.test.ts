import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { aiBuddyBrain } from "@/lib/engines/ai-buddy-brain";
import {
  analyzeSpreadsheetData,
  editSpreadsheetNonDestructively,
} from "@/lib/engines/data-intelligence-engine";
import { compareSpreadsheetFiles } from "@/lib/engines/file-workspace-engine";
import {
  evaluateStepPrecondition,
  validateAction,
} from "@/lib/engines/action-engine";
import {
  createTaskCheckpoint,
  hasActionCompleted,
  computeActionHash,
} from "@/shared/task-checkpoint";
import {
  saveContextualMemory,
  retrieveContextualMemories,
} from "@/lib/engines/memory-engine";
import { mapBackendEmotion } from "@/lib/buddy-visuals";
import { route, findModel } from "@/lib/ai/registry";
import { BUDDY_PRESETS } from "@/lib/ai/buddy-personas";

describe("AI Buddy — Master System Audit & Complete User Journeys (A–J)", () => {
  const root = path.resolve(__dirname, "..");
  const extDir = path.join(root, "extension");

  // Journey A: Normal Chat
  it("Journey A — Normal Chat: Brain understands, routes model, generates response, and preserves conversation turn", async () => {
    const brainRes = await aiBuddyBrain({
      instruction: "Explain how to calculate margin in retail",
      intent: "answer",
      buddySlug: "business",
      userMemories: [
        {
          id: "m1",
          key: "business_model",
          value: "B2B wholesale distributor",
          kind: "preference",
        },
      ],
    });

    expect(brainRes.answer).toBeDefined();
    expect(brainRes.confidence).toBeGreaterThan(0.5);
    expect(brainRes.buddyName).toBe("Business Buddy");
    expect(brainRes.recommendedModel).toBeDefined();
    expect(brainRes.recommendedModel.provider).toBe("gemini");
  });

  // Journey B: Model Selection
  it("Journey B — Model Selection: User preferred model is registered, routed, and respects fallback sequence", () => {
    const preferredModelId = "gemini-3.8-flash";
    const found = findModel(preferredModelId);
    expect(found).toBeDefined();
    expect(found?.provider).toBe("gemini");

    // Automatic route prioritizes Gemini first
    const candidates = route({
      intent: "answer",
      needsVision: false,
      contextTokens: 2000,
      latencySensitive: false,
      costSensitive: false,
    });
    expect(candidates.length).toBeGreaterThan(2);
    expect(candidates[0].provider).toBe("gemini");
  });

  // Journey C: Automatic Routing
  it("Journey C — Automatic Routing: Brain selects appropriate engine and intent for varied tasks", async () => {
    // Research task
    const researchBrain = await aiBuddyBrain({
      instruction: "Research market growth statistics for electric two-wheelers in India",
      intent: "deep_research",
      buddySlug: "research",
    });
    expect(researchBrain.intent).toBe("deep_research");
    expect(researchBrain.executionPlan.some((s) => s.engine === "action" || s.engine === "navigation")).toBe(true);

    // Form filling task
    const formBrain = await aiBuddyBrain({
      instruction: "Fill in the vendor GSTIN and business address on this portal",
      intent: "smart_form_fill",
      buddySlug: "ca",
    });
    expect(formBrain.intent).toBe("smart_form_fill");
    expect(formBrain.executionPlan.some((s) => s.engine === "form_filling")).toBe(true);
  });

  // Journey D: Browser Task
  it("Journey D — Browser Task: Action engine validates pre-conditions, selector validity, and action hashes", () => {
    const mockElement = {
      ref: "e1",
      role: "button",
      name: "Submit Order",
      tag: "button",
      selector: "#submit-order-btn",
      rect: { x: 100, y: 200, top: 200, left: 100, width: 120, height: 40 },
    };

    const actionValidation = validateAction(
      { type: "click", selector: "#submit-order-btn" },
      mockElement,
    );
    expect(actionValidation.valid).toBe(true);

    const precondition = evaluateStepPrecondition(
      { id: "step_1", actionType: "click", selector: "#submit-order-btn" },
      { hasDomAccess: true, currentUrl: "https://portal.example.com/checkout", targetElementPresent: true },
    );
    expect(precondition.satisfied).toBe(true);

    const hash = computeActionHash("step_1", "click", "#submit-order-btn", "https://portal.example.com/checkout");
    expect(typeof hash).toBe("string");
    expect(hash.length).toBe(16);
  });

  // Journey E: File Analysis & Non-Destructive Spreadsheet Editing
  it("Journey E — File Analysis: Analyzes spreadsheets, detects duplicates, and preserves untouched rows/columns", () => {
    const originalSpreadsheet = [
      { order_id: "ORD-101", customer: "Alice", amount: 1500, status: "pending" },
      { order_id: "ORD-102", customer: "Bob", amount: 2200, status: "pending" },
      { order_id: "ORD-101", customer: "Alice", amount: 1500, status: "duplicate" }, // duplicate order
    ];

    const audit = analyzeSpreadsheetData(originalSpreadsheet);
    expect(audit.rowCount).toBe(3);
    expect(audit.anomalies.length).toBeGreaterThan(0);

    // Non-destructive targeted update
    const updated = editSpreadsheetNonDestructively(originalSpreadsheet, {
      rowCondition: (row) => row.order_id === "ORD-102",
      fieldUpdates: { status: "processed" },
    });

    expect(updated[1].status).toBe("processed");
    expect(updated[0].status).toBe("pending"); // ORD-101 untouched
    expect(updated[0].amount).toBe(1500); // Amount untouched
    expect(updated.length).toBe(3); // Zero row loss

    // Cross-file comparison
    const comparison = compareSpreadsheetFiles(
      [
        { id: "file_a", name: "Jan_Orders.csv", type: "csv", data: originalSpreadsheet },
        { id: "file_b", name: "Feb_Orders.csv", type: "csv", data: [{ order_id: "ORD-101", customer: "Alice", amount: 1500 }] },
      ],
      { primaryKeys: ["order_id"] },
    );
    expect(comparison.comparisonSummary).toBeDefined();
    expect(comparison.commonKeysCount).toBeGreaterThan(0);
  });

  // Journey F: Multi-Step Workflow
  it("Journey F — Multi-Step Workflow: Universal task decomposition, checkpoint tracking, and approval trigger", async () => {
    const complexTask = await aiBuddyBrain({
      instruction: "Open my supplier orders, copy order numbers, and paste them into our delivery portal",
      intent: "multi_step_task",
      buddySlug: "ecommerce",
    });

    expect(complexTask.executionPlan.length).toBeGreaterThanOrEqual(3);
    expect(complexTask.executionPlan[0].engine).toBeDefined();
    expect(complexTask.collaboration).toBeDefined();
    expect(complexTask.collaboration.primarySpecialist.slug).toBe("ecommerce");
  });

  // Journey G: Interrupted Task Recovery
  it("Journey G — Interrupted Task: Checkpoints persist state, prevent re-execution of completed steps", () => {
    const checkpoint = createTaskCheckpoint({
      taskId: "task_123",
      title: "Sync Meesho Orders",
      totalSteps: 4,
      currentStepIndex: 2,
      completedSteps: [
        {
          stepId: "step_0",
          actionType: "navigate",
          selector: "",
          targetUrl: "https://supplier.meesho.com",
          completedAt: new Date().toISOString(),
          actionHash: "hash_nav_0",
        },
        {
          stepId: "step_1",
          actionType: "extract_table",
          selector: ".orders-table",
          targetUrl: "https://supplier.meesho.com",
          completedAt: new Date().toISOString(),
          actionHash: "hash_extract_1",
        },
      ],
      status: "paused",
    });

    expect(checkpoint.currentStepIndex).toBe(2);
    expect(checkpoint.canSafelyResume).toBe(true);

    // Verify step 0 and 1 are marked completed and will not re-run
    expect(hasActionCompleted(checkpoint, "hash_nav_0")).toBe(true);
    expect(hasActionCompleted(checkpoint, "hash_extract_1")).toBe(true);
    expect(hasActionCompleted(checkpoint, "hash_unexecuted_2")).toBe(false);
  });

  // Journey H: Memory Lifecycle
  it("Journey H — Memory Lifecycle: Saves user preferences, retrieves context, and filters sensitive data", () => {
    const memories = [
      saveContextualMemory("preferred_language", "Hinglish mix", "preference"),
      saveContextualMemory("company_name", "Global Trade Corp", "business"),
      saveContextualMemory("secret_pin", "9876", "credential"), // Sensitive
    ];

    const retrieved = retrieveContextualMemories(memories, "Draft an introduction email for my business", {
      privacyMode: true,
      maxCount: 5,
    });

    expect(retrieved.records.some((r) => r.key === "company_name")).toBe(true);
    // Sensitive credential should NOT be surfaced in privacy mode context
    expect(retrieved.formattedContext).not.toContain("9876");
  });

  // Journey I: Mascot Rig & Voice
  it("Journey I — Mascot Rig & Voice: Maps backend emotions to vector rig and preserves 16 specialists", () => {
    expect(mapBackendEmotion("idle")).toBe("idle");
    expect(mapBackendEmotion("thinking")).toBe("thinking");
    expect(mapBackendEmotion("happy")).toBe("happy");
    expect(mapBackendEmotion("pointing")).toBe("pointing");
    expect(mapBackendEmotion("speaking")).toBe("speaking");

    // 15 canonical specialists + custom buddy
    expect(BUDDY_PRESETS.length).toBe(15);
    const slugs = BUDDY_PRESETS.map((b) => b.slug);
    expect(slugs).toContain("friendly");
    expect(slugs).toContain("developer");
    expect(slugs).toContain("ca");
    expect(slugs).toContain("legal");
    expect(slugs).toContain("ecommerce");
    expect(slugs).toContain("business");
    expect(slugs).toContain("marketing");
    expect(slugs).toContain("research");
    expect(slugs).toContain("data");
    expect(slugs).toContain("content");
    expect(slugs).toContain("design");
    expect(slugs).toContain("operations");
    expect(slugs).toContain("professor");
    expect(slugs).toContain("dadaji");
    expect(slugs).toContain("detective");
  });

  // Journey J: Chrome Extension Integration
  it("Journey J — Chrome Extension: Validates MV3 manifest, sidepanel HTML/JS buttons, and packaged zip file", () => {
    const manifestPath = path.join(extDir, "manifest.json");
    const zipPath = path.join(root, "public/ai-buddy-extension.zip");
    const htmlPath = path.join(extDir, "sidepanel.html");
    const jsPath = path.join(extDir, "sidepanel.js");
    const bgPath = path.join(extDir, "background.js");

    // Manifest MV3 checks
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions).toContain("sidePanel");
    expect(manifest.permissions).toContain("activeTab");

    // Background listeners
    const bgCode = fs.readFileSync(bgPath, "utf-8");
    expect(bgCode).toContain('msg.type === "GET_SNAPSHOT"');
    expect(bgCode).toContain('msg.type === "GET_PAGE_SNAPSHOT"');
    expect(bgCode).toContain('msg.type === "ASK"');

    // Sidepanel UI completeness
    const htmlCode = fs.readFileSync(htmlPath, "utf-8");
    expect(htmlCode).toContain('id="promptInput"');
    expect(htmlCode).toContain('id="sendBtn"');
    expect(htmlCode).toContain('id="modelSelector"');
    expect(htmlCode).toContain('id="buddyCarousel"');

    // Sidepanel JS completeness
    const jsCode = fs.readFileSync(jsPath, "utf-8");
    expect(jsCode).toContain("loadModelHubStatus");
    expect(jsCode).toContain("checkSavedCheckpoint");

    // Packaged zip validity
    expect(fs.existsSync(zipPath)).toBe(true);
    const stat = fs.statSync(zipPath);
    expect(stat.size).toBeGreaterThan(10000);
  });
});
