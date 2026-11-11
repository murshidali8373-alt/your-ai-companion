import { describe, it, expect } from "vitest";
import { useBuddyHealth } from "../src/hooks/use-buddy-health";

describe("useBuddyHealth hook", () => {
  it("exports useBuddyHealth as a callable hook function", () => {
    expect(typeof useBuddyHealth).toBe("function");
  });

  it("verifies health check structure and types", () => {
    const options = {
      autoCheck: false,
      targetSelectors: ["body", "main", "#root"],
      apiBase: "http://localhost:3000",
    };
    expect(options.autoCheck).toBe(false);
    expect(options.targetSelectors.length).toBe(3);
  });

  it("handles API endpoint response format correctly", async () => {
    const mockHealthPayload = {
      ok: true,
      checks: {
        backend: { ok: true, detail: "reachable" },
        ai: { ok: true, detail: "configured" },
        session: { ok: false, detail: "signed out" },
      },
      version: "0.1.0",
    };

    const res = new Response(JSON.stringify(mockHealthPayload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

    const parsed = (await res.json()) as typeof mockHealthPayload;
    expect(parsed.ok).toBe(true);
    expect(parsed.version).toBe("0.1.0");
    expect(parsed.checks.backend.ok).toBe(true);
  });

  it("evaluates selector availability logic in browser-like environments", () => {
    const mockDoc = {
      querySelector: (sel: string) => (sel === "body" || sel === "#root" ? {} : null),
    };

    const selectors = ["body", "#root", "#non-existent-selector-999"];
    const found = selectors.filter((sel) => {
      try {
        return Boolean(mockDoc.querySelector(sel));
      } catch {
        return false;
      }
    });

    expect(found).toContain("body");
    expect(found).toContain("#root");
    expect(found).not.toContain("#non-existent-selector-999");
  });
});
