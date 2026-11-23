import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  PHASE4_MEMORY_CATEGORIES,
  validatePhase4MemoryWrite,
  detectMemoryConflicts,
  detectStaleMemories,
  mergeDuplicateMemories,
} from "../src/lib/engines/memory-engine";
import {
  getModularConnectorHealthSnapshot,
  executeConnectorWriteWithGate,
  listConnectorAuditTrail,
} from "../src/lib/integrations/connectors";
import { compileNaturalLanguageWorkflow } from "../src/lib/engines/workflow-recipe-engine";
import {
  savePersistedWorkflow,
  tickDueWorkflows,
  runPersistedWorkflowNow,
  listPersistedWorkflows,
  stopScheduledJob,
} from "../src/lib/workflows/scheduler.server";
import {
  analyzeCommunicationThread,
  sendApprovedDraft,
  generateProactiveSuggestions,
} from "../src/lib/engines/communication-proactive.server";

let tmpDir = "";
const prevDataDir = process.env.AI_BUDDY_DATA_DIR;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aibuddy-phase4-"));
  process.env.AI_BUDDY_DATA_DIR = tmpDir;
});

afterEach(() => {
  stopScheduledJob("wf_cron_test");
  stopScheduledJob("wf_due_tick");
  if (prevDataDir === undefined) delete process.env.AI_BUDDY_DATA_DIR;
  else process.env.AI_BUDDY_DATA_DIR = prevDataDir;
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

describe("Phase 4: Memory Governance, Connected Apps, Persistent Scheduler & Proactive Intelligence", () => {
  it("supports all 8 memory categories, blocks secrets/OTPs/opt-outs, and detects conflicts/stale/duplicates", () => {
    expect(PHASE4_MEMORY_CATEGORIES).toHaveLength(8);

    // Block sensitive credentials / OTPs / passwords
    expect(
      validatePhase4MemoryWrite({
        key: "otp_code",
        value: "My OTP is 482910",
        category: "fact",
      }).allowed,
    ).toBe(false);

    expect(
      validatePhase4MemoryWrite({
        key: "api_secret",
        value: "sk-1234567890abcdefghijklmnop",
        category: "app_integration",
      }).allowed,
    ).toBe(false);

    // Block privacyMode and "don't remember" opt-outs
    expect(
      validatePhase4MemoryWrite({
        key: "favorite_city",
        value: "Surat",
        privacyMode: true,
      }).allowed,
    ).toBe(false);

    expect(
      validatePhase4MemoryWrite({
        key: "note",
        value: "Please don't remember my phone number",
        rawInstruction: "Please don't remember this",
      }).allowed,
    ).toBe(false);

    expect(
      validatePhase4MemoryWrite({
        key: "seller_gstin",
        value: "24AAAAA0000A1Z5",
        category: "business_context",
      }).allowed,
    ).toBe(true);

    const now = Date.now();
    const oldIso = new Date(now - 45 * 86_400_000).toISOString();
    const recentIso = new Date(now - 1000).toISOString();

    const entries = [
      { id: "1", key: "city", value: "Surat", updatedAt: recentIso },
      { id: "2", key: "city", value: "Ahmedabad", updatedAt: oldIso },
      { id: "3", key: "city", value: "Surat", updatedAt: oldIso },
    ];
    expect(detectMemoryConflicts(entries)).toHaveLength(1);
    expect(detectStaleMemories(entries, 30, now).length).toBe(2);
    const merged = mergeDuplicateMemories(entries);
    expect(merged.mergedCount).toBe(1);
    expect(merged.merged).toHaveLength(2);
  });

  it("enforces truthful connector health status, write confirmation gates, and audit logging", async () => {
    const gmailStatus = getModularConnectorHealthSnapshot("gmail", null);
    expect(gmailStatus.operational).toBe(false);
    expect(gmailStatus.status).toBe("requires_oauth");

    const meeshoStatus = getModularConnectorHealthSnapshot("meesho_supplier");
    expect(meeshoStatus.operational).toBe(true);
    expect(meeshoStatus.status).toBe("browser_session_only");

    // Unconfirmed external write MUST be blocked
    const blocked = await executeConnectorWriteWithGate({
      userId: "user_conn",
      connectorId: "slack",
      action: "post_message",
      targetSummary: "#ops summary",
      confirmedByUser: false,
      userToken: "xoxb-fake-token",
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.requiresConfirmation).toBe(true);

    // Confirmed external write succeeds with valid token & records audit trail
    const allowed = await executeConnectorWriteWithGate({
      userId: "user_conn",
      connectorId: "slack",
      action: "post_message",
      targetSummary: "#ops summary",
      confirmedByUser: true,
      userToken: "xoxb-fake-token",
    });
    expect(allowed.ok).toBe(true);
    const audit = await listConnectorAuditTrail("user_conn");
    expect(audit.some((a) => a.status === "awaiting_confirmation")).toBe(true);
    expect(audit.some((a) => a.status === "ok")).toBe(true);
  });

  it("compiles NL workflows, blocks unapproved activation, persists croner schedules, and runs webhook ticks", async () => {
    const missingClarification = compileNaturalLanguageWorkflow("schedule check something later");
    expect(missingClarification.missingParameters.length).toBeGreaterThan(0);
    expect(missingClarification.clarificationPrompt).toBeTruthy();

    const compiled = compileNaturalLanguageWorkflow(
      "Every morning at 9 export spreadsheet summary report",
    );
    expect(compiled.draftRecipe.approvedByUser).toBe(false);
    expect(compiled.triggerType).toBe("cron");
    expect(compiled.cronExpression).toBe("0 9 * * *");

    // Unapproved active save throws
    await expect(
      savePersistedWorkflow("user_wf", {
        id: "wf_unapproved",
        name: "Unapproved",
        description: "Test",
        triggerType: "cron",
        cronExpression: "0 9 * * *",
        steps: compiled.draftRecipe.steps,
        status: "active",
        approvedByUser: false,
        retryLimit: 1,
      }),
    ).rejects.toThrow();

    // Approved save persists and fires on run_now and webhook tick
    const pastIso = new Date(Date.now() - 60_000).toISOString();
    const wf = await savePersistedWorkflow("user_wf", {
      id: "wf_due_tick",
      name: compiled.draftRecipe.name,
      description: compiled.draftRecipe.description,
      triggerType: "one_time",
      runAtIso: pastIso,
      steps: compiled.draftRecipe.steps,
      status: "active",
      approvedByUser: true,
      retryLimit: 2,
    });
    expect(wf.nextRunAt).toBe(pastIso);

    const tick = await tickDueWorkflows("user_wf");
    expect(tick.triggeredCount).toBe(1);

    await runPersistedWorkflowNow({
      userId: "user_wf",
      workflowId: "wf_due_tick",
      triggerSource: "manual",
    });

    const listed = await listPersistedWorkflows("user_wf");
    expect(listed.logs.length).toBeGreaterThanOrEqual(2);
    expect(listed.notifications.some((n) => n.category === "workflow_run")).toBe(true);
    expect(listed.environmentNotice).toMatch(/Cloud Run/i);
  });

  it("categorizes communication threads, keeps drafts gated, and generates mutable proactive suggestions", async () => {
    const analysis = await analyzeCommunicationThread({
      userId: "user_comm",
      channel: "gmail",
      recipient: "supplier@example.com",
      subject: "Urgent SKU Invoice Reconciliation",
      messages: [
        {
          sender: "Accounts",
          text: "Urgent: please verify SKU-101 invoice mismatch before 5 PM today.",
        },
      ],
    });
    expect(analysis.category).toBe("urgent_action");
    expect(analysis.actionItems.length).toBeGreaterThan(0);
    expect(analysis.draftReply.requiresApproval).toBe(true);
    expect(analysis.draftReply.approvedToSend).toBe(false);

    // Sending without confirmation fails
    const unconfirmedSend = await sendApprovedDraft({
      userId: "user_comm",
      draftId: analysis.draftReply.id,
      confirmedByUser: false,
      userToken: "fake-oauth-token",
    });
    expect(unconfirmedSend.ok).toBe(false);

    const suggestions = await generateProactiveSuggestions({
      userId: "user_comm",
      discrepancyCount: 2,
      pendingDraftCount: 1,
    });
    expect(suggestions.suppressed).toBe(false);
    expect(suggestions.suggestions.some((s) => s.category === "data_reconciliation")).toBe(true);
    expect(suggestions.suggestions.some((s) => s.category === "communication_follow_up")).toBe(
      true,
    );

    const muted = await generateProactiveSuggestions({
      userId: "user_comm",
      prefs: { enabled: false, mutedCategories: [] },
      discrepancyCount: 2,
    });
    expect(muted.suppressed).toBe(true);
    expect(muted.suggestions).toHaveLength(0);
  });
});
