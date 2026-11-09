import { describe, expect, it } from "vitest";
import {
  generateMultiActionPlan,
  resolveLiveStepTarget,
  type MultiActionStep,
} from "../src/shared/browser-action";
import {
  createMultiActionPlan,
  executeNextPlanStep,
  pauseMultiActionPlan,
  resumeMultiActionPlan,
  skipCurrentPlanStep,
  cancelMultiActionPlan,
  approveAndContinuePlan,
} from "../src/shared/task-lifecycle";
import { type PageSnapshot } from "../src/shared/page-snapshot";

const MOCK_MEESHO_SNAPSHOT: PageSnapshot = {
  url: "https://supplier.meesho.com/panel/orders",
  origin: "https://supplier.meesho.com",
  title: "Meesho Supplier Panel — Orders Dashboard",
  capturedAt: new Date().toISOString(),
  headings: [{ ref: "h1", role: "heading", name: "Orders Dashboard", tag: "h1", selector: "h1" }],
  forms: [],
  controls: [
    {
      ref: "c1",
      role: "button",
      name: "Today",
      tag: "button",
      selector: 'button:has-text("Today")',
    },
    {
      ref: "c2",
      role: "button",
      name: "Pending",
      tag: "button",
      selector: 'button:has-text("Pending")',
    },
  ],
  alerts: [],
  text: "Meesho Supplier Panel orders",
  truncated: false,
};

