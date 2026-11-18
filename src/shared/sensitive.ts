/**
 * Sensitive-data detection shared by the web app, the server and the extension.
 * The database trigger `block_sensitive_memory` is the authoritative check;
 * this exists so we fail early and never put secrets into a prompt.
 */

export const SENSITIVE_KEY_PATTERN =
  /(password|passwd|pwd|otp|one[\s_-]?time|(?<!postal[\s_-])(?<![a-z0-9])pin(?![a-z0-9]|[\s_-]*code\b)|cvv|cvc|card[\s_-]?number|credit[\s_-]?card|private[\s_-]?key|secret|api[\s_-]?key|access[\s_-]?token|bearer|seed[\s_-]?phrase|mnemonic|aadhaar|social[\s_-]?security|\bssn\b)/i;

export const SENSITIVE_VALUE_PATTERN =
  /(-----BEGIN [A-Z ]*PRIVATE KEY-----|\bsk-[A-Za-z0-9]{16,}|\bcvv\b\s*[:=]|\botp\b\s*[:=]|password\s*[:=]|\b\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\b)/i;

/** True when a label/name or a value looks like a secret. */
export function containsSensitive(key: string, value = ""): boolean {
  return SENSITIVE_KEY_PATTERN.test(key) || SENSITIVE_VALUE_PATTERN.test(value);
}

/** True when a form field's value must never be captured. */
export function isSensitiveField(field: {
  type?: string | null;
  label?: string | null;
  name?: string | null;
  autocomplete?: string | null;
}): boolean {
  const type = (field.type ?? "").toLowerCase();
  if (type === "password" || type === "hidden") return true;
  const auto = (field.autocomplete ?? "").toLowerCase();
  if (auto.includes("password") || auto.includes("cc-") || auto.includes("one-time-code")) {
    return true;
  }
  return SENSITIVE_KEY_PATTERN.test(`${field.label ?? ""} ${field.name ?? ""}`);
}

export const REDACTED = "[redacted]";

/** Replace a value with a placeholder when it must not be transmitted. */
export function redactIfSensitive(
  field: { type?: string | null; label?: string | null; name?: string | null },
  value: string,
): string {
  return isSensitiveField(field) ? REDACTED : value;
}
