import { describe, expect, it } from "vitest";
import {
  // Central Brain Orchestration
  classifyBrainIntent,
  determineCollaboratingBuddies,
  recommendOptimalModel,
  executeBuddyBrain,
  // Task Persistence & Checkpoint
  createTaskCheckpoint,
  recordStepCheckpoint,
  isActionDuplicate,
  rollbackToLastSafeCheckpoint,
  serializeCheckpoint,
  deserializeCheckpoint,
  computeActionHash,
  // File Workspace Engine
  compareSpreadsheetFiles,
  findCrossSpreadsheetDuplicates,
  mergeDocumentInsights,
  applyNonDestructiveFileUpdate,
  // Research Engine
  analyzeMultiSourceResearch,
  // Browser Intelligence Upgrades
  detectModalDialog,
  extractComplexTable,
  detectDynamicInfiniteScroll,
  // Workflow Recipes
  createWorkflowRecipe,
  approveWorkflowRecipe,
  recordWorkflowExecution,
  BUILTIN_RECIPES,
} from "../src/lib/engines";
import {
  getConnectorStatus,
  KNOWN_SERVICE_CONNECTORS,
} from "../src/lib/integrations/service-registry";
import type { PageSnapshot } from "../src/shared/page-snapshot";

const mockSnapshot: PageSnapshot = {
  url: "https://supplier.meesho.com/panel/orders",
  origin: "https://supplier.meesho.com",
  title: "Meesho Supplier Panel — Orders",
  capturedAt: new Date().toISOString(),
  truncated: false,
  text: "Order ID | Status | Amount\n#99214 | Pending | 1250\n#99215 | Delivered | 850\n#99216 | Pending | 2400",
  headings: [
    { ref: "h1", role: "heading", name: "Orders Dashboard", tag: "h1", level: 1, selector: "h1" },
  ],
  forms: [
    {
      ref: "in1",
      role: "textbox",
      name: "Search Order ID",
      tag: "input",
      placeholder: "Enter Order ID",
      selector: "input[placeholder='Enter Order ID']",
    },
  ],
  controls: [
    {
      ref: "btn1",
      role: "button",
      name: "Export CSV",
      tag: "button",
      selector: "button.export-csv",
    },
  ],
  alerts: [],
};

