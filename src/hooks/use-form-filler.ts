import { useState, useCallback, useRef } from "react";

export interface FieldInteractabilityStatus {
  interactable: boolean;
  reason?: string;
  details: {
    isConnected: boolean;
    isVisible: boolean;
    hasSize: boolean;
    isEnabled: boolean;
    isReadOnly: boolean;
    isPointerAccessible: boolean;
    isSensitive: boolean;
  };
}

export interface FilledFieldResult {
  key: string;
  field: string;
  selector?: string;
  value: string | number | boolean;
  previousValue?: string;
  verified: boolean;
  verifiedValue?: string;
  durationMs: number;
}

export interface PreservedFieldResult {
  key: string;
  field: string;
  selector?: string;
  existingValue: string;
  reason: string;
}

export interface SkippedFieldResult {
  key: string;
  reason: string;
  value?: unknown;
}

export interface FieldErrorResult {
  key: string;
  error: string;
}

export interface FormFillResult {
  ok: boolean;
  filled: FilledFieldResult[];
  preserved: PreservedFieldResult[];
  skipped: SkippedFieldResult[];
  errors: FieldErrorResult[];
  summary: string;
  pendingSubmission?: PendingSubmissionData | null;
}

export interface PendingSubmissionData {
  formSelector?: string;
  submitButtonSelector?: string;
  submitButtonText?: string;
  fieldsFilledCount: number;
  timestamp: number;
  targetForm?: HTMLFormElement | null;
  targetButton?: HTMLElement | null;
}

export interface UseFormFillerOptions {
  /** Delay between field actions to allow browser render & reflow (ms) */
  eventDelayMs?: number;
  /** Delay after scrolling field into view (ms) */
  scrollDelayMs?: number;
  /** Delay after focusing field before input (ms) */
  focusDelayMs?: number;
  /** Whether to overwrite fields that already have non-empty user content */
  overwrite?: boolean;
  /** Require explicit user confirmation before submitting any form (default true) */
  requireConfirmationBeforeSubmit?: boolean;
  /** Progress callback */
  onProgress?: (field: string, current: number, total: number) => void;
  /** Callback fired when a field is verified */
  onFieldFilled?: (result: FilledFieldResult) => void;
  /** Callback fired when form reaches final submission gate awaiting confirmation */
  onRequiresConfirmation?: (pending: PendingSubmissionData) => void;
}

export const FIELD_SYNONYMS: Record<string, string[]> = {
  name: ["fullname", "legalname", "username", "contactname", "applicantname", "ownername", "firstname"],
  fullname: ["name", "legalname", "username"],
  legalname: ["company", "businessname", "firmname", "organization", "companyname", "name"],
  tradename: ["businessname", "storename", "shopname", "brandname", "company"],
  email: ["mail", "emailaddress", "contactemail"],
  phone: ["mobile", "contact", "contactnumber", "tel", "phonenumber", "cellphone"],
  gstin: ["gst", "taxid", "gstnumber", "gstinnumber", "tin"],
  address: ["street", "line1", "addressline1", "shippingaddress", "billingaddress", "fulladdress"],
  city: ["town", "district"],
  state: ["province", "region"],
  pincode: ["zip", "zipcode", "postalcode", "pin"],
};

const SENSITIVE_PATTERN =
  /pass(?:word)?|pin|otp|cvv|cvc|secret|token|ssn|aadhaar|card(?:_?number)?|credit|debit/i;

