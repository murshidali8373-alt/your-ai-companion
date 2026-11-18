// Service worker: manages sessions, tab tracking, page snapshots, connected arm pointing, and smart form-filling.
const RESTRICTED =
  /^(chrome|edge|about|chrome-extension|devtools|view-source):|chromewebstore\.google\.com|chrome\.google\.com\/webstore/;

const DEFAULT_HOST = "https://ais-dev-asfavkynho62d5znlmqa5n-711254288483.asia-southeast1.run.app";
const FALLBACK_PRE_HOST = "https://ais-pre-asfavkynho62d5znlmqa5n-711254288483.asia-southeast1.run.app";
const LEGACY_BROKEN_HOST = "5t53lwemhepi2nbkqb2reo";
const MAX_CONVERSATION_TURNS = 3;
let conversationBuffer = [];

// --- STRUCTURED COMMUNICATION DIAGNOSTIC LOGGER & RING BUFFER ---
const MAX_COMM_LOGS = 120;
const commLogBuffer = [];
let commTraceSeq = 0;

function sanitizeUrlForLog(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return "";
  try {
    const u = new URL(rawUrl);
    if (RESTRICTED.test(rawUrl)) return `${u.protocol}//${u.host || ""}`;
    return `${u.origin}${u.pathname}`;
  } catch {
    return "unparseable-url";
  }
}

function summarizeMessagePayload(msg) {
  if (!msg || typeof msg !== "object") return { invalid: typeof msg };
  const summary = {
    type: msg.type,
    traceId: msg.__traceId || undefined,
  };
  if (msg.action) summary.action = msg.action;
  if (msg.selector) summary.selector = String(msg.selector).slice(0, 80);
  if (msg.extractType) summary.extractType = msg.extractType;
  if (msg.tabId !== undefined) summary.tabId = msg.tabId;
  if (typeof msg.question === "string") summary.questionLen = msg.question.length;
  if (typeof msg.query === "string") summary.queryLen = msg.query.length;
  if (msg.intent) summary.intent = msg.intent;
  if (msg.step?.action) summary.stepAction = msg.step.action;
  if (msg.plan?.id) summary.planId = msg.plan.id;
  if (msg.fields && typeof msg.fields === "object") summary.fieldCount = Object.keys(msg.fields).length;
  if (msg.options?.explicitPairs) summary.explicitPairCount = msg.options.explicitPairs.length;
  if (msg.document?.fileName) {
    summary.docFile = msg.document.fileName;
    summary.hasDocBase64 = Boolean(msg.document.base64Data);
  }
  return summary;
}

function swLog(level, stage, detail = {}) {
  const entry = {
    ts: new Date().toISOString(),
    source: "SW",
    level,
    stage,
    ...detail,
  };
  commLogBuffer.push(entry);
  if (commLogBuffer.length > MAX_COMM_LOGS) {
    commLogBuffer.shift();
  }
  try {
    const logger = console[level] || console.info;
    logger("[AI Buddy][SW]", entry);
  } catch {}
}

function sendPanelNotification(payload) {
  try {
    chrome.runtime
      .sendMessage(payload)
      .then(() => {
        swLog("debug", "notifyPanel:delivered", { type: payload?.type, tabId: payload?.tabId });
      })
      .catch((err) => {
        const msg = String(err?.message || err || "");
        const noListener =
          msg.includes("Receiving end does not exist") ||
          msg.includes("Could not establish connection");
        swLog(noListener ? "debug" : "warn", "notifyPanel:undelivered", {
          type: payload?.type,
          tabId: payload?.tabId,
          reason: noListener ? "sidepanel_closed" : msg,
        });
      });
  } catch (err) {
    swLog("warn", "notifyPanel:throw", {
      type: payload?.type,
      error: String(err?.message || err),
    });
  }
}

async function sendTabMessageToBridge(tabId, message, traceId) {
  const invokeSend = () =>
    new Promise((resolve) => {
      try {
        chrome.tabs.sendMessage(tabId, message, { frameId: 0 }, (resp) => {
          const lastErr = chrome.runtime?.lastError;
          if (lastErr) {
            resolve({ ok: false, lastError: lastErr.message || String(lastErr), resp: null });
          } else {
            resolve({ ok: true, lastError: null, resp: resp || null });
          }
        });
      } catch (err) {
        resolve({ ok: false, lastError: String(err?.message || err), resp: null });
      }
    });

  let attempt = await invokeSend();
  if (!attempt.ok) {
    swLog("warn", "tabs.sendMessage:failed", {
      traceId,
      tabId,
      frameId: 0,
      type: message?.type,
      error: attempt.lastError,
    });
    const missingReceiver =
      attempt.lastError?.includes("Receiving end does not exist") ||
      attempt.lastError?.includes("Could not establish connection");
    if (missingReceiver && chrome.scripting?.executeScript) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId, frameIds: [0] },
          files: ["bridge.js"],
        });
        swLog("info", "tabs.sendMessage:bridge_reinjected", { traceId, tabId });
        attempt = await invokeSend();
        if (!attempt.ok) {
          swLog("warn", "tabs.sendMessage:retry_failed", {
            traceId,
            tabId,
            error: attempt.lastError,
          });
        }
      } catch (injectErr) {
        swLog("warn", "tabs.sendMessage:bridge_inject_failed", {
          traceId,
          tabId,
          error: String(injectErr?.message || injectErr),
        });
      }
    }
  } else {
    swLog("debug", "tabs.sendMessage:ack", {
      traceId,
      tabId,
      type: message?.type,
      respOk: Boolean(attempt.resp?.ok),
      status: attempt.resp?.status,
    });
  }
  return attempt.resp;
}

function sanitizeScriptArg(val) {
  if (val === undefined || val === null) return null;
  if (typeof val !== "object") return val;
  if (Array.isArray(val)) return val.map((item) => sanitizeScriptArg(item));
  const out = {};
  for (const [k, v] of Object.entries(val)) {
    if (v !== undefined) {
      out[k] = sanitizeScriptArg(v);
    }
  }
  return out;
}

async function runTabScript({ tabId, target, files, func, args, label = "script" }) {
  const startedAt = Date.now();
  const resolvedTarget = target || { tabId };
  try {
    const injectSpec = { target: resolvedTarget };
    if (files) injectSpec.files = files;
    if (func) injectSpec.func = func;
    if (args !== undefined) {
      injectSpec.args = Array.isArray(args)
        ? args.map((a) => sanitizeScriptArg(a))
        : [sanitizeScriptArg(args)];
    }
    const results = await chrome.scripting.executeScript(injectSpec);
    const frameErrors = (results || [])
      .filter((r) => r?.error)
      .map((r) => ({ frameId: r.frameId, error: String(r.error?.message || r.error) }));
    if (frameErrors.length > 0 || !results || results.length === 0) {
      swLog("warn", "executeScript:partial_or_empty", {
        label,
        tabId: resolvedTarget.tabId,
        allFrames: Boolean(resolvedTarget.allFrames),
        frameCount: results?.length || 0,
        frameErrors,
        elapsedMs: Date.now() - startedAt,
      });
    } else {
      swLog("debug", "executeScript:ok", {
        label,
        tabId: resolvedTarget.tabId,
        allFrames: Boolean(resolvedTarget.allFrames),
        frameCount: results.length,
        hasResult: results.some((r) => r?.result !== undefined),
        elapsedMs: Date.now() - startedAt,
      });
    }
    return { ok: true, results: results || [], frameErrors };
  } catch (err) {
    const errMsg = String(err?.message || err);
    swLog("error", "executeScript:rejected", {
      label,
      tabId: resolvedTarget.tabId,
      allFrames: Boolean(resolvedTarget.allFrames),
      error: errMsg,
      elapsedMs: Date.now() - startedAt,
    });
    return { ok: false, results: [], error: errMsg };
  }
}

// Initialize buffer from local storage with deterministic SW wake-up promise
let conversationBufferHydrated = false;
const conversationBufferReady = chrome.storage.local
  .get("conversationBuffer")
  .then((data) => {
    if (!conversationBufferHydrated && Array.isArray(data?.conversationBuffer)) {
      conversationBuffer = data.conversationBuffer.slice(-MAX_CONVERSATION_TURNS);
    }
    conversationBufferHydrated = true;
  })
  .catch(() => {
    conversationBufferHydrated = true;
  });

async function ensureConversationBufferLoaded() {
  if (!conversationBufferHydrated) {
    await conversationBufferReady;
  }
  return conversationBuffer;
}

// Tab change and activation listeners for reliable fresh page context
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    sendPanelNotification({
      type: "TAB_CHANGED",
      tabId: activeInfo.tabId,
      url: tab?.url,
      title: tab?.title,
    });
  } catch (err) {
    swLog("debug", "tabs.onActivated:get_failed", {
      tabId: activeInfo.tabId,
      error: String(err?.message || err),
    });
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" || changeInfo.url) {
    sendPanelNotification({
      type: "TAB_UPDATED",
      tabId,
      active: Boolean(tab?.active),
      url: tab?.url,
      title: tab?.title,
    });
  }
});

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || typeof msg !== "object" || typeof msg.type !== "string") {
    swLog("warn", "onMessage:invalid_payload", {
      senderOrigin: sanitizeUrlForLog(sender?.url),
      payloadType: typeof msg,
    });
    return false;
  }

  const traceId = msg.__traceId || `sw_${Date.now().toString(36)}_${++commTraceSeq}`;
  const startedAt = Date.now();
  const senderInfo = {
    senderOrigin: sanitizeUrlForLog(sender?.url) || (sender?.id ? `ext:${sender.id}` : "unknown"),
    senderTabId: sender?.tab?.id,
    senderFrameId: sender?.frameId,
  };

  swLog("info", "onMessage:received", {
    traceId,
    ...senderInfo,
    payload: summarizeMessagePayload(msg),
  });

  let replied = false;
  const safeReply = (response) => {
    if (replied) {
      swLog("warn", "onMessage:duplicate_reply_ignored", { traceId, type: msg.type });
      return;
    }
    replied = true;
    const elapsedMs = Date.now() - startedAt;
    swLog(response?.error ? "warn" : "info", "onMessage:reply", {
      traceId,
      type: msg.type,
      elapsedMs,
      ok: response?.ok !== undefined ? Boolean(response.ok) : !response?.error,
      error: response?.error || (response?.ok === false ? response?.message : undefined),
    });
    try {
      reply(response);
    } catch (err) {
      swLog("error", "onMessage:reply_port_closed", {
        traceId,
        type: msg.type,
        elapsedMs,
        error: String(err?.message || err),
      });
    }
  };

  if (msg.type === "GET_COMM_LOGS") {
    safeReply({ ok: true, logs: commLogBuffer.slice(-60) });
    return false;
  }

  if (msg.type === "SAVE_SESSION") {
    if (!sender.url || !msg.session?.apiBase) {
      safeReply({ ok: false, error: "Missing sender URL or session payload" });
      return false;
    }
    try {
      const senderParsed = new URL(sender.url);
      const apiBaseParsed = new URL(msg.session.apiBase);

      // Strict origin match: protocol, hostname, and port must match exactly
      if (senderParsed.origin !== apiBaseParsed.origin) {
        safeReply({ ok: false, error: "Origin mismatch" });
        return false;
      }

      // Strict pathname check: must be exactly "/connect" or "/connect/"
      const path = senderParsed.pathname.replace(/\/+$/, "") || "/";
      if (path !== "/connect") {
        safeReply({ ok: false, error: "Invalid route for session handshake" });
        return false;
      }

      chrome.storage.local
        .set({ session: msg.session, lastBase: apiBaseParsed.origin })
        .then(() => safeReply({ ok: true }))
        .catch((err) => safeReply({ ok: false, error: String(err?.message || err) }));
      return true;
    } catch {
      safeReply({ ok: false, error: "Invalid URL structure" });
      return false;
    }
  }
  if (msg.type === "ASK") {
    pendingAskOptionsQueue.push({
      uploadedDocumentSummary: msg.uploadedDocumentSummary || null,
      preferredProvider: msg.preferredProvider || null,
      actionContext: msg.actionContext || null,
    });
    ask(
      msg.question,
      msg.intent,
      msg.history,
      msg.buddySlug,
      msg.customBuddyId,
      msg.preferredModel
    ).then(safeReply, (e) => safeReply({ error: String(e?.message || e) }));
    return true;
  }
  if (msg.type === "EXTRACT_DOCUMENT") {
    extractUploadedDocument(msg.document).then(safeReply, (e) =>
      safeReply({ ok: false, error: String(e?.message || e) }),
    );
    return true;
  }
  if (msg.type === "SIGN_OUT") {
    conversationBufferHydrated = true;
    conversationBuffer = [];
    chrome.storage.local
      .remove(["session", "conversationBuffer"])
      .then(() => safeReply({ ok: true }))
      .catch((err) => safeReply({ ok: false, error: String(err?.message || err) }));
    return true;
  }
  if (msg.type === "GET_CONVERSATION_BUFFER") {
    ensureConversationBufferLoaded()
      .then((buf) => safeReply({ ok: true, buffer: buf }))
      .catch(() => safeReply({ ok: true, buffer: conversationBuffer }));
    return true;
  }
  if (msg.type === "OPEN_SIDE_PANEL") {
    openSidePanel(sender).then(safeReply, (e) =>
      safeReply({ ok: false, error: String(e?.message || e) }),
    );
    return true;
  }
  if (msg.type === "EXECUTE_ACTION") {
    executeAction(msg.action, msg.selector, msg.value, msg.options).then(safeReply, (e) =>
      safeReply({ ok: false, error: String(e?.message || e) }),
    );
    return true;
  }
  if (msg.type === "EXECUTE_PLAN") {
    executePlan(msg.plan, msg.options).then(safeReply, (e) =>
      safeReply({ ok: false, error: String(e?.message || e) }),
    );
    return true;
  }
  if (msg.type === "EXECUTE_STEP") {
    executePlanStepInTab(msg.step, msg.options).then(safeReply, (e) =>
      safeReply({ ok: false, error: String(e?.message || e) }),
    );
    return true;
  }
  if (msg.type === "EXTRACT_PAGE_DATA") {
    extractPageData(msg.selector, msg.extractType, msg.query, msg.options).then(safeReply, (e) =>
      safeReply({ ok: false, error: String(e?.message || e) }),
    );
    return true;
  }
  if (msg.type === "NAVIGATE_TAB") {
    navigateTab(msg.url, msg.tabId).then(safeReply, (e) =>
      safeReply({ ok: false, error: String(e?.message || e) }),
    );
    return true;
  }
  if (msg.type === "NAVIGATE_HISTORY") {
    navigateHistory(msg.direction).then(safeReply, (e) =>
      safeReply({ ok: false, error: String(e?.message || e) }),
    );
    return true;
  }
  if (msg.type === "GET_ALL_TABS") {
    getAllTabs().then(safeReply, (e) => safeReply({ ok: false, error: String(e?.message || e) }));
    return true;
  }
  if (msg.type === "SWITCH_TAB") {
    switchTab(msg.tabId).then(safeReply, (e) =>
      safeReply({ ok: false, error: String(e?.message || e) }),
    );
    return true;
  }
  if (msg.type === "KEYBOARD_ACTION") {
    keyboardAction(msg.key, msg.selector, msg.options).then(safeReply, (e) =>
      safeReply({ ok: false, error: String(e?.message || e) }),
    );
    return true;
  }
  if (msg.type === "WAIT_FOR_CONDITION") {
    waitForCondition(msg.selector, msg.text, msg.timeoutMs).then(safeReply, (e) =>
      safeReply({ ok: false, error: String(e?.message || e) }),
    );
    return true;
  }
  if (msg.type === "WAIT_FOR_PAGE_SETTLE") {
    waitForPageSettle(msg.timeoutMs).then(safeReply, (e) =>
      safeReply({ ok: false, error: String(e?.message || e) }),
    );
    return true;
  }
  if (msg.type === "FIND_CONTENT") {
    findContentOnPage(msg.query, msg.options).then(safeReply, (e) =>
      safeReply({ ok: false, error: String(e?.message || e) }),
    );
    return true;
  }
  if (msg.type === "HIGHLIGHT") {
    highlightElement(msg.selector, msg.title, msg.description, msg.buddyVisual).then(safeReply, (e) =>
      safeReply({ ok: false, error: String(e?.message || e) }),
    );
    return true;
  }
  if (msg.type === "CLEAR_HIGHLIGHT") {
    clearHighlightOverlay().then(safeReply, (e) =>
      safeReply({ ok: false, error: String(e?.message || e) }),
    );
    return true;
  }
  if (msg.type === "SMART_FILL_FORM") {
    smartFillForm(msg.fields, msg.options).then(safeReply, (e) =>
      safeReply({ ok: false, error: String(e?.message || e) }),
    );
    return true;
  }
  if (msg.type === "SAVE_TASK_CHECKPOINT") {
    chrome.storage.local
      .set({ savedCheckpoint: msg.checkpoint })
      .then(() => safeReply({ ok: true }))
      .catch((err) => safeReply({ ok: false, error: String(err?.message || err) }));
    return true;
  }
  if (msg.type === "GET_TASK_CHECKPOINT") {
    chrome.storage.local
      .get("savedCheckpoint")
      .then((data) => safeReply({ ok: true, checkpoint: data.savedCheckpoint || null }))
      .catch((err) => safeReply({ ok: false, error: String(err?.message || err) }));
    return true;
  }
  if (msg.type === "GET_SNAPSHOT" || msg.type === "GET_PAGE_SNAPSHOT") {
    getSnapshotForActiveTab().then(safeReply, (e) =>
      safeReply({ ok: false, error: String(e?.message || e) }),
    );
    return true;
  }
  swLog("warn", "onMessage:unhandled_type", { traceId, type: msg.type });
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
  return {
    ok: false,
    message:
      "Side panel could not open programmatically; Chrome requires clicking the extension toolbar icon directly.",
  };
}

/**
 * Robust active tab finder:
 * Prefers normal browser windows over DevTools/popup windows so opening DevTools
 * or clicking outside the webpage doesn't misroute commands onto devtools:// URLs.
 */
async function activeTab() {
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      windowType: "normal",
      lastFocusedWindow: true,
    });
    if (tab?.id && tab.url && !RESTRICTED.test(tab.url)) {
      swLog("debug", "activeTab:resolved", {
        strategy: "normal_lastFocused",
        tabId: tab.id,
        windowId: tab.windowId,
        url: sanitizeUrlForLog(tab.url),
      });
      return tab;
    }
  } catch {}
  try {
    const normalActiveTabs = await chrome.tabs.query({ active: true, windowType: "normal" });
    const webTab = normalActiveTabs.find((t) => t?.id && t.url && !RESTRICTED.test(t.url));
    if (webTab) {
      swLog("debug", "activeTab:resolved", {
        strategy: "normal_any_web",
        tabId: webTab.id,
        windowId: webTab.windowId,
        url: sanitizeUrlForLog(webTab.url),
      });
      return webTab;
    }
  } catch {}
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab && tab.id) {
      swLog("debug", "activeTab:resolved", {
        strategy: "lastFocused_fallback",
        tabId: tab.id,
        windowId: tab.windowId,
        url: sanitizeUrlForLog(tab.url),
        restricted: Boolean(tab.url && RESTRICTED.test(tab.url)),
      });
      return tab;
    }
  } catch {}
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) return tab;
  } catch {}
  try {
    const [tab] = await chrome.tabs.query({ active: true });
    if (tab && tab.id) return tab;
  } catch {}
  swLog("warn", "activeTab:none_found");
  return null;
}

function mergeFrameSnapshots(results) {
  const valid = (results || []).map((r) => r?.result).filter(Boolean);
  if (valid.length === 0) return null;
  const primary = { ...valid[0] };
  const headings = [...(primary.headings || [])];
  const forms = [...(primary.forms || [])];
  const controls = [...(primary.controls || [])];
  const alerts = [...(primary.alerts || [])];
  const textParts = primary.text ? [primary.text] : [];

  for (let i = 1; i < valid.length; i++) {
    const f = valid[i];
    if (Array.isArray(f.headings)) headings.push(...f.headings);
    if (Array.isArray(f.forms)) forms.push(...f.forms);
    if (Array.isArray(f.controls)) controls.push(...f.controls);
    if (Array.isArray(f.alerts)) alerts.push(...f.alerts);
    if (f.text && f.text.trim()) textParts.push(f.text.trim());
  }

  return {
    ...primary,
    headings: headings.slice(0, 80),
    forms: forms.slice(0, 120),
    controls: controls.slice(0, 120),
    alerts: alerts.slice(0, 40),
    text: textParts.join("\n").slice(0, 20000),
    frameCount: valid.length,
  };
}

async function captureTabScreenshot(windowId) {
  try {
    if (!chrome.tabs?.captureVisibleTab) return null;
    const dataUrl = await chrome.tabs.captureVisibleTab(windowId || chrome.windows.WINDOW_ID_CURRENT, {
      format: "jpeg",
      quality: 75,
    });
    if (typeof dataUrl === "string" && dataUrl.startsWith("data:image/")) {
      return dataUrl.replace(/^data:image\/[^;]+;base64,/, "");
    }
  } catch {
    // Capture optional; ignore on restricted tabs
  }
  return null;
}

