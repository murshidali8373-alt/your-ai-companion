// Service worker: manages sessions, tab tracking, page snapshots, connected arm pointing, and smart form-filling.
const RESTRICTED =
  /^(chrome|edge|about|chrome-extension|devtools|view-source):|chromewebstore\.google\.com|chrome\.google\.com\/webstore/;

const DEFAULT_HOST = "https://id-preview--142f3fbd-6878-42b4-9fe5-1517e2fe8f28.lovable.app";
const MAX_CONVERSATION_TURNS = 3;
let conversationBuffer = [];

// Initialize buffer from local storage
chrome.storage.local
  .get("conversationBuffer")
  .then((data) => {
    if (Array.isArray(data.conversationBuffer)) {
      conversationBuffer = data.conversationBuffer.slice(-MAX_CONVERSATION_TURNS);
    }
  })
  .catch(() => {});

// Tab change and activation listeners for reliable fresh page context
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    chrome.runtime
      .sendMessage({
        type: "TAB_CHANGED",
        tabId: activeInfo.tabId,
        url: tab?.url,
        title: tab?.title,
      })
      .catch(() => {});
  } catch {
    // Non-fatal
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" || changeInfo.url) {
    chrome.runtime
      .sendMessage({
        type: "TAB_UPDATED",
        tabId,
        url: tab.url,
        title: tab.title,
      })
      .catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.type === "SAVE_SESSION") {
    const url = sender.url || "";
    if (!sender.tab || !msg.session?.apiBase || !url.startsWith(msg.session.apiBase)) {
      reply({ ok: false });
      return;
    }
    chrome.storage.local.set({ session: msg.session }).then(() => reply({ ok: true }));
    return true;
  }
  if (msg.type === "ASK") {
    ask(msg.question, msg.intent, msg.history, msg.buddySlug, msg.customBuddyId).then(reply, (e) =>
      reply({ error: String(e?.message || e) }),
    );
    return true;
  }
  if (msg.type === "SIGN_OUT") {
    conversationBuffer = [];
    chrome.storage.local.remove(["session", "conversationBuffer"]).then(() => reply({ ok: true }));
    return true;
  }
  if (msg.type === "GET_CONVERSATION_BUFFER") {
    reply({ ok: true, buffer: conversationBuffer });
    return true;
  }
  if (msg.type === "OPEN_SIDE_PANEL") {
    openSidePanel(sender).then(reply, (e) => reply({ ok: false, error: String(e?.message || e) }));
    return true;
  }
  if (msg.type === "EXECUTE_ACTION") {
    executeAction(msg.action, msg.selector, msg.value).then(reply, (e) =>
      reply({ ok: false, error: String(e?.message || e) }),
    );
    return true;
  }
  if (msg.type === "HIGHLIGHT") {
    highlightElement(msg.selector, msg.title, msg.description, msg.buddyVisual).then(reply, (e) =>
      reply({ ok: false, error: String(e?.message || e) }),
    );
    return true;
  }
  if (msg.type === "SMART_FILL_FORM") {
    smartFillForm(msg.fields, msg.options).then(reply, (e) =>
      reply({ ok: false, error: String(e?.message || e) }),
    );
    return true;
  }
  if (msg.type === "GET_PAGE_SNAPSHOT") {
    getPageSnapshot().then(reply, (e) => reply({ ok: false, error: String(e?.message || e) }));
    return true;
  }
  return false;
});

// Configure Chrome Side Panel behavior
if (chrome.sidePanel?.setPanelBehavior) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
}

if (chrome.action?.onClicked) {
  chrome.action.onClicked.addListener(async (tab) => {
    if (chrome.sidePanel?.open) {
      if (tab?.id) {
        await chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
      } else if (tab?.windowId) {
        await chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
      }
    }
  });
}

async function openSidePanel(sender) {
  if (chrome.sidePanel && typeof chrome.sidePanel.open === "function") {
    if (sender?.tab?.id) {
      try {
        await chrome.sidePanel.open({ tabId: sender.tab.id });
        return { ok: true };
      } catch {}
    }
    const tab = await activeTab();
    if (tab?.id) {
      try {
        await chrome.sidePanel.open({ tabId: tab.id });
        return { ok: true };
      } catch {}
    }
    if (tab?.windowId) {
      try {
        await chrome.sidePanel.open({ windowId: tab.windowId });
        return { ok: true };
      } catch {}
    }
  }
  return { ok: false, message: "Side panel not supported or tab not found" };
}

