// Injected on demand. Returns a bounded, privacy-filtered description of the active webpage.
// Values of password / card / OTP-like fields are strictly protected and never read.
(() => {
  const MAX_ELEMENTS = 100;
  const SENSITIVE = /pass|otp|pin|cvv|cvc|card|secret|token|ssn|aadhaar/i;
  let n = 0;

  const visible = (el) => {
    if (!el || el.nodeType !== 1) return false;
    const r = el.getBoundingClientRect();
    const s = window.getComputedStyle(el);
    return (
      (r.width > 0 || r.height > 0 || el.getClientRects().length > 0) &&
      s.visibility !== "hidden" &&
      s.display !== "none" &&
      s.opacity !== "0"
    );
  };

  const cssPath = (el) => {
    if (el.id && document.querySelectorAll(`#${CSS.escape(el.id)}`).length === 1) {
      return `#${CSS.escape(el.id)}`;
    }
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && parts.length < 6) {
      let p = cur.tagName.toLowerCase();
      if (cur.id && document.querySelectorAll(`#${CSS.escape(cur.id)}`).length === 1) {
        parts.unshift(`#${CSS.escape(cur.id)}`);
        break;
      }
      const parent = cur.parentElement;
      if (parent) {
        const same = [...parent.children].filter((c) => c.tagName === cur.tagName);
        if (same.length > 1) {
          p += `:nth-of-type(${same.indexOf(cur) + 1})`;
        }
      }
      parts.unshift(p);
      cur = parent;
    }
    return parts.join(" > ").slice(0, 400);
  };

  const labelOf = (el) => {
    // 1. aria-labelledby
    const labelledby = el.getAttribute("aria-labelledby");
    if (labelledby) {
      const parts = labelledby
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.innerText)
        .filter(Boolean);
      if (parts.length) return parts.join(" ");
    }
    // 2. aria-label
    const aria = el.getAttribute("aria-label");
    if (aria) return aria;

    // 3. label[for]
    if (el.id) {
      const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l) return l.innerText;
    }
    // 4. Closest label
    const wrap = el.closest("label");
    if (wrap) return wrap.innerText;

    // 5. Preceding sibling label or legend
    let prev = el.previousElementSibling;
    if (prev && (prev.tagName === "LABEL" || prev.tagName === "SPAN" || prev.tagName === "P")) {
      const prevText = prev.innerText?.trim();
      if (prevText && prevText.length < 80) return prevText;
    }

    // 6. Attributes
    return (
      el.getAttribute("placeholder") ||
      el.getAttribute("name") ||
      el.getAttribute("title") ||
      el.getAttribute("data-testid") ||
      el.innerText ||
      ""
    );
  };

  const item = (el, role, extra = {}) => {
    const r = el.getBoundingClientRect();
    return {
      ref: `e${++n}`,
      role,
      name: String(labelOf(el)).trim().replace(/\s+/g, " ").slice(0, 300),
      tag: el.tagName.toLowerCase(),
      selector: cssPath(el),
      rect: {
        x: Math.round(r.x),
        y: Math.round(r.y),
        top: Math.round(r.top),
        left: Math.round(r.left),
        width: Math.round(r.width),
        height: Math.round(r.height),
      },
      ...extra,
    };
  };

  // Helper to query all elements including within open shadow roots
  const queryAll = (selector, root = document) => {
    const results = [...root.querySelectorAll(selector)];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.shadowRoot) {
        results.push(...queryAll(selector, node.shadowRoot));
      }
    }
    return results;
  };

  const headings = queryAll("h1,h2,h3,h4,[role=heading]")
    .filter(visible)
    .slice(0, 50)
    .map((h) => {
      const lvl =
        Number(h.tagName[1]) ||
        Number(h.getAttribute("aria-level")) ||
        (h.tagName === "H4" ? 4 : 2);
      return item(h, "heading", { level: lvl });
    });

  const forms = queryAll(
    'input,textarea,select,[contenteditable="true"],[role=combobox],[role=textbox],[role=searchbox]',
  )
    .filter((el) => el.type !== "hidden" && visible(el))
    .slice(0, MAX_ELEMENTS)
    .map((el) => {
      const type = (el.type || "").toLowerCase();
      const sensitive =
        type === "password" || SENSITIVE.test(`${el.name} ${el.id} ${el.autocomplete}`);
      const role =
        el.tagName === "SELECT"
          ? "select"
          : el.tagName === "TEXTAREA"
            ? "textarea"
            : type === "checkbox"
              ? "checkbox"
              : type === "radio"
                ? "radio"
                : type === "file"
                  ? "file"
                  : el.getAttribute("role") === "combobox"
                    ? "combobox"
                    : "textbox";

      const isInvalid =
        el.getAttribute("aria-invalid") === "true" ||
        el.classList.contains("is-invalid") ||
        el.classList.contains("error") ||
        Boolean(el.closest(".error, .has-error"));

      const nearbyErrEl = el.getAttribute("aria-errormessage")
        ? document.getElementById(el.getAttribute("aria-errormessage"))
        : el.parentElement?.querySelector(
            ".invalid-feedback, .error, .text-danger, .error-message, .field-error",
          );
      const errMsg = nearbyErrEl?.innerText?.trim()?.slice(0, 200) || undefined;

      return item(el, role, {
        placeholder:
          (el.placeholder || el.getAttribute("placeholder") || "").slice(0, 200) || undefined,
        required: el.required || el.getAttribute("aria-required") === "true" || undefined,
        disabled: el.disabled || el.getAttribute("aria-disabled") === "true" || undefined,
        invalid: isInvalid || undefined,
        errorMessage: errMsg,
        sensitive: sensitive || undefined,
        value:
          sensitive || type === "file"
            ? undefined
            : String(el.value || el.innerText || "").slice(0, 300) || undefined,
        options:
          el.tagName === "SELECT"
            ? [...el.options].slice(0, 40).map((o) => o.text.slice(0, 120))
            : undefined,
      });
    });

  const controls = queryAll(
    "button,a[href],[role=button],[role=tab],[role=menuitem],input[type=button],input[type=submit],summary",
  )
    .filter(visible)
    .slice(0, MAX_ELEMENTS)
    .map((el) => item(el, el.tagName === "A" ? "link" : "button"));

  const alertSelectors = [
    "[role=alert]",
    "[aria-live=assertive]",
    ".error",
    ".has-error",
    ".text-danger",
    ".alert",
    "[aria-invalid=true]",
    ".invalid-feedback",
    ".error-message",
    ".form-error",
    ".notification-error",
  ].join(",");

  const alertElements = queryAll(alertSelectors).filter(visible).slice(0, 40);

  const alerts = alertElements.map((el) => {
    const isField = el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT";
    const textMsg =
      (isField
        ? el.getAttribute("aria-errormessage") || el.title || el.placeholder || ""
        : el.innerText) || "";
    return item(el, "alert", {
      errorMessage: textMsg.trim().replace(/\s+/g, " ").slice(0, 200) || undefined,
    });
  });

  const raw = (document.body?.innerText || "").replace(/\s+/g, " ");

  return {
    url: location.href.slice(0, 2000),
    origin: location.origin,
    title: document.title.slice(0, 400),
    capturedAt: new Date().toISOString(),
    readyState: document.readyState,
    headings,
    forms,
    controls,
    alerts,
    text: raw.slice(0, 8000),
    truncated: raw.length > 8000,
  };
})();
