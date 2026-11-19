import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { parseDelimitedText, parseDocumentTextLocally } from "../src/shared/document-extractor";
import { extractComplexTable } from "../src/lib/engines/page-intelligence-engine";
import {
  generateMultiActionPlan,
  resolveLiveStepTarget,
  type MultiActionStep,
} from "../src/shared/browser-action";
import type { PageSnapshot } from "../src/shared/page-snapshot";

const root = path.resolve(__dirname, "..");
const sidepanelJsPath = path.join(root, "extension", "sidepanel.js");
const backgroundJsPath = path.join(root, "extension", "background.js");

interface FakeElement {
  id: string;
  hidden: boolean;
  textContent: string;
  innerHTML: string;
  style: Record<string, string>;
  className: string;
  onclick: (() => void | Promise<void>) | null;
  appendChild: () => void;
}

interface RuntimeMessage {
  type: string;
  step?: { selector?: string; [key: string]: unknown };
  [key: string]: unknown;
}

interface PlanStepRecord {
  id: string;
  stepNumber: number;
  title: string;
  action: string;
  selector?: string;
  textTarget?: string;
  status: string;
  [key: string]: unknown;
}

interface PlanRecord {
  id: string;
  title: string;
  status: string;
  currentStepIndex: number;
  steps: PlanStepRecord[];
  [key: string]: unknown;
}

interface SidepanelSandboxState {
  activePlan: PlanRecord | null;
  isPlanPaused: boolean;
  planLoopRunning: boolean;
  planRunToken: number;
  pendingApprovalStep: PlanStepRecord | null;
}

interface SidepanelSandboxApi {
  startMultiActionPlan: (instruction: string) => Promise<void>;
  __getState: () => SidepanelSandboxState;
  __setActivePlan: (plan: PlanRecord | null) => void;
}

interface ParsedFillResult {
  fields?: Record<string, string>;
  explicitPairs?: Array<{ target: string; value: string; overwrite: boolean }>;
  hasExplicitNoSubmit?: boolean;
}

interface ParsedBackgroundDoc {
  ok: boolean;
  table: {
    rowCount: number;
    rows: Array<Record<string, string>>;
  };
}

function createFakeDomHarness() {
  const elements = new Map<string, FakeElement>();
  const ensureEl = (id: string): FakeElement => {
    if (!elements.has(id)) {
      elements.set(id, {
        id,
        hidden: false,
        textContent: "",
        innerHTML: "",
        style: {},
        className: "",
        onclick: null,
        appendChild: () => {},
      });
    }
    return elements.get(id)!;
  };
  [
    "taskPlanCard",
    "planTitle",
    "planMeta",
    "planStatusBadge",
    "progressStepsLabel",
    "progressPercentLabel",
    "progressBarFill",
    "planStepsList",
    "planPauseResumeBtn",
    "planSkipBtn",
    "planStopBtn",
    "planRetryBtn",
    "consequentialApprovalCard",
    "consequentialPrompt",
    "approveConsequentialBtn",
    "rejectConsequentialBtn",
    "extractedDataCard",
    "extractedCountTitle",
    "extractedContent",
    "savedCheckpointCard",
    "savedTaskCheckpointDesc",
    "resumeSavedTaskBtn",
    "discardSavedTaskBtn",
  ].forEach(ensureEl);

  return { elements, $: ensureEl };
}

