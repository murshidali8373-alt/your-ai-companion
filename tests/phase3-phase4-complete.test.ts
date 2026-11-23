import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CANONICAL_15_AGENTS,
  createTaskSessionContext,
  isolateSessionContext,
  maskSensitiveContextText,
  recordCostTelemetry,
  recordDecision,
  recordExtractedDataWithProvenance,
  requestTaskCancel,
  requestTaskPause,
  requestTaskResume,
  type Subtask,
  type TaskNode,
  validateTaskGraphDependencies,
} from "@/shared/task-context";
import {
  executeSpecializedAgent,
  getAgentDefinition,
  listAllAgents,
  resolveCanonicalAgentId,
} from "@/lib/agents/agents-registry";
import { executeTaskDag } from "@/lib/engines/dag-executor";
import {
  detectMissingValuesReport,
  detectStatisticalOutliers,
  filterSortGroupRecords,
  tagWithProvenance,
} from "@/lib/engines/data-intelligence-engine";
import {
  compareXlsxBuffers,
  createDocxBuffer,
  createPdfBuffer,
  createXlsxBuffer,
  deleteWorkspaceArtifact,
  getWorkspaceArtifact,
  listWorkspaceArtifacts,
  parseWorkspaceBuffer,
  readDocxBuffer,
  readPdfBuffer,
  readXlsxBuffer,
  sanitizeWorkspaceFilename,
  storeWorkspaceArtifact,
  updateDocxBufferNonDestructively,
  updateXlsxBufferNonDestructively,
} from "@/lib/engines/file-parsers.server";
import {
  analyzeMultiSourceResearch,
  collectWebResearchSources,
  detectSourceContradictions,
  validatePublicResearchUrl,
} from "@/lib/engines/research-engine";
import {
  detectDoNotRememberCommand,
  type MemoryRecord,
  retrieveContextualMemories,
  upsertMemorySafely,
} from "@/lib/engines/memory-engine";
import {
  getAvailableServiceConnectors,
  getConnectorStatus,
} from "@/lib/integrations/service-registry";
import {
  disconnectConnectorToken,
  executeConnectorAction,
  listConnectorAuditLog,
  listConnectorsForUser,
  registerServerConnectorToken,
  resolveConnectorRuntimeStatus,
} from "@/lib/integrations/connectors.server";
import {
  editWorkflowNaturally,
  parseNaturalLanguageWorkflow,
} from "@/lib/engines/workflow-recipe-engine";
import {
  applyNaturalEditToWorkflow,
  enableApprovedWorkflow,
  executeWorkflowRun,
  getSchedulerInfrastructureReport,
  listFailureNotifications,
  listWorkflows,
  pauseWorkflow,
  resetWorkflowStoreForTests,
  resumeWorkflow,
  runDueWorkflows,
  saveWorkflow,
} from "@/lib/engines/workflow-automation.server";
import { generateProactiveSuggestions } from "@/lib/engines/proactive-engine";
import {
  createEmailDraft,
  draftReplyToMessage,
  prepareSendWithApprovalGate,
  summarizeAndCategorizeMessages,
} from "@/lib/agents/communication-agent";
import { decideExecutionPath, runUnifiedOrchestrator } from "@/lib/engines/unified-orchestrator";
import type { AgentRuntimeEnv } from "@/lib/agents/types";

function makeSubtask(
  overrides: Partial<Subtask> & { taskId: string; agentId?: Subtask["agentId"] },
): Subtask {
  return {
    parentTaskId: "task_parent_1",
    title: overrides.title || overrides.taskId,
    agentId: overrides.agentId || "planning",
    capabilityId: overrides.capabilityId || "maintain_checkpoints",
    dependencies: overrides.dependencies || [],
    status: overrides.status || "pending",
    priority: overrides.priority ?? 5,
    retryLimit: overrides.retryLimit ?? 0,
    retryCount: overrides.retryCount ?? 0,
    permissions: overrides.permissions || {
      requiredLevel: "observe",
      isConsequential: false,
      approved: true,
    },
    ...overrides,
  };
}

