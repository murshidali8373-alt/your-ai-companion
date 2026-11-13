import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import {
  maskSensitiveValue,
  parseDocumentTextLocally,
  sanitizeExtractedFields,
  sanitizeFieldsForDisplay,
} from "../src/shared/document-extractor";

describe("Intelligent Visual Computer Agent — Document OCR, Privacy & Screen Actions", () => {
  const root = path.resolve(__dirname, "..");
  const extDir = path.join(root, "extension");
  const sidepanelHtmlPath = path.join(extDir, "sidepanel.html");
  const sidepanelJsPath = path.join(extDir, "sidepanel.js");
  const backgroundJsPath = path.join(extDir, "background.js");

  it("extracts Aadhaar fields deterministically, preserves formatting, and never invents missing fields", () => {
    const sampleAadhaar = `
      Government of India
      Unique Identification Authority of India (UIDAI)
      Name: Murshid Ali
      S/O: Rashid Ali
      DOB: 15/08/1994
      Gender: Male
      Address: House 42, MG Road, Bandra West
      City: Mumbai
      State: Maharashtra
      Pincode: 400050
      5678 1234 9012
    `;

    const res = parseDocumentTextLocally(sampleAadhaar, "aadhaar_front.png");
    expect(res.ok).toBe(true);
    expect(res.documentType).toBe("aadhaar");
    expect(res.fields.name).toBe("Murshid Ali");
    expect(res.fields.fatherName).toBe("Rashid Ali");
    expect(res.fields.dob).toBe("15/08/1994");
    expect(res.fields.gender).toBe("Male");
    expect(res.fields.city).toBe("Mumbai");
    expect(res.fields.state).toBe("Maharashtra");
    expect(res.fields.pincode).toBe("400050");
    expect(res.fields.aadhaarNumber).toBe("5678 1234 9012");
    // Must NEVER invent absent fields
    expect(res.fields.email).toBeUndefined();
    expect(res.fields.panNumber).toBeUndefined();
    expect(res.fields.gstin).toBeUndefined();
    expect(res.ambiguousFields).toEqual([]);
  });

  it("flags conflicting/ambiguous Aadhaar or PAN numbers instead of guessing", () => {
    const multiIdDoc = `
      Aadhaar Scan
      2345 6789 0123
      Alternate Copy: 3456 7890 1234
    `;
    const res = parseDocumentTextLocally(multiIdDoc, "aadhaar_scan.pdf");
    expect(res.ambiguousFields).toContain("aadhaarNumber");
    expect(res.fields.aadhaarNumber).toBeUndefined();
  });

  it("extracts PAN, Invoice, and Shipping Label fields accurately", () => {
    const panDoc = `
      INCOME TAX DEPARTMENT
      Permanent Account Number
      Name: Priya Sharma
      Father's Name: Rajesh Sharma
      DOB: 04/11/1992
      ABCDE1234F
    `;
    const panRes = parseDocumentTextLocally(panDoc, "pan.jpg");
    expect(panRes.documentType).toBe("pan");
    expect(panRes.fields.panNumber).toBe("ABCDE1234F");
    expect(panRes.fields.name).toBe("Priya Sharma");
    expect(panRes.fields.fatherName).toBe("Rajesh Sharma");

    const invDoc = `
      Tax Invoice
      Company: Bharat Logistics Pvt Ltd
      Invoice No: INV-2026-0891
      GSTIN: 27AABCU9603R1ZM
      Order ID: ORD-77412
      Phone: +91 9876543210
      Email: billing@bharatlogistics.in
    `;
    const invRes = parseDocumentTextLocally(invDoc, "invoice.pdf");
    expect(invRes.documentType).toBe("invoice");
    expect(invRes.fields.invoiceNumber).toBe("INV-2026-0891");
    expect(invRes.fields.gstin).toBe("27AABCU9603R1ZM");
    expect(invRes.fields.orderId).toBe("ORD-77412");
    expect(invRes.fields.phone).toBe("9876543210");
    expect(invRes.fields.email).toBe("billing@bharatlogistics.in");

    const shipDoc = `
      Shipping Label
      AWB: DELH99887766
      Ship To: 18 Park Street, Kolkata
      Pin Code: 700016
    `;
    const shipRes = parseDocumentTextLocally(shipDoc, "label.png");
    expect(shipRes.documentType).toBe("shipping_label");
    expect(shipRes.fields.trackingNumber).toBe("DELH99887766");
    expect(shipRes.fields.pincode).toBe("700016");
  });

  it("masks sensitive Aadhaar and PAN values for chat/display and strips placeholders", () => {
    expect(maskSensitiveValue("aadhaarNumber", "5678 1234 9012")).toBe("XXXX-XXXX-9012");
    expect(maskSensitiveValue("panNumber", "ABCDE1234F")).toBe("XXXXXX234F");

    const sanitizedDisplay = sanitizeFieldsForDisplay({
      name: "Murshid Ali",
      aadhaarNumber: "5678 1234 9012",
      panNumber: "ABCDE1234F",
    });
    expect(sanitizedDisplay).toEqual({
      name: "Murshid Ali",
      aadhaarNumber: "XXXX-XXXX-9012",
      panNumber: "XXXXXX234F",
    });

    const cleanModelOut = sanitizeExtractedFields({
      name: "Murshid Ali",
      email: "N/A",
      phone: "unknown",
      address: "[not visible]",
      dob: "15/08/1994",
      gstin: null,
    });
    expect(cleanModelOut).toEqual({
      name: "Murshid Ali",
      dob: "15/08/1994",
    });
  });

  it("supports uploaded document UI, multi-format input, and hidden attribute rules in sidepanel.html", () => {
    const html = fs.readFileSync(sidepanelHtmlPath, "utf-8");
    expect(html).toContain("[hidden]");
    expect(html).toContain("display: none !important;");
    expect(html).toContain('id="uploadedDocBar"');
    expect(html).toContain('id="uploadedDocLabel"');
    expect(html).toContain('id="clearUploadedDocBtn"');
    expect(html).toContain(
      'accept="image/*,.png,.jpg,.jpeg,.webp,.pdf,.csv,.xlsx,.xls,.docx,.txt,.json"',
    );
  });

  it("parses all 6 Hindi/Hinglish/English acceptance commands accurately via sidepanel.js intent & plan parsers", () => {
    const js = fs.readFileSync(sidepanelJsPath, "utf-8");

    // Extract helper functions into an isolated sandbox to unit-test exact parser behavior
    const sandbox: Record<string, unknown> = {
      activeUploadedDocument: {
        fileName: "aadhaar.png",
        documentType: "aadhaar",
        fields: {
          name: "Murshid Ali",
          dob: "15/08/1994",
          address: "MG Road, Mumbai",
          aadhaarNumber: "5678 1234 9012",
        },
      },
    };
    const fnNames = [
      "extractRequestedDocFieldKeys",
      "stripBuddyPrefix",
      "normalizeFillTarget",
      "extractFillDetails",
      "parseActionIntent",
      "buildMultiActionPlan",
    ];
    for (const fn of fnNames) {
      const start = js.indexOf(`function ${fn}(`);
      expect(start).toBeGreaterThan(-1);
    }

    // Load contiguous block covering lines ~1149-1660 and 2413-2625
    const helperStart = js.indexOf("function extractRequestedDocFieldKeys(");
    const helperEnd = js.indexOf("async function executeNaturalBrowserAction(");
    const planStart = js.indexOf("function buildMultiActionPlan(");
    const planEnd = js.indexOf("function renderTaskPlanUI(");

    vm.runInNewContext(
      `${js.slice(helperStart, helperEnd)}\n${js.slice(planStart, planEnd)}`,
      sandbox,
    );

    const parseActionIntent = sandbox.parseActionIntent as (s: string) => Record<string, unknown>;
    const buildMultiActionPlan = sandbox.buildMultiActionPlan as (s: string) => {
      steps: Array<Record<string, unknown>>;
    };

    // 1. Document fill scenarios
    expect(parseActionIntent("Buddy, is page ka form fill kar do.")).toMatchObject({
      type: "FORM_FILL",
      useUploadedDocument: true,
    });
    expect(parseActionIntent("Buddy, Aadhaar details fill kar do.")).toMatchObject({
      type: "FORM_FILL",
      useUploadedDocument: true,
      requestedDocKeys: null, // fills ALL Aadhaar details, not just number!
    });
    expect(parseActionIntent("Is field mein Aadhaar number daalo")).toMatchObject({
      type: "FORM_FILL",
      useUploadedDocument: true,
      targetCurrentBox: true,
      requestedDocKeys: ["aadhaarNumber"],
    });

    // 2. Visual form inspection
    expect(parseActionIntent("Yahan kya fill karna hai?")).toMatchObject({ type: "FORM_INSPECT" });
    expect(parseActionIntent("What information does this form require?")).toMatchObject({
      type: "FORM_INSPECT",
    });

    // 3. CLICK action
    expect(parseActionIntent("Buddy, Orders tab open karo.")).toMatchObject({
      type: "CLICK",
      target: "orders",
    });
    expect(parseActionIntent("login button par click karo.")).toMatchObject({
      type: "CLICK",
      target: "login",
    });

    // 4. POINT / FIND without clicking
    expect(parseActionIntent("Buddy, Orders tab kahan hai?")).toMatchObject({
      type: "FIND",
      target: "orders",
    });
    expect(parseActionIntent("Buddy, address field par point karo.")).toMatchObject({
      type: "POINT",
      target: "address",
    });

    // 5. SCROLL actions
    expect(parseActionIntent("Buddy, neeche scroll karo.")).toMatchObject({
      type: "SCROLL",
      direction: "down",
    });
    expect(parseActionIntent("Page ko neeche le jao.")).toMatchObject({
      type: "SCROLL",
      direction: "down",
    });

    // 6. MULTI-STEP with uploaded document
    const multiCmd =
      "Buddy, profile tab open karo, edit button click karo, meri uploaded ID se naam aur address fill karo.";
    expect(parseActionIntent(multiCmd)).toMatchObject({ type: "MULTI_STEP" });
    const plan = buildMultiActionPlan(multiCmd.replace(/^Buddy,\s*/i, ""));
    expect(plan.steps).toHaveLength(3);
    expect(plan.steps[0]).toMatchObject({ action: "click", textTarget: "profile" });
    expect(plan.steps[1]).toMatchObject({ action: "click", textTarget: "edit" });
    expect(plan.steps[2]).toMatchObject({
      action: "fill_from_document",
      requestedFields: ["name", "address"],
    });
  });

  it("enforces iframe (allFrames), screenshot vision fallback, Aadhaar/PAN field synonyms, and gov/payment consent gates", () => {
    const bgCode = fs.readFileSync(backgroundJsPath, "utf-8");
    const spCode = fs.readFileSync(sidepanelJsPath, "utf-8");
    const extractRouteCode = fs.readFileSync(
      path.join(root, "src/routes/api/public/extension/extract-document.ts"),
      "utf-8",
    );
    const buddyServiceCode = fs.readFileSync(
      path.join(root, "src/lib/buddy-service.server.ts"),
      "utf-8",
    );

    // background.js capabilities
    expect(bgCode).toContain("EXTRACT_DOCUMENT");
    expect(bgCode).toContain("mergeFrameSnapshots");
    expect(bgCode).toContain("allFrames: true");
    expect(bgCode).toContain("captureVisibleTab");
    expect(bgCode).toContain("fill_from_document");
    expect(bgCode).toContain("aadhaarnumber:");
    expect(bgCode).toContain("pannumber:");
    expect(bgCode).toContain("neeche\\s+(?:jao|le\\s+jao)");

    // sidepanel.js safety & masking
    expect(spCode).toContain("maskSensitiveDocValue");
    expect(spCode).toContain(".gov");
    expect(spCode).toContain("uidai");

    // Server uses provider-keys.server.ts and Gemini 3/4 aliases
    expect(extractRouteCode).toContain("getGeminiKey");
    expect(extractRouteCode).toContain("gemini-4-hydrogen");
    expect(extractRouteCode).not.toContain("process.env.GEMINI_API_KEY");
    expect(buddyServiceCode).toContain("screenshotBase64");
    expect(buddyServiceCode).toContain("uploadedDocumentSummary");
  });
});
