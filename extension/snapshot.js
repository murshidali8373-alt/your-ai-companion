// Injected on demand. Returns a bounded, privacy-filtered description of the active webpage.
// Values of password / card / OTP-like fields are strictly protected and never read.
(() => {
  const MAX_ELEMENTS = 100;
  const SENSITIVE =
    /pass(?:word|wd)?|otp|\bpin\b|cvv|cvc|credit.?card|debit.?card|card.?number|secret|token|ssn|aadhaar/i;
  let n = 0;

  const inViewport = (el) => {
    const r = el.getBoundingClientRect();
    return (
      r.bottom >= 0 &&
      r.right >= 0 &&
      r.top <= (window.innerHeight || document.documentElement.clientHeight || 800) &&
      r.left <= (window.innerWidth || document.documentElement.clientWidth || 1200)
    );
  };

  const sortViewportFirst = (els) =>
    [...els].sort((a, b) => Number(inViewport(b)) - Number(inViewport(a)));

  const visible = (el) => {
    if (!el || el.nodeType !== 1) return false;
    const r = el.getBoundingClientRect();
    const s = window.getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden") return false;
    if (s.opacity === "0" || (r.width === 0 && r.height === 0 && el.getClientRects().length === 0)) {
      if (
        el.tagName === "INPUT" &&
        (el.type === "checkbox" || el.type === "radio")
      ) {
        const root = el.getRootNode?.() || document;
        const assocLabel =
          (el.id && root.querySelector?.(`label[for="${CSS.escape(el.id)}"]`)) ||
          el.closest("label");
        if (assocLabel && assocLabel !== el) {
          const lr = assocLabel.getBoundingClientRect();
          const ls = window.getComputedStyle(assocLabel);
          return (
            (lr.width > 0 || lr.height > 0) &&
            ls.visibility !== "hidden" &&
            ls.display !== "none" &&
            ls.opacity !== "0"
          );
        }
      }
      return false;
    }
    return true;
  };

  const cssPath = (el) => {
    const root = el.getRootNode?.() || document;
    const queryRoot = typeof root.querySelectorAll === "function" ? root : document;
    if (el.id && queryRoot.querySelectorAll(`#${CSS.escape(el.id)}`).length === 1) {
      return `#${CSS.escape(el.id)}`;
    }
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && parts.length < 6) {
      let p = cur.tagName.toLowerCase();
      const curRoot = cur.getRootNode?.() || document;
      const curQueryRoot = typeof curRoot.querySelectorAll === "function" ? curRoot : document;
      if (cur.id && curQueryRoot.querySelectorAll(`#${CSS.escape(cur.id)}`).length === 1) {
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
    const root = el.getRootNode?.() || document;
    const findById = (id) => root.getElementById?.(id) || document.getElementById(id);

    // 1. aria-labelledby
    const labelledby = el.getAttribute("aria-labelledby");
    if (labelledby) {
      const parts = labelledby
        .split(/\s+/)
        .map((id) => findById(id)?.innerText)
        .filter(Boolean);
      if (parts.length) return parts.join(" ");
    }
    // 2. aria-label
    const aria = el.getAttribute("aria-label");
    if (aria) return aria;

    // 3. label[for]
    if (el.id) {
      const l =
        root.querySelector?.(`label[for="${CSS.escape(el.id)}"]`) ||
        document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l) return l.innerText;
    }
    // 4. Closest label
    const wrap = el.closest("label");
    if (wrap) return wrap.innerText;

    // 5. Preceding sibling label or legend (guard against mismatched <label for="..."> on flat forms)
    const prev = el.previousElementSibling;
    if (
      prev &&
      (prev.tagName === "LABEL" || prev.tagName === "SPAN" || prev.tagName === "P") &&
      (!prev.htmlFor || prev.htmlFor === el.id)
    ) {
      const prevText = prev.innerText?.trim();
      if (prevText && prevText.length < 80) return prevText;
    }

    // 6. Attributes, image alt, button value & fallback labels
    const attrLabel =
      el.getAttribute("placeholder") ||
      el.getAttribute("data-placeholder") ||
      el.getAttribute("name") ||
      el.getAttribute("title") ||
      el.getAttribute("alt") ||
      (el.tagName === "INPUT" && ["button", "submit", "reset"].includes((el.type || "").toLowerCase())
        ? el.value
        : "") ||
      el.getAttribute("data-testid") ||
      el.querySelector?.("img[alt]")?.getAttribute("alt") ||
      el.querySelector?.("svg title")?.textContent;
    if (attrLabel) return attrLabel;

    const isCheckOrRadio =
      el.type === "checkbox" ||
      el.type === "radio" ||
      el.getAttribute?.("role") === "checkbox" ||
      el.getAttribute?.("role") === "radio" ||
      el.getAttribute?.("role") === "switch";
    if (el.nextElementSibling) {
      const next = el.nextElementSibling;
      const isMatchingNext =
        (next.tagName === "LABEL" && next.htmlFor && next.htmlFor === el.id) ||
        (isCheckOrRadio && (!next.htmlFor || next.htmlFor === el.id));
      if (isMatchingNext) {
        const nextText = next.innerText?.trim();
        if (nextText && nextText.length < 80) return nextText;
      }
    }

    return el.innerText || "";
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

  const forms = sortViewportFirst(
    queryAll(
      'input,textarea,select,[contenteditable="true"],[contenteditable=""],[contenteditable="plaintext-only"],[role=combobox],[role=textbox],[role=searchbox],[role=checkbox],[role=radio],[role=switch]',
    ).filter((el) => el.type !== "hidden" && visible(el)),
  )
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

      const errId = el.getAttribute("aria-errormessage");
      const elRoot = el.getRootNode?.() || document;
      const nearbyErrEl = errId
        ? elRoot.getElementById?.(errId) || document.getElementById(errId)
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

  const controls = sortViewportFirst(
    queryAll(
      "button,a[href],[role=button],[role=link],[role=tab],[role=menuitem],[role=option],[role=checkbox],[role=radio],[role=switch],input[type=button],input[type=submit],input[type=reset],input[type=checkbox],input[type=radio],summary",
    ).filter(visible),
  )
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

  // --- PAGE COMPLETENESS & VIEWPORT METRICS ---
  const docEl = document.documentElement || {};
  const docBody = document.body || {};
  const scrollTop = window.scrollY || docEl.scrollTop || docBody.scrollTop || 0;
  const scrollHeight = Math.max(
    docEl.scrollHeight || 0,
    docBody.scrollHeight || 0,
    window.innerHeight || 0,
  );
  const clientHeight = window.innerHeight || docEl.clientHeight || 0;
  const scrollPercent =
    scrollHeight > clientHeight
      ? Math.min(100, Math.round((scrollTop / (scrollHeight - clientHeight)) * 100))
      : 100;
  const hasMoreBelow = scrollHeight > scrollTop + clientHeight + 40;
  const hasMoreAbove = scrollTop > 40;

  const pageCompleteness = {
    scrollPercent,
    scrollTop: Math.round(scrollTop),
    scrollHeight: Math.round(scrollHeight),
    clientHeight: Math.round(clientHeight),
    hasMoreBelow,
    hasMoreAbove,
  };

  // --- PAGINATION DETECTION ---
  let pagination = null;
  try {
    const pagRoot = document.querySelector(
      '.pagination, [role="navigation"][aria-label*="pagin" i], [aria-label*="pagin" i], .page-numbers, .paginate, nav[aria-label="Pagination"]',
    );
    const pagTextMatch = (document.body?.innerText || "").match(
      /(?:page\s+(\d+)\s+of\s+(\d+)|showing\s+(\d+)[–-](\d+)\s+of\s+(\d+))/i,
    );

    const nextBtn = document.querySelector(
      'a[rel="next"], [aria-label*="next" i], button[aria-label*="next" i], .pagination .next, .next-page, a:not([disabled]):has(> [aria-label*="next" i])',
    );

    if (pagRoot || pagTextMatch || nextBtn) {
      pagination = {
        currentPage: pagTextMatch ? pagTextMatch[1] || pagTextMatch[3] : undefined,
        totalPages: pagTextMatch ? pagTextMatch[2] || pagTextMatch[5] : undefined,
        hasNextPage: Boolean(
          nextBtn &&
          !nextBtn.hasAttribute("disabled") &&
          nextBtn.getAttribute("aria-disabled") !== "true",
        ),
        pageIndicatorText: pagTextMatch
          ? pagTextMatch[0]
          : pagRoot
            ? pagRoot.innerText?.trim()?.slice(0, 100)
            : undefined,
      };
    }
  } catch {
    // Non-fatal
  }

  // --- SCROLLABLE CONTAINERS (MODALS, TABLES, SPLIT PANELS) ---
  const scrollableContainers = [];
  try {
    const candidates = queryAll(
      "table, tbody, div, section, ul, ol, main, [role=region], [role=dialog], [role=grid]",
    );
    for (const el of candidates) {
      if (scrollableContainers.length >= 8) break;
      if (!visible(el)) continue;
      const cs = window.getComputedStyle(el);
      if (
        cs.overflowY === "auto" ||
        cs.overflowY === "scroll" ||
        cs.overflow === "auto" ||
        cs.overflow === "scroll"
      ) {
        if (el.scrollHeight > el.clientHeight + 40) {
          scrollableContainers.push({
            selector: cssPath(el),
            tag: el.tagName.toLowerCase(),
            ariaLabel: el.getAttribute("aria-label") || undefined,
            scrollHeight: Math.round(el.scrollHeight),
            clientHeight: Math.round(el.clientHeight),
            canScrollDown: el.scrollHeight > el.scrollTop + el.clientHeight + 10,
          });
        }
      }
    }
  } catch {
    // Non-fatal
  }

  // --- DETERMINISTIC STATUS COUNTS (ELIMINATES ARITHMETIC HALLUCINATIONS) ---
  const statusCounts = {};
  const KNOWN_STATUSES = [
    "paused",
    "active",
    "pending qc",
    "qc pending",
    "under review",
    "rejected",
    "approved",
    "completed",
    "draft",
    "failed",
    "in progress",
    "processing",
    "live",
    "disabled",
    "enabled",
  ];

  try {
    const badgesAndCells = queryAll(
      ".badge, .status, .pill, [data-status], td, th, [role=cell], span.tag, span.chip, div.tag",
    ).filter(visible);

    for (const el of badgesAndCells) {
      const txt = (el.innerText || el.getAttribute("data-status") || "").trim().toLowerCase();
      if (!txt || txt.length > 35) continue;
      for (const st of KNOWN_STATUSES) {
        if (txt === st || txt.includes(st)) {
          statusCounts[st] = (statusCounts[st] || 0) + 1;
          break;
        }
      }
    }
  } catch {
    // Non-fatal
  }

  const raw = (document.body?.innerText || "").replace(/\s+/g, " ");

  const tables = [];
  try {
    const tableEls = queryAll("table").filter(visible).slice(0, 6);
    for (const tbl of tableEls) {
      const headerCells = [...tbl.querySelectorAll("thead th, thead td")].map((c) =>
        (c.innerText || "").trim().replace(/\s+/g, " ").slice(0, 100),
      );
      let rows = [];
      const bodyRows = tbl.querySelectorAll("tbody tr");
      const rowEls = bodyRows.length > 0 ? [...bodyRows] : [...tbl.querySelectorAll("tr")];
      for (const tr of rowEls.slice(0, 25)) {
        const cells = [...tr.querySelectorAll("th, td")].map((c) =>
          (c.innerText || "").trim().replace(/\s+/g, " ").slice(0, 160),
        );
        if (cells.some(Boolean) && !SENSITIVE.test(cells.join(" "))) {
          rows.push(cells);
        }
      }
      if (headerCells.length && rows.length && rows[0].join("|") === headerCells.join("|")) {
        rows = rows.slice(1);
      }
      if (headerCells.length || rows.length) {
        tables.push({ headers: headerCells, rows });
      }
    }
  } catch {
    // Non-fatal
  }

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
    tables,
    text: raw.slice(0, 8000),
    truncated: raw.length > 8000,
    pageCompleteness,
    pagination,
    scrollableContainers,
    statusCounts,
  };
})();