describe("Multi-Action Browser Operator Engine", () => {
  it("decomposes Meesho Supplier Panel instruction into 6 ordered execution steps", () => {
    const instruction =
      "Open Meesho Supplier Panel, go to Orders, open today's orders, find pending orders, copy their order IDs, and prepare a list of them";
    const plan = generateMultiActionPlan(instruction, MOCK_MEESHO_SNAPSHOT);

    expect(plan.steps.length).toBe(6);
    expect(plan.status).toBe("pending");
    expect(plan.targetWebsite).toContain("supplier.meesho.com");

    // Step 1: Open / Navigate
    expect(plan.steps[0].action).toBe("navigate");
    expect(plan.steps[0].stepNumber).toBe(1);

    // Step 2: Orders section
    expect(plan.steps[1].action).toBe("click");
    expect(plan.steps[1].textTarget).toBe("Orders");

    // Step 3: Today's orders
    expect(plan.steps[2].action).toBe("click");
    expect(plan.steps[2].textTarget).toBe("Today");

    // Step 4: Pending orders
    expect(plan.steps[3].action).toBe("click");
    expect(plan.steps[3].textTarget).toBe("Pending");

    // Step 5: Copy order IDs
    expect(plan.steps[4].action).toBe("extract");
    expect(plan.steps[4].value).toBe("order_id");

    // Step 6: Prepare verified list
    expect(plan.steps[5].action).toBe("extract");
    expect(plan.steps[5].value).toBe("copy_list");
  });

  it("identifies consequential actions (submit, delete, purchase) and marks them for explicit user approval", () => {
    const instruction = "Fill name with 'Alice', update bio, and permanently delete account";
    const plan = generateMultiActionPlan(instruction);

    const deleteStep = plan.steps.find((s) => s.action === "click_delete");
    expect(deleteStep).toBeDefined();
    expect(deleteStep?.isConsequential).toBe(true);
    expect(deleteStep?.requiresApproval).toBe(true);
    expect(deleteStep?.approvalPrompt).toContain("Confirmation required");
  });

  it("executes steps sequentially and aggregates extracted data", async () => {
    const instruction = "Go to orders and copy order IDs";
    let plan = createMultiActionPlan(instruction);

    const mockExecutor = async (step: MultiActionStep) => {
      if (step.action === "extract") {
        return {
          success: true,
          result: "Extracted 2 orders",
          extractedData: [
            { orderId: "MSH-101", status: "pending" },
            { orderId: "MSH-102", status: "pending" },
          ],
        };
      }
      return { success: true, result: `Verified: ${step.title}` };
    };

    // Step 1
    plan = await executeNextPlanStep(plan, mockExecutor);
    expect(plan.currentStepIndex).toBe(1);
    expect(plan.steps[0].status).toBe("completed");
    expect(plan.steps[0].verified).toBe(true);

    // Step 2
    plan = await executeNextPlanStep(plan, mockExecutor);
    expect(plan.currentStepIndex).toBe(2);
    expect(plan.status).toBe("completed");
    expect(Array.isArray(plan.extractedData)).toBe(true);
    expect(plan.extractedData).toHaveLength(2);
  });

  it("pauses execution before consequential step and resumes upon user approval", async () => {
    const planWithConsequential = createMultiActionPlan(
      "Navigate to cart, verify items, and purchase order tickets",
    );

    let plan = planWithConsequential;
    const mockExecutor = async () => ({ success: true, result: "Step executed" });

    // Step 1
    plan = await executeNextPlanStep(plan, mockExecutor);
    // Step 2
    plan = await executeNextPlanStep(plan, mockExecutor);

    // Step 3 (Purchase) requires approval
    plan = await executeNextPlanStep(plan, mockExecutor);
    expect(plan.status).toBe("awaiting_approval");
    expect(plan.pendingApprovalStepId).toBeDefined();

    // User approves
    plan = approveAndContinuePlan(plan);
    expect(plan.status).toBe("pending");

    // Execute approved step
    plan = await executeNextPlanStep(plan, mockExecutor);
    expect(plan.status).toBe("completed");
  });

  it("honors Pause, Resume, Skip, and Cancel controls during execution", () => {
    let plan = createMultiActionPlan("Step one, step two, step three");
    expect(plan.status).toBe("pending");

    // Pause
    plan = pauseMultiActionPlan(plan);
    expect(plan.status).toBe("paused");

    // Resume
    plan = resumeMultiActionPlan(plan);
    expect(plan.status).toBe("pending");

    // Skip
    plan = skipCurrentPlanStep(plan);
    expect(plan.steps[0].status).toBe("skipped");
    expect(plan.currentStepIndex).toBe(1);

    // Cancel
    plan = cancelMultiActionPlan(plan);
    expect(plan.status).toBe("cancelled");
  });

  it("skips sensitive password and financial fields during automatic form planning", () => {
    const sensitiveSnapshot: PageSnapshot = {
      url: "https://auth.example.com",
      origin: "https://auth.example.com",
      title: "Sign In",
      capturedAt: new Date().toISOString(),
      headings: [],
      forms: [
        { ref: "f1", role: "textbox", name: "Username", tag: "input", selector: "#user" },
        {
          ref: "f2",
          role: "textbox",
          name: "Password",
          tag: "input",
          selector: "#pass",
          sensitive: true,
        },
      ],
      controls: [
        { ref: "c1", role: "button", name: "Submit", tag: "button", selector: "#btnSubmit" },
      ],
      alerts: [],
      text: "Sign in",
      truncated: false,
    };

    const plan = generateMultiActionPlan("Fill form and submit", sensitiveSnapshot);
    const hasPasswordStep = plan.steps.some(
      (s) => s.selector?.includes("pass") || s.title.toLowerCase().includes("password"),
    );
    expect(hasPasswordStep).toBe(false);
  });

  // OAV Phase 1: Live Element Target Re-Resolution Test
  it("OAV Phase 1: resolveLiveStepTarget dynamically re-resolves target on mutated snapshot", () => {
    // Snapshot after navigating or opening a modal with mutated class/IDs
    const mutatedSnapshot: PageSnapshot = {
      url: "https://supplier.meesho.com/panel/orders/today",
      origin: "https://supplier.meesho.com",
      title: "Today's Orders",
      capturedAt: new Date().toISOString(),
      headings: [],
      forms: [],
      controls: [
        {
          ref: "ctrl_new_99",
          role: "button",
          name: "Pending Orders",
          tag: "button",
          selector: "button.tab-nav-pending-orders-v2", // changed from initial guess
        },
      ],
      alerts: [],
      text: "Orders",
      truncated: false,
    };

    const step: MultiActionStep = {
      id: "s_pending",
      stepNumber: 3,
      title: "Find pending orders",
      action: "click",
      selector: "button.stale-initial-guess",
      dynamicTargetQuery: "pending orders",
      status: "pending",
    };

    const res = resolveLiveStepTarget(step, mutatedSnapshot);
    expect(res.matched).toBe(true);
    expect(res.selector).toBe("button.tab-nav-pending-orders-v2");
    expect(res.strategy).toBe("semantic");
    expect(res.confidence).toBeGreaterThanOrEqual(0.8);
  });
});