function loadSidepanelPlanSandbox(
  sendRuntimeMessageMock: (msg: RuntimeMessage) => Promise<Record<string, unknown>>,
) {
  const js = fs.readFileSync(sidepanelJsPath, "utf-8");

  const helperStart = js.indexOf("function extractRequestedDocFieldKeys(");
  const helperEnd = js.indexOf("async function executeNaturalBrowserAction(");
  const planStart = js.indexOf("// --- MULTI-ACTION TASK OPERATOR ENGINE ---");
  const planEnd = js.indexOf("// Smart Mode & Placeholders Registry");
  const ctrlStart = js.indexOf('if ($("planPauseResumeBtn"))');
  const ctrlEnd = js.indexOf('if ($("copyExtractedBtn"))');
  const resumeStart = js.indexOf('if ($("resumeSavedTaskBtn"))');
  const resumeEnd = js.indexOf("async function getLocalMemoriesStore()");

  if (
    [helperStart, helperEnd, planStart, planEnd, ctrlStart, ctrlEnd, resumeStart, resumeEnd].some(
      (i) => i < 0,
    )
  ) {
    throw new Error("Could not slice sidepanel.js runner blocks for unit verification.");
  }

  const storageStore: Record<string, unknown> = {};
  const history: Array<{ role: string; text: string }> = [];
  const { elements, $ } = createFakeDomHarness();

  const asyncGet = async (keys: string | string[]): Promise<Record<string, unknown>> => {
    if (typeof keys === "string") return { [keys]: storageStore[keys] };
    const out: Record<string, unknown> = {};
    for (const k of keys) out[k] = storageStore[k];
    return out;
  };

  const sandbox: Record<string, unknown> = {
    $,
    document: {
      createElement: () => ({
        className: "",
        innerHTML: "",
        style: {},
        appendChild: () => {},
      }),
    },
    chrome: {
      storage: {
        local: {
          get: (keys: string | string[], cb?: (d: Record<string, unknown>) => void) => {
            const p = asyncGet(keys);
            if (typeof cb === "function") {
              p.then(cb);
              return undefined;
            }
            return p;
          },
          set: async (obj: Record<string, unknown>) => {
            Object.assign(storageStore, obj);
          },
          remove: async (keys: string | string[]) => {
            const arr = Array.isArray(keys) ? keys : [keys];
            for (const k of arr) delete storageStore[k];
          },
        },
      },
    },
    activeUploadedDocument: null,
    appendHistory: (role: string, text: string) => history.push({ role, text }),
    setRigEmotion: () => {},
    switchTab: () => {},
    recordTaskExecution: async () => {},
    sendRuntimeMessage: sendRuntimeMessageMock,
    setTimeout,
    clearTimeout,
    Date,
    RegExp,
    Array,
    Object,
    JSON,
    Math,
    Promise,
  };

  const combined = [
    js.slice(helperStart, helperEnd),
    js.slice(planStart, planEnd),
    js.slice(ctrlStart, ctrlEnd),
    js.slice(resumeStart, resumeEnd),
    "this.__getState = () => ({ activePlan, isPlanPaused, planLoopRunning, planRunToken, pendingApprovalStep });",
    "this.__setActivePlan = (p) => { activePlan = p; };",
  ].join("\n");

  vm.runInNewContext(combined, sandbox);
  return {
    sandbox: sandbox as unknown as SidepanelSandboxApi,
    storageStore,
    elements,
    history,
  };
}

function loadSidepanelFillParser() {
  const js = fs.readFileSync(sidepanelJsPath, "utf-8");
  const helperStart = js.indexOf("function extractRequestedDocFieldKeys(");
  const helperEnd = js.indexOf("async function executeNaturalBrowserAction(");
  const sandbox: Record<string, unknown> = { activeUploadedDocument: null };
  vm.runInNewContext(js.slice(helperStart, helperEnd), sandbox);
  return {
    extractFillDetails: sandbox.extractFillDetails as (s: string) => ParsedFillResult,
    parseActionIntent: sandbox.parseActionIntent as (s: string) => Record<string, unknown>,
  };
}

function loadBackgroundDocumentParser() {
  const js = fs.readFileSync(backgroundJsPath, "utf-8");
  const start = js.indexOf("function parseDelimitedTextExt(");
  const end = js.indexOf("async function extractUploadedDocument(");
  const sandbox: Record<string, unknown> = {};
  vm.runInNewContext(js.slice(start, end), sandbox);
  return {
    parseDocumentTextLocallyExt: sandbox.parseDocumentTextLocallyExt as (
      raw: string,
      name?: string,
    ) => ParsedBackgroundDoc,
  };
}

