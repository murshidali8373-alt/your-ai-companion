// Service worker: stores the session and talks to the AI Buddy backend.
const RESTRICTED =
  /^(chrome|edge|about|chrome-extension|devtools|view-source):|chromewebstore\.google\.com|chrome\.google\.com\/webstore/;

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.type === "SAVE_SESSION") {
    const url = sender.url || "";
    if (!sender.tab || !msg.session.apiBase || !url.startsWith(msg.session.apiBase)) {
      reply({ ok: false });
      return;
    }
    chrome.storage.local.set({ session: msg.session }).then(() => reply({ ok: true }));
    return true;
  }
  if (msg.type === "ASK") {
    ask(msg.question, msg.intent, msg.history).then(reply, (e) =>
      reply({ error: String(e?.message || e) }),
    );
    return true;
  }
  if (msg.type === "SIGN_OUT") {
    conversationBuffer = [];
    chrome.storage.local
      .remove(["session", "conversationBuffer"])
      .then(() => reply({ ok: true }));
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
    highlightElement(msg.selector, msg.title, msg.description).then(reply, (e) =>
      reply({ ok: false, error: String(e?.message || e) }),
    );
    return true;
  }
  return false;
});

async function openSidePanel(sender) {
  if (chrome.sidePanel && typeof chrome.sidePanel.open === "function") {
    if (sender?.tab?.windowId) {
      await chrome.sidePanel.open({ windowId: sender.tab.windowId });
      return { ok: true };
    }
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.windowId) {
      await chrome.sidePanel.open({ windowId: tab.windowId });
      return { ok: true };
    }
  }
  return { ok: false, message: "Side panel not supported or tab not found" };
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

const DEFAULT_HOST = "https://id-preview--142f3fbd-6878-42b4-9fe5-1517e2fe8f28.lovable.app";

// Maintain a buffer of the last 3 turns of conversation
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

