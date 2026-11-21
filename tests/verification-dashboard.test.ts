import { describe, expect, it } from "vitest";
import {
  buildVerificationMarkdownReport,
  CHROME_VERIFICATION_CASES,
  createDefaultVerificationStore,
  normalizeVerificationStore,
  summarizeVerificationStore,
} from "@/lib/verification-cases";

describe("Verification Dashboard data model & reporting", () => {
  it("defines all 6 real-world Chrome verification test cases with actionable steps", () => {
    expect(CHROME_VERIFICATION_CASES).toHaveLength(6);
    expect(CHROME_VERIFICATION_CASES.map((tc) => tc.id)).toEqual([
      "test-1-chat",
      "test-2-click",
      "test-3-form",
      "test-4-downloads",
      "test-5-navigation",
      "test-6-workflow",
    ]);

    for (const tc of CHROME_VERIFICATION_CASES) {
      expect(tc.commands.length).toBeGreaterThan(0);
      expect(tc.steps.length).toBeGreaterThanOrEqual(3);
      expect(tc.expectedResult.trim().length).toBeGreaterThan(10);
    }
  });

  it("initializes every test case as pending with unchecked steps and empty notes", () => {
    const store = createDefaultVerificationStore();
    const summary = summarizeVerificationStore(store);

    expect(summary.totalCases).toBe(6);
    expect(summary.pending).toBe(6);
    expect(summary.passed).toBe(0);
    expect(summary.failed).toBe(0);
    expect(summary.completedSteps).toBe(0);
    expect(summary.totalSteps).toBe(18);
  });

  it("tracks pass/fail status, checklist steps, and bug notes cleanly via normalization", () => {
    const normalized = normalizeVerificationStore({
      environment: "Chrome 134 · Windows 11",
      entries: {
        "test-1-chat": {
          result: "pass",
          checks: {
            "t1-direct-qa": true,
            "t1-model-switch": true,
            "t1-multilingual": false,
          },
          notes: "Gemini responded fast; Groq needs server key.",
          updatedAt: "2026-11-21T09:40:00.000Z",
        },
        "test-3-form": {
          result: "fail",
          checks: { "t3-text-fields": true },
          notes: "Custom React dropdown did not commit option on first click.",
          updatedAt: "2026-11-21T09:45:00.000Z",
        },
      },
    });

    const summary = summarizeVerificationStore(normalized);
    expect(summary.passed).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.pending).toBe(4);
    expect(summary.completedSteps).toBe(3);

    const report = buildVerificationMarkdownReport(normalized);
    expect(report).toContain("Chrome 134 · Windows 11");
    expect(report).toContain("1 Passed · 1 Failed · 4 Pending");
    expect(report).toContain("Result: PASS");
    expect(report).toContain("Result: FAIL");
    expect(report).toContain("Custom React dropdown did not commit option on first click.");
  });

  it("falls back safely on corrupted or invalid stored payloads", () => {
    const fromNull = normalizeVerificationStore(null);
    expect(summarizeVerificationStore(fromNull).pending).toBe(6);

    const fromGarbage = normalizeVerificationStore({
      environment: 123,
      entries: {
        "test-1-chat": {
          result: "invalid-status",
          checks: { "t1-direct-qa": "yes" },
          notes: 999,
        },
      },
    });

    expect(fromGarbage.environment).toBe("");
    expect(fromGarbage.entries["test-1-chat"].result).toBe("pending");
    expect(fromGarbage.entries["test-1-chat"].notes).toBe("");
    expect(fromGarbage.entries["test-1-chat"].checks["t1-direct-qa"]).toBe(true);
  });
});