describe("Phase 2 (P1) — Multi-step Reliability, Hinglish Extraction, Checkpoints, Meesho & CSV/TSV", () => {
  it("prevents Stop/Cancel race condition from dropping or corrupting an immediately started new plan", async () => {
    let resolveSlowStep!: (val: Record<string, unknown>) => void;
    let callCount = 0;

    const sendRuntimeMock = vi.fn(async (msg: RuntimeMessage) => {
      if (msg.type === "GET_PAGE_SNAPSHOT") {
        return {
          ok: true,
          snapshot: {
            url: "https://example.com",
            controls: [{ selector: "#btn1", name: "Next" }],
            forms: [],
            headings: [],
            alerts: [],
          },
        };
      }
      if (msg.type === "WAIT_FOR_PAGE_SETTLE") return { ok: true };
      if (msg.type === "EXECUTE_STEP") {
        callCount++;
        if (callCount === 1) {
          // Hang step 1 of plan 1 until user hits Stop & starts Plan 2
          return await new Promise<Record<string, unknown>>((r) => {
            resolveSlowStep = r;
          });
        }
        return { ok: true, verified: true, result: "Done step" };
      }
      return { ok: true };
    });

    const { sandbox, elements } = loadSidepanelPlanSandbox(sendRuntimeMock);

    // Start Plan 1 (do not await yet; it pauses on slow EXECUTE_STEP)
    const p1 = sandbox.startMultiActionPlan("Open orders, click today");
    await vi.waitFor(() => expect(callCount).toBe(1));

    // User clicks Stop while Plan 1 is in-flight
    elements.get("planStopBtn")!.onclick?.();
    expect(sandbox.__getState().activePlan?.status).toBe("cancelled");
    expect(sandbox.__getState().planLoopRunning).toBe(false);

    // User immediately starts Plan 2 while Plan 1's promise was still pending
    const p2 = sandbox.startMultiActionPlan("Scroll down, click submit");
    await vi.waitFor(() => expect(callCount).toBeGreaterThanOrEqual(2));

    // Now Plan 1's stale EXECUTE_STEP finally resolves — it MUST NOT mutate Plan 2!
    resolveSlowStep({ ok: true, result: "stale finish" });
    await Promise.all([p1, p2]);

    const finalState = sandbox.__getState();
    expect(finalState.activePlan?.title).toContain("Scroll down");
    expect(finalState.activePlan?.status).toBe("completed");
    expect(finalState.activePlan?.currentStepIndex).toBe(finalState.activePlan?.steps.length);
  });

  it("retries with alternate locator strategies (auto-retry + planRetryBtn clears stale selector)", async () => {
    const executedSelectors: Array<string | undefined> = [];
    let attempt = 0;

    const sendRuntimeMock = vi.fn(async (msg: RuntimeMessage) => {
      if (msg.type === "GET_PAGE_SNAPSHOT") {
        return {
          ok: true,
          snapshot: {
            url: "https://supplier.meesho.com/panel/orders",
            controls:
              attempt < 2 ? [] : [{ selector: "button.ready-to-ship-tab", name: "Ready to Ship" }],
            forms: [],
            headings: [],
            alerts: [],
          },
        };
      }
      if (msg.type === "WAIT_FOR_PAGE_SETTLE") return { ok: true };
      if (msg.type === "EXECUTE_STEP") {
        attempt++;
        executedSelectors.push(msg.step?.selector);
        if (attempt <= 2) {
          return { ok: false, error: "Element not found with primary selector" };
        }
        return { ok: true, verified: true, result: "Clicked via alternate target" };
      }
      return { ok: true };
    });

    const { sandbox, elements } = loadSidepanelPlanSandbox(sendRuntimeMock);
    await sandbox.startMultiActionPlan("Open orders, click pending");

    // First attempt + 1 automatic retry failed -> plan pauses in failed state and shows Retry button
    const failedState = sandbox.__getState();
    expect(failedState.activePlan?.status).toBe("failed");
    expect(elements.get("planRetryBtn")!.hidden).toBe(false);
    expect(attempt).toBe(2);

    // Click Retry -> clears stale failed selector and finds "Ready to Ship" from snapshot
    elements.get("planRetryBtn")!.onclick?.();
    await vi.waitFor(() => expect(sandbox.__getState().activePlan?.status).toBe("completed"));
    expect(attempt).toBeGreaterThanOrEqual(3);
  });

  it("persists savedCheckpoint on pause/step and resumes cleanly with running/failed reset", async () => {
    const sendRuntimeMock = vi.fn(async (msg: RuntimeMessage) => {
      if (msg.type === "GET_PAGE_SNAPSHOT") {
        return {
          ok: true,
          snapshot: {
            url: "https://example.com",
            controls: [],
            forms: [],
            headings: [],
            alerts: [],
          },
        };
      }
      if (msg.type === "WAIT_FOR_PAGE_SETTLE") return { ok: true };
      if (msg.type === "EXECUTE_STEP") return { ok: true, verified: true, result: "OK" };
      return { ok: true };
    });

    const { sandbox, storageStore, elements } = loadSidepanelPlanSandbox(sendRuntimeMock);
    const interruptedPlan = {
      id: "plan_resume_1",
      title: "Meesho Pending Orders",
      originalInstruction: "Open orders, click pending",
      currentStepIndex: 1,
      status: "running", // simulate browser/panel killed mid-step!
      extractedData: [{ orderId: "123456_1", status: "pending" }],
      steps: [
        {
          id: "s1",
          stepNumber: 1,
          title: "Open Orders",
          action: "click",
          textTarget: "Orders",
          status: "completed",
        },
        {
          id: "s2",
          stepNumber: 2,
          title: "Click Pending",
          action: "click",
          selector: "#stale-id",
          textTarget: "Pending",
          status: "running",
        },
      ],
    };

    storageStore.ai_buddy_active_plan = interruptedPlan;
    storageStore.savedCheckpoint = { ...interruptedPlan, totalSteps: 2 };

    await elements.get("resumeSavedTaskBtn")!.onclick?.();
    const state = sandbox.__getState();
    expect(state.activePlan?.status).toBe("completed");
    expect(state.activePlan?.steps[1].status).toBe("completed");
    // Completed plans clean up saved checkpoints
    expect(storageStore.savedCheckpoint).toBeUndefined();
    expect(storageStore.ai_buddy_active_plan).toBeUndefined();
  });

  it("fixes wait_for timeout truthiness in background.js so timeouts return ok:false", () => {
    const bg = fs.readFileSync(backgroundJsPath, "utf-8");
    const waitTimeoutBlock = bg.slice(
      bg.indexOf("async function waitForCondition("),
      bg.indexOf("async function executePlanStepInTab("),
    );
    expect(waitTimeoutBlock).toContain("return { ok: false, found: false, timeout: true");
    expect(waitTimeoutBlock).not.toContain("return { ok: true, found: false, timeout: true");

    const stepWaitBlock = bg.slice(
      bg.indexOf("// 5. Wait for condition"),
      bg.indexOf("// 5b. Fill from uploaded document"),
    );
    expect(stepWaitBlock).toContain("Boolean(res.ok && res.found !== false)");
  });

  it("builds Meesho workflow with URL skip guard, valid CSS selectors, and alternateTargets", () => {
    const mockSnap: PageSnapshot = {
      url: "https://supplier.meesho.com/panel/orders",
      origin: "https://supplier.meesho.com",
      title: "Meesho",
      capturedAt: new Date().toISOString(),
      headings: [],
      forms: [],
      controls: [
        { ref: "c1", role: "button", name: "Ready to Ship", tag: "button", selector: "#rts-tab" },
      ],
      alerts: [],
      text: "Orders",
      truncated: false,
    };

    const plan = generateMultiActionPlan(
      "Open Meesho Supplier Panel, go to Orders, open today's orders, find pending orders, copy their order IDs, and prepare a list",
      mockSnap,
    );
    expect(plan.steps).toHaveLength(6);
    expect(plan.steps[0].skipIfUrlPattern).toBeTruthy();
    expect(plan.steps[3].selector).not.toContain(":has-text");
    expect(plan.steps[3].alternateTargets).toContain("Ready to Ship");

    // resolveLiveStepTarget finds "Ready to Ship" via alternateTargets when "Pending" is renamed!
    const live = resolveLiveStepTarget(plan.steps[3] as MultiActionStep, mockSnap);
    expect(live.matched).toBe(true);
    expect(live.selector).toBe("#rts-tab");
  });

  it("extracts complex Hinglish forms accurately (multi-pair aur, first name guard, trailing hai, value-ko-field, ordinals)", () => {
    const { extractFillDetails } = loadSidepanelFillParser();

    // 1. Multiple key: value joined by aur (previously dropped Phone!)
    const multiKv = extractFillDetails("Name: Murshad Ali aur Phone: 9560798373");
    expect(multiKv.fields).toEqual({ name: "Murshad Ali", phone: "9560798373" });

    // 2. Preserves hasExplicitNoSubmit in early key:value return
    const noSub = extractFillDetails("Name: Rahul, City: Delhi without submitting");
    expect(noSub.hasExplicitNoSubmit).toBe(true);

    // 3. Keeps "First Name" intact (must not strip "First "!)
    const fn = extractFillDetails("First Name mein Murshad daal do");
    expect(fn.explicitPairs).toEqual([
      { target: "first name", value: "Murshad", overwrite: false },
    ]);

    // 4. Splits Hinglish ordinal clauses with aur
    const ord = extractFillDetails("Pehle field mein Murshad aur doosre field mein Ali likho");
    expect(ord.explicitPairs).toEqual([
      { target: "__INDEX_0__", value: "Murshad", overwrite: false },
      { target: "__INDEX_1__", value: "Ali", overwrite: false },
    ]);

    // 5. Strips trailing Hinglish copula "hai"
    const hai = extractFillDetails("Mera naam Murshad Ali hai");
    expect(hai.fields?.name).toBe("Murshad Ali");

    // 6. Supports "<value> ko <field> mein daal do"
    const ko = extractFillDetails("Murshad ko First Name mein daal do");
    expect(ko.explicitPairs).toEqual([
      { target: "first name", value: "Murshad", overwrite: false },
    ]);
  });

  it("parses RFC-4180 CSV & TSV with quoted commas, escaped quotes, BOM, and embedded newlines cleanly", () => {
    const trickyCsv =
      '\uFEFFOrder ID,Customer,"Shipping Address",Notes,Amount\r\n' +
      'MSH-101,"Sharma, Rahul","12 MG Road, ""Apt 4B""\nNew Delhi",Urgent,"1,250.00"\r\n' +
      'MSH-102,"Patel, Priya","SG Highway, Ahmedabad",Regular,850\r\n';

    const parsed = parseDelimitedText(trickyCsv);
    expect(parsed).not.toBeNull();
    expect(parsed!.delimiter).toBe(",");
    expect(parsed!.rowCount).toBe(2);
    expect(parsed!.headers).toEqual([
      "Order ID",
      "Customer",
      "Shipping Address",
      "Notes",
      "Amount",
    ]);
    expect(parsed!.rows[0]).toEqual({
      "Order ID": "MSH-101",
      Customer: "Sharma, Rahul",
      "Shipping Address": '12 MG Road, "Apt 4B"\nNew Delhi',
      Notes: "Urgent",
      Amount: "1,250.00",
    });

    // Multi-row CSV doc extraction never fabricates single-person name; single-row CSV maps cleanly
    const multiDoc = parseDocumentTextLocally(trickyCsv, "orders.csv");
    expect(multiDoc.ok).toBe(true);
    expect(multiDoc.table?.rowCount).toBe(2);
    expect(multiDoc.fields.name).toBeUndefined();

    const tsvSingle =
      "Name\tEmail\tCity\tPincode\nMurshad Ali\tmurshad@example.com\tMumbai\t400050\n";
    const singleDoc = parseDocumentTextLocally(tsvSingle, "profile.tsv");
    expect(singleDoc.ok).toBe(true);
    expect(singleDoc.fields).toMatchObject({
      name: "Murshad Ali",
      email: "murshad@example.com",
      city: "Mumbai",
      pincode: "400050",
    });

    // Extension background parser parity
    const { parseDocumentTextLocallyExt } = loadBackgroundDocumentParser();
    const extCsv = parseDocumentTextLocallyExt(trickyCsv, "orders.csv");
    expect(extCsv.ok).toBe(true);
    expect(extCsv.table.rowCount).toBe(2);
    expect(extCsv.table.rows[0].Customer).toBe("Sharma, Rahul");

    // Page intelligence extractComplexTable handles quoted CSV commas properly
    const tableFromSnap = extractComplexTable({
      url: "https://example.com",
      origin: "https://example.com",
      title: "Orders",
      capturedAt: new Date().toISOString(),
      headings: [],
      forms: [],
      controls: [],
      alerts: [],
      text: trickyCsv,
      truncated: false,
    });
    expect(tableFromSnap.hasTable).toBe(true);
    expect(tableFromSnap.rowCount).toBe(2);
    expect(tableFromSnap.rows[0].Amount).toBe("1,250.00");
  });
});