describe("AI Buddy 2.0 — Phase 3 & Phase 4 Complete Verification", () => {
  beforeEach(() => {
    resetWorkflowStoreForTests();
  });

  afterAll(() => {
    resetWorkflowStoreForTests();
    const dataDir = path.resolve(process.cwd(), ".aistudio_data");
    try {
      if (fs.existsSync(dataDir) && fs.readdirSync(dataDir).length === 0) {
        fs.rmdirSync(dataDir);
      }
    } catch {
      // ignore
    }
  });

  // -------------------------------------------------------------------------
  // 1. 15 Canonical Specialized Agents + Legacy Aliases + Schema Validation
  // -------------------------------------------------------------------------
  describe("1. Canonical 15 Specialized Agents & Registry", () => {
    it("registers all 15 canonical agents and resolves legacy aliases", () => {
      const agents = listAllAgents();
      expect(agents).toHaveLength(15);
      for (const id of CANONICAL_15_AGENTS) {
        const def = getAgentDefinition(id);
        expect(def.id).toBe(id);
        expect(def.responsibility.length).toBeGreaterThan(10);
      }
      expect(resolveCanonicalAgentId("analysis")).toBe("data_intelligence");
      expect(resolveCanonicalAgentId("data_extraction")).toBe("data_intelligence");
      expect(resolveCanonicalAgentId("ecommerce")).toBe("browser");
      expect(resolveCanonicalAgentId("file_management")).toBe("file_workspace");
      expect(resolveCanonicalAgentId("form_automation")).toBe("form_filling");
      expect(resolveCanonicalAgentId("visual_understanding")).toBe("visual_intelligence");
      expect(resolveCanonicalAgentId("workflow_recovery")).toBe("self_healing");
      expect(resolveCanonicalAgentId("quality_control")).toBe("verification");
    });

    it("executes all 15 specialized agents cleanly with structured verification outputs", async () => {
      const sessionCtx = createTaskSessionContext({ userId: "usr_agents_1" });
      const env: AgentRuntimeEnv = {
        instruction: "Audit Meesho orders and prepare reconciliation summary",
        permissionLevel: "assist",
        consentGranted: true,
        sessionContext: sessionCtx,
        spreadsheetData: [{ sku: "SKU1", price: 250, status: "active" }],
        comparisonData: [{ sku: "SKU1", price: 250, status: "active" }],
        researchSources: [
          {
            id: "s1",
            url: "https://example.com/a",
            title: "Source A",
            domain: "example.com",
            snippets: ["Meesho orders reconciliation takes 2 minutes per batch."],
          },
          {
            id: "s2",
            url: "https://example.org/b",
            title: "Source B",
            domain: "example.org",
            snippets: ["Meesho orders reconciliation takes 2 minutes per batch."],
          },
        ],
        userMemories: [
          {
            id: "m1",
            kind: "user_preference",
            key: "reconciliation format",
            value: "Use XLSX summary report",
            updatedAt: new Date().toISOString(),
          },
        ],
      };

      for (const agentId of CANONICAL_15_AGENTS) {
        const def = getAgentDefinition(agentId);
        const subtask = makeSubtask({
          taskId: `st_${agentId}`,
          agentId,
          capabilityId: def.capabilityIds[0] || "observe_webpage",
        });
        sessionCtx.currentTask = {
          taskId: "task_agents",
          goal: env.instruction,
          executionPath: "multi_agent_path",
          status: "executing",
          subtasks: [subtask],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        const res = await executeSpecializedAgent(subtask, env);
        expect(res.agentId).toBe(agentId);
        expect(typeof res.summary).toBe("string");
        expect(res.ok).toBe(true);
      }
    });

    it("rejects malformed agent input via Zod schema", async () => {
      const sessionCtx = createTaskSessionContext();
      const res = await executeSpecializedAgent(
        makeSubtask({ taskId: "bad_input", agentId: "planning" }),
        {
          instruction: "",
          permissionLevel: "observe",
          consentGranted: false,
          sessionContext: sessionCtx,
        },
      );
      expect(res.ok).toBe(false);
      expect(res.error).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // 2. Dependency-Aware DAG Execution Engine
  // -------------------------------------------------------------------------
  describe("2. Dependency-Aware DAG Execution Engine", () => {
    it("executes independent subtasks in parallel waves and respects dependency ordering", async () => {
      const ctx = createTaskSessionContext({ userId: "usr_dag" });
      const env: AgentRuntimeEnv = {
        instruction: "Parallel research & spreadsheet audit then merge report",
        permissionLevel: "observe",
        consentGranted: false,
        sessionContext: ctx,
      };
      const taskNode: TaskNode = {
        taskId: "dag_parallel_1",
        goal: env.instruction,
        executionPath: "multi_agent_path",
        status: "executing",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        subtasks: [
          makeSubtask({ taskId: "branch_a", agentId: "research", dependencies: [] }),
          makeSubtask({ taskId: "branch_b", agentId: "spreadsheet", dependencies: [] }),
          makeSubtask({
            taskId: "merge_c",
            agentId: "document",
            dependencies: ["branch_a", "branch_b"],
          }),
        ],
      };

      let activeNow = 0;
      let peakConcurrency = 0;
      const order: string[] = [];

      const summary = await executeTaskDag(ctx, taskNode, env, {
        maxConcurrency: 3,
        customExecutor: async (st) => {
          activeNow += 1;
          peakConcurrency = Math.max(peakConcurrency, activeNow);
          await new Promise((r) => setTimeout(r, 25));
          activeNow -= 1;
          order.push(st.taskId);
          return {
            ok: true,
            agentId: st.agentId as (typeof CANONICAL_15_AGENTS)[number],
            summary: `Done ${st.taskId}`,
            provenance: "calculated",
            verified: true,
            verificationDetail: "Custom async verifier passed",
          };
        },
      });

      expect(peakConcurrency).toBeGreaterThanOrEqual(2);
      expect(summary.maxObservedConcurrency).toBeGreaterThanOrEqual(2);
      expect(summary.parallelWaves).toBe(2);
      expect(summary.completedIds).toEqual(["branch_a", "branch_b", "merge_c"]);
      expect(order.indexOf("merge_c")).toBeGreaterThan(order.indexOf("branch_a"));
      expect(order.indexOf("merge_c")).toBeGreaterThan(order.indexOf("branch_b"));
    });

    it("detects and rejects cyclic task graphs via Kahn's algorithm", async () => {
      const cyclic: Subtask[] = [
        makeSubtask({ taskId: "a", dependencies: ["b"] }),
        makeSubtask({ taskId: "b", dependencies: ["a"] }),
      ];
      const check = validateTaskGraphDependencies(cyclic);
      expect(check.valid).toBe(false);
      expect(check.errors.join(" ")).toMatch(/cycle/i);

      const ctx = createTaskSessionContext();
      const res = await executeTaskDag(
        ctx,
        {
          taskId: "cyc_task",
          goal: "Cycle check",
          executionPath: "multi_agent_path",
          status: "executing",
          subtasks: cyclic,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          instruction: "Cycle check",
          permissionLevel: "observe",
          consentGranted: false,
          sessionContext: ctx,
        },
      );
      expect(res.cycleError).toBeDefined();
      expect(res.taskNode.status).toBe("failed");
    });

    it("isolates upstream failures, skips dependents without failing sibling branches, retries transient errors, and replans", async () => {
      const ctx = createTaskSessionContext();
      const env: AgentRuntimeEnv = {
        instruction: "Retry and isolate failure",
        permissionLevel: "observe",
        consentGranted: false,
        sessionContext: ctx,
      };
      const taskNode: TaskNode = {
        taskId: "dag_recovery",
        goal: env.instruction,
        executionPath: "multi_agent_path",
        status: "executing",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        subtasks: [
          makeSubtask({ taskId: "transient_ok", agentId: "research", retryLimit: 2 }),
          makeSubtask({ taskId: "permanent_fail", agentId: "browser", retryLimit: 0 }),
          makeSubtask({
            taskId: "dependent_skipped",
            agentId: "document",
            dependencies: ["permanent_fail"],
          }),
        ],
      };

      let transientAttempts = 0;
      const summary = await executeTaskDag(ctx, taskNode, env, {
        maxConcurrency: 3,
        enableDynamicReplanning: true,
        customExecutor: async (st) => {
          if (st.taskId === "transient_ok") {
            transientAttempts += 1;
            if (transientAttempts === 1) {
              return {
                ok: false,
                agentId: "research",
                summary: "Network timeout",
                provenance: "unknown",
                verified: false,
                verificationDetail: "Timed out once",
                recoverable: true,
                error: "Temporary network timeout",
              };
            }
            return {
              ok: true,
              agentId: "research",
              summary: "Recovered on retry",
              provenance: "extracted",
              verified: true,
              verificationDetail: "OK",
            };
          }
          if (st.taskId === "permanent_fail") {
            return {
              ok: false,
              agentId: "browser",
              summary: "Receiving end does not exist",
              provenance: "unknown",
              verified: false,
              verificationDetail: "Tab bridge disconnected",
              recoverable: false,
              error: "Could not establish connection. Receiving end does not exist.",
            };
          }
          return {
            ok: true,
            agentId: "self_healing",
            summary: "Diagnostic recovery plan executed",
            provenance: "calculated",
            verified: true,
            verificationDetail: "Recovered",
          };
        },
      });

      expect(transientAttempts).toBe(2);
      expect(summary.completedIds).toContain("transient_ok");
      expect(summary.failedIds).toContain("permanent_fail");
      const skipped = summary.taskNode.subtasks.find((s) => s.taskId === "dependent_skipped");
      expect(skipped?.status).toBe("skipped");
      expect(summary.replannedSubtasks.length).toBeGreaterThanOrEqual(1);
      expect(summary.taskNode.status).toBe("partially_completed");
    });

    it("supports pause, resume, cancel, and resource lock enforcement", async () => {
      const ctx = createTaskSessionContext();
      const env: AgentRuntimeEnv = {
        instruction: "Pause and cancel",
        permissionLevel: "observe",
        consentGranted: false,
        sessionContext: ctx,
      };
      const taskNode: TaskNode = {
        taskId: "dag_pause",
        goal: "Pause test",
        executionPath: "multi_agent_path",
        status: "executing",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        subtasks: [
          makeSubtask({ taskId: "s1", fileOwnership: "same.xlsx" }),
          makeSubtask({ taskId: "s2", fileOwnership: "same.xlsx" }),
        ],
      };
      ctx.currentTask = taskNode;
      requestTaskPause(ctx);
      expect(ctx.pauseRequested).toBe(true);
      const pausedRes = await executeTaskDag(ctx, taskNode, env);
      expect(pausedRes.taskNode.status).toBe("paused");

      requestTaskResume(ctx);
      expect(ctx.pauseRequested).toBe(false);
      // Same fileOwnership serializes across waves (maxObservedConcurrency === 1)
      const resumedRes = await executeTaskDag(ctx, taskNode, env);
      expect(resumedRes.maxObservedConcurrency).toBe(1);
      expect(resumedRes.completedIds).toEqual(["s1", "s2"]);

      requestTaskCancel(ctx);
      expect(ctx.cancelRequested).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // 3. Shared TaskSessionContext Governance & Isolation
  // -------------------------------------------------------------------------
  describe("3. TaskSessionContext Governance & Isolation", () => {
    it("masks secrets, logs decisions & provenance, tracks cost telemetry, and isolates users", () => {
      const ctxA = createTaskSessionContext({ userId: "user_A" });
      const dec = recordDecision(ctxA, {
        madeBy: "planning",
        summary: "Skip credential field with password=SuperSecret123",
        rationale: "Never leak AIzaSyDummySecretKeyValue1234567890ABCD",
      });
      expect(dec.summary).toContain("[REDACTED]");
      expect(dec.rationale).toContain("[REDACTED]");
      expect(maskSensitiveContextText("Card 4111-2222-3333-4444")).toBe("Card [REDACTED]");

      const ext = recordExtractedDataWithProvenance(ctxA, {
        label: "Orders table",
        itemCount: 10,
        previewSummary: "10 orders",
        provenance: "extracted",
      });
      expect(ext.provenance).toBe("extracted");

      const tel = recordCostTelemetry(ctxA, {
        tokens: 150,
        modelCalls: 1,
        path: "multi_agent_path",
        costUsd: 0.0002,
      });
      expect(tel.totalEstimatedTokens).toBe(150);
      expect(tel.multiAgentCount).toBe(1);

      const isolatedB = isolateSessionContext(ctxA, "user_B");
      expect(isolatedB.userId).toBe("user_B");
      expect(isolatedB.decisions).toHaveLength(0);
      expect(isolatedB.extractedDataRefs).toHaveLength(0);
      expect(isolateSessionContext(ctxA, "user_A")).toBe(ctxA);
    });
  });

  // -------------------------------------------------------------------------
  // 4. Upgraded Data Intelligence Engine
  // -------------------------------------------------------------------------
  describe("4. Data Intelligence Engine (Provenance, Outliers, Missing, Grouping)", () => {
    it("tags provenance, reports missing values, detects IQR & Z-score outliers, and filters/sorts/groups", () => {
      const tagged = tagWithProvenance(420, "calculated", "formula:SUM");
      expect(tagged.provenance).toBe("calculated");

      const rows = [
        { id: "1", category: "Kurti", price: 499, stock: 10 },
        { id: "2", category: "Kurti", price: 510, stock: null },
        { id: "3", category: "Saree", price: 520, stock: 8 },
        { id: "4", category: "Saree", price: 505, stock: 12 },
        { id: "5", category: "Kurti", price: 495, stock: 15 },
        { id: "6", category: "Kurti", price: 9900, stock: "" },
      ];

      const missing = detectMissingValuesReport(rows);
      expect(missing.totalRows).toBe(6);
      const stockMissing = missing.columnsWithMissing.find((c) => c.column === "stock");
      expect(stockMissing?.missingCount).toBe(2);

      const iqrOutliers = detectStatisticalOutliers(rows, "price");
      expect(iqrOutliers.some((o) => o.recordId === "6" && o.method === "iqr")).toBe(true);

      // Zero IQR dataset triggers Z-score branch cleanly
      const zeroIqrRows = [
        { id: "z1", val: 100 },
        { id: "z2", val: 100 },
        { id: "z3", val: 100 },
        { id: "z4", val: 100 },
        { id: "z5", val: 100 },
        { id: "z6", val: 900 },
      ];
      const zOutliers = detectStatisticalOutliers(zeroIqrRows, "val", { zThreshold: 1.5 });
      expect(zOutliers.some((o) => o.recordId === "z6" && o.method === "zscore")).toBe(true);

      const grouped = filterSortGroupRecords(rows, {
        filters: [{ column: "price", operator: "lt", value: 1000 }],
        sortBy: { column: "price", direction: "desc" },
        groupBy: "category",
        numericSumColumn: "price",
      });
      expect(grouped.filteredRows[0]?.["price"]).toBe(520);
      expect(grouped.groups.find((g) => g.groupKey === "Kurti")?.count).toBe(3);
      expect(grouped.provenance).toBe("calculated");
    });
  });

  // -------------------------------------------------------------------------
  // 5. Real File Workspace Parsers, Writers, Non-Destructive Edits & Verifiers
  // -------------------------------------------------------------------------
  describe("5. Real File Workspace (CSV/TSV/TXT/JSON/XLSX/DOCX/PDF)", () => {
    it("parses CSV, TSV, TXT, JSON and enforces filename sanitization + user isolation", async () => {
      expect(sanitizeWorkspaceFilename("../../etc/passwd")).toBe("passwd");

      const csv = await parseWorkspaceBuffer(
        "orders.csv",
        Buffer.from("id,price\nO1,100\nO2,200\n"),
      );
      expect(csv.extension).toBe("csv");
      expect(csv.table?.rowCount).toBe(2);

      const tsv = await parseWorkspaceBuffer("orders.tsv", Buffer.from("id\tprice\nO1\t150\n"));
      expect(tsv.extension).toBe("tsv");
      expect(tsv.table?.rowCount).toBe(1);

      const txt = await parseWorkspaceBuffer("notes.txt", Buffer.from("Seller audit summary"));
      expect(txt.textContent).toContain("Seller audit summary");

      const json = await parseWorkspaceBuffer("items.json", Buffer.from('[{"sku":"A1","qty":3}]'));
      expect(json.table?.rowCount).toBe(1);

      const artA = storeWorkspaceArtifact({
        ownerId: "user_a",
        filename: "../secret/report.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("Owner A data"),
        summary: "Test",
      });
      expect(artA.filename).toBe("report.txt");
      expect(listWorkspaceArtifacts("user_a").some((a) => a.artifactId === artA.artifactId)).toBe(
        true,
      );
      expect(getWorkspaceArtifact(artA.artifactId, "user_b")).toBeNull();
      expect(deleteWorkspaceArtifact(artA.artifactId, "user_b")).toBe(false);
      expect(deleteWorkspaceArtifact(artA.artifactId, "user_a")).toBe(true);
    });

    it("creates, parses, evaluates formulas, non-destructively updates, and compares XLSX workbooks", async () => {
      const created = await createXlsxBuffer({
        sheets: [
          {
            name: "Sales",
            headers: ["SKU", "Qty", "Price", "LineTotal"],
            rows: [
              { SKU: "KURTI-1", Qty: 2, Price: 500, LineTotal: 0 },
              { SKU: "SAREE-2", Qty: 3, Price: 700, LineTotal: 0 },
            ],
            formulas: [
              { cell: "D2", formula: "=B2*C2" },
              { cell: "D3", formula: "=B3*C3" },
              { cell: "D4", formula: "=SUM(D2:D3)" },
              { cell: "C4", formula: "=AVERAGE(C2:C3)" },
            ],
          },
        ],
      });

      expect(created.verified.sheetNames).toEqual(["Sales"]);
      expect(created.verified.sheets[0]?.hasStyling).toBe(true);
      const sumFormula = created.verified.sheets[0]?.formulas.find((f) => f.cell === "D2");
      expect(sumFormula?.evaluatedResult).toBe(1000);

      const updated = await updateXlsxBufferNonDestructively({
        sourceBuffer: created.buffer,
        updates: [{ matchKey: "SKU", matchValue: "KURTI-1", targetColumn: "Qty", newValue: 4 }],
      });
      expect(updated.modifiedCount).toBe(1);
      expect(updated.auditTrail[0]?.previousValue).toBe(2);
      expect(updated.verified.sheets[0]?.rows[0]?.["Qty"]).toBe(4);
      // Original buffer remains intact
      const rereadOriginal = await readXlsxBuffer(created.buffer);
      expect(rereadOriginal.sheets[0]?.rows[0]?.["Qty"]).toBe(2);

      const comp = await compareXlsxBuffers({
        baseBuffer: created.buffer,
        compareBuffer: updated.buffer,
        baseFileName: "before.xlsx",
        compareFileName: "after.xlsx",
        keyField: "SKU",
      });
      expect(comp.comparison.discrepancies.length).toBeGreaterThanOrEqual(1);
    });

    it("creates, parses headings/tables, and non-destructively updates DOCX files", async () => {
      const created = await createDocxBuffer({
        title: "Supplier Audit Report",
        sections: [
          {
            heading: "Findings",
            paragraphs: ["Total discrepancy count is 1 item."],
            table: { headers: ["SKU", "Status"], rows: [["KURTI-1", "Verified"]] },
          },
        ],
      });
      const parsed = await readDocxBuffer(created.buffer);
      expect(parsed.headings.some((h) => h.text.includes("Supplier Audit Report"))).toBe(true);
      expect(parsed.tables.length).toBeGreaterThanOrEqual(1);
      expect(parsed.text).toContain("KURTI-1");

      const updated = await updateDocxBufferNonDestructively({
        sourceBuffer: created.buffer,
        replacements: [
          {
            find: "Total discrepancy count is 1 item.",
            replace: "Total discrepancy count is 0 items.",
          },
        ],
        appendParagraphs: ["Approved by manager."],
      });
      expect(updated.replacementsApplied).toBe(1);
      expect(updated.appendedCount).toBe(1);
      expect(updated.verified.text).toContain("0 items");
      expect(updated.verified.text).toContain("Approved by manager.");
    });

    it("creates multi-page PDFs with self-verification and extracts page-referenced text", async () => {
      const longBody = Array.from(
        { length: 75 },
        (_, i) => `Audit line ${i + 1}: Verified order batch reconciliation status OK.`,
      ).join("\n");
      const created = await createPdfBuffer({
        title: "AI Buddy Reconciliation PDF",
        subtitle: "Generated by Phase 3 File Workspace",
        sections: [{ heading: "Detailed Rows", body: longBody }],
      });
      expect(created.verificationPassed).toBe(true);
      expect(created.verified.pageCount).toBeGreaterThanOrEqual(2);
      const reread = await readPdfBuffer(created.buffer);
      expect(reread.pages[0]?.page).toBe(1);
      expect(reread.fullText).toContain("[Page 2]");
    });
  });

  // -------------------------------------------------------------------------
  // 6. Research Intelligence Engine + SSRF Protection
  // -------------------------------------------------------------------------
  describe("6. Research Intelligence Engine & SSRF Safety", () => {
    it("blocks private/loopback/metadata URLs and verifies public URLs cleanly", async () => {
      expect(validatePublicResearchUrl("http://localhost:3000/api").valid).toBe(false);
      expect(validatePublicResearchUrl("http://127.0.0.1/admin").valid).toBe(false);
      expect(validatePublicResearchUrl("http://169.254.169.254/latest/meta-data").valid).toBe(
        false,
      );
      expect(validatePublicResearchUrl("http://10.0.0.5/secret").valid).toBe(false);
      expect(validatePublicResearchUrl("ftp://example.com/file").valid).toBe(false);
      expect(validatePublicResearchUrl("https://docs.example.com/report").valid).toBe(true);

      const mockFetch = vi.fn(
        async () =>
          new Response(
            "<html><head><title>Market Pricing Report</title></head><body><p>Average retail shipping SLA is 48 hours across metro regions with 98% on-time score.</p></body></html>",
            { status: 200 },
          ),
      ) as unknown as typeof fetch;

      const collected = await collectWebResearchSources(
        ["http://127.0.0.1:8080/internal", "https://docs.example.com/sla"],
        mockFetch,
      );
      expect(collected.errors).toHaveLength(1);
      expect(collected.sources).toHaveLength(1);
      expect(collected.sources[0]?.title).toBe("Market Pricing Report");
    });

    it("detects source contradictions and avoids fabricated citations when sources are empty", () => {
      const contradictions = detectSourceContradictions([
        {
          id: "a",
          url: "https://a.example.com",
          title: "Report A",
          domain: "a.example.com",
          snippets: ["Supplier settlement turnaround takes 7 days across regions."],
        },
        {
          id: "b",
          url: "https://b.example.com",
          title: "Report B",
          domain: "b.example.com",
          snippets: ["Supplier settlement turnaround takes 14 days across regions."],
        },
      ]);
      expect(contradictions.length).toBeGreaterThanOrEqual(1);

      const emptyReport = analyzeMultiSourceResearch({
        topic: "Unverified Claim Check",
        sources: [],
        claimsToEvaluate: [{ claim: "Market grew 50%" }],
      });
      expect(emptyReport.citations).toHaveLength(0);
      expect(emptyReport.unansweredQuestions).toEqual(["Market grew 50%"]);
    });
  });

  // -------------------------------------------------------------------------
  // 7. Multi-Tier 8-Category Memory Engine
  // -------------------------------------------------------------------------
  describe("7. Multi-Tier Memory Engine (8 Categories, Dedup, Opt-Out, Isolation)", () => {
    it("supports all 8 categories, short/long scope, deduplication, superseding, and privacy/opt-out blocking", () => {
      const eightCategories: Array<MemoryRecord["kind"]> = [
        "user_preference",
        "communication_preference",
        "business_context",
        "active_project",
        "frequent_workflow",
        "completed_task",
        "reusable_instruction",
        "automation_preference",
      ];
      let store: MemoryRecord[] = [];
      for (const kind of eightCategories) {
        const res = upsertMemorySafely(store, {
          key: `key_${kind}`,
          value: `value for ${kind} supplier GST reconciliation`,
          kind,
          scope: kind === "completed_task" ? "short_term" : "long_term",
          userId: "user_1",
        });
        expect(res.ok).toBe(true);
        store = res.records;
      }

      // Exact duplicate skip
      const dupRes = upsertMemorySafely(store, {
        key: "key_user_preference",
        value: "value for user_preference supplier GST reconciliation",
        kind: "user_preference",
        userId: "user_1",
      });
      expect(dupRes.action).toBe("skipped_duplicate");

      // Outdated conflict updates & supersedes previous entry
      const updateRes = upsertMemorySafely(dupRes.records, {
        key: "key_user_preference",
        value: "Updated preference: CSV export",
        kind: "user_preference",
        userId: "user_1",
      });
      expect(updateRes.action).toBe("updated_outdated");
      expect(
        updateRes.records.filter((m) => m.key === "key_user_preference" && m.outdated),
      ).toHaveLength(1);

      // Sensitive data blocked
      const sensRes = upsertMemorySafely(updateRes.records, {
        key: "bank otp",
        value: "OTP is 482910",
        kind: "user_preference",
        userId: "user_1",
      });
      expect(sensRes.ok).toBe(false);
      expect(sensRes.action).toBe("rejected_sensitive");

      // "Do not remember" command blocked
      expect(detectDoNotRememberCommand("Bhai ye mat yaad rakhna please")).toBe(true);
      const optOut = upsertMemorySafely(updateRes.records, {
        key: "note",
        value: "Temporary note",
        kind: "user_preference",
        userId: "user_1",
        instructionContext: "Do not remember this temporary note",
      });
      expect(optOut.ok).toBe(false);
      expect(optOut.action).toBe("rejected_opt_out");

      // User isolation & privacyMode suppression
      const user2Lookup = retrieveContextualMemories(updateRes.records, "supplier GST", {
        userId: "user_2",
      });
      expect(user2Lookup.relevantMemories).toHaveLength(0);

      const privLookup = retrieveContextualMemories(updateRes.records, "supplier GST", {
        userId: "user_1",
        privacyMode: true,
      });
      expect(privLookup.suppressedByPrivacyMode).toBe(true);
      expect(privLookup.relevantMemories).toHaveLength(0);

      const user1Long = retrieveContextualMemories(updateRes.records, "supplier GST", {
        userId: "user_1",
        scope: "long_term",
        maxCount: 10,
      });
      expect(
        user1Long.relevantMemories.every((m) => (m.scope ?? "long_term") === "long_term"),
      ).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // 8. Modular Connected Apps + Server Vault + Audit Logs + Approval Gate
  // -------------------------------------------------------------------------
  describe("8. Connected Apps Registry, Server Vault, & Audit Gateway", () => {
    it("exposes 9 primary connectors with truthful unconfigured status", () => {
      const list = getAvailableServiceConnectors();
      expect(list.length).toBeGreaterThanOrEqual(9);
      const gmail = getConnectorStatus("gmail");
      expect(gmail.found).toBe(true);
      expect(gmail.operational).toBe(false);
      expect(gmail.missingRequirements.length).toBeGreaterThan(0);
    });

    it("stores tokens server-side only, detects expiry, gates consequential writes, and runs mocked API calls", async () => {
      const userId = "usr_conn_1";
      disconnectConnectorToken(userId, "github");
      disconnectConnectorToken(userId, "slack");

      const reg = registerServerConnectorToken({
        userId,
        connectorId: "github",
        accessToken: "ghp_mockedServerTokenForTestOnly12345",
        scopes: ["repo"],
        expiresInSeconds: 3600,
      });
      expect(reg.ok).toBe(true);

      const userList = listConnectorsForUser(userId);
      const ghEntry = userList.find((c) => c.id === "github");
      expect(ghEntry?.operational).toBe(true);
      expect(JSON.stringify(userList)).not.toContain("ghp_mockedServerTokenForTestOnly12345");

      // Consequential capability blocked without approval
      const blockedWrite = await executeConnectorAction({
        userId,
        connectorId: "github",
        capabilityId: "create_pr",
        approvalGranted: false,
      });
      expect(blockedWrite.ok).toBe(false);
      expect(blockedWrite.requiresApproval).toBe(true);

      // Read action executes cleanly with mocked fetchFn
      const mockFetch = vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              full_name: "owner/demo",
              default_branch: "main",
              private: true,
              permissions: { push: true },
            }),
            { status: 200 },
          ),
      ) as unknown as typeof fetch;

      const repoRes = await executeConnectorAction({
        userId,
        connectorId: "github",
        capabilityId: "inspect_repo",
        input: { owner: "owner", repo: "demo" },
        fetchFn: mockFetch,
      });
      expect(repoRes.ok).toBe(true);

      // Expired token detected cleanly
      registerServerConnectorToken({
        userId,
        connectorId: "slack",
        accessToken: "xoxb-expired-token",
        expiresInSeconds: -10,
      });
      const slackStatus = resolveConnectorRuntimeStatus(userId, "slack");
      expect(slackStatus.operational).toBe(false);
      expect(slackStatus.authState).toBe("expired");

      const audit = listConnectorAuditLog(userId);
      expect(audit.length).toBeGreaterThanOrEqual(2);
      disconnectConnectorToken(userId, "github");
      disconnectConnectorToken(userId, "slack");
    });
  });

  // -------------------------------------------------------------------------
  // 9. Persistent Workflow Automation & Conversational NL Workflow Builder
  // -------------------------------------------------------------------------
  describe("9. Persistent Workflow Automation & NL Workflow Builder", () => {
    it("parses Hinglish & English workflows, enforces user approval, edits naturally, persists to disk, and runs due jobs with failure alerts", async () => {
      const hinglish = parseNaturalLanguageWorkflow(
        "Har roz subah 9 baje Meesho orders check karo aur orders.xlsx se compare karke report PDF export karo",
        { availableFiles: [], availableConnectors: [] },
      );
      expect(hinglish.scheduleType).toBe("recurring");
      expect(hinglish.recipe.schedule?.frequency).toBe("daily");
      expect(hinglish.recipe.schedule?.timeOfDay).toBe("09:00");
      expect(hinglish.recipe.approvedByUser).toBe(false);
      expect(hinglish.needsClarification).toBe(true);
      expect(hinglish.missingDetails.join(" ")).toContain("orders.xlsx");

      const english = parseNaturalLanguageWorkflow(
        "Every Monday at 10am check dashboard orders and export PDF report",
        { availableFiles: ["orders.xlsx"], availableConnectors: ["gmail"] },
      );
      expect(english.scheduleType).toBe("recurring");
      expect(english.recipe.schedule?.frequency).toBe("weekly");
      expect(english.needsClarification).toBe(false);

      // Persist & verify user isolation
      const saved = saveWorkflow("user_wf_1", english.recipe);
      expect(saved.enabled).toBe(false);
      expect(listWorkflows("user_wf_2")).toHaveLength(0);

      // Cannot execute before user approval
      const unapprovedRun = await executeWorkflowRun("user_wf_1", saved.id);
      expect(unapprovedRun.ok).toBe(false);

      // Approve & enable
      const enabled = enableApprovedWorkflow("user_wf_1", saved.id);
      expect(enabled.ok).toBe(true);
      expect(enabled.workflow?.enabled).toBe(true);
      expect(enabled.workflow?.schedule?.nextRunAtIso).toBeDefined();

      // Natural edit (time + retries + pause/resume)
      const editTime = editWorkflowNaturally(
        enabled.workflow!,
        "change time to 6pm with 2 retries",
      );
      expect(editTime.recipe.schedule?.timeOfDay).toBe("18:00");
      expect(editTime.recipe.retryPolicy?.maxRetries).toBe(2);

      const paused = pauseWorkflow("user_wf_1", saved.id);
      expect(paused.workflow?.enabled).toBe(false);
      const resumed = resumeWorkflow("user_wf_1", saved.id);
      expect(resumed.workflow?.enabled).toBe(true);

      applyNaturalEditToWorkflow("user_wf_1", saved.id, "update retries to 1 retries");

      // Simulate reload from .aistudio_data/workflows.json by clearing in-memory cache
      delete (globalThis as Record<string, unknown>)["__aiBuddyWorkflowAutomationStateV1"];
      const reloaded = listWorkflows("user_wf_1");
      expect(reloaded.some((w) => w.id === saved.id)).toBe(true);

      // Set nextRunAtIso in the past and trigger runDueWorkflows with failing runner to verify retry + FailureNotification
      const pastWf = reloaded.find((w) => w.id === saved.id)!;
      saveWorkflow("user_wf_1", {
        ...pastWf,
        approvedByUser: true,
        enabled: true,
        schedule: {
          ...pastWf.schedule!,
          nextRunAtIso: new Date(Date.now() - 60_000).toISOString(),
        },
      });

      const dueRes = await runDueWorkflows(new Date().toISOString(), async () => ({
        ok: false,
        stepsCompleted: 1,
        error: "Portal session expired",
      }));
      expect(dueRes.executedCount).toBe(1);
      expect(dueRes.results[0]?.ok).toBe(false);

      const alerts = listFailureNotifications("user_wf_1");
      expect(alerts.length).toBeGreaterThanOrEqual(1);
      expect(alerts[0]?.error).toContain("Portal session expired");

      const infra = getSchedulerInfrastructureReport();
      expect(infra.persistence).toContain("workflows.json");
      expect(infra.honestLimitation.length).toBeGreaterThan(20);
    });
  });

  // -------------------------------------------------------------------------
  // 10. Proactive Intelligence & Communication Agent
  // -------------------------------------------------------------------------
  describe("10. Proactive Intelligence & Communication Agent", () => {
    it("respects quietMode, minConfidence, cooldown, and allowedCategories", () => {
      const baseInput = {
        failureNotifications: [
          {
            id: "f1",
            userId: "u1",
            workflowId: "wf1",
            workflowName: "Orders Sync",
            error: "Timeout",
            timestamp: new Date().toISOString(),
            acknowledged: false,
          },
        ],
        activeProjects: [{ key: "Launch Q4", value: "Catalog SKU pricing check" }],
      };

      expect(
        generateProactiveSuggestions({ ...baseInput, preferences: { quietMode: true } }),
      ).toHaveLength(0);

      expect(
        generateProactiveSuggestions({
          ...baseInput,
          lastSuggestionAtIso: new Date().toISOString(),
          preferences: { cooldownMinutes: 30 },
        }),
      ).toHaveLength(0);

      const filtered = generateProactiveSuggestions({
        ...baseInput,
        preferences: { minConfidence: 0.9, allowedCategories: ["failed_run"] },
      });
      expect(filtered).toHaveLength(1);
      expect(filtered[0]?.category).toBe("failed_run");
      expect(filtered[0]?.suggestedActionPrompt).toContain("Orders Sync");
    });

    it("drafts replies, triages messages, and strictly enforces send approval + connector availability", () => {
      const triage = summarizeAndCategorizeMessages([
        {
          sender: "accounts@supplier.com",
          subject: "Urgent GST Invoice pending before Friday",
          body: "Please share the updated GST invoice by Friday 5pm with Password=secret999.",
        },
      ]);
      expect(triage[0]?.category).toBe("billing_tax");
      expect(triage[0]?.urgency).toBe("high");
      expect(triage[0]?.actionItems.length).toBeGreaterThanOrEqual(1);
      expect(triage[0]?.summary).toContain("[REDACTED]");

      const draft = createEmailDraft({
        to: ["accounts@supplier.com"],
        subject: "Re: GST Invoice",
        body: "Attached is our updated GST statement.",
      });
      expect(draft.status).toBe("awaiting_approval");

      const reply = draftReplyToMessage({
        original: {
          sender: "team@partner.com",
          subject: "Order #991",
          body: "Confirm dispatch",
        },
        replyPoints: ["Dispatched today."],
        language: "hinglish",
      });
      expect(reply.subject).toBe("Re: Order #991");

      const noApproval = prepareSendWithApprovalGate({
        draftId: draft.draftId,
        approvalGranted: false,
        connectorOperational: true,
      });
      expect(noApproval.allowed).toBe(false);
      expect(noApproval.status).toBe("awaiting_approval");

      const offlineConn = prepareSendWithApprovalGate({
        draftId: draft.draftId,
        approvalGranted: true,
        connectorOperational: false,
        connectorName: "Gmail",
      });
      expect(offlineConn.allowed).toBe(false);
      expect(offlineConn.status).toBe("connector_unavailable");

      const ready = prepareSendWithApprovalGate({
        draftId: draft.draftId,
        approvalGranted: true,
        connectorOperational: true,
        connectorName: "Gmail",
      });
      expect(ready.allowed).toBe(true);
      expect(ready.status).toBe("sent_ready");
    });
  });

  // -------------------------------------------------------------------------
  // 11. End-to-End Unified Orchestrator Fast Path vs Parallel Multi-Agent Path
  // -------------------------------------------------------------------------
  describe("11. Unified Orchestrator Fast Path & Multi-Agent Parallel Integration", () => {
    it("routes general chat queries to fast_path with low overhead", async () => {
      const decision = decideExecutionPath("What is Apple?", {
        snapshot: null,
      });
      expect(decision.path).toBe("fast_path");

      const res = await runUnifiedOrchestrator({
        instruction: "What is GST?",
        userId: "usr_fast",
      });
      expect(res.orchestration.path).toBe("fast_path");
      expect(res.costTelemetry.fastPathCount).toBeGreaterThanOrEqual(1);
    });

    it("executes multi_agent_path with parallel root branches, cross-file comparison, memory isolation, and proactive telemetry", async () => {
      const res = await runUnifiedOrchestrator({
        instruction:
          "Compare primary spreadsheet with comparison file, research market pricing, and schedule weekly summary report",
        userId: "usr_multi_1",
        spreadsheetData: [
          { sku: "SKU-10", price: 500, status: "active" },
          { sku: "SKU-20", price: 900, status: "active" },
        ],
        comparisonData: [{ sku: "SKU-10", price: 650, status: "active" }],
        researchSources: [
          {
            id: "r1",
            url: "https://example.org/pricing",
            title: "Market Report",
            domain: "example.org",
            snippets: ["Market pricing benchmarks show average SKU retail around 550."],
          },
        ],
        userMemories: [
          {
            id: "mem_u1",
            kind: "active_project",
            key: "Q4 Catalog Audit",
            value: "Reconcile active SKU pricing weekly",
            userId: "usr_multi_1",
            updatedAt: new Date().toISOString(),
          },
          {
            id: "mem_other",
            kind: "business_context",
            key: "SecretOtherUser",
            value: "Should never leak to usr_multi_1",
            userId: "usr_other",
            updatedAt: new Date().toISOString(),
          },
        ],
      });

      expect(res.orchestration.path).toBe("multi_agent_path");
      expect(res.orchestration.dagSummary?.maxObservedConcurrency).toBeGreaterThanOrEqual(2);
      expect(res.orchestration.subtaskDetails?.length).toBeGreaterThanOrEqual(2);
      expect(res.crossFileResult?.discrepancies.length).toBeGreaterThanOrEqual(1);
      expect(res.researchReport?.sourcesAnalyzed).toBe(1);
      expect(res.memoryContextBlock || "").not.toContain("SecretOtherUser");
      expect(res.costTelemetry.totalEstimatedTokens).toBeGreaterThan(0);
      expect(res.proactiveSuggestions.length).toBeGreaterThanOrEqual(1);
    });
  });
});
