import { describe, expect, it } from "vitest";
import {
  // Central Brain Orchestration
  parseTaskControlCommand,
  classifyBrainIntent,
  determineCollaboratingBuddies,
  recommendOptimalModel,
  executeBuddyBrain,
  // Data & Spreadsheet Intelligence
  analyzeSpreadsheetData,
  editSpreadsheetNonDestructively,
  generateStructuredReport,
  // Page Intelligence Semantic Matching
  analyzePageIntelligence,
  findSemanticTarget,
  detectDynamicMutations,
  // Action Engine Preconditions & Comparison
  evaluateStepPrecondition,
  compareActionStates,
  // Context-Aware Memory
  retrieveContextualMemories,
  validateMemoryEntry,
  // Workflow Recipes
  detectRepeatedWorkflowPattern,
  validateWorkflowRecipe,
  BUILTIN_RECIPES,
} from "../src/lib/engines";
import type { PageSnapshot } from "../src/shared/page-snapshot";

const mockSnapshot: PageSnapshot = {
  url: "https://supplier.meesho.com/panel/orders",
  origin: "https://supplier.meesho.com",
  title: "Meesho Supplier Panel — Orders",
  capturedAt: new Date().toISOString(),
  truncated: false,
  text: "Meesho Supplier Panel Orders Pending Ready to Ship Shipped Order ID #99214 Total Amount 1250",
  headings: [
    { ref: "h1", role: "heading", name: "Orders Dashboard", tag: "h1", level: 1 },
    { ref: "h2", role: "heading", name: "Pending Orders List", tag: "h2", level: 2 },
  ],
  forms: [
    { ref: "f1", role: "form", name: "Filter Orders", tag: "form" },
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
    { ref: "btn1", role: "button", name: "Next Page", tag: "button", selector: "button.next-page" },
    {
      ref: "btn2",
      role: "button",
      name: "Export CSV",
      tag: "button",
      selector: "button.export-csv",
    },
    {
      ref: "sub1",
      role: "button",
      name: "Delete Order",
      tag: "button",
      selector: "button.delete-order",
    },
  ],
  alerts: [],
};

