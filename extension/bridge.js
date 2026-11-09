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

  if (d.type !== "AI_BUDDY_SESSION" || typeof d.accessToken !== "string") return;
  // Security guard: Strict route check - only accept session synchronization on /connect
  const currentPath = window.location.pathname.replace(/\/+$/, "") || "/";
  if (currentPath !== "/connect") return;
  chrome.runtime.sendMessage(
    {
      type: "SAVE_SESSION",
      session: {
        apiBase: window.location.origin,
        accessToken: d.accessToken,
        refreshToken: d.refreshToken,
        expiresAt: d.expiresAt,
        email: d.email,
      },
    },
    (res) => {
      if (res && res.ok) window.postMessage({ type: "AI_BUDDY_EXT_ACK" }, window.location.origin);
    },
  );
});