async function getSnapshotForActiveTab() {
  const tab = await activeTab();
  if (!tab?.id || !tab.url || RESTRICTED.test(tab.url)) {
    swLog("warn", "snapshot:restricted_or_missing_tab", {
      tabId: tab?.id,
      url: sanitizeUrlForLog(tab?.url),
    });
    return { ok: false, snapshot: null, error: "Restricted or inactive page" };
  }
  let run = await runTabScript({
    target: { tabId: tab.id, allFrames: true },
    files: ["snapshot.js"],
    label: "snapshot:allFrames",
  });
  if (!run.ok || run.results.length === 0) {
    run = await runTabScript({
      target: { tabId: tab.id },
      files: ["snapshot.js"],
      label: "snapshot:topFrame",
    });
  }
  if (!run.ok) {
    return { ok: false, snapshot: null, error: run.error || "Script execution failed" };
  }
  const merged = mergeFrameSnapshots(run.results);
  if (!merged) {
    swLog("warn", "snapshot:empty_merge", { tabId: tab.id });
    return { ok: false, snapshot: null, error: "Snapshot returned no DOM data" };
  }
  return { ok: true, snapshot: merged };
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

async function recordTurn(userQuestion, assistantAnswer) {
  if (!userQuestion || !assistantAnswer) return;
  await ensureConversationBufferLoaded();
  conversationBuffer.push({ user: userQuestion, assistant: assistantAnswer });
  if (conversationBuffer.length > MAX_CONVERSATION_TURNS) {
    conversationBuffer.shift();
  }
  chrome.storage.local.set({ conversationBuffer }).catch(() => {});
}

async function getPageSnapshot() {
  const res = await getSnapshotForActiveTab();
  if (res.ok && res.snapshot) {
    return { ok: true, snapshot: res.snapshot };
  }
  return {
    ok: false,
    message: "I cannot read the current webpage right now. Please refresh or allow page access.",
  };
}

const BUDDY_PRESETS_MAP = {
  friendly: { name: "Friendly Buddy", defaultLanguage: "hinglish", personality: "Cheerful, warm, encouraging" },
  developer: { name: "Developer Buddy", defaultLanguage: "english", personality: "Direct, analytical, inspects code and DOM" },
  content: { name: "Content Buddy", defaultLanguage: "hinglish", personality: "Creative, articulate, refines copy" },
  ca: { name: "CA Buddy", defaultLanguage: "hinglish", personality: "Tax, GST, invoice, and compliance aware" },
  research: { name: "Research Buddy", defaultLanguage: "english", personality: "Fact-checker, synthesizes citations" },
  data: { name: "Data Buddy", defaultLanguage: "english", personality: "Tabular extraction, formulas, spreadsheet logic" },
  design: { name: "Design Buddy", defaultLanguage: "english", personality: "Visual hierarchy, typography, colors" },
  legal: { name: "Legal Buddy", defaultLanguage: "english", personality: "Careful, compliance, terms of service, clauses" },
  ecommerce: { name: "E-commerce Buddy", defaultLanguage: "hinglish", personality: "Meesho, Amazon, Flipkart listings, orders & pricing" },
  marketing: { name: "Marketing Buddy", defaultLanguage: "hinglish", personality: "SEO, ad copy, conversion rate, campaigns" },
  operations: { name: "Operations Buddy", defaultLanguage: "hinglish", personality: "Process, SOPs, checklists and automation" },
  professor: { name: "Professor Buddy", defaultLanguage: "hinglish", personality: "Patient academic educator with step-by-step clarity" },
  business: { name: "Business Buddy", defaultLanguage: "hinglish", personality: "KPIs, plans, executive summaries, margins" },
  dadaji: { name: "Dadaji Buddy", defaultLanguage: "hindi", personality: "Old-school wisdom, gentle pace" },
  detective: { name: "Detective Buddy", defaultLanguage: "english", personality: "Diagnosis, root cause, verification" },
  family: { name: "Dadaji Buddy", defaultLanguage: "hinglish", personality: "Warm, safe, patient guidance for all ages" },
};

const PROVIDER_KEY_META = {
  gemini: { name: "Google Gemini", key: "GEMINI_API_KEY", local: false },
  groq: { name: "GroqCloud", key: "GROQ_API_KEY", local: false },
  openrouter: { name: "OpenRouter", key: "OPENROUTER_API_KEY", local: false },
  openai: { name: "OpenAI", key: "OPENAI_API_KEY", local: false },
  ollama: { name: "Ollama (Local)", key: "OLLAMA_BASE_URL", local: true },
  huggingface: { name: "Hugging Face Inference", key: "HUGGINGFACE_API_KEY", local: false },
  cloudflare: { name: "Cloudflare Workers AI", key: "CLOUDFLARE_API_TOKEN", local: false },
  github: { name: "GitHub Models", key: "GITHUB_TOKEN", local: false },
};

function buildMissingProviderWarning(preferredProvider, isHindi, fallbackLabel) {
  if (!preferredProvider || preferredProvider === "auto" || preferredProvider === "gemini") {
    return null;
  }
  const meta = PROVIDER_KEY_META[preferredProvider] || {
    name: preferredProvider,
    key: `${preferredProvider.toUpperCase()}_API_KEY`,
    local: false,
  };
  return {
    requestedProvider: preferredProvider,
    requestedProviderName: meta.name,
    status: meta.local ? "not_connected" : "missing_api",
    missingKey: meta.key,
    fallbackUsed: fallbackLabel,
    message: isHindi
      ? `${meta.name} abhi connected nahi hai (${meta.key} missing hai). Task rukne na dene ke liye ${fallbackLabel} use kiya gaya hai.`
      : `${meta.name} is not connected (${meta.key} missing). Continuing with ${fallbackLabel}.`,
  };
}

function getBuddyPresetInternal(slug) {
  if (slug && BUDDY_PRESETS_MAP[slug]) return BUDDY_PRESETS_MAP[slug];
  if (slug && slug.startsWith("custom:")) {
    return { name: "Custom Buddy", defaultLanguage: "hinglish", personality: "Tailored companion for specialized workflows" };
  }
  return BUDDY_PRESETS_MAP.friendly;
}

function findBestMatchingElement(snapshot, query) {
  if (!snapshot || !query) return null;
  const STOPWORDS = new Set([
    "khaa", "kha", "kahan", "kaha", "kidhar", "kdr", "hai", "hain", "tha", "the",
    "tab", "button", "link", "section", "dikhao", "batao", "page", "par", "mein",
    "where", "what", "which", "show", "tell", "find", "locate", "search", "this",
    "click", "press", "dabao", "tap", "kholo", "pe", "karo", "please"
  ]);

  const normText = (s) =>
    String(s || "")
      .toLowerCase()
      .replace(/[-_]+/g, " ")
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const normalizedQuery = normText(query);
  const allTerms = normalizedQuery.split(/\s+/).filter((t) => t.length > 1);
  const meaningfulTerms = allTerms.filter((t) => !STOPWORDS.has(t) && t.length > 1);
  const qTerms = meaningfulTerms.length > 0 ? meaningfulTerms : allTerms;
  if (qTerms.length === 0) return null;

  const elements = [
    ...(snapshot.controls || []),
    ...(snapshot.forms || []),
    ...(snapshot.headings || []),
  ];

  let best = null;
  let bestScore = 0;

  for (const el of elements) {
    const rawText = normText(
      `${el.name || ""} ${el.placeholder || ""} ${el.text || ""} ${el.role || ""}`,
    );
    if (!rawText) continue;
    const isClickable =
      el.role === "button" || el.role === "link" || el.tag === "button" || el.tag === "a";
    let score = 0;

    const nameLower = normText(el.name || el.text || el.placeholder || "");
    const targetPhrase = qTerms.join(" ");
    if (nameLower && nameLower === targetPhrase) {
      score += 12;
    }

    for (const term of qTerms) {
      if (rawText.includes(term)) {
        score += 3;
        if (nameLower === term || nameLower.startsWith(term)) score += 4;
      } else if (term.endsWith("s") && rawText.includes(term.slice(0, -1))) {
        score += 2;
      } else if (!term.endsWith("s") && rawText.includes(`${term}s`)) {
        score += 2;
      }
    }

    if (isClickable && score > 0) score += 2;

    if (score > bestScore && el.selector) {
      bestScore = score;
      best = el;
    }
  }

  return bestScore > 0 ? best : null;
}

async function generateAutonomousCompanionReply({
  question,
  intent,
  snapshot,
  screenshotBase64,
  buddySlug = "friendly",
  customBuddyId,
  userApiKey,
  preferredProvider,
  history = [],
  actionContext = null,
}) {
  const activeBuddy = getBuddyPresetInternal(buddySlug);
  const isHindiLang = activeBuddy.defaultLanguage !== "english";
  const qLower = question.toLowerCase().trim();
  const providerWarning = buildMissingProviderWarning(
    preferredProvider,
    isHindiLang,
    userApiKey ? "Google Gemini" : "Local Grounded Companion",
  );

  const sanitizePromptStr = (raw) =>
    String(raw || "")
      .replace(/\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi, "Bearer [redacted]")
      .replace(/\b(?:sk|AIza)[A-Za-z0-9_\-]{12,}/g, "[redacted_key]")
      .replace(
        /\b(password|passwd|pwd|otp|cvv|cvc|secret|token)\s*[:=]\s*[^\s,;]+/gi,
        (_m, key) => `${key}=[redacted]`,
      );

  // 1. Direct Google Gemini API call if user provided API key
  let directAuthError = null;
  if (userApiKey) {
    try {
      const geminiModels = ["gemini-4-hydrogen", "gemini-3.8-flash", "gemini-3.1-flash-lite"];
      const interpretExtra =
        intent === "interpret_command"
          ? `\nCOMMAND INTERPRETATION MODE:
The local command parser could not confidently determine a clear direct action from the user's message.
Interpret colloquial/short Hinglish ("hnn kr do", "isme daal do", "bss ye wala", "kch likh do", "ye fill karo"), typo variants, and conversational context!
- NEVER fall back to explaining/summarizing the webpage if the user asked to fill/write/click/search/open.
- If the user wants to type/fill but did NOT provide text ("kch likh do", "ye fill karo", "isme daal do"), set actionType="ask_clarification", needsClarification=true, clarificationQuestion="Kya likhna hai? Text bata do." (or "Kya fill karna hai?"), and highlight the candidate field!
- Separate: "web_search" (search website on web), "open_website" (open portal by name), "search_submit" (type into page search box & search), "type" (fill input ONLY without submitting), "explain_page" (only when user explicitly asked to explain page).`
          : "";
      const systemInstruction = `You are ${activeBuddy.name}, an expert AI browser companion. Personality: ${activeBuddy.personality}. Language: ${activeBuddy.defaultLanguage || "hinglish"}.
You observe the user's active webpage (elements have refs like "e1", "f1") and plan real browser actions or answer clearly.
RULES:
- NEVER click when the user only asks where something is ("kahan hai", "point", "show"); use actionType "point" and set "highlight".
- For real actions (click, open_link, type, fill, select, check, uncheck, scroll, form_fill, search_submit, web_search, open_website, ask_clarification, explain_page, multi_step), populate exact JSON fields so the Side Panel executes them.
- NEVER invent missing personal info (names, Aadhaar, PAN, GSTIN, prices, order IDs).${interpretExtra}
Return strictly valid JSON with keys:
{"answer": string, "highlight": string|null, "emotion": "neutral"|"thinking"|"happy"|"concerned"|"curious"|"celebrate", "calloutTitle": string|null, "calloutDescription": string|null, "actionType": "point"|"click"|"open_link"|"type"|"fill"|"select"|"check"|"uncheck"|"scroll"|"form_fill"|"search_submit"|"web_search"|"open_website"|"explain_page"|"ask_clarification"|"multi_step"|"inspect"|null, "targetText": string|null, "targetField": string|null, "targetValue": string|null, "fields": object|null, "scrollDirection": "up"|"down"|"left"|"right"|"top"|"bottom"|null, "scrollTarget": string|null, "needsClarification": boolean, "clarificationQuestion": string|null, "steps": [{"title": string, "action": "click"|"type"|"select"|"scroll"|"point"|"fill_from_document", "textTarget": string|null, "value": string|null, "selector": string|null, "isConsequential": boolean}]|null}`;

      let promptText = "";
      const refMap = new Map();
      if (snapshot) {
        promptText += `ACTIVE WEBPAGE CONTEXT:\nURL: ${snapshot.url}\nTitle: ${snapshot.title}\n`;
        const allItems = [
          ...(snapshot.alerts || []),
          ...(snapshot.forms || []),
          ...(snapshot.controls || []),
          ...(snapshot.headings || []),
        ];
        allItems.forEach((el) => {
          if (el?.ref) refMap.set(el.ref, el);
        });
        if (snapshot.headings?.length) {
          promptText += `Headings: ${snapshot.headings
            .slice(0, 10)
            .map((h) => `[${h.ref || "h"}] ${h.name || h.text}`)
            .filter(Boolean)
            .join(" | ")}\n`;
        }
        if (snapshot.forms?.length) {
          promptText += `Form Fields: ${snapshot.forms
            .slice(0, 18)
            .map((f) => `[${f.ref || "f"}] ${f.name || f.placeholder || f.role} (${f.inputType || f.tag}${!f.sensitive && f.value ? `, val="${sanitizePromptStr(String(f.value)).slice(0, 30)}"` : ""})`)
            .join(", ")}\n`;
        }
        if (snapshot.controls?.length) {
          promptText += `Buttons & Links: ${snapshot.controls
            .slice(0, 25)
            .map((c) => `[${c.ref || "c"}] ${c.name || c.text} (${c.role || c.tag})`)
            .filter(Boolean)
            .join(", ")}\n`;
        }
        if (snapshot.text) {
          promptText += `Page Content: ${sanitizePromptStr(snapshot.text).slice(0, 2500)}\n`;
        }
      }
      if (actionContext && typeof actionContext === "object") {
        const acParts = [];
        if (actionContext.lastTargetField) acParts.push(`lastTargetField="${actionContext.lastTargetField}"`);
        if (actionContext.lastActionType) acParts.push(`lastActionType="${actionContext.lastActionType}"`);
        if (actionContext.pendingSlotType) acParts.push(`pendingSlotType="${actionContext.pendingSlotType}"`);
        if (actionContext.activeElementLabel) acParts.push(`focusedElement="${actionContext.activeElementLabel}"`);
        if (Array.isArray(actionContext.recentFields) && actionContext.recentFields.length) {
          acParts.push(`recentFields=[${actionContext.recentFields.join(", ")}]`);
        }
        if (acParts.length) {
          promptText += `\nCURRENT ACTION CONTEXT:\n${acParts.join(" | ")}\n`;
        }
      }
      promptText += `\nUSER QUESTION: ${sanitizePromptStr(question)}`;

      const parts = [];
      if (screenshotBase64) {
        const cleanShot = String(screenshotBase64).replace(/^data:image\/[^;]+;base64,/, "");
        parts.push({ inlineData: { mimeType: "image/jpeg", data: cleanShot } });
      }
      parts.push({ text: promptText });

      const historyContents = Array.isArray(history)
        ? history
            .filter((h) => h && typeof h.content === "string" && h.content.trim())
            .slice(-6)
            .map((h) => ({
              role: h.role === "assistant" || h.role === "model" ? "model" : "user",
              parts: [{ text: sanitizePromptStr(h.content) }],
            }))
        : [];
      const contents = [...historyContents, { role: "user", parts }];

      let geminiRes = null;
      for (const modelName of geminiModels) {
        geminiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(userApiKey)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: systemInstruction }] },
              contents,
              generationConfig: {
                responseMimeType: "application/json",
                maxOutputTokens: 1200,
                temperature: 0.35,
              },
            }),
          },
        );
        if (geminiRes.ok) break;
        if (geminiRes.status === 401 || geminiRes.status === 403) {
          directAuthError = `Google Gemini API rejected your key (${geminiRes.status}). Check your key in Settings.`;
          break;
        }
        if (geminiRes.status !== 404 && geminiRes.status !== 400 && geminiRes.status !== 503) {
          break;
        }
      }
      if (geminiRes?.ok) {
        const geminiJson = await geminiRes.json();
        const candidateText =
          geminiJson.candidates?.[0]?.content?.parts?.[0]?.text;
        if (candidateText) {
          let parsedPlan = null;
          try {
            const cleanJson = candidateText
              .replace(/^```(?:json)?\s*/i, "")
              .replace(/```\s*$/, "")
              .trim();
            parsedPlan = JSON.parse(cleanJson);
          } catch {
            const braced = candidateText.match(/\{[\s\S]*\}/);
            if (braced) {
              try {
                parsedPlan = JSON.parse(braced[0]);
              } catch {}
            }
          }

          const answerText =
            (parsedPlan && typeof parsedPlan.answer === "string" && parsedPlan.answer.trim()) ||
            candidateText;
          let matchedEl = null;
          if (parsedPlan?.highlight && refMap.has(parsedPlan.highlight)) {
            matchedEl = refMap.get(parsedPlan.highlight);
          } else if (snapshot && (parsedPlan?.targetText || parsedPlan?.targetField || parsedPlan?.highlight)) {
            matchedEl = findBestMatchingElement(
              snapshot,
              String(parsedPlan.targetText || parsedPlan.targetField || parsedPlan.highlight),
            );
          } else if (
            snapshot &&
            (qLower.includes("where") ||
              qLower.includes("button") ||
              qLower.includes("find") ||
              qLower.includes("click") ||
              qLower.includes("dhoondho") ||
              qLower.includes("kahan"))
          ) {
            matchedEl = findBestMatchingElement(snapshot, question);
          }
          const highlightSelector = matchedEl?.selector || null;

          return {
            taskId: null,
            reply: {
              answer: answerText,
              highlight: parsedPlan?.highlight || matchedEl?.ref || null,
              confidence: "high",
              needs: parsedPlan?.needsClarification ? "clarification" : null,
              emotion: parsedPlan?.emotion || "happy",
            },
            highlightSelector,
            targetSelector: highlightSelector,
            calloutTitle: parsedPlan?.calloutTitle || matchedEl?.name?.slice(0, 50) || null,
            calloutDescription: parsedPlan?.calloutDescription || null,
            actionType: parsedPlan?.actionType || null,
            targetText: parsedPlan?.targetText || matchedEl?.name || null,
            targetField: parsedPlan?.targetField || null,
            targetValue: parsedPlan?.targetValue || null,
            fields: parsedPlan?.fields || null,
            scrollDirection: parsedPlan?.scrollDirection || null,
            scrollTarget: parsedPlan?.scrollTarget || null,
            needsClarification: Boolean(parsedPlan?.needsClarification),
            clarificationQuestion: parsedPlan?.clarificationQuestion || null,
            steps: Array.isArray(parsedPlan?.steps) ? parsedPlan.steps : null,
            buddyName: activeBuddy.name,
            permission: "explain",
            guest: true,
            provider: "gemini_direct",
            providerWarning,
          };
        }
      }
    } catch {
      // Fallback to grounded companion below
    }
  }

  // 2. Local Grounded Companion Engine (Always active, zero external network required)
  // Greetings
  if (
    /^(?:hi+|hello+|hey+|namaste|pranam|hola|kya haal|ram ram|good\s+(?:morning|afternoon|evening)|kaise ho)[.!?\s]*$/i.test(
      qLower,
    )
  ) {
    const isHindi = activeBuddy.defaultLanguage !== "english";
    const answer = isHindi
      ? `Namaste! Main aapka ${activeBuddy.name} hoon. Main is page par aapki poori help karne ke liye taiyar hoon! Aap bataiye—kya aap page explain karwana chahte hain, forms fill karna chahte hain, ya koi button dhoondhna hai?`
      : `Hello! I am ${activeBuddy.name}, your active browser companion. I am grounded on this page and ready to explain content, locate buttons, fill forms, or guide your workflow! What would you like to do?`;
    return {
      taskId: null,
      reply: {
        answer,
        highlight: null,
        confidence: "high",
        needs: null,
        emotion: "celebrate",
      },
      highlightSelector: null,
      buddyName: activeBuddy.name,
      permission: "explain",
      guest: true,
    };
  }

  // Scroll Action commands (including nested scrollable containers)
  const isScrollAction =
    /\b(?:scroll|neeche\s+(?:jao|le\s+jao)|upar\s+(?:jao|le\s+jao)|page\s+(?:down|up|ke\s+last|ke\s+top)|bottom\s+par\s+jao|top\s+par\s+jao|tak\s+scroll)\b/i.test(
      qLower,
    );

  if (isScrollAction) {
    let dir = "down";
    if (/\b(?:up|upar)\b/i.test(qLower)) dir = "up";
    else if (/\b(?:left|baayein|baaye)\b/i.test(qLower)) dir = "left";
    else if (/\b(?:right|daayein|daaye)\b/i.test(qLower)) dir = "right";
    else if (/\b(?:top|shuru)\b/i.test(qLower)) dir = "top";
    else if (/\b(?:bottom|last|aakhir|end)\b/i.test(qLower)) dir = "bottom";

    let scrollTarget = null;
    if (/\b(?:inside|container|box|table|panel|list|area|modal|drawer)\b/i.test(qLower)) {
      const matchedContainer = findBestMatchingElement(snapshot, question);
      if (matchedContainer?.selector) {
        scrollTarget = matchedContainer.selector;
      } else {
        const scrollableCtrl = (snapshot?.controls || []).find((c) => c.scrollable && c.selector);
        if (scrollableCtrl) scrollTarget = scrollableCtrl.selector;
      }
    }

    const isHindi = activeBuddy.defaultLanguage !== "english";
    return {
      taskId: null,
      reply: {
        answer: isHindi
          ? `Main ${scrollTarget ? "container" : "page"} ko ${dir} scroll kar raha hoon!`
          : `Scrolling ${scrollTarget ? "container" : "page"} ${dir}!`,
        highlight: null,
        confidence: "high",
        needs: null,
        emotion: "working",
        actionType: "scroll",
      },
      actionType: "scroll",
      scrollDirection: dir,
      scrollTarget,
      buddyName: activeBuddy.name,
      permission: "interact",
      guest: true,
    };
  }

  // Strict POINT / HIGHLIGHT Action commands (NEVER CLICKS)
  const isPointAction =
    /\b(?:point\s+karo|par\s+point|point\s+to|highlight\s+(?:the|this|karo)?)\b/i.test(qLower);

  if (isPointAction) {
    const matchEl = findBestMatchingElement(snapshot, question);
    const elLabel = matchEl?.name || matchEl?.placeholder || matchEl?.text || matchEl?.role || "element";
    const isHindi = activeBuddy.defaultLanguage !== "english";
    return {
      taskId: null,
      reply: {
        answer: matchEl
          ? isHindi
            ? `Maine "${elLabel}" par point aur highlight kar diya hai (bina click kiye).`
            : `Pointing and highlighting "${elLabel}" without clicking.`
          : isHindi
            ? `Page par matching element nahi mila jise point kar sakoon.`
            : `Could not find a matching element to point to on this page.`,
        highlight: matchEl?.ref || null,
        confidence: matchEl ? "high" : "low",
        needs: null,
        emotion: matchEl ? "pointing" : "confused",
        actionType: "point",
      },
      actionType: "point",
      highlightSelector: matchEl?.selector || null,
      calloutTitle: elLabel,
      calloutDescription: "Pointing here (not clicking)",
      buddyName: activeBuddy.name,
      permission: "explain",
      guest: true,
    };
  }

  // Explicit Open Link / Click / Press Action commands
  const isOpenLinkAction =
    /\bopen\s+(?:the\s+|this\s+)?.*?\b(?:link|url|page)\b|\b(?:link|url)\s+(?:open|kholo)\b/i.test(qLower);
  const isClickAction =
    isOpenLinkAction ||
    /(?:click|press|dabao|tap|kholo|tick|check|uncheck)\b/i.test(qLower) ||
    /(?:par\s+click|pe\s+click|click\s+karo|dabao|daba\s+do|press\s+karo)/i.test(qLower);

  if (isClickAction) {
    const matchEl = findBestMatchingElement(snapshot, question);
    const isHindi = activeBuddy.defaultLanguage !== "english";
    if (!matchEl) {
      return {
        taskId: null,
        reply: {
          answer: isHindi
            ? "Is page par aisa matching button ya control abhi visible nahi mila. Kripya element ka exact naam batayein ya thoda scroll karein."
            : "I could not find a matching visible button or interactive control on this page. Please specify its exact label or scroll so it is visible.",
          highlight: null,
          confidence: "low",
          needs: null,
          emotion: "confused",
          actionType: null,
        },
        actionType: null,
        targetSelector: null,
        targetText: null,
        highlightSelector: null,
        buddyName: activeBuddy.name,
        permission: "explain",
        guest: true,
      };
    }

    const elLabel = matchEl.name || matchEl.placeholder || matchEl.text || matchEl.role || "button";
    const resolvedAction =
      isOpenLinkAction || matchEl.role === "link" || matchEl.tag === "a" ? "open_link" : "click";
    const answer =
      resolvedAction === "open_link"
        ? isHindi
          ? `Main "${elLabel}" link khol raha hoon!`
          : `Opening link "${elLabel}"!`
        : isHindi
          ? `Main page par "${elLabel}" click kar raha hoon!`
          : `Executing click on "${elLabel}"!`;

    return {
      taskId: null,
      reply: {
        answer,
        highlight: matchEl.ref || null,
        confidence: "high",
        needs: null,
        emotion: "working",
        actionType: resolvedAction,
      },
      actionType: resolvedAction,
      targetSelector: matchEl.selector || null,
      targetText: elLabel,
      highlightSelector: matchEl.selector || null,
      calloutTitle: elLabel,
      calloutDescription: resolvedAction === "open_link" ? "Opening destination link" : "Clicking target element",
      buddyName: activeBuddy.name,
      permission: "interact",
      guest: true,
    };
  }

  // Form filling / writing commands (NEVER explain webpage when user asked to fill/write without value)
  const fillWithMatch = question.match(/\bfill\s+(.+?)\s+with\s+["']?([^"'\n]+?)["']?(?:\s+without\s+submitting)?[.!?]*$/i);
  const isBareFillOrWrite =
    !fillWithMatch &&
    /\b(?:fill|bhar|bharo|likh|likho|lkh|lkho|daal|daalo|dalo|type|enter)\b/i.test(qLower) &&
    (/\b(?:kch|kuch|something|ye|yeh|isme|isko|it|this)\b/i.test(qLower) || !/\b(?:with|as|:|=)\b/i.test(qLower));

  if (isBareFillOrWrite) {
    const isHindi = activeBuddy.defaultLanguage !== "english";
    const matchedField = findBestMatchingElement(snapshot, question) || snapshot?.forms?.[0] || null;
    const askText = isHindi
      ? /\b(?:likh|likho|type)\b/i.test(qLower)
        ? "Kya likhna hai? Text bata do."
        : "Kya fill karna hai?"
      : "What should I write or fill here? Please share the value.";
    return {
      taskId: null,
      reply: {
        answer: askText,
        highlight: matchedField?.ref || null,
        confidence: "medium",
        needs: "value_to_fill",
        emotion: "curious",
        actionType: "ask_clarification",
      },
      actionType: "ask_clarification",
      needsClarification: true,
      clarificationQuestion: askText,
      targetField: matchedField?.name || matchedField?.placeholder || null,
      targetSelector: matchedField?.selector || null,
      highlightSelector: matchedField?.selector || null,
      buddyName: activeBuddy.name,
      permission: "explain",
      guest: true,
      providerWarning,
    };
  }

  const isFormFillAction =
    Boolean(fillWithMatch) ||
    /(?:form\s+(?:fill|bhar|bharo)|fill\s+(?:the\s+|this\s+)?form|auto\s*fill|fill\s+(?:all\s+)?(?:inputs|fields)|fill\s+kar|likh\s+do|daal\s+do|type\s+kar)/i.test(
      qLower,
    );

  if (isFormFillAction) {
    const isHindi = activeBuddy.defaultLanguage !== "english";
    const targetField = fillWithMatch?.[1]?.trim() || null;
    const targetValue = fillWithMatch?.[2]?.trim() || null;
    const matchedField = targetField ? findBestMatchingElement(snapshot, targetField) : snapshot?.forms?.[0];
    const answer =
      targetField && targetValue
        ? isHindi
          ? `Main "${targetField}" field ko "${targetValue}" se fill kar raha hoon (bina submit kiye).`
          : `Filling "${targetField}" with "${targetValue}" without submitting.`
        : isHindi
          ? `Main active form fields fill aur verify kar raha hoon.`
          : `Executing Smart Form Fill on visible input fields.`;

    return {
      taskId: null,
      reply: {
        answer,
        highlight: matchedField?.ref || snapshot?.forms?.[0]?.ref || null,
        confidence: "high",
        needs: null,
        emotion: "working",
        actionType: "form_fill",
      },
      actionType: "form_fill",
      targetField,
      targetValue,
      targetSelector: matchedField?.selector || null,
      highlightSelector: matchedField?.selector || snapshot?.forms?.[0]?.selector || null,
      buddyName: activeBuddy.name,
      permission: "interact",
      guest: true,
    };
  }

  // Element locating requests (English, Hindi, and Hinglish queries) — STRICT FIND, NEVER CLICK
  if (
    qLower.includes("find") ||
    qLower.includes("where") ||
    qLower.includes("locate") ||
    qLower.includes("search") ||
    qLower.includes("dhoondho") ||
    qLower.includes("dhundo") ||
    qLower.includes("khaa") ||
    qLower.includes("kha") ||
    qLower.includes("kahan") ||
    qLower.includes("kaha") ||
    qLower.includes("kidhar") ||
    qLower.includes("kdr") ||
    qLower.includes("tab") ||
    qLower.includes("dikhao") ||
    qLower.includes("batao")
  ) {
    const matchEl = findBestMatchingElement(snapshot, question);
    if (matchEl) {
      const elLabel = matchEl.name || matchEl.placeholder || matchEl.text || matchEl.role || "target element";
      const isHindi = activeBuddy.defaultLanguage !== "english";
      const answer = isHindi
        ? `Maine page par "${elLabel}" dhoondh liya hai! Main apne Lamba Haath (pointing arm) se isko highlight aur point kar raha hoon.`
        : `I located "${elLabel}" on this page! I have extended my pointing arm to highlight and point to it for you.`;
      return {
        taskId: null,
        reply: {
          answer,
          highlight: matchEl.ref || null,
          confidence: "high",
          needs: null,
          emotion: "pointing",
          actionType: "find",
        },
        actionType: "find",
        highlightSelector: matchEl.selector,
        calloutTitle: elLabel,
        calloutDescription: `Type: ${matchEl.tag || matchEl.role}`,
        buddyName: activeBuddy.name,
        permission: "explain",
        guest: true,
      };
    }
  }

  // Form general inspection (if not direct fill command)
  if (
    qLower.includes("form") ||
    qLower.includes("input") ||
    qLower.includes("fields")
  ) {
    const formCount = snapshot?.forms?.length || 0;
    const isHindi = activeBuddy.defaultLanguage !== "english";
    if (formCount > 0) {
      const fieldNames = snapshot.forms
        .slice(0, 6)
        .map((f) => f.name || f.placeholder || f.role)
        .filter(Boolean)
        .join(", ");
      const answer = isHindi
        ? `Is page par ${formCount} form fields detect hue hain: [${fieldNames}]. Aap 'Ye form fill kar do' bolkar in fields ko bhar sakte hain!`
        : `I detected ${formCount} form fields on this page: [${fieldNames}]. Say 'Fill this form' to populate them safely!`;
      return {
        taskId: null,
        reply: {
          answer,
          highlight: snapshot.forms[0]?.ref || null,
          confidence: "high",
          needs: null,
          emotion: "working",
        },
        highlightSelector: snapshot.forms[0]?.selector || null,
        buddyName: activeBuddy.name,
        permission: "explain",
        guest: true,
      };
    }
  }

  // Specific question lookup across visible tables and page text before falling back to generic summary
  const isSummaryQuery =
    /\b(?:explain\s+(?:this\s+)?page|summarize|summary|what\s+is\s+this\s+page|page\s+kya\s+hai|overview)\b/i.test(
      qLower,
    );
  if (snapshot && !isSummaryQuery) {
    const STOPWORDS = new Set([
      "what", "is", "are", "the", "of", "in", "on", "for", "to", "a", "an", "and", "or",
      "this", "that", "page", "tell", "me", "about", "check", "show", "give", "find",
      "kya", "hai", "ka", "ki", "ke", "mein", "me", "par", "batao", "bata", "kitna", "kitni",
    ]);
    const rawTokens = qLower
      .replace(/[^\w\s-]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
    // Prefer specific alphanumeric/identifier tokens (like ord-9001, 9001, aarav)
    const idTokens = rawTokens.filter((t) => /\d|-/.test(t) || t.length >= 4);
    const searchTokens = idTokens.length > 0 ? idTokens : rawTokens;

    if (searchTokens.length > 0 && Array.isArray(snapshot.tables) && snapshot.tables.length > 0) {
      const matchedRows = [];
      for (const tbl of snapshot.tables) {
        const headers = Array.isArray(tbl.headers) ? tbl.headers : [];
        for (const row of tbl.rows || []) {
          const rowText = row.join(" ").toLowerCase();
          const score = searchTokens.reduce((acc, tok) => acc + (rowText.includes(tok) ? (/\d/.test(tok) ? 3 : 1) : 0), 0);
          if (score > 0) {
            const formatted = headers.length === row.length
              ? row.map((cell, idx) => `${headers[idx]}: ${cell}`).join(" | ")
              : row.join(" | ");
            matchedRows.push({ score, formatted });
          }
        }
      }
      matchedRows.sort((a, b) => b.score - a.score);
      if (matchedRows.length > 0) {
        const isHindi = activeBuddy.defaultLanguage !== "english";
        const topMatches = matchedRows.slice(0, 3).map((m) => `• ${m.formatted}`).join("\n");
        const answer = isHindi
          ? `Active page ("${snapshot.title || "Current Page"}") par matching details mile hain:\n${topMatches}`
          : `Found matching details on "${snapshot.title || "Current Page"}":\n${topMatches}`;
        return {
          taskId: null,
          reply: {
            answer,
            highlight: null,
            confidence: "high",
            needs: null,
            emotion: "happy",
          },
          highlightSelector: null,
          buddyName: activeBuddy.name,
          permission: "explain",
          guest: true,
          providerWarning,
        };
      }
    }

    if (searchTokens.length > 0 && snapshot.text) {
      const textLower = snapshot.text.toLowerCase();
      let bestTok = null;
      let bestIdx = -1;
      for (const tok of [...searchTokens].sort((a, b) => (/\d/.test(b) ? 1 : 0) - (/\d/.test(a) ? 1 : 0) || b.length - a.length)) {
        const idx = textLower.indexOf(tok);
        if (idx >= 0) {
          bestTok = tok;
          bestIdx = idx;
          break;
        }
      }
      if (bestIdx >= 0) {
        const start = Math.max(0, bestIdx - 80);
        const end = Math.min(snapshot.text.length, bestIdx + 180);
        const excerpt = snapshot.text.slice(start, end).trim();
        const isHindi = activeBuddy.defaultLanguage !== "english";
        const answer = isHindi
          ? `Page par "${bestTok}" ke paas yeh detail visible hai:\n"${excerpt}"`
          : `Visible on "${snapshot.title || "Current Page"}" near "${bestTok}":\n"${excerpt}"`;
        return {
          taskId: null,
          reply: {
            answer,
            highlight: null,
            confidence: "high",
            needs: null,
            emotion: "happy",
          },
          highlightSelector: null,
          buddyName: activeBuddy.name,
          permission: "explain",
          guest: true,
          providerWarning,
        };
      }
    }
  }

  // Page Explanation / Summary / General Page Analysis
  if (snapshot) {
    const title = snapshot.title || "active page";
    const headings = (snapshot.headings || []).map((h) => h.name || h.text).filter(Boolean).slice(0, 5);
    const formCount = snapshot.forms?.length || 0;
    const btnCount = snapshot.controls?.length || 0;
    const isHindi = activeBuddy.defaultLanguage !== "english";

    let answer = "";
    if (isHindi) {
      answer = `Aap abhi "${title}" par hain.\n\n📌 **Main Summary:**\n`;
      if (headings.length) {
        answer += `• Key Sections: ${headings.join(" • ")}\n`;
      }
      if (formCount > 0 || btnCount > 0) {
        answer += `• Interactive Elements: ${btnCount} clickable buttons/links aur ${formCount} input fields.\n`;
      }
      if (snapshot.text) {
        const snippet = snapshot.text.replace(/\s+/g, " ").trim().slice(0, 280);
        answer += `• Page Overview: "${snippet}…"\n\n`;
      }
      answer += `Bataiye aap yahan kya action lena chahte hain—kisi button ko click karna hai ya form bharna hai?`;
    } else {
      answer = `You are currently on "${title}".\n\n📌 **Page Summary:**\n`;
      if (headings.length) {
        answer += `• Key Sections: ${headings.join(" • ")}\n`;
      }
      if (formCount > 0 || btnCount > 0) {
        answer += `• Interactive Elements: ${btnCount} clickable controls and ${formCount} input fields.\n`;
      }
      if (snapshot.text) {
        const snippet = snapshot.text.replace(/\s+/g, " ").trim().slice(0, 280);
        answer += `• Content Overview: "${snippet}…"\n\n`;
      }
      answer += `Let me know what you would like to do on this page—I can highlight elements, auto-fill forms, or answer specific questions!`;
    }

    const effectiveWarning = directAuthError
      ? {
          requestedProvider: "gemini",
          requestedProviderName: "Google Gemini",
          status: "auth_error",
          missingKey: "GEMINI_API_KEY",
          fallbackUsed: "Local Grounded Companion",
          message: directAuthError,
        }
      : providerWarning;

    return {
      taskId: null,
      reply: {
        answer,
        highlight: null,
        confidence: "high",
        needs: null,
        emotion: "happy",
      },
      highlightSelector: null,
      buddyName: activeBuddy.name,
      permission: "explain",
      guest: true,
      providerWarning: effectiveWarning,
    };
  }

  // Fallback when no snapshot is available
  const isHindi = activeBuddy.defaultLanguage !== "english";
  const fallbackAnswer = isHindi
    ? `Main aapka ${activeBuddy.name} hoon. Main is browser window mein active hoon! Aap kisi bhi webpage par jakar mujhse page explain karne, buttons dhundhne, ya form bharne ko keh sakte hain.`
    : `I am ${activeBuddy.name}, your browser companion! I am active and ready. Open any website and ask me to explain the page, find buttons, or automate actions.`;

  const effectiveWarning = directAuthError
    ? {
        requestedProvider: "gemini",
        requestedProviderName: "Google Gemini",
        status: "auth_error",
        missingKey: "GEMINI_API_KEY",
        fallbackUsed: "Local Grounded Companion",
        message: directAuthError,
      }
    : providerWarning;

  return {
    taskId: null,
    reply: {
      answer: fallbackAnswer,
      highlight: null,
      confidence: "high",
      needs: null,
      emotion: "happy",
    },
    highlightSelector: null,
    buddyName: activeBuddy.name,
    permission: "explain",
    guest: true,
    providerWarning: effectiveWarning,
  };
}

