// Signals AI Buddy extension presence to the web page
window.__AI_BUDDY_EXTENSION__ = true;
window.dispatchEvent(
  new CustomEvent("AI_BUDDY_EXTENSION_READY", { detail: { installed: true, version: "0.1.0" } }),
);

// Accepts presence ping or session synchronization
window.addEventListener("message", (e) => {
  if (e.source !== window || e.origin !== window.location.origin) return;
  const d = e.data;
  if (!d) return;

  if (d.type === "AI_BUDDY_PING") {
    window.__AI_BUDDY_EXTENSION__ = true;
    window.postMessage({ type: "AI_BUDDY_PONG", version: "0.1.0" }, window.location.origin);
    return;
  }

  if (d.type === "AI_BUDDY_OPEN_PANEL") {
    chrome.runtime.sendMessage({ type: "OPEN_SIDE_PANEL" });
    return;
  }

  if (d.type === "AI_BUDDY_SESSION" || d.type === "AI_BUDDY_GUEST_CONNECT") {
    // Security guard: Strict route check - only accept session synchronization on /connect
    const currentPath = window.location.pathname.replace(/\/+$/, "") || "/";
    if (currentPath !== "/connect") return;

    chrome.runtime.sendMessage(
      {
        type: "SAVE_SESSION",
        session: {
          apiBase: window.location.origin,
          accessToken: typeof d.accessToken === "string" ? d.accessToken : undefined,
          refreshToken: typeof d.refreshToken === "string" ? d.refreshToken : undefined,
          expiresAt: typeof d.expiresAt === "number" ? d.expiresAt : undefined,
          email: d.email || (d.type === "AI_BUDDY_GUEST_CONNECT" ? "Guest User" : undefined),
          isGuest: d.type === "AI_BUDDY_GUEST_CONNECT" || !d.accessToken,
        },
      },
      (res) => {
        if (res && res.ok) {
          window.postMessage(
            { type: "AI_BUDDY_EXT_ACK", isGuest: !d.accessToken },
            window.location.origin,
          );
        }
      },
    );
  }
});

// Proxy fetch handler for background worker when running under Cloud Run / auth bridge environments
if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "AI_BUDDY_PAGE_FETCH") {
      const { url, method = "GET", headers = {}, body } = msg;
      fetch(url, {
        method,
        headers,
        body: body ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
        credentials: "include",
      })
        .then(async (res) => {
          const text = await res.text();
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {}
          sendResponse({
            ok: res.ok,
            status: res.status,
            contentType: res.headers.get("content-type") || "",
            text,
            json,
          });
        })
        .catch((err) => {
          sendResponse({
            ok: false,
            status: 0,
            error: String(err?.message || err),
          });
        });
      return true; // Keep message channel open for async response
    }
    return false;
  });
}
