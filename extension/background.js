// Service worker: stores the session and talks to the AI Buddy backend.
const RESTRICTED = /^(chrome|edge|about|chrome-extension|devtools|view-source):|chromewebstore\.google\.com|chrome\.google\.com\/webstore/;

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
  return false;
});

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function ask(question, intent) {
  const { session } = await chrome.storage.local.get("session");
  if (!session) return { error: "signed_out", message: "Connect your account first." };

  const tab = await activeTab();
  let snapshot = null;
  if (tab?.id && tab.url && !RESTRICTED.test(tab.url)) {
    try {
      const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["snapshot.js"] });
      snapshot = res?.result ?? null;
    } catch {
      snapshot = null;
    }
  }

  const res = await fetch(`${session.apiBase}/api/public/extension/ask`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${session.accessToken}` },
    body: JSON.stringify({ question, intent: intent || "answer", snapshot }),
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) {
    await chrome.storage.local.remove("session");
    return { error: "signed_out", message: "Your sign-in expired. Please connect again." };
  }
  if (!res.ok) return { error: "server", message: body.message || "Buddy could not finish that." };

  if (body.highlightSelector && tab?.id && snapshot) {
    chrome.scripting
      .executeScript({ target: { tabId: tab.id }, func: highlight, args: [body.highlightSelector] })
      .catch(() => undefined);
  }
  return { ...body, pageReadable: Boolean(snapshot) };
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