/**
 * Robust active tab finder: queries last focused window first (critical when side panel is focused),
 * then falls back to current window, then any active tab.
 */
async function activeTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab && tab.id) return tab;
  } catch {}
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) return tab;
  } catch {}
  try {
    const [tab] = await chrome.tabs.query({ active: true });
    if (tab && tab.id) return tab;
  } catch {}
  return null;
}

function getFormattedHistory(incomingHistory) {
  if (Array.isArray(incomingHistory) && incomingHistory.length > 0) {
    return incomingHistory.slice(-6);
  }
  return conversationBuffer.slice(-MAX_CONVERSATION_TURNS).flatMap((turn) => {
    if (turn.role && turn.content) return [turn];
    if (turn.user && turn.assistant) {
      return [
        { role: "user", content: turn.user },
        { role: "assistant", content: turn.assistant },
      ];
    }
    return [];
  });
}

function recordTurn(userQuestion, assistantAnswer) {
  if (!userQuestion || !assistantAnswer) return;
  conversationBuffer.push({ user: userQuestion, assistant: assistantAnswer });
  if (conversationBuffer.length > MAX_CONVERSATION_TURNS) {
    conversationBuffer.shift();
  }
  chrome.storage.local.set({ conversationBuffer }).catch(() => {});
}

async function getPageSnapshot() {
  const tab = await activeTab();
  if (!tab?.id || !tab.url || RESTRICTED.test(tab.url)) {
    return {
      ok: false,
      message: "I cannot read the current webpage right now. Please refresh or allow page access.",
    };
  }
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["snapshot.js"],
    });
    if (res?.result) {
      return { ok: true, snapshot: res.result };
    }
    return {
      ok: false,
      message: "I cannot read the current webpage right now. Please refresh or allow page access.",
    };
  } catch (err) {
    return {
      ok: false,
      message: "I cannot read the current webpage right now. Please refresh or allow page access.",
    };
  }
}

async function ask(question, intent, history, buddySlug, customBuddyId) {
  const { session } = await chrome.storage.local.get("session");
  const { lastBase } = await chrome.storage.local.get("lastBase");
  const apiBase = session?.apiBase || lastBase || "http://localhost:3000";

  const tab = await activeTab();
  let snapshot = null;
  let snapshotError = null;

  if (tab?.id && tab.url && !RESTRICTED.test(tab.url)) {
    try {
      const [res] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["snapshot.js"],
      });
      snapshot = res?.result ?? null;
    } catch (err) {
      snapshotError = err;
      snapshot = null;
    }
  }

  const headers = { "content-type": "application/json" };
  if (session?.accessToken) {
    headers["authorization"] = `Bearer ${session.accessToken}`;
  }

  const formattedHistory = getFormattedHistory(history);

  const payload = JSON.stringify({
    question,
    intent: intent || "answer",
    snapshot,
    history: formattedHistory.length > 0 ? formattedHistory : undefined,
    buddySlug: buddySlug || undefined,
    customBuddyId: customBuddyId || undefined,
  });

  try {
    let res;
    try {
      res = await fetch(`${apiBase}/api/public/extension/ask`, {
        method: "POST",
        headers,
        body: payload,
      });
    } catch (networkErr) {
      if (apiBase !== DEFAULT_HOST) {
        res = await fetch(`${DEFAULT_HOST}/api/public/extension/ask`, {
          method: "POST",
          headers,
          body: payload,
        });
      } else {
        throw networkErr;
      }
    }

    const body = await res.json().catch(() => ({}));
    if (res.status === 401 && session) {
      await chrome.storage.local.remove("session");
      return ask(question, intent, history, buddySlug, customBuddyId);
    }
    if (!res.ok) {
      return { error: "server", message: body.message || "Buddy could not finish that." };
    }

    if (body.reply?.answer) {
      recordTurn(question, body.reply.answer);
    }

    if (body.highlightSelector && tab?.id && snapshot) {
      chrome.scripting
        .executeScript({
          target: { tabId: tab.id },
          func: highlight,
          args: [
            body.highlightSelector,
            body.calloutTitle || null,
            body.calloutDescription || null,
            { outfit: body.reply?.outfit || "teal", buddyName: body.buddyName || "Buddy" },
          ],
        })
        .catch(() => undefined);
    }
    return { ...body, pageReadable: Boolean(snapshot), snapshot };
  } catch {
    return {
      error: "network",
      message: "Could not reach AI Buddy service. Check your connection.",
    };
  }
}

