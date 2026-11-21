import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_CREDIT_BUDGET,
  SelfHealingKnowledgeAndBudget,
  classifyRuntimeError,
  planDeterministicRecovery,
  redactSensitiveText,
  sanitizeDiagnosticReport,
  verifySelfHealApproval,
  type ErrorAttribution,
} from "../src/shared/self-healing";
import {
  applyRepairAndTest,
  diagnoseRepairSession,
  prepareRepairPatch,
  reportAndTriageError,
  resolveSafeRepoPath,
  rollbackRepair,
  showAffectedCode,
} from "../src/lib/self-healing/code-repair.server";
import {
  createFixBranchAndPr,
  inspectGitHubRepo,
  isProtectedBranch,
} from "../src/lib/self-healing/github-workflow.server";
import {
  getSelfHealingStore,
  resetSelfHealingStoreForTests,
} from "../src/lib/self-healing/store.server";

describe("AI Buddy 2.0 — Complete Self-Healing Engine", () => {
  let tempRoot: string | null = null;

  beforeEach(() => {
    resetSelfHealingStoreForTests();
  });

  afterEach(() => {
    if (tempRoot && fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
      tempRoot = null;
    }
  });

  it("redacts API keys, Bearer/JWT tokens, passwords, OTPs, query tokens, PAN, and Aadhaar numbers", () => {
    const raw = [
      "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjMifQ.sig12345678",
      "geminiKey=AIzaSyDummyKeyValue1234567890123456",
      "openai=sk-proj-abc1234567890123456",
      "github=ghp_1234567890abcdef1234567890abcdef",
      "password=MySecretPass99 otp=482910",
      "url=https://site.test/cb?token=supersecret&ok=1",
      "PAN=ABCDE1234F Aadhaar=5678 1234 9012",
    ].join("\n");

    const { text, redactions } = redactSensitiveText(raw);
    expect(redactions).toBeGreaterThanOrEqual(7);
    expect(text).not.toContain("AIzaSyDummyKeyValue");
    expect(text).not.toContain("sk-proj-abc1234567890123456");
    expect(text).not.toContain("ghp_1234567890abcdef");
    expect(text).not.toContain("MySecretPass99");
    expect(text).not.toContain("482910");
    expect(text).not.toContain("supersecret");
    expect(text).not.toContain("ABCDE1234F");
    expect(text).not.toContain("5678 1234 9012");
  });

  it("classifies all 9 attribution categories accurately without falsely blaming AI Buddy", () => {
    const cases: Array<{
      input: Parameters<typeof classifyRuntimeError>[0];
      expected: ErrorAttribution;
    }> = [
      {
        input: {
          component: "dom_interaction",
          errorMessage: "TypeError: Cannot read properties of undefined (reading 'click')",
          file: "extension/background.js",
        },
        expected: "ai_buddy_code",
      },
      {
        input: {
          component: "form_filling",
          errorMessage: "Element not found behind cross-origin iframe or hidden input",
        },
        expected: "website_behavior",
      },
      {
        input: {
          component: "api_communication",
          errorMessage: "TypeError: Failed to fetch net::ERR_TIMED_OUT",
          httpStatus: 504,
        },
        expected: "network",
      },
      {
        input: {
          component: "ai_provider",
          errorMessage: "Gemini rate limit exceeded",
          httpStatus: 429,
        },
        expected: "api_provider",
      },
      {
        input: {
          component: "api_communication",
          errorMessage: "Unauthorized: Invalid bearer token",
          httpStatus: 401,
        },
        expected: "authentication",
      },
      {
        input: {
          component: "browser_automation",
          errorMessage: "Blocked: Restricted browser page chrome://settings",
        },
        expected: "permissions",
      },
      {
        input: {
          component: "form_filling",
          errorMessage: "Malformed request: missing value for target field",
          httpStatus: 400,
        },
        expected: "invalid_input",
      },
      {
        input: {
          component: "browser_automation",
          errorMessage: "Capability Hover Element is currently planned and not supported yet",
        },
        expected: "unsupported_operation",
      },
      {
        input: {
          component: "content_script",
          errorMessage: "Could not establish connection. Receiving end does not exist.",
        },
        expected: "temporary_browser_failure",
      },
    ];

    for (const c of cases) {
      const res = classifyRuntimeError(c.input);
      expect(res.attribution).toBe(c.expected);
    }
  });

  it("prioritizes deterministic local recovery before AI, suppresses duplicates, caches KB with requiresRevalidation, and enforces budgets", () => {
    const mgr = new SelfHealingKnowledgeAndBudget({
      ...DEFAULT_CREDIT_BUDGET,
      maxAiCallsPerHour: 2,
      maxEstimatedCostUsdPerDay: 0.05,
    });

    const netReport = sanitizeDiagnosticReport({
      component: "content_script",
      errorMessage: "Receiving end does not exist.",
    });
    const rec = planDeterministicRecovery(netReport);
    expect(rec.canAutoExecute).toBe(true);
    expect(rec.shouldCallAi).toBe(false);
    expect(rec.strategy).toBe("reinject_bridge_script");

    const occ1 = mgr.recordOccurrence(netReport, 1000);
    const occ2 = mgr.recordOccurrence(netReport, 5000);
    expect(occ1.isDuplicate).toBe(false);
    expect(occ2.isDuplicate).toBe(true);
    expect(mgr.getUsageSnapshot(5000).suppressedDuplicatesCount).toBe(1);

    mgr.addRepairRecord({
      id: "kb_1",
      fingerprint: netReport.fingerprint,
      category: "content_script",
      attribution: "ai_buddy_code",
      rootCause: "Missing null check",
      affectedFiles: ["extension/bridge.js"],
      repairStrategy: "Add optional chaining",
      extensionVersion: "0.1.0",
      status: "verified",
      requiresRevalidation: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const kbMatches = mgr.findMatchingRepairs(netReport.fingerprint, "0.1.0");
    expect(kbMatches.length).toBe(1);
    expect(kbMatches[0]?.requiresRevalidation).toBe(true);

    expect(mgr.canSpendAiCall(1000).allowed).toBe(true);
    mgr.recordAiUsage(500, 0.01, 1000);
    mgr.recordAiUsage(500, 0.01, 2000);
    expect(mgr.canSpendAiCall(3000).allowed).toBe(false);
  });

  it("enforces path confinement and rejects traversal or sensitive files", () => {
    const root = process.cwd();
    expect(resolveSafeRepoPath("src/lib/buddy-service.server.ts", root).ok).toBe(true);
    expect(resolveSafeRepoPath("extension/background.js", root).ok).toBe(true);
    expect(resolveSafeRepoPath("../etc/passwd", root).ok).toBe(false);
    expect(resolveSafeRepoPath(".env", root).ok).toBe(false);
    expect(resolveSafeRepoPath("src/.env.local", root).ok).toBe(false);
    expect(resolveSafeRepoPath("node_modules/vite/index.js", root).ok).toBe(false);
    expect(resolveSafeRepoPath(".git/config", root).ok).toBe(false);
    expect(resolveSafeRepoPath("/tmp/outside.ts", root).ok).toBe(false);
  });

  it("enforces granular user approval boundaries between diagnose, show_code, prepare, apply, and PR", () => {
    expect(verifySelfHealApproval("diagnose", "diagnose_only").allowed).toBe(true);
    expect(verifySelfHealApproval("show_code", "diagnose_only").allowed).toBe(false);
    expect(verifySelfHealApproval("prepare_repair", "show_affected_code").allowed).toBe(false);
    expect(verifySelfHealApproval("apply_repair_and_test", "prepare_repair").allowed).toBe(false);
    expect(verifySelfHealApproval("apply_repair_and_test", "diagnose_only").allowed).toBe(false);
    expect(verifySelfHealApproval("create_github_pr", "apply_repair_and_test").allowed).toBe(false);
    expect(verifySelfHealApproval("apply_repair_and_test", "apply_repair_and_test").allowed).toBe(
      true,
    );
    expect(verifySelfHealApproval("create_github_pr", "create_github_pr").allowed).toBe(true);
  });

  it("strictly honors selected AI provider during diagnosis and skips AI for website errors", async () => {
    const webSession = reportAndTriageError({
      component: "dom_interaction",
      errorMessage: "Element not found behind cross-origin iframe",
    });
    const webDiag = await diagnoseRepairSession({
      repairId: webSession.repairId,
      approvedAction: "diagnose_only",
    });
    expect(webDiag.ok).toBe(true);
    expect(webDiag.diagnosis?.usedAi).toBe(false);
    expect(webDiag.diagnosis?.attribution).toBe("website_behavior");

    const codeSession = reportAndTriageError({
      component: "browser_automation",
      errorMessage: "TypeError: Cannot read properties of null",
      file: "src/lib/sample.ts",
      line: 10,
    });
    const strictFail = await diagnoseRepairSession({
      repairId: codeSession.repairId,
      approvedAction: "diagnose_only",
      preferredProvider: "openai",
      strictSelection: true,
    });
    expect(strictFail.ok).toBe(false);
    expect(strictFail.message).toMatch(/openai/i);

    const aiOk = await diagnoseRepairSession({
      repairId: codeSession.repairId,
      approvedAction: "diagnose_only",
      preferredProvider: "gemini",
      userApiKey: "AIzaFakeTestKeyForRoutingOnly1234567890",
      strictSelection: true,
      aiRunner: async ({ effectiveProvider, allowProviderFallback }) => {
        expect(effectiveProvider).toBe("gemini");
        expect(allowProviderFallback).toBe(false);
        return {
          provider: "gemini",
          model: "gemini-3.8-flash",
          text: JSON.stringify({
            rootCause: "Missing null guard on target element",
            affectedFiles: ["src/demo.ts"],
            affectedFunctions: ["runAction"],
            repairPlan: ["Check element existence before click"],
            patchEdits: [],
            regressionRisks: ["None"],
          }),
        };
      },
    });
    expect(aiOk.ok).toBe(true);
    expect(aiOk.diagnosis?.usedAi).toBe(true);
    expect(aiOk.diagnosis?.provider).toBe("gemini");
    expect(aiOk.diagnosis?.strictProviderHonored).toBe(true);
  });

  it("stages diff preview, verifies repairs in sandbox, records KB on pass, and AUTOMATICALLY ROLLS BACK on any test/compile failure", async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ai-buddy-heal-"));
    const srcDir = path.join(tempRoot, "src", "lib");
    fs.mkdirSync(srcDir, { recursive: true });
    const targetRel = "src/lib/sample-bug.ts";
    const targetAbs = path.join(tempRoot, targetRel);
    const originalCode = `export function getLabel(el: { name?: string } | null): string {\n  return el.name || "default";\n}\n`;
    fs.writeFileSync(targetAbs, originalCode, "utf8");

    const session = reportAndTriageError({
      component: "browser_automation",
      errorMessage: "TypeError: Cannot read properties of null (reading 'name')",
      file: targetRel,
      line: 2,
      relatedFunction: "getLabel",
    });

    // Reject show_code without show_affected_code approval
    const deniedCode = showAffectedCode({
      repairId: session.repairId,
      approvedAction: "diagnose_only",
      rootDir: tempRoot,
    });
    expect(deniedCode.ok).toBe(false);

    const shown = showAffectedCode({
      repairId: session.repairId,
      approvedAction: "show_affected_code",
      rootDir: tempRoot,
    });
    expect(shown.ok).toBe(true);
    expect(shown.excerpts?.[0]?.snippet).toContain("el.name");

    const patchEdits = [
      {
        file: targetRel,
        searchBlock: '  return el.name || "default";',
        replaceBlock: '  return el?.name || "default";',
        rationale: "Add optional chaining null guard",
      },
    ];

    const preview = prepareRepairPatch({
      repairId: session.repairId,
      approvedAction: "prepare_repair",
      patchEdits,
      rootDir: tempRoot,
    });
    expect(preview.ok).toBe(true);
    expect(preview.diffPreviews?.[0]?.unifiedDiff).toContain('-  return el.name || "default";');
    expect(preview.diffPreviews?.[0]?.unifiedDiff).toContain('+  return el?.name || "default";');
    // File on disk must STILL be unmodified after prepare_repair
    expect(fs.readFileSync(targetAbs, "utf8")).toBe(originalCode);

    // 1. Failure check -> MUST automatically roll back exact original file!
    const failedApply = await applyRepairAndTest({
      repairId: session.repairId,
      approvedAction: "apply_repair_and_test",
      rootDir: tempRoot,
      verifier: async () => [
        { name: "typescript", passed: true, durationMs: 12, summary: "ok" },
        { name: "vitest", passed: false, durationMs: 25, summary: "1 assertion failed" },
      ],
    });
    expect(failedApply.ok).toBe(false);
    expect(failedApply.rolledBack).toBe(true);
    expect(failedApply.session?.status).toBe("rolled_back");
    expect(fs.readFileSync(targetAbs, "utf8")).toBe(originalCode);

    // 2. Passing verification -> persists repair & records KB entry
    const passedApply = await applyRepairAndTest({
      repairId: session.repairId,
      approvedAction: "apply_repair_and_test",
      rootDir: tempRoot,
      verifier: async () => [
        { name: "typescript", passed: true, durationMs: 10, summary: "ok" },
        { name: "vitest", passed: true, durationMs: 20, summary: "passed" },
        { name: "eslint", passed: true, durationMs: 8, summary: "clean" },
      ],
    });
    expect(passedApply.ok).toBe(true);
    expect(passedApply.rolledBack).toBe(false);
    expect(passedApply.session?.status).toBe("verified_applied");
    expect(fs.readFileSync(targetAbs, "utf8")).toContain('el?.name || "default"');
    expect(getSelfHealingStore().kbBudget.listKnowledgeBase().length).toBe(1);

    // Manual rollback also restores original file cleanly
    const manualRb = rollbackRepair({ repairId: session.repairId, rootDir: tempRoot });
    expect(manualRb.ok).toBe(true);
    expect(fs.readFileSync(targetAbs, "utf8")).toBe(originalCode);
  });

  it("rejects direct main/master pushes, handles missing GitHub credentials honestly, and creates isolated PRs via REST API", async () => {
    expect(isProtectedBranch("main")).toBe(true);
    expect(isProtectedBranch("master")).toBe(true);
    expect(isProtectedBranch("ai-buddy/fix-123")).toBe(false);

    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ai-buddy-gh-"));
    fs.mkdirSync(path.join(tempRoot, "src"), { recursive: true });
    const rel = "src/widget.ts";
    fs.writeFileSync(path.join(tempRoot, rel), "export const x = 1;\n", "utf8");

    const session = reportAndTriageError({
      component: "runtime_exception",
      errorMessage: "TypeError: invalid x",
      file: rel,
    });
    prepareRepairPatch({
      repairId: session.repairId,
      approvedAction: "prepare_repair",
      patchEdits: [
        {
          file: rel,
          searchBlock: "export const x = 1;",
          replaceBlock: "export const x = 2;",
          rationale: "Fix x",
        },
      ],
      rootDir: tempRoot,
    });

    // Rejects push to main even with approval
    const mainBlocked = await createFixBranchAndPr({
      repairId: session.repairId,
      approvedAction: "create_github_pr",
      owner: "test-owner",
      repo: "test-repo",
      branchName: "main",
      rootDir: tempRoot,
      token: "ghp_dummy12345678901234567890",
    });
    expect(mainBlocked.ok).toBe(false);
    expect(mainBlocked.message).toMatch(/protected branch/i);

    // Missing credentials -> honest requiresUserAction + preparedPatch
    const prevGhToken = process.env["GITHUB_TOKEN"];
    delete process.env["GITHUB_TOKEN"];
    try {
      const noTokenRes = await createFixBranchAndPr({
        repairId: session.repairId,
        approvedAction: "create_github_pr",
        owner: "",
        repo: "",
        rootDir: tempRoot,
      });
      expect(noTokenRes.ok).toBe(false);
      expect(noTokenRes.requiresUserAction).toBe(true);
      expect(noTokenRes.preparedPatch).toContain("export const x = 2;");

      const repoMissing = await inspectGitHubRepo({ owner: "acme", repo: "buddy" });
      expect(repoMissing.ok).toBe(false);
      expect(repoMissing.requiresUserAction).toBe(true);
    } finally {
      if (prevGhToken !== undefined) process.env["GITHUB_TOKEN"] = prevGhToken;
    }

    // Mocked GitHub REST API flow: creates blob -> tree -> commit -> branch -> PR
    const calls: string[] = [];
    const fakeFetch = async (url: string, init?: RequestInit): Promise<Response> => {
      calls.push(`${init?.method || "GET"} ${url}`);
      if (url.endsWith("/git/ref/heads/main")) {
        return new Response(JSON.stringify({ object: { sha: "base_sha_1" } }), { status: 200 });
      }
      if (url.endsWith("/git/commits/base_sha_1")) {
        return new Response(JSON.stringify({ tree: { sha: "base_tree_1" } }), { status: 200 });
      }
      if (url.endsWith("/git/blobs")) {
        return new Response(JSON.stringify({ sha: "blob_sha_1" }), { status: 201 });
      }
      if (url.endsWith("/git/trees")) {
        return new Response(JSON.stringify({ sha: "tree_sha_2" }), { status: 201 });
      }
      if (url.endsWith("/git/commits")) {
        return new Response(JSON.stringify({ sha: "commit_sha_2" }), { status: 201 });
      }
      if (url.endsWith("/git/refs")) {
        return new Response(JSON.stringify({ ref: "refs/heads/ai-buddy/fix-test" }), {
          status: 201,
        });
      }
      if (url.endsWith("/pulls")) {
        return new Response(
          JSON.stringify({ number: 77, html_url: "https://github.com/acme/buddy/pull/77" }),
          { status: 201 },
        );
      }
      return new Response("Not found", { status: 404 });
    };

    const prRes = await createFixBranchAndPr({
      repairId: session.repairId,
      approvedAction: "create_github_pr",
      owner: "acme",
      repo: "buddy",
      baseBranch: "main",
      branchName: `ai-buddy/fix-${session.repairId}`,
      rootDir: tempRoot,
      token: "ghp_mockedValidToken1234567890",
      fetchFn: fakeFetch,
    });

    expect(prRes.ok).toBe(true);
    expect(prRes.prNumber).toBe(77);
    expect(prRes.prUrl).toBe("https://github.com/acme/buddy/pull/77");
    expect(prRes.branchName).toMatch(/^ai-buddy\/fix-/);
    expect(calls.some((c) => c.includes("/pulls"))).toBe(true);
  });
});