let verifiedExtensionOriginCache = null;

async function isHealthyBuddyOrigin(origin) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1800);
    try {
      const res = await fetch(`${origin}/api/public/extension/health`, { signal: controller.signal });
      if (!res.ok) return false;
      const data = await res.json().catch(() => null);
      return Boolean(data && (data.ok !== undefined || data.checks));
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return false;
  }
}

async function resolveExtensionApiBase(session, lastBase) {
  let apiBase = session?.apiBase || lastBase;
  if (!apiBase) {
    try {
      const stored = await chrome.storage.local.get("buddyApiBaseUrl");
      if (stored?.buddyApiBaseUrl) apiBase = stored.buddyApiBaseUrl;
    } catch {}
  }
  if (apiBase && apiBase.includes(LEGACY_BROKEN_HOST)) {
    apiBase = DEFAULT_HOST;
    chrome.storage.local.set({ lastBase: DEFAULT_HOST }).catch(() => {});
  }

  if (!apiBase) {
    if (verifiedExtensionOriginCache) return verifiedExtensionOriginCache;
    try {
      const allTabs = await chrome.tabs.query({});
      const candidateOrigins = [];
      let sawLocalDevTab = false;
      for (const t of allTabs) {
        if (t?.url && !RESTRICTED.test(t.url)) {
          try {
            const u = new URL(t.url);
            if (u.hostname === "localhost" || u.hostname === "127.0.0.1") {
              sawLocalDevTab = true;
            }
            const isBuddyTab =
              t.title?.includes("AI Buddy") ||
              t.title?.includes("your-ai-companion") ||
              u.port === "3000" ||
              u.hostname.includes("run.app");
            if (
              u.protocol.startsWith("http") &&
              !u.hostname.includes("aistudio.google.com") &&
              !u.hostname.includes(LEGACY_BROKEN_HOST) &&
              isBuddyTab
            ) {
              if (t.title?.includes("AI Buddy") || t.title?.includes("your-ai-companion")) {
                candidateOrigins.unshift(u.origin);
              } else {
                candidateOrigins.push(u.origin);
              }
            }
          } catch {}
        }
      }
      if (sawLocalDevTab) {
        candidateOrigins.push("http://localhost:3000");
      }
      for (const origin of [...new Set(candidateOrigins)]) {
        if (await isHealthyBuddyOrigin(origin)) {
          apiBase = origin;
          verifiedExtensionOriginCache = origin;
          chrome.storage.local.set({ lastBase: origin }).catch(() => {});
          break;
        }
      }
    } catch {}
    if (!apiBase) apiBase = DEFAULT_HOST;
  }
  return apiBase;
}