const SUBMIT_BUTTON_PATTERN =
  /submit|sign\s*in|log\s*in|proceed|confirm|continue|checkout|purchase|pay|place\s*order|delete|send/i;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const normalizeId = (val: unknown): string =>
  String(val ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

/**
 * Validates whether an element is a sensitive field that must be skipped for user security.
 */
export function isSensitiveField(el: Element, nameOrId?: string): boolean {
  const combined = [
    (el as HTMLInputElement).type,
    (el as HTMLInputElement).name,
    el.id,
    el.getAttribute("aria-label"),
    el.getAttribute("placeholder"),
    nameOrId,
  ]
    .filter(Boolean)
    .join(" ");
  return SENSITIVE_PATTERN.test(combined);
}

/**
 * Sequentially inspects an element to verify physical and stylistic interactability.
 */
export function validateFieldInteractability(element: HTMLElement): FieldInteractabilityStatus {
  const details = {
    isConnected: Boolean(element.isConnected),
    isVisible: false,
    hasSize: false,
    isEnabled: true,
    isReadOnly: false,
    isPointerAccessible: true,
    isSensitive: false,
  };

  if (!details.isConnected) {
    return {
      interactable: false,
      reason: "Element is not attached to the active DOM.",
      details,
    };
  }

  const inputEl = element as HTMLInputElement;

  // Type check
  if (inputEl.type === "hidden") {
    return {
      interactable: false,
      reason: "Element is a hidden input.",
      details,
    };
  }

  // Sensitive check
  if (isSensitiveField(element)) {
    details.isSensitive = true;
    return {
      interactable: false,
      reason: "Security block: password, OTP, or financial security field.",
      details,
    };
  }

  // Computed styles check
  if (typeof window !== "undefined" && typeof window.getComputedStyle === "function") {
    const style = window.getComputedStyle(element);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      parseFloat(style.opacity || "1") <= 0
    ) {
      return {
        interactable: false,
        reason: "Element is invisible or styled with display:none.",
        details,
      };
    }
    details.isVisible = true;

    if (style.pointerEvents === "none") {
      details.isPointerAccessible = false;
      return {
        interactable: false,
        reason: "Pointer events are disabled on element.",
        details,
      };
    }
  } else {
    details.isVisible = true;
  }

  // Dimensions check
  const rect = element.getBoundingClientRect
    ? element.getBoundingClientRect()
    : { width: 1, height: 1 };
  if (rect.width <= 0 && rect.height <= 0) {
    return {
      interactable: false,
      reason: "Element has zero dimensions (collapsed).",
      details,
    };
  }
  details.hasSize = true;

  // Disabled and ReadOnly check
  if (inputEl.disabled) {
    details.isEnabled = false;
    return {
      interactable: false,
      reason: "Element is disabled.",
      details,
    };
  }

  if (inputEl.readOnly && inputEl.type !== "checkbox" && inputEl.type !== "radio") {
    details.isReadOnly = true;
    return {
      interactable: false,
      reason: "Element is read-only.",
      details,
    };
  }

  return {
    interactable: true,
    details,
  };
}

/**
 * Collects candidate identifiers for matching keys with form inputs.
 */
function getFieldIdentifiers(el: HTMLElement): string[] {
  const ids: string[] = [];
  const input = el as HTMLInputElement;

  if (input.name) ids.push(normalizeId(input.name));
  if (input.id) {
    ids.push(normalizeId(input.id));
    if (typeof document !== "undefined") {
      try {
        const lbl = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
        if (lbl && (lbl as HTMLElement).innerText) {
          ids.push(normalizeId((lbl as HTMLElement).innerText));
        }
      } catch {
        // ignore selector error
      }
    }
  }
  if (input.placeholder) ids.push(normalizeId(input.placeholder));
  const aria = el.getAttribute("aria-label");
  if (aria) ids.push(normalizeId(aria));
  const testId = el.getAttribute("data-testid");
  if (testId) ids.push(normalizeId(testId));

  const wrapLabel = el.closest("label");
  if (wrapLabel && wrapLabel.innerText) {
    ids.push(normalizeId(wrapLabel.innerText));
  }

  const prev = el.previousElementSibling as HTMLElement | null;
  if (prev && (prev.tagName === "LABEL" || prev.tagName === "SPAN") && prev.innerText) {
    ids.push(normalizeId(prev.innerText));
  }

  return ids.filter(Boolean);
}

/**
 * Dispatches sequential input events with proper timing to ensure framework state updates.
 */
