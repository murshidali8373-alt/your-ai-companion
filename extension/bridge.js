// Runs only on the AI Buddy /connect page. Accepts the session from the page itself
// (same window, same origin) and hands it to the extension.
window.addEventListener("message", (e) => {
  if (e.source !== window || e.origin !== window.location.origin) return;
  const d = e.data;
  if (!d || d.type !== "AI_BUDDY_SESSION" || typeof d.accessToken !== "string") return;
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
