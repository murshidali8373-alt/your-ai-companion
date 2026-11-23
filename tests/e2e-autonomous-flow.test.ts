import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildObjectiveDagPlan, selectAgentsForObjective } from "../src/lib/agents/agent-registry";
import { executeAgentDag } from "../src/lib/agents/dag-executor";
import { createSpecializedSubtaskRunner } from "../src/lib/agents/specialized-agents";
import { readScopedCollection, updateScopedCollection } from "../src/lib/persistence/store.server";
import { verifyResearchCitations } from "../src/lib/engines/research-engine";

let tmpDir = "";
const prevDataDir = process.env.AI_BUDDY_DATA_DIR;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aibuddy-e2e-"));
  process.env.AI_BUDDY_DATA_DIR = tmpDir;
});

afterEach(() => {
  if (prevDataDir === undefined) delete process.env.AI_BUDDY_DATA_DIR;
  else process.env.AI_BUDDY_DATA_DIR = prevDataDir;
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

describe("Phase 3 + 4 End-to-End Autonomous Multi-Agent Scenario", () => {
  it("orchestrates spreadsheet comparison, outlier detection, verified research citations, and XLSX/DOCX/PDF artifact exports", async () => {
    const objective =
      "Compare supplier and accounting XLSX rows, detect outliers & discrepancies, research GST note from verified sources, and export XLSX, DOCX, and PDF reports.";

    const selected = selectAgentsForObjective(objective, {
      hasSpreadsheet: true,
      hasComparisonFiles: true,
      hasResearchSources: true,
      hasFiles: true,
    });

    const subtasks = buildObjectiveDagPlan({
      runId: "dag_e2e_audit",
      objective,
      selectedAgents: selected,
      fileName: "supplier.xlsx",
      comparisonFileName: "accounting.xlsx",
      outputFormats: ["xlsx", "docx", "pdf"],
    });

    const runner = createSpecializedSubtaskRunner({
      userId: "e2e_user",
      objective,
      fileName: "supplier.xlsx",
      comparisonFileName: "accounting.xlsx",
      keyField: "SKU",
      compareFields: ["Amount"],
      rows: [
        { SKU: "SKU-1", Amount: 1000 },
        { SKU: "SKU-2", Amount: 1200 },
        { SKU: "SKU-3", Amount: 1150 },
        { SKU: "SKU-4", Amount: 50000 },
      ],
      comparisonRows: [
        { SKU: "SKU-1", Amount: 1000 },
        { SKU: "SKU-2", Amount: 1450 },
        { SKU: "SKU-3", Amount: 1150 },
        { SKU: "SKU-4", Amount: 50000 },
      ],
      researchSources: [
        {
          id: "src_cbic",
          url: "https://cbic-gst.gov.in/gst-rules",
          title: "CBIC Official GST Guidance",
          domain: "cbic-gst.gov.in",
          snippets: ["E-commerce suppliers must reconcile TCS credit statements monthly."],
        },
        {
          id: "src_portal",
          url: "https://tutorial.gst.gov.in/reconciliation",
          title: "GST Portal Reconciliation Guide",
          domain: "tutorial.gst.gov.in",
          snippets: ["E-commerce suppliers must reconcile TCS credit statements monthly."],
        },
      ],
      outputFormats: ["xlsx", "docx", "pdf"],
    });

    const run = await executeAgentDag({
      runId: "dag_e2e_audit",
      userId: "e2e_user",
      objective,
      subtasks,
      runner,
      maxConcurrency: 4,
      onCheckpoint: async (state) => {
        await updateScopedCollection("e2e_user", "dag_runs", [], () => [state]);
      },
    });

    expect(run.status).toBe("completed");
    expect(run.artifacts.some((a) => a.kind === "xlsx")).toBe(true);
    expect(run.artifacts.some((a) => a.kind === "docx")).toBe(true);
    expect(run.artifacts.some((a) => a.kind === "pdf")).toBe(true);
    expect(run.verifications.some((v) => v.passed)).toBe(true);

    // Verify research citation integrity helper strips ungrounded URLs
    const citeCheck = verifyResearchCitations(
      [
        {
          number: 1,
          title: "Valid",
          url: "https://cbic-gst.gov.in/gst-rules",
          domain: "cbic-gst.gov.in",
        },
        {
          number: 2,
          title: "Hallucinated",
          url: "https://fake-hallucinated.example/invented",
          domain: "fake-hallucinated.example",
        },
      ],
      [
        {
          id: "src_cbic",
          url: "https://cbic-gst.gov.in/gst-rules",
          title: "CBIC Official GST Guidance",
          domain: "cbic-gst.gov.in",
          snippets: ["Verified"],
        },
      ],
    );
    expect(citeCheck.validCitations).toHaveLength(1);
    expect(citeCheck.rejectedCitations).toHaveLength(1);

    // Check durable checkpoint persistence
    const savedRuns = await readScopedCollection<unknown[]>("e2e_user", "dag_runs", []);
    expect(savedRuns).toHaveLength(1);
  });
});
