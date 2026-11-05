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
    ask(msg.question, msg.intent).then(reply, (e) => reply({ error: String(e?.message || e) }));
    return true;
  }
  if (msg.type === "SIGN_OUT") {
    chrome.storage.local.remove("session").then(() => reply({ ok: true }));
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
    highlightElement(msg.selector).then(reply, (e) =>
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

async function ask(question, intent) {
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

  try {
    const res = await fetch(`${apiBase}/api/public/extension/ask`, {
      method: "POST",
      headers,
      body: JSON.stringify({ question, intent: intent || "answer", snapshot }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 401 && session) {
      await chrome.storage.local.remove("session");
      // Retry once as guest
      return ask(question, intent);
    }
    if (!res.ok)
      return { error: "server", message: body.message || "Buddy could not finish that." };

    if (body.highlightSelector && tab?.id && snapshot) {
      chrome.scripting
        .executeScript({
          target: { tabId: tab.id },
          func: highlight,
          args: [body.highlightSelector],
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

// Injected into the page: outline one element for a few seconds.
function highlight(selector) {
  const el = document.querySelector(selector);
  if (!el) return false;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  const prev = el.style.outline;
  const prevOffset = el.style.outlineOffset;
  el.style.outline = "3px solid #14b8a6";
  el.style.outlineOffset = "3px";
  setTimeout(() => {
    el.style.outline = prev;
    el.style.outlineOffset = prevOffset;
  }, 6000);
  return true;
}

async function highlightElement(selector) {
  const tab = await activeTab();
  if (!tab?.id || !tab.url || RESTRICTED.test(tab.url)) {
    return { ok: false, message: "Cannot access this browser tab." };
  }
  const [res] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: highlight,
    args: [selector],
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
