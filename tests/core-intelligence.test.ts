import { beforeEach, describe, expect, it } from "vitest";

import {
  CAPABILITY_REGISTRY,
  canExecuteCapability,
  getCapability,
  validateCapabilityInput,
} from "../src/shared/capability-registry";
import {
  acquireSubtaskLocks,
  createTaskSessionContext,
  getExecutableParallelSubtasks,
  releaseSubtaskLocks,
  validateTaskGraphDependencies,
  type Subtask,
} from "../src/shared/task-context";
import {
  clearOrchestratorSessionsForTests,
  decideExecutionPath,
  reportExecutionError,
  runUnifiedOrchestrator,
} from "../src/lib/engines/unified-orchestrator";
import { askGuest } from "../src/lib/buddy-service.server";
import {
  getSelfHealingStore,
  resetSelfHealingStoreForTests,
} from "../src/lib/self-healing/store.server";
import type { PageSnapshot } from "../src/shared/page-snapshot";

function makeSnapshot(overrides: Partial<PageSnapshot> = {}): PageSnapshot {
  return {
    url: "https://seller.example.com/orders",
    origin: "https://seller.example.com",
    title: "Seller Orders Portal",
    capturedAt: new Date().toISOString(),
    headings: [{ ref: "h1", role: "heading", name: "Orders", tag: "h1", selector: "h1" }],
    forms: [
      {
        ref: "f1",
        role: "textbox",
        name: "First Name",
        tag: "input",
        selector: "#first-name",
        placeholder: "Enter first name",
      },
    ],
    controls: [
      {
        ref: "c1",
        role: "tab",
        name: "Orders",
        tag: "a",
        selector: "a.orders-tab",
      },
      {
        ref: "c2",
        role: "button",
        name: "Export CSV",
        tag: "button",
        selector: "button.export-csv",
      },
    ],
    alerts: [],
    text: "Orders Tab Active. 3 orders ready.",
    truncated: false,
    statusCounts: { active: 2, paused: 1 },
    ...overrides,
  };
}

