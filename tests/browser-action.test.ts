import { describe, expect, it } from "vitest";
import {
  validateBrowserAction,
  createActionResult,
  type BrowserActionRequest,
} from "../src/shared/browser-action";

describe("Safe Browser Action Guardrails", () => {
  it("blocks actions on restricted browser URLs", () => {
    const req: BrowserActionRequest = {
      id: "req-1",
      action: "highlight",
      selector: "button.submit",
      pageUrl: "chrome://settings",
      pageOrigin: "chrome://settings",
      userPermissionLevel: "execute",
    };

    const res = validateBrowserAction(req);
    expect(res.allowed).toBe(false);
    expect(res.error).toContain("restricted");
  });

  it("blocks actions exceeding user permission level", () => {
    const req: BrowserActionRequest = {
      id: "req-2",
      action: "fill_field",
      selector: "input#search",
      value: "AI Buddy",
      pageUrl: "https://example.com",
      pageOrigin: "https://example.com",
      userPermissionLevel: "observe", // observe only allows reading
    };

    const res = validateBrowserAction(req);
    expect(res.allowed).toBe(false);
    expect(res.error).toContain("Permission level");
  });

  it("blocks actions targeting sensitive input fields", () => {
    const req: BrowserActionRequest = {
      id: "req-3",
      action: "fill_field",
      selector: "input#password",
      value: "secret123",
      elementName: "user_password",
      elementTag: "password",
      pageUrl: "https://example.com/login",
      pageOrigin: "https://example.com",
      userPermissionLevel: "execute",
      consentDecision: "allow_once",
    };

    const res = validateBrowserAction(req);
    expect(res.allowed).toBe(false);
    expect(res.error).toContain("password, OTP, or financial");
  });

  it("requires consent for high-impact actions like click and fill_field", () => {
    const req: BrowserActionRequest = {
      id: "req-4",
      action: "click",
      selector: "button#submit-order",
      pageUrl: "https://example.com/checkout",
      pageOrigin: "https://example.com",
      userPermissionLevel: "execute",
    };

    const res = validateBrowserAction(req);
    expect(res.allowed).toBe(false);
    expect(res.requiresConsent).toBe(true);
  });

  it("permits high-impact actions when explicit consent is provided", () => {
    const req: BrowserActionRequest = {
      id: "req-5",
      action: "click",
      selector: "button#proceed",
      pageUrl: "https://example.com/flow",
      pageOrigin: "https://example.com",
      userPermissionLevel: "execute",
      consentDecision: "allow_once",
    };

    const res = validateBrowserAction(req);
    expect(res.allowed).toBe(true);
    expect(res.requiresConsent).toBe(false);
  });

  it("creates structured verified action audit results", () => {
    const req: BrowserActionRequest = {
      id: "req-6",
      action: "scroll",
      selector: "div#main",
      pageUrl: "https://example.com",
      pageOrigin: "https://example.com",
      userPermissionLevel: "suggest",
    };

    const audit = createActionResult(req, true, "Scrolled page to center", true);
    expect(audit.success).toBe(true);
    expect(audit.verified).toBe(true);
    expect(audit.action).toBe("scroll");
    expect(audit.timestamp).toBeDefined();
  });
});