async function applyValueWithTimedEvents(
  el: HTMLElement,
  val: string | number | boolean,
  options: {
    eventDelayMs: number;
    scrollDelayMs: number;
    focusDelayMs: number;
  },
): Promise<string> {
  // 1. Scroll into view smoothly
  try {
    el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
  } catch {
    // fallback
  }
  await sleep(options.scrollDelayMs);

  // 2. Focus element
  el.focus();
  el.dispatchEvent(new FocusEvent("focus", { bubbles: true }));
  await sleep(options.focusDelayMs);

  const strVal = String(val);

  if (el.tagName === "SELECT") {
    const select = el as HTMLSelectElement;
    const targetNorm = normalizeId(strVal);
    const opt = [...select.options].find(
      (o) =>
        normalizeId(o.value) === targetNorm ||
        normalizeId(o.text) === targetNorm ||
        o.text.toLowerCase().includes(strVal.toLowerCase()),
    );
    if (opt) {
      select.value = opt.value;
    } else {
      select.value = strVal;
    }
  } else if ((el as HTMLInputElement).type === "checkbox") {
    (el as HTMLInputElement).checked = Boolean(val);
  } else if ((el as HTMLInputElement).type === "radio") {
    (el as HTMLInputElement).checked = true;
  } else if (el.getAttribute("contenteditable") === "true") {
    el.innerText = strVal;
  } else {
    // Native prototype descriptor setter ensures React / Vue / Angular register the value change
    const isTextarea = el.tagName === "TEXTAREA";
    const proto =
      typeof window !== "undefined"
        ? isTextarea
          ? window.HTMLTextAreaElement?.prototype
          : window.HTMLInputElement?.prototype
        : null;

    const nativeSetter = proto ? Object.getOwnPropertyDescriptor(proto, "value")?.set : null;
    if (nativeSetter) {
      nativeSetter.call(el, strVal);
    } else {
      (el as HTMLInputElement).value = strVal;
    }
  }

  // 3. Sequential Event Dispatch with controlled timing
  el.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
  await sleep(options.eventDelayMs);

  el.dispatchEvent(new Event("change", { bubbles: true }));
  await sleep(options.eventDelayMs);

  el.blur();
  el.dispatchEvent(new FocusEvent("blur", { bubbles: true }));

  // Return verified string
  if ((el as HTMLInputElement).type === "checkbox") {
    return String((el as HTMLInputElement).checked);
  }
  return (el as HTMLInputElement).value || el.innerText || "";
}

/**
 * Searches for a submit button or submit trigger associated with a form.
 */
function findSubmitTrigger(
  elements: HTMLElement[],
  container?: HTMLElement | Document,
): { element: HTMLElement; text: string; form: HTMLFormElement | null } | null {
  const root = container || (typeof document !== "undefined" ? document : null);
  if (!root) return null;

  // 1. Look inside parent forms of filled elements
  const parentForms = new Set<HTMLFormElement>();
  for (const el of elements) {
    const f = el.closest("form");
    if (f) parentForms.add(f);
  }

  for (const form of parentForms) {
    const btn = form.querySelector(
      'button[type="submit"], input[type="submit"], button:not([type="button"])',
    ) as HTMLElement | null;
    if (btn) {
      return {
        element: btn,
        text: btn.innerText || (btn as HTMLInputElement).value || "Submit Form",
        form,
      };
    }
  }

  // 2. Global search for submit/checkout buttons
  const candidates = [
    ...root.querySelectorAll('button, input[type="submit"], [role="button"]'),
  ] as HTMLElement[];

  for (const btn of candidates) {
    const text = btn.innerText || (btn as HTMLInputElement).value || "";
    if (SUBMIT_BUTTON_PATTERN.test(text) || (btn as HTMLInputElement).type === "submit") {
      const parentForm = btn.closest("form");
      return {
        element: btn,
        text: text.trim() || "Submit",
        form: parentForm,
      };
    }
  }

  return null;
}

/**
 * Pure execution function to sequentially fill form fields with validation, timing, and confirmation gating.
 * Can be called inside React hooks or in standalone/scripting contexts.
 */
