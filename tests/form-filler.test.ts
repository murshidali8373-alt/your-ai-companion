import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  validateFieldInteractability,
  isSensitiveField,
  executeFormFill,
  useFormFiller,
} from "../src/hooks/use-form-filler";

// Minimal DOM simulation for Node test environment
class MockDOMElement {
  tagName: string;
  type: string = "text";
  name: string = "";
  id: string = "";
  value: string = "";
  checked: boolean = false;
  disabled: boolean = false;
  readOnly: boolean = false;
  isConnected: boolean = true;
  innerText: string = "";
  style: Record<string, string> = { display: "block", visibility: "visible", opacity: "1" };
  attributes: Record<string, string> = {};
  children: MockDOMElement[] = [];
  parentElement: MockDOMElement | null = null;
  previousElementSibling: MockDOMElement | null = null;
  options: Array<{ value: string; text: string }> = [];

  constructor(tag: string) {
    this.tagName = tag.toUpperCase();
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] || null;
  }

  setAttribute(name: string, val: string) {
    this.attributes[name] = val;
  }

  getBoundingClientRect() {
    return {
      width: 150,
      height: 35,
      top: 10,
      left: 10,
      bottom: 45,
      right: 160,
      x: 10,
      y: 10,
      toJSON: () => {},
    };
  }

  scrollIntoView() {}
  focus() {}
  blur() {}
  dispatchEvent(_event: unknown) {
    return true;
  }
  click() {}

  closest(selector: string): MockDOMElement | null {
    let curr: MockDOMElement | null = this.parentElement;
    const tag = selector.toUpperCase();
    while (curr) {
      if (curr.tagName === tag) return curr;
      curr = curr.parentElement;
    }
    return null;
  }

  appendChild(child: MockDOMElement) {
    child.parentElement = this;
    child.isConnected = this.isConnected;
    if (this.children.length > 0) {
      child.previousElementSibling = this.children[this.children.length - 1];
    }
    this.children.push(child);
    return child;
  }

  remove() {
    this.isConnected = false;
    if (this.parentElement) {
      this.parentElement.children = this.parentElement.children.filter((c) => c !== this);
    }
  }

  querySelectorAll(sel: string): MockDOMElement[] {
    const res: MockDOMElement[] = [];
    const parts = sel.split(",").map((s) => s.trim().toLowerCase());
    const traverse = (node: MockDOMElement) => {
      for (const child of node.children) {
        const tag = child.tagName.toLowerCase();
        const matches = parts.some((p) => {
          if (p.includes('button[type="submit"]') || p === "button") {
            return tag === "button";
          }
          if (p.includes('input[type="submit"]')) {
            return tag === "input" && child.type === "submit";
          }
          if (p === "input") {
            return tag === "input";
          }
          return tag === p;
        });
        if (matches) res.push(child);
        traverse(child);
      }
    };
    traverse(this);
    return res;
  }

  querySelector(sel: string): MockDOMElement | null {
    const list = this.querySelectorAll(sel);
    return list[0] || null;
  }
}