/**
 * Connected Arm Highlighter:
 * Renders the authentic Buddy companion character anchored in its fixed position
 * on the right side of the page, matching the side panel. From Buddy's shoulder,
 * its anatomically connected arm (matching the selected Buddy's outfit sleeve and
 * pearl hand with extended pointing finger) extends with an organic natural curve
 * towards the target element, illuminates the element with a glowing pulse ring
 * and explanatory callout card, and then retracts back smoothly into the shoulder.
 */
function highlight(selector, title, description, options = {}) {
  const el = document.querySelector(selector);
  if (!el) return false;
  const ID = "ai-buddy-arm-overlay";
  document.getElementById(ID)?.remove();

  // Scroll element into view smoothly if not already fully visible
  el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const outfitColor =
    options?.outfit === "charcoal"
      ? "#334155"
      : options?.outfit === "blue"
        ? "#2563eb"
        : options?.outfit === "coral"
          ? "#ea580c"
          : options?.outfit === "sage"
            ? "#4d7c0f"
            : options?.outfit === "burgundy"
              ? "#831843"
              : options?.outfit === "lilac"
                ? "#9333ea"
                : "#0d9488"; // default teal

  const host = document.createElement("div");
  host.id = ID;
  host.style.cssText =
    "position:fixed;inset:0;pointer-events:none;z-index:2147483647;overflow:hidden;";
  const root = host.attachShadow({ mode: "closed" });

  root.innerHTML = `
    <style>
      svg.canvas { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
      .arm-sleeve { fill: none; stroke: ${outfitColor}; stroke-width: 14; stroke-linecap: round; filter: drop-shadow(0 4px 10px rgba(0,0,0,0.35)); }
      .arm-cuff { fill: none; stroke: #ffffff; stroke-width: 3.5; stroke-linecap: round; stroke-dasharray: 3 14; }
      .ring { position: absolute; border: 3px solid #14b8a6; border-radius: 10px; box-shadow: 0 0 0 4px rgba(20,184,166,0.25), 0 0 28px rgba(20,184,166,0.6); pointer-events: none; }
      .ring.pulse { animation: pulseAnim 1.4s ease-out infinite; }
      @keyframes pulseAnim { 0% { box-shadow: 0 0 0 0 rgba(20,184,166,0.65); } 100% { box-shadow: 0 0 0 18px rgba(20,184,166,0); } }
      .card { position: absolute; max-width: 290px; padding: 10px 14px; border-radius: 12px; background: #0f172a; color: #f8fafc; font: 500 12px/1.4 system-ui, -apple-system, sans-serif; box-shadow: 0 10px 30px rgba(0,0,0,0.45); border: 1px solid rgba(20,184,166,0.6); opacity: 0; transform: translateY(6px); transition: opacity .3s ease, transform .3s ease; pointer-events: auto; }
      .card.show { opacity: 1; transform: none; }
      .card b { display: block; color: #5eead4; font-size: 13px; margin-bottom: 2px; }
      .buddy-anchor { position: absolute; right: 12px; width: 72px; height: 86px; filter: drop-shadow(0 8px 18px rgba(0,0,0,0.5)); transition: transform 0.3s ease; }
    </style>
    <svg class="canvas">
      <defs>
        <filter id="handShadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="3" stdDeviation="3" flood-opacity="0.4" />
        </filter>
      </defs>
      <!-- Connected Arm Path (Sleeve + White Cuff) -->
      <path class="arm-sleeve" id="armPath" />
      <path class="arm-cuff" id="cuffPath" />
      <!-- Sculpted Connected Pearl Hand with Pointing Finger -->
      <g id="handGroup" filter="url(#handShadow)">
        <!-- Palm -->
        <circle cx="0" cy="0" r="8" fill="#f8fafc" stroke="#94a3b8" stroke-width="0.8" />
        <!-- Extended Pointing Index Finger -->
        <path d="M-4 -3 L-22 -1 Q-24 0 -22 1 L-4 3 Z" fill="#f8fafc" stroke="#94a3b8" stroke-width="0.8" />
        <!-- Curled Knuckles -->
        <ellipse cx="2" cy="-4" rx="4" ry="2.5" fill="#f1f5f9" stroke="#94a3b8" stroke-width="0.6" />
        <ellipse cx="3" cy="0" rx="4" ry="2.5" fill="#f1f5f9" stroke="#94a3b8" stroke-width="0.6" />
        <ellipse cx="2" cy="4" rx="4" ry="2.5" fill="#f1f5f9" stroke="#94a3b8" stroke-width="0.6" />
        <!-- Thumb resting inward -->
        <path d="M-1 -5 Q-4 -8 -6 -5 Q-4 -2 -1 -3 Z" fill="#f8fafc" stroke="#94a3b8" stroke-width="0.6" />
      </g>
    </svg>
    <!-- Target Element Highlight Pulse Ring -->
    <div class="ring" id="ring"></div>
    <!-- Explanatory Callout Card -->
    <div class="card" id="card"></div>
    <!-- Fixed Buddy Mascot Anchor on the right side of the screen -->
    <div class="buddy-anchor" id="buddyAnchor">
      <svg viewBox="0 0 100 105" width="100%" height="100%">
        <!-- Subtle shadow -->
        <ellipse cx="50" cy="95" rx="20" ry="4" fill="#000000" opacity="0.3" />
        <!-- Feet -->
        <ellipse cx="40" cy="88" rx="8" ry="4.5" fill="#f8fafc" stroke="#94a3b8" stroke-width="0.7" />
        <ellipse cx="61" cy="88" rx="8" ry="4.5" fill="#f8fafc" stroke="#94a3b8" stroke-width="0.7" />
        <!-- Body in active Buddy outfit -->
        <path d="M29 58Q22 65 25 82Q50 92 75 82Q79 65 70 58Z" fill="${outfitColor}" />
        <!-- Inner Shirt -->
        <path d="M43 59h15l-1 27H44Z" fill="#ffffff" />
        <!-- Pearl Head -->
        <path d="M64 9C43 5 23 26 23 41c0 14 12 22 27 22s27-8 27-22c0-11-7-20-16-25Z" fill="#f8fafc" stroke="#94a3b8" stroke-width="0.7" />
        <!-- Charcoal Eyes with gaze looking at element -->
        <g fill="#1e293b">
          <ellipse cx="38" cy="42" rx="2.4" ry="3.5" />
          <ellipse cx="59" cy="42" rx="2.4" ry="3.5" />
          <circle cx="37" cy="41" r="0.8" fill="#ffffff" />
          <circle cx="58" cy="41" r="0.8" fill="#ffffff" />
        </g>
        <!-- Smile -->
        <path d="M45 51 Q50 55 55 51" fill="none" stroke="#1e293b" stroke-width="1.2" stroke-linecap="round" />
      </svg>
    </div>
  `;

  document.documentElement.appendChild(host);

  const $ = (id) => root.getElementById(id);
  const card = $("card");
  const ring = $("ring");
  const armPath = $("armPath");
  const cuffPath = $("cuffPath");
  const handGroup = $("handGroup");
  const buddyAnchor = $("buddyAnchor");

  const safe = (t) =>
    String(t || "").replace(
      /[&<>"]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
    );

  card.innerHTML = `<b>${safe(title || "Yahan dekhiye")}</b>${safe(description || "Buddy is pointing right here.")}`;

  let progress = reduce ? 1 : 0;
  let isRetracting = false;
  const startTime = performance.now();
  let frame = 0;

  const updatePositions = () => {
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Position ring around target
    ring.style.left = `${Math.max(0, r.left - 6)}px`;
    ring.style.top = `${Math.max(0, r.top - 6)}px`;
    ring.style.width = `${r.width + 12}px`;
    ring.style.height = `${r.height + 12}px`;

    // Anchor Buddy near target vertical level or vertically centered
    const anchorY = Math.max(30, Math.min(vh - 120, r.top + r.height / 2 - 45));
    buddyAnchor.style.top = `${anchorY}px`;

    // Origin: Buddy's anatomical left shoulder on the page
    const shoulderX = vw - 12 - 48; // Left shoulder position within buddy anchor
    const shoulderY = anchorY + 54;

    // Target: right edge or center of the element with finger touch offset
    const targetX = Math.min(vw - 30, r.right + 8);
    const targetY = r.top + r.height / 2;

    // Organic natural curve: elbow bends naturally with slight curvature
    const midX = shoulderX - (shoulderX - targetX) * 0.5;
    const midY = Math.min(shoulderY, targetY) - 40;

    // Interpolate current hand coordinates based on progress
    const t = isRetracting ? 1 - progress : progress;
    const ease = 1 - Math.pow(1 - t, 3);

    // Quadratic / Cubic curve point computation
    const currentX =
      (1 - ease) * (1 - ease) * shoulderX + 2 * (1 - ease) * ease * midX + ease * ease * targetX;
    const currentY =
      (1 - ease) * (1 - ease) * shoulderY + 2 * (1 - ease) * ease * midY + ease * ease * targetY;

    // Control point for sleeve curve
    const ctrlX = shoulderX + (midX - shoulderX) * ease;
    const ctrlY = shoulderY + (midY - shoulderY) * ease;

    const pathData = `M ${shoulderX} ${shoulderY} Q ${ctrlX} ${ctrlY} ${currentX} ${currentY}`;
    armPath.setAttribute("d", pathData);
    cuffPath.setAttribute("d", pathData);

    // Calculate tangent angle so the hand and pointing finger angle naturally toward target
    const angleRad = Math.atan2(currentY - ctrlY, currentX - ctrlX);
    const angleDeg = (angleRad * 180) / Math.PI;

    // Position sculpted hand and rotate pointing finger toward element
    handGroup.setAttribute(
      "transform",
      `translate(${currentX.toFixed(2)}, ${currentY.toFixed(2)}) rotate(${angleDeg.toFixed(1)})`,
    );

    // Position explanatory callout card
    const cardWidth = 280;
    let cardLeft = r.left;
    if (cardLeft + cardWidth > vw - 20) cardLeft = vw - cardWidth - 20;
    card.style.left = `${Math.max(12, cardLeft)}px`;

    const belowPos = r.bottom + 14;
    card.style.top = `${belowPos + 80 < vh ? belowPos : Math.max(12, r.top - 85)}px`;

    if (t >= 0.98) {
      ring.classList.add("pulse");
      card.classList.add("show");
    }
  };

  const tick = (now) => {
    if (!reduce) {
      const elapsed = now - startTime;
      if (!isRetracting) {
        progress = Math.min(1, elapsed / 550);
      } else {
        progress = Math.min(1, elapsed / 450);
      }
    }
    updatePositions();
    frame = requestAnimationFrame(tick);
  };

  frame = requestAnimationFrame(tick);

  // Smooth retraction after 7.5 seconds
  setTimeout(() => {
    isRetracting = true;
    ring.classList.remove("pulse");
    card.classList.remove("show");
    setTimeout(() => {
      cancelAnimationFrame(frame);
      host.remove();
    }, 550);
  }, 7500);

  return true;
}

async function highlightElement(selector, title, description, buddyVisual) {
  const tab = await activeTab();
  if (!tab?.id || !tab.url || RESTRICTED.test(tab.url)) {
    return { ok: false, message: "Cannot access this browser tab." };
  }
  const [res] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: highlight,
    args: [selector, title || null, description || null, buddyVisual || {}],
  });
  return { ok: Boolean(res?.result) };
}

