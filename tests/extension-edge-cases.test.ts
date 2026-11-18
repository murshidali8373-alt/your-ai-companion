import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { containsSensitive, isSensitiveField, redactIfSensitive } from "../src/shared/sensitive";
import { detectPrivacyTrigger } from "../src/lib/buddy-animation-engine";

describe("Extension Edge Cases — Real Chrome MV3 Reliability, Verification & Hinglish Intents", () => {
  const root = path.resolve(__dirname, "..");
  const backgroundJsPath = path.join(root, "extension", "background.js");
  const sidepanelJsPath = path.join(root, "extension", "sidepanel.js");
  const snapshotJsPath = path.join(root, "extension", "snapshot.js");

  it("distinguishes postal Pin Code from secret ATM/UPI PIN across shared TS & extension regexes", () => {
    // Secret PIN variations MUST remain blocked / flagged as privacy-sensitive
    for (const secretField of [
      { name: "pin", label: "PIN", type: "text" },
      { name: "atm_pin", label: "ATM PIN", type: "text" },
      { name: "upi_pin", label: "UPI Pin", type: "text" },
      { name: "pin_number", label: "PIN Number", type: "text" },
    ]) {
      expect(isSensitiveField(secretField)).toBe(true);
      expect(containsSensitive(secretField.label)).toBe(true);
      expect(redactIfSensitive(secretField, "1234")).toBe("[redacted]");
      expect(detectPrivacyTrigger({ activeFieldLabel: secretField.label }).isPrivacy).toBe(true);
    }

    // Postal PIN code variations MUST be allowed / NOT flagged as secret PIN
    for (const postalField of [
      { name: "pincode", label: "Pincode", type: "text" },
      { name: "pin_code", label: "Pin Code", type: "text" },
      { name: "pin-code", label: "Pin-Code", type: "text" },
      { name: "postal_pin", label: "Postal Pin", type: "text" },
    ]) {
      expect(isSensitiveField(postalField)).toBe(false);
      expect(containsSensitive(postalField.label)).toBe(false);
      expect(redactIfSensitive(postalField, "400050")).toBe("400050");
      expect(detectPrivacyTrigger({ activeFieldLabel: postalField.label }).isPrivacy).toBe(false);
    }

    // Verify extension files share the negative-lookbehind / negative-lookahead PIN guard
    const snapshotCode = fs.readFileSync(snapshotJsPath, "utf-8");
    const bgCode = fs.readFileSync(backgroundJsPath, "utf-8");
    const spCode = fs.readFileSync(sidepanelJsPath, "utf-8");
    for (const code of [snapshotCode, bgCode, spCode]) {
      expect(code).toContain("(?<!postal[\\s_-])(?<![a-z0-9])pin");
    }
  });

  it("sanitizes MV3 executeScript args recursively so undefined never reaches Chrome", () => {
    const bgCode = fs.readFileSync(backgroundJsPath, "utf-8");
    const start = bgCode.indexOf("function sanitizeScriptArg(");
    const end = bgCode.indexOf("async function runTabScript(");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    const sandbox: Record<string, unknown> = {};
    vm.runInNewContext(bgCode.slice(start, end), sandbox);
    const sanitizeScriptArg = sandbox.sanitizeScriptArg as (val: unknown) => unknown;

    expect(sanitizeScriptArg(undefined)).toBeNull();
    expect(
      sanitizeScriptArg([undefined, "click", { a: undefined, b: "ok", c: [1, undefined] }]),
    ).toEqual([null, "click", { b: "ok", c: [1, null] }]);

    expect(bgCode.slice(end, end + 600)).toContain("sanitizeScriptArg");
  });

  it("parses Hinglish shortcuts, temporal fillers, local inventory/activity logs, named container scrolls, and ordinal picks", () => {
    const spCode = fs.readFileSync(sidepanelJsPath, "utf-8");
    const helperStart = spCode.indexOf("function extractRequestedDocFieldKeys(");
    const helperEnd = spCode.indexOf("async function executeNaturalBrowserAction(");
    expect(helperStart).toBeGreaterThan(-1);
    expect(helperEnd).toBeGreaterThan(helperStart);

    const sandbox: Record<string, unknown> = {
      activeUploadedDocument: null,
    };
    vm.runInNewContext(spCode.slice(helperStart, helperEnd), sandbox);

    const parseActionIntent = sandbox.parseActionIntent as (s: string) => Record<string, unknown>;
    const resolveOrdinalChoiceIndex = sandbox.resolveOrdinalChoiceIndex as (
      s: string,
    ) => number | null;

    // Temporal filler stripping
    expect(parseActionIntent("ab click karo")).toMatchObject({
      type: "CLICK",
      target: "__CURRENT__",
    });
    expect(parseActionIntent("Ab search button click karo")).toMatchObject({
      type: "CLICK",
      target: "search",
    });

    // Texting shortcuts in command wrapper, typed value untouched
    expect(parseActionIntent("yha msg main Mr. Kr Dev type kr do")).toMatchObject({
      type: "FORM_FILL",
      explicitPairs: [{ target: "msg", value: "Mr. Kr Dev", overwrite: false }],
    });

    // Explicit in-page search vs navigation
    expect(parseActionIntent("122 search karo is page par")).toMatchObject({
      type: "FIND",
      target: "122",
      inPageOnly: true,
    });
    expect(parseActionIntent("is page par pension search kr do")).toMatchObject({
      type: "FIND",
      target: "pension",
      inPageOnly: true,
    });

    // Named scrollable container
    expect(parseActionIntent("Notices ko neeche scroll karo")).toMatchObject({
      type: "SCROLL",
      direction: "down",
      targetContainerText: "notices",
    });

    // Local inspection & activity logs
    expect(parseActionIntent("is page par kya kya hai")).toMatchObject({
      type: "PAGE_INVENTORY",
    });
    expect(parseActionIntent("ab tak kya kiya")).toMatchObject({
      type: "ACTIVITY_LOG",
    });

    // Browser history
    expect(parseActionIntent("go back")).toMatchObject({ type: "HISTORY_NAV", direction: "back" });
    expect(parseActionIntent("go forward")).toMatchObject({
      type: "HISTORY_NAV",
      direction: "forward",
    });
    expect(parseActionIntent("refresh page")).toMatchObject({
      type: "HISTORY_NAV",
      direction: "reload",
    });

    // Standalone submit always flagged consequential
    expect(parseActionIntent("Submit karo")).toMatchObject({
      type: "CLICK",
      target: "submit",
      isConsequential: true,
    });

    // Ordinal choice parser for disambiguation prompts
    expect(resolveOrdinalChoiceIndex("pehla")).toBe(1);
    expect(resolveOrdinalChoiceIndex("doosra wala")).toBe(2);
    expect(resolveOrdinalChoiceIndex("teesra option")).toBe(3);
    expect(resolveOrdinalChoiceIndex("2")).toBe(2);
    expect(resolveOrdinalChoiceIndex("click login")).toBeNull();
  });

  it("enforces verification honesty, maxLength refusal, ambiguity detection, navigateTab timeout honesty, and log masking", () => {
    const bgCode = fs.readFileSync(backgroundJsPath, "utf-8");
    const spCode = fs.readFileSync(sidepanelJsPath, "utf-8");

    // maxLength guard and strict verified check in background.js
    expect(bgCode).toContain("exceeds field maxlength");
    expect(bgCode).toContain("if (verified) {\n            results.filled.push(");
    expect(bgCode).toContain("ok: verified,");
    expect(bgCode).toContain("ambiguous: true,");
    expect(bgCode).toContain("stale: true,");
    expect(bgCode).toContain("pageFeedback");
    expect(bgCode).toContain("hasErrorFeedback");
    expect(bgCode).toContain("NAVIGATE_HISTORY");

    // navigateTab does not return ok: true on timeout or error page
    const navFn = bgCode.slice(
      bgCode.indexOf("async function navigateTab("),
      bgCode.indexOf("async function navigateHistory("),
    );
    expect(navFn).toContain("let settled = false;");
    expect(navFn).toContain("chrome-error|about:neterror");
    expect(navFn).toContain("const ok = !isErrorPage && isComplete;");

    // sidepanel.js masks sensitive strings in session activity log
    expect(spCode).toContain("function sanitizeLogSummary(");
    expect(spCode).toContain("function recordSessionAction(");
    expect(spCode).toContain("pendingDisambiguation");
  });
});
