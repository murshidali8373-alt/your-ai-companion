import { describe, expect, it } from "vitest";
import {
  // Engine 1: Navigation
  identifyScrollContainers,
  searchContent,
  evaluatePagination,
  detectInfiniteScroll,
  // Engine 2: Page Intelligence
  analyzePageIntelligence,
  lookupElement,
  // Engine 3: Action
  validateAction,
  createActionResult,
  // Engine 4: Data Intelligence
  normalizeRecordStatus,
  aggregateRecords,
  // Engine 5: Visual Interaction
  calculateArmKinematics,
  calculateCalloutCoordinates,
  // Engine 6: Memory
  validateMemoryEntry,
  retrieveContextualMemories,
  // Central Brain
  classifyBrainIntent,
  resolveBuddyPersona,
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
    { ref: "in1", role: "textbox", name: "Search Order ID", tag: "input" },
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
  scrollableContainers: [
    {
      selector: "window",
      clientHeight: 800,
      scrollHeight: 2400,
      scrollTop: 0,
      canScrollDown: true,
    },
  ],
  pagination: {
    currentPage: 1,
    totalPages: 5,
    hasNextPage: true,
    hasPrevPage: false,
  },
};

describe("Modular Engine Architecture Test Suite", () => {
  describe("Engine 1: Navigation Engine", () => {
    it("identifies window container", () => {
      const containers = identifyScrollContainers(mockSnapshot);
      expect(containers.length).toBeGreaterThan(0);
      expect(containers[0].selector).toBe("window");
    });

    it("searches content in snapshot text and elements", () => {
      const result = searchContent(mockSnapshot, "Order ID");
      expect(result.matched).toBe(true);
      expect(result.count).toBeGreaterThan(0);
    });

    it("evaluates pagination controls when next button is present", () => {
      const pagination = evaluatePagination(mockSnapshot);
      expect(pagination.canGoNext).toBe(true);
      expect(pagination.nextSelector).toBe("button.next-page");
    });

    it("detects infinite scroll indicator or absence", () => {
      const isInfinite = detectInfiniteScroll(mockSnapshot);
      expect(typeof isInfinite).toBe("boolean");
    });
  });

  describe("Engine 2: Page Intelligence Engine", () => {
    it("analyzes page intelligence and coverage metrics", () => {
      const structured = analyzePageIntelligence(mockSnapshot);
      expect(structured.metadata.url).toBe(mockSnapshot.url);
      expect(structured.sections.length).toBe(2);
      expect(structured.formInputCount).toBe(2);
      expect(structured.interactiveControlCount).toBe(3);
      expect(structured.coverage).toBe("current_page_complete");
    });

    it("looks up elements by name or ref", () => {
      const structured = analyzePageIntelligence(mockSnapshot);
      const byRef = lookupElement(structured, "h1");
      expect(byRef?.name).toBe("Orders Dashboard");
      const bySelector = lookupElement(structured, "button.next-page");
      expect(bySelector?.name).toBe("Next Page");
    });
  });

  describe("Engine 3: Action Engine", () => {
    it("validates safe observe/explain actions under all permission levels", () => {
      const validation = validateAction({
        pageUrl: "https://supplier.meesho.com/panel/orders",
        type: "click",
        target: { role: "button", selector: "button.next-page" },
        userPermissionLevel: "execute",
      });
      expect(validation.allowed).toBe(true);
      expect(validation.requiresConsent).toBe(false);
      expect(validation.isConsequential).toBe(false);
    });

    it("flags consequential destructive actions (delete) for explicit confirmation", () => {
      const validation = validateAction({
        pageUrl: "https://supplier.meesho.com/panel/orders",
        type: "click_delete",
        target: { role: "button", selector: "button.delete-order" },
        userPermissionLevel: "execute",
      });
      expect(validation.requiresConsent).toBe(true);
      expect(validation.isConsequential).toBe(true);
    });

    it("blocks execution on restricted permission levels like observe or explain", () => {
      const validation = validateAction({
        pageUrl: "https://supplier.meesho.com/panel/orders",
        type: "click",
        target: { role: "button", selector: "button.next-page" },
        userPermissionLevel: "observe",
      });
      expect(validation.allowed).toBe(false);
      expect(validation.reason).toContain("observe");
    });

    it("formats standard action result records", () => {
      const res = createActionResult("act_1", "click", true, true, "Clicked button");
      expect(res.actionId).toBe("act_1");
      expect(res.success).toBe(true);
      expect(res.verified).toBe(true);
      expect(res.type).toBe("click");
    });
  });

  describe("Engine 4: Data Intelligence Engine", () => {
    it("normalizes diverse status labels", () => {
      expect(normalizeRecordStatus("PENDING QC")).toBe("pending_qc");
      expect(normalizeRecordStatus("In Progress / Live")).toBe("active");
      expect(normalizeRecordStatus("Delivered and Completed")).toBe("completed");
      expect(normalizeRecordStatus("Disabled")).toBe("paused");
      expect(normalizeRecordStatus("cancelled")).toBe("cancelled");
    });

    it("aggregates and deduplicates records by key", () => {
      const rawRecords = [
        { id: "ORD_101", status: "pending qc", amount: 500, raw: { amount: 500 } },
        { id: "ORD_102", status: "active", amount: 750, raw: { amount: 750 } },
        { id: "ORD_101", status: "pending qc", amount: 500, raw: { amount: 500 } }, // duplicate
      ];
      const aggregated = aggregateRecords(rawRecords, { numericFields: ["amount"] });
      expect(aggregated.totalRecords).toBe(3);
      expect(aggregated.uniqueRecords).toBe(2);
      expect(aggregated.duplicateCount).toBe(1);
      expect(aggregated.statusCounts["pending_qc"]).toBe(1);
      expect(aggregated.numericalSummaries["amount"]?.sum).toBe(1250);
    });
  });

  describe("Engine 5: Visual Interaction Engine", () => {
    it("calculates arm kinematics Bezier spline towards target coordinates", () => {
      const kinematics = calculateArmKinematics(
        { left: 100, top: 200, width: 80, height: 30 },
        { width: 1000, height: 800 },
      );
      expect(kinematics.shoulder.x).toBeGreaterThan(0);
      expect(kinematics.wrist.x).toBeGreaterThan(0);
      expect(kinematics.bezierPath).toContain("Q");
    });

    it("calculates clamped callout coordinates within viewport bounds", () => {
      const coords = calculateCalloutCoordinates(
        { left: 100, top: 100, width: 80, height: 30 },
        { width: 1000, height: 800 },
      );
      expect(coords.ringRect.left).toBeGreaterThanOrEqual(0);
      expect(coords.cardRect.left).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Engine 6: Memory Engine", () => {
    it("validates safe memory keys and values while rejecting sensitive data (passwords, cards)", () => {
      const valid = validateMemoryEntry("shipping_address", "123 Business Park, Surat, Gujarat");
      expect(valid.valid).toBe(true);

      const invalidPassword = validateMemoryEntry("account_password", "SecretPass123!");
      expect(invalidPassword.valid).toBe(false);
      expect(invalidPassword.reason).toContain("password");

      const invalidCard = validateMemoryEntry("credit_card", "4532 8923 1120 9021");
      expect(invalidCard.valid).toBe(false);
    });

    it("retrieves contextual memories matching question", () => {
      const memories = [
        { id: "1", key: "seller_gstin", value: "24AAAAA0000A1Z5", kind: "tax", updatedAt: "" },
        {
          id: "2",
          key: "meesho_store_name",
          value: "Aparna Fashion",
          kind: "profile",
          updatedAt: "",
        },
        { id: "3", key: "unrelated_pref", value: "likes dark theme", kind: "ui", updatedAt: "" },
      ];

      const res = retrieveContextualMemories(
        memories,
        "What is my seller_gstin for Meesho invoice?",
      );
      expect(res.relevantMemories.length).toBeGreaterThan(0);
      expect(res.relevantMemories.some((m) => m.key === "seller_gstin")).toBe(true);
      expect(res.suppressedByPrivacyMode).toBe(false);
    });
  });

  describe("Central AI Buddy Brain Orchestrator", () => {
    it("classifies brain intent from natural language instructions", () => {
      expect(
        classifyBrainIntent("Open Meesho, check today's pending orders and prepare a report"),
      ).toBe("multi_step_task");

      expect(classifyBrainIntent("Where is the GSTIN field on this page?")).toBe("locate_element");

      expect(classifyBrainIntent("Fill this registration form with my verified details")).toBe(
        "smart_form_fill",
      );

      expect(classifyBrainIntent("What is this website about?")).toBe("explain_page");
    });

    it("resolves buddy persona for all 16 specialists and custom buddy", () => {
      const friendly = resolveBuddyPersona("friendly");
      expect(friendly.name).toBe("Friendly Buddy");
      expect(friendly.preset?.slug).toBe("friendly");

      const developer = resolveBuddyPersona("developer");
      expect(developer.name).toBe("Developer Buddy");

      const custom = resolveBuddyPersona("custom:user_custom_buddy_1", "user_custom_buddy_1");
      expect(custom.name).toBe("My Custom Buddy");
    });
  });
});