/**
 * Smart Form Filling Implementation:
 * Inspects form fields, matches provided information cleanly, fills supported fields
 * via native prototypes (compatible with React/Vue/standard forms), preserves existing
 * user values unless requested otherwise, verifies filled values in the DOM, and reports results.
 */
async function smartFillForm(fields, options = {}) {
  const tab = await activeTab();
  if (!tab?.id || !tab.url || RESTRICTED.test(tab.url)) {
    return { ok: false, message: "Cannot access this browser page for form filling." };
  }

  const [res] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (fieldsToFill, opts) => {
      const results = {
        filled: [],
        preserved: [],
        skipped: [],
        errors: [],
        pendingSubmission: null,
      };

      const SENSITIVE = /pass(?:word)?|pin|otp|cvv|cvc|secret|token|ssn|aadhaar|card|credit|debit/i;
      const SUBMIT_PATTERN =
        /submit|sign\s*in|log\s*in|proceed|confirm|continue|checkout|purchase|pay|place\s*order|delete|send/i;

      const normalize = (str) =>
        String(str || "")
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "");

      // Collect all candidate form inputs
      const elements = [
        ...document.querySelectorAll('input, textarea, select, [contenteditable="true"]'),
      ];

      const getFieldIdentifiers = (el) => {
        const identifiers = [
          el.name,
          el.id,
          el.placeholder,
          el.getAttribute("aria-label"),
          el.getAttribute("data-testid"),
        ].filter(Boolean);
        if (el.id) {
          try {
            const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
            if (l?.innerText) identifiers.push(l.innerText);
          } catch {
            // ignore
          }
        }
        const wrap = el.closest("label");
        if (wrap?.innerText) identifiers.push(wrap.innerText);
        const prev = el.previousElementSibling;
        if (prev && (prev.tagName === "LABEL" || prev.tagName === "SPAN") && prev.innerText) {
          identifiers.push(prev.innerText);
        }
        return identifiers.map(normalize);
      };

      const validateInteractability = (el) => {
        if (!el.isConnected) return { ok: false, reason: "Element not attached to DOM." };
        if (el.type === "hidden") return { ok: false, reason: "Hidden input field." };
        if (SENSITIVE.test(`${el.name} ${el.id} ${el.type}`)) {
          return { ok: false, reason: "Security block: password, OTP, or financial field." };
        }
        const style = window.getComputedStyle(el);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          parseFloat(style.opacity || "1") <= 0
        ) {
          return { ok: false, reason: "Element is hidden or invisible." };
        }
        if (style.pointerEvents === "none") {
          return { ok: false, reason: "Pointer events disabled." };
        }
        const r = el.getBoundingClientRect();
        if (r.width <= 0 && r.height <= 0) {
          return { ok: false, reason: "Element has zero dimensions." };
        }
        if (el.disabled) return { ok: false, reason: "Element is disabled." };
        if (el.readOnly && el.type !== "checkbox" && el.type !== "radio") {
          return { ok: false, reason: "Element is read-only." };
        }
        return { ok: true };
      };

      const successfullyFilled = [];

      for (const [key, val] of Object.entries(fieldsToFill || {})) {
        if (val === undefined || val === null) continue;
        const normKey = normalize(key);

        // Find candidate field on the page
        const candidate = elements.find((el) => {
          const ids = getFieldIdentifiers(el);
          return ids.some((id) => id.includes(normKey) || normKey.includes(id));
        });

        if (!candidate) {
          results.skipped.push({ key, value: val, reason: "Field not found on active page" });
          continue;
        }

        // 1. Sequential interactability check
        const check = validateInteractability(candidate);
        if (!check.ok) {
          results.skipped.push({ key, value: val, reason: check.reason });
          continue;
        }

        // 2. Preservation rule: if field already has a non-empty value and overwrite is not true, preserve it
        const currentVal = candidate.value || candidate.innerText || "";
        if (currentVal.trim() && !opts?.overwrite) {
          results.preserved.push({
            key,
            field: candidate.name || candidate.id || key,
            existingValue: currentVal,
            reason: "Preserved existing user input",
          });
          continue;
        }

        // 3. Sequential timed application with prototype setter
        try {
          candidate.scrollIntoView({ behavior: "smooth", block: "center" });
          candidate.focus();

          const strVal = String(val);
          if (candidate.tagName === "SELECT") {
            const opt = [...candidate.options].find(
              (o) =>
                normalize(o.value) === normKey ||
                normalize(o.text) === normalize(strVal) ||
                o.text.toLowerCase().includes(strVal.toLowerCase()),
            );
            if (opt) {
              candidate.value = opt.value;
            } else {
              candidate.value = strVal;
            }
          } else if (candidate.type === "checkbox") {
            candidate.checked = Boolean(val);
          } else if (candidate.type === "radio") {
            candidate.checked = true;
          } else if (candidate.getAttribute("contenteditable") === "true") {
            candidate.innerText = strVal;
          } else {
            const proto =
              candidate.tagName === "TEXTAREA"
                ? window.HTMLTextAreaElement.prototype
                : window.HTMLInputElement.prototype;
            const nativeSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
            if (nativeSetter) {
              nativeSetter.call(candidate, strVal);
            } else {
              candidate.value = strVal;
            }
          }

          candidate.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
          candidate.dispatchEvent(new Event("change", { bubbles: true }));
          candidate.blur();
          candidate.dispatchEvent(new Event("blur", { bubbles: true }));

          // Value verification check
          const verifiedValue = candidate.value || candidate.innerText || "";
          const verified =
            candidate.type === "checkbox"
              ? candidate.checked === Boolean(val)
              : verifiedValue.includes(strVal) || verifiedValue === strVal;

          results.filled.push({
            key,
            field: candidate.name || candidate.id || key,
            value: strVal,
            verified,
          });
          successfullyFilled.push(candidate);
        } catch (err) {
          results.errors.push({ key, error: String(err?.message || err) });
        }
      }

      // 4. Detect Submit Trigger for explicit confirmation gate
      if (successfullyFilled.length > 0) {
        for (const el of successfullyFilled) {
          const form = el.closest("form");
          const btn = form
            ? form.querySelector(
                'button[type="submit"], input[type="submit"], button:not([type="button"])',
              )
            : null;
          if (btn) {
            results.pendingSubmission = {
              submitButtonSelector: btn.id
                ? `#${btn.id}`
                : form?.id
                  ? `#${form.id} button[type="submit"]`
                  : 'button[type="submit"]',
              submitButtonText: btn.innerText || btn.value || "Submit Form",
              formSelector: form?.id ? `#${form.id}` : undefined,
            };
            break;
          }
        }

        if (!results.pendingSubmission) {
          const candidates = [...document.querySelectorAll('button, input[type="submit"]')];
          for (const btn of candidates) {
            const text = btn.innerText || btn.value || "";
            if (SUBMIT_PATTERN.test(text) || btn.type === "submit") {
              results.pendingSubmission = {
                submitButtonSelector: btn.id ? `#${btn.id}` : undefined,
                submitButtonText: text.trim() || "Submit",
              };
              break;
            }
          }
        }
      }

      return { ok: true, results };
    },
    args: [fields, options],
  });

  return res?.result || { ok: false, message: "Form filling execution failed." };
}

