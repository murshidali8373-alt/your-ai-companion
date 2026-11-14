// Signals AI Buddy extension presence to the web page
window.__AI_BUDDY_EXTENSION__ = true;
window.dispatchEvent(
  new CustomEvent("AI_BUDDY_EXTENSION_READY", { detail: { installed: true, version: "0.1.0" } }),
);

if (!window.__AI_BUDDY_BRIDGE_BOUND__) {
  window.__AI_BUDDY_BRIDGE_BOUND__ = true;

  const sanitizeLogUrl = (rawUrl) => {
    try {
      const u = new URL(String(rawUrl));
      return `${u.origin}${u.pathname}`;
    } catch {
      return "invalid-url";
    }
  };

  const bridgeLog = (level, event, detail = {}) => {
    try {
      const logger = console[level] || console.info;
      logger("[AI Buddy][Bridge]", {
        ts: new Date().toISOString(),
        event,
        frame: window.top === window ? "top" : "subframe",
        path: window.location.pathname,
        ...detail,
      });
    } catch {}
  };

  const sendToRuntimeSafe = (payload, eventName, onAck) => {
    try {
      if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
        bridgeLog("warn", `${eventName}:runtime_unavailable`);
        return;
      }
      bridgeLog("debug", `${eventName}:outbound`, { type: payload?.type });
      chrome.runtime.sendMessage(payload, (res) => {
        const lastErr = chrome.runtime?.lastError;
        if (lastErr) {
          bridgeLog("error", `${eventName}:last_error`, {
            type: payload?.type,
            error: lastErr.message || String(lastErr),
          });
          return;
        }
        bridgeLog("debug", `${eventName}:ack`, {
          type: payload?.type,
          ok: Boolean(res?.ok),
          error: res?.error || undefined,
        });
        if (typeof onAck === "function") onAck(res);
      });
    } catch (err) {
      bridgeLog("error", `${eventName}:context_error`, {
        type: payload?.type,
        error: String(err?.message || err),
      });
    }
  };

  // Accepts presence ping or session synchronization
  window.addEventListener("message", (e) => {
    if (e.source !== window || e.origin !== window.location.origin) return;
    const d = e.data;
    if (!d || typeof d !== "object") return;

    if (d.type === "AI_BUDDY_PING") {
      window.__AI_BUDDY_EXTENSION__ = true;
      window.postMessage({ type: "AI_BUDDY_PONG", version: "0.1.0" }, window.location.origin);
      bridgeLog("debug", "page_ping_pong");
      return;
    }

    if (d.type === "AI_BUDDY_OPEN_PANEL") {
      sendToRuntimeSafe({ type: "OPEN_SIDE_PANEL" }, "open_panel");
      return;
    }

    if (d.type === "AI_BUDDY_SESSION" || d.type === "AI_BUDDY_GUEST_CONNECT") {
      // Security guard: Strict route check - only accept session synchronization on /connect
      const currentPath = window.location.pathname.replace(/\/+$/, "") || "/";
      if (currentPath !== "/connect") return void bridgeLog("warn", "session_sync:rejected_route", { currentPath });

      sendToRuntimeSafe(
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
        "save_session",
        (res) => {
          if (res && res.ok) {
            window.postMessage(
              { type: "AI_BUDDY_EXT_ACK", isGuest: !d.accessToken },
              window.location.origin,
            );
          } else {
            bridgeLog("warn", "save_session:rejected_by_sw", {
              error: res?.error || "no_response",
            });
          }
        },
      );
    }
  });

  // Proxy fetch handler for background worker when running under Cloud Run / auth bridge environments
  if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (!msg || typeof msg !== "object" || typeof msg.type !== "string") {
        bridgeLog("warn", "runtime_msg:invalid_payload");
        return false;
      }

      bridgeLog("debug", "runtime_msg:received", {
        type: msg.type,
        traceId: msg.__traceId || undefined,
        senderId: sender?.id || undefined,
      });

      if (msg.type === "AI_BUDDY_PAGE_FETCH") {
        const { url, method = "GET", headers = {}, body, __traceId } = msg;
        const startedAt = Date.now();
        const targetSummary = sanitizeLogUrl(url);
        let settled = false;
        const safeRespond = (payload) => {
          if (settled) return;
          settled = true;
          try {
            sendResponse(payload);
          } catch (err) {
            bridgeLog("warn", "page_fetch:sendResponse_failed", {
              traceId: __traceId,
              target: targetSummary,
              error: String(err?.message || err),
            });
          }
        };

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
            bridgeLog("debug", "page_fetch:completed", {
              traceId: __traceId,
              target: targetSummary,
              status: res.status,
              ok: res.ok,
              elapsedMs: Date.now() - startedAt,
            });
            safeRespond({
              ok: res.ok,
              status: res.status,
              contentType: res.headers.get("content-type") || "",
              text,
              json,
            });
          })
          .catch((err) => {
            const errMsg = String(err?.message || err);
            bridgeLog("error", "page_fetch:failed", {
              traceId: __traceId,
              target: targetSummary,
              elapsedMs: Date.now() - startedAt,
              error: errMsg,
            });
            safeRespond({
              ok: false,
              status: 0,
              error: errMsg,
            });
          });
        return true; // Keep message channel open for async response
      }

      bridgeLog("debug", "runtime_msg:ignored", { type: msg.type, traceId: msg.__traceId });
      return false;
    });
  }
}