describe("AI Buddy Phase 2 Evolution Test Suite", () => {
  describe("1. Central Brain — Master Orchestration & In-Flight Control", () => {
    it("parses natural language in-flight task control commands accurately", () => {
      expect(parseTaskControlCommand("continue")?.action).toBe("resume");
      expect(parseTaskControlCommand("pause for a moment")?.action).toBe("pause");
      expect(parseTaskControlCommand("skip this step")?.action).toBe("skip");
      expect(parseTaskControlCommand("stop this task")?.action).toBe("stop");
      expect(parseTaskControlCommand("use another method")?.action).toBe("retry_alternative");
      expect(parseTaskControlCommand("prepare a summary")?.action).toBe("summarize_progress");
      expect(parseTaskControlCommand("don't change anything else")?.action).toBe("preserve_only");
      expect(parseTaskControlCommand("what is the weather today?")).toBeNull();
    });

    it("classifies task control command intent before generic question answering", () => {
      expect(classifyBrainIntent("continue")).toBe("task_control_command");
      expect(classifyBrainIntent("pause")).toBe("task_control_command");
      expect(classifyBrainIntent("skip this step")).toBe("task_control_command");
      expect(classifyBrainIntent("Audit this spreadsheet column for incorrect prices")).toBe(
        "spreadsheet_audit",
      );
    });

    it("determines intelligent multi-Buddy collaboration across specialists", () => {
      const ecomCollab = determineCollaboratingBuddies(
        "Check Meesho orders, calculate GST tax invoice and export table",
        "friendly",
      );
      expect(ecomCollab.contributingSpecialists.some((s) => s.slug === "ca")).toBe(true);
      expect(ecomCollab.contributingSpecialists.some((s) => s.slug === "data")).toBe(true);

      const devCollab = determineCollaboratingBuddies(
        "Debug this script and DOM code error",
        "friendly",
      );
      expect(devCollab.contributingSpecialists.some((s) => s.slug === "developer")).toBe(true);
      expect(devCollab.contributingSpecialists.some((s) => s.slug === "operations")).toBe(true);
    });

    it("recommends task-specific AI models truthfully", () => {
      expect(recommendOptimalModel("locate_element", true)).toBe("gemini-3.8-flash");
      expect(recommendOptimalModel("spreadsheet_audit", false)).toBe("groq-llama-3.3-70b");
      expect(recommendOptimalModel("explain_page", false)).toBe("gemini-3.8-flash");
    });

    it("executes Central Brain orchestration and returns unified response", async () => {
      const res = await executeBuddyBrain({
        instruction: "locate Search Order ID input on this page",
        snapshot: mockSnapshot,
        buddySlug: "friendly",
      });
      expect(res.intent).toBe("locate_element");
      expect(res.highlightSelector).toBeDefined();
      expect(res.executionPlan.length).toBeGreaterThan(0);
      expect(res.recommendedModel).toBe("gemini-3.8-flash");
    });
  });

  describe("2. Smart Data & Spreadsheet Intelligence", () => {
    const mockRows = [
      { id: "SKU-001", title: "Embroidered Kurti", price: 799, status: "Active", stock: 15 },
      { id: "SKU-002", title: "Cotton Saree", price: 0, status: "Active", stock: 40 }, // Anomaly: zero price
      { id: "SKU-003", title: "Silk Dupatta", price: -150, status: "Active", stock: 8 }, // Anomaly: negative price
      { id: "SKU-004", title: "Linen Shirt", price: 1200, status: "Paused", stock: 0 },
    ];

    it("analyzes spreadsheet columns, types, and detects pricing anomalies", () => {
      const analysis = analyzeSpreadsheetData(mockRows);
      expect(analysis.rowCount).toBe(4);
      expect(analysis.columnCount).toBe(5);

      const priceCol = analysis.columns.find((c) => c.name === "price");
      expect(priceCol?.inferredType).toBe("currency");
      expect(priceCol?.numericSummary?.sum).toBe(1849);

      expect(analysis.anomalies.length).toBe(2);
      expect(analysis.anomalies.some((a) => a.recordIdentifier === "SKU-002")).toBe(true);
      expect(analysis.anomalies.some((a) => a.recordIdentifier === "SKU-003")).toBe(true);
    });

    it("edits spreadsheet non-destructively, preserving unrelated cells and generating an audit trail", () => {
      const edits = [
        { matchKey: "id", matchValue: "SKU-002", targetColumn: "price", newValue: 899 },
        { matchKey: "id", matchValue: "SKU-003", targetColumn: "price", newValue: 450 },
      ];
      const result = editSpreadsheetNonDestructively(mockRows, edits);
      expect(result.modifiedRowCount).toBe(2);
      expect(result.totalRowCount).toBe(4);
      expect(result.auditTrail.length).toBe(2);

      // Verify SKU-002 was updated
      const updatedSKU2 = result.updatedRows.find((r) => r.id === "SKU-002");
      expect(updatedSKU2?.price).toBe(899);
      expect(updatedSKU2?.title).toBe("Cotton Saree"); // Preserved
      expect(updatedSKU2?.stock).toBe(40); // Preserved

      // Verify unrelated SKU-001 is completely untouched
      const sku1 = result.updatedRows.find((r) => r.id === "SKU-001");
      expect(sku1?.price).toBe(799);
      expect(sku1?.status).toBe("Active");
    });

    it("generates structured reports in CSV, JSON and Markdown", () => {
      const records = [
        {
          id: "1",
          title: "Item 1",
          status: "active",
          amount: 100,
          raw: { id: "1", title: "Item 1", amount: 100 },
        },
        {
          id: "2",
          title: "Item 2",
          status: "active",
          amount: 200,
          raw: { id: "2", title: "Item 2", amount: 200 },
        },
      ];

      const csv = generateStructuredReport(records, "csv");
      expect(csv).toContain('"id","title","amount"');
      expect(csv).toContain('"Item 1"');

      const json = generateStructuredReport(records, "json");
      expect(JSON.parse(json).length).toBe(2);

      const md = generateStructuredReport(records, "markdown");
      expect(md).toContain("| id | title | amount |");
    });
  });

  describe("3. Browser Intelligence & Semantic Element Discovery", () => {
    it("discovers target elements using semantic context and adjacent labels", () => {
      const structured = analyzePageIntelligence(mockSnapshot);
      const match = findSemanticTarget(structured, "Enter Order ID");
      expect(match).not.toBeNull();
      expect(match?.element.tag).toBe("input");
      expect(match?.confidence).toBeGreaterThanOrEqual(15);
    });

    it("detects dynamic mutations when comparing before and after structured states", () => {
      const before = analyzePageIntelligence(mockSnapshot);
      const afterSnapshot: PageSnapshot = {
        ...mockSnapshot,
        forms: [
          ...mockSnapshot.forms,
          { ref: "new_f", role: "form", name: "Shipping Address Form", tag: "form" },
        ],
        alerts: [{ ref: "al_1", role: "alert", name: "Order Saved Successfully", tag: "div" }],
      };
      const after = analyzePageIntelligence(afterSnapshot);
      const diff = detectDynamicMutations(before, after);
      expect(diff.mutated).toBe(true);
      expect(diff.formsAdded).toBe(1);
      expect(diff.alertsAdded).toBe(1);
      expect(diff.summary).toContain("new form");
    });
  });

  describe("4. Autonomous Workflows & Step Dependencies", () => {
    it("evaluates step preconditions: waits for loading, requests auth, or gates consequential approvals", () => {
      const loadingEval = evaluateStepPrecondition(
        { label: "Submit Order", isConsequential: true },
        { isPageLoading: true },
      );
      expect(loadingEval.ready).toBe(false);
      expect(loadingEval.state).toBe("waiting_for_page_load");

      const authEval = evaluateStepPrecondition(
        { label: "Open Seller Portal" },
        { isBlockedByAuth: true },
      );
      expect(authEval.ready).toBe(false);
      expect(authEval.state).toBe("waiting_for_user_assistance");

      const consequentialEval = evaluateStepPrecondition(
        { label: "Delete Order", isConsequential: true },
        { userConsentGranted: false },
      );
      expect(consequentialEval.ready).toBe(false);
      expect(consequentialEval.state).toBe("awaiting_approval");

      const readyEval = evaluateStepPrecondition(
        { label: "Click Filter", isConsequential: false },
        { userConsentGranted: true },
      );
      expect(readyEval.ready).toBe(true);
      expect(readyEval.state).toBe("ready");
    });

    it("verifies page state mutations before vs after actions", () => {
      const before = { text: "Old content on page", url: "https://example.com/page1" };
      const after = {
        text: "New updated content on page with extra table rows",
        url: "https://example.com/page1",
      };
      const res = compareActionStates(before, after);
      expect(res.mutated).toBe(true);
      expect(res.verified).toBe(true);
      expect(res.lengthDelta).toBeGreaterThan(0);
    });
  });

  describe("5. Context-Aware Multi-Tier Memory Engine", () => {
    it("ranks multi-tier memories with category weighting and project affinity", () => {
      const memories = [
        { id: "m1", key: "theme", value: "dark", kind: "preference" as const, updatedAt: "" },
        {
          id: "m2",
          key: "seller_gstin",
          value: "24AAAAA0000A1Z5",
          kind: "long_term_fact" as const,
          updatedAt: "",
        },
        {
          id: "m3",
          key: "meesho_audit",
          value: "Check pending orders daily",
          kind: "active_project" as const,
          projectId: "proj_meesho",
          updatedAt: "",
        },
      ];

      const res = retrieveContextualMemories(memories, "meesho order audit", {
        activeProjectId: "proj_meesho",
      });
      expect(res.relevantMemories.length).toBeGreaterThan(0);
      expect(res.relevantMemories[0].key).toBe("meesho_audit");
      expect(res.categorizedCounts["active_project"]).toBe(1);
    });

    it("strictly blocks sensitive credentials from memory storage", () => {
      expect(validateMemoryEntry("bank_otp", "849201").valid).toBe(false);
      expect(validateMemoryEntry("user_password", "MyP@ssw0rd!").valid).toBe(false);
      expect(validateMemoryEntry("gstin_number", "24AAAAA0000A1Z5").valid).toBe(true);
    });
  });

  describe("6. Proactive Task Assistance & Workflow Recipes", () => {
    it("detects repeated automation patterns and builds reusable workflow recipes", () => {
      const history = [
        {
          id: "1",
          title: "Meesho Pending Orders",
          intent: "multi_step",
          status: "completed",
          createdAt: "",
        },
        {
          id: "2",
          title: "Meesho Pending Orders",
          intent: "multi_step",
          status: "completed",
          createdAt: "",
        },
      ];
      const recipe = detectRepeatedWorkflowPattern(history, 2);
      expect(recipe).not.toBeNull();
      expect(recipe?.name).toContain("Meesho Pending Orders");
      expect(recipe?.approvedByUser).toBe(false); // Requires user confirmation before activating
    });

    it("validates workflow recipes and rejects recipes with embedded credentials", () => {
      const valid = validateWorkflowRecipe(BUILTIN_RECIPES[0]);
      expect(valid.valid).toBe(true);

      const invalidRecipe = {
        name: "Insecure Workflow",
        steps: [
          {
            id: "s1",
            order: 1,
            label: "Login",
            actionType: "fill_form" as const,
            parameterKey: "user_password",
          },
        ],
      };
      const check = validateWorkflowRecipe(invalidRecipe);
      expect(check.valid).toBe(false);
      expect(check.reason).toContain("credentials");
    });
  });
});