function getFormattedHistory(incomingHistory) {
  if (Array.isArray(incomingHistory) && incomingHistory.length > 0) {
    // Incoming history array: retain up to the last 3 turns (up to 6 messages)
    return incomingHistory.slice(-6);
  }
  // Otherwise use background buffer of the last 3 turns
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

async function ask(question, intent, history) {
  const { session } = await chrome.storage.local.get("session");
  const { lastBase } = await chrome.storage.local.get("lastBase");
  const apiBase = session?.apiBase || lastBase || "http://localhost:3000";

  const tab = await activeTab();
  let snapshot = null;
  if (tab?.id && tab.url && !RESTRICTED.test(tab.url)) {
    try {
      const [res] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["snapshot.js"],
      });
      snapshot = res?.result ?? null;
    } catch {
      snapshot = null;
    }
  }

  const headers = { "content-type": "application/json" };
  if (session?.accessToken) {
    headers["authorization"] = `Bearer ${session.accessToken}`;
  }

  // Ensure buffer of last 3 turns of conversation is sent as context
  const formattedHistory = getFormattedHistory(history);

  const payload = JSON.stringify({
    question,
    intent: intent || "answer",
    snapshot,
    history: formattedHistory.length > 0 ? formattedHistory : undefined,
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
      // If primary apiBase failed and is different from DEFAULT_HOST, try DEFAULT_HOST
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
      // Retry once as guest
      return ask(question, intent, history);
    }
    if (!res.ok)
      return { error: "server", message: body.message || "Buddy could not finish that." };

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

// Injected into the page: "Lamba Haath" — a telescoping arm that reaches from the
// side panel edge (right side of the viewport) to the target, with a pulse ring and
// a callout card. Self-contained (no closures) because it is serialized into the tab.
function highlight(selector, title, description) {
  const el = document.querySelector(selector);
  if (!el) return false;
  const ID = "ai-buddy-arm-overlay";
  document.getElementById(ID)?.remove();
  el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const host = document.createElement("div");
  host.id = ID;
  host.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647;";
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `
    <style>
      svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
      .arm{fill:none;stroke:url(#g);stroke-width:14;stroke-linecap:round;filter:drop-shadow(0 4px 10px rgba(13,148,136,.45))}
      .cuff{fill:none;stroke:rgba(255,255,255,.55);stroke-width:3;stroke-linecap:round;stroke-dasharray:2 18}
      .ring{position:absolute;border:3px solid #14b8a6;border-radius:12px;box-shadow:0 0 0 4px rgba(20,184,166,.25),0 0 24px rgba(20,184,166,.6)}
      .ring.pulse{animation:p 1.4s ease-out infinite}
      @keyframes p{0%{box-shadow:0 0 0 0 rgba(20,184,166,.6)}100%{box-shadow:0 0 0 18px rgba(20,184,166,0)}}
      .hand{position:absolute;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;
        background:radial-gradient(circle at 35% 30%,#fff,#e2e8f0 60%,#94a3b8);box-shadow:0 4px 12px rgba(0,0,0,.3);
        display:flex;align-items:center;justify-content:center;font-size:18px}
      .card{position:absolute;max-width:280px;padding:10px 12px;border-radius:12px;background:#0f172a;color:#f8fafc;
        font:500 13px/1.4 system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.35);border:1px solid rgba(20,184,166,.5);
        opacity:0;transform:translateY(6px);transition:opacity .3s ease,transform .3s ease}
      .card.show{opacity:1;transform:none}
      .card b{display:block;color:#5eead4;font-size:12px;margin-bottom:2px}
    </style>
    <svg><defs><linearGradient id="g" x1="1" x2="0"><stop offset="0" stop-color="#0d9488"/><stop offset="1" stop-color="#2dd4bf"/></linearGradient></defs>
      <path class="arm" id="arm"/><path class="cuff" id="cuff"/></svg>
    <div class="ring" id="ring"></div><div class="hand" id="hand">👉</div>
    <div class="card" id="card"></div>`;
  document.documentElement.appendChild(host);
  const $ = (id) => root.getElementById(id);
  const card = $("card");
  const safe = (t) => String(t || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  card.innerHTML = `<b>${safe(title || "Yahan dekhiye")}</b>${safe(description || "Buddy is pointing here.")}`;

  let progress = reduce ? 1 : 0;
  const start = performance.now();
  let frame = 0;
  const draw = () => {
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const ring = $("ring");
    ring.style.left = r.left - 6 + "px";
    ring.style.top = r.top - 6 + "px";
    ring.style.width = r.width + 12 + "px";
    ring.style.height = r.height + 12 + "px";
    const sx = vw + 10, sy = vh * 0.32;
    const tx = Math.min(vw - 20, r.right + 18), ty = r.top + r.height / 2;
    const cx = sx - (sx - tx) * 0.5, cy = Math.min(sy, ty) - 60;
    const ease = 1 - Math.pow(1 - progress, 3);
    const t = ease;
    const hx = (1 - t) * (1 - t) * sx + 2 * (1 - t) * t * cx + t * t * tx;
    const hy = (1 - t) * (1 - t) * sy + 2 * (1 - t) * t * cy + t * t * ty;
    const qx = sx + (cx - sx) * t, qy = sy + (cy - sy) * t;
    const d = `M${sx},${sy} Q${qx},${qy} ${hx},${hy}`;
    $("arm").setAttribute("d", d);
    $("cuff").setAttribute("d", d);
    const hand = $("hand");
    hand.style.left = hx + "px";
    hand.style.top = hy + "px";
    hand.style.transform = "scaleX(-1)";
    const cw = 280;
    let left = r.left;
    if (left + cw > vw - 10) left = vw - cw - 10;
    card.style.left = Math.max(10, left) + "px";
    const below = r.bottom + 14;
    card.style.top = (below + 90 < vh ? below : Math.max(10, r.top - 90)) + "px";
    if (progress >= 1) { ring.classList.add("pulse"); card.classList.add("show"); }
  };
  const tick = (now) => {
    if (!reduce) progress = Math.min(1, (now - start) / 650);
    draw();
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  setTimeout(() => {
    cancelAnimationFrame(frame);
    host.remove();
  }, 9000);
  return true;
}

async function highlightElement(selector, title, description) {
  const tab = await activeTab();
  if (!tab?.id || !tab.url || RESTRICTED.test(tab.url)) {
    return { ok: false, message: "Cannot access this browser tab." };
  }
  const [res] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: highlight,
    args: [selector, title || null, description || null],
  });
  return { ok: Boolean(res?.result) };
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
        return { ok: true, message: "Scrolled page" };
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
          el.value = val || "";
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }
        return { ok: true, message: "Filled input field safely" };
      }
      return { ok: false, message: `Unknown action: ${act}` };
    },
    args: [action, selector, value],
  });
  return res?.result || { ok: false };
}
