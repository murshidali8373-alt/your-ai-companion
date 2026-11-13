/**
 * Shared Document Understanding & Privacy-Safe Field Mapping helpers.
 * Never invents missing information and masks sensitive IDs for display/logging.
 */

export type DocumentType =
  "aadhaar" | "pan" | "invoice" | "shipping_label" | "id_card" | "form" | "other";

export interface ExtractedDocumentFields {
  name?: string;
  fatherName?: string;
  dob?: string;
  gender?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  aadhaarNumber?: string;
  panNumber?: string;
  gstin?: string;
  invoiceNumber?: string;
  orderId?: string;
  trackingNumber?: string;
  company?: string;
  amount?: string;
  date?: string;
}

export interface ExtractedDocumentResult {
  ok: boolean;
  documentType: DocumentType;
  fileName: string;
  confidence: "high" | "medium" | "low";
  fields: ExtractedDocumentFields;
  ambiguousFields: string[];
  notes?: string;
  provider?: string;
}

const SENSITIVE_DOC_KEYS = new Set(["aadhaarNumber", "panNumber", "aadhaar", "pan"]);

export function maskSensitiveValue(key: string, value: string): string {
  const str = String(value || "").trim();
  if (!str) return "";
  const normKey = key.replace(/[^a-zA-Z]/g, "").toLowerCase();
  if (normKey.includes("aadhaar") || normKey.includes("aadhar")) {
    const digits = str.replace(/\D/g, "");
    if (digits.length >= 4) {
      return `XXXX-XXXX-${digits.slice(-4)}`;
    }
    return "XXXX-XXXX";
  }
  if (normKey === "pan" || normKey === "pannumber") {
    if (str.length >= 4) {
      return `${"X".repeat(Math.max(0, str.length - 4))}${str.slice(-4)}`;
    }
    return "XXXXXXXXXX";
  }
  if (SENSITIVE_DOC_KEYS.has(key)) {
    return str.length > 4 ? `${"X".repeat(str.length - 4)}${str.slice(-4)}` : "••••";
  }
  return str;
}

export function sanitizeFieldsForDisplay(fields: ExtractedDocumentFields): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields || {})) {
    if (typeof v === "string" && v.trim()) {
      out[k] = maskSensitiveValue(k, v.trim());
    }
  }
  return out;
}

/**
 * Deterministic regex & label-based extractor for plain-text documents,
 * selectable PDF text layers, or test/offline fallback. Never guesses absent fields.
 */
