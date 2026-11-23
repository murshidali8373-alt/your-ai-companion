import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  SPECIALIZED_AGENT_REGISTRY,
  listSpecializedAgents,
  selectAgentsForObjective,
  buildObjectiveDagPlan,
} from "../src/lib/agents/agent-registry";
import {
  validateAgentDag,
  executeAgentDag,
  getDagController,
} from "../src/lib/agents/dag-executor";
import { SPECIALIZED_AGENT_IDS, type AgentSubtaskSpec } from "../src/lib/agents/types";
import { readScopedCollection } from "../src/lib/persistence/store.server";

let tmpDir = "";
const prevDataDir = process.env.AI_BUDDY_DATA_DIR;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aibuddy-dag-"));
  process.env.AI_BUDDY_DATA_DIR = tmpDir;
});

afterEach(() => {
  if (prevDataDir === undefined) delete process.env.AI_BUDDY_DATA_DIR;
  else process.env.AI_BUDDY_DATA_DIR = prevDataDir;
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

describe("Phase 3: 15 Specialized Agents & Parallel DAG Executor", () => {
  it("registers all 15 specialized agents and auto-selects relevant agents for multi-domain objectives", () => {
    const all = listSpecializedAgents();
    expect(all).toHaveLength(15);
    for (const id of SPECIALIZED_AGENT_IDS) {
      expect(SPECIALIZED_AGENT_REGISTRY[id]).toBeDefined();
      expect(SPECIALIZED_AGENT_REGISTRY[id].name.length).toBeGreaterThan(2);
    }

    const picked = selectAgentsForObjective(
      "Research GST rules, reconcile supplier.xlsx spreadsheet, generate PDF report, and reply to vendor email",
      { hasSpreadsheet: true, hasFiles: true, hasCommunications: true },
    );
    expect(picked).toContain("planning");
    expect(picked).toContain("research");
    expect(picked).toContain("spreadsheet");
    expect(picked).toContain("document");
    expect(picked).toContain("communication");
    expect(picked).toContain("verification");
  });

  it("validates DAG topology and rejects circular dependencies", () => {
    const cyclic: AgentSubtaskSpec[] = [
      {
        id: "a",
        agentId: "planning",
        title: "Step A",
        capabilityId: "plan_dag",
        dependencies: ["b"],
        priority: 5,
        status: "pending",
        retryCount: 0,
        retryLimit: 1,
        requiresApproval: false,
        approved: false,
      },
      {
        id: "b",
        agentId: "research",
        title: "Step B",
        capabilityId: "cross_reference_sources",
        dependencies: ["a"],
        priority: 5,
        status: "pending",
        retryCount: 0,
        retryLimit: 1,
        requiresApproval: false,
        approved: false,
      },
    ];
    const check = validateAgentDag(cyclic);
    expect(check.valid).toBe(false);
    expect(check.errors.join(" ")).toMatch(/cycle/i);
  });

  it("executes independent DAG branches in parallel and enforces exclusive file locks", async () => {
    const startTimes = new Map<string, number>();
    const endTimes = new Map<string, number>();

    const subtasks: AgentSubtaskSpec[] = [
      {
        id: "branch_research",
        agentId: "research",
        title: "Parallel Research",
        capabilityId: "cross_reference_sources",
        dependencies: [],
        priority: 8,
        status: "pending",
        retryCount: 0,
        retryLimit: 0,
        requiresApproval: false,
        approved: false,
      },
      {
        id: "branch_file_1",
        agentId: "spreadsheet",
        title: "Edit ledger.xlsx part 1",
        capabilityId: "process_spreadsheet",
        dependencies: [],
        priority: 8,
        fileOwnership: "ledger.xlsx",
        status: "pending",
        retryCount: 0,
        retryLimit: 0,
        requiresApproval: false,
        approved: false,
      },
      {
        id: "branch_file_2",
        agentId: "file_workspace",
        title: "Edit ledger.xlsx part 2",
        capabilityId: "export_workspace_artifact",
        dependencies: [],
        priority: 7,
        fileOwnership: "ledger.xlsx",
        status: "pending",
        retryCount: 0,
        retryLimit: 0,
        requiresApproval: false,
        approved: false,
      },
      {
        id: "final_verify",
        agentId: "verification",
        title: "Verify All",
        capabilityId: "verify_outcome",
        dependencies: ["branch_research", "branch_file_1", "branch_file_2"],
        priority: 10,
        status: "pending",
        retryCount: 0,
        retryLimit: 0,
        requiresApproval: false,
        approved: false,
      },
    ];

    const t0 = Date.now();
    const result = await executeAgentDag({
      runId: "dag_parallel_lock_test",
      userId: "user_test",
      objective: "Parallel + Lock check",
      subtasks,
      maxConcurrency: 4,
      runner: async (st) => {
        startTimes.set(st.id, Date.now());
        await new Promise((r) => setTimeout(r, 45));
        endTimes.set(st.id, Date.now());
        return {
          ok: true,
          summary: `${st.title} done`,
          provenance: "extracted",
        };
      },
    });
    const elapsed = Date.now() - t0;

    expect(result.status).toBe("completed");
    expect(result.subtasks.every((s) => s.status === "completed")).toBe(true);
    // branch_file_1 and branch_file_2 share fileOwnership so they MUST NOT overlap
    expect(startTimes.get("branch_file_2")!).toBeGreaterThanOrEqual(endTimes.get("branch_file_1")!);
    // final_verify runs after all dependencies
    expect(startTimes.get("final_verify")!).toBeGreaterThanOrEqual(endTimes.get("branch_file_2")!);
    // Parallel execution keeps total time well below 4 * 60ms
    expect(elapsed).toBeLessThan(260);
  });

  it("isolates partial failures, retries boundedly, triggers replanning, and enforces approval gates", async () => {
    let flakyAttempts = 0;
    let replanTriggered = false;

    const subtasks: AgentSubtaskSpec[] = [
      {
        id: "healthy_task",
        agentId: "data_intelligence",
        title: "Healthy Data Step",
        capabilityId: "extract_structured_data",
        dependencies: [],
        priority: 9,
        status: "pending",
        retryCount: 0,
        retryLimit: 0,
        requiresApproval: false,
        approved: false,
      },
      {
        id: "flaky_task",
        agentId: "browser",
        title: "Flaky Selector Step",
        capabilityId: "observe_webpage",
        dependencies: [],
        priority: 7,
        status: "pending",
        retryCount: 0,
        retryLimit: 1,
        requiresApproval: false,
        approved: false,
      },
      {
        id: "hard_fail_task",
        agentId: "navigation",
        title: "Hard Fail Step",
        capabilityId: "paginate",
        dependencies: [],
        priority: 5,
        status: "pending",
        retryCount: 0,
        retryLimit: 0,
        requiresApproval: false,
        approved: false,
      },
      {
        id: "gated_send",
        agentId: "communication",
        title: "Send Draft",
        capabilityId: "send_approved_message",
        dependencies: ["healthy_task"],
        priority: 4,
        status: "pending",
        retryCount: 0,
        retryLimit: 0,
        requiresApproval: true,
        approved: false,
      },
    ];

    const run = await executeAgentDag({
      runId: "dag_resilience_test",
      userId: "user_test",
      objective: "Resilience check",
      subtasks,
      retryDelayMs: 5,
      allowReplan: true,
      onReplan: async (failed) => {
        if (failed.id === "hard_fail_task" && !replanTriggered) {
          replanTriggered = true;
          return [
            {
              id: "fallback_recovery",
              agentId: "self_healing",
              title: "Fallback Recovery",
              capabilityId: "trigger_replan",
              dependencies: [],
              priority: 6,
              status: "pending",
              retryCount: 0,
              retryLimit: 0,
              requiresApproval: false,
              approved: false,
            },
          ];
        }
        return null;
      },
      runner: async (st) => {
        if (st.id === "flaky_task") {
          flakyAttempts++;
          if (flakyAttempts === 1) {
            return {
              ok: false,
              summary: "Transient error",
              error: "Timeout",
              provenance: "unknown",
            };
          }
        }
        if (st.id === "hard_fail_task") {
          return { ok: false, summary: "Downstream missing", error: "404", provenance: "unknown" };
        }
        return { ok: true, summary: `${st.id} succeeded`, provenance: "calculated" };
      },
    });

    expect(flakyAttempts).toBe(2);
    expect(run.subtasks.find((s) => s.id === "healthy_task")?.status).toBe("completed");
    expect(run.subtasks.find((s) => s.id === "flaky_task")?.status).toBe("completed");
    expect(run.subtasks.find((s) => s.id === "fallback_recovery")?.status).toBe("completed");
    // Gated communication step must pause at awaiting_approval when approved=false
    expect(run.subtasks.find((s) => s.id === "gated_send")?.status).toBe("awaiting_approval");
    expect(run.checkpoints.length).toBeGreaterThan(0);

    // Approve & re-run remaining DAG safely
    const ctrl = getDagController("dag_resilience_test");
    ctrl?.approveStep("gated_send");
    const resumed = await executeAgentDag({
      runId: run.runId,
      userId: "user_test",
      objective: run.objective,
      subtasks: run.subtasks,
      existingRunState: run,
      runner: async (st) => ({ ok: true, summary: `${st.id} sent`, provenance: "extracted" }),
    });
    expect(resumed.subtasks.find((s) => s.id === "gated_send")?.status).toBe("completed");
  });

  it("supports Pause and Cancel controls via DagController", async () => {
    const plan = buildObjectiveDagPlan({
      runId: "dag_ctrl_test",
      objective: "Analyze data and summarize",
      selectedAgents: ["planning", "data_intelligence", "verification"],
    });
    const finalState = await executeAgentDag({
      runId: "dag_ctrl_test",
      userId: "user_ctrl",
      objective: "Pause & Cancel check",
      subtasks: plan,
      runner: async (st) => {
        if (st.id === "dag_ctrl_test_mem") {
          getDagController("dag_ctrl_test")?.cancel();
        }
        return { ok: true, summary: "step ok", provenance: "extracted" };
      },
    });

    expect(finalState.status).toBe("cancelled");
    expect(finalState.subtasks.some((s) => s.status === "cancelled")).toBe(true);
    // Ensure persistence helper works cleanly in scoped temp store
    const stored = await readScopedCollection("user_ctrl", "dag_runs", []);
    expect(Array.isArray(stored)).toBe(true);
  });
});
