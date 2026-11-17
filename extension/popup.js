const $ = (id) => document.getElementById(id);
const DEFAULT_BASE = "https://ais-dev-asfavkynho62d5znlmqa5n-711254288483.asia-southeast1.run.app";
const LEGACY_BROKEN_HOST = "5t53lwemhepi2nbkqb2reo";

function normalizeBaseUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string" || rawUrl.includes(LEGACY_BROKEN_HOST)) {
    return DEFAULT_BASE;
  }
  return rawUrl;
}

async function render() {
  const { session } = await chrome.storage.local.get("session");
  $("signedOut").hidden = Boolean(session);
  $("signedIn").hidden = !session;
  if (session) $("who").textContent = `Signed in as ${session.email || "you"}`;
}

$("connect").onclick = async () => {
  const { lastBase, session } = await chrome.storage.local.get(["lastBase", "session"]);
  const targetBase = normalizeBaseUrl(session?.apiBase || lastBase);
  const resolvedBase = targetBase || DEFAULT_BASE;
  await chrome.storage.local.set({ lastBase: resolvedBase });

  try {
    const allTabs = await chrome.tabs.query({});
    let buddyTab = null;
    for (const t of allTabs) {
      if (!t.url) continue;
      try {
        const u = new URL(t.url);
        if (u.hostname.includes("aistudio.google.com") || u.hostname.includes(LEGACY_BROKEN_HOST)) {
          continue;
        }
        if (t.title?.includes("AI Buddy")) {
          buddyTab = t;
          break;
        }
        if (
          (u.hostname.includes("run.app") || u.hostname === "localhost" || u.hostname === "127.0.0.1") &&
          (await fetch(`${u.origin}/api/public/extension/health`).then((r) => r.ok).catch(() => false))
        ) {
          buddyTab = t;
          break;
        }
      } catch {}
    }

    if (buddyTab?.id && buddyTab.url) {
      const u = new URL(buddyTab.url);
      const tabOrigin = u.origin;
      await chrome.storage.local.set({ lastBase: tabOrigin });
      await chrome.tabs.update(buddyTab.id, { active: true });
      if (!u.pathname.startsWith("/connect")) {
        const connectUrl = new URL(`${tabOrigin}/connect`);
        if (session?.accessToken) {
          connectUrl.searchParams.set("ext_session", "active");
          if (session.email) connectUrl.searchParams.set("email", session.email);
        }
        connectUrl.searchParams.set("src", "extension_popup");
        await chrome.tabs.update(buddyTab.id, { url: connectUrl.toString() });
      }
      render();
      return;
    }
  } catch {}

  const connectUrl = new URL(`${resolvedBase}/connect`);
  if (session?.accessToken) {
    connectUrl.searchParams.set("ext_session", "active");
    if (session.email) connectUrl.searchParams.set("email", session.email);
  }
  connectUrl.searchParams.set("src", "extension_popup");

  try {
    await chrome.tabs.create({ url: connectUrl.toString() });
  } catch {}

  if (!session?.accessToken) {
    await chrome.storage.local.set({
      lastBase: resolvedBase,
      session: {
        email: "Guest User",
        isGuest: true,
        apiBase: resolvedBase,
      },
    });
  } else {
    await chrome.storage.local.set({ lastBase: resolvedBase });
  }
  render();
};

async function sendPopupRuntimeMessage(payload) {
  const traceId = `pop_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const envelope = { ...payload, __traceId: traceId };
  console.debug("[AI Buddy][Popup] outbound", { traceId, type: payload?.type });
  try {
    const res = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(envelope, (reply) => {
        const lastErr = chrome.runtime?.lastError;
        if (lastErr) {
          reject(new Error(lastErr.message || String(lastErr)));
          return;
        }
        resolve(reply);
      });
    });
    console.debug("[AI Buddy][Popup] response", { traceId, type: payload?.type, ok: Boolean(res?.ok || res?.reply) });
    return res;
  } catch (err) {
    console.error("[AI Buddy][Popup] sendMessage failed", {
      traceId,
      type: payload?.type,
      error: String(err?.message || err),
    });
    throw err;
  }
}

$("signout").onclick = async () => {
  await sendPopupRuntimeMessage({ type: "SIGN_OUT" }).catch(() => null);
  render();
};

let busy = false;
async function send(question, intent) {
  if (busy || !question.trim()) return;
  busy = true;
  $("send").disabled = true;
  $("status").textContent = "Reading the page and thinking…";
  $("answer").hidden = true;
  try {
    const res = await sendPopupRuntimeMessage({ type: "ASK", question, intent });
    if (res?.error) {
      $("status").textContent = res.message || "Something went wrong. Try again.";
      if (res.error === "signed_out") render();
      return;
    }
    $("answer").textContent = res?.reply?.answer || "No answer came back.";
    $("answer").hidden = false;
    const notes = [];
    if (!res?.pageReadable)
      notes.push("I could not read this page (browser-protected), so I answered generally.");
    if (res?.highlightSelector) notes.push("I outlined the element on the page.");
    $("status").textContent = notes.join(" ");
  } catch {
    $("status").textContent = "Buddy could not be reached. Check your connection.";
  } finally {
    busy = false;
    $("send").disabled = false;
  }
}

$("send").onclick = () => send($("q").value, "answer");
$("q").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    send($("q").value, "answer");
  }
});
document
  .querySelectorAll("[data-q]")
  .forEach((b) => (b.onclick = () => send(b.dataset.q, b.dataset.i)));
chrome.storage.local.get(["session", "lastBase"]).then(({ session, lastBase }) => {
  if (session?.apiBase) {
    const cleanBase = normalizeBaseUrl(session.apiBase);
    chrome.storage.local
      .set({
        lastBase: cleanBase,
        ...(cleanBase !== session.apiBase
          ? { session: { ...session, apiBase: cleanBase } }
          : {}),
      })
      .catch(() => {});
  } else if (lastBase && lastBase.includes(LEGACY_BROKEN_HOST)) {
    chrome.storage.local.set({ lastBase: DEFAULT_BASE }).catch(() => {});
  }
}).catch(() => {});
render();

if ($("openSidePanel")) {
  $("openSidePanel").onclick = async () => {
    try {
      if (chrome.sidePanel && typeof chrome.sidePanel.open === "function") {
        let [tab] = await chrome.tabs.query({
          active: true,
          windowType: "normal",
          lastFocusedWindow: true,
        });
        if (!tab) {
          [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        }
        if (tab?.id) {
          try {
            await chrome.sidePanel.open({ tabId: tab.id });
            window.close();
            return;
          } catch {}
        }
        if (tab?.windowId) {
          try {
            await chrome.sidePanel.open({ windowId: tab.windowId });
            window.close();
            return;
          } catch {}
        }
      }
    } catch {}
    await sendPopupRuntimeMessage({ type: "OPEN_SIDE_PANEL" }).catch(() => {});
    window.close();
  };
}