export function parseDocumentTextLocally(
  rawText: string,
  fileName = "document",
): ExtractedDocumentResult {
  const text = String(rawText || "").replace(/\r/g, "\n");
  const compact = text.replace(/[ \t]+/g, " ");
  const lower = `${fileName} ${compact}`.toLowerCase();

  const fields: ExtractedDocumentFields = {};
  const ambiguousFields: string[] = [];

  // Document type detection
  let documentType: DocumentType = "other";
  if (/aadhaar|aadhar|uidai|unique\s+identification/i.test(lower)) {
    documentType = "aadhaar";
  } else if (/\bpan\b|permanent\s+account\s+number|income\s+tax\s+department/i.test(lower)) {
    documentType = "pan";
  } else if (
    /shipping\s+label|awb|tracking\s*(?:id|no|number)|ship\s+to|deliver\s+to|courier/i.test(lower)
  ) {
    documentType = "shipping_label";
  } else if (/invoice|tax\s+invoice|gstin|bill\s+no|total\s+amount/i.test(lower)) {
    documentType = "invoice";
  }

  // Aadhaar: 12 digits (optionally spaced/hyphenated 4-4-4)
  const aadhaarMatches = [...compact.matchAll(/\b([2-9]\d{3}[\s-]?\d{4}[\s-]?\d{4})\b/g)].map((m) =>
    m[1]!.replace(/[\s-]+/g, " ").trim(),
  );
  const uniqueAadhaar = [...new Set(aadhaarMatches)];
  if (uniqueAadhaar.length === 1) {
    fields.aadhaarNumber = uniqueAadhaar[0];
    if (documentType === "other") documentType = "aadhaar";
  } else if (uniqueAadhaar.length > 1) {
    ambiguousFields.push("aadhaarNumber");
  }

  // PAN: 5 letters, 4 digits, 1 letter
  const panMatches = [...compact.toUpperCase().matchAll(/\b([A-Z]{5}[0-9]{4}[A-Z])\b/g)].map(
    (m) => m[1]!,
  );
  const uniquePan = [...new Set(panMatches)];
  if (uniquePan.length === 1) {
    fields.panNumber = uniquePan[0];
    if (documentType === "other") documentType = "pan";
  } else if (uniquePan.length > 1) {
    ambiguousFields.push("panNumber");
  }

  // GSTIN: 15-char standard format
  const gstMatch = compact
    .toUpperCase()
    .match(/\b([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z])\b/);
  if (gstMatch?.[1]) {
    fields.gstin = gstMatch[1];
    if (documentType === "other") documentType = "invoice";
  }

  // Email
  const emailMatch = compact.match(/\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/);
  if (emailMatch?.[1]) fields.email = emailMatch[1];

  // Phone / Mobile (10-digit Indian or +91 format; exclude numbers inside Aadhaar if 12 digits)
  const phoneMatch = compact.match(/(?:\+?91[\s-]?)?\b([6-9]\d{9})\b/);
  if (phoneMatch?.[1]) fields.phone = phoneMatch[1];

  // DOB
  const dobMatch = compact.match(
    /(?:dob|date\s+of\s+birth|birth\s*date|year\s+of\s+birth|जन्म\s*तिथि)\s*[:-]?\s*(\d{2}[/-]\d{2}[/-]\d{4}|\d{4}[/-]\d{2}[/-]\d{2})/i,
  );
  if (dobMatch?.[1]) fields.dob = dobMatch[1];

  // Gender
  const genderMatch = compact.match(/\b(male|female|transgender|पुरुष|महिला)\b/i);
  if (genderMatch?.[1]) {
    const g = genderMatch[1].toLowerCase();
    fields.gender = g === "पुरुष" ? "Male" : g === "महिला" ? "Female" : genderMatch[1];
  }

  // Pincode (6 digits)
  const pinMatch =
    compact.match(/(?:pin\s*(?:code)?|pincode|zip)\s*[:-]?\s*(\d{6})\b/i) ||
    compact.match(/\b([1-9]\d{5})\b/);
  if (pinMatch?.[1]) fields.pincode = pinMatch[1];

  // Explicit labelled fields
  const labelPatterns: Array<{ key: keyof ExtractedDocumentFields; re: RegExp }> = [
    { key: "name", re: /(?:^|\n)\s*(?:full\s+)?name\s*[:-]\s*([^\n]{2,60})/i },
    {
      key: "fatherName",
      re: /(?:^|\n)\s*(?:father(?:'s)?\s*name|s\/o|d\/o|w\/o|c\/o)\s*[:-]?\s*([^\n,]{2,60})/i,
    },
    { key: "address", re: /(?:^|\n)\s*(?:address|residence|ship\s*to)\s*[:-]\s*([^\n]{5,180})/i },
    { key: "city", re: /(?:^|\n)\s*(?:city|town|district)\s*[:-]\s*([^\n,]{2,40})/i },
    { key: "state", re: /(?:^|\n)\s*(?:state|province)\s*[:-]\s*([^\n,]{2,40})/i },
    { key: "invoiceNumber", re: /(?:invoice\s*(?:no|number|#))\s*[:-]?\s*([A-Z0-9/-]{3,32})/i },
    { key: "orderId", re: /(?:order\s*(?:id|no|number|#))\s*[:-]?\s*([A-Z0-9_-]{3,32})/i },
    {
      key: "trackingNumber",
      re: /(?:tracking\s*(?:id|no|number)|awb(?:\s*no)?)\s*[:-]?\s*([A-Z0-9-]{5,36})/i,
    },
    {
      key: "company",
      re: /(?:^|\n)\s*(?:company|business|seller|vendor|firm)\s*(?:name)?\s*[:-]\s*([^\n]{2,80})/i,
    },
  ];

  for (const { key, re } of labelPatterns) {
    const m = text.match(re);
    if (m?.[1]) {
      const val = m[1].trim();
      if (val && !fields[key]) {
        fields[key] = val;
      }
    }
  }

  const foundCount = Object.keys(fields).length;
  return {
    ok: foundCount > 0,
    documentType,
    fileName,
    confidence: foundCount >= 3 ? "high" : foundCount > 0 ? "medium" : "low",
    fields,
    ambiguousFields,
    notes:
      foundCount > 0
        ? `Extracted ${foundCount} field(s) locally.`
        : "No readable text fields could be extracted offline.",
    provider: "local_ocr_parser",
  };
}

/**
 * Merges fields extracted from an AI Vision model with strict validation:
 * removes null/"N/A"/"unknown"/placeholder entries so Buddy never invents missing info.
 */
export function sanitizeExtractedFields(
  raw: Record<string, unknown> | null | undefined,
): ExtractedDocumentFields {
  const clean: ExtractedDocumentFields = {};
  if (!raw || typeof raw !== "object") return clean;

  const ALLOWED_KEYS: Array<keyof ExtractedDocumentFields> = [
    "name",
    "fatherName",
    "dob",
    "gender",
    "phone",
    "email",
    "address",
    "city",
    "state",
    "pincode",
    "aadhaarNumber",
    "panNumber",
    "gstin",
    "invoiceNumber",
    "orderId",
    "trackingNumber",
    "company",
    "amount",
    "date",
  ];

  const PLACEHOLDER_RE =
    /^(?:n\/a|na|none|null|undefined|unknown|not\s+(?:visible|available|found|provided)|unclear|\[.*\]|\.+|-+)$/i;

  for (const key of ALLOWED_KEYS) {
    const val = raw[key];
    if (typeof val === "string") {
      const trimmed = val.trim();
      if (trimmed && !PLACEHOLDER_RE.test(trimmed)) {
        clean[key] = trimmed;
      }
    }
  }

  return clean;
}