async function executeAction(action, selector, value) {
  const tab = await activeTab();
  if (!tab?.id || !tab.url || RESTRICTED.test(tab.url)) {
    return { ok: false, message: "Cannot act on this restricted browser page." };
  }
  const [res] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (act, sel, val) => {
      const el = sel ? document.querySelector(sel) : null;
      if (act === "scroll") {
        if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
        else window.scrollBy({ top: 350, behavior: "smooth" });
        return { ok: true, message: "Scrolled page smoothly" };
      }
      if (!el) return { ok: false, message: "Target element was not found on this page." };

      const SENSITIVE = /pass|otp|pin|cvv|cvc|card|secret|token|ssn|aadhaar/i;
      if (SENSITIVE.test(`${el.name} ${el.id} ${el.type}`)) {
        return {
          ok: false,
          message: "Action blocked: Buddy never types into password or financial fields.",
        };
      }

      if (act === "click") {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.click();
        return { ok: true, message: `Clicked ${el.tagName.toLowerCase()} element` };
      }
      if (act === "type") {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.focus();
        if ("value" in el) {
          const proto =
            el.tagName === "TEXTAREA"
              ? window.HTMLTextAreaElement.prototype
              : window.HTMLInputElement.prototype;
          const nativeSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
          if (nativeSetter) {
            nativeSetter.call(el, val || "");
          } else {
            el.value = val || "";
          }
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          el.dispatchEvent(new Event("blur", { bubbles: true }));
        }
        return { ok: true, message: "Filled input field safely" };
      }
      return { ok: false, message: `Unknown action: ${act}` };
    },
    args: [action, selector, value],
  });
  return res?.result || { ok: false };
}