function parseDocumentTextLocallyExt(rawText, fileName = "document") {
  const text = String(rawText || "").replace(/\r/g, "\n");
  const compact = text.replace(/[ \t]+/g, " ");
  const lower = `${fileName} ${compact}`.toLowerCase();
  const fields = {};
  const ambiguousFields = [];

  let documentType = "other";
  if (/aadhaar|aadhar|uidai|unique\s+identification/i.test(lower)) documentType = "aadhaar";
  else if (/\bpan\b|permanent\s+account\s+number|income\s+tax\s+department/i.test(lower)) documentType = "pan";
  else if (/shipping\s+label|awb|tracking\s*(?:id|no|number)|ship\s+to|courier/i.test(lower)) documentType = "shipping_label";
  else if (/invoice|tax\s+invoice|gstin|bill\s+no|total\s+amount/i.test(lower)) documentType = "invoice";

  const aadhaarMatches = [...compact.matchAll(/\b([2-9]\d{3}[\s-]?\d{4}[\s-]?\d{4})\b/g)].map((m) =>
    m[1].replace(/[\s-]+/g, " ").trim(),
  );
  const uniqueAadhaar = [...new Set(aadhaarMatches)];
  if (uniqueAadhaar.length === 1) {
    fields.aadhaarNumber = uniqueAadhaar[0];
    if (documentType === "other") documentType = "aadhaar";
  } else if (uniqueAadhaar.length > 1) {
    ambiguousFields.push("aadhaarNumber");
  }

  const panMatches = [...compact.toUpperCase().matchAll(/\b([A-Z]{5}[0-9]{4}[A-Z])\b/g)].map((m) => m[1]);
  const uniquePan = [...new Set(panMatches)];
  if (uniquePan.length === 1) {
    fields.panNumber = uniquePan[0];
    if (documentType === "other") documentType = "pan";
  } else if (uniquePan.length > 1) {
    ambiguousFields.push("panNumber");
  }

  const gstMatch = compact.toUpperCase().match(/\b([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z])\b/);
  if (gstMatch?.[1]) fields.gstin = gstMatch[1];

  const emailMatch = compact.match(/\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/);
  if (emailMatch?.[1]) fields.email = emailMatch[1];

  const phoneMatch = compact.match(/(?:\+?91[\s-]?)?\b([6-9]\d{9})\b/);
  if (phoneMatch?.[1]) fields.phone = phoneMatch[1];

  const dobMatch = compact.match(
    /(?:dob|date\s+of\s+birth|birth\s*date|year\s+of\s+birth)\s*[:\-]?\s*(\d{2}[\/\-]\d{2}[\/\-]\d{4}|\d{4}[\/\-]\d{2}[\/\-]\d{2})/i,
  );
  if (dobMatch?.[1]) fields.dob = dobMatch[1];

  const genderMatch = compact.match(/\b(male|female|transgender)\b/i);
  if (genderMatch?.[1]) fields.gender = genderMatch[1];

  const pinMatch =
    compact.match(/(?:pin\s*(?:code)?|pincode|zip)\s*[:\-]?\s*(\d{6})\b/i) ||
    compact.match(/\b([1-9]\d{5})\b/);
  if (pinMatch?.[1]) fields.pincode = pinMatch[1];

  const labelPatterns = [
    ["name", /(?:^|\n)\s*(?:full\s+)?name\s*[:\-]\s*([^\n]{2,60})/i],
    ["fatherName", /(?:^|\n)\s*(?:father(?:'s)?\s*name|s\/o|d\/o|w\/o|c\/o)\s*[:\-]?\s*([^\n,]{2,60})/i],
    ["address", /(?:^|\n)\s*(?:address|residence|ship\s*to)\s*[:\-]\s*([^\n]{5,180})/i],
    ["city", /(?:^|\n)\s*(?:city|town|district)\s*[:\-]\s*([^\n,]{2,40})/i],
    ["state", /(?:^|\n)\s*(?:state|province)\s*[:\-]\s*([^\n,]{2,40})/i],
    ["invoiceNumber", /(?:invoice\s*(?:no|number|#))\s*[:\-]?\s*([A-Z0-9\-\/]{3,32})/i],
    ["orderId", /(?:order\s*(?:id|no|number|#))\s*[:\-]?\s*([A-Z0-9\-\_]{3,32})/i],
    ["trackingNumber", /(?:tracking\s*(?:id|no|number)|awb(?:\s*no)?)\s*[:\-]?\s*([A-Z0-9\-]{5,36})/i],
    ["company", /(?:^|\n)\s*(?:company|business|seller|vendor|firm)\s*(?:name)?\s*[:\-]\s*([^\n]{2,80})/i],
  ];
  for (const [k, re] of labelPatterns) {
    const m = text.match(re);
    if (m?.[1] && !fields[k]) fields[k] = m[1].trim();
  }

  const count = Object.keys(fields).length;
  return {
    ok: count > 0,
    documentType,
    fileName,
    confidence: count >= 3 ? "high" : count > 0 ? "medium" : "low",
    fields,
    ambiguousFields,
    provider: "local_ocr_parser",
  };
}

async function extractUploadedDocument(doc) {
  if (!doc || !doc.fileName) {
    return { ok: false, error: "No document provided." };
  }
  const { session, lastBase, userApiKey } = await chrome.storage.local.get([
    "session",
    "lastBase",
    "userApiKey",
  ]);
  const apiBase = await resolveExtensionApiBase(session, lastBase);
  const headers = { "content-type": "application/json" };
  if (session?.accessToken) headers["authorization"] = `Bearer ${session.accessToken}`;

  const reqBody = JSON.stringify({
    fileName: doc.fileName,
    mimeType: doc.mimeType || "application/octet-stream",
    base64Data: doc.base64Data || undefined,
    textContent: doc.textContent || undefined,
    userApiKey: userApiKey || undefined,
  });

  // 1. Try server endpoint (or proxy via active web tab)
  try {
    let res = await fetch(`${apiBase}/api/public/extension/extract-document`, {
      method: "POST",
      headers,
      body: reqBody,
      credentials: "omit",
    });
    const ct = res.headers.get("content-type") || "";
    let data = ct.includes("application/json") ? await res.json().catch(() => null) : null;

    if (!data) {
      const allTabs = await chrome.tabs.query({});
      const buddyTab = allTabs.find(
        (t) =>
          t.url &&
          !t.url.includes("aistudio.google.com") &&
          !t.url.includes(LEGACY_BROKEN_HOST) &&
          (t.url.includes("run.app") || t.url.includes("localhost")),
      );
      if (buddyTab?.id && buddyTab.url) {
        const origin = new URL(buddyTab.url).origin;
        const proxyRes = await sendTabMessageToBridge(
          buddyTab.id,
          {
            type: "AI_BUDDY_PAGE_FETCH",
            url: `${origin}/api/public/extension/extract-document`,
            method: "POST",
            headers,
            body: reqBody,
          },
          "extract_document_proxy",
        );
        if (proxyRes?.ok && proxyRes.json) data = proxyRes.json;
      }
    }

    if (data && (data.ok || Object.keys(data.fields || {}).length > 0)) {
      return data;
    }
  } catch {
    // Fall back below
  }

  // 2. Direct user Gemini key multimodal fallback if binary image/PDF
  if (userApiKey && doc.base64Data) {
    try {
      const cleanBase64 = String(doc.base64Data).replace(/^data:[^;]+;base64,/, "");
      const mimeType = doc.mimeType === "image/jpg" ? "image/jpeg" : (doc.mimeType || "image/png");
      let geminiRes = null;
      for (const modelName of ["gemini-4-hydrogen", "gemini-3.8-flash", "gemini-3.1-flash-lite"]) {
        geminiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(userApiKey)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [
                {
                  parts: [
                    { inlineData: { mimeType, data: cleanBase64 } },
                    {
                      text: `Extract fields from ${doc.fileName} as strict JSON: {"documentType":"aadhaar|pan|invoice|shipping_label|id_card|form|other","confidence":"high|medium|low","fields":{"name":"","fatherName":"","dob":"","gender":"","phone":"","email":"","address":"","city":"","state":"","pincode":"","aadhaarNumber":"","panNumber":"","gstin":"","invoiceNumber":"","orderId":"","trackingNumber":"","company":""},"ambiguousFields":[]}. NEVER invent fields that are not clearly visible.`,
                    },
                  ],
                },
              ],
              generationConfig: { responseMimeType: "application/json" },
            }),
          },
        );
        if (geminiRes.ok) break;
        if (geminiRes.status !== 404 && geminiRes.status !== 400 && geminiRes.status !== 503) {
          break;
        }
      }
      if (geminiRes?.ok) {
        const gj = await geminiRes.json();
        const raw = gj.candidates?.[0]?.content?.parts?.[0]?.text;
        if (raw) {
          const parsedJson = JSON.parse(raw);
          const cleanFields = {};
          for (const [k, v] of Object.entries(parsedJson.fields || {})) {
            if (typeof v === "string" && v.trim() && !/^(n\/a|none|null|unknown)$/i.test(v.trim())) {
              cleanFields[k] = v.trim();
            }
          }
          return {
            ok: Object.keys(cleanFields).length > 0,
            documentType: parsedJson.documentType || "other",
            fileName: doc.fileName,
            confidence: parsedJson.confidence || "medium",
            fields: cleanFields,
            ambiguousFields: Array.isArray(parsedJson.ambiguousFields) ? parsedJson.ambiguousFields : [],
            provider: "gemini_direct_vision",
          };
        }
      }
    } catch {
      // Fall back to local parser below
    }
  }

  // 3. Deterministic offline text parser fallback
  if (doc.textContent && doc.textContent.trim()) {
    return parseDocumentTextLocallyExt(doc.textContent, doc.fileName);
  }

  return {
    ok: false,
    documentType: "other",
    fileName: doc.fileName,
    confidence: "low",
    fields: {},
    ambiguousFields: [],
    needsVisionKey: Boolean(doc.base64Data),
    notes:
      "Uploaded image/PDF could not be read without an active Vision AI key. Configure GEMINI_API_KEY on the server or in Settings → AI Model Hub, or upload a text-selectable document.",
  };
}

const pendingAskOptionsQueue = [];

async function ask(
  question,
  intent,
  history,
  buddySlug,
  customBuddyId,
  preferredModel,
  uploadedDocumentSummary,
  preferredProvider,
  actionContext,
) {
  const queuedExtras = pendingAskOptionsQueue.shift() || {};
  await ensureConversationBufferLoaded();
  const effectiveDocSummary =
    uploadedDocumentSummary || queuedExtras.uploadedDocumentSummary || undefined;
  const requestedPreferredProvider =
    preferredProvider || queuedExtras.preferredProvider || undefined;
  const effectiveActionContext = actionContext || queuedExtras.actionContext || undefined;

  const { session } = await chrome.storage.local.get("session");
  const { lastBase, userApiKey, customBaseUrl, selectedProvider } = await chrome.storage.local.get([
    "lastBase",
    "userApiKey",
    "customBaseUrl",
    "selectedProvider",
  ]);
  const effectivePreferredProvider = requestedPreferredProvider || selectedProvider || "gemini";

  let apiBase = await resolveExtensionApiBase(session, lastBase);

  const tab = await activeTab();
  let snapshot = null;
  let snapshotError = null;
  let screenshotBase64 = null;

  const snapRes = await getSnapshotForActiveTab();
  if (snapRes.ok) {
    snapshot = snapRes.snapshot;
  } else {
    snapshotError = snapRes.error;
  }

  // Visual fallback: capture visible tab screenshot if DOM access failed, yielded sparse content, or user asks visually
  const isDomSparse =
    !snapshot ||
    ((snapshot.controls?.length || 0) === 0 &&
      (snapshot.forms?.length || 0) === 0 &&
      (snapshot.text || "").trim().length < 80);
  const asksVisually =
    /\b(screen|screenshot|image|photo|layout|color|look|dikha|dekho|captcha)\b/i.test(question);
  if (
    (isDomSparse || intent === "visual_inspect" || asksVisually) &&
    tab?.id &&
    tab.url &&
    !RESTRICTED.test(tab.url)
  ) {
    screenshotBase64 = await captureTabScreenshot(tab.windowId);
  }

  const headers = { "content-type": "application/json" };
  if (session?.accessToken) {
    headers["authorization"] = `Bearer ${session.accessToken}`;
  }

  const formattedHistory = getFormattedHistory(history);
  const sanitizedSnapshot = snapshot
    ? {
        ...snapshot,
        forms: Array.isArray(snapshot.forms)
          ? snapshot.forms.map((f) => (f?.sensitive ? { ...f, value: undefined } : f))
          : snapshot.forms,
      }
    : null;

  const payload = JSON.stringify({
    question,
    intent: intent || "answer",
    snapshot: sanitizedSnapshot,
    screenshotBase64: screenshotBase64 || undefined,
    uploadedDocumentSummary: effectiveDocSummary || undefined,
    actionContext: effectiveActionContext || undefined,
    history: formattedHistory.length > 0 ? formattedHistory : undefined,
    buddySlug: buddySlug || undefined,
    customBuddyId: customBuddyId || undefined,
    preferredProvider: effectivePreferredProvider || undefined,
    preferredModel: preferredModel || undefined,
    userApiKey: userApiKey || undefined,
    customBaseUrl: customBaseUrl || undefined,
  });

  try {
    let res;
    const candidateHosts = [apiBase, DEFAULT_HOST, FALLBACK_PRE_HOST].filter(
      (h, idx, arr) => h && !h.includes(LEGACY_BROKEN_HOST) && arr.indexOf(h) === idx,
    );
    let lastNetErr = null;
    for (const host of candidateHosts) {
      try {
        res = await fetch(`${host}/api/public/extension/ask`, {
          method: "POST",
          headers,
          body: payload,
          credentials: "omit",
        });
        apiBase = host;
        lastNetErr = null;
        break;
      } catch (err) {
        lastNetErr = err;
      }
    }
    if (!res && lastNetErr) {
      throw lastNetErr;
    }

    let body = null;
    let isHtmlAuthRedirect = false;
    const contentType = res ? (res.headers.get("content-type") || "") : "";
    if (contentType.includes("text/html")) {
      const htmlText = await res.text().catch(() => "");
      if (htmlText.includes("302 Found") || htmlText.includes("__cookie_check") || res.redirected) {
        isHtmlAuthRedirect = true;
      }
    }

    if (!isHtmlAuthRedirect && res) {
      body = await res.json().catch(() => null);
    }

    // If direct fetch hit Cloud Run auth bridge or failed, attempt transparent proxy via open web tab
    if (isHtmlAuthRedirect || !body) {
      try {
        const allTabs = await chrome.tabs.query({});
        const buddyTab = allTabs.find((t) => {
          if (!t.url) return false;
          try {
            const u = new URL(t.url);
            if (u.hostname.includes("aistudio.google.com") || u.hostname.includes(LEGACY_BROKEN_HOST)) {
              return false;
            }
            return (
              u.hostname.includes("run.app") ||
              u.hostname === "localhost" ||
              u.hostname === "127.0.0.1" ||
              t.title?.includes("AI Buddy") ||
              t.title?.includes("your-ai-companion")
            );
          } catch {
            return false;
          }
        });

        if (buddyTab?.id && buddyTab?.url) {
          const tabOrigin = new URL(buddyTab.url).origin;
          const proxyRes = await sendTabMessageToBridge(
            buddyTab.id,
            {
              type: "AI_BUDDY_PAGE_FETCH",
              url: `${tabOrigin}/api/public/extension/ask`,
              method: "POST",
              headers,
              body: payload,
            },
            "ask_proxy",
          );

          if (proxyRes?.json && proxyRes.ok) {
            body = proxyRes.json;
            isHtmlAuthRedirect = false;
            apiBase = tabOrigin;
            chrome.storage.local.set({ lastBase: tabOrigin }).catch(() => {});
          }
        }
      } catch {
        // Continue to fallback
      }
    }

    const hasServerAiError =
      !body?.reply?.answer ||
      body?.aiFallbackUsed === true ||
      body?.activeProvider === "local_grounded" ||
      body?.reply?.answer?.includes("No AI provider is configured on the server") ||
      body?.reply?.answer?.includes("Add GEMINI_API_KEY") ||
      body?.error === "server_error" ||
      body?.error === "auth";

    if (isHtmlAuthRedirect || hasServerAiError) {
      const autonomousResult = await generateAutonomousCompanionReply({
        question,
        intent,
        snapshot: sanitizedSnapshot,
        screenshotBase64,
        buddySlug,
        customBuddyId,
        userApiKey,
        preferredProvider: effectivePreferredProvider,
        history: formattedHistory,
        actionContext: effectiveActionContext,
      });
      if (autonomousResult) {
        body = autonomousResult;
        isHtmlAuthRedirect = false;
      }
    }

    if (!body) {
      body = {};
    }

    if (res?.status === 401 && session) {
      await chrome.storage.local.remove("session");
      return ask(
        question,
        intent,
        history,
        buddySlug,
        customBuddyId,
        preferredModel,
        effectiveDocSummary,
        effectivePreferredProvider,
        effectiveActionContext,
      );
    }
    if (res && !res.ok && !body.reply?.answer) {
      const autonomousResult = await generateAutonomousCompanionReply({
        question,
        intent,
        snapshot: sanitizedSnapshot,
        screenshotBase64,
        buddySlug,
        customBuddyId,
        userApiKey,
        preferredProvider: effectivePreferredProvider,
        history: formattedHistory,
        actionContext: effectiveActionContext,
      });
      if (autonomousResult) {
        body = autonomousResult;
      } else {
        const errMsg =
          body.message ||
          body.error ||
          `Server returned error (${res.status}). Please verify connection.`;
        return { error: "server", message: errMsg };
      }
    }

    if (body.reply?.answer) {
      recordTurn(question, body.reply.answer);
    }

    if (body.highlightSelector && tab?.id && snapshot) {
      runTabScript({
        target: { tabId: tab.id },
        func: highlight,
        args: [
          body.highlightSelector,
          body.calloutTitle || null,
          body.calloutDescription || null,
          { outfit: body.reply?.outfit || "teal", buddyName: body.buddyName || "Buddy" },
        ],
        label: "ask:highlight",
      }).catch(() => undefined);
    }
    return { ...body, pageReadable: Boolean(snapshot), snapshot };
  } catch (err) {
    try {
      const autonomousResult = await generateAutonomousCompanionReply({
        question,
        intent,
        snapshot: sanitizedSnapshot,
        screenshotBase64,
        buddySlug,
        customBuddyId,
        userApiKey,
        preferredProvider: effectivePreferredProvider,
        history: formattedHistory,
        actionContext: effectiveActionContext,
      });
      if (autonomousResult) {
        if (autonomousResult.reply?.answer) {
          recordTurn(question, autonomousResult.reply.answer);
        }
        if (autonomousResult.highlightSelector && tab?.id && snapshot) {
          runTabScript({
            target: { tabId: tab.id },
            func: highlight,
            args: [
              autonomousResult.highlightSelector,
              autonomousResult.calloutTitle || null,
              autonomousResult.calloutDescription || null,
              { outfit: "teal", buddyName: autonomousResult.buddyName || "Buddy" },
            ],
            label: "ask:fallbackHighlight",
          }).catch(() => undefined);
        }
        return { ...autonomousResult, pageReadable: Boolean(snapshot), snapshot };
      }
    } catch {}

    return {
      error: "network",
      message: `Could not reach AI Buddy service at ${apiBase || DEFAULT_HOST}. Check your connection or update the Server URL in Settings.`,
    };
  }
}

/**
 * Coordinated Webpage Pointer:
 * Uses a lightweight pointer beacon at the side-panel edge with an extending pointer beam,
 * target pulse outline ring, and callout card — NEVER spawning a duplicate Buddy mascot on the page.
 */
function highlight(selector, title, description, options = {}) {
  const queryDeepSelector = (sel, root = document) => {
    if (!sel) return null;
    try {
      const direct = root.querySelector(sel);
      if (direct) return direct;
    } catch {
      return null;
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.shadowRoot) {
        const found = queryDeepSelector(sel, node.shadowRoot);
        if (found) return found;
      }
    }
    return null;
  };

  const el = queryDeepSelector(selector);
  if (!el) return false;
  const ID = "ai-buddy-arm-overlay";
  document.getElementById(ID)?.remove();

  // Scroll element into view smoothly if not already fully visible (NEVER clicks or modifies element)
  el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const accentColor =
    options?.outfit === "charcoal"
      ? "#475569"
      : options?.outfit === "blue"
        ? "#3b82f6"
        : options?.outfit === "coral"
          ? "#f97316"
          : options?.outfit === "sage"
            ? "#65a30d"
            : options?.outfit === "burgundy"
              ? "#be123c"
              : options?.outfit === "lilac"
                ? "#a855f7"
                : "#14b8a6";

  const host = document.createElement("div");
  host.id = ID;
  host.style.cssText =
    "position:fixed;inset:0;pointer-events:none;z-index:2147483647;overflow:hidden;";
  const root = host.attachShadow({ mode: "closed" });

  root.innerHTML = `
    <style>
      svg.canvas { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
      .pointer-beam-glow { fill: none; stroke: ${accentColor}; stroke-width: 8; stroke-linecap: round; opacity: 0.28; }
      .pointer-beam { fill: none; stroke: #2dd4bf; stroke-width: 3; stroke-linecap: round; stroke-dasharray: 6 6; }
      .ring { position: absolute; border: 3px solid #14b8a6; border-radius: 10px; box-shadow: 0 0 0 4px rgba(20,184,166,0.25), 0 0 28px rgba(20,184,166,0.6); pointer-events: none; }
      .ring.pulse { animation: pulseAnim 1.4s ease-out infinite; }
      @keyframes pulseAnim { 0% { box-shadow: 0 0 0 0 rgba(20,184,166,0.65); } 100% { box-shadow: 0 0 0 18px rgba(20,184,166,0); } }
      .card { position: absolute; max-width: 290px; padding: 10px 14px; border-radius: 12px; background: #0f172a; color: #f8fafc; font: 500 12px/1.4 system-ui, -apple-system, sans-serif; box-shadow: 0 10px 30px rgba(0,0,0,0.45); border: 1px solid rgba(20,184,166,0.6); opacity: 0; transform: translateY(6px); transition: opacity .3s ease, transform .3s ease; pointer-events: auto; }
      .card.show { opacity: 1; transform: none; }
      .card b { display: block; color: #5eead4; font-size: 13px; margin-bottom: 2px; }
    </style>
    <svg class="canvas">
      <defs>
        <filter id="ptrShadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="2" stdDeviation="2.5" flood-opacity="0.45" />
        </filter>
      </defs>
      <!-- Coordinated Edge Origin Beacon (from Side Panel Companion) -->
      <g id="pointerOrigin">
        <circle cx="0" cy="0" r="10" fill="${accentColor}" opacity="0.22" />
        <circle cx="0" cy="0" r="4.5" fill="#2dd4bf" stroke="#ffffff" stroke-width="1.5" />
      </g>
      <!-- Lightweight Pointer Beam -->
      <path class="pointer-beam-glow" id="beamGlowPath" />
      <path class="pointer-beam" id="beamPath" />
      <!-- Precision Pointer Reticle & Arrowhead -->
      <g id="pointerTip" filter="url(#ptrShadow)">
        <circle cx="0" cy="0" r="9" fill="rgba(20,184,166,0.18)" stroke="#2dd4bf" stroke-width="1.8" />
        <path d="M-8,-5 L6,0 L-8,5 L-5,0 Z" fill="#f8fafc" stroke="#0f172a" stroke-width="0.9" />
      </g>
    </svg>
    <!-- Target Element Highlight Pulse Ring (Retained) -->
    <div class="ring" id="ring"></div>
    <!-- Explanatory Callout Card (Retained) -->
    <div class="card" id="card"></div>
  `;

  document.documentElement.appendChild(host);

  const $ = (id) => root.getElementById(id);
  const card = $("card");
  const ring = $("ring");
  const pointerOrigin = $("pointerOrigin");
  const beamGlowPath = $("beamGlowPath");
  const beamPath = $("beamPath");
  const pointerTip = $("pointerTip");

  const safe = (t) =>
    String(t || "").replace(
      /[&<>"]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
    );

  card.innerHTML = `<b>${safe(title || "Yahan dekhiye")}</b>${safe(description || "Buddy is pointing right here.")}`;

  let progress = reduce ? 1 : 0;
  let isRetracting = false;
  const startTime = performance.now();
  let retractStartTime = 0;
  let frame = 0;

  const updatePositions = () => {
    if (!host.isConnected || !el.isConnected) {
      cleanupOverlay();
      return;
    }
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0 && el.getClientRects().length === 0) {
      ring.style.display = "none";
      return;
    }
    ring.style.display = "block";
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Position outline ring around target
    ring.style.left = `${Math.max(0, r.left - 6)}px`;
    ring.style.top = `${Math.max(0, r.top - 6)}px`;
    ring.style.width = `${r.width + 12}px`;
    ring.style.height = `${r.height + 12}px`;

    // Coordinated origin right at the side-panel edge aligned near the target vertical band
    const originX = vw - 10;
    const originY = Math.max(40, Math.min(vh - 40, r.top + r.height / 2));
    pointerOrigin.setAttribute("transform", `translate(${originX}, ${originY.toFixed(1)})`);

    const edgeX = r.right > vw - 40 ? r.left + r.width / 2 : r.right + 10;
    const targetX = Math.min(vw - 24, edgeX);
    const targetY = r.top + r.height / 2;

    const midX = originX - (originX - targetX) * 0.5;
    const midY = Math.min(originY, targetY) - 28;

    const t = isRetracting ? Math.max(0, 1 - progress) : progress;
    const ease = 1 - Math.pow(1 - t, 3);

    const currentX =
      (1 - ease) * (1 - ease) * originX + 2 * (1 - ease) * ease * midX + ease * ease * targetX;
    const currentY =
      (1 - ease) * (1 - ease) * originY + 2 * (1 - ease) * ease * midY + ease * ease * targetY;

    const ctrlX = originX + (midX - originX) * ease;
    const ctrlY = originY + (midY - originY) * ease;

    const pathData = `M ${originX} ${originY.toFixed(1)} Q ${ctrlX.toFixed(1)} ${ctrlY.toFixed(1)} ${currentX.toFixed(1)} ${currentY.toFixed(1)}`;
    beamGlowPath.setAttribute("d", pathData);
    beamPath.setAttribute("d", pathData);

    const angleDeg = (Math.atan2(currentY - ctrlY, currentX - ctrlX) * 180) / Math.PI;
    pointerTip.setAttribute(
      "transform",
      `translate(${currentX.toFixed(2)}, ${currentY.toFixed(2)}) rotate(${angleDeg.toFixed(1)})`,
    );

    // Position explanatory callout card clamped within viewport
    const cardWidth = Math.min(280, Math.max(180, vw - 24));
    let cardLeft = r.left;
    if (cardLeft + cardWidth > vw - 16) cardLeft = vw - cardWidth - 16;
    card.style.left = `${Math.max(12, cardLeft)}px`;

    const cardHeight = card.offsetHeight || 74;
    const belowPos = r.bottom + 14;
    const cardTop =
      belowPos + cardHeight + 12 <= vh
        ? belowPos
        : Math.max(12, Math.min(vh - cardHeight - 12, r.top - cardHeight - 14));
    card.style.top = `${cardTop}px`;

    if (t >= 0.98 && !isRetracting) {
      ring.classList.add("pulse");
      card.classList.add("show");
    }
  };

  const onViewportChange = () => updatePositions();
  let cleanedUp = false;
  const cleanupOverlay = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    cancelAnimationFrame(frame);
    window.removeEventListener("scroll", onViewportChange, true);
    window.removeEventListener("resize", onViewportChange);
    host.remove();
  };

  window.addEventListener("scroll", onViewportChange, { passive: true, capture: true });
  window.addEventListener("resize", onViewportChange, { passive: true });

  const tick = (now) => {
    if (cleanedUp) return;
    if (!reduce) {
      if (!isRetracting) {
        progress = Math.min(1, (now - startTime) / 550);
      } else {
        progress = Math.min(1, (now - retractStartTime) / 450);
      }
    }
    updatePositions();
    frame = requestAnimationFrame(tick);
  };

  frame = requestAnimationFrame(tick);

  // Smooth retraction after 10 seconds (long enough to identify)
  setTimeout(() => {
    retractStartTime = performance.now();
    isRetracting = true;
    ring.classList.remove("pulse");
    card.classList.remove("show");
    setTimeout(cleanupOverlay, 550);
  }, 10000);

  return true;
}

async function highlightElement(selector, title, description, buddyVisual) {
  const tab = await activeTab();
  if (!tab?.id || !tab.url || RESTRICTED.test(tab.url)) {
    return { ok: false, message: "Cannot access this browser tab." };
  }
  const run = await runTabScript({
    target: { tabId: tab.id },
    func: highlight,
    args: [selector, title || null, description || null, buddyVisual || {}],
    label: "highlight",
  });
  if (!run.ok) {
    return { ok: false, message: run.error || "Could not highlight element." };
  }
  return { ok: Boolean(run.results?.[0]?.result) };
}

async function clearHighlightOverlay() {
  const tab = await activeTab();
  if (!tab?.id || !tab.url || RESTRICTED.test(tab.url)) {
    return { ok: true };
  }
  const run = await runTabScript({
    target: { tabId: tab.id, allFrames: true },
    func: () => {
      document.getElementById("ai-buddy-arm-overlay")?.remove();
      document.getElementById("ai-buddy-highlight-host")?.remove();
    },
    label: "clearHighlight",
  });
  return { ok: run.ok };
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

  const smartFillFrameFunc = async (fieldsToFill, opts) => {
      const results = {
        filled: [],
        preserved: [],
        skipped: [],
        errors: [],
        pendingSubmission: null,
      };
      if (opts?.skipTopFrame && window === window.top) {
        return { ok: false, skippedTopFrame: true, results };
      }

      const SENSITIVE =
        /pass(?:word|wd)?|otp|(?<!postal[\s_-])(?<![a-z0-9])pin(?![a-z0-9]|[\s_-]*code\b)|cvv|cvc|secret|token|ssn|aadhaar|credit.?card|debit.?card|card.?number/i;
      const SUBMIT_PATTERN =
        /submit|sign\s*in|log\s*in|proceed|confirm|continue|checkout|purchase|pay|place\s*order|delete|send/i;

      const normalize = (str) =>
        String(str || "")
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "");

      const queryAllDeep = (selector, root = document) => {
        const out = [...root.querySelectorAll(selector)];
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
        let node;
        while ((node = walker.nextNode())) {
          if (node.shadowRoot) {
            out.push(...queryAllDeep(selector, node.shadowRoot));
          }
        }
        return out;
      };

      const queryDeepSelector = (sel, root = document) => {
        if (!sel) return null;
        try {
          const direct = root.querySelector(sel);
          if (direct) return direct;
        } catch {
          return null;
        }
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
        let node;
        while ((node = walker.nextNode())) {
          if (node.shadowRoot) {
            const found = queryDeepSelector(sel, node.shadowRoot);
            if (found) return found;
          }
        }
        return null;
      };

      const isContentEditableEl = (el) => {
        if (!el) return false;
        const ce = el.getAttribute?.("contenteditable");
        return (
          el.isContentEditable ||
          ce === "true" ||
          ce === "" ||
          ce === "plaintext-only"
        );
      };

      const isEditableEl = (el) => {
        if (!el || el.nodeType !== 1) return false;
        const tag = el.tagName;
        return (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          isContentEditableEl(el) ||
          ["textbox", "searchbox", "combobox"].includes(el.getAttribute("role"))
        );
      };

      const resolveEditableTarget = (el) => {
        if (!el) return null;
        if (isEditableEl(el)) return el;
        // Resolve <label for="..."> directly instead of guessing other inputs in the form
        if (el.tagName === "LABEL") {
          if (el.htmlFor) {
            const elRoot = el.getRootNode?.() || document;
            const target = elRoot.getElementById?.(el.htmlFor) || document.getElementById(el.htmlFor);
            return target && isEditableEl(target) ? target : null;
          }
          const nested = el.querySelector?.(
            'textarea, input:not([type="hidden"]), [contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"], [role="textbox"], [role="searchbox"], [role="combobox"], select',
          );
          return nested || null;
        }
        // Walk descendants (e.g., wrapper div around textarea/contenteditable like Google AI Studio prompt box)
        const inner = el.querySelector?.(
          'textarea, input:not([type="hidden"]), [contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"], [role="textbox"], [role="searchbox"], [role="combobox"], select',
        );
        if (inner) return inner;
        // Walk local field-group container only (never an entire <form>)
        const containerEditable = el
          .closest?.("[role='group'], .input-group, .field, .prompt-box, .composer")
          ?.querySelector?.(
            'textarea, input:not([type="hidden"]), [contenteditable="true"], [contenteditable=""], [role="textbox"]',
          );
        return containerEditable || null;
      };

      // Collect all candidate form inputs (light DOM + open Shadow DOMs)
      const elements = queryAllDeep(
        'input, textarea, select, [contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"], [role="textbox"], [role="searchbox"], [role="combobox"], [role="checkbox"], [role="radio"]',
      );

      const getFieldIdentifiers = (el) => {
        const elRoot = el.getRootNode?.() || document;
        const findById = (id) => elRoot.getElementById?.(id) || document.getElementById(id);
        const rawIdentifiers = [
          el.name,
          el.id,
          el.placeholder,
          el.getAttribute?.("data-placeholder"),
          el.getAttribute?.("aria-label"),
          el.getAttribute?.("title"),
          el.getAttribute?.("data-testid"),
          el.getAttribute?.("autocomplete"),
          el.type,
          el.getAttribute?.("role"),
        ].filter(Boolean);

        const labelledby = el.getAttribute?.("aria-labelledby");
        if (labelledby) {
          const parts = labelledby
            .split(/\s+/)
            .map((id) => findById(id)?.innerText)
            .filter(Boolean);
          if (parts.length) rawIdentifiers.push(parts.join(" "));
        }

        if (el.id) {
          try {
            const l =
              elRoot.querySelector?.(`label[for="${CSS.escape(el.id)}"]`) ||
              document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
            if (l?.innerText) rawIdentifiers.push(l.innerText);
          } catch {
            // ignore
          }
        }
        const wrap = el.closest?.("label");
        if (wrap?.innerText) rawIdentifiers.push(wrap.innerText);

        let prev = el.previousElementSibling;
        if (
          prev &&
          (prev.tagName === "LABEL" || prev.tagName === "SPAN" || prev.tagName === "P") &&
          prev.innerText &&
          (!prev.htmlFor || prev.htmlFor === el.id)
        ) {
          rawIdentifiers.push(prev.innerText);
        }

        // Check immediate field wrapper/fieldset/table cell when it holds only this input
        const fieldGroup = el.closest?.(".form-group, .field, .form-field, .input-group, fieldset");
        if (fieldGroup) {
          const groupControls = fieldGroup.querySelectorAll?.(
            'input:not([type="hidden"]), textarea, select, [contenteditable="true"], [role="textbox"], [role="searchbox"], [role="combobox"]',
          );
          if (!groupControls || groupControls.length <= 1) {
            const grpLabel = fieldGroup.querySelector?.("label, legend, .label, .field-label, .form-label");
            if (grpLabel?.innerText && (!grpLabel.htmlFor || grpLabel.htmlFor === el.id)) {
              rawIdentifiers.push(grpLabel.innerText);
            }
          }
        }
        const td = el.closest?.("td");
        if (td?.previousElementSibling?.innerText) {
          rawIdentifiers.push(td.previousElementSibling.innerText);
        }

        const isCheckOrRadioCtrl =
          el.type === "checkbox" ||
          el.type === "radio" ||
          el.getAttribute?.("role") === "checkbox" ||
          el.getAttribute?.("role") === "radio" ||
          el.getAttribute?.("role") === "switch";
        let next = el.nextElementSibling;
        if (
          next &&
          (next.tagName === "LABEL" || next.tagName === "SPAN") &&
          next.innerText &&
          ((next.tagName === "LABEL" && next.htmlFor && next.htmlFor === el.id) ||
            (isCheckOrRadioCtrl && (!next.htmlFor || next.htmlFor === el.id)))
        ) {
          rawIdentifiers.push(next.innerText);
        }
        const parentText = el.parentElement?.getAttribute?.("aria-label");
        if (parentText) rawIdentifiers.push(parentText);

        return rawIdentifiers.map(normalize).filter((s) => s.length > 0);
      };

      const getFieldDisplayLabel = (el) => {
        const elRoot = el.getRootNode?.() || document;
        if (el.id) {
          try {
            const l =
              elRoot.querySelector?.(`label[for="${CSS.escape(el.id)}"]`) ||
              document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
            if (l?.innerText?.trim()) return l.innerText.trim().slice(0, 60);
          } catch {}
        }
        const grp = el.closest?.(".form-group, .field, .form-field, fieldset")?.querySelector?.("label, legend");
        if (grp?.innerText?.trim() && (!grp.htmlFor || grp.htmlFor === el.id)) {
          return grp.innerText.trim().slice(0, 60);
        }
        return (
          el.getAttribute?.("aria-label") ||
          el.placeholder ||
          el.name ||
          el.id ||
          el.tagName.toLowerCase()
        );
      };

      const getUniqueSelector = (node) => {
        if (!node) return undefined;
        const nodeRoot = node.getRootNode?.() || document;
        const safeCount = (s) => {
          try {
            return (nodeRoot.querySelectorAll ? nodeRoot.querySelectorAll(s) : document.querySelectorAll(s)).length;
          } catch {
            return 0;
          }
        };
        if (node.id && safeCount(`#${CSS.escape(node.id)}`) === 1) {
          return `#${CSS.escape(node.id)}`;
        }
        if (node.name && safeCount(`[name="${CSS.escape(node.name)}"]`) === 1) {
          return `${node.tagName.toLowerCase()}[name="${CSS.escape(node.name)}"]`;
        }
        const parts = [];
        let cur = node;
        while (cur && cur.nodeType === 1 && cur !== nodeRoot && parts.length < 5) {
          let p = cur.tagName.toLowerCase();
          if (cur.id && safeCount(`#${CSS.escape(cur.id)}`) === 1) {
            parts.unshift(`#${CSS.escape(cur.id)}`);
            break;
          }
          const parent = cur.parentElement;
          if (parent) {
            const same = [...parent.children].filter((c) => c.tagName === cur.tagName);
            if (same.length > 1) p += `:nth-of-type(${same.indexOf(cur) + 1})`;
          }
          parts.unshift(p);
          cur = parent;
        }
        return parts.join(" > ");
      };

      const validateInteractability = (el) => {
        if (!el || !el.isConnected) return { ok: false, reason: "Element not attached to DOM." };
        if (el.closest?.("#ai-buddy-arm-overlay")) return { ok: false, reason: "Overlay element." };
        if (el.type === "hidden") return { ok: false, reason: "Hidden input field." };
        const fieldDescriptor = `${el.name || ""} ${el.id || ""} ${el.type || ""} ${el.autocomplete || ""} ${el.placeholder || ""}`;
        const isPasswordOrFinancial =
          el.type === "password" ||
          /pass(?:word|wd)?|otp|(?<!postal[\s_-])(?<![a-z0-9])pin(?![a-z0-9]|[\s_-]*code\b)|cvv|cvc|secret|token|credit.?card|debit.?card|card.?number/i.test(fieldDescriptor);
        const isSensitive =
          el.type === "password" ||
          SENSITIVE.test(fieldDescriptor);
        const allowedByDoc = opts?.fromUploadedDocument && !isPasswordOrFinancial;
        if (isSensitive && !opts?.explicitUserProvided && !allowedByDoc) {
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
        if (el.disabled || el.getAttribute?.("aria-disabled") === "true") {
          return { ok: false, reason: "Element is disabled." };
        }
        if (el.readOnly && el.type !== "checkbox" && el.type !== "radio") {
          return { ok: false, reason: "Element is read-only." };
        }
        return { ok: true, isSensitive };
      };

      const successfullyFilled = [];

      const FIELD_SYNONYMS = {
        name: [
          "naam",
          "fullname",
          "yourname",
          "legalname",
          "username",
          "contactname",
          "applicantname",
          "ownername",
          "firstname",
          "displayname",
          "vendorname",
          "customername",
          "sellername",
          "personname",
        ],
        naam: ["name", "fullname", "yourname", "firstname", "username", "customername"],
        fullname: ["name", "naam", "legalname", "username", "firstname"],
        legalname: ["company", "businessname", "firmname", "organization", "companyname", "name", "registeredname"],
        tradename: ["businessname", "storename", "shopname", "brandname", "company", "displayname"],
        email: ["mail", "emailaddress", "contactemail", "emailid", "useremail"],
        phone: [
          "mobile",
          "mobilenumber",
          "phoneno",
          "mobileno",
          "contact",
          "contactnumber",
          "tel",
          "phonenumber",
          "cellphone",
          "whatsapp",
        ],
        mobile: ["phone", "phonenumber", "mobilenumber", "tel", "contactnumber"],
        mobilenumber: ["phone", "mobile", "phonenumber", "tel", "contactnumber"],
        gstin: ["gst", "taxid", "gstnumber", "gstinnumber", "tin", "gstinno"],
        pan: ["pannumber", "pancard", "taxnumber", "panno"],
        pannumber: ["pan", "pancard", "taxnumber", "panno"],
        aadhaarnumber: ["aadhaar", "aadhar", "aadhaarno", "aadharno", "uidai", "uid", "documentnumber", "idnumber"],
        aadhaar: ["aadhaarnumber", "aadhar", "aadhaarno", "uidai", "uid", "documentnumber", "idnumber"],
        dob: ["dateofbirth", "birthdate", "birthday", "janamtithi"],
        fathername: ["father", "fathersname", "guardian", "guardianname", "parentname", "so"],
        gender: ["sex", "ling"],
        invoicenumber: ["invoice", "invoiceno", "billno", "billnumber"],
        orderid: ["order", "orderno", "ordernumber"],
        trackingnumber: ["tracking", "trackingid", "awb", "awbnumber", "waybill"],
        address: [
          "pata",
          "street",
          "line1",
          "addressline1",
          "shippingaddress",
          "billingaddress",
          "fulladdress",
          "pickupaddress",
          "location",
          "permanentaddress",
          "residentialaddress",
        ],
        pata: ["address", "street", "line1", "addressline1", "fulladdress", "location"],
        city: ["shehar", "town", "district", "municipality"],
        shehar: ["city", "town", "district"],
        state: ["rajya", "province", "region"],
        rajya: ["state", "province", "region"],
        country: ["desh", "nation"],
        desh: ["country", "nation"],
        pincode: ["zip", "zipcode", "postalcode", "pin", "postal"],
        pin: ["pincode", "zip", "zipcode", "postalcode", "postal"],
        search: ["query", "q", "searchbox", "find", "keyword", "searchinput", "searchquery"],
        searchbox: ["search", "query", "q", "find", "keyword", "searchinput", "searchquery"],
        describe: ["prompt", "description", "details", "idea", "app", "message", "describeanapp"],
        message: ["comment", "comments", "note", "notes", "msg", "description", "remarks", "body", "sandesh", "chat", "chatbox", "composer", "reply"],
        msg: ["message", "comment", "comments", "note", "notes", "description", "remarks", "body", "sandesh", "chat", "chatbox"],
        chat: ["chatbox", "message", "msg", "reply", "composer", "prompt", "comment", "typeamessage"],
        chatbox: ["chat", "message", "msg", "reply", "composer", "prompt", "typeamessage"],
        comment: ["message", "note", "notes", "feedback", "review"],
        subject: ["title", "topic", "heading"],
        company: ["organization", "org", "firm", "business", "businessname", "legalname"],
        password: ["pass", "passwd", "pwd"],
      };

      const dispatchRealClick = (targetEl) => {
        const r = targetEl.getBoundingClientRect();
        const cx = Math.round(r.left + Math.max(1, r.width / 2));
        const cy = Math.round(r.top + Math.max(1, r.height / 2));
        const baseEv = {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: cx,
          clientY: cy,
          screenX: cx,
          screenY: cy,
          button: 0,
        };
        const ptrEv = { ...baseEv, buttons: 1, pointerId: 1, pointerType: "mouse", isPrimary: true };
        try {
          targetEl.dispatchEvent(new PointerEvent("pointerover", ptrEv));
          targetEl.dispatchEvent(new PointerEvent("pointerdown", ptrEv));
        } catch {}
        targetEl.dispatchEvent(new MouseEvent("mousedown", { ...baseEv, buttons: 1 }));
        targetEl.focus?.();
        try {
          targetEl.dispatchEvent(new PointerEvent("pointerup", { ...ptrEv, buttons: 0 }));
        } catch {}
        targetEl.dispatchEvent(new MouseEvent("mouseup", { ...baseEv, buttons: 0 }));
        targetEl.click();
      };

      const claimedElements = new Set();

      const findCandidateForKey = (key, explicitSelector, entryVal) => {
        // 1. Explicit CSS selector override
        if (explicitSelector) {
          const selEl = resolveEditableTarget(queryDeepSelector(explicitSelector));
          if (selEl && validateInteractability(selEl).ok) return { el: selEl };
        }

        // 2. Current / highlighted / active / semantic value inference (with ambiguity check!)
        if (key === "__CURRENT__" || key === "__PRIMARY__") {
          if (opts?.fallbackSelector) {
            const hlEl = resolveEditableTarget(queryDeepSelector(opts.fallbackSelector));
            if (hlEl && validateInteractability(hlEl).ok) return { el: hlEl };
          }
          const active = resolveEditableTarget(document.activeElement);
          if (active && active !== document.body && validateInteractability(active).ok) return { el: active };
          const visibleInputs = elements.filter(
            (el) => validateInteractability(el).ok && !claimedElements.has(el),
          );
          if (visibleInputs.length === 1) return { el: visibleInputs[0] };

          // Try semantic inference from value format (mobile number, email, URL)
          const rawValStr = String(entryVal || "").trim();
          if (visibleInputs.length > 1 && rawValStr) {
            let inferredKey = null;
            if (/^(\+?\d{1,3}[\s-]?)?[6-9]\d{9}$/.test(rawValStr.replace(/\s+/g, ""))) {
              inferredKey = "phone";
            } else if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(rawValStr)) {
              inferredKey = "email";
            }
            if (inferredKey) {
              const inferredRes = findCandidateForKey(inferredKey, null, rawValStr);
              if (inferredRes?.el) return inferredRes;
              if (inferredRes?.ambiguous) return inferredRes;
            }
          }

          if (visibleInputs.length > 1 && opts?.fromChatCommand) {
            const emptyInputs = visibleInputs.filter((el) => {
              const cur = isContentEditableEl(el) ? el.innerText : el.value;
              return !String(cur || "").trim();
            });
            const pool = emptyInputs.length > 0 ? emptyInputs : visibleInputs;
            if (pool.length === 1) return { el: pool[0] };
            return {
              ambiguous: true,
              key,
              candidates: pool.slice(0, 6).map((el, idx) => ({
                index: idx + 1,
                label: getFieldDisplayLabel(el),
                selector: getUniqueSelector(el),
              })),
            };
          }

          if (visibleInputs.length > 0) return { el: visibleInputs[0] };
          return { el: null };
        }

        const normKey = normalize(key);
        if (!normKey) return { el: null };
        const keyCandidates = [normKey, ...(FIELD_SYNONYMS[normKey] || [])].filter((k) => k.length > 0);

        const scoredCandidates = [];
        for (const el of elements) {
          if (claimedElements.has(el)) continue;
          const check = validateInteractability(el);
          if (!check.ok) continue;

          const ids = getFieldIdentifiers(el);
          let score = 0;
          for (const id of ids) {
            if (!id) continue;
            if (normKey === "address" && /(?:email|mail|ip|mac|web|url)address/.test(id)) {
              continue;
            }
            if (id === normKey) {
              score = Math.max(score, 100);
            } else if (keyCandidates.includes(id)) {
              score = Math.max(score, 85);
            } else {
              for (const k of keyCandidates) {
                if (id.includes(k) && k.length >= 3) {
                  score = Math.max(score, k === normKey ? 70 : 55);
                } else if (k.includes(id) && id.length >= 4) {
                  score = Math.max(score, 40);
                }
              }
            }
          }
          if (score > 0) {
            scoredCandidates.push({ el, score });
          }
        }

        scoredCandidates.sort((a, b) => b.score - a.score);
        if (scoredCandidates.length > 0) {
          const topScore = scoredCandidates[0].score;
          const tied = scoredCandidates.filter((c) => c.score === topScore);
          if (tied.length > 1 && opts?.fromChatCommand) {
            // If exact labels differ (e.g. "Billing Phone" vs "Shipping Phone"), ask user to disambiguate
            const distinctLabels = new Set(tied.map((t) => normalize(getFieldDisplayLabel(t.el))));
            if (distinctLabels.size > 1) {
              return {
                ambiguous: true,
                key,
                candidates: tied.slice(0, 6).map((c, idx) => ({
                  index: idx + 1,
                  label: getFieldDisplayLabel(c.el),
                  selector: getUniqueSelector(c.el),
                })),
              };
            }
          }
          return { el: scoredCandidates[0].el };
        }

        // Fallback: look for visible text/placeholder overlay element matching the key and resolve to nearby editable
        const overlays = queryAllDeep("div, span, label, p").filter((node) => {
          if (node.closest?.("#ai-buddy-arm-overlay")) return false;
          const txt = normalize(node.innerText || node.getAttribute?.("placeholder") || "");
          if (normKey === "address" && /(?:email|mail|ip|mac|web|url)address/.test(txt)) return false;
          return txt && txt.length < 80 && keyCandidates.some((k) => k.length >= 3 && txt.includes(k));
        });
        for (const ov of overlays) {
          const resolved = resolveEditableTarget(ov);
          if (resolved && validateInteractability(resolved).ok && !claimedElements.has(resolved)) {
            return { el: resolved };
          }
        }

        return { el: null };
      };

      // Build ordered fill entries from either array (explicitPairs) or object (fieldsToFill)
      const entries = Array.isArray(opts?.explicitPairs)
        ? opts.explicitPairs.map((p) => ({
            key: p.target || p.key || "__CURRENT__",
            val: p.value,
            overwrite: p.overwrite ?? opts?.overwrite,
            selector: p.selector,
          }))
        : Object.entries(fieldsToFill || {}).map(([key, val]) => ({
            key,
            val,
            overwrite: opts?.overwrite,
            selector: opts?.selector,
          }));

      for (const entry of entries) {
        const { key, val, overwrite, selector: entrySel } = entry;
        if (val === undefined || val === null) continue;

        const matchRes = findCandidateForKey(key, entrySel, val);
        if (matchRes?.ambiguous && Array.isArray(matchRes.candidates) && matchRes.candidates.length > 1) {
          return {
            ok: false,
            ambiguous: true,
            target: key,
            value: val,
            candidates: matchRes.candidates,
            results,
            message: `Multiple matching fields found for "${key === "__CURRENT__" ? "input box" : key}". Please choose which field.`,
          };
        }

        const candidate = matchRes?.el || null;
        if (!candidate) {
          results.skipped.push({ key, value: val, reason: "Field not found on active page" });
          continue;
        }
        claimedElements.add(candidate);

        const check = validateInteractability(candidate);
        if (!check.ok) {
          results.skipped.push({ key, value: val, reason: check.reason });
          continue;
        }

        const isCheckbox =
          candidate.type === "checkbox" || candidate.getAttribute?.("role") === "checkbox" || candidate.getAttribute?.("role") === "switch";
        const isRadio =
          candidate.type === "radio" || candidate.getAttribute?.("role") === "radio";
        const isCe = isContentEditableEl(candidate);

        // Preservation rule: if field already has a non-empty value and overwrite is not true, preserve it
        const currentVal = isCheckbox
          ? candidate.checked || candidate.getAttribute?.("aria-checked") === "true"
            ? "checked"
            : ""
          : isCe
            ? candidate.innerText || candidate.textContent || ""
            : candidate.value || "";

        if (!isCheckbox && !isRadio && String(currentVal).trim() && !overwrite) {
          results.preserved.push({
            key,
            field: candidate.name || candidate.id || candidate.placeholder || key,
            existingValue: check.isSensitive ? "••••••" : String(currentVal).slice(0, 60),
            reason: "Preserved existing user input",
          });
          continue;
        }

        try {
          candidate.scrollIntoView({ behavior: "smooth", block: "center" });
          candidate.focus();

          let strVal = String(val);
          if (candidate.tagName === "INPUT" && candidate.type === "date") {
            const dmy = strVal.trim().match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
            if (dmy) {
              strVal = `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
            }
          }

          const isTextBoxLike =
            !isCheckbox && !isRadio && candidate.tagName !== "SELECT" && !isCe;
          if (
            isTextBoxLike &&
            typeof candidate.maxLength === "number" &&
            candidate.maxLength > 0 &&
            candidate.type !== "date" &&
            strVal.length > candidate.maxLength
          ) {
            results.skipped.push({
              key,
              field:
                candidate.name ||
                candidate.id ||
                candidate.placeholder ||
                candidate.getAttribute?.("aria-label") ||
                key,
              value: check.isSensitive ? "••••••" : strVal,
              reason: `Value length (${strVal.length}) exceeds field maxlength (${candidate.maxLength})`,
            });
            continue;
          }

          if (candidate.tagName === "SELECT") {
            const normVal = normalize(strVal);
            const opt = [...candidate.options].find(
              (o) =>
                normalize(o.value) === normVal ||
                normalize(o.text) === normVal ||
                o.text.toLowerCase().includes(strVal.toLowerCase()),
            );
            const targetVal = opt ? opt.value : strVal;
            const nativeSelectSetter = Object.getOwnPropertyDescriptor(
              window.HTMLSelectElement.prototype,
              "value",
            )?.set;
            if (nativeSelectSetter) {
              nativeSelectSetter.call(candidate, targetVal);
            } else {
              candidate.value = targetVal;
            }
            if (candidate._valueTracker) candidate._valueTracker.setValue("");
            candidate.dispatchEvent(new Event("input", { bubbles: true }));
            candidate.dispatchEvent(new Event("change", { bubbles: true }));
          } else if (candidate.getAttribute?.("role") === "combobox" || candidate.getAttribute?.("role") === "listbox") {
            const isComboInput = candidate.tagName === "INPUT" || candidate.tagName === "TEXTAREA";
            if (isComboInput) {
              const proto =
                candidate.tagName === "TEXTAREA"
                  ? window.HTMLTextAreaElement.prototype
                  : window.HTMLInputElement.prototype;
              const nativeSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
              if (nativeSetter) nativeSetter.call(candidate, strVal);
              else candidate.value = strVal;
              if (candidate._valueTracker) candidate._valueTracker.setValue("");
              candidate.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
            }
            dispatchRealClick(candidate);
            const isOptVisible = (o) => {
              const r = o.getBoundingClientRect();
              const cs = window.getComputedStyle(o);
              return (
                (r.width > 0 || r.height > 0 || o.getClientRects().length > 0) &&
                cs.display !== "none" &&
                cs.visibility !== "hidden"
              );
            };
            let roleOptions = [];
            for (let poll = 0; poll < 6; poll++) {
              await new Promise((r) => setTimeout(r, 60));
              roleOptions = queryAllDeep('[role="option"]').filter(isOptVisible);
              if (roleOptions.length > 0) break;
            }
            const allOptions =
              roleOptions.length > 0
                ? roleOptions
                : queryAllDeep('[role="menuitem"], li').filter(isOptVisible);
            const normVal = normalize(strVal);
            const optEl =
              allOptions.find(
                (o) =>
                  normalize(o.innerText || o.textContent || o.getAttribute?.("data-value") || "") === normVal,
              ) ||
              allOptions.find((o) =>
                normalize(o.innerText || o.textContent || o.getAttribute?.("data-value") || "").includes(normVal),
              );
            if (optEl) {
              optEl.scrollIntoView?.({ block: "nearest" });
              dispatchRealClick(optEl);
              await new Promise((r) => setTimeout(r, 80));
            } else if (!isComboInput) {
              candidate.innerText = strVal;
              candidate.dispatchEvent(new InputEvent("input", { bubbles: true, data: strVal }));
            }
            if (isComboInput && candidate.value !== strVal) {
              candidate.dispatchEvent(new Event("change", { bubbles: true }));
            }
          } else if (isCheckbox) {
            const desired =
              typeof val === "boolean"
                ? val
                : !/^(false|0|no|uncheck|off|nahi)$/i.test(strVal.trim());
            const currentlyChecked =
              candidate.type === "checkbox"
                ? candidate.checked
                : candidate.getAttribute?.("aria-checked") === "true";
            if (currentlyChecked !== desired) {
              dispatchRealClick(candidate);
            }
            if (candidate.type === "checkbox" && candidate.checked !== desired) {
              candidate.checked = desired;
              candidate.dispatchEvent(new Event("input", { bubbles: true }));
              candidate.dispatchEvent(new Event("change", { bubbles: true }));
            }
          } else if (isRadio) {
            if (!candidate.checked) {
              dispatchRealClick(candidate);
            }
            if (candidate.type === "radio" && !candidate.checked) {
              candidate.checked = true;
              candidate.dispatchEvent(new Event("input", { bubbles: true }));
              candidate.dispatchEvent(new Event("change", { bubbles: true }));
            }
          } else if (isCe) {
            // Contenteditable editors (React, Lexical, ProseMirror, Angular, Google AI Studio)
            try {
              const selObj = window.getSelection();
              const range = document.createRange();
              range.selectNodeContents(candidate);
              selObj?.removeAllRanges();
              selObj?.addRange(range);
              document.execCommand("selectAll", false, null);
              const inserted = document.execCommand("insertText", false, strVal);
              if (!inserted || !(candidate.innerText || candidate.textContent || "").includes(strVal)) {
                candidate.innerText = strVal;
              }
            } catch {
              candidate.innerText = strVal;
            }
            try {
              candidate.dispatchEvent(
                new InputEvent("beforeinput", {
                  bubbles: true,
                  cancelable: true,
                  inputType: "insertText",
                  data: strVal,
                }),
              );
            } catch {}
            candidate.dispatchEvent(
              new InputEvent("input", {
                bubbles: true,
                cancelable: true,
                inputType: "insertText",
                data: strVal,
              }),
            );
            candidate.dispatchEvent(new Event("change", { bubbles: true }));
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
            if (candidate._valueTracker) {
              candidate._valueTracker.setValue("");
            }
            try {
              candidate.dispatchEvent(
                new InputEvent("input", {
                  bubbles: true,
                  cancelable: true,
                  inputType: "insertText",
                  data: strVal,
                }),
              );
            } catch {
              candidate.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
            }
            candidate.dispatchEvent(new Event("change", { bubbles: true }));
            candidate.dispatchEvent(new Event("blur", { bubbles: true }));
          }

          // Visual green feedback outline on filled field
          const prevOutline = candidate.style.outline;
          candidate.style.outline = "2px solid #10b981";
          setTimeout(() => {
            candidate.style.outline = prevOutline;
          }, 3000);

          // Post-action verification check
          let verified = false;
          let actualReadback = "";
          if (isCheckbox) {
            const desired =
              typeof val === "boolean"
                ? val
                : !/^(false|0|no|uncheck|off|nahi)$/i.test(strVal.trim());
            const checkedNow =
              candidate.type === "checkbox"
                ? Boolean(candidate.checked)
                : candidate.getAttribute?.("aria-checked") === "true";
            verified = checkedNow === desired;
            actualReadback = String(checkedNow);
          } else if (isRadio) {
            const checkedNow =
              candidate.type === "radio"
                ? Boolean(candidate.checked)
                : candidate.getAttribute?.("aria-checked") === "true";
            verified = checkedNow === true;
            actualReadback = String(checkedNow);
          } else if (candidate.tagName === "SELECT") {
            const selText = candidate.options?.[candidate.selectedIndex]?.text || "";
            actualReadback = selText || candidate.value || "";
            verified =
              Boolean(candidate.value) &&
              (normalize(candidate.value) === normalize(strVal) ||
                normalize(selText).includes(normalize(strVal)) ||
                candidate.value === strVal);
          } else if (
            candidate.getAttribute?.("role") === "combobox" ||
            candidate.getAttribute?.("role") === "listbox"
          ) {
            const comboVal =
              candidate.value || candidate.innerText || candidate.textContent || "";
            actualReadback = comboVal;
            verified =
              comboVal === strVal ||
              comboVal.includes(strVal) ||
              normalize(comboVal).includes(normalize(strVal));
          } else {
            const verifiedValue = isCe
              ? candidate.innerText || candidate.textContent || ""
              : candidate.value || "";
            actualReadback = verifiedValue;
            verified =
              verifiedValue === strVal ||
              verifiedValue.includes(strVal) ||
              (normalize(strVal).length > 0 && normalize(verifiedValue).includes(normalize(strVal)));
          }

          const fieldLabel =
            candidate.name ||
            candidate.id ||
            candidate.placeholder ||
            candidate.getAttribute?.("aria-label") ||
            key;
          const maskedVal = check.isSensitive
            ? /aadhaar|aadhar/i.test(`${key} ${candidate.name || ""} ${candidate.id || ""}`) &&
              strVal.replace(/\D/g, "").length >= 4
              ? `XXXX-XXXX-${strVal.replace(/\D/g, "").slice(-4)}`
              : "••••••"
            : strVal;

          if (verified) {
            results.filled.push({
              key,
              field: fieldLabel,
              value: maskedVal,
              verified: true,
            });
            successfullyFilled.push(candidate);
          } else {
            results.errors.push({
              key,
              field: fieldLabel,
              error: actualReadback
                ? `Field rejected or altered value (got "${check.isSensitive ? "••••••" : String(actualReadback).slice(0, 60)}")`
                : `Field "${fieldLabel}" rejected or cleared the value`,
            });
          }
        } catch (err) {
          results.errors.push({ key, error: String(err?.message || err) });
        }
      }

      // 4. Detect Submit Trigger for explicit confirmation gate
      if (successfullyFilled.length > 0 && !opts?.noSubmitPrompt) {
        for (const el of successfullyFilled) {
          const form = el.closest?.("form");
          const btn = form
            ? form.querySelector(
                'button[type="submit"], input[type="submit"], button:not([type="button"])',
              )
            : null;
          if (btn) {
            results.pendingSubmission = {
              submitButtonSelector: btn.id
                ? `#${CSS.escape(btn.id)}`
                : form?.id
                  ? `#${CSS.escape(form.id)} button[type="submit"]`
                  : 'button[type="submit"]',
              submitButtonText: btn.innerText || btn.value || "Submit Form",
              formSelector: form?.id ? `#${CSS.escape(form.id)}` : undefined,
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
                submitButtonSelector: btn.id ? `#${CSS.escape(btn.id)}` : undefined,
                submitButtonText: text.trim() || "Submit",
              };
              break;
            }
          }
        }
      }

      return { ok: true, results };
  };

  const mainRun = await runTabScript({
    target: { tabId: tab.id },
    func: smartFillFrameFunc,
    args: [fields, options],
    label: "smartFill:topFrame",
  });

  const mainResult = mainRun.results?.[0]?.result || {
    ok: false,
    message: mainRun.error || "Form filling execution failed.",
  };

  // Iframe fallback: if top frame failed, filled/preserved nothing, OR left fields not found, check subframes
  const topSkippedMissing = (mainResult.results?.skipped || []).filter(
    (s) => s.reason === "Field not found on active page",
  );
  const topFilledCount = mainResult.results?.filled?.length || 0;
  const topPreservedCount = mainResult.results?.preserved?.length || 0;

  if (
    !mainResult.ambiguous &&
    (!mainResult.ok ||
      (topFilledCount === 0 && topPreservedCount === 0) ||
      topSkippedMissing.length > 0)
  ) {
    let subFieldsArg = fields;
    let subOptionsArg = options;

    if (mainResult.ok && (topFilledCount > 0 || topPreservedCount > 0) && topSkippedMissing.length > 0) {
      const missingKeySet = new Set(topSkippedMissing.map((s) => s.key));
      if (Array.isArray(options?.explicitPairs)) {
        const filteredPairs = options.explicitPairs.filter((p) =>
          missingKeySet.has(p.target || p.key || "__CURRENT__"),
        );
        subOptionsArg = { ...options, explicitPairs: filteredPairs };
      } else if (fields && typeof fields === "object") {
        const filteredFields = {};
        for (const [k, v] of Object.entries(fields)) {
          if (missingKeySet.has(k)) filteredFields[k] = v;
        }
        subFieldsArg = filteredFields;
      }
    }

    subOptionsArg = { ...(subOptionsArg || {}), skipTopFrame: true };

    const subRun = await runTabScript({
      target: { tabId: tab.id, allFrames: true },
      func: smartFillFrameFunc,
      args: [subFieldsArg, subOptionsArg],
      label: "smartFill:allFrames",
    });

    const subMatches = (subRun.results || []).filter(
      (r) =>
        r.frameId !== 0 &&
        r.result?.ok &&
        ((r.result.results?.filled?.length || 0) > 0 || (r.result.results?.preserved?.length || 0) > 0),
    );

    if (subMatches.length > 0) {
      if (!mainResult.ok || (topFilledCount === 0 && topPreservedCount === 0)) {
        return subMatches[0].result;
      }
      // Merge subframe results into top-frame result
      const merged = mainResult.results;
      const resolvedKeys = new Set();
      for (const sm of subMatches) {
        const sr = sm.result.results;
        for (const f of sr.filled || []) {
          merged.filled.push(f);
          resolvedKeys.add(f.key);
        }
        for (const p of sr.preserved || []) {
          merged.preserved.push(p);
          resolvedKeys.add(p.key);
        }
        for (const e of sr.errors || []) {
          merged.errors.push(e);
        }
        if (!merged.pendingSubmission && sr.pendingSubmission) {
          merged.pendingSubmission = sr.pendingSubmission;
        }
      }
      merged.skipped = merged.skipped.filter(
        (s) => !(s.reason === "Field not found on active page" && resolvedKeys.has(s.key)),
      );
    }
  }

  return mainResult;
}

async function findContentOnPage(query, options = {}) {
  const tab = await activeTab();
  if (!tab?.id || !tab.url || RESTRICTED.test(tab.url)) {
    return { ok: false, message: "Cannot search content on this browser page." };
  }

  const findFrameFunc = (searchQuery, opts) => {
      if (!searchQuery || !searchQuery.trim()) {
        return { ok: false, message: "Empty search query provided." };
      }
      const q = searchQuery.trim().toLowerCase();
      const normalize = (t) => (t || "").replace(/\s+/g, " ").trim();

      const queryAllDeep = (selector, root = document) => {
        const out = [...root.querySelectorAll(selector)];
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
        let node;
        while ((node = walker.nextNode())) {
          if (node.shadowRoot) {
            out.push(...queryAllDeep(selector, node.shadowRoot));
          }
        }
        return out;
      };

      const getSelector = (el) => {
        const elRoot = el.getRootNode?.() || document;
        const safeQsaCount = (root, s) => {
          try {
            return (root.querySelectorAll ? root.querySelectorAll(s) : document.querySelectorAll(s)).length;
          } catch {
            return 0;
          }
        };
        if (el.id && safeQsaCount(elRoot, `#${CSS.escape(el.id)}`) === 1) {
          return `#${CSS.escape(el.id)}`;
        }
        const parts = [];
        let cur = el;
        while (cur && cur.nodeType === 1 && cur !== elRoot && parts.length < 5) {
          let p = cur.tagName.toLowerCase();
          if (cur.id && safeQsaCount(elRoot, `#${CSS.escape(cur.id)}`) === 1) {
            parts.unshift(`#${CSS.escape(cur.id)}`);
            break;
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

      const isVisible = (el) => {
        if (!el || el.nodeType !== 1) return false;
        const r = el.getBoundingClientRect();
        const s = window.getComputedStyle(el);
        return (
          (r.width > 0 || r.height > 0 || el.getClientRects().length > 0) &&
          s.visibility !== "hidden" &&
          s.display !== "none" &&
          s.opacity !== "0"
        );
      };

      const getElementSearchText = (el) => {
        const root = el.getRootNode?.() || document;
        const parts = [
          el.innerText,
          el.textContent,
          el.getAttribute?.("placeholder"),
          el.getAttribute?.("data-placeholder"),
          el.getAttribute?.("aria-label"),
          el.getAttribute?.("title"),
          el.getAttribute?.("alt"),
          el.getAttribute?.("name"),
          el.querySelector?.("img[alt]")?.getAttribute("alt"),
          el.querySelector?.("svg title")?.textContent,
          el.value,
        ];
        const labelledby = el.getAttribute?.("aria-labelledby");
        if (labelledby) {
          for (const lid of labelledby.split(/\s+/)) {
            const le = root.getElementById?.(lid) || document.getElementById(lid);
            if (le?.innerText) parts.push(le.innerText);
          }
        }
        if (el.id) {
          try {
            const l =
              root.querySelector?.(`label[for="${CSS.escape(el.id)}"]`) ||
              document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
            if (l?.innerText) parts.push(l.innerText);
          } catch {}
        }
        return normalize(parts.filter(Boolean).join(" ").replace(/[-_]+/g, " ")).toLowerCase();
      };

      const STOPWORDS = [
        "tab", "button", "link", "section", "menu", "option", "icon", "bar", "field", "box", "input",
        "the", "a", "an", "this", "that", "par", "pe", "mein", "me", "ko", "ka", "ki", "ke",
        "khaa", "kha", "hai", "hain", "kahan", "kidhar", "kaha", "buddy", "point", "highlight", "karo",
      ];
      const rawTokens = q
        .replace(/[-_]+/g, " ")
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((t) => t.length > 1 && !STOPWORDS.includes(t));

      const effectiveQuery = rawTokens.length > 0 ? rawTokens.join(" ") : q;

      const tokenMatchesText = (text, tok) => {
        if (text.includes(tok)) return true;
        if (tok.endsWith("s") && text.includes(tok.slice(0, -1))) return true;
        if (!tok.endsWith("s") && text.includes(`${tok}s`)) return true;
        return false;
      };

      const isFullMatch = (text) => {
        if (text.includes(effectiveQuery) || text.includes(q)) return true;
        if (rawTokens.length > 1) {
          return rawTokens.every((tok) => tokenMatchesText(text, tok));
        }
        return rawTokens.length === 1 && tokenMatchesText(text, rawTokens[0]);
      };

      const rawCandidates = queryAllDeep(
        "input, textarea, select, [contenteditable='true'], [contenteditable=''], [role=textbox], [role=searchbox], [role=combobox], [role=checkbox], [role=radio], button, a, [role=button], [role=tab], [role=link], label, p, span, h1, h2, h3, h4, h5, h6, li, td, th, [role=cell], [role=row], div.badge, div.tag, div.chip, div[aria-label], div[data-placeholder]",
      ).filter((el) => {
        if (!isVisible(el)) return false;
        if (el.closest?.("#ai-buddy-arm-overlay")) return false;
        const text = getElementSearchText(el);
        if (!text) return false;
        if (isFullMatch(text)) return true;
        if (rawTokens.length > 0) {
          return rawTokens.some((tok) => tokenMatchesText(text, tok));
        }
        return false;
      });

      const fullMatches = rawCandidates.filter((el) => isFullMatch(getElementSearchText(el)));
      const allTokensMatched = fullMatches.length > 0;
      const candidates = allTokensMatched ? fullMatches : rawCandidates;

      // Keep specific interactive/form/leaf nodes instead of huge ancestor wrappers
      const leafCandidates = candidates.filter((el) => {
        const isFormOrCtrl =
          el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.tagName === "SELECT" ||
          el.tagName === "BUTTON" ||
          el.tagName === "A" ||
          el.getAttribute?.("role") === "tab" ||
          el.getAttribute?.("role") === "button" ||
          el.getAttribute?.("role") === "textbox";
        if (isFormOrCtrl) return true;
        const hasMatchingChild = candidates.some((other) => other !== el && el.contains(other));
        return !hasMatchingChild || el.children.length === 0;
      });

      const wantsSearchInput = /\bsearch\s*(?:box|bar|input|field)\b/i.test(searchQuery);
      const isSearchInputEl = (el) => {
        if (!el) return false;
        const role = el.getAttribute?.("role") || "";
        const isEditable =
          el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          role === "searchbox" ||
          role === "textbox" ||
          role === "combobox";
        if (!isEditable || el.type === "submit" || el.type === "button" || el.type === "hidden") {
          return false;
        }
        const meta = `${el.type || ""} ${el.name || ""} ${el.id || ""} ${el.getAttribute?.("placeholder") || ""} ${el.getAttribute?.("aria-label") || ""}`.toLowerCase();
        return el.type === "search" || role === "searchbox" || meta.includes("search") || meta.includes("query");
      };

      // Score and sort candidates
      const scoreEl = (el) => {
        const text = getElementSearchText(el);
        let s = 0;
        if (text === effectiveQuery || text === q) s += 100;
        if (text.includes(effectiveQuery) || text.includes(q)) s += 50;
        if (text.startsWith(effectiveQuery)) s += 30;
        for (const tok of rawTokens) {
          if (tokenMatchesText(text, tok)) s += 15;
        }
        if (["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A"].includes(el.tagName)) s += 20;
        if (["textbox", "button", "tab", "combobox", "searchbox"].includes(el.getAttribute?.("role"))) s += 15;
        if (wantsSearchInput) {
          if (isSearchInputEl(el)) s += 120;
          else if (el.tagName === "BUTTON" || el.type === "submit") s -= 80;
        }
        s -= Math.min(40, Math.floor(text.length / 20));
        return s;
      };

      const filteredCandidates = wantsSearchInput
        ? (() => {
            const onlyInputs = leafCandidates.filter(isSearchInputEl);
            if (onlyInputs.length > 0) return onlyInputs;
            const deepSearchInputs = queryAllDeep(
              'input[type="search"], [role="searchbox"], input[placeholder*="search" i], input[name*="search" i], input[aria-label*="search" i], input[id*="search" i]',
            ).filter(isVisible);
            return deepSearchInputs.length > 0 ? deepSearchInputs : leafCandidates;
          })()
        : leafCandidates;

      filteredCandidates.sort((a, b) => scoreEl(b) - scoreEl(a));
      const finalPool = filteredCandidates;

      const topCandidateScore = finalPool[0] ? scoreEl(finalPool[0]) : 0;
      const tiedCandidates = finalPool.filter((el, idx) => {
        if (idx === 0) return true;
        const sc = scoreEl(el);
        return sc >= topCandidateScore - 2 && !finalPool[0].contains(el) && !el.contains(finalPool[0]);
      });

      const matches = finalPool.slice(0, 30).map((el, idx) => {
        const fullText = normalize(
          el.innerText ||
            el.getAttribute?.("placeholder") ||
            el.getAttribute?.("aria-label") ||
            el.name ||
            el.textContent ||
            "",
        );
        let matchIdx = fullText.toLowerCase().indexOf(effectiveQuery);
        if (matchIdx === -1 && rawTokens.length > 0) {
          for (const tok of rawTokens) {
            matchIdx = fullText.toLowerCase().indexOf(tok);
            if (matchIdx !== -1) break;
          }
        }
        if (matchIdx === -1) matchIdx = 0;
        const start = Math.max(0, matchIdx - 30);
        const end = Math.min(fullText.length, matchIdx + effectiveQuery.length + 30);
        const snippet =
          (start > 0 ? "…" : "") + fullText.slice(start, end) + (end < fullText.length ? "…" : "");

        return {
          index: idx + 1,
          tag: el.tagName.toLowerCase(),
          selector: getSelector(el),
          textSnippet: snippet,
          fullText: fullText.slice(0, 200),
          isClickable:
            el.tagName === "BUTTON" ||
            el.tagName === "A" ||
            el.getAttribute?.("role") === "button" ||
            Boolean(el.closest?.("button, a")),
        };
      });

      if (matches.length === 0) {
        return {
          ok: true,
          query: searchQuery,
          totalMatches: 0,
          matches: [],
          message: `No content matching "${searchQuery}" was found in the visible page structure.`,
        };
      }

      const targetIdx = typeof opts?.targetIndex === "number" ? opts.targetIndex : 0;
      const isAmbiguousFind = tiedCandidates.length > 1 && typeof opts?.targetIndex !== "number";
      const targetMatch = matches[targetIdx] || matches[0];
      let scrolled = false;

      if (opts?.scroll !== false && !isAmbiguousFind && finalPool[targetIdx || 0]) {
        const targetEl = finalPool[targetIdx || 0];

        let parent = targetEl.parentElement;
        while (parent && parent !== document.body && parent !== document.documentElement) {
          const cs = window.getComputedStyle(parent);
          if (cs.overflowY === "auto" || cs.overflowY === "scroll") {
            if (parent.scrollHeight > parent.clientHeight + 20) {
              const elRect = targetEl.getBoundingClientRect();
              const pRect = parent.getBoundingClientRect();
              parent.scrollBy({
                top: elRect.top - pRect.top - parent.clientHeight / 2 + elRect.height / 2,
                behavior: "smooth",
              });
              break;
            }
          }
          parent = parent.parentElement;
        }

        targetEl.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
        scrolled = true;
      }

      return {
        ok: true,
        query: searchQuery,
        totalMatches: matches.length,
        ambiguous: isAmbiguousFind,
        ambiguousCandidates: isAmbiguousFind ? matches.slice(0, tiedCandidates.length).slice(0, 6) : undefined,
        allTokensMatched,
        topScore: topCandidateScore,
        matches,
        targetMatch,
        firstSelector: targetMatch?.selector,
        scrolled,
        message: isAmbiguousFind
          ? `Found ${tiedCandidates.length} equally matching elements for "${searchQuery}".`
          : `Found ${matches.length} match${matches.length > 1 ? "es" : ""} for "${searchQuery}".`,
      };
  };

  const findRun = await runTabScript({
    target: { tabId: tab.id },
    func: findFrameFunc,
    args: [query, options],
    label: "findContent:topFrame",
  });

  let result = findRun.results?.[0]?.result || {
    ok: false,
    message: findRun.error || "Search execution failed.",
  };
  let targetFrameId = 0;

  if (!result.ok || result.totalMatches === 0 || !result.allTokensMatched) {
    const subRun = await runTabScript({
      target: { tabId: tab.id, allFrames: true },
      func: findFrameFunc,
      args: [query, options],
      label: "findContent:allFrames",
    });
    const subHits = (subRun.results || []).filter(
      (r) => r.frameId !== 0 && r.result?.ok && r.result.totalMatches > 0,
    );
    subHits.sort((a, b) => {
      const aFull = a.result.allTokensMatched ? 1 : 0;
      const bFull = b.result.allTokensMatched ? 1 : 0;
      if (aFull !== bFull) return bFull - aFull;
      return (b.result.topScore || 0) - (a.result.topScore || 0);
    });
    const bestSub = subHits[0];
    if (
      bestSub?.result &&
      (!result.ok ||
        result.totalMatches === 0 ||
        (bestSub.result.allTokensMatched && !result.allTokensMatched) ||
        (bestSub.result.allTokensMatched === result.allTokensMatched &&
          (bestSub.result.topScore || 0) > (result.topScore || 0)))
    ) {
      result = bestSub.result;
      targetFrameId = bestSub.frameId;
    }
  }

  if (result.ok && !result.ambiguous && result.firstSelector && options?.highlight !== false) {
    await clearHighlightOverlay();
    if (targetFrameId === 0) {
      await highlightElement(
        result.firstSelector,
        options?.title || `Pointing: ${query}`,
        result.matches?.[0]?.textSnippet || `Found ${result.totalMatches} match(es) for "${query}".`,
        options?.buddyVisual,
      );
    } else {
      await runTabScript({
        target: { tabId: tab.id, frameIds: [targetFrameId] },
        func: highlight,
        args: [
          result.firstSelector,
          options?.title || `Pointing: ${query}`,
          result.matches?.[0]?.textSnippet || `Found ${result.totalMatches} match(es) for "${query}".`,
          options?.buddyVisual || {},
        ],
        label: "findContent:subframeHighlight",
      });
    }
  }

  return result;
}

async function executeAction(action, selector, value, options = {}) {
  const tab = await activeTab();
  if (!tab?.id || !tab.url || RESTRICTED.test(tab.url)) {
    return { ok: false, message: "Cannot act on this restricted browser page." };
  }

  const executeFrameFunc = async (act, sel, val, opts) => {
      if (opts?.skipTopFrame && window === window.top) {
        return { ok: false, skippedTopFrame: true };
      }
      const normalize = (t) => (t || "").replace(/\s+/g, " ").trim();
      const SENSITIVE =
        /pass(?:word|wd)?|otp|(?<!postal[\s_-])(?<![a-z0-9])pin(?![a-z0-9]|[\s_-]*code\b)|cvv|cvc|secret|token|ssn|aadhaar|credit.?card|debit.?card|card.?number/i;

      const queryAllDeep = (selectorStr, root = document) => {
        const out = [...root.querySelectorAll(selectorStr)];
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
        let node;
        while ((node = walker.nextNode())) {
          if (node.shadowRoot) {
            out.push(...queryAllDeep(selectorStr, node.shadowRoot));
          }
        }
        return out;
      };

      const queryDeepSelector = (selectorStr, root = document) => {
        if (!selectorStr || selectorStr === "window" || selectorStr === "document") return null;
        try {
          const direct = root.querySelector(selectorStr);
          if (direct) return direct;
        } catch {
          return null;
        }
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
        let node;
        while ((node = walker.nextNode())) {
          if (node.shadowRoot) {
            const found = queryDeepSelector(selectorStr, node.shadowRoot);
            if (found) return found;
          }
        }
        return null;
      };

      const isVisible = (el) => {
        if (!el || el.nodeType !== 1) return false;
        if (el.closest?.("#ai-buddy-arm-overlay")) return false;
        const r = el.getBoundingClientRect();
        const s = window.getComputedStyle(el);
        return (
          (r.width > 0 || r.height > 0 || el.getClientRects().length > 0) &&
          s.visibility !== "hidden" &&
          s.display !== "none" &&
          parseFloat(s.opacity || "1") > 0
        );
      };

      const dispatchRealClick = (targetEl) => {
        const r = targetEl.getBoundingClientRect();
        const cx = Math.round(r.left + Math.max(1, r.width / 2));
        const cy = Math.round(r.top + Math.max(1, r.height / 2));
        const baseEv = {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: cx,
          clientY: cy,
          screenX: cx,
          screenY: cy,
          button: 0,
        };
        const ptrEv = { ...baseEv, buttons: 1, pointerId: 1, pointerType: "mouse", isPrimary: true };
        try {
          targetEl.dispatchEvent(new PointerEvent("pointerover", ptrEv));
          targetEl.dispatchEvent(new PointerEvent("pointerdown", ptrEv));
        } catch {}
        targetEl.dispatchEvent(new MouseEvent("mousedown", { ...baseEv, buttons: 1 }));
        targetEl.focus?.();
        try {
          targetEl.dispatchEvent(new PointerEvent("pointerup", { ...ptrEv, buttons: 0 }));
        } catch {}
        targetEl.dispatchEvent(new MouseEvent("mouseup", { ...baseEv, buttons: 0 }));
        targetEl.click();
      };

      const waitForScrollSettle = async (readPos, maxMs = 660) => {
        let last = readPos();
        const started = Date.now();
        await new Promise((r) => setTimeout(r, 120));
        while (Date.now() - started < maxMs) {
          const cur = readPos();
          if (Math.abs(cur.x - last.x) < 1 && Math.abs(cur.y - last.y) < 1) {
            return;
          }
          last = cur;
          await new Promise((r) => setTimeout(r, 60));
        }
      };

      // --- 1. SCROLL ACTION (UP, DOWN, LEFT, RIGHT, TOP, BOTTOM, TO_ELEMENT) ---
      if (
        act === "scroll" ||
        act === "scroll_page" ||
        act === "scroll_down" ||
        act === "scroll_up" ||
        act === "scroll_left" ||
        act === "scroll_right"
      ) {
        let direction = String(val || opts?.direction || "down").toLowerCase();
        if (act === "scroll_down") direction = "down";
        else if (act === "scroll_up") direction = "up";
        else if (act === "scroll_left") direction = "left";
        else if (act === "scroll_right") direction = "right";

        const amount = typeof opts?.amount === "number" ? opts.amount : 450;
        let targetEl = sel && sel !== "window" && sel !== "document" ? queryDeepSelector(sel) : null;

        // If direction === "to_element" or opts.targetText given, locate target section/element
        if (!targetEl && (direction === "to_element" || opts?.targetText)) {
          const qText = normalize(opts?.targetText || val || "").toLowerCase();
          if (qText) {
            const getScrollText = (c) =>
              normalize(
                c.innerText ||
                  c.getAttribute?.("aria-label") ||
                  c.getAttribute?.("placeholder") ||
                  c.id ||
                  "",
              ).toLowerCase();

            const rawMatches = queryAllDeep(
              "h1, h2, h3, h4, h5, h6, button, a, input, textarea, select, label, p, span, li, section, footer, header, nav, form, main, div",
            ).filter((c) => {
              if (!isVisible(c)) return false;
              const t = getScrollText(c);
              return t && (t === qText || (t.includes(qText) && t.length < 240));
            });

            // Exclude wrapper containers that enclose a more specific matching descendant
            const specificMatches = rawMatches.filter(
              (c) => !rawMatches.some((other) => other !== c && c.contains(other)),
            );
            const pool = specificMatches.length > 0 ? specificMatches : rawMatches;

            const scoreScrollTarget = (c) => {
              const t = getScrollText(c);
              let s = 0;
              if (t === qText) s += 100;
              else if (t.startsWith(qText)) s += 60;
              else if (t.includes(qText)) s += 30;
              if (["H1", "H2", "H3", "H4", "H5", "H6", "BUTTON", "A", "INPUT", "LABEL"].includes(c.tagName)) {
                s += 35;
              }
              const cs = window.getComputedStyle(c);
              if (
                (cs.overflowY === "auto" || cs.overflowY === "scroll") &&
                c.scrollHeight > c.clientHeight + 20 &&
                c.children.length > 0
              ) {
                s -= 80;
              }
              s -= Math.min(40, Math.floor(t.length / 8));
              return s;
            };

            pool.sort((a, b) => scoreScrollTarget(b) - scoreScrollTarget(a));
            targetEl = pool[0] || null;
          }
          if (!targetEl && direction === "to_element") {
            return {
              ok: false,
              action: "scroll",
              message: `Could not find "${opts?.targetText || val}" on this page to scroll to.`,
            };
          }
        }

        if (targetEl) {
          const beforeTop = targetEl.getBoundingClientRect().top;
          const beforeWinY = window.scrollY || document.documentElement.scrollTop || 0;
          let scrollParent = targetEl.parentElement;
          while (scrollParent && scrollParent !== document.body && scrollParent !== document.documentElement) {
            const cs = window.getComputedStyle(scrollParent);
            if (
              (cs.overflowY === "auto" || cs.overflowY === "scroll") &&
              scrollParent.scrollHeight > scrollParent.clientHeight + 20
            ) {
              break;
            }
            scrollParent = scrollParent.parentElement;
          }
          const hasScrollParent =
            scrollParent &&
            scrollParent !== document.body &&
            scrollParent !== document.documentElement;
          const beforeParentY = hasScrollParent ? scrollParent.scrollTop : 0;

          if (hasScrollParent) {
            const elRect = targetEl.getBoundingClientRect();
            const pRect = scrollParent.getBoundingClientRect();
            scrollParent.scrollBy({
              top: elRect.top - pRect.top - scrollParent.clientHeight / 2 + elRect.height / 2,
              behavior: "smooth",
            });
          }
          targetEl.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
          await waitForScrollSettle(() => ({
            x: hasScrollParent ? scrollParent.scrollLeft : window.scrollX || document.documentElement.scrollLeft || 0,
            y: hasScrollParent ? scrollParent.scrollTop : window.scrollY || document.documentElement.scrollTop || 0,
          }), 800);
          const elRectAfter = targetEl.getBoundingClientRect();
          const afterTop = elRectAfter.top;
          const afterWinY = window.scrollY || document.documentElement.scrollTop || 0;
          const afterParentY = hasScrollParent ? scrollParent.scrollTop : 0;
          const movedPx = Math.round(
            Math.max(
              Math.abs(afterTop - beforeTop),
              Math.abs(afterWinY - beforeWinY),
              Math.abs(afterParentY - beforeParentY),
            ),
          );
          const vw = window.innerWidth || document.documentElement.clientWidth || 1200;
          const vh = window.innerHeight || document.documentElement.clientHeight || 800;
          const inViewport =
            (elRectAfter.width > 0 || elRectAfter.height > 0) &&
            elRectAfter.bottom > 0 &&
            elRectAfter.top < vh &&
            elRectAfter.right > 0 &&
            elRectAfter.left < vw;
          const elLabel = normalize(targetEl.innerText || targetEl.tagName).slice(0, 40);
          if (!inViewport && movedPx === 0) {
            return {
              ok: false,
              action: "scroll",
              direction: "to_element",
              movedPx,
              inViewport: false,
              message: `Could not bring "${elLabel}" into the visible viewport.`,
            };
          }
          return {
            ok: true,
            action: "scroll",
            direction: "to_element",
            movedPx,
            inViewport,
            message: inViewport
              ? `Scrolled to "${elLabel}" successfully.`
              : `Scrolled toward "${elLabel}" (${movedPx}px), though element remains partially outside viewport.`,
          };
        }

        let container = opts?.containerSelector ? queryDeepSelector(opts.containerSelector) : null;
        if (!container && opts?.containerText) {
          const ctQuery = normalize(opts.containerText).toLowerCase();
          const wantH = direction === "left" || direction === "right";
          const scrollableBoxes = queryAllDeep(
            "main, [role='main'], [role='region'], aside, div, section, ul, ol, table, tbody",
          ).filter((el) => {
            if (!isVisible(el) || el === document.body || el === document.documentElement) return false;
            const cs = window.getComputedStyle(el);
            return wantH
              ? (cs.overflowX === "auto" || cs.overflowX === "scroll" || cs.overflow === "auto" || cs.overflow === "scroll") &&
                  el.scrollWidth > el.clientWidth + 20
              : (cs.overflowY === "auto" || cs.overflowY === "scroll" || cs.overflow === "auto" || cs.overflow === "scroll") &&
                  el.scrollHeight > el.clientHeight + 20;
          });
          container =
            scrollableBoxes.find((el) => {
              const labelText = normalize(
                `${el.getAttribute?.("aria-label") || ""} ${el.id || ""} ${el.className || ""} ${el.querySelector?.("h1,h2,h3,h4,h5,h6,strong,legend")?.innerText || ""}`,
              ).toLowerCase();
              if (labelText.includes(ctQuery)) return true;
              const prevHeading = el.previousElementSibling;
              const prevTxt = normalize(prevHeading?.innerText || "").toLowerCase();
              return prevTxt && prevTxt.includes(ctQuery);
            }) ||
            scrollableBoxes.find((el) =>
              normalize(el.innerText || "").toLowerCase().includes(ctQuery),
            ) ||
            null;
          if (!container) {
            return {
              ok: false,
              action: "scroll",
              message: `Could not find scrollable "${opts.containerText}" area on this page.`,
            };
          }
        }

        const findBestScrollContainer = (wantHoriz) => {
          const scrollCands = queryAllDeep(
            "main, [role='main'], div, section, ul, table, tbody",
          ).filter((el) => {
            if (!isVisible(el) || el === document.body || el === document.documentElement) return false;
            const cs = window.getComputedStyle(el);
            if (wantHoriz) {
              return (
                (cs.overflowX === "auto" || cs.overflowX === "scroll") &&
                el.scrollWidth > el.clientWidth + 20
              );
            }
            return (
              (cs.overflowY === "auto" || cs.overflowY === "scroll") &&
              el.scrollHeight > el.clientHeight + 20
            );
          });
          scrollCands.sort(
            (a, b) =>
              b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight,
          );
          return scrollCands[0] || null;
        };

        const wantHoriz = direction === "left" || direction === "right";
        // Auto-detect primary scrollable container in SPAs when window is locked (overflow:hidden) or not scrollable
        if (!container) {
          const bodyCs = document.body ? window.getComputedStyle(document.body) : null;
          const docCs = window.getComputedStyle(document.documentElement);
          const docLockedY =
            bodyCs?.overflowY === "hidden" ||
            docCs.overflowY === "hidden" ||
            (document.documentElement.scrollHeight || 0) <= window.innerHeight + 20;
          const docLockedX =
            bodyCs?.overflowX === "hidden" ||
            docCs.overflowX === "hidden" ||
            (document.documentElement.scrollWidth || 0) <= window.innerWidth + 20;

          if ((wantHoriz && docLockedX) || (!wantHoriz && docLockedY)) {
            container = findBestScrollContainer(wantHoriz);
          }
        }

        const scrollContainerObj = async (c) => {
          const beforeY = c.scrollTop;
          const beforeX = c.scrollLeft;
          if (direction === "top") c.scrollTo({ top: 0, behavior: "smooth" });
          else if (direction === "bottom") c.scrollTo({ top: c.scrollHeight, behavior: "smooth" });
          else if (direction === "up") c.scrollBy({ top: -amount, behavior: "smooth" });
          else if (direction === "left") c.scrollBy({ left: -amount, behavior: "smooth" });
          else if (direction === "right") c.scrollBy({ left: amount, behavior: "smooth" });
          else c.scrollBy({ top: amount, behavior: "smooth" });

          await waitForScrollSettle(() => ({ x: c.scrollLeft, y: c.scrollTop }));
          const movedPx = Math.round(
            Math.max(
              Math.abs(c.scrollTop - beforeY),
              Math.abs(c.scrollLeft - beforeX),
            ),
          );
          const hasMore =
            c.scrollHeight > c.scrollTop + c.clientHeight + 20;
          return {
            ok: true,
            action: "scroll",
            container: c.tagName.toLowerCase(),
            direction,
            movedPx,
            hasMoreBelow: hasMore,
            message: `Scrolled container (${c.tagName.toLowerCase()}) ${direction}${movedPx ? ` (${movedPx}px)` : ""}.`,
          };
        };

        if (container) {
          return await scrollContainerObj(container);
        }

        // Window scroll
        const beforeY = window.scrollY || document.documentElement.scrollTop || 0;
        const beforeX = window.scrollX || document.documentElement.scrollLeft || 0;
        if (direction === "top") window.scrollTo({ top: 0, behavior: "smooth" });
        else if (direction === "bottom") window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" });
        else if (direction === "up") window.scrollBy({ top: -amount, behavior: "smooth" });
        else if (direction === "left") window.scrollBy({ left: -amount, behavior: "smooth" });
        else if (direction === "right") window.scrollBy({ left: amount, behavior: "smooth" });
        else window.scrollBy({ top: amount, behavior: "smooth" });

        await waitForScrollSettle(() => ({
          x: window.scrollX || document.documentElement.scrollLeft || 0,
          y: window.scrollY || document.documentElement.scrollTop || 0,
        }));

        const scrollH = document.documentElement.scrollHeight || document.body.scrollHeight || 0;
        const scrollT = window.scrollY || document.documentElement.scrollTop || 0;
        const scrollL = window.scrollX || document.documentElement.scrollLeft || 0;
        const clientH = window.innerHeight || document.documentElement.clientHeight || 0;
        const movedPx = Math.round(Math.max(Math.abs(scrollT - beforeY), Math.abs(scrollL - beforeX)));

        // Runtime fallback: if window barely moved (0px) and an inner scrollable container exists, scroll that container
        if (movedPx === 0) {
          const fallbackContainer = findBestScrollContainer(wantHoriz);
          if (fallbackContainer) {
            return await scrollContainerObj(fallbackContainer);
          }
        }

        const hasMore = scrollH > scrollT + clientH + 40;

        return {
          ok: true,
          action: "scroll",
          direction,
          movedPx,
          scrollPercent:
            scrollH > clientH ? Math.round((scrollT / (scrollH - clientH)) * 100) : 100,
          hasMoreBelow: hasMore,
          message: `Scrolled webpage ${direction}${movedPx > 0 ? ` (${movedPx}px)` : ""}. ${
            direction === "left" || direction === "right"
              ? ""
              : hasMore
                ? "More content exists below."
                : "Reached end of scroll range."
          }`.trim(),
        };
      }

      // Helper: build stable CSS selector & nearby section context label
      const getUniqueSelector = (node) => {
        if (!node) return undefined;
        const nodeRoot = node.getRootNode?.() || document;
        const safeCount = (s) => {
          try {
            return (nodeRoot.querySelectorAll ? nodeRoot.querySelectorAll(s) : document.querySelectorAll(s)).length;
          } catch {
            return 0;
          }
        };
        if (node.id && safeCount(`#${CSS.escape(node.id)}`) === 1) {
          return `#${CSS.escape(node.id)}`;
        }
        const parts = [];
        let cur = node;
        while (cur && cur.nodeType === 1 && cur !== nodeRoot && parts.length < 5) {
          let p = cur.tagName.toLowerCase();
          if (cur.id && safeCount(`#${CSS.escape(cur.id)}`) === 1) {
            parts.unshift(`#${CSS.escape(cur.id)}`);
            break;
          }
          const parent = cur.parentElement;
          if (parent) {
            const same = [...parent.children].filter((c) => c.tagName === cur.tagName);
            if (same.length > 1) p += `:nth-of-type(${same.indexOf(cur) + 1})`;
          }
          parts.unshift(p);
          cur = parent;
        }
        return parts.join(" > ");
      };

      const getContextLabel = (node) => {
        const container = node.closest?.(
          "section, article, .card, .service-card, form, header, nav, footer, aside, dialog, tr, li",
        );
        if (container) {
          const heading = container.querySelector?.("h1,h2,h3,h4,h5,h6,legend,.card-title,strong");
          const hTxt = normalize(heading?.innerText || container.getAttribute?.("aria-label") || "");
          if (hTxt && hTxt !== normalize(node.innerText || "")) {
            return hTxt.slice(0, 50);
          }
          const tag = container.tagName.toLowerCase();
          if (["header", "nav", "footer", "form", "aside", "dialog"].includes(tag)) return tag;
        }
        return undefined;
      };

      // --- 2. CLICK & BUTTON PRESS ACTION ---
      if (
        act === "click" ||
        act === "press_button" ||
        act === "press" ||
        act === "click_submit" ||
        act === "click_delete" ||
        act === "submit"
      ) {
        let el = null;

        if ((sel === "__CURRENT__" || val === "__CURRENT__") && opts?.fallbackSelector) {
          el = queryDeepSelector(opts.fallbackSelector);
          if (!el) {
            return {
              ok: false,
              stale: true,
              message: "The previously highlighted element is no longer present on this page.",
            };
          }
        }

        if (!el && sel && sel !== "__CURRENT__") {
          el = queryDeepSelector(sel);
          if (!el && !val && !opts?.text) {
            return {
              ok: false,
              stale: true,
              message: "Target element is no longer on this page.",
            };
          }
        }

        if (!el && (val === "__CURRENT__" || opts?.text === "__CURRENT__")) {
          if (
            document.activeElement &&
            document.activeElement !== document.body &&
            isVisible(document.activeElement)
          ) {
            el = document.activeElement;
          }
        }

        if (!el && (val || opts?.text || sel) && val !== "__CURRENT__") {
          const rawTarget = String(val || opts?.text || sel).trim().toLowerCase();
          const cleanTarget = rawTarget
            .replace(/^(?:the|a|an|ye|yeh|wo|woh|is|this|us|par)\s+/i, "")
            .replace(/\s+(?:button|btn|tab|link|icon|menu|bar|option|checkbox|radio|switch)$/i, "")
            .trim();

          const CLICK_SYNONYMS = {
            login: ["login", "log in", "signin", "sign in", "sign-in", "log-in", "connect"],
            signin: ["login", "log in", "signin", "sign in", "sign-in", "log-in"],
            signup: ["signup", "sign up", "register", "create account", "get started"],
            register: ["signup", "sign up", "register", "create account"],
            submit: ["submit", "save", "send", "continue", "proceed", "confirm", "done", "apply", "request"],
            cart: ["cart", "bag", "basket", "checkout", "shopping cart"],
            orders: ["orders", "my orders", "order history", "pending orders", "order"],
            search: ["search", "find", "go", "query"],
            next: ["next", "continue", "forward", "proceed"],
            close: ["close", "dismiss", "cancel", "exit"],
            cancel: ["cancel", "dismiss", "close", "back"],
          };

          const targetTerms = [cleanTarget, rawTarget].filter((t) => t && t.length > 0);
          for (const [key, syns] of Object.entries(CLICK_SYNONYMS)) {
            if (
              cleanTarget === key ||
              cleanTarget.includes(key) ||
              syns.some((s) => cleanTarget.includes(s))
            ) {
              targetTerms.push(...syns);
            }
          }

          const clickables = queryAllDeep(
            'button, a, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="option"], [role="checkbox"], [role="radio"], [role="switch"], input[type="submit"], input[type="button"], input[type="reset"], input[type="checkbox"], input[type="radio"], select, summary, label, [tabindex]:not([tabindex="-1"])',
          ).filter(isVisible);

          const getElementText = (node) => {
            const nodeRoot = node.getRootNode?.() || document;
            let labelTxt = "";
            const labelledby = node.getAttribute?.("aria-labelledby");
            if (labelledby) {
              labelTxt = labelledby
                .split(/\s+/)
                .map((lid) => (nodeRoot.getElementById?.(lid) || document.getElementById(lid))?.innerText)
                .filter(Boolean)
                .join(" ");
            }
            if (!labelTxt && node.id) {
              try {
                const lbl =
                  nodeRoot.querySelector?.(`label[for="${CSS.escape(node.id)}"]`) ||
                  document.querySelector(`label[for="${CSS.escape(node.id)}"]`);
                if (lbl?.innerText) labelTxt = lbl.innerText;
              } catch {}
            }
            if (!labelTxt) {
              const wrap = node.closest?.("label");
              if (wrap?.innerText) labelTxt = wrap.innerText;
            }
            return normalize(
              node.innerText ||
                node.value ||
                labelTxt ||
                node.getAttribute?.("aria-label") ||
                node.getAttribute?.("title") ||
                node.getAttribute?.("alt") ||
                node.getAttribute?.("placeholder") ||
                node.getAttribute?.("name") ||
                node.querySelector?.("img[alt]")?.getAttribute("alt") ||
                node.querySelector?.("svg title")?.textContent ||
                "",
            ).toLowerCase();
          };

          const scoredCandidates = [];
          for (const cand of clickables) {
            const t = getElementText(cand);
            if (!t) continue; // NEVER match empty elements!
            let score = 0;
            for (const term of targetTerms) {
              if (!term) continue;
              if (t === term) {
                score = Math.max(score, 100);
              } else if (t.startsWith(term)) {
                score = Math.max(score, 75);
              } else if (t.includes(term)) {
                score = Math.max(score, 55);
              } else if (term.includes(t) && t.length >= 3) {
                score = Math.max(score, 40);
              }
            }
            if (
              score > 0 &&
              ["BUTTON", "A", "INPUT", "SELECT"].includes(cand.tagName)
            ) {
              score += 10;
            }
            if (score > 0) {
              score -= Math.min(20, Math.floor(t.length / 25));
              scoredCandidates.push({ el: cand, score, normText: t });
            }
          }

          // Deduplicate nested elements (e.g. a button inside a wrapper with [tabindex])
          scoredCandidates.sort((a, b) => b.score - a.score);
          const uniqueCandidates = [];
          for (const c of scoredCandidates) {
            const nested = uniqueCandidates.some(
              (kept) => kept.el.contains(c.el) || c.el.contains(kept.el),
            );
            if (!nested) uniqueCandidates.push(c);
          }

          if (uniqueCandidates.length > 0) {
            if (typeof opts?.candidateIndex === "number" && opts.candidateIndex >= 1) {
              el = uniqueCandidates[opts.candidateIndex - 1]?.el || null;
            } else {
              const topScore = uniqueCandidates[0].score;
              const tied = uniqueCandidates.filter(
                (c, i) =>
                  i === 0 ||
                  c.score === topScore ||
                  (c.score >= topScore - 2 && c.normText === uniqueCandidates[0].normText),
              );
              if (
                tied.length > 1 &&
                act !== "submit" &&
                act !== "click_submit" &&
                act !== "click_delete"
              ) {
                return {
                  ok: false,
                  ambiguous: true,
                  action: "click",
                  target: val || opts?.text || cleanTarget,
                  candidates: tied.slice(0, 8).map((c, idx) => ({
                    index: idx + 1,
                    text: normalize(
                      c.el.innerText || c.el.value || c.el.getAttribute?.("aria-label") || c.normText,
                    ).slice(0, 60),
                    context: getContextLabel(c.el) || null,
                    tag: c.el.tagName.toLowerCase(),
                    selector: getUniqueSelector(c.el),
                  })),
                  message: `Found ${tied.length} matching controls for "${val || opts?.text}". Please clarify which one.`,
                };
              }
              el = uniqueCandidates[0].el;
            }
          }

          // Deep leaf match if still not found
          if (!el) {
            const allTextNodes = queryAllDeep("span, p, b, strong, div, h1, h2, h3, h4, h5, h6, label").filter(isVisible);
            for (const term of targetTerms) {
              if (!term) continue;
              const matchedLeaf = allTextNodes.find((leaf) => {
                const t = normalize(leaf.innerText || leaf.textContent || "").toLowerCase();
                return t && (t === term || (t.includes(term) && t.length < 50));
              });
              if (matchedLeaf) {
                el =
                  matchedLeaf.closest?.(
                    'button, a, [role="button"], [role="tab"], [role="link"], [role="menuitem"], summary, label',
                  ) || matchedLeaf;
                break;
              }
            }
          }

          // Form submit fallback
          if (!el && (act === "click_submit" || act === "submit" || cleanTarget.includes("submit"))) {
            el = queryAllDeep(
              'button[type="submit"], input[type="submit"], form button:not([type="button"])',
            ).find(isVisible);
          }
        }

        if (!el) {
          return {
            ok: false,
            message: `Could not find button or interactive element matching "${sel || val || opts?.text || "target"}".`,
          };
        }

        if (el.disabled || el.getAttribute?.("aria-disabled") === "true") {
          return {
            ok: false,
            message: `Element "${normalize(el.innerText || el.value)}" is currently disabled.`,
          };
        }

        const urlBefore = window.location.href;
        const checkedBefore = el.checked;
        const ariaCheckedBefore = el.getAttribute?.("aria-checked");
        const ariaSelectedBefore = el.getAttribute?.("aria-selected");
        const ariaExpandedBefore = el.getAttribute?.("aria-expanded");
        const dialogSelector = 'dialog[open], [role="dialog"], [role="alertdialog"], .modal.show, .modal-open';
        const dialogsBefore = queryAllDeep(dialogSelector).filter(isVisible).length;

        el.scrollIntoView({ behavior: "smooth", block: "center" });

        let formSubmittedByClick = false;
        const targetForm = el.form || el.closest?.("form");
        const onFormSubmit = () => {
          formSubmittedByClick = true;
        };
        if (targetForm && (act === "submit" || act === "click_submit")) {
          targetForm.addEventListener("submit", onFormSubmit, { once: true });
        }

        dispatchRealClick(el);

        if (targetForm && (act === "submit" || act === "click_submit")) {
          targetForm.removeEventListener("submit", onFormSubmit);
          if (!formSubmittedByClick && typeof targetForm.requestSubmit === "function") {
            try {
              targetForm.requestSubmit();
            } catch {}
          }
        }

        // Wait briefly for SPA state change / navigation / modal (resolve immediately if full-page navigation starts)
        await new Promise((r) => {
          const done = () => {
            window.removeEventListener("pagehide", done);
            window.removeEventListener("beforeunload", done);
            r();
          };
          window.addEventListener("pagehide", done, { once: true });
          window.addEventListener("beforeunload", done, { once: true });
          setTimeout(done, 250);
        });

        const clickedText = normalize(
          el.innerText || el.value || el.getAttribute?.("aria-label") || el.tagName,
        ).slice(0, 60);

        let stateChange = "clicked";
        if (window.location.href !== urlBefore) {
          stateChange = "navigated";
        } else {
          const dialogsAfter = queryAllDeep(dialogSelector).filter(isVisible).length;
          if (dialogsAfter > dialogsBefore) {
            stateChange = "modal_opened";
          } else if (
            el.checked !== checkedBefore ||
            el.getAttribute?.("aria-checked") !== ariaCheckedBefore
          ) {
            stateChange = "toggled";
          } else if (
            el.getAttribute?.("aria-selected") !== ariaSelectedBefore ||
            el.getAttribute?.("aria-expanded") !== ariaExpandedBefore
          ) {
            stateChange = "selected";
          }
        }

        // Capture visible status, alert, error, or confirmation feedback shown by the page
        const feedbackEls = queryAllDeep(
          '[role="alert"], [role="status"], [aria-live], .alert, .error, .error-message, .form-error, .invalid-feedback, .success, .toast, .notice',
        ).filter((node) => isVisible(node) && !node.contains(el));
        const pageFeedback = [];
        let hasErrorFeedback = false;
        for (const fb of feedbackEls) {
          const fbTxt = normalize(fb.innerText || fb.textContent || "").slice(0, 180);
          if (!fbTxt || fbTxt === clickedText || pageFeedback.includes(fbTxt)) continue;
          pageFeedback.push(fbTxt);
          if (
            fb.getAttribute?.("role") === "alert" ||
            fb.classList?.contains("error") ||
            fb.classList?.contains("form-error") ||
            fb.classList?.contains("invalid-feedback") ||
            /\b(?:error|failed|invalid|required|please\s+fix|missing|fix:|cannot|must\s+accept)\b/i.test(fbTxt)
          ) {
            hasErrorFeedback = true;
          }
          if (pageFeedback.length >= 3) break;
        }

        const isNowChecked =
          typeof el.checked === "boolean"
            ? el.checked
            : el.getAttribute?.("aria-checked") === "true";

        let outcomeMsg = `Successfully clicked "${clickedText}".`;
        if (stateChange === "navigated") {
          outcomeMsg += ` Navigated to ${window.location.pathname}.`;
        } else if (stateChange === "modal_opened") {
          outcomeMsg += " Modal dialog appeared.";
        } else if (stateChange === "toggled") {
          outcomeMsg += ` State changed to ${isNowChecked ? "checked" : "unchecked"}.`;
        } else if (stateChange === "selected") {
          outcomeMsg += " Selection updated.";
        }
        if (pageFeedback.length > 0) {
          outcomeMsg += ` Page reported: "${pageFeedback[0]}"`;
        }

        return {
          ok: true,
          action: "click",
          tag: el.tagName.toLowerCase(),
          text: clickedText,
          stateChange,
          urlBefore,
          urlAfter: window.location.href,
          pageFeedback: pageFeedback.length > 0 ? pageFeedback : undefined,
          hasErrorFeedback,
          message: outcomeMsg,
        };
      }

      // --- 3. COPY TO CLIPBOARD ACTION ---
      if (act === "copy_to_clipboard" || act === "copy") {
        const query = String(val || opts?.query || "").trim();
        let textsToCopy = [];

        if (sel) {
          const els = queryAllDeep(sel).slice(0, opts?.limit || 25);
          textsToCopy = els
            .map((el) => normalize(el.innerText || el.value || el.textContent))
            .filter(Boolean);
        } else if (query) {
          const q = query.toLowerCase();
          if (/^(?:table|tables|rows|table\s+rows)$/.test(q)) {
            const rows = queryAllDeep("table tr").slice(0, opts?.limit || 40);
            textsToCopy = rows
              .map((tr) =>
                [...tr.querySelectorAll("th, td")]
                  .map((c) => normalize(c.innerText || c.textContent))
                  .filter(Boolean)
                  .join(" | "),
              )
              .filter(Boolean);
          } else if (/^(?:data|list|items|order_id|orders)$/.test(q)) {
            const items = queryAllDeep("table tbody tr, ul li").slice(0, opts?.limit || 30);
            textsToCopy = items
              .map((el) => normalize(el.innerText || el.textContent))
              .filter(Boolean);
          } else {
            const cand = queryAllDeep("td, span, div, li, p").filter((el) => {
              const t = normalize(el.innerText || el.textContent).toLowerCase();
              return t.includes(q) && (!el.children.length || el.children.length < 3);
            });
            textsToCopy = cand
              .slice(0, opts?.limit || 10)
              .map((el) => normalize(el.innerText || el.textContent));
          }
        }

        if (textsToCopy.length === 0) {
          return { ok: false, message: "No matching content found to copy to clipboard." };
        }

        const combinedText = textsToCopy.join("\n");
        let copied = false;

        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(combinedText);
            copied = true;
          }
        } catch {}

        if (!copied) {
          const ta = document.createElement("textarea");
          ta.value = combinedText;
          ta.style.position = "fixed";
          ta.style.opacity = "0";
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          document.body.removeChild(ta);
          copied = true;
        }

        return {
          ok: true,
          action: "copy_to_clipboard",
          count: textsToCopy.length,
          copiedItems: textsToCopy.slice(0, 5),
          previewText: combinedText.slice(0, 200),
          message: `Copied ${textsToCopy.length} item${textsToCopy.length > 1 ? "s" : ""} to clipboard.`,
        };
      }

      // --- 4. TYPE / FILL ACTION ---
      if (act === "type" || act === "fill_field") {
        let el = sel ? queryDeepSelector(sel) : null;
        if (el && !["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) && !el.isContentEditable) {
          el =
            el.querySelector?.(
              'textarea, input:not([type="hidden"]), [contenteditable="true"], [contenteditable=""], select',
            ) || el;
        }
        if (!el && opts?.fallbackSelector) {
          el = queryDeepSelector(opts.fallbackSelector);
        }
        if (!el) return { ok: false, message: "Target input field was not found on this page." };

        const isSensitive =
          el.type === "password" ||
          SENSITIVE.test(`${el.name || ""} ${el.id || ""} ${el.type || ""}`);
        if (isSensitive && !opts?.explicitUserProvided) {
          return {
            ok: false,
            message: "Action blocked: Buddy never types into password or financial fields.",
          };
        }

        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.focus();

        const strVal = String(val || "");
        const isCe =
          el.isContentEditable ||
          el.getAttribute?.("contenteditable") === "true" ||
          el.getAttribute?.("contenteditable") === "" ||
          el.getAttribute?.("contenteditable") === "plaintext-only";
        if (
          !isCe &&
          el.tagName !== "SELECT" &&
          el.type !== "checkbox" &&
          el.type !== "radio" &&
          el.type !== "date" &&
          typeof el.maxLength === "number" &&
          el.maxLength > 0 &&
          strVal.length > el.maxLength
        ) {
          return {
            ok: false,
            verified: false,
            action: "type",
            field: el.name || el.id || el.placeholder || el.tagName.toLowerCase(),
            message: `Refused to type: value length (${strVal.length}) exceeds field maxlength (${el.maxLength}).`,
          };
        }

        if (el.tagName === "SELECT") {
          const opt = [...el.options].find(
            (o) => o.value === strVal || o.text.toLowerCase().includes(strVal.toLowerCase()),
          );
          el.value = opt ? opt.value : strVal;
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        } else if (el.type === "checkbox") {
          const desired = Boolean(val);
          if (el.checked !== desired) el.click();
        } else if (el.type === "radio") {
          if (!el.checked) el.click();
        } else if (isCe) {
          try {
            document.execCommand("selectAll", false, null);
            const okIns = document.execCommand("insertText", false, strVal);
            if (!okIns || !(el.innerText || el.textContent || "").includes(strVal)) {
              el.innerText = strVal;
            }
          } catch {
            el.innerText = strVal;
          }
          try {
            el.dispatchEvent(
              new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertText", data: strVal }),
            );
          } catch {}
          try {
            el.dispatchEvent(
              new InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertText", data: strVal }),
            );
          } catch {}
          el.dispatchEvent(new Event("change", { bubbles: true }));
        } else {
          const proto =
            el.tagName === "TEXTAREA"
              ? window.HTMLTextAreaElement.prototype
              : window.HTMLInputElement.prototype;
          const nativeSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
          if (nativeSetter) {
            nativeSetter.call(el, strVal);
          } else {
            el.value = strVal;
          }
          if (el._valueTracker) el._valueTracker.setValue("");
          el.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          el.dispatchEvent(new Event("blur", { bubbles: true }));
        }

        const actualValue = isCe ? el.innerText || el.textContent : el.value;
        const fieldLabel = el.name || el.id || el.placeholder || el.tagName.toLowerCase();
        const verified =
          actualValue !== undefined &&
          actualValue !== null &&
          (actualValue === strVal ||
            (strVal.length > 0 && actualValue.toString().includes(strVal)));

        return {
          ok: verified,
          verified,
          action: "type",
          field: fieldLabel,
          message: verified
            ? `Filled "${fieldLabel}" with requested value.`
            : `Field "${fieldLabel}" rejected or cleared the typed value.`,
        };
      }

      // --- 4b. SEARCH BOX FILL + SUBMIT ACTION ---
      if (act === "search_submit") {
        const searchCandidates = queryAllDeep(
          'input[type="search"], [role="searchbox"], input[name*="search" i], input[id*="search" i], input[placeholder*="search" i], input[aria-label*="search" i], input[name="q"], input[name="query"]',
        ).filter((el) => isVisible(el) && !el.disabled && !el.readOnly);
        let searchEl = sel ? queryDeepSelector(sel) : searchCandidates[0] || null;
        if (!searchEl) {
          return {
            ok: false,
            noSearchInput: true,
            action: "search_submit",
            message: "No visible search input box was found on this page.",
          };
        }
        const queryStr = String(val || opts?.query || "").trim();
        searchEl.scrollIntoView({ behavior: "smooth", block: "center" });
        searchEl.focus();
        const proto =
          searchEl.tagName === "TEXTAREA"
            ? window.HTMLTextAreaElement.prototype
            : window.HTMLInputElement.prototype;
        const nativeSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
        if (nativeSetter) nativeSetter.call(searchEl, queryStr);
        else searchEl.value = queryStr;
        if (searchEl._valueTracker) searchEl._valueTracker.setValue("");
        searchEl.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
        searchEl.dispatchEvent(new Event("change", { bubbles: true }));

        let submittedWith = "enter_key";
        const form = searchEl.closest?.("form");
        const submitBtn = form
          ? form.querySelector('button[type="submit"], input[type="submit"], button[aria-label*="search" i]')
          : searchEl.parentElement?.querySelector?.('button, [role="button"]');
        if (submitBtn && isVisible(submitBtn)) {
          dispatchRealClick(submitBtn);
          submittedWith = "search_button";
        } else {
          const enterOpts = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true };
          searchEl.dispatchEvent(new KeyboardEvent("keydown", enterOpts));
          searchEl.dispatchEvent(new KeyboardEvent("keypress", enterOpts));
          searchEl.dispatchEvent(new KeyboardEvent("keyup", enterOpts));
          if (form && typeof form.requestSubmit === "function") {
            try {
              form.requestSubmit();
              submittedWith = "form_submit";
            } catch {}
          }
        }
        const fieldLabel = searchEl.getAttribute?.("aria-label") || searchEl.placeholder || searchEl.name || searchEl.id || "search";
        return {
          ok: true,
          verified: true,
          action: "search_submit",
          query: queryStr,
          field: fieldLabel,
          submittedWith,
          message: `Searched "${queryStr}" using ${fieldLabel}.`,
        };
      }

      // --- 5. SELECT / DROPDOWN ACTION ---
      if (act === "select") {
        let desiredValue = String(val || opts?.text || "");
        let el = sel ? queryDeepSelector(sel) : null;
        if (!el && opts?.targetField) {
          const tf = opts.targetField.toLowerCase();
          const selects = queryAllDeep("select, [role=listbox], [role=combobox]").filter(isVisible);
          el = selects.find((s) => {
            const labelTxt =
              (s.id && document.querySelector(`label[for="${CSS.escape(s.id)}"]`)?.innerText) ||
              s.closest?.("label")?.innerText ||
              "";
            const id = `${s.id || ""} ${s.name || ""} ${s.getAttribute?.("aria-label") || ""} ${labelTxt}`.toLowerCase();
            return id.includes(tf);
          });
          // Fallback for multi-word option like "Pro Plan select karo" where word 0 wasn't a field name
          if (!el && desiredValue) {
            const combinedPhrase = `${opts.targetField} ${desiredValue}`.trim().toLowerCase();
            const phraseMatch = selects.find((s) => {
              if (s.tagName === "SELECT") {
                return [...s.options].some(
                  (o) => o.text.toLowerCase().includes(combinedPhrase) || o.value.toLowerCase() === combinedPhrase,
                );
              }
              return false;
            });
            if (phraseMatch) {
              el = phraseMatch;
              desiredValue = `${opts.targetField} ${desiredValue}`.trim();
            }
          }
        }
        if (!el && desiredValue) {
          const searchCandidates = [
            opts?.targetField ? `${opts.targetField} ${desiredValue}`.trim() : "",
            desiredValue,
          ].filter(Boolean);
          const selects = queryAllDeep("select, [role=listbox], [role=combobox]").filter(isVisible);
          for (const candText of searchCandidates) {
            const target = candText.toLowerCase();
            el = selects.find((s) => {
              if (s.tagName === "SELECT") {
                return [...s.options].some((o) => o.text.toLowerCase().includes(target) || o.value.toLowerCase() === target);
              }
              const id = (s.id || s.name || s.getAttribute?.("aria-label") || "").toLowerCase();
              return id.includes(target);
            });
            if (el) {
              desiredValue = candText;
              break;
            }
          }
        }
        if (!el) return { ok: false, message: `Target dropdown matching "${opts?.targetField || desiredValue}" was not found on this page.` };

        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.focus();

        let verified = false;
        let selectedLabel = desiredValue;

        if (el.tagName === "SELECT") {
          const opt = [...el.options].find(
            (o) =>
              o.value.toLowerCase() === desiredValue.toLowerCase() ||
              o.text.toLowerCase() === desiredValue.toLowerCase() ||
              o.text.toLowerCase().includes(desiredValue.toLowerCase()),
          );
          if (opt) {
            const nativeSelectSetter = Object.getOwnPropertyDescriptor(
              window.HTMLSelectElement.prototype,
              "value",
            )?.set;
            if (nativeSelectSetter) nativeSelectSetter.call(el, opt.value);
            else el.value = opt.value;
            if (el._valueTracker) el._valueTracker.setValue("");
            selectedLabel = opt.text.trim();
            verified = el.value === opt.value;
          }
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        } else {
          dispatchRealClick(el);
          let roleOpts = [];
          for (let poll = 0; poll < 6; poll++) {
            await new Promise((r) => setTimeout(r, 60));
            roleOpts = queryAllDeep('[role="option"]').filter(isVisible);
            if (roleOpts.length > 0) break;
          }
          const optsPool = roleOpts.length > 0 ? roleOpts : queryAllDeep('[role="menuitem"], li').filter(isVisible);
          const dvLower = desiredValue.toLowerCase();
          const optEl =
            optsPool.find(
              (o) =>
                normalize(o.innerText || o.textContent || o.getAttribute?.("data-value") || "").toLowerCase() === dvLower,
            ) ||
            optsPool.find((o) =>
              normalize(o.innerText || o.textContent || o.getAttribute?.("data-value") || "").toLowerCase().includes(dvLower),
            );
          if (optEl) {
            optEl.scrollIntoView?.({ block: "nearest" });
            dispatchRealClick(optEl);
            verified = true;
          }
        }

        return {
          ok: verified,
          verified,
          action: "select",
          message: verified
            ? `Selected "${selectedLabel}" in dropdown.`
            : `Option "${desiredValue}" was not found in dropdown.`,
        };
      }

      // --- 6. CHECK / UNCHECK ACTION ---
      if (act === "check" || act === "uncheck") {
        let el = sel ? queryDeepSelector(sel) : null;
        if (!el && (val || opts?.text)) {
          const q = String(val || opts?.text).toLowerCase();
          const boxes = queryAllDeep('input[type="checkbox"], input[type="radio"], [role="checkbox"], [role="radio"], [role="switch"]').filter(isVisible);
          el = boxes.find((b) => {
            const lbl =
              (b.id && document.querySelector(`label[for="${CSS.escape(b.id)}"]`)?.innerText) ||
              b.closest?.("label")?.innerText ||
              "";
            const txt = `${b.name || ""} ${b.id || ""} ${b.getAttribute?.("aria-label") || ""} ${lbl}`.toLowerCase();
            return txt.includes(q);
          });
        }
        if (!el) return { ok: false, message: `Target checkbox/radio matching "${val || sel}" was not found on this page.` };

        el.scrollIntoView({ behavior: "smooth", block: "center" });
        const shouldCheck = act === "check";
        const currentChecked =
          el.type === "checkbox" || el.type === "radio"
            ? el.checked
            : el.getAttribute?.("aria-checked") === "true";

        if (currentChecked !== shouldCheck) {
          dispatchRealClick(el);
        }
        if ((el.type === "checkbox" || el.type === "radio") && el.checked !== shouldCheck) {
          el.checked = shouldCheck;
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }

        const nowChecked =
          el.type === "checkbox" || el.type === "radio"
            ? el.checked
            : el.getAttribute?.("aria-checked") === "true";
        const okChecked = nowChecked === shouldCheck;

        return {
          ok: okChecked,
          verified: okChecked,
          action: act,
          message: okChecked
            ? `${shouldCheck ? "Checked" : "Unchecked"} "${el.name || el.id || val || "checkbox"}".`
            : `Checkbox "${el.name || el.id || val || "checkbox"}" did not change to ${shouldCheck ? "checked" : "unchecked"}.`,
        };
      }

      // --- 7. KEYBOARD ACTION ---
      if (act === "keyboard") {
        const targetKey = String(val || opts?.key || "Enter");
        const el = sel ? queryDeepSelector(sel) : document.activeElement || document.body;
        const keyOpts = { key: targetKey, code: targetKey, bubbles: true, cancelable: true };
        el.dispatchEvent(new KeyboardEvent("keydown", keyOpts));
        el.dispatchEvent(new KeyboardEvent("keypress", keyOpts));
        el.dispatchEvent(new KeyboardEvent("keyup", keyOpts));

        return {
          ok: true,
          verified: true,
          action: "keyboard",
          message: `Dispatched keyboard key "${targetKey}".`,
        };
      }

      // --- 8. OPEN LINK ACTION ---
      if (act === "open_link" || act === "open") {
        let el = sel ? queryDeepSelector(sel) : null;
        if (sel && !el && !val && !opts?.text) {
          return {
            ok: false,
            stale: true,
            message: "Target link is no longer present on this page.",
          };
        }
        if (!el && (val || opts?.text)) {
          const needle = String(val || opts?.text).trim().toLowerCase();
          const links = queryAllDeep('a[href], [role="link"]').filter(isVisible);
          const linkScores = [];
          for (const a of links) {
            const txt = normalize(a.innerText || a.getAttribute("aria-label") || a.title || "").toLowerCase();
            const hrefStr = (a.getAttribute("href") || "").toLowerCase();
            let s = 0;
            if (txt === needle) s = 100;
            else if (txt.startsWith(needle)) s = 75;
            else if (txt.includes(needle)) s = 55;
            else if (hrefStr.includes(needle)) s = 40;
            if (s > 0) linkScores.push({ el: a, score: s, normText: txt });
          }
          linkScores.sort((a, b) => b.score - a.score);
          if (linkScores.length > 0) {
            if (typeof opts?.candidateIndex === "number" && opts.candidateIndex >= 1) {
              el = linkScores[opts.candidateIndex - 1]?.el || null;
            } else {
              const topScore = linkScores[0].score;
              const tiedLinks = linkScores.filter(
                (c, i) =>
                  i === 0 ||
                  c.score === topScore ||
                  (c.score >= topScore - 2 && c.normText === linkScores[0].normText),
              );
              if (tiedLinks.length > 1) {
                return {
                  ok: false,
                  ambiguous: true,
                  action: "open_link",
                  target: val || opts?.text,
                  candidates: tiedLinks.slice(0, 8).map((c, idx) => ({
                    index: idx + 1,
                    text: normalize(c.el.innerText || c.el.getAttribute("aria-label") || c.el.href || "").slice(0, 60),
                    context: getContextLabel(c.el) || null,
                    tag: c.el.tagName.toLowerCase(),
                    selector: getUniqueSelector(c.el),
                  })),
                  message: `Found ${tiedLinks.length} links matching "${val || opts?.text}". Please choose which one.`,
                };
              }
              el = linkScores[0].el;
            }
          }
        }
        if (!el) {
          return {
            ok: false,
            message: `Could not find link matching "${val || opts?.text || sel || "target"}".`,
          };
        }
        const urlBefore = window.location.href;
        const rawHref = el.getAttribute?.("href") || el.href || "";
        let resolvedHref = "";
        if (rawHref && !/^\s*javascript:/i.test(rawHref)) {
          try {
            resolvedHref = new URL(rawHref, urlBefore).href;
          } catch {
            if (el.tagName === "A") {
              return {
                ok: false,
                action: "open_link",
                message: `Cannot open malformed link URL "${rawHref.slice(0, 80)}".`,
              };
            }
          }
        }
        const label = normalize(el.innerText || el.getAttribute?.("aria-label") || resolvedHref || "link").slice(0, 60);
        const isBlank = el.target === "_blank" || el.getAttribute?.("target") === "_blank";
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        dispatchRealClick(el);
        await new Promise((r) => {
          const done = () => {
            window.removeEventListener("pagehide", done);
            window.removeEventListener("beforeunload", done);
            r();
          };
          window.addEventListener("pagehide", done, { once: true });
          window.addEventListener("beforeunload", done, { once: true });
          setTimeout(done, 250);
        });
        const navigated = window.location.href !== urlBefore;
        const destinationUrl = (navigated ? window.location.href : resolvedHref) || undefined;
        return {
          ok: true,
          action: "open_link",
          href: resolvedHref || undefined,
          newUrl: destinationUrl,
          openedNewTab: isBlank,
          urlBefore,
          urlAfter: window.location.href,
          stateChange: navigated ? "navigated" : isBlank ? "new_tab" : "clicked",
          message: `Opened link "${label}"${destinationUrl ? ` (${destinationUrl})` : ""}.`,
        };
      }

      return { ok: false, message: `Unknown browser action: ${act}` };
  };

  const tabUrlBefore = tab.url;
  const execRun = await runTabScript({
    target: { tabId: tab.id },
    func: executeFrameFunc,
    args: [action, selector, value, options],
    label: `executeAction:${action}:topFrame`,
  });

  const mainResult = execRun.results?.[0]?.result || {
    ok: false,
    message: execRun.error || "Action failed to execute.",
  };
  if (!mainResult.ok) {
    // Full-page navigation may destroy the top frame execution context slightly before tab.url updates
    if (
      !execRun.results?.[0]?.result &&
      ["click", "click_submit", "submit", "open_link", "open", "press_button", "press"].includes(
        String(action || "").toLowerCase(),
      )
    ) {
      for (let i = 0; i < 8; i++) {
        const updatedTab = await chrome.tabs.get(tab.id).catch(() => null);
        if (updatedTab?.url && updatedTab.url !== tabUrlBefore) {
          return {
            ok: true,
            action: String(action || "").toLowerCase(),
            stateChange: "navigated",
            urlBefore: tabUrlBefore,
            urlAfter: updatedTab.url,
            newUrl: updatedTab.url,
            message: `Navigated to ${updatedTab.url}.`,
          };
        }
        await new Promise((r) => setTimeout(r, 45));
      }
    }
    const subRun = await runTabScript({
      target: { tabId: tab.id, allFrames: true },
      func: executeFrameFunc,
      args: [action, selector, value, { ...(options || {}), skipTopFrame: true }],
      label: `executeAction:${action}:allFrames`,
    });
    const subHit = (subRun.results || []).find((r) => r.frameId !== 0 && r.result?.ok);
    if (subHit?.result) return subHit.result;
  }

  return mainResult;
}

/**
 * Extracts structured data (e.g. order IDs, table rows, list items) from active webpage.
 */
async function extractPageData(selector, extractType = "order_id", query, options = {}) {
  const tab = await activeTab();
  if (!tab?.id || !tab.url || RESTRICTED.test(tab.url)) {
    return { ok: false, message: "Cannot extract data from restricted browser page." };
  }

  const extractFrameFunc = (sel, type, q, opts) => {
      const normalize = (t) => (t || "").replace(/\s+/g, " ").trim();
      const queryAllDeep = (selector, root = document) => {
        const out = [...root.querySelectorAll(selector)];
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
        let node;
        while ((node = walker.nextNode())) {
          if (node.shadowRoot) {
            out.push(...queryAllDeep(selector, node.shadowRoot));
          }
        }
        return out;
      };
      const extracted = [];

      // 1. Extract Order IDs pattern
      if (type === "order_id" || type === "orders") {
        const orderIdPattern = /(?:order[_\-\s]*id[:\s]*|oid[:\s\-]*|#\s*)([a-zA-Z0-9_\-]{4,24})/i;
        const rows = queryAllDeep(
          sel || 'table tbody tr, [data-testid*="order"], div.order-card',
        );

        if (rows.length > 0) {
          rows.forEach((row, i) => {
            const rowText = normalize(row.innerText || row.textContent);
            const match = rowText.match(orderIdPattern);
            const cells = [...row.querySelectorAll("td, th, span")].map((c) =>
              normalize(c.innerText),
            );
            const idCandidate =
              cells.find((c) => /^[A-Z0-9_\-]{6,20}$/i.test(c) && /\d/.test(c)) ||
              (match ? match[1] : null);

            if (idCandidate) {
              extracted.push({
                orderId: idCandidate,
                rowNumber: i + 1,
                status: /pending|processing/i.test(rowText)
                  ? "pending"
                  : /shipped|delivered/i.test(rowText)
                    ? "completed"
                    : "unknown",
                details: rowText.slice(0, 120),
              });
            }
          });
        }

        // If no structured rows found, search the whole page text for order IDs
        if (extracted.length === 0) {
          const orderIdGlobal = /(?:order[_\-\s]*id[:\s]*|oid[:\s\-]*|#\s*)([a-zA-Z0-9_\-]{4,24})/gi;
          const pageText = document.body?.innerText || "";
          let m;
          const seen = new Set();
          while ((m = orderIdGlobal.exec(pageText)) !== null && extracted.length < 30) {
            const id = m[1];
            if (id && /\d/.test(id) && !seen.has(id)) {
              seen.add(id);
              extracted.push({
                orderId: id,
                status: "unknown",
                details: "Extracted from visible page content",
              });
            }
          }
        }

        if (extracted.length === 0) {
          return {
            ok: false,
            count: 0,
            type: "order_id",
            extracted: [],
            summary: "No matching order IDs were found on this page.",
          };
        }

        return {
          ok: true,
          count: extracted.length,
          type: "order_id",
          extracted,
          summary: `Extracted ${extracted.length} order IDs from page.`,
        };
      }

      // 2. Generic list or table extraction
      const elements = queryAllDeep(sel || "table tbody tr, ul li");
      elements.forEach((el, idx) => {
        if (idx < (opts?.limit || 50)) {
          const t = normalize(el.innerText || el.textContent);
          if (t) extracted.push(t);
        }
      });

      return {
        ok: extracted.length > 0,
        count: extracted.length,
        type: "list",
        extracted,
        summary:
          extracted.length > 0
            ? `Extracted ${extracted.length} items from page.`
            : "No matching table rows or list items were found on this page.",
      };
  };

  const extractRun = await runTabScript({
    target: { tabId: tab.id },
    func: extractFrameFunc,
    args: [selector, extractType, query, options],
    label: `extractPageData:${extractType}:topFrame`,
  });

  let result = extractRun.results?.[0]?.result || {
    ok: false,
    count: 0,
    extracted: [],
    message: extractRun.error || "Extraction failed to execute.",
  };
  if (!result.ok && (result.count || 0) === 0) {
    const subRun = await runTabScript({
      target: { tabId: tab.id, allFrames: true },
      func: extractFrameFunc,
      args: [selector, extractType, query, options],
      label: `extractPageData:${extractType}:allFrames`,
    });
    const subHit = (subRun.results || []).find(
      (r) => r.frameId !== 0 && r.result?.ok && r.result.count > 0,
    );
    if (subHit?.result) result = subHit.result;
  }

  return result;
}

/**
 * Tab management: navigates active or specified tab and waits for load completion.
 */
async function navigateTab(url, tabId) {
  if (!url || RESTRICTED.test(url)) {
    return { ok: false, message: "Cannot navigate to restricted browser URL." };
  }
  let targetTabId = tabId;
  if (!targetTabId) {
    const tab = await activeTab();
    targetTabId = tab?.id;
  }
  if (!targetTabId) {
    const newTab = await chrome.tabs.create({ url });
    return { ok: true, tabId: newTab.id, url: newTab.url, navigated: true };
  }

  await chrome.tabs.update(targetTabId, { url });

  // Wait for status complete with timeout tracking
  const completed = await new Promise((resolve) => {
    let settled = false;
    const listener = (id, changeInfo) => {
      if (id === targetTabId && changeInfo.status === "complete") {
        settled = true;
        chrome.tabs.onUpdated?.removeListener?.(listener);
        resolve(true);
      }
    };
    chrome.tabs.onUpdated?.addListener?.(listener);
    setTimeout(() => {
      chrome.tabs.onUpdated?.removeListener?.(listener);
      resolve(settled);
    }, 5000);
  });

  const updatedTab = await chrome.tabs.get(targetTabId).catch(() => null);
  const finalUrl = updatedTab?.url || url;
  const isErrorPage = /^(?:chrome-error|about:neterror):/i.test(finalUrl);
  const isComplete = Boolean(completed || updatedTab?.status === "complete");
  const ok = !isErrorPage && isComplete;

  return {
    ok,
    timedOut: !isComplete,
    errorPage: isErrorPage,
    tabId: targetTabId,
    url: finalUrl,
    title: updatedTab?.title,
    navigated: ok,
    message: isErrorPage
      ? `Page failed to load (${finalUrl}).`
      : !isComplete
        ? `Timed out waiting for ${finalUrl} to finish loading.`
        : `Navigated to ${finalUrl}.`,
  };
}

async function navigateHistory(direction = "back") {
  const dir = String(direction || "back").toLowerCase();
  const tab = await activeTab();
  if (!tab?.id || !tab.url || RESTRICTED.test(tab.url)) {
    return { ok: false, message: "Cannot navigate history on this browser tab." };
  }
  const waitComplete = () =>
    new Promise((resolve) => {
      let settled = false;
      const listener = (id, changeInfo) => {
        if (id === tab.id && changeInfo.status === "complete") {
          settled = true;
          chrome.tabs.onUpdated?.removeListener?.(listener);
          resolve(true);
        }
      };
      chrome.tabs.onUpdated?.addListener?.(listener);
      setTimeout(() => {
        chrome.tabs.onUpdated?.removeListener?.(listener);
        resolve(settled);
      }, 4500);
    });

  try {
    if (dir === "reload" || dir === "refresh") {
      await chrome.tabs.reload(tab.id);
      const completed = await waitComplete();
      const updated = await chrome.tabs.get(tab.id).catch(() => null);
      return {
        ok: Boolean(completed || updated?.status === "complete"),
        direction: "reload",
        url: updated?.url || tab.url,
        title: updated?.title || tab.title,
        message: `Refreshed page (${updated?.title || updated?.url || "current tab"}).`,
      };
    }
    if (dir === "forward") {
      if (typeof chrome.tabs.goForward !== "function") {
        return { ok: false, message: "Browser forward navigation API unavailable." };
      }
      await chrome.tabs.goForward(tab.id);
      await waitComplete();
      const updated = await chrome.tabs.get(tab.id).catch(() => null);
      return {
        ok: true,
        direction: "forward",
        url: updated?.url || tab.url,
        title: updated?.title,
        message: `Went forward to ${updated?.url || "next page"}.`,
      };
    }
    if (typeof chrome.tabs.goBack !== "function") {
      return { ok: false, message: "Browser back navigation API unavailable." };
    }
    await chrome.tabs.goBack(tab.id);
    await waitComplete();
    const updated = await chrome.tabs.get(tab.id).catch(() => null);
    return {
      ok: true,
      direction: "back",
      url: updated?.url || tab.url,
      title: updated?.title,
      message: `Went back to ${updated?.url || "previous page"}.`,
    };
  } catch (err) {
    return {
      ok: false,
      direction: dir,
      message: String(err?.message || err || `Could not go ${dir} in browser history.`),
    };
  }
}

async function getAllTabs() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  return {
    ok: true,
    tabs: tabs.map((t) => ({
      id: t.id,
      title: t.title || "Untitled",
      url: t.url || "",
      active: Boolean(t.active),
    })),
  };
}

async function switchTab(tabId) {
  if (!tabId) return { ok: false, message: "No tab ID provided." };
  await chrome.tabs.update(tabId, { active: true });
  return { ok: true, tabId };
}

async function keyboardAction(key = "Enter", selector, options = {}) {
  return executeAction("keyboard", selector, key, options);
}

/**
 * Triple-Signal Settle Detector:
 * Awaits document readyState, DOM mutation quiescence via MutationObserver,
 * and requestAnimationFrame render flush. Replaces arbitrary sleep timeouts.
 */
async function waitForPageSettle(timeoutMs = 6000) {
  const tab = await activeTab();
  if (!tab?.id || !tab.url || RESTRICTED.test(tab.url)) {
    return { ok: true, settled: true, reason: "Restricted page or no tab" };
  }

  const settleRun = await runTabScript({
    target: { tabId: tab.id },
    func: async (maxWait) => {
      const startTime = performance.now();

      // 1. ReadyState check
      if (document.readyState === "loading") {
        await new Promise((resolve) => {
          const onReady = () => {
            if (document.readyState !== "loading") {
              document.removeEventListener("readystatechange", onReady);
              resolve();
            }
          };
          document.addEventListener("readystatechange", onReady);
          setTimeout(resolve, 2000);
        });
      }

      // 2. MutationObserver Quiescence Window (wait for 300ms without DOM mutations)
      await new Promise((resolve) => {
        let timer = null;
        const observer = new MutationObserver(() => {
          if (timer) clearTimeout(timer);
          timer = setTimeout(done, 300);
        });

        const done = () => {
          observer.disconnect();
          if (timer) clearTimeout(timer);
          resolve();
        };

        try {
          observer.observe(document.body || document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
          });
          timer = setTimeout(done, 300);
        } catch {
          resolve();
        }

        // Hard boundary
        setTimeout(done, Math.min(maxWait, 5000));
      });

      // 3. Render flush
      await new Promise((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(resolve);
        });
      });

      return {
        ok: true,
        settled: true,
        elapsedMs: Math.round(performance.now() - startTime),
      };
    },
    args: [timeoutMs],
    label: "waitForPageSettle",
  });

  return settleRun.results?.[0]?.result || { ok: true, settled: true };
}

