// Injected on demand. Returns a bounded, privacy-filtered description of the active webpage.
// Values of password / card / OTP-like fields are strictly protected and never read.
(() => {
  const MAX_ELEMENTS = 100;
  const SENSITIVE =
    /pass(?:word|wd)?|otp|(?<!postal[\s_-])(?<![a-z0-9])pin(?![a-z0-9]|[\s_-]*code\b)|cvv|cvc|credit.?card|debit.?card|card.?number|secret|token|ssn|aadhaar/i;
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

  const localCssPath = (el, root) => {
    const queryRoot = root && typeof root.querySelectorAll === "function" ? root : document;
    if (el.id) {
      try {
        if (queryRoot.querySelectorAll(`#${CSS.escape(el.id)}`).length === 1) {
          return `#${CSS.escape(el.id)}`;
        }
      } catch {}
    }
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && cur !== root && parts.length < 6) {
      let p = cur.tagName.toLowerCase();
      if (cur.id) {
        try {
          if (queryRoot.querySelectorAll(`#${CSS.escape(cur.id)}`).length === 1) {
            parts.unshift(`#${CSS.escape(cur.id)}`);
            break;
          }
        } catch {}
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
    return parts.join(" > ");
  };

  const cssPath = (el) => {
    const chain = [];
    let curEl = el;
    while (curEl && curEl.nodeType === 1) {
      const root = curEl.getRootNode?.() || document;
      chain.unshift(localCssPath(curEl, root));
      if (root && root !== document && root.host) {
        curEl = root.host;
      } else {
        break;
      }
    }
    return chain.join(" >>> ").slice(0, 500);
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

    // 5b. Container field-group label / legend / preceding table cell (when wrapper holds a single control)
    const fieldGroup = el.closest?.(".form-group, .field, .form-field, .input-group, fieldset");
    if (fieldGroup) {
      const groupControls = fieldGroup.querySelectorAll?.(
        'input:not([type="hidden"]), textarea, select, [contenteditable="true"], [role="textbox"], [role="searchbox"], [role="combobox"]',
      );
      if (!groupControls || groupControls.length <= 1) {
        const grpLabel = fieldGroup.querySelector?.("label, legend, .label, .field-label, .form-label");
        const grpTxt = grpLabel?.innerText?.trim();
        if (grpTxt && grpTxt.length < 80 && (!grpLabel.htmlFor || grpLabel.htmlFor === el.id)) {
          return grpTxt;
        }
      }
    }
    const td = el.closest?.("td");
    if (td && td.previousElementSibling) {
      const cellTxt = td.previousElementSibling.innerText?.trim();
      if (cellTxt && cellTxt.length < 80) return cellTxt;
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
      tag: el.tagName.toLowerCase().slice(0, 80),
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
        Boolean(el.closest(".error, .has-error")) ||
        (typeof el.matches === "function" &&
          (() => {
            try {
              return el.matches(":user-invalid");
            } catch {
              return false;
            }
          })());

      const errId = el.getAttribute("aria-errormessage");
      const elRoot = el.getRootNode?.() || document;
      const nearbyErrEl = errId
        ? elRoot.getElementById?.(errId) || document.getElementById(errId)
        : el.parentElement?.querySelector(
            ".invalid-feedback, .error, .text-danger, .error-message, .field-error",
          );
      const errMsg =
        (
          nearbyErrEl?.innerText?.trim() ||
          nearbyErrEl?.textContent?.trim() ||
          (isInvalid ? el.validationMessage?.trim() : "") ||
          ""
        ).slice(0, 200) || undefined;

      return item(el, role, {
        inputType: type || el.getAttribute("role") || undefined,
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
  const seenAlertKeys = new Set();
  const alerts = [];

  for (const el of alertElements) {
    const isField = el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT";
    let textMsg = "";
    if (isField) {
      const errId = el.getAttribute("aria-errormessage");
      const elRoot = el.getRootNode?.() || document;
      const errRef = errId ? elRoot.getElementById?.(errId) || document.getElementById(errId) : null;
      const nearby = el.parentElement?.querySelector?.(
        ".invalid-feedback, .error, .text-danger, .error-message, .field-error",
      );
      textMsg =
        errRef?.innerText ||
        errRef?.textContent ||
        nearby?.innerText ||
        el.validationMessage ||
        el.title ||
        labelOf(el) ||
        "";
    } else {
      textMsg = el.innerText || el.textContent || el.getAttribute("aria-label") || "";
    }
    const cleanMsg = String(textMsg || "").trim().replace(/\s+/g, " ").slice(0, 200);
    // Ignore empty live-region/alert placeholders (common in React/ChatGPT/SPAs)
    if (!cleanMsg) continue;
    const dedupKey = `${isField ? cssPath(el) : ""}|${cleanMsg.toLowerCase()}`;
    if (seenAlertKeys.has(dedupKey)) continue;
    seenAlertKeys.add(dedupKey);
    alerts.push(
      item(el, "alert", {
        errorMessage: cleanMsg,
      }),
    );
  }

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
    const prevBtn = document.querySelector(
      'a[rel="prev"], [aria-label*="prev" i], button[aria-label*="prev" i], .pagination .prev, .prev-page',
    );
    const lastBtn = document.querySelector(
      '[aria-label*="last" i], .pagination .last, .last-page',
    );

    if (pagRoot || pagTextMatch || nextBtn || prevBtn) {
      pagination = {
        currentPage: pagTextMatch ? pagTextMatch[1] || pagTextMatch[3] : undefined,
        totalPages: pagTextMatch ? pagTextMatch[2] || pagTextMatch[5] : undefined,
        hasNextPage: Boolean(
          nextBtn &&
          !nextBtn.hasAttribute("disabled") &&
          nextBtn.getAttribute("aria-disabled") !== "true",
        ),
        hasPrevPage: Boolean(
          prevBtn &&
          !prevBtn.hasAttribute("disabled") &&
          prevBtn.getAttribute("aria-disabled") !== "true",
        ),
        nextSelector: nextBtn ? cssPath(nextBtn) : undefined,
        prevSelector: prevBtn ? cssPath(prevBtn) : undefined,
        lastSelector: lastBtn ? cssPath(lastBtn) : undefined,
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
            scrollWidth: Math.round(el.scrollWidth),
            clientWidth: Math.round(el.clientWidth),
            canScrollDown: el.scrollHeight > el.scrollTop + el.clientHeight + 10,
            canScrollRight: el.scrollWidth > el.scrollLeft + el.clientWidth + 10,
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

  // --- VIEWPORT TELEMETRY & PHASE 2 UI INTELLIGENCE ---
  const viewport = {
    width: Math.round(window.visualViewport?.width || window.innerWidth || docEl.clientWidth || 1280),
    height: Math.round(window.visualViewport?.height || window.innerHeight || docEl.clientHeight || 720),
    devicePixelRatio: Number((window.devicePixelRatio || 1).toFixed(2)),
    scrollX: Math.round(window.scrollX || docEl.scrollLeft || 0),
    scrollY: Math.round(scrollTop),
    zoomScale: Number((window.visualViewport?.scale || 1).toFixed(2)),
  };

  const modals = [];
  try {
    for (const m of queryAll('[role="dialog"], [aria-modal="true"], .modal.show, .modal-dialog').filter(visible).slice(0, 4)) {
      const heading = m.querySelector("h1,h2,h3,h4,[role='heading'],.modal-title");
      modals.push({
        title: (heading?.innerText || m.getAttribute("aria-label") || "Dialog").trim().slice(0, 120),
        selector: cssPath(m),
        isBlocking: m.getAttribute("aria-modal") === "true" || /modal|dialog/i.test(m.className || ""),
        textPreview: (m.innerText || "").trim().replace(/\s+/g, " ").slice(0, 160),
      });
    }
  } catch {}

  const loadingIndicators = [];
  try {
    for (const sp of queryAll('[aria-busy="true"], [role="progressbar"], .spinner, .loading, .skeleton').filter(visible).slice(0, 5)) {
      loadingIndicators.push((sp.getAttribute("aria-label") || sp.innerText || sp.className || "loading").toString().trim().slice(0, 60));
    }
  } catch {}

  const disabledSubmits = controls
    .filter((c) => c.disabled && c.role === "button" && /submit|save|checkout|pay|continue|next/i.test(c.name || ""))
    .map((c) => c.name || c.selector);

  const customDropdowns = [];
  try {
    const ddEls = queryAll('[role="combobox"], [role="listbox"], .ant-select, .MuiSelect-select, [class*="react-select"]').filter(visible).slice(0, 12);
    for (const dd of ddEls) {
      const cls = String(dd.className || "");
      const framework = cls.includes("ant-select")
        ? "antd"
        : cls.includes("Mui")
          ? "mui"
          : cls.includes("react-select")
            ? "react_select"
            : dd.getAttribute("role") === "listbox"
              ? "aria_listbox"
              : "aria_combobox";
      customDropdowns.push({
        name: (dd.getAttribute("aria-label") || dd.innerText || dd.id || "Dropdown").trim().slice(0, 80),
        selector: cssPath(dd),
        framework,
        isMulti: dd.getAttribute("aria-multiselectable") === "true" || cls.includes("multiple"),
        currentValue: (dd.getAttribute("data-selected-value") || dd.value || dd.innerText || "").trim().slice(0, 80),
      });
    }
  } catch {}

  const richTextEditors = [];
  try {
    const rteEls = queryAll('.ProseMirror, .ql-editor, .mce-content-body, [contenteditable="true"]').filter(visible).slice(0, 6);
    for (const rte of rteEls) {
      const cls = String(rte.className || "");
      const editorType = cls.includes("ProseMirror")
        ? "prosemirror"
        : cls.includes("ql-editor")
          ? "quill"
          : cls.includes("mce-content-body")
            ? "tinymce"
            : "contenteditable";
      richTextEditors.push({
        name: (rte.getAttribute("aria-label") || rte.getAttribute("placeholder") || rte.id || "Editor").trim().slice(0, 80),
        selector: cssPath(rte),
        editorType,
        textPreview: (rte.innerText || "").trim().slice(0, 120),
      });
    }
  } catch {}

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
    viewport,
    modals,
    loadingIndicators,
    disabledSubmits,
    customDropdowns,
    richTextEditors,
  };
})();