beforeEach(() => {
  // @ts-expect-error Mocking window and document
  global.window = {
    getComputedStyle: (el: MockDOMElement) => el.style,
    HTMLInputElement: { prototype: {} },
    HTMLTextAreaElement: { prototype: {} },
  };
  // @ts-expect-error Mocking document
  global.document = {
    createElement: (tag: string) => new MockDOMElement(tag),
    body: new MockDOMElement("body"),
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  // @ts-expect-error Mocking FocusEvent & Event
  global.FocusEvent = class Event {
    type: string;
    constructor(type: string) {
      this.type = type;
    }
  };
  // @ts-expect-error Mocking Event
  global.Event = class Event {
    type: string;
    constructor(type: string) {
      this.type = type;
    }
  };
});

describe("useFormFiller & Field Interactability Validation", () => {
  it("exports useFormFiller hook function", () => {
    expect(typeof useFormFiller).toBe("function");
    expect(typeof executeFormFill).toBe("function");
    expect(typeof validateFieldInteractability).toBe("function");
  });

  it("detects sensitive fields like password, OTP, and financial tokens", () => {
    // @ts-expect-error mock cast
    const pwd = new MockDOMElement("input");
    pwd.type = "password";
    pwd.name = "user_password";
    expect(isSensitiveField(pwd as unknown as Element)).toBe(true);

    // @ts-expect-error mock cast
    const otp = new MockDOMElement("input");
    otp.type = "text";
    otp.name = "sms_otp_code";
    expect(isSensitiveField(otp as unknown as Element)).toBe(true);

    // @ts-expect-error mock cast
    const cvv = new MockDOMElement("input");
    cvv.id = "card_cvv2";
    expect(isSensitiveField(cvv as unknown as Element)).toBe(true);

    // @ts-expect-error mock cast
    const normal = new MockDOMElement("input");
    normal.type = "text";
    normal.name = "first_name";
    expect(isSensitiveField(normal as unknown as Element)).toBe(false);
  });

  it("validates interactability rejecting unattached, hidden, disabled or sensitive fields", () => {
    // 1. Unattached element
    // @ts-expect-error mock cast
    const unattached = new MockDOMElement("input");
    unattached.isConnected = false;
    const res1 = validateFieldInteractability(unattached as unknown as HTMLElement);
    expect(res1.interactable).toBe(false);
    expect(res1.reason).toContain("not attached");

    // 2. Hidden input
    // @ts-expect-error mock cast
    const hidden = new MockDOMElement("input");
    hidden.type = "hidden";
    expect(validateFieldInteractability(hidden as unknown as HTMLElement).interactable).toBe(false);

    // 3. Sensitive password input
    // @ts-expect-error mock cast
    const pass = new MockDOMElement("input");
    pass.type = "password";
    const passCheck = validateFieldInteractability(pass as unknown as HTMLElement);
    expect(passCheck.interactable).toBe(false);
    expect(passCheck.reason).toContain("Security block");

    // 4. Disabled input
    // @ts-expect-error mock cast
    const disabled = new MockDOMElement("input");
    disabled.type = "text";
    disabled.disabled = true;
    expect(validateFieldInteractability(disabled as unknown as HTMLElement).interactable).toBe(
      false,
    );

    // 5. Valid interactable input
    // @ts-expect-error mock cast
    const valid = new MockDOMElement("input");
    valid.type = "text";
    valid.name = "customer_name";
    const validCheck = validateFieldInteractability(valid as unknown as HTMLElement);
    expect(validCheck.interactable).toBe(true);
  });

  it("preserves existing user inputs unless overwrite is explicitly requested", async () => {
    // @ts-expect-error mock cast
    const form = new MockDOMElement("form");
    // @ts-expect-error mock cast
    const input = new MockDOMElement("input");
    input.name = "email";
    input.value = "existing_user@example.com";
    form.appendChild(input);

    // 1. Without overwrite: preserves existing value
    const resNoOverwrite = await executeFormFill(
      { email: "new_email@example.com" },
      {
        overwrite: false,
        eventDelayMs: 1,
        scrollDelayMs: 1,
        focusDelayMs: 1,
      },
      form as unknown as HTMLElement,
    );

    expect(resNoOverwrite.preserved.length).toBe(1);
    expect(resNoOverwrite.filled.length).toBe(0);
    expect(input.value).toBe("existing_user@example.com");

    // 2. With overwrite: updates value
    const resOverwrite = await executeFormFill(
      { email: "overwritten@example.com" },
      {
        overwrite: true,
        eventDelayMs: 1,
        scrollDelayMs: 1,
        focusDelayMs: 1,
      },
      form as unknown as HTMLElement,
    );

    expect(resOverwrite.filled.length).toBe(1);
    expect(resOverwrite.filled[0].verified).toBe(true);
    expect(input.value).toBe("overwritten@example.com");
  });

  it("implements an explicit user-confirmation gate before any final form submission", async () => {
    // @ts-expect-error mock cast
    const form = new MockDOMElement("form");
    form.id = "checkout-form";

    // @ts-expect-error mock cast
    const nameInput = new MockDOMElement("input");
    nameInput.name = "full_name";
    form.appendChild(nameInput);

    // @ts-expect-error mock cast
    const submitBtn = new MockDOMElement("button");
    submitBtn.type = "submit";
    submitBtn.innerText = "Place Order & Pay";
    form.appendChild(submitBtn);

    const clickSpy = vi.spyOn(submitBtn, "click");

    const fillRes = await executeFormFill(
      { full_name: "Sahid Khan" },
      {
        eventDelayMs: 1,
        scrollDelayMs: 1,
        focusDelayMs: 1,
        requireConfirmationBeforeSubmit: true,
      },
      form as unknown as HTMLElement,
    );

    expect(fillRes.filled.length).toBe(1);
    // Form must NOT be submitted automatically!
    expect(clickSpy).not.toHaveBeenCalled();
    expect(fillRes.pendingSubmission).toBeDefined();
    expect(fillRes.pendingSubmission?.submitButtonText).toContain("Place Order");
  });
});