export async function executeFormFill(
  fields: Record<string, unknown>,
  optionsOverride?: Partial<UseFormFillerOptions>,
  container?: HTMLElement | Document,
): Promise<FormFillResult> {
  const opts: Required<
    Omit<UseFormFillerOptions, "onProgress" | "onFieldFilled" | "onRequiresConfirmation">
  > &
    Pick<UseFormFillerOptions, "onProgress" | "onFieldFilled" | "onRequiresConfirmation"> = {
    eventDelayMs: optionsOverride?.eventDelayMs ?? 30,
    scrollDelayMs: optionsOverride?.scrollDelayMs ?? 40,
    focusDelayMs: optionsOverride?.focusDelayMs ?? 20,
    overwrite: optionsOverride?.overwrite ?? false,
    requireConfirmationBeforeSubmit: optionsOverride?.requireConfirmationBeforeSubmit ?? true,
    onProgress: optionsOverride?.onProgress,
    onFieldFilled: optionsOverride?.onFieldFilled,
    onRequiresConfirmation: optionsOverride?.onRequiresConfirmation,
  };

  const fillResult: FormFillResult = {
    ok: true,
    filled: [],
    preserved: [],
    skipped: [],
    errors: [],
    summary: "",
  };

  const root = container || (typeof document !== "undefined" ? document : null);
  if (!root) {
    fillResult.ok = false;
    fillResult.summary = "DOM document is not available.";
    return fillResult;
  }

  // Query interactable inputs in container
  const allFormElements = [
    ...root.querySelectorAll('input, textarea, select, [contenteditable="true"]'),
  ] as HTMLElement[];

  const entries = Object.entries(fields || {}).filter(
    ([, val]) => val !== undefined && val !== null,
  );
  const total = entries.length;
  let currentIndex = 0;

  const successfullyFilledElements: HTMLElement[] = [];

  for (const [key, val] of entries) {
    currentIndex++;
    opts.onProgress?.(key, currentIndex, total);

    const normKey = normalizeId(key);
    const keyCandidates = [normKey, ...(FIELD_SYNONYMS[normKey] || [])];

    // Find matching candidate
    const candidate = allFormElements.find((el) => {
      const ids = getFieldIdentifiers(el);
      return ids.some((id) =>
        keyCandidates.some((k) => id.includes(k) || k.includes(id)),
      );
    });

    if (!candidate) {
      fillResult.skipped.push({
        key,
        value: val,
        reason: `Field "${key}" not found on active page.`,
      });
      continue;
    }

    // 1. Sequential Interactability Validation
    const interactStatus = validateFieldInteractability(candidate);
    if (!interactStatus.interactable) {
      fillResult.skipped.push({
        key,
        value: val,
        reason: interactStatus.reason || "Field is not interactable.",
      });
      continue;
    }

    // 2. Preservation Check: preserve user value unless overwrite is requested
    const existingVal = (candidate as HTMLInputElement).value || candidate.innerText || "";
    if (existingVal.trim() && !opts.overwrite) {
      fillResult.preserved.push({
        key,
        field: (candidate as HTMLInputElement).name || candidate.id || key,
        selector: candidate.id ? `#${candidate.id}` : undefined,
        existingValue: existingVal,
        reason: "Preserved existing user input.",
      });
      continue;
    }

    // 3. Timed Native Input Execution
    const startTime = performance.now();
    try {
      const verifiedValue = await applyValueWithTimedEvents(
        candidate,
        val as string | number | boolean,
        {
          eventDelayMs: opts.eventDelayMs,
          scrollDelayMs: opts.scrollDelayMs,
          focusDelayMs: opts.focusDelayMs,
        },
      );

      const strVal = String(val);
      const verified =
        (candidate as HTMLInputElement).type === "checkbox"
          ? verifiedValue === String(Boolean(val))
          : verifiedValue.includes(strVal) || verifiedValue === strVal;

      const filledItem: FilledFieldResult = {
        key,
        field: (candidate as HTMLInputElement).name || candidate.id || key,
        selector: candidate.id ? `#${candidate.id}` : undefined,
        value: val as string | number | boolean,
        previousValue: existingVal,
        verified,
        verifiedValue,
        durationMs: Math.round(performance.now() - startTime),
      };

      fillResult.filled.push(filledItem);
      successfullyFilledElements.push(candidate);
      opts.onFieldFilled?.(filledItem);
    } catch (err) {
      fillResult.errors.push({
        key,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 4. Explicit User-Confirmation Gate for Final Submission
  if (successfullyFilledElements.length > 0 && opts.requireConfirmationBeforeSubmit) {
    const submitTrigger = findSubmitTrigger(successfullyFilledElements, root);
    if (submitTrigger) {
      const pendingData: PendingSubmissionData = {
        formSelector: submitTrigger.form?.id ? `#${submitTrigger.form.id}` : undefined,
        submitButtonSelector: submitTrigger.element.id ? `#${submitTrigger.element.id}` : undefined,
        submitButtonText: submitTrigger.text,
        fieldsFilledCount: fillResult.filled.length,
        timestamp: Date.now(),
        targetForm: submitTrigger.form,
        targetButton: submitTrigger.element,
      };

      fillResult.pendingSubmission = pendingData;
      opts.onRequiresConfirmation?.(pendingData);
    }
  }

  fillResult.summary = `Form fill complete: ${fillResult.filled.length} filled & verified, ${fillResult.preserved.length} preserved, ${fillResult.skipped.length} skipped, ${fillResult.errors.length} errors.`;

  return fillResult;
}

/**
 * Specialized useFormFiller hook:
 * - Sequentially validates field interactability
 * - Manages input events with proper timing for React/Vue/standard forms
 * - Preserves existing user data unless overwrite is requested
 * - Implements an explicit user-confirmation gate before any final submission
 * - Returns verified browser-side state updates
 */
export function useFormFiller(initialOptions?: UseFormFillerOptions) {
  const [isFilling, setIsFilling] = useState<boolean>(false);
  const [currentField, setCurrentField] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ current: number; total: number; percentage: number }>({
    current: 0,
    total: 0,
    percentage: 0,
  });
  const [results, setResults] = useState<FormFillResult | null>(null);
  const [requiresConfirmation, setRequiresConfirmation] = useState<boolean>(false);
  const [pendingSubmission, setPendingSubmission] = useState<PendingSubmissionData | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  /**
   * Sequentially fill form fields with validation, proper event timing, and verification.
   */
  const fillForm = useCallback(
    async (
      fields: Record<string, unknown>,
      optionsOverride?: Partial<UseFormFillerOptions>,
      container?: HTMLElement | Document,
    ): Promise<FormFillResult> => {
      setIsFilling(true);
      setRequiresConfirmation(false);
      setPendingSubmission(null);

      const fillResult = await executeFormFill(
        fields,
        {
          ...initialOptions,
          ...optionsOverride,
          onProgress: (field, cur, tot) => {
            setCurrentField(field);
            setProgress({
              current: cur,
              total: tot,
              percentage: Math.round((cur / tot) * 100),
            });
            (optionsOverride?.onProgress || initialOptions?.onProgress)?.(field, cur, tot);
          },
        },
        container,
      );

      if (fillResult.pendingSubmission) {
        setPendingSubmission(fillResult.pendingSubmission);
        setRequiresConfirmation(true);
      }

      setIsFilling(false);
      setCurrentField(null);
      setResults(fillResult);

      return fillResult;
    },
    [initialOptions],
  );

  /**
   * Explicitly confirm and execute the pending form submission.
   */
  const confirmSubmission = useCallback(async (): Promise<boolean> => {
    if (!pendingSubmission) return false;

    try {
      const { targetButton, targetForm } = pendingSubmission;

      if (targetButton && targetButton.isConnected) {
        targetButton.scrollIntoView({ behavior: "smooth", block: "center" });
        await sleep(50);
        targetButton.click();
      } else if (targetForm && targetForm.isConnected) {
        if (typeof targetForm.requestSubmit === "function") {
          targetForm.requestSubmit();
        } else {
          targetForm.submit();
        }
      }

      setRequiresConfirmation(false);
      setPendingSubmission(null);
      return true;
    } catch {
      return false;
    }
  }, [pendingSubmission]);

  /**
   * Cancel the pending submission.
   */
  const cancelSubmission = useCallback(() => {
    setRequiresConfirmation(false);
    setPendingSubmission(null);
  }, []);

  /**
   * Reset hook state.
   */
  const reset = useCallback(() => {
    setIsFilling(false);
    setCurrentField(null);
    setProgress({ current: 0, total: 0, percentage: 0 });
    setResults(null);
    setRequiresConfirmation(false);
    setPendingSubmission(null);
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  return {
    fillForm,
    validateFieldInteractability,
    isFilling,
    currentField,
    progress,
    results,
    requiresConfirmation,
    pendingSubmission,
    confirmSubmission,
    cancelSubmission,
    reset,
  };
}

export default useFormFiller;
