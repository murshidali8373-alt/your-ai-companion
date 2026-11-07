import { describe, expect, it } from "vitest";
import {
  buildPageContext,
  type PageSnapshot,
  type PageCompleteness,
  type PaginationInfo,
} from "../src/shared/page-snapshot";
import {
  validateBrowserAction,
  createActionResult,
  type BrowserActionRequest,
} from "../src/shared/browser-action";

describe("Browser Actions Executor & Page Intelligence", () => {
  describe("Page Completeness & Structured Context", () => {
    it("incorporates page completeness, pagination, and status counts into context", () => {
      const completeness: PageCompleteness = {
        scrollPercent: 35,
        scrollTop: 400,
        scrollHeight: 2400,
        clientHeight: 800,
        hasMoreBelow: true,
        hasMoreAbove: true,
      };

      const pagination: PaginationInfo = {
        currentPage: 1,
        totalPages: 5,
        hasNextPage: true,
        pageIndicatorText: "Showing 1-10 of 48 orders",
      };

      const snapshot: PageSnapshot = {
        url: "https://seller.marketplace.in/ads",
        origin: "https://seller.marketplace.in",
        title: "Campaigns & Advertisements",
        capturedAt: new Date().toISOString(),
        headings: [],
        forms: [],
        controls: [],
        alerts: [],
        text: "Sponsored ad 101 paused. Sponsored ad 102 paused. Sponsored ad 103 active.",
        truncated: false,
        pageCompleteness: completeness,
        pagination,
        statusCounts: {
          paused: 14,
          active: 8,
          "pending qc": 3,
        },
        scrollableContainers: [
          {
            selector: "table.orders-table",
            tag: "table",
            scrollHeight: 1200,
            clientHeight: 400,
            canScrollDown: true,
          },
        ],
      };

      const context = buildPageContext(snapshot);

      // Verify page completeness caution is present
      expect(context).toContain("PAGE COMPLETENESS:");
      expect(context).toContain("CAUTION: More content exists below the visible viewport");
      expect(context).toContain("1200px unrendered/unscrolled");

      // Verify pagination is reflected
      expect(context).toContain("PAGINATION: Showing 1-10 of 48 orders (Next page available)");

      // Verify deterministic status counts are embedded
      expect(context).toContain("EXACT STATUS COUNTS DETECTED ON PAGE:");
      expect(context).toContain("paused: 14");
      expect(context).toContain("active: 8");
      expect(context).toContain("pending qc: 3");

      // Verify scrollable container is noted
      expect(context).toContain("SCROLLABLE CONTAINERS (1): table.orders-table");
    });

    it("indicates 100% visible when no more content exists below", () => {
      const completeness: PageCompleteness = {
        scrollPercent: 100,
        scrollTop: 600,
        scrollHeight: 1400,
        clientHeight: 800,
        hasMoreBelow: false,
        hasMoreAbove: true,
      };

      const snapshot: PageSnapshot = {
        url: "https://example.com/short-page",
        origin: "https://example.com",
        title: "Short Page",
        capturedAt: new Date().toISOString(),
        headings: [],
        forms: [],
        controls: [],
        alerts: [],
        text: "Everything is fully visible here.",
        truncated: false,
        pageCompleteness: completeness,
      };

      const context = buildPageContext(snapshot);
      expect(context).toContain("Scroll position: 100% (Entire page length visible in DOM).");
      expect(context).not.toContain("CAUTION: More content exists");
    });
  });

  describe("Browser Action Execution & Directional Scrolling Guardrails", () => {
    it("safely generates scroll audit records", () => {
      const req: BrowserActionRequest = {
        id: "act-scroll-1",
        action: "scroll",
        selector: "div.orders-container",
        value: "down",
        pageUrl: "https://seller.marketplace.in/orders",
        pageOrigin: "https://seller.marketplace.in",
        userPermissionLevel: "suggest",
      };

      const audit = createActionResult(
        req,
        true,
        "Scrolled container down. More items remain below.",
        true,
      );
      expect(audit.success).toBe(true);
      expect(audit.verified).toBe(true);
      expect(audit.message).toContain("Scrolled container down");
    });

    it("prevents clicking without explicit confirmation decision", () => {
      const req: BrowserActionRequest = {
        id: "act-click-1",
        action: "click",
        selector: "button#download-report",
        pageUrl: "https://seller.marketplace.in/reports",
        pageOrigin: "https://seller.marketplace.in",
        userPermissionLevel: "execute",
      };

      const val = validateBrowserAction(req);
      expect(val.allowed).toBe(false);
      expect(val.requiresConsent).toBe(true);
    });

    it("allows clicking once explicit confirmation is granted", () => {
      const req: BrowserActionRequest = {
        id: "act-click-2",
        action: "click",
        selector: "button#download-report",
        pageUrl: "https://seller.marketplace.in/reports",
        pageOrigin: "https://seller.marketplace.in",
        userPermissionLevel: "execute",
        consentDecision: "allow_once",
      };

      const val = validateBrowserAction(req);
      expect(val.allowed).toBe(true);
      expect(val.requiresConsent).toBe(false);
    });
  });
});