describe("AI Buddy 2.0 — Core Intelligence & Unified Central Orchestrator", () => {
  beforeEach(() => {
    clearOrchestratorSessionsForTests();
    resetSelfHealingStoreForTests();
  });

  it("routes simple conversation & locate requests via fast_path and complex workflows via multi_agent_path", () => {
    const generalDecision = decideExecutionPath("Hello, what is GST in India?");
    expect(generalDecision.path).toBe("fast_path");
    expect(generalDecision.requestClassification.category).toBe("general_chat");

    const locateDecision = decideExecutionPath("Orders tab kahan hai?", {
      snapshot: makeSnapshot(),
    });
    expect(locateDecision.path).toBe("fast_path");
    expect(locateDecision.brainIntent).toBe("locate_element");
    expect(locateDecision.capabilityIds).toContain("point_to_element");

    const complexDecision = decideExecutionPath(
      "Reconcile seller portal orders against spreadsheet and find missing entries",
      {
        snapshot: makeSnapshot(),
        hasSpreadsheet: true,
        hasComparison: true,
      },
    );
    expect(complexDecision.path).toBe("multi_agent_path");
    expect(complexDecision.brainIntent).toBe("universal_task");
    expect(complexDecision.agentsAssigned).toContain("ecommerce");
    expect(complexDecision.agentsAssigned).toContain("spreadsheet");
  });

  it("validates TaskNode DAG dependencies and rejects cycles, missing deps, and self-dependencies", () => {
    const valid: Subtask[] = [
      {
        taskId: "s1",
        parentTaskId: "t1",
        title: "Observe",
        agentId: "browser",
        capabilityId: "observe_webpage",
        dependencies: [],
        status: "pending",
        retryLimit: 2,
        retryCount: 0,
        permissions: { requiredLevel: "observe", isConsequential: false, approved: true },
      },
      {
        taskId: "s2",
        parentTaskId: "t1",
        title: "Compare",
        agentId: "spreadsheet",
        capabilityId: "compare_datasets",
        dependencies: ["s1"],
        status: "pending",
        retryLimit: 2,
        retryCount: 0,
        permissions: { requiredLevel: "assist", isConsequential: false, approved: true },
      },
    ];
    const okCheck = validateTaskGraphDependencies(valid);
    expect(okCheck.valid).toBe(true);
    expect(okCheck.topologicalOrder).toEqual(["s1", "s2"]);

    const cyclic: Subtask[] = [
      { ...valid[0]!, dependencies: ["s2"] },
      { ...valid[1]!, dependencies: ["s1"] },
    ];
    const cycleCheck = validateTaskGraphDependencies(cyclic);
    expect(cycleCheck.valid).toBe(false);
    expect(cycleCheck.errors[0]).toMatch(/cycle/i);

    const selfDep = validateTaskGraphDependencies([{ ...valid[0]!, dependencies: ["s1"] }]);
    expect(selfDep.valid).toBe(false);
    expect(selfDep.errors[0]).toMatch(/itself/i);

    const missingDep = validateTaskGraphDependencies([
      { ...valid[0]!, dependencies: ["nonexistent"] },
    ]);
    expect(missingDep.valid).toBe(false);
    expect(missingDep.errors[0]).toMatch(/missing/i);
  });

  it("enforces tabOwnership and fileOwnership locks for parallel-ready subtasks", () => {
    const ctx = createTaskSessionContext();
    const s1: Subtask = {
      taskId: "sub_1",
      parentTaskId: "t1",
      title: "Read tab 10",
      agentId: "browser",
      capabilityId: "observe_webpage",
      dependencies: [],
      status: "pending",
      retryLimit: 1,
      retryCount: 0,
      tabOwnership: 10,
      fileOwnership: "orders.csv",
      permissions: { requiredLevel: "observe", isConsequential: false, approved: true },
    };
    const s2ConflictTab: Subtask = {
      ...s1,
      taskId: "sub_2",
      tabOwnership: 10,
      fileOwnership: "other.csv",
    };
    const s3Independent: Subtask = {
      ...s1,
      taskId: "sub_3",
      tabOwnership: 22,
      fileOwnership: "catalog.csv",
    };

    ctx.currentTask = {
      taskId: "t1",
      goal: "Test parallel lock table",
      executionPath: "multi_agent_path",
      status: "executing",
      subtasks: [s1, s2ConflictTab, s3Independent],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const ready = getExecutableParallelSubtasks(ctx);
    expect(ready.map((s) => s.taskId)).toEqual(["sub_1", "sub_3"]);

    expect(acquireSubtaskLocks(ctx, s1)).toBe(true);
    expect(acquireSubtaskLocks(ctx, s2ConflictTab)).toBe(false);
    releaseSubtaskLocks(ctx, "sub_1");
    expect(acquireSubtaskLocks(ctx, s2ConflictTab)).toBe(true);
  });

  it("enforces Capability Registry Zod schemas, permission levels, and honest 'planned' boundaries", () => {
    expect(CAPABILITY_REGISTRY.length).toBeGreaterThanOrEqual(25);
    expect(getCapability("hover_element")?.status).toBe("implemented");
    expect(getCapability("desktop_os_automation")?.status).toBe("planned");

    const plannedCheck = canExecuteCapability("desktop_os_automation", "execute", true);
    expect(plannedCheck.available).toBe(false);
    expect(plannedCheck.allowed).toBe(false);
    expect(plannedCheck.reason).toMatch(/planned/i);

    const submitNoConsent = canExecuteCapability(
      "consequential_submit_or_delete",
      "execute",
      false,
    );
    expect(submitNoConsent.allowed).toBe(false);
    expect(submitNoConsent.requiresApproval).toBe(true);

    const lowPerm = canExecuteCapability("fill_form", "observe", true);
    expect(lowPerm.allowed).toBe(false);
    expect(lowPerm.requiresApproval).toBe(true);

    const validSchema = validateCapabilityInput("scroll_intelligent", {
      direction: "down",
      amount: 300,
    });
    expect(validSchema.ok).toBe(true);
    const badSchema = validateCapabilityInput("click_element", { selector: "" });
    expect(badSchema.ok).toBe(false);
  });

  it("runs Unified Orchestrator across specialized engines and connects failures to Self-Healing store", async () => {
    const res = await runUnifiedOrchestrator({
      instruction: "Compare spreadsheet files against live seller orders",
      snapshot: makeSnapshot(),
      permissionLevel: "assist",
      activeTabId: 7,
      spreadsheetData: [
        { id: "ORD-1", price: 500, status: "active" },
        { id: "ORD-2", price: 800, status: "paused" },
      ],
      comparisonData: [{ id: "ORD-1", price: 450, status: "active" }],
    });

    expect(res.orchestration.path).toBe("multi_agent_path");
    expect(res.orchestration.subtaskCounts.completed).toBeGreaterThanOrEqual(2);
    expect(res.crossFileResult?.discrepancies.length).toBe(1);
    expect(res.crossFileResult?.missingInComparison).toEqual(["ORD-2"]);
    expect(res.sessionContext.checkpoints.length).toBe(1);
    expect(res.sessionContext.activeBrowserTab?.tabId).toBe(7);

    // Trigger shared error hook directly and verify Self-Healing store captures redacted telemetry
    const hooked = reportExecutionError(
      {
        component: "agent_execution",
        error: new TypeError("Cannot read properties of undefined Bearer secretTok123456"),
        agentId: "spreadsheet",
        currentOperation: "reconcile_rows",
      },
      res.sessionContext,
    );
    expect(hooked.report.attribution).toBe("ai_buddy_code");
    expect(hooked.report.errorMessage).not.toContain("secretTok123456");
    expect(getSelfHealingStore().reports.length).toBe(1);
  });

  it("wires askGuest through Unified Orchestrator and returns orchestration metadata & selfHealing telemetry on provider failure", async () => {
    const output = await askGuest({
      question: "Orders tab kahan hai?",
      intent: "locate_element",
      snapshot: makeSnapshot(),
      source: "extension",
      preferredProvider: "openai", // unconfigured in test env -> triggers strict provider failure telemetry
      activeTabId: 42,
    });

    expect(output.orchestration).toBeTruthy();
    expect(output.orchestration?.path).toBe("fast_path");
    expect(output.sessionContext?.activeBrowserTab?.tabId).toBe(42);
    expect(output.providerFailure).toBeTruthy();
    expect(output.selfHealing?.attribution).toBe("api_provider");
  });
});