async function waitForCondition(selector, text, timeoutMs = 4000) {
  const tab = await activeTab();
  if (!tab?.id || !tab.url || RESTRICTED.test(tab.url)) {
    return { ok: false, message: "Cannot wait on restricted page." };
  }

  const waitRun = await runTabScript({
    target: { tabId: tab.id },
    func: async (sel, targetText, maxWait) => {
      const normalize = (t) => (t || "").replace(/\s+/g, " ").trim().toLowerCase();
      const start = Date.now();
      while (Date.now() - start < maxWait) {
        if (sel) {
          try {
            const el = document.querySelector(sel);
            if (el) return { ok: true, found: true, elapsedMs: Date.now() - start };
          } catch {}
        }
        if (targetText) {
          const t = normalize(targetText);
          const bodyText = normalize(document.body.innerText || "");
          if (bodyText.includes(t)) {
            return { ok: true, found: true, elapsedMs: Date.now() - start };
          }
        }
        await new Promise((r) => setTimeout(r, 200));
      }
      return { ok: true, found: false, timeout: true };
    },
    args: [selector, text, timeoutMs],
    label: "waitForCondition",
  });

  return waitRun.results?.[0]?.result || {
    ok: false,
    message: waitRun.error || "Wait condition timed out.",
  };
}

