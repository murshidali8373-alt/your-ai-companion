// Injected on demand. Returns a bounded, privacy-filtered description of the page.
// Values of password / card / OTP-like fields are never read.
(() => {
  const MAX = 60;
  const SENSITIVE = /pass|otp|pin|cvv|cvc|card|secret|token|ssn|aadhaar/i;
  let n = 0;
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
  };
  const cssPath = (el) => {
    if (el.id && document.querySelectorAll(`#${CSS.escape(el.id)}`).length === 1)
      return `#${CSS.escape(el.id)}`;
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && parts.length < 6) {
      let p = cur.tagName.toLowerCase();
      const parent = cur.parentElement;
      if (parent) {
        const same = [...parent.children].filter((c) => c.tagName === cur.tagName);
        if (same.length > 1) p += `:nth-of-type(${same.indexOf(cur) + 1})`;
      }
      parts.unshift(p);
      if (cur.id) {
        parts[0] = `#${CSS.escape(cur.id)}`;
        break;
      }
      cur = parent;
    }
    return parts.join(" > ").slice(0, 400);
  };
  const labelOf = (el) => {
    const aria = el.getAttribute("aria-label");
    if (aria) return aria;
    if (el.id) {
      const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l) return l.innerText;
    }
    const wrap = el.closest("label");
    if (wrap) return wrap.innerText;
    return el.getAttribute("name") || el.getAttribute("title") || el.innerText || "";
  };
  const item = (el, role, extra = {}) => ({
    ref: `e${++n}`,
    role,
    name: String(labelOf(el)).trim().replace(/\s+/g, " ").slice(0, 300),
    tag: el.tagName.toLowerCase(),
    selector: cssPath(el),
    ...extra,
  });

  const headings = [...document.querySelectorAll("h1,h2,h3")]
    .filter(visible)
    .slice(0, MAX)
    .map((h) => item(h, "heading", { level: Number(h.tagName[1]) }));

  const forms = [...document.querySelectorAll("input,textarea,select")]
    .filter((el) => el.type !== "hidden" && visible(el))
    .slice(0, MAX)
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
                  : "textbox";
      return item(el, role, {
        placeholder: (el.placeholder || "").slice(0, 200) || undefined,
        required: el.required || undefined,
        disabled: el.disabled || undefined,
        invalid: el.getAttribute("aria-invalid") === "true" || undefined,
        sensitive: sensitive || undefined,
        value:
          sensitive || type === "file"
            ? undefined
            : String(el.value || "").slice(0, 300) || undefined,
        options:
          el.tagName === "SELECT"
            ? [...el.options].slice(0, 40).map((o) => o.text.slice(0, 120))
            : undefined,
      });
    });

  const controls = [...document.querySelectorAll("button,a[href],[role=button]")]
    .filter(visible)
    .slice(0, MAX)
    .map((el) => item(el, el.tagName === "A" ? "link" : "button"));

  const alerts = [...document.querySelectorAll("[role=alert],[aria-live=assertive],.error,.alert")]
    .filter(visible)
    .slice(0, 40)
    .map((el) => item(el, "alert"));

  const raw = (document.body?.innerText || "").replace(/\s+/g, " ");
  return {
    url: location.href.slice(0, 2000),
    origin: location.origin,
    title: document.title.slice(0, 400),
    capturedAt: new Date().toISOString(),
    headings,
    forms,
    controls,
    alerts,
    text: raw.slice(0, 6000),
    truncated: raw.length > 6000,
  };
})();