describe("Phase 3: Real-World Execution & Personal Automation Evolution", () => {
  describe("1. Universal Task Execution & Central Brain Orchestration", () => {
    it("classifies complex compound cross-domain instructions as universal_task", () => {
      const compoundInstruction =
        "Open my seller account, collect today's order information, compare it with my spreadsheet, identify missing orders, calculate the differences and prepare a report.";
      const intent = classifyBrainIntent(compoundInstruction);
      expect(intent).toBe("universal_task");
    });

    it("classifies cross-file spreadsheet comparison and multi-source research accurately", () => {
      expect(
        classifyBrainIntent("Compare these two Excel files and highlight price differences"),
      ).toBe("cross_file_comparison");
      expect(
        classifyBrainIntent(
          "Conduct multi-source research on competitor pricing across sources and fact check claims",
        ),
      ).toBe("multi_source_research");
    });

    it("executes universal task decomposition across Navigation, Page Intelligence, File Workspace, and Data engines", async () => {
      const liveOrders = [
        { id: "#99214", status: "Pending", price: 1250 },
        { id: "#99215", status: "Delivered", price: 850 },
      ];
      const spreadsheetData = [
        { id: "#99214", status: "Pending", price: 1100 }, // price discrepancy
        { id: "#99217", status: "Pending", price: 650 }, // missing in live
      ];

      const res = await executeBuddyBrain({
        instruction:
          "Open seller account, collect today's orders, compare with spreadsheet, and prepare reconciliation report",
        snapshot: mockSnapshot,
        spreadsheetData: liveOrders,
        comparisonData: spreadsheetData,
        buddySlug: "ecommerce",
      });

      expect(res.intent).toBe("universal_task");
      expect(res.executionPlan.length).toBeGreaterThanOrEqual(4);
      expect(res.executionPlan.some((s) => s.engine === "navigation")).toBe(true);
      expect(res.executionPlan.some((s) => s.engine === "page_intelligence")).toBe(true);
      expect(res.executionPlan.some((s) => s.engine === "file_workspace")).toBe(true);
      expect(res.executionPlan.some((s) => s.engine === "data_intelligence")).toBe(true);

      // Verify cross-file reconciliation was performed
      expect(res.crossFileResult).toBeDefined();
      expect(res.crossFileResult?.discrepancies.length).toBeGreaterThan(0);
      expect(res.crossFileResult?.missingInComparison.length).toBeGreaterThan(0);

      // Verify persistent checkpoint was initialized
      expect(res.checkpoint).toBeDefined();
      expect(res.checkpoint?.status).toBe("running");
    });
  });

  describe("2. Persistent Task Execution & Checkpoints", () => {
    it("creates, advances, and tracks checkpoints with duplicate action prevention", () => {
      const checkpoint = createTaskCheckpoint({
        taskId: "task_test_101",
        title: "Reconcile Orders Task",
        goal: "Check orders and compare prices",
        steps: [
          { id: "step_1", label: "Open Seller Portal", targetSelector: "nav.orders" },
          { id: "step_2", label: "Extract Order Rows", targetSelector: "table.orders" },
          { id: "step_3", label: "Generate Report", targetSelector: "#report" },
        ],
      });

      expect(checkpoint.taskId).toBe("task_test_101");
      expect(checkpoint.currentStepIndex).toBe(0);
      expect(checkpoint.totalSteps).toBe(3);
      expect(checkpoint.status).toBe("running");

      const actionHash1 = computeActionHash("click", "nav.orders", "", 0);
      expect(isActionDuplicate(checkpoint, actionHash1)).toBe(false);

      // Advance step 1
      const advanced = recordStepCheckpoint(checkpoint, "step_1", { opened: true }, actionHash1);
      expect(advanced.currentStepIndex).toBe(1);
      expect(advanced.completedStepIds).toContain("step_1");
      expect(isActionDuplicate(advanced, actionHash1)).toBe(true);
    });

    it("rolls back safely to the last verified step on recoverable failure", () => {
      let checkpoint = createTaskCheckpoint({
        title: "Multi-Step Process",
        goal: "Complete steps",
        steps: [
          { id: "s1", label: "Step 1" },
          { id: "s2", label: "Step 2" },
          { id: "s3", label: "Step 3" },
        ],
      });

      checkpoint = recordStepCheckpoint(checkpoint, "s1", { ok: true });
      expect(checkpoint.completedStepIds.length).toBe(1);

      // Simulate failure on step 2 and safe rollback
      const rolledBack = rollbackToLastSafeCheckpoint(checkpoint, "Network timeout on step 2");
      expect(rolledBack.status).toBe("paused");
      expect(rolledBack.currentStepIndex).toBe(1); // Safely paused at last completed step index
      expect(rolledBack.needsUserAttention).toBe(true);
      expect(rolledBack.attentionReason).toContain("Recovered safely");
    });

    it("serializes and deserializes checkpoints correctly across session reloads", () => {
      const original = createTaskCheckpoint({
        taskId: "task_persist_xyz",
        title: "Persistent Job",
        goal: "Test serialization",
        steps: [{ id: "s1", label: "Action 1" }],
      });

      const serialized = serializeCheckpoint(original);
      const deserialized = deserializeCheckpoint(serialized);

      expect(deserialized).not.toBeNull();
      expect(deserialized?.taskId).toBe("task_persist_xyz");
      expect(deserialized?.steps.length).toBe(1);
    });
  });

  describe("3. Advanced Browser Operator", () => {
    it("detects active modal dialogs, titles, and confirmation/dismiss buttons", () => {
      const modalSnapshot: PageSnapshot = {
        ...mockSnapshot,
        text: "Confirm Cancellation Dialog. Are you sure you want to cancel this order?",
        headings: [
          {
            ref: "mh1",
            role: "heading",
            name: "Confirm Action",
            tag: "h2",
            selector: ".modal-title",
          },
        ],
        controls: [
          {
            ref: "mb1",
            role: "button",
            name: "Dismiss",
            tag: "button",
            selector: "button.modal-close",
          },
          {
            ref: "mb2",
            role: "button",
            name: "Confirm Cancellation",
            tag: "button",
            selector: "button.modal-confirm",
          },
        ],
      };

      const modalInfo = detectModalDialog(modalSnapshot);
      expect(modalInfo.hasModal).toBe(true);
      expect(modalInfo.isBlocking).toBe(true);
      expect(modalInfo.dismissSelector).toBe("button.modal-close");
      expect(modalInfo.confirmSelector).toBe("button.modal-confirm");
    });

    it("extracts complex multi-column tables from page snapshot", () => {
      const tableData = extractComplexTable(mockSnapshot);
      expect(tableData.hasTable).toBe(true);
      expect(tableData.headers).toContain("Order ID");
      expect(tableData.headers).toContain("Status");
      expect(tableData.headers).toContain("Amount");
      expect(tableData.rowCount).toBe(3);
      expect(tableData.rows[0]["Order ID"]).toBe("#99214");
    });

    it("detects dynamic infinite scrolling without explicit pagination buttons", () => {
      const beforeSnap: PageSnapshot = {
        ...mockSnapshot,
        pageCompleteness: {
          scrollTop: 0,
          clientHeight: 600,
          scrollHeight: 2000,
          scrollPercent: 0,
          hasMoreBelow: true,
          hasMoreAbove: false,
        },
      };

      const afterSnap: PageSnapshot = {
        ...mockSnapshot,
        pageCompleteness: {
          scrollTop: 500,
          clientHeight: 600,
          scrollHeight: 2500,
          scrollPercent: 20,
          hasMoreBelow: true,
          hasMoreAbove: true,
        },
        controls: [
          ...mockSnapshot.controls,
          { ref: "btn2", role: "button", name: "Row 4", tag: "button", selector: "tr.row-4" },
          { ref: "btn3", role: "button", name: "Row 5", tag: "button", selector: "tr.row-5" },
        ],
      };

      const scrollResult = detectDynamicInfiniteScroll(beforeSnap, afterSnap);
      expect(scrollResult.infiniteScrolled).toBe(true);
      expect(scrollResult.newItemsCount).toBe(2);
    });
  });

  describe("4. Advanced File Workspace", () => {
    const baseExcel = [
      { id: "ORD-001", customer: "Priya", price: 799, status: "Delivered" },
      { id: "ORD-002", customer: "Rahul", price: 1200, status: "Shipped" },
      { id: "ORD-003", customer: "Anita", price: 450, status: "Pending" },
    ];

    const comparisonExcel = [
      { id: "ORD-001", customer: "Priya", price: 799, status: "Delivered" },
      { id: "ORD-002", customer: "Rahul", price: 1400, status: "Shipped" }, // Discrepancy: +200
      { id: "ORD-004", customer: "Vikram", price: 890, status: "Pending" }, // Missing in base
    ];

    it("performs cross-file spreadsheet comparison and calculates numerical differences", () => {
      const comparison = compareSpreadsheetFiles({
        baseData: baseExcel,
        compareData: comparisonExcel,
        keyField: "id",
        compareFields: ["price", "status"],
        baseFileName: "Internal_Orders.xlsx",
        compareFileName: "Portal_Export.csv",
      });

      expect(comparison.matchedRecords).toBe(2);
      expect(comparison.discrepancies.length).toBe(1);
      expect(comparison.discrepancies[0].key).toBe("ORD-002");
      expect(comparison.discrepancies[0].diffAmount).toBe(200);
      expect(comparison.missingInComparison).toContain("ORD-003");
      expect(comparison.missingInBase).toContain("ORD-004");
    });

    it("detects cross-file duplicate records across multiple spreadsheets", () => {
      const duplicates = findCrossSpreadsheetDuplicates(
        [
          { filename: "sheet1.csv", rows: [{ email: "user@example.com", name: "A" }] },
          { filename: "sheet2.csv", rows: [{ email: "user@example.com", name: "B" }] },
        ],
        "email",
      );

      expect(duplicates.length).toBe(1);
      expect(duplicates[0].key).toBe("user@example.com");
      expect(duplicates[0].count).toBe(2);
    });

    it("merges multi-document insights without altering original sources", () => {
      const docs = [
        {
          id: "d1",
          filename: "Q3_Report.pdf",
          format: "pdf" as const,
          content:
            "E-commerce sales increased by 24% driven by festive season discounts.\n\nShipping delays averaged 1.2 days.",
        },
        {
          id: "d2",
          filename: "Supplier_Notes.docx",
          format: "docx" as const,
          content:
            "Supplier onboarding completed for 45 new textile manufacturers.\n\nFestive season supply chain is fully stocked.",
        },
      ];

      const merged = mergeDocumentInsights(docs, "festive season sales");
      expect(merged.sourceCount).toBe(2);
      expect(merged.unifiedReport).toContain("Unified Document Synthesis");
      expect(merged.sections.length).toBeGreaterThan(0);
    });

    it("applies non-destructive file updates, generating audit trail without overwriting original data", () => {
      const updateResult = applyNonDestructiveFileUpdate({
        originalRows: baseExcel,
        updates: [{ matchKey: "id", matchValue: "ORD-002", targetField: "price", newValue: 1400 }],
        sourceFileName: "Orders.xlsx",
      });

      expect(updateResult.modifiedCount).toBe(1);
      expect(updateResult.outputFileName).toContain("Orders_reconciled");
      expect(updateResult.auditTrail.length).toBe(1);
      expect(updateResult.auditTrail[0].previousValue).toBe(1200);
      expect(updateResult.auditTrail[0].newValue).toBe(1400);

      // Verify original rows object was NOT mutated
      expect(baseExcel[1].price).toBe(1200);
    });
  });

  describe("5. Advanced Research Intelligence", () => {
    it("categorizes multi-source findings into verified facts, conflicting evidence, and unknowns", () => {
      const researchSources = [
        {
          id: "s1",
          domain: "techcrunch.com",
          title: "Meesho Q3 Growth Report",
          url: "https://techcrunch.com/meesho-q3",
          snippets: [
            "Meesho reported 150 million monthly active users in festive quarter 2026.",
            "Average commission rate remained 0% for basic tier sellers.",
          ],
        },
        {
          id: "s2",
          domain: "economictimes.indiatimes.com",
          title: "E-Commerce Market Analysis",
          url: "https://economictimes.indiatimes.com/ecommerce-2026",
          snippets: [
            "Meesho clocked over 150 million active users according to company filings.",
            "Commission rate for premium logistics service was set at 2.5%.",
          ],
        },
      ];

      const report = analyzeMultiSourceResearch({
        topic: "Meesho Platform Metrics & Commission",
        sources: researchSources,
        claimsToEvaluate: [
          {
            claim: "150 million active users in festive quarter",
            suggestedCategory: "verified_fact",
          },
          { claim: "Commission rates for sellers", suggestedCategory: "conflicting_evidence" },
          { claim: "Unannounced international expansion plan", suggestedCategory: "unknown" },
        ],
      });

      expect(report.sourcesAnalyzed).toBe(2);
      expect(report.verifiedFacts.length).toBeGreaterThan(0);
      expect(report.conflictingFindings.length).toBeGreaterThan(0);
      expect(report.unansweredQuestions.length).toBeGreaterThan(0);
      expect(report.citations.length).toBe(2);
      expect(report.markdownReport).toContain("Verified Facts & Consensus");
    });
  });

  describe("6. Personal Automation Workspace (Workflow Recipes)", () => {
    it("creates workflow recipes with parameters and strictly gates user approval", () => {
      const res = createWorkflowRecipe({
        name: "Daily Meesho Reconciliation",
        description: "Reconcile daily portal orders with accounting excel",
        triggerPhrases: ["run daily reconciliation"],
        parameters: [
          {
            key: "dateFilter",
            label: "Order Date",
            type: "string",
            defaultValue: "today",
            required: true,
          },
        ],
        steps: [
          { id: "s1", order: 1, label: "Collect Orders", actionType: "extract_table" },
          { id: "s2", order: 2, label: "Compare Spreadsheet", actionType: "extract" },
        ],
      });

      expect(res.recipe).not.toBeNull();
      // Crucial Safety Gate: Newly created recipes must NEVER auto-run without user approval
      expect(res.recipe?.approvedByUser).toBe(false);

      // Approve recipe
      const approved = approveWorkflowRecipe(res.recipe!);
      expect(approved.approvedByUser).toBe(true);

      // Record execution run
      const recorded = recordWorkflowExecution(approved, {
        runId: "run_001",
        recipeId: approved.id,
        executedAt: new Date().toISOString(),
        durationMs: 1450,
        status: "completed",
        stepsCompleted: 2,
        outputSummary: "Reconciled 42 orders with 0 discrepancies.",
      });

      expect(recorded.executionCount).toBe(1);
      expect(recorded.executionHistory?.length).toBe(1);
    });

    it("provides built-in Phase 3 recipes for reconciliation and research", () => {
      const reconcileRecipe = BUILTIN_RECIPES.find(
        (r) => r.id === "recipe_reconcile_orders_spreadsheet",
      );
      expect(reconcileRecipe).toBeDefined();
      expect(reconcileRecipe?.parameters?.length).toBeGreaterThan(0);

      const researchRecipe = BUILTIN_RECIPES.find((r) => r.id === "recipe_multisource_research");
      expect(researchRecipe).toBeDefined();
    });
  });

  describe("7. Intelligent Specialist Collaboration & Extensibility", () => {
    it("provides clear disagreement resolution policy when specialists collaborate", () => {
      const collab = determineCollaboratingBuddies(
        "Check Meesho orders and calculate GST difference",
        "ecommerce",
      );
      expect(collab.contributingSpecialists.length).toBeGreaterThan(0);
      expect(collab.disagreementResolution).toBeDefined();
      expect(collab.disagreementResolution).toContain("Central Brain");
    });

    it("verifies service connector registry reports truthful operational statuses without fake mocks", () => {
      const gmailStatus = getConnectorStatus("gmail");
      expect(gmailStatus.found).toBe(true);
      expect(gmailStatus.operational).toBe(false); // Truthful: not authorized yet
      expect(gmailStatus.missingRequirements.length).toBeGreaterThan(0);

      const meeshoStatus = getConnectorStatus("meesho_supplier");
      expect(meeshoStatus.found).toBe(true);
      expect(meeshoStatus.operational).toBe(true); // Truthful: operates via active tab DOM
    });
  });
});