/**
 * Executes a single step of a multi-action plan on the active tab.
 */
async function executePlanStepInTab(step, options = {}) {
  if (!step) return { ok: false, message: "No step provided." };

  // Consequential action check
  const SENSITIVE_CONSEQUENTIAL = /purchase|click_delete|click_submit|send_message/;
  if (
    SENSITIVE_CONSEQUENTIAL.test(step.action) &&
    step.requiresApproval &&
    !options?.userApproved
  ) {
    return {
      ok: false,
      awaitingApproval: true,
      message: `Step "${step.title}" requires user approval before execution.`,
    };
  }

  // 1. Navigation
  if (step.action === "navigate") {
    const navUrl = step.value || step.tabUrl;
    if (navUrl && !RESTRICTED.test(navUrl)) {
      const res = await navigateTab(navUrl);
      return {
        ok: res.ok,
        verified: res.ok,
        result: `Navigated to ${res.url || navUrl}`,
      };
    }
    return { ok: true, verified: true, result: "Current page is ready." };
  }

  // 2. Data extraction
  if (step.action === "extract") {
    if (step.value === "copy_list" && Array.isArray(options?.extractedDataStore) && options.extractedDataStore.length > 0) {
      const formattedText = options.extractedDataStore
        .map((d) =>
          typeof d === "string"
            ? d
            : d?.orderId
              ? `${d.orderId} (${d.status || "pending"}) — ${d.details || ""}`
              : JSON.stringify(d),
        )
        .join("\n");
      const tab = await activeTab();
      if (tab?.id && tab.url && !RESTRICTED.test(tab.url)) {
        await runTabScript({
          target: { tabId: tab.id },
          func: (txt) => {
            try {
              if (navigator.clipboard?.writeText) {
                navigator.clipboard.writeText(txt).catch(() => {});
              }
            } catch {}
            try {
              const ta = document.createElement("textarea");
              ta.value = txt;
              ta.style.position = "fixed";
              ta.style.opacity = "0";
              document.body.appendChild(ta);
              ta.select();
              document.execCommand("copy");
              ta.remove();
            } catch {}
          },
          args: [formattedText],
          label: "copyExtractedList",
        });
      }
      return {
        ok: true,
        verified: true,
        result: `Prepared & copied ${options.extractedDataStore.length} extracted item(s).`,
      };
    }
    const extractRes = await extractPageData(
      step.selector,
      step.value || "order_id",
      step.textTarget,
      options,
    );
    return {
      ok: extractRes.ok,
      verified: extractRes.ok,
      result: extractRes.summary || "Data extracted successfully.",
      extractedData: extractRes.extracted,
    };
  }

  // 3. Tab operations
  if (step.action === "switch_tab") {
    const res = await switchTab(step.tabId);
    return { ok: res.ok, verified: res.ok, result: `Switched to tab ${step.tabId}` };
  }

  // 4. Keyboard actions
  if (step.action === "keyboard") {
    const res = await keyboardAction(step.value || "Enter", step.selector, options);
    return { ok: res.ok, verified: res.ok, result: res.message };
  }

  // 5. Wait for condition
  if (step.action === "wait_for") {
    const res = await waitForCondition(step.selector, step.textTarget, 3000);
    return { ok: res.ok, verified: res.ok, result: "Condition verified." };
  }

  // 5b. Fill from uploaded document (Aadhaar / PAN / invoice / ID)
  if (step.action === "fill_from_document") {
    const docFields = options?.uploadedDocumentFields || {};
    const requested = Array.isArray(step.requestedFields) ? step.requestedFields : [];
    const pairs = [];
    const missing = [];

    const FIELD_ALIASES = {
      name: ["name"],
      naam: ["name"],
      father: ["fatherName"],
      fathername: ["fatherName"],
      dob: ["dob"],
      birthdate: ["dob"],
      gender: ["gender"],
      phone: ["phone"],
      mobile: ["phone"],
      email: ["email"],
      address: ["address"],
      pata: ["address"],
      city: ["city"],
      state: ["state"],
      pincode: ["pincode"],
      pin: ["pincode"],
      aadhaar: ["aadhaarNumber"],
      aadhar: ["aadhaarNumber"],
      aadhaarnumber: ["aadhaarNumber"],
      pan: ["panNumber"],
      pannumber: ["panNumber"],
      gstin: ["gstin"],
      invoice: ["invoiceNumber"],
      order: ["orderId"],
      tracking: ["trackingNumber"],
      company: ["company"],
    };

    if (requested.length > 0) {
      for (const reqKey of requested) {
        const norm = String(reqKey).toLowerCase().replace(/[^a-z]/g, "");
        const candidates = FIELD_ALIASES[norm] || [reqKey];
        const matchedDocKey = candidates.find((k) => docFields[k]);
        if (matchedDocKey && docFields[matchedDocKey]) {
          pairs.push({ target: matchedDocKey, value: docFields[matchedDocKey], overwrite: Boolean(step.overwrite) });
        } else {
          missing.push(reqKey);
        }
      }
    } else {
      for (const [k, v] of Object.entries(docFields)) {
        if (v) pairs.push({ target: k, value: v, overwrite: Boolean(step.overwrite) });
      }
    }

    if (pairs.length === 0) {
      return {
        ok: false,
        verified: false,
        error: missing.length
          ? `Uploaded document does not contain clear values for: ${missing.join(", ")}.`
          : "No extracted document fields available to fill.",
      };
    }

    const fillRes = await smartFillForm(null, {
      explicitPairs: pairs,
      explicitUserProvided: true,
      fromUploadedDocument: true,
      overwrite: Boolean(step.overwrite),
    });
    const filledCount = fillRes?.results?.filled?.length || 0;
    const preservedCount = fillRes?.results?.preserved?.length || 0;
    return {
      ok: fillRes?.ok && (filledCount > 0 || preservedCount > 0),
      verified: filledCount > 0 || preservedCount > 0,
      result: `Filled ${filledCount} field(s) from uploaded document${missing.length ? ` (missing in doc: ${missing.join(", ")})` : ""}.`,
      error: filledCount === 0 && preservedCount === 0 ? "No matching editable fields found on this page." : undefined,
    };
  }

  // 5c. Smart single-field fill in multi-step plan (handles dynamically appearing inputs cleanly)
  if (step.action === "fill_field" && step.value !== undefined) {
    const fillRes = await smartFillForm(null, {
      explicitPairs: [
        {
          target: step.textTarget || step.selector || "__CURRENT__",
          value: step.value,
          selector: step.selector || undefined,
          overwrite: Boolean(step.overwrite),
        },
      ],
      explicitUserProvided: true,
      overwrite: Boolean(step.overwrite),
    });
    const filled = fillRes?.results?.filled || [];
    const preserved = fillRes?.results?.preserved || [];
    const ok = fillRes?.ok && (filled.length > 0 || preserved.length > 0);
    return {
      ok,
      verified: ok,
      result:
        filled.length > 0
          ? `Filled "${filled[0].field}" with "${filled[0].value}".`
          : preserved.length > 0
            ? `Preserved existing value in "${preserved[0].field}".`
            : `Could not locate field "${step.textTarget || step.selector}".`,
      error: ok ? undefined : `Field "${step.textTarget || step.selector}" not found.`,
    };
  }

  // 6. Click, Select, Scroll, Check
  const actRes = await executeAction(step.action, step.selector, step.value, {
    text: step.textTarget,
    ...options,
  });

  return {
    ok: actRes.ok,
    verified: actRes.verified ?? actRes.ok,
    result: actRes.message || `Executed ${step.action}`,
    error: actRes.ok ? undefined : actRes.message,
  };
}

