import { describe, expect, it } from "vitest";
import {
  createTaskPlan,
  advanceTaskStage,
  checkActionSafety,
  executePlanStep,
} from "../src/shared/task-lifecycle";
import { type PageSnapshot } from "../src/shared/page-snapshot";
import { type BrowserAction } from "../src/shared/browser-action";

const MOCK_SNAPSHOT: PageSnapshot = {
  url: "https://shop.example.com/checkout",
  origin: "https://shop.example.com",
  title: "Checkout Order",
  capturedAt: new Date().toISOString(),
  headings: [
    { ref: "e1", role: "heading", name: "Billing Information", tag: "h1", selector: "h1" },
  ],
  forms: [
    { ref: "e2", role: "textbox", name: "Shipping Address", tag: "input", selector: "#address" },
    {
      ref: "e3",
      role: "textbox",
      name: "Card Number",
      tag: "input",
      selector: "#cardNumber",
      sensitive: true,
    },
  ],
  controls: [
    { ref: "e4", role: "button", name: "Complete Purchase", tag: "button", selector: "#btnBuy" },
    { ref: "e5", role: "button", name: "Cancel Order", tag: "button", selector: "#btnCancel" },
  ],
  alerts: [],
  text: "Review order items and enter shipping address to proceed.",
  truncated: false,
};

describe("Task Lifecycle & Safe Action Engine", () => {
  it("initializes task in observing stage", () => {
    const plan = createTaskPlan("Checkout", "Complete purchase safely", MOCK_SNAPSHOT);
    expect(plan.currentStage).toBe("observing");
    expect(plan.steps.length).toBe(1);
    expect(plan.steps[0].stage).toBe("observing");
  });

  it("advances sequentially through stages with audit trace", () => {
    let plan = createTaskPlan("Checkout", "Complete purchase safely", MOCK_SNAPSHOT);
    plan = advanceTaskStage(plan, "understanding", "Parsed 2 inputs and 2 buttons");
    expect(plan.currentStage).toBe("understanding");

    plan = advanceTaskStage(plan, "planning", "Proposed: fill address and click buy");
    expect(plan.currentStage).toBe("planning");
    expect(plan.steps.length).toBe(3);
  });

  it("identifies consequential actions and requires explicit user confirmation", () => {
    const purchaseAction: BrowserAction = {
      id: "act_buy",
      type: "purchase",
      target: { ref: "e4", selector: "#btnBuy", role: "button" },
      description: "Pay for order",
    };

    const safety = checkActionSafety(purchaseAction, MOCK_SNAPSHOT);
    expect(safety.isSafe).toBe(true);
    expect(safety.requiresConfirmation).toBe(true);
  });

  it("strictly blocks automated input into sensitive fields like credit card or password", () => {
    const cardInputAction: BrowserAction = {
      id: "act_card",
      type: "input",
      target: { ref: "e3", selector: "#cardNumber", role: "textbox" },
      value: "4111111111111111",
    };

    const safety = checkActionSafety(cardInputAction, MOCK_SNAPSHOT);
    expect(safety.isSafe).toBe(false);
    expect(safety.requiresConfirmation).toBe(false);
    expect(safety.reason).toContain(
      "Blocked: Cannot automate input into password, OTP, or credit card",
    );
  });

  it("executes safe non-consequential action with pre-check and post-check verification", async () => {
    const plan = createTaskPlan("Fill address", "Set shipping address", MOCK_SNAPSHOT);
    const addressAction: BrowserAction = {
      id: "act_addr",
      type: "input",
      target: { ref: "e2", selector: "#address", role: "textbox" },
      value: "123 Main Street",
    };

    let executed = false;
    const resultPlan = await executePlanStep(plan, addressAction, async () => {
      executed = true;
      return true;
    });

    expect(executed).toBe(true);
    expect(resultPlan.currentStage).toBe("completed");
    expect(resultPlan.steps.some((s) => s.stage === "verifying")).toBe(true);
  });

  it("fails gracefully when target element does not exist on page", async () => {
    const plan = createTaskPlan("Click missing button", "Test pre-check", MOCK_SNAPSHOT);
    const missingAction: BrowserAction = {
      id: "act_ghost",
      type: "click",
      target: { ref: "e99", selector: "#nonexistent", role: "button" },
    };

    const resultPlan = await executePlanStep(plan, missingAction, async () => true);
    expect(resultPlan.currentStage).toBe("failed");
    expect(resultPlan.error).toContain("was not found");
  });
});