/**
 * Runs a multi-action plan sequentially on the browser tab, reporting step progress.
 */
async function executePlan(plan, options = {}) {
  if (!plan || !Array.isArray(plan.steps)) {
    return { ok: false, message: "Invalid plan provided." };
  }

  const updatedPlan = { ...plan, status: "running" };
  const extractedItems = [];

  for (let i = plan.currentStepIndex || 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];
    step.status = "running";

    // Notify listeners of running step
    sendPanelNotification({
      type: "PLAN_STEP_PROGRESS",
      planId: plan.id,
      stepIndex: i,
      stepStatus: "running",
      stepTitle: step.title,
    });

    // Execute step
    const res = await executePlanStepInTab(step, options);

    if (res.awaitingApproval) {
      step.status = "awaiting_approval";
      updatedPlan.status = "awaiting_approval";
      updatedPlan.pendingApprovalStepId = step.id;
      updatedPlan.currentStepIndex = i;

      sendPanelNotification({
        type: "PLAN_STEP_PROGRESS",
        planId: plan.id,
        stepIndex: i,
        stepStatus: "awaiting_approval",
        stepTitle: step.title,
      });

      return {
        ok: true,
        awaitingApproval: true,
        plan: updatedPlan,
        step,
      };
    }

    if (!res.ok) {
      step.status = "failed";
      step.error = res.error || "Action execution failed.";
      updatedPlan.status = "failed";
      updatedPlan.currentStepIndex = i;

      sendPanelNotification({
        type: "PLAN_STEP_PROGRESS",
        planId: plan.id,
        stepIndex: i,
        stepStatus: "failed",
        error: step.error,
      });

      return { ok: false, plan: updatedPlan, error: step.error };
    }

    step.status = "completed";
    step.verified = true;
    step.result = res.result;
    if (res.extractedData) {
      step.extractedData = res.extractedData;
      if (Array.isArray(res.extractedData)) {
        extractedItems.push(...res.extractedData);
      } else {
        extractedItems.push(res.extractedData);
      }
    }

    sendPanelNotification({
      type: "PLAN_STEP_PROGRESS",
      planId: plan.id,
      stepIndex: i,
      stepStatus: "completed",
      result: step.result,
    });

    // Small natural delay between multi-step browser actions
    await new Promise((r) => setTimeout(r, 450));
  }

  updatedPlan.status = "completed";
  updatedPlan.currentStepIndex = plan.steps.length;
  updatedPlan.extractedData = extractedItems;
  updatedPlan.completedAt = new Date().toISOString();

  return { ok: true, plan: updatedPlan };
}
