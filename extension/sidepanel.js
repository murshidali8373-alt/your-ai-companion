const $ = (id) => document.getElementById(id);
const DEFAULT_BASE = "https://ais-dev-5t53lwemhepi2nbkqb2reo-152127168827.asia-east1.run.app";
const FALLBACK_PRE_BASE = "https://ais-pre-5t53lwemhepi2nbkqb2reo-152127168827.asia-east1.run.app";
const RESTRICTED =
  /^(chrome|edge|about|chrome-extension|devtools|view-source):|chromewebstore\.google\.com|chrome\.google\.com\/webstore/;

let verifiedBackendBaseCache = null;

function normalizeExtensionAssetUrl(raw) {
  const s = String(raw || "").trim();
  if (!s) return "./assets/buddy-general-3d.webp";
  if (s.startsWith("/assets/")) return `.${s}`;
  return s;
}

async function probeBuddyHealthOrigin(origin, timeoutMs = 1800) {
  try {
    const res = await fetchWithTimeout(`${origin}/api/public/extension/health`, {}, timeoutMs);
    if (!res.ok) return false;
    const j = await res.json().catch(() => null);
    return Boolean(j && (j.ok !== undefined || j.checks));
  } catch {
    return false;
  }
}

async function getResolvedBackendBase() {
  const { lastBase, session, buddyApiBaseUrl } = await chrome.storage.local.get([
    "lastBase",
    "session",
    "buddyApiBaseUrl",
  ]);
  let base = session?.apiBase || lastBase || buddyApiBaseUrl;
  if (base) {
    try {
      const parsed = new URL(base);
      base = parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.origin : null;
    } catch {
      base = null;
    }
  }
  const tryCandidates = async () => {
    if (verifiedBackendBaseCache) return verifiedBackendBaseCache;
    const candidateOrigins = [];
    if (base) candidateOrigins.push(base);
    try {
      const allTabs = await chrome.tabs.query({});
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
        candidateOrigins.push("http://127.0.0.1:3000", "http://localhost:3000");
      }
    } catch {}
    candidateOrigins.push(DEFAULT_BASE, FALLBACK_PRE_BASE, "http://127.0.0.1:3000", "http://localhost:3000");
    for (const origin of [...new Set(candidateOrigins)]) {
      if (await probeBuddyHealthOrigin(origin)) {
        verifiedBackendBaseCache = origin;
        chrome.storage.local.set({ lastBase: origin }).catch(() => {});
        return origin;
      }
    }
    return base || DEFAULT_BASE;
  };

  if (base) {
    const ok = await probeBuddyHealthOrigin(base, 1200);
    if (ok) {
      verifiedBackendBaseCache = base;
      return base;
    }
  }
  return tryCandidates();
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// --- STRUCTURED SIDEPANEL ↔ BACKGROUND IPC LOGGER & SAFE DISPATCHER ---
const MAX_SP_COMM_LOGS = 100;
const spCommLogBuffer = [];
let spTraceSeq = 0;

function summarizeSidepanelPayload(payload) {
  if (!payload || typeof payload !== "object") return { invalid: typeof payload };
  const summary = { type: payload.type };
  if (payload.action) summary.action = payload.action;
  if (payload.selector) summary.selector = String(payload.selector).slice(0, 80);
  if (typeof payload.question === "string") summary.questionLen = payload.question.length;
  if (typeof payload.query === "string") summary.queryLen = payload.query.length;
  if (payload.intent) summary.intent = payload.intent;
  if (payload.step?.action) summary.stepAction = payload.step.action;
  if (payload.fields && typeof payload.fields === "object") {
    summary.fieldCount = Object.keys(payload.fields).length;
  }
  if (payload.options?.explicitPairs) {
    summary.explicitPairCount = payload.options.explicitPairs.length;
  }
  if (payload.document?.fileName) {
    summary.docFile = payload.document.fileName;
  }
  return summary;
}

function spLog(level, stage, detail = {}) {
  const entry = {
    ts: new Date().toISOString(),
    source: "SidePanel",
    level,
    stage,
    ...detail,
  };
  spCommLogBuffer.push(entry);
  if (spCommLogBuffer.length > MAX_SP_COMM_LOGS) {
    spCommLogBuffer.shift();
  }
  try {
    const logger = console[level] || console.info;
    logger("[AI Buddy][SidePanel]", entry);
  } catch {}
}

window.__aiBuddyGetCommLogs = () => spCommLogBuffer.slice();

async function sendRuntimeMessage(payload, opts = {}) {
  const traceId = `sp_${Date.now().toString(36)}_${++spTraceSeq}`;
  const envelope = { ...payload, __traceId: traceId };
  const isLongTask =
    payload?.type === "ASK" ||
    payload?.type === "EXTRACT_DOCUMENT" ||
    payload?.type === "EXECUTE_PLAN";
  const timeoutMs = opts.timeoutMs || (isLongTask ? 60000 : 15000);
  const startedAt = Date.now();

  if (!opts.silent) {
    spLog("info", "ipc:outbound", {
      traceId,
      payload: summarizeSidepanelPayload(payload),
    });
  }

  if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
    const errMsg = "Chrome extension runtime is unavailable.";
    spLog("error", "ipc:runtime_missing", { traceId, type: payload?.type });
    return { ok: false, error: errMsg, message: errMsg, ipcError: true };
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result, isFailure, reason) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!opts.silent || isFailure) {
        spLog(isFailure ? "warn" : "info", isFailure ? "ipc:failed" : "ipc:response", {
          traceId,
          type: payload?.type,
          elapsedMs: Date.now() - startedAt,
          ok: result?.ok !== undefined ? Boolean(result.ok) : !result?.error,
          error: reason || result?.error || (result?.ok === false ? result?.message : undefined),
        });
      }
      resolve(result);
    };

    const timer = setTimeout(() => {
      const timeoutMsg = `Background worker timed out (${timeoutMs}ms) handling ${payload?.type}.`;
      finish({ ok: false, error: timeoutMsg, message: timeoutMsg, ipcError: true }, true, timeoutMsg);
    }, timeoutMs);

    try {
      chrome.runtime.sendMessage(envelope, (res) => {
        const lastErr = chrome.runtime?.lastError;
        if (lastErr) {
          const errMsg = lastErr.message || String(lastErr);
          finish(
            { ok: false, error: errMsg, message: errMsg, ipcError: true },
            true,
            `lastError: ${errMsg}`,
          );
          return;
        }
        if (res === undefined) {
          const emptyMsg = `No response returned from background worker for ${payload?.type}.`;
          finish(
            { ok: false, error: emptyMsg, message: emptyMsg, ipcError: true },
            true,
            "undefined_reply",
          );
          return;
        }
        finish(res, Boolean(res?.error || res?.ok === false), res?.error || res?.message);
      });
    } catch (err) {
      const errMsg = String(err?.message || err);
      finish({ ok: false, error: errMsg, message: errMsg, ipcError: true }, true, errMsg);
    }
  });
}

// --- CANONICAL 16 BUDDIES REGISTRY ---
// 15 specialist buddies + 1 user Custom Buddy preloaded for offline/immediate access
const BUDDIES_REGISTRY = [
  {
    slug: "friendly",
    name: "Friendly Buddy",
    tagline: "Your everyday browser companion",
    expertise: ["General", "Guidance", "Explanation"],
    outfit: "teal",
    outfitColors: ["#0d9488", "#0f766e"],
    cue: "none",
    image: "./assets/buddy-general-3d.webp",
    defaultLanguage: "hinglish",
    isCustom: false,
  },
  {
    slug: "developer",
    name: "Developer Buddy",
    tagline: "Read code, find bugs, propose patches",
    expertise: ["Debugging", "Refactoring", "Testing", "Security"],
    outfit: "charcoal",
    outfitColors: ["#334155", "#1e293b"],
    cue: "laptop",
    image: "./assets/buddy-developer-3d.webp",
    defaultLanguage: "english",
    isCustom: false,
  },
  {
    slug: "ca",
    name: "CA Buddy",
    tagline: "GST, invoices and compliance, explained simply",
    expertise: ["GST", "Accounting", "Compliance", "Reconciliation"],
    outfit: "charcoal",
    outfitColors: ["#334155", "#1e293b"],
    cue: "ledger",
    image: "./assets/buddy-ca-3d.webp",
    defaultLanguage: "hinglish",
    isCustom: false,
  },
  {
    slug: "legal",
    name: "Legal Buddy",
    tagline: "Understand documents and clauses without the jargon",
    expertise: ["Contracts", "Compliance", "Drafting", "Research"],
    outfit: "charcoal",
    outfitColors: ["#334155", "#1e293b"],
    cue: "book",
    image: "./assets/buddy-legal-3d.webp",
    defaultLanguage: "english",
    isCustom: false,
  },
  {
    slug: "ecommerce",
    name: "E-commerce Buddy",
    tagline: "Listings, keywords and marketplace workflows",
    expertise: ["Listings", "SEO", "Ads", "Catalog", "Pricing"],
    outfit: "teal",
    outfitColors: ["#0d9488", "#0f766e"],
    cue: "parcel",
    image: "./assets/buddy-ecommerce-3d.webp",
    defaultLanguage: "hinglish",
    isCustom: false,
  },
  {
    slug: "business",
    name: "Business Buddy",
    tagline: "Plans, numbers and decisions",
    expertise: ["Strategy", "Finance", "Operations"],
    outfit: "blue",
    outfitColors: ["#2563eb", "#1d4ed8"],
    cue: "briefcase",
    image: "./assets/buddy-business-3d.webp",
    defaultLanguage: "hinglish",
    isCustom: false,
  },
  {
    slug: "marketing",
    name: "Marketing Buddy",
    tagline: "Copy, campaigns and creative angles",
    expertise: ["Copywriting", "Ads", "SEO", "Social"],
    outfit: "coral",
    outfitColors: ["#ea580c", "#c2410c"],
    cue: "campaign",
    image: "./assets/buddy-marketing-3d.webp",
    defaultLanguage: "hinglish",
    isCustom: false,
  },
  {
    slug: "research",
    name: "Research Buddy",
    tagline: "Find, compare and summarise",
    expertise: ["Research", "Summarisation", "Comparison"],
    outfit: "sage",
    outfitColors: ["#4d7c0f", "#3f6212"],
    cue: "book",
    image: "./assets/buddy-research-3d.webp",
    defaultLanguage: "english",
    isCustom: false,
  },
  {
    slug: "data",
    name: "Data Buddy",
    tagline: "Spreadsheets, tables and patterns",
    expertise: ["Spreadsheets", "Analysis", "Reporting"],
    outfit: "blue",
    outfitColors: ["#2563eb", "#1d4ed8"],
    cue: "chart",
    image: "./assets/buddy-data-3d.webp",
    defaultLanguage: "english",
    isCustom: false,
  },
  {
    slug: "content",
    name: "Content Buddy",
    tagline: "Write and rewrite anything",
    expertise: ["Writing", "Editing", "Structure"],
    outfit: "burgundy",
    outfitColors: ["#831843", "#701a75"],
    cue: "pen",
    image: "./assets/buddy-content-3d.webp",
    defaultLanguage: "hinglish",
    isCustom: false,
  },
  {
    slug: "design",
    name: "Design Buddy",
    tagline: "Layout, hierarchy and visual polish",
    expertise: ["UI", "Layout", "Branding"],
    outfit: "lilac",
    outfitColors: ["#9333ea", "#7e22ce"],
    cue: "swatches",
    image: "./assets/buddy-design-3d.webp",
    defaultLanguage: "english",
    isCustom: false,
  },
  {
    slug: "operations",
    name: "Operations Buddy",
    tagline: "Process, checklists and follow-through",
    expertise: ["Process", "SOPs", "Automation"],
    outfit: "blue",
    outfitColors: ["#2563eb", "#1d4ed8"],
    cue: "briefcase",
    image: "./assets/buddy-business-3d.webp",
    defaultLanguage: "hinglish",
    isCustom: false,
  },
  {
    slug: "professor",
    name: "Professor Buddy",
    tagline: "Teaches until it actually clicks",
    expertise: ["Teaching", "Explanation", "Examples"],
    outfit: "sage",
    outfitColors: ["#4d7c0f", "#3f6212"],
    cue: "book",
    image: "./assets/buddy-professor-3d.webp",
    defaultLanguage: "hinglish",
    isCustom: false,
  },
  {
    slug: "dadaji",
    name: "Dadaji Buddy",
    tagline: "Old-school wisdom, gentle pace",
    expertise: ["Guidance", "Patience", "BasicTech"],
    outfit: "teal",
    outfitColors: ["#0d9488", "#0f766e"],
    cue: "none",
    image: "./assets/buddy-family-3d.png",
    defaultLanguage: "hindi",
    isCustom: false,
  },
  {
    slug: "detective",
    name: "Detective Buddy",
    tagline: "Finds what is actually wrong",
    expertise: ["Diagnosis", "RootCause", "Verification"],
    outfit: "sage",
    outfitColors: ["#4d7c0f", "#3f6212"],
    cue: "book",
    image: "./assets/buddy-research-3d.webp",
    defaultLanguage: "english",
    isCustom: false,
  },
  {
    slug: "custom:user_custom_buddy_1",
    id: "user_custom_buddy_1",
    name: "Custom Buddy",
    tagline: "Tailored to my workflow, forms and personal preferences",
    expertise: ["Custom Workflows", "Form Automation", "Document Review", "Specialized Guidance"],
    outfit: "teal",
    outfitColors: ["#0d9488", "#0f766e"],
    cue: "parcel",
    image: "./assets/buddy-ecommerce-3d.webp",
    defaultLanguage: "hinglish",
    isCustom: true,
  },
];

let allBuddies = [...BUDDIES_REGISTRY];
let selectedBuddySlug = "friendly";
let selectedCustomBuddyId = null;
let currentRenderMode = "3d"; // "3d" (WebGL GLB) | "rigged" (2D vector fallback) | "artwork" (static webp)
let buddy3dViewer = null;
let webglFallbackActive = false;
let lastEmotionChangedAt = 0;
let selectedProvider = "auto";
let cachedProviderStatuses = {};
const warnedMissingProviders = new Set();
const recommendedModesShown = new Set();

const DEFAULT_PROVIDER_META = {
  auto: { id: "auto", name: "Auto (Smart Routing)", status: "connected", statusLabel: "Auto", supportsLocal: false },
  gemini: { id: "gemini", name: "Google Gemini", status: "missing_api", statusLabel: "Unverified", missingKeyName: "GEMINI_API_KEY", supportsLocal: false },
  groq: { id: "groq", name: "GroqCloud", status: "missing_api", statusLabel: "Missing API", missingKeyName: "GROQ_API_KEY", supportsLocal: false },
  openrouter: { id: "openrouter", name: "OpenRouter", status: "missing_api", statusLabel: "Missing API", missingKeyName: "OPENROUTER_API_KEY", supportsLocal: false },
  openai: { id: "openai", name: "OpenAI", status: "missing_api", statusLabel: "Missing API", missingKeyName: "OPENAI_API_KEY", supportsLocal: false },
  ollama: { id: "ollama", name: "Ollama (Local)", status: "not_connected", statusLabel: "Not Connected", missingKeyName: "OLLAMA_BASE_URL", supportsLocal: true },
  huggingface: { id: "huggingface", name: "Hugging Face Inference", status: "missing_api", statusLabel: "Missing API", missingKeyName: "HUGGINGFACE_API_KEY", supportsLocal: false },
  cloudflare: { id: "cloudflare", name: "Cloudflare Workers AI", status: "missing_api", statusLabel: "Missing API", missingKeyName: "CLOUDFLARE_API_TOKEN", supportsLocal: false },
  github: { id: "github", name: "GitHub Models", status: "missing_api", statusLabel: "Missing API", missingKeyName: "GITHUB_TOKEN", supportsLocal: false },
};

let busy = false;
let currentAnswer = "";
let lastHighlightSelector = null;
let lastHighlightFrameId = 0;
let lastPointCoords = null;
let lastCallout = { title: null, description: null };
let pendingAction = null;
let pendingDisambiguation = null;
let pendingSlot = null;
let activeFormSession = null;
let lastExecutionAttempt = null;
let pendingAutoListenAfterSpeech = false;
let pendingAutoMicRequest = null;
const sessionTaskContext = {
  lastActionType: null,
  lastTargetField: null,
  lastTargetSelector: null,
  lastTargetRef: null,
  lastOptions: null,
  lastItems: null,
  recentFields: [],
  undoStack: [],
  originalTabId: null,
  openTabs: [],
  lastActionProposal: null,
};
const sessionActionLog = [];

function maybeAutoActivateMic({ reason = "incomplete_command", deferUntilSpeechEnd = false } = {}) {
  const allowedReasons = new Set([
    "incomplete_form_fill",
    "incomplete_search",
    "missing_value",
    "next_form_field",
  ]);
  if (!allowedReasons.has(reason)) return false;

  try {
    window.__buddyAutoMicLog = window.__buddyAutoMicLog || [];
    window.__buddyAutoMicLog.push({ reason, deferUntilSpeechEnd, at: Date.now() });
  } catch {}

  if (isLiveVoiceMode || busy || pendingAction) return false;
  if (!recognition) {
    // Keep text input focused & ready without error spam when browser has no SpeechRecognition
    return false;
  }

  if (isRecognizing) {
    pendingAutoMicRequest = { reason, deferUntilSpeechEnd };
    return true;
  }

  if (deferUntilSpeechEnd && isBuddySpeaking) {
    pendingAutoListenAfterSpeech = true;
    return true;
  }

  pendingAutoListenAfterSpeech = false;
  const attemptStart = () => {
    if (isLiveVoiceMode || isRecognizing || busy || pendingAction) return;
    if (!pendingSlot && !activeFormSession?.awaitingField) return;
    startVoiceListening();
  };

  if (navigator.permissions?.query) {
    navigator.permissions
      .query({ name: "microphone" })
      .then((perm) => {
        if (perm?.state === "denied") {
          const denyMsg =
            "Microphone permission is blocked. Type your reply below or allow mic access in Chrome.";
          updateVoiceUiState("error", denyMsg);
          return;
        }
        attemptStart();
      })
      .catch(() => attemptStart());
    return true;
  }
  attemptStart();
  return true;
}

function recordTaskContext({
  actionType,
  targetField,
  targetSelector,
  targetRef,
  undoRecord,
  originalTabId,
  openTabId,
  options,
  items,
  proposal,
} = {}) {
  if (actionType) sessionTaskContext.lastActionType = actionType;
  if (targetField && targetField !== "__CURRENT__") {
    sessionTaskContext.lastTargetField = targetField;
    sessionTaskContext.recentFields = [
      targetField,
      ...sessionTaskContext.recentFields.filter((f) => f !== targetField),
    ].slice(0, 6);
  }
  if (targetSelector !== undefined) sessionTaskContext.lastTargetSelector = targetSelector;
  if (targetRef !== undefined) sessionTaskContext.lastTargetRef = targetRef;
  if (undoRecord && undoRecord.selector) {
    sessionTaskContext.undoStack = [...(sessionTaskContext.undoStack || []), undoRecord].slice(-25);
  }
  if (originalTabId !== undefined) sessionTaskContext.originalTabId = originalTabId;
  if (openTabId !== undefined && !sessionTaskContext.openTabs.includes(openTabId)) {
    sessionTaskContext.openTabs = [...sessionTaskContext.openTabs, openTabId].slice(-12);
  }
  if (options !== undefined) sessionTaskContext.lastOptions = options;
  if (items !== undefined) sessionTaskContext.lastItems = items;
  if (proposal !== undefined) sessionTaskContext.lastActionProposal = proposal;
}

function sanitizeLogSummary(text) {
  return String(text || "")
    .replace(/\b(\d{4})[\s-]?(\d{4})[\s-]?(\d{4})[\s-]?(\d{4})\b/g, "XXXX-XXXX-XXXX-$4")
    .replace(/\b(\d{4})[\s-]?(\d{4})[\s-]?(\d{4})\b/g, "XXXX-XXXX-$3")
    .replace(/\b([A-Z]{5})([0-9]{4})([A-Z])\b/g, "XXXXXX$2$3");
}

function recordSessionAction(summary, status = "confirmed") {
  const icon = status === "failed" ? "✗" : status === "unconfirmed" ? "?" : "✓";
  sessionActionLog.push({
    ts: new Date().toLocaleTimeString(),
    status,
    icon,
    summary: sanitizeLogSummary(summary),
  });
  if (sessionActionLog.length > 50) {
    sessionActionLog.shift();
  }
}
let recognition = null;
let isRecognizing = false;
let isLiveVoiceMode = false;
let isBuddySpeaking = false;
let liveVoiceState = "idle"; // "idle" | "listening" | "processing" | "speaking" | "error"
let liveVoiceRestartTimer = null;
let isMuted = false;
let currentEmotion = "idle";
let blinkInterval = null;
let speechMouthInterval = null;

const MOUTH_SHAPES = {
  rest: "M 46 51 Q 50 53 54 51",
  smile: "M 45 51 Q 50 55 55 51",
  wide_smile: "M 44 51 Q 50 58 56 51 Q 50 49 44 51 Z",
  open_o: "M 47 51 C 47 48 53 48 53 51 C 53 55 47 55 47 51 Z",
  open_a: "M 45 51 Q 50 57 55 51 Q 50 48 45 51 Z",
  open_e: "M 45 51 Q 50 54 55 51 Q 50 49 45 51 Z",
  frown: "M 45 51 Q 50 47 55 51",
  laugh: "M 43 51 Q 50 59 57 51 Q 50 48 43 51 Z",
};

function getActiveBuddy() {
  return allBuddies.find((b) => b.slug === selectedBuddySlug) || allBuddies[0];
}

function ensureNonBlankState() {
  const stage = $("characterStage");
  const wantHidden = $("sizeSelect")?.value === "hidden";
  if (stage && stage.style.display === "none" && !wantHidden) {
    stage.style.display = "flex";
  }
  const active = getActiveBuddy();
  if ($("activeBuddyName") && !$("activeBuddyName").textContent) {
    switchBuddy(selectedBuddySlug || "friendly");
  }
  const targetMode = currentRenderMode || "rigged";
  const wrap3d = $("buddy3dCanvasWrap");
  const svg = $("characterSvg");
  const img = $("buddy3dImg");
  const alreadySynced =
    (targetMode === "3d" && !webglFallbackActive && buddy3dViewer && wrap3d && !wrap3d.hidden) ||
    (targetMode === "artwork" && img && !img.hidden) ||
    (targetMode === "rigged" && svg && svg.style.display === "block");
  if (!alreadySynced) {
    applyRenderMode(targetMode);
  } else if (targetMode === "3d") {
    buddy3dViewer?.setPaused?.(wantHidden);
  }
  return active;
}

// Centralized BuddyStateManager for side panel
const BuddyStateManager = {
  get buddies() {
    return allBuddies;
  },
  get selectedBuddySlug() {
    return selectedBuddySlug;
  },
  get selectedBuddy() {
    return getActiveBuddy();
  },
  selectBuddy(slugOrId) {
    switchBuddy(slugOrId);
  },
  getActiveBuddy() {
    return getActiveBuddy();
  },
  ensureNonBlankState() {
    return ensureNonBlankState();
  },
  handleTabSwitch(tabId) {
    lastHighlightSelector = null;
    lastHighlightFrameId = 0;
    lastPointCoords = null;
    lastCallout = { title: null, description: null };
    pendingAction = null;
    pendingDisambiguation = null;
    pendingSlot = null;
    activeFormSession = null;
    pendingAutoListenAfterSpeech = false;
    pendingAutoMicRequest = null;
    if ($("highlightBtn")) $("highlightBtn").hidden = true;
    if ($("confirmCard")) $("confirmCard").hidden = true;
    if ($("pageCompletenessBanner")) $("pageCompletenessBanner").hidden = true;
    sendRuntimeMessage({ type: "CLEAR_HIGHLIGHT" }, { silent: true }).catch(() => {});
    ensureNonBlankState();
    updateGreetingContext();
    checkPageForErrors();
    if ($("tabPage") && !$("tabPage").hidden) {
      loadPageContextSummary();
    }
  },
  setEmotion(emotion, label) {
    setRigEmotion(emotion, label);
  },
};
window.BuddyStateManager = BuddyStateManager;
window.buddyStateManager = BuddyStateManager;

function setMouthShape(shape) {
  const mouthEl = $("rigMouth");
  if (!mouthEl) return;
  const path = MOUTH_SHAPES[shape] || MOUTH_SHAPES.rest;
  mouthEl.setAttribute("d", path);
  mouthEl.setAttribute(
    "fill",
    shape === "wide_smile" || shape === "open_o" || shape === "open_a" || shape === "laugh"
      ? "#b91c1c"
      : "none",
  );
}

function initBuddy3DStage() {
  if (buddy3dViewer || webglFallbackActive) return;
  const wrap = $("buddy3dCanvasWrap");
  const rt = window.Buddy3DRuntime;
  if (!wrap || !rt || !rt.isSupported?.()) {
    webglFallbackActive = true;
    applyRenderMode("rigged");
    return;
  }
  try {
    buddy3dViewer = rt.createStageViewer(wrap, {
      initialVariant: selectedBuddySlug || "general",
      modelsBaseUrl: "./models",
      onError: () => {
        webglFallbackActive = true;
        buddy3dViewer = null;
        applyRenderMode("rigged");
      },
      onInteract: () => {
        if (busy || isRecognizing || currentEmotion === "privacy") return;
        setRigEmotion("happy", "Giggle");
        setMouthShape("laugh");
        setTimeout(() => {
          if (currentEmotion === "happy") setRigEmotion("idle", "Ready");
        }, 900);
      },
    });
  } catch {
    webglFallbackActive = true;
    buddy3dViewer = null;
    applyRenderMode("rigged");
  }
}

function setRigEmotion(emotion, label, extra = {}) {
  const rt = window.Buddy3DRuntime;
  const canonical = rt?.normalizeCompanionState
    ? rt.normalizeCompanionState(emotion)
    : String(emotion || "idle").toLowerCase();

  const now = Date.now();
  const hasExplicitPointCoords = canonical === "pointing" && typeof extra?.targetYRatio === "number";
  if (
    !hasExplicitPointCoords &&
    rt?.shouldTransitionCompanionState &&
    currentEmotion === canonical &&
    now - lastEmotionChangedAt < 120
  ) {
    return;
  }
  lastEmotionChangedAt = now;
  currentEmotion = canonical;

  const badge = $("buddyEmotionBadge");
  if (badge) {
    badge.textContent = label || canonical.toUpperCase();
    badge.className = `status-badge ${canonical}`;
  }

  const avatarWrap = $("buddyAvatar");
  if (avatarWrap) {
    avatarWrap.setAttribute("data-emotion", canonical);
  }

  if (buddy3dViewer) {
    buddy3dViewer.setEmotion(canonical);
  }

  const browLeft = $("rigBrowLeft");
  const browRight = $("rigBrowRight");
  const armLeft = $("rigArmLeft");
  const armRight = $("rigArmRight");
  const lidLeft = $("rigLidLeft");
  const lidRight = $("rigLidRight");
  const pupilLeft = $("rigPupilLeft");
  const pupilRight = $("rigPupilRight");
  const svg = $("characterSvg");

  if (!browLeft || !browRight) return;

  // Toggle privacy eyelid closure in 2D SVG fallback cleanly
  if (canonical === "privacy") {
    if (lidLeft) lidLeft.style.display = "block";
    if (lidRight) lidRight.style.display = "block";
    if (pupilLeft) pupilLeft.style.display = "none";
    if (pupilRight) pupilRight.style.display = "none";
    if (svg) svg.style.transform = "scaleX(-0.92) rotate(5deg)";
    browLeft.setAttribute("transform", "translate(40, 37) rotate(-4)");
    browRight.setAttribute("transform", "translate(61, 37) rotate(4)");
    setMouthShape("rest");
    if (armLeft) armLeft.removeAttribute("transform");
    if (armRight) armRight.removeAttribute("transform");
    return;
  } else {
    if (lidLeft) lidLeft.style.display = "none";
    if (lidRight) lidRight.style.display = "none";
    if (pupilLeft) pupilLeft.style.display = "block";
    if (pupilRight) pupilRight.style.display = "block";
    if (svg) svg.style.transform = "";
  }

  switch (canonical) {
    case "happy":
    case "excited":
    case "success":
      browLeft.setAttribute("transform", "translate(40, 36) rotate(-8)");
      browRight.setAttribute("transform", "translate(61, 36) rotate(8)");
      setMouthShape("wide_smile");
      if (armLeft) armLeft.setAttribute("transform", "translate(0, -3)");
      if (armRight) armRight.setAttribute("transform", "translate(0, -3)");
      break;
    case "thinking":
      browLeft.setAttribute("transform", "translate(40, 36) rotate(-10)");
      browRight.setAttribute("transform", "translate(61, 36) rotate(6)");
      setMouthShape("rest");
      if (armLeft) armLeft.setAttribute("transform", "translate(2, -3)");
      if (armRight) armRight.removeAttribute("transform");
      break;
    case "pointing": {
      browLeft.setAttribute("transform", "translate(40, 36) rotate(-5)");
      browRight.setAttribute("transform", "translate(61, 36) rotate(5)");
      setMouthShape("smile");
      const yRatio =
        typeof extra?.targetYRatio === "number"
          ? Math.max(0, Math.min(1, extra.targetYRatio))
          : 0.5;
      const pointAngle = Math.round(52 + (0.5 - yRatio) * 44);
      if (armLeft) armLeft.setAttribute("transform", `rotate(${pointAngle} 34 62) scale(1.15 1)`);
      if (armRight) armRight.removeAttribute("transform");
      if (buddy3dViewer?.lookAt) {
        const lookX =
          typeof extra?.targetXRatio === "number"
            ? Math.max(-1, Math.min(1, extra.targetXRatio * 2 - 1))
            : -0.75;
        const lookY = Math.max(-1, Math.min(1, yRatio * 2 - 1));
        buddy3dViewer.lookAt(lookX, lookY);
      }
      break;
    }
    case "confused":
      browLeft.setAttribute("transform", "translate(40, 36) rotate(-12)");
      browRight.setAttribute("transform", "translate(61, 36) rotate(10)");
      setMouthShape("frown");
      if (armLeft) armLeft.removeAttribute("transform");
      if (armRight) armRight.removeAttribute("transform");
      break;
    case "listening":
      browLeft.setAttribute("transform", "translate(40, 36) rotate(-6)");
      browRight.setAttribute("transform", "translate(61, 36) rotate(6)");
      setMouthShape("smile");
      if (armLeft) armLeft.removeAttribute("transform");
      if (armRight) armRight.removeAttribute("transform");
      break;
    case "talking":
      browLeft.setAttribute("transform", "translate(40, 36) rotate(-4)");
      browRight.setAttribute("transform", "translate(61, 36) rotate(4)");
      if (armLeft) armLeft.removeAttribute("transform");
      if (armRight) armRight.removeAttribute("transform");
      break;
    case "concerned":
    case "error":
      browLeft.setAttribute("transform", "translate(40, 36) rotate(10)");
      browRight.setAttribute("transform", "translate(61, 36) rotate(-10)");
      setMouthShape("frown");
      if (armLeft) armLeft.removeAttribute("transform");
      if (armRight) armRight.removeAttribute("transform");
      break;
    case "idle":
    default:
      browLeft.setAttribute("transform", "translate(40, 36) rotate(0)");
      browRight.setAttribute("transform", "translate(61, 36) rotate(0)");
      setMouthShape("smile");
      if (armLeft) armLeft.removeAttribute("transform");
      if (armRight) armRight.removeAttribute("transform");
      break;
  }
}

function updateSpecialistProp(cue, outfitColor) {
  const container = $("rigPropContainer");
  if (!container) return;
  container.innerHTML = "";

  if (cue === "none" || !cue) return;

  if (cue === "laptop") {
    container.innerHTML = `
      <g>
        <rect x="56" y="66" width="18" height="15" rx="1.5" fill="#1e293b" />
        <rect x="58" y="68" width="14" height="9" rx="1" fill="#0d9488" opacity="0.3" />
        <path d="m61 72-2 2 2 2m4-4 2 2-2 2" stroke="#5eead4" stroke-width="0.8" fill="none" />
        <path d="M53 81h24" stroke="#94a3b8" stroke-width="1.2" />
      </g>
    `;
  } else if (cue === "ledger" || cue === "book") {
    container.innerHTML = `
      <g>
        <rect x="58" y="65" width="18" height="18" rx="2" fill="#701a75" stroke="#94a3b8" stroke-width="0.7" />
        <path d="M60 67v14m3-12h10m-10 4h10m-10 4h7" stroke="#ffffff" stroke-width="0.8" />
        <ellipse cx="58" cy="79" rx="4" ry="3" fill="#f8fafc" stroke="#94a3b8" stroke-width="0.7" />
      </g>
    `;
  } else if (cue === "parcel") {
    container.innerHTML = `
      <g>
        <rect x="57" y="65" width="18" height="17" rx="2" fill="#d97706" stroke="#94a3b8" stroke-width="0.7" />
        <path d="M66 65v17m-6-8h12" stroke="#ffffff" stroke-width="1.5" />
        <ellipse cx="58" cy="79" rx="4" ry="3" fill="#f8fafc" stroke="#94a3b8" stroke-width="0.7" />
      </g>
    `;
  } else if (cue === "briefcase") {
    container.innerHTML = `
      <g>
        <rect x="57" y="67" width="19" height="15" rx="2" fill="#1e293b" stroke="#94a3b8" stroke-width="0.7" />
        <path d="M63 67v-3h7v3" stroke="#94a3b8" stroke-width="1" fill="none" />
        <circle cx="66.5" cy="74" r="1.5" fill="#f59e0b" />
        <ellipse cx="58" cy="79" rx="4" ry="3" fill="#f8fafc" stroke="#94a3b8" stroke-width="0.7" />
      </g>
    `;
  } else if (cue === "chart" || cue === "campaign") {
    container.innerHTML = `
      <g>
        <rect x="57" y="66" width="18" height="16" rx="2" fill="#0f172a" stroke="#94a3b8" stroke-width="0.7" />
        <path d="M60 78v-5m4 5v-8m4 5v-11" stroke="${outfitColor}" stroke-width="2.5" stroke-linecap="round" />
        <ellipse cx="58" cy="79" rx="4" ry="3" fill="#f8fafc" stroke="#94a3b8" stroke-width="0.7" />
      </g>
    `;
  } else if (cue === "swatches") {
    container.innerHTML = `
      <g>
        <path d="m60 79 2-12 5 1-2 12Z" fill="#ea580c" />
        <path d="m65 80 4-12 4 2-4 12Z" fill="#0d9488" />
        <ellipse cx="58" cy="79" rx="4" ry="3" fill="#f8fafc" stroke="#94a3b8" stroke-width="0.7" />
      </g>
    `;
  } else if (cue === "pen") {
    container.innerHTML = `
      <g>
        <path d="M62 67l8 8-2 2-8-8z" fill="#f59e0b" stroke="#94a3b8" stroke-width="0.6" />
        <path d="M61 66l1 1-2 2z" fill="#0f172a" />
        <ellipse cx="58" cy="79" rx="4" ry="3" fill="#f8fafc" stroke="#94a3b8" stroke-width="0.7" />
      </g>
    `;
  }
}

/**
 * Switch Buddy:
 * Transitions active character, updates outfit gradient, props, artwork image,
 * updates persona banner, and persists the choice in local storage.
 */
function switchBuddy(slugOrId, { persist = true, silent = false } = {}) {
  const target = allBuddies.find((b) => b.slug === slugOrId || b.id === slugOrId);
  if (!target) return;

  const prevSlug = selectedBuddySlug;
  const prevCustomId = selectedCustomBuddyId;
  selectedBuddySlug = target.slug;
  selectedCustomBuddyId = target.isCustom ? target.id || target.slug.replace("custom:", "") : null;

  if (persist && (prevSlug !== selectedBuddySlug || prevCustomId !== selectedCustomBuddyId)) {
    chrome.storage.local.set({
      selectedBuddySlug,
      selectedCustomBuddyId,
    }).catch(() => {});
  }

  // 1. Update Carousel selection highlight
  document.querySelectorAll(".buddy-card").forEach((card) => {
    const isThis = card.dataset.slug === selectedBuddySlug;
    card.classList.toggle("active", isThis);
  });

  // 2. Update Active Persona Banner
  if ($("activeBuddyName")) $("activeBuddyName").textContent = target.name;
  if ($("activeBuddyBadge")) {
    $("activeBuddyBadge").textContent = target.isCustom
      ? "Custom"
      : target.expertise[0] || "Specialist";
  }
  if ($("activeBuddyTagline")) $("activeBuddyTagline").textContent = target.tagline;

  // 3. Update Outfit Colors in SVG Rig
  const colors = target.outfitColors || ["#0d9488", "#0f766e"];
  const stop1 = $("outfitStop1");
  const stop2 = $("outfitStop2");
  if (stop1) stop1.setAttribute("stop-color", colors[0]);
  if (stop2) stop2.setAttribute("stop-color", colors[1] || colors[0]);

  // Update sleeve fills
  const sleeveLeft = $("rigArmLeftSleeve");
  const sleeveRight = $("rigArmRightSleeve");
  if (sleeveLeft) sleeveLeft.setAttribute("fill", "url(#outfitGrad)");
  if (sleeveRight) sleeveRight.setAttribute("fill", "url(#outfitGrad)");

  // 4. Update Specialist Prop
  updateSpecialistProp(target.cue, colors[0]);

  // 5. Update Pre-rendered 3D Artwork & Real-time 3D GLB Variant
  const img3d = $("buddy3dImg");
  if (img3d) {
    img3d.onerror = () => {
      img3d.onerror = null;
      img3d.src = "./assets/buddy-general-3d.webp";
    };
    img3d.src = normalizeExtensionAssetUrl(target.image);
    img3d.alt = target.name;
  }
  if (buddy3dViewer) {
    buddy3dViewer.loadVariant(target.slug);
  }

  // 6. Natural greeting feedback on interactive switch
  if (!silent) {
    setRigEmotion("happy", target.name.split(" ")[0]);
    setTimeout(() => {
      if (currentEmotion === "happy") setRigEmotion("idle", "Ready");
    }, 900);
  }
}

/**
 * Render the 16 Buddies Carousel Selector:
 * Populates all 15 specialist buddies and 1 Custom Buddy.
 */
function renderBuddyCarousel() {
  const container = $("buddyCarousel");
  if (!container) return;
  container.innerHTML = "";

  allBuddies.forEach((buddy) => {
    const card = document.createElement("div");
    card.className = `buddy-card ${buddy.slug === selectedBuddySlug ? "active" : ""} ${buddy.isCustom ? "custom-badge" : ""}`;
    card.dataset.slug = buddy.slug;
    card.title = `${buddy.name} — ${buddy.tagline}`;

    const thumb = document.createElement("div");
    thumb.className = "buddy-thumb";
    const img = document.createElement("img");
    img.src = normalizeExtensionAssetUrl(buddy.image);
    img.alt = buddy.name;
    img.loading = "lazy";
    img.onerror = () => {
      img.onerror = null;
      img.src = "./assets/buddy-general-3d.webp";
    };
    thumb.appendChild(img);

    const label = document.createElement("span");
    label.className = "buddy-card-name";
    label.textContent = buddy.name.replace(" Buddy", "");

    if (buddy.isCustom) {
      const dot = document.createElement("span");
      dot.className = "custom-dot";
      card.appendChild(dot);
    }

    card.appendChild(thumb);
    card.appendChild(label);

    card.onclick = () => switchBuddy(buddy.slug);
    container.appendChild(card);
  });

  if ($("buddyCountBadge")) {
    $("buddyCountBadge").textContent = `${allBuddies.length} available`;
  }
}

// Setup Gaze tracking across SVG fallback + 3D GLB Buddy
window.addEventListener("mousemove", (e) => {
  const stage = $("characterStage");
  if (!stage) return;
  const rect = stage.getBoundingClientRect();
  const nx = (e.clientX - (rect.left + rect.width / 2)) / (window.innerWidth / 2);
  const ny = (e.clientY - (rect.top + rect.height * 0.4)) / (window.innerHeight / 2);
  if (buddy3dViewer && currentEmotion !== "privacy") {
    buddy3dViewer.lookAt(Math.max(-1, Math.min(1, nx)), Math.max(-1, Math.min(1, ny)));
  }
  const pupilLeft = $("rigPupilLeft");
  const pupilRight = $("rigPupilRight");
  if (pupilLeft && pupilRight) {
    const clampX = Math.max(-1.1, Math.min(1.1, nx * 1.1));
    const clampY = Math.max(-0.8, Math.min(0.8, ny * 0.8));
    pupilLeft.setAttribute("transform", `translate(${clampX.toFixed(2)}, ${clampY.toFixed(2)})`);
    pupilRight.setAttribute("transform", `translate(${clampX.toFixed(2)}, ${clampY.toFixed(2)})`);
  }
});

// Setup Blinking
function setupBlinking() {
  if (blinkInterval) clearInterval(blinkInterval);
  blinkInterval = setInterval(() => {
    const lidLeft = $("rigLidLeft");
    const lidRight = $("rigLidRight");
    const pupilLeft = $("rigPupilLeft");
    const pupilRight = $("rigPupilRight");
    if (!lidLeft || !lidRight) return;

    lidLeft.style.display = "block";
    lidRight.style.display = "block";
    if (pupilLeft) pupilLeft.style.display = "none";
    if (pupilRight) pupilRight.style.display = "none";

    setTimeout(() => {
      lidLeft.style.display = "none";
      lidRight.style.display = "none";
      if (pupilLeft) pupilLeft.style.display = "block";
      if (pupilRight) pupilRight.style.display = "block";
    }, 180);
  }, 3800);
}
setupBlinking();

// Speech mouth cycle
function startSpeechMouthCycle() {
  if (speechMouthInterval) clearInterval(speechMouthInterval);
  const shapes = ["open_a", "open_o", "open_e", "wide_smile", "rest", "open_a"];
  let idx = 0;
  speechMouthInterval = setInterval(() => {
    idx = (idx + 1) % shapes.length;
    setMouthShape(shapes[idx]);
  }, 130);
}

function stopSpeechMouthCycle() {
  if (speechMouthInterval) {
    clearInterval(speechMouthInterval);
    speechMouthInterval = null;
  }
  setMouthShape("smile");
}

// Tap Buddy fallback SVG to trigger friendly expression
$("buddyAvatar")?.addEventListener("click", () => {
  if (busy || isRecognizing || currentEmotion === "privacy") return;
  setRigEmotion("happy", "Giggle");
  setMouthShape("laugh");
  setTimeout(() => {
    if (currentEmotion === "happy") setRigEmotion("idle", "Idle");
  }, 900);
});

function updateVoiceUiState(state, statusMsg) {
  liveVoiceState = state;
  const vb = $("voiceBtn");
  const lvb = $("liveVoiceBtn");
  if (vb) {
    vb.classList.toggle("active", state === "listening");
    vb.classList.toggle("listening", state === "listening");
    vb.classList.toggle("speaking-active", state === "speaking");
    vb.textContent =
      state === "listening"
        ? "🛑 Listening…"
        : state === "speaking"
          ? "✋ Interrupt"
          : state === "processing"
            ? "⏳ Thinking…"
            : "🎤 Talk";
  }
  if (lvb) {
    lvb.classList.toggle("live-active", isLiveVoiceMode);
    lvb.textContent = isLiveVoiceMode ? "🟢 Live On" : "🎙️ Live";
  }
  if (statusMsg && $("statusText")) {
    $("statusText").textContent = statusMsg;
  }
}

function clearLiveRestartTimer() {
  if (liveVoiceRestartTimer) {
    clearTimeout(liveVoiceRestartTimer);
    liveVoiceRestartTimer = null;
  }
}

function interruptBuddySpeech({ resumeListening = false } = {}) {
  clearLiveRestartTimer();
  isBuddySpeaking = false;
  try {
    window.speechSynthesis?.cancel?.();
  } catch {}
  stopSpeechMouthCycle();
  buddy3dViewer?.setSpeaking?.(false);
  if (currentEmotion !== "privacy") {
    setRigEmotion(resumeListening ? "listening" : "idle", resumeListening ? "Listening" : "Idle");
  }
  updateVoiceUiState(resumeListening ? "listening" : "idle");
  if (resumeListening) {
    startVoiceListening();
  }
}

function startVoiceListening() {
  clearLiveRestartTimer();
  if (!recognition) {
    const msg = "Speech recognition is not supported in this browser window.";
    updateVoiceUiState("error", msg);
    setRigEmotion("concerned", "No Mic");
    appendHistory("buddy", `🎤 ${msg}`);
    return false;
  }
  if (isBuddySpeaking) {
    interruptBuddySpeech({ resumeListening: false });
  }
  if (isRecognizing) return true;
  try {
    const active = getActiveBuddy();
    recognition.lang = active?.defaultLanguage === "english" ? "en-IN" : "hi-IN";
    recognition.interimResults = true;
    recognition.start();
    return true;
  } catch {
    stopVoice();
    return false;
  }
}

function toggleLiveVoice(forceState) {
  const next = typeof forceState === "boolean" ? forceState : !isLiveVoiceMode;
  isLiveVoiceMode = next;
  if (!isLiveVoiceMode) {
    clearLiveRestartTimer();
    pendingAutoMicRequest = null;
    try {
      recognition?.stop?.();
    } catch {}
    interruptBuddySpeech({ resumeListening: false });
    updateVoiceUiState("idle", "Live conversation stopped.");
    return false;
  }
  updateVoiceUiState("listening", "Live conversation active — speak anytime…");
  return startVoiceListening();
}

window.__buddyVoiceController = {
  getState: () => ({
    liveVoiceState,
    isLiveVoiceMode,
    isRecognizing,
    isBuddySpeaking,
    pendingAutoListenAfterSpeech,
  }),
  toggleLiveVoice,
  startVoiceListening,
  interruptBuddySpeech,
  maybeAutoActivateMic,
};

// Speech recognition setup
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = "en-IN";

  recognition.onstart = () => {
    isRecognizing = true;
    setRigEmotion("listening", "Listening");
    updateVoiceUiState(
      "listening",
      isLiveVoiceMode ? "Live conversation: listening…" : "Listening to your voice…",
    );
  };

  recognition.onresult = (event) => {
    let interimText = "";
    let finalText = "";
    const results = event?.results || [];
    for (let i = 0; i < results.length; i++) {
      const alt = results[i]?.[0]?.transcript || "";
      if (results[i]?.isFinal) finalText += `${alt} `;
      else interimText += `${alt} `;
    }
    if (isBuddySpeaking && (interimText.trim() || finalText.trim())) {
      interruptBuddySpeech({ resumeListening: false });
    }
    const interimClean = interimText.trim();
    if (interimClean && $("promptInput") && !finalText.trim()) {
      $("promptInput").value = interimClean;
    }
    const finalClean = finalText.trim();
    if (finalClean) {
      if ($("promptInput")) $("promptInput").value = finalClean;
      updateVoiceUiState("processing", `Heard: "${finalClean}"`);
      sendQuery(finalClean, "answer", { fromVoice: true });
    }
  };

  recognition.onerror = (event) => {
    const code = event?.error || "";
    isRecognizing = false;
    if (code === "aborted") {
      if (!isLiveVoiceMode && !busy && !isBuddySpeaking) updateVoiceUiState("idle");
      return;
    }
    if (code === "no-speech" && isLiveVoiceMode) {
      updateVoiceUiState("listening", "Live conversation: waiting for speech…");
      clearLiveRestartTimer();
      liveVoiceRestartTimer = setTimeout(() => {
        if (isLiveVoiceMode && !busy && !isBuddySpeaking && !isRecognizing) {
          startVoiceListening();
        }
      }, 350);
      return;
    }
    const msg =
      code === "not-allowed" || code === "service-not-allowed"
        ? "Microphone permission denied. Please allow microphone access in Chrome site/extension settings."
        : code === "audio-capture"
          ? "No microphone was detected. Connect a microphone and try again."
          : code === "no-speech"
            ? "No speech detected. Try speaking closer to your microphone."
            : `Voice input error (${code}).`;
    if (code === "not-allowed" || code === "audio-capture") {
      isLiveVoiceMode = false;
      pendingAutoMicRequest = null;
      appendHistory("buddy", `🎤 ${msg}`);
    }
    updateVoiceUiState("error", msg);
    if (!busy) setRigEmotion("concerned", "Mic Notice");
  };

  recognition.onend = () => {
    isRecognizing = false;
    if (isLiveVoiceMode && !busy && !isBuddySpeaking && liveVoiceState !== "error") {
      clearLiveRestartTimer();
      liveVoiceRestartTimer = setTimeout(() => {
        if (isLiveVoiceMode && !busy && !isBuddySpeaking && !isRecognizing) {
          startVoiceListening();
        }
      }, 320);
      return;
    }
    if (pendingAutoMicRequest && !busy && !isBuddySpeaking && liveVoiceState !== "error") {
      const queuedReq = pendingAutoMicRequest;
      pendingAutoMicRequest = null;
      setTimeout(() => {
        if (!isRecognizing && !busy && !isBuddySpeaking && !isLiveVoiceMode) {
          maybeAutoActivateMic(queuedReq);
        }
      }, 180);
      return;
    }
    if (!busy && !isBuddySpeaking && liveVoiceState !== "error") {
      stopVoice();
    }
  };
}

function stopVoice() {
  isRecognizing = false;
  if (!busy && !isBuddySpeaking) {
    setRigEmotion("idle", "Idle");
    updateVoiceUiState("idle");
  }
}

function setEmotion(emotion, label) {
  setRigEmotion(emotion, label);
}

function mapBackendEmotion(rawEmotion, hasHighlight) {
  if (hasHighlight) return "pointing";
  const e = String(rawEmotion || "")
    .toLowerCase()
    .trim();
  switch (e) {
    case "thinking":
      return "thinking";
    case "happy":
    case "celebrate":
    case "excited":
    case "success":
      return "happy";
    case "pointing":
      return "pointing";
    case "speaking":
      return "speaking";
    case "listening":
      return "listening";
    case "concerned":
    case "error":
      return "error";
    case "curious":
    case "confused":
      return "confused";
    case "idle":
    case "neutral":
    default:
      return "idle";
  }
}

const MAX_CONVERSATION_TURNS = 3;
const conversationBuffer = [];

function appendHistory(role, text) {
  const box = $("historyBox");
  if (!box) return;
  const bubble = document.createElement("div");
  bubble.className = `msg-bubble ${role === "user" ? "msg-user" : "msg-buddy"}`;
  bubble.textContent = text;
  box.appendChild(bubble);
  box.scrollTop = box.scrollHeight;
}

function appendProviderWarningNotice(warning, providerFailure = null) {
  const effectiveWarning =
    warning ||
    (providerFailure
      ? {
          requestedProvider: providerFailure.provider || "gemini",
          status: providerFailure.kind || "server_error",
          message: providerFailure.message,
        }
      : null);
  if (!effectiveWarning || !effectiveWarning.message) {
    return;
  }
  const dedupKey = `${effectiveWarning.requestedProvider || "gemini"}:${effectiveWarning.status || "unknown"}:${effectiveWarning.message}`;
  if (warnedMissingProviders.has(dedupKey)) {
    return;
  }
  warnedMissingProviders.add(dedupKey);
  const box = $("historyBox");
  if (!box) return;
  const notice = document.createElement("div");
  notice.className = "msg-bubble msg-buddy";
  notice.style.cssText =
    "font-size: 10px; border-color: rgba(245, 158, 11, 0.35); background: rgba(245, 158, 11, 0.08); color: #fde68a;";
  const isRuntimeErr =
    effectiveWarning.status === "rate_limit" ||
    effectiveWarning.status === "auth_error" ||
    effectiveWarning.status === "outage" ||
    effectiveWarning.status === "server_error" ||
    effectiveWarning.status === "network_error" ||
    Boolean(providerFailure);
  notice.textContent = `${isRuntimeErr ? "⚠️" : "ℹ️"} ${effectiveWarning.message}`;
  box.appendChild(notice);
  box.scrollTop = box.scrollHeight;
}

function getLocalModeRecommendation(question, activeSlug, language) {
  const q = String(question || "").trim();
  if (
    q.length < 12 ||
    /^(?:hi+|hello+|hey+|namaste|pranam|scroll\s+(?:up|down)|neeche\s+scroll|upar\s+scroll|page\s+ko\s+(?:neeche|upar)|click\s+|point\s+)/i.test(
      q,
    )
  ) {
    return null;
  }
  const normalizedActive = String(activeSlug || "friendly")
    .toLowerCase()
    .replace(/^custom:/, "");
  const rules = [
    {
      slug: "ecommerce",
      name: "E-commerce Buddy",
      reasonHi: "e-commerce analysis, listing aur pricing",
      reasonEn: "e-commerce listings, catalog, and marketplace pricing",
      re: /\b(?:meesho|amazon|flipkart|shopify|listing|catalog|sku|marketplace|pricing|seller\s*panel|return\s*rate|product\s*title)\b/i,
    },
    {
      slug: "ca",
      name: "CA Buddy",
      reasonHi: "GST, tax aur invoice compliance",
      reasonEn: "GST, tax rules, and invoice compliance",
      re: /\b(?:gst|gstr|tds|itr|income\s*tax|hsn|sac|reconcil|balance\s*sheet|tax\s*filing|accounting|invoice\s*audit)\b/i,
    },
    {
      slug: "developer",
      name: "Developer Buddy",
      reasonHi: "code debugging aur technical troubleshooting",
      reasonEn: "code debugging and technical troubleshooting",
      re: /\b(?:debug|stack\s*trace|typescript|javascript|python|react|api\s*error|console\s*error|regex|sql|refactor|exception|syntax\s*error)\b/i,
    },
    {
      slug: "legal",
      name: "Legal Buddy",
      reasonHi: "contract clauses aur legal review",
      reasonEn: "contract clauses and legal document review",
      re: /\b(?:contract|nda|legal\s*clause|agreement|indemnity|liability|arbitration|terms\s*(?:of|and)\s*conditions)\b/i,
    },
    {
      slug: "data",
      name: "Data Buddy",
      reasonHi: "spreadsheets, formulas aur data patterns",
      reasonEn: "spreadsheets, formulas, and dataset analysis",
      re: /\b(?:spreadsheet|excel|csv|pivot\s*table|vlookup|xlookup|duplicate\s*rows|dataset\s*analysis)\b/i,
    },
    {
      slug: "marketing",
      name: "Marketing Buddy",
      reasonHi: "ad campaigns, copywriting aur SEO growth",
      reasonEn: "ad campaigns, copywriting, and SEO growth",
      re: /\b(?:ad\s*copy|roas|ctr|meta\s*ads|google\s*ads|campaign\s*strategy|funnel|seo\s*keywords|marketing\s*copy)\b/i,
    },
  ];
  for (const r of rules) {
    if (!r.re.test(q) || normalizedActive === r.slug) continue;
    const isEnglish = language === "english";
    const reason = isEnglish ? r.reasonEn : r.reasonHi;
    return {
      slug: r.slug,
      name: r.name,
      reason,
      suggestionText: isEnglish
        ? `I can help with this, though ${r.name} is specialized for ${reason}. Would you like to select it?`
        : `Main ye kaam kar sakta hoon. Lekin detailed ${reason} ke liye ${r.name} better rahega. Kya aap use select karna chahenge?`,
    };
  }
  return null;
}

function appendModeRecommendationNotice(rec) {
  if (!rec || !rec.slug || rec.slug === selectedBuddySlug || recommendedModesShown.has(rec.slug)) {
    return;
  }
  recommendedModesShown.add(rec.slug);
  const box = $("historyBox");
  if (!box) return;

  const wrap = document.createElement("div");
  wrap.className = "msg-bubble msg-buddy";
  wrap.style.cssText =
    "font-size: 10px; border-color: rgba(6, 182, 212, 0.35); background: rgba(6, 182, 212, 0.08); display: flex; flex-direction: column; gap: 6px;";

  const textEl = document.createElement("span");
  textEl.textContent = `💡 ${rec.suggestionText}`;
  wrap.appendChild(textEl);

  const btnRow = document.createElement("div");
  btnRow.style.cssText = "display: flex; gap: 6px;";
  const switchBtn = document.createElement("button");
  switchBtn.className = "ghost";
  switchBtn.style.cssText =
    "padding: 3px 8px; font-size: 10px; border-color: rgba(6, 182, 212, 0.45); color: var(--accent-cyan); font-weight: 600;";
  switchBtn.textContent = `Select ${rec.name}`;
  switchBtn.onclick = () => {
    switchBuddy(rec.slug);
    switchBtn.disabled = true;
    switchBtn.textContent = `✓ Selected ${rec.name}`;
  };
  btnRow.appendChild(switchBtn);
  wrap.appendChild(btnRow);

  box.appendChild(wrap);
  box.scrollTop = box.scrollHeight;
}

function showChatLoadingSpinner(customText) {
  hideChatLoadingSpinner();
  const box = $("historyBox");
  if (!box) return null;
  const bubble = document.createElement("div");
  bubble.id = "aiThinkingBubble";
  bubble.className = "msg-bubble msg-buddy msg-loading";

  const ring = document.createElement("span");
  ring.className = "loading-spinner-ring";
  ring.setAttribute("aria-hidden", "true");

  const textSpan = document.createElement("span");
  textSpan.className = "loading-text";
  textSpan.textContent = customText || "Thinking…";

  const dots = document.createElement("span");
  dots.className = "loading-dots-wrap";
  for (let i = 0; i < 3; i++) {
    const dot = document.createElement("span");
    dot.className = "typing-dot";
    dots.appendChild(dot);
  }

  bubble.appendChild(ring);
  bubble.appendChild(textSpan);
  bubble.appendChild(dots);

  box.appendChild(bubble);
  box.scrollTop = box.scrollHeight;
  return bubble;
}

function hideChatLoadingSpinner() {
  const existing = $("aiThinkingBubble");
  if (existing) {
    existing.remove();
  }
}

function getRecentHistoryContext() {
  return conversationBuffer.slice(-MAX_CONVERSATION_TURNS).flatMap((turn) => [
    { role: "user", content: turn.user },
    { role: "assistant", content: turn.assistant },
  ]);
}

function recordConversationTurn(userQuestion, assistantAnswer) {
  if (!userQuestion || !assistantAnswer) return;
  conversationBuffer.push({ user: userQuestion, assistant: assistantAnswer });
  if (conversationBuffer.length > MAX_CONVERSATION_TURNS) {
    conversationBuffer.shift();
  }
  chrome.storage.local.set({ conversationBuffer }).catch(() => {});
}

function detectSpeechLanguageForExtension(text) {
  const sample = String(text || "");
  if (/[\u0900-\u097F]/.test(sample)) return "hi-IN";
  const hinglishHits = sample.match(
    /\b(?:kya|hai|hain|karo|kijiye|aap|aapka|aapke|main|maine|nahi|nhi|batao|dikhao|neeche|upar|kholo|bharo|bhariye|chahiye|kripya|samjhao|yahan|kahan|kaise)\b/gi,
  );
  if (hinglishHits && hinglishHits.length >= 2) return "hi-IN";
  return "en-IN";
}

function pickExtensionVoice(lang) {
  const voices = window.speechSynthesis?.getVoices?.() || [];
  if (!voices.length) return null;
  const target = String(lang || "en-IN").toLowerCase();
  const prefix = target.split("-")[0];
  return (
    voices.find((v) => v.lang?.toLowerCase() === target && /natural|google|heera|ravi|swara|madhur|lekha/i.test(v.name)) ||
    voices.find((v) => v.lang?.toLowerCase() === target) ||
    voices.find((v) => v.lang?.toLowerCase().startsWith(prefix)) ||
    voices.find((v) => v.lang?.toLowerCase().endsWith("-in")) ||
    null
  );
}

if (typeof window !== "undefined" && window.speechSynthesis?.addEventListener) {
  window.speechSynthesis.addEventListener("voiceschanged", () => {
    try {
      window.speechSynthesis.getVoices();
    } catch {}
  });
}

function cleanTextForSpeech(text) {
  return String(text || "")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[*_`~#]+/g, "")
    .replace(/[•▪►▸✅⚠️🎯📝📜🔒🛡️🌐⚡🔄⏸️⏭️⏹️🎤🔊🔇📄📌🎨🤖👤🧹🔌📊✨🙈📋]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

let speechWatchdogTimer = null;
let speechKeepAliveInterval = null;

function speakResponse(text, finishEmotion = "idle", speechOpts = {}) {
  const autoListenReason =
    typeof speechOpts?.autoListenReason === "string"
      ? speechOpts.autoListenReason
      : speechOpts?.autoListenOnFinish
        ? "missing_value"
        : null;

  const clearSpeechTimers = () => {
    if (speechWatchdogTimer) {
      clearTimeout(speechWatchdogTimer);
      speechWatchdogTimer = null;
    }
    if (speechKeepAliveInterval) {
      clearInterval(speechKeepAliveInterval);
      speechKeepAliveInterval = null;
    }
  };

  clearSpeechTimers();
  const spokenText = cleanTextForSpeech(text);
  if (
    isMuted ||
    !window.speechSynthesis ||
    typeof SpeechSynthesisUtterance === "undefined" ||
    !spokenText
  ) {
    isBuddySpeaking = false;
    stopSpeechMouthCycle();
    buddy3dViewer?.setSpeaking(false);
    setRigEmotion(finishEmotion, finishEmotion.toUpperCase());
    updateVoiceUiState(isLiveVoiceMode ? "listening" : "idle");
    if (isLiveVoiceMode && !busy && !pendingAction) {
      clearLiveRestartTimer();
      liveVoiceRestartTimer = setTimeout(() => {
        if (isLiveVoiceMode && !busy && !isBuddySpeaking && !isRecognizing) {
          startVoiceListening();
        }
      }, 360);
    } else if (autoListenReason && !busy && !pendingAction) {
      setTimeout(() => {
        maybeAutoActivateMic({ reason: autoListenReason, deferUntilSpeechEnd: false });
      }, 120);
    }
    return;
  }

  let settled = false;
  const cleanupSpeech = () => {
    if (settled) return;
    settled = true;
    clearSpeechTimers();
    isBuddySpeaking = false;
    stopSpeechMouthCycle();
    buddy3dViewer?.setSpeaking(false);
    if (currentEmotion !== "privacy") {
      setRigEmotion(finishEmotion, finishEmotion.toUpperCase());
    }
    if (isLiveVoiceMode && !busy && !pendingAction) {
      updateVoiceUiState("listening", "Live conversation: listening…");
      clearLiveRestartTimer();
      liveVoiceRestartTimer = setTimeout(() => {
        if (isLiveVoiceMode && !busy && !isBuddySpeaking && !isRecognizing) {
          startVoiceListening();
        }
      }, 360);
    } else if ((autoListenReason || pendingAutoListenAfterSpeech) && !busy && !pendingAction) {
      const reason = autoListenReason || "missing_value";
      pendingAutoListenAfterSpeech = false;
      updateVoiceUiState("idle");
      setTimeout(() => {
        maybeAutoActivateMic({ reason, deferUntilSpeechEnd: false });
      }, 180);
    } else if (!isRecognizing) {
      updateVoiceUiState("idle");
    }
  };

  if (autoListenReason) {
    pendingAutoListenAfterSpeech = true;
  }

  try {
    window.speechSynthesis.cancel();
    isBuddySpeaking = true;
    updateVoiceUiState("speaking", "Speaking… (tap Interrupt to speak)");
    const utterance = new SpeechSynthesisUtterance(spokenText);
    const lang = detectSpeechLanguageForExtension(spokenText);
    utterance.lang = lang;
    const preferredVoice = pickExtensionVoice(lang);
    if (preferredVoice) utterance.voice = preferredVoice;
    utterance.rate = lang === "hi-IN" ? 0.96 : 1.0;

    const boundaryShapes = ["open_a", "open_o", "open_e", "wide_smile", "open_a", "rest"];
    let boundaryIdx = 0;

    utterance.onstart = () => {
      isBuddySpeaking = true;
      if (currentEmotion !== "privacy") {
        setRigEmotion("talking", "Talking");
        buddy3dViewer?.setSpeaking(true);
      }
      startSpeechMouthCycle();
    };
    utterance.onboundary = () => {
      if (speechMouthInterval) {
        clearInterval(speechMouthInterval);
        speechMouthInterval = null;
      }
      boundaryIdx = (boundaryIdx + 1) % boundaryShapes.length;
      setMouthShape(boundaryShapes[boundaryIdx]);
    };
    utterance.onend = cleanupSpeech;
    utterance.onerror = cleanupSpeech;

    // Chromium SpeechSynthesis can pause/stall silently on long utterances; keep-alive + watchdog prevent Talking freeze
    speechKeepAliveInterval = setInterval(() => {
      try {
        if (window.speechSynthesis?.speaking && !window.speechSynthesis.paused) {
          window.speechSynthesis.pause();
          window.speechSynthesis.resume();
        } else if (!window.speechSynthesis?.speaking) {
          cleanupSpeech();
        }
      } catch {
        cleanupSpeech();
      }
    }, 9000);

    const maxSpeechMs = Math.min(45000, Math.max(9000, spokenText.length * 140));
    speechWatchdogTimer = setTimeout(() => {
      try {
        window.speechSynthesis?.cancel();
      } catch {}
      cleanupSpeech();
    }, maxSpeechMs);

    window.speechSynthesis.speak(utterance);
  } catch {
    cleanupSpeech();
  }
}

let pointTimerId = null;

/**
 * Pointing action:
 * Articulates the connected arm from Buddy's shoulder,
 * and commands the active page to extend the connected arm toward the element.
 */
async function pointArmAtElement(coords = null) {
  const initialCoords =
    coords && typeof coords.targetYRatio === "number" ? coords : lastPointCoords || {};
  setRigEmotion("pointing", "Pointing", initialCoords);
  const active = getActiveBuddy();
  if (pointTimerId) {
    clearTimeout(pointTimerId);
    pointTimerId = null;
  }

  if (lastHighlightSelector && !coords?.skipHighlightRpc) {
    try {
      const res = await sendRuntimeMessage({
        type: "HIGHLIGHT",
        selector: lastHighlightSelector,
        frameId: lastHighlightFrameId || 0,
        title: lastCallout.title,
        description: lastCallout.description,
        buddyVisual: {
          outfit: active.outfit,
          buddyName: active.name,
        },
      });
      if (res && res.ok === false) {
        if ($("statusText")) {
          $("statusText").textContent = res.message || "Could not highlight target on this page.";
        }
        setRigEmotion("idle", "Idle");
        return;
      }
      if (res && typeof res.targetYRatio === "number") {
        lastPointCoords = {
          targetXRatio: res.targetXRatio,
          targetYRatio: res.targetYRatio,
        };
        setRigEmotion("pointing", "Pointing", lastPointCoords);
      }
    } catch {
      if ($("statusText")) {
        $("statusText").textContent = "Could not highlight target on this page.";
      }
      setRigEmotion("idle", "Idle");
      return;
    }
  } else if (coords && typeof coords.targetYRatio === "number") {
    lastPointCoords = {
      targetXRatio: coords.targetXRatio,
      targetYRatio: coords.targetYRatio,
    };
  }

  pointTimerId = setTimeout(() => {
    pointTimerId = null;
    if (currentEmotion === "pointing") setRigEmotion("idle", "Idle");
  }, 4000);
}

let hasBootHydrated = false;

function getActiveScopeKey(session) {
  if (!session || session.isGuest) return "guest";
  const raw = session.userId || session.email;
  if (!raw || String(raw).toLowerCase() === "guest user") return "guest";
  return String(raw)
    .toLowerCase()
    .replace(/[^a-z0-9._@-]/g, "_");
}

async function getScopedProfile(sessionOverride) {
  try {
    const { session, userProfile = {}, scopedUserProfiles = {} } = await chrome.storage.local.get([
      "session",
      "userProfile",
      "scopedUserProfiles",
    ]);
    const scope = getActiveScopeKey(sessionOverride !== undefined ? sessionOverride : session);
    if (scope === "guest") return userProfile || {};
    return scopedUserProfiles?.[scope] || {};
  } catch {
    return {};
  }
}

async function setScopedProfile(nextProfile, sessionOverride) {
  try {
    const { session, scopedUserProfiles = {} } = await chrome.storage.local.get([
      "session",
      "scopedUserProfiles",
    ]);
    const scope = getActiveScopeKey(sessionOverride !== undefined ? sessionOverride : session);
    if (scope === "guest") {
      await chrome.storage.local.set({ userProfile: nextProfile || {} });
    } else {
      await chrome.storage.local.set({
        scopedUserProfiles: {
          ...scopedUserProfiles,
          [scope]: nextProfile || {},
        },
      });
    }
  } catch {}
}

async function getPermissionSettings() {
  try {
    const { permissionLevel, requireConsent } = await chrome.storage.local.get([
      "permissionLevel",
      "requireConsent",
    ]);
    return {
      permissionLevel: permissionLevel || "assist",
      requireConsent: requireConsent !== false,
    };
  } catch {
    return { permissionLevel: "assist", requireConsent: true };
  }
}

function applyStageSize(sizeVal) {
  const stage = $("characterStage");
  if (!stage) return;
  const val = sizeVal || "normal";
  if ($("sizeSelect")) $("sizeSelect").value = val;
  const wrap3d = $("buddy3dCanvasWrap");
  const svg = $("characterSvg");
  const img = $("buddy3dImg");
  if (val === "hidden") {
    stage.style.display = "none";
    buddy3dViewer?.setPaused?.(true);
  } else if (val === "compact") {
    stage.style.display = "flex";
    if (wrap3d) {
      wrap3d.style.width = "102px";
      wrap3d.style.height = "102px";
    }
    if (svg) {
      svg.style.width = "90px";
      svg.style.height = "100px";
    }
    if (img) {
      img.style.width = "90px";
      img.style.height = "90px";
    }
    if (currentRenderMode === "3d") {
      buddy3dViewer?.setPaused?.(false);
      buddy3dViewer?.resize();
    }
  } else {
    stage.style.display = "flex";
    if (wrap3d) {
      wrap3d.style.width = "132px";
      wrap3d.style.height = "132px";
    }
    if (svg) {
      svg.style.width = "120px";
      svg.style.height = "120px";
    }
    if (img) {
      img.style.width = "110px";
      img.style.height = "110px";
    }
    if (currentRenderMode === "3d") {
      buddy3dViewer?.setPaused?.(false);
      buddy3dViewer?.resize();
    }
  }
}

async function persistMutedState(muted) {
  isMuted = Boolean(muted);
  if (isMuted && window.speechSynthesis) window.speechSynthesis.cancel();
  if ($("muteToggle")) $("muteToggle").checked = isMuted;
  if ($("settingsVoiceToggleBtn")) {
    $("settingsVoiceToggleBtn").textContent = isMuted ? "🔇 Muted" : "🔊 Unmuted";
  }
  try {
    await chrome.storage.local.set({ isMuted });
  } catch {}
}

async function render() {
  const {
    session,
    selectedBuddySlug: savedSlug,
    selectedCustomBuddyId: savedCustomId,
    avatarRenderMode: savedMode,
    selectedProvider: savedProvider,
    isMuted: savedMuted,
    stageSize: savedStageSize,
    conversationBuffer: savedBuffer,
    preferredModel,
  } = await chrome.storage.local.get([
    "session",
    "selectedBuddySlug",
    "selectedCustomBuddyId",
    "avatarRenderMode",
    "selectedProvider",
    "isMuted",
    "stageSize",
    "conversationBuffer",
    "preferredModel",
  ]);

  if (savedSlug) selectedBuddySlug = savedSlug;
  if (savedCustomId) selectedCustomBuddyId = savedCustomId;
  if (savedMode) currentRenderMode = savedMode;
  selectedProvider = savedProvider || "auto";
  if (typeof savedMuted === "boolean") {
    isMuted = savedMuted;
    if ($("muteToggle")) $("muteToggle").checked = isMuted;
    if ($("settingsVoiceToggleBtn")) {
      $("settingsVoiceToggleBtn").textContent = isMuted ? "🔇 Muted" : "🔊 Unmuted";
    }
  }
  if ($("providerSelector")) $("providerSelector").value = selectedProvider;
  if ($("modelSelector")) $("modelSelector").value = preferredModel || "auto";
  updateProviderNoticeUI(selectedProvider);

  if (!hasBootHydrated) {
    hasBootHydrated = true;
    if (Array.isArray(savedBuffer) && savedBuffer.length > 0 && conversationBuffer.length === 0) {
      for (const turn of savedBuffer.slice(-MAX_CONVERSATION_TURNS)) {
        if (turn?.user && turn?.assistant) {
          conversationBuffer.push({ user: turn.user, assistant: turn.assistant });
          appendHistory("user", turn.user);
          appendHistory("buddy", turn.assistant);
        }
      }
    }
  }

  const isAuth = Boolean(session && !session.isGuest);
  if ($("signoutBtn")) $("signoutBtn").hidden = !session;
  if ($("connectBtn")) $("connectBtn").hidden = isAuth;

  if ($("userAccount")) {
    $("userAccount").textContent = isAuth
      ? `Connected: ${session.email || "User"}`
      : "Guest Mode (All 16 Buddies active)";
  }
  if (session?.apiBase) {
    chrome.storage.local.set({ lastBase: session.apiBase }).catch(() => {});
  }

  // Hydrate locally cached custom buddies first so Custom Buddy persists offline
  try {
    const { localCustomBuddies = [] } = await chrome.storage.local.get("localCustomBuddies");
    if (Array.isArray(localCustomBuddies) && localCustomBuddies.length > 0) {
      allBuddies = [
        ...BUDDIES_REGISTRY.filter((b) => !b.isCustom),
        ...localCustomBuddies.map((c) => ({
          ...c,
          image: normalizeExtensionAssetUrl(c.image || "./assets/buddy-ecommerce-3d.webp"),
          outfitColors: c.outfitColors || ["#0d9488", "#0f766e"],
          isCustom: true,
        })),
      ];
    }
  } catch {}

  // Sync latest custom buddies from backend if available
  const apiBase = await getResolvedBackendBase();
  fetchWithTimeout(`${apiBase}/api/public/extension/buddies`, {
    headers: session?.accessToken ? { authorization: `Bearer ${session.accessToken}` } : {},
  }, 6000)
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      if (data?.ok && Array.isArray(data.buddies) && data.buddies.length > 0) {
        const customItems = data.buddies.filter((b) => b.isCustom);
        if (customItems.length > 0) {
          chrome.storage.local.set({ localCustomBuddies: customItems }).catch(() => {});
          allBuddies = [
            ...BUDDIES_REGISTRY.filter((b) => !b.isCustom),
            ...customItems.map((c) => ({
              ...c,
              image: normalizeExtensionAssetUrl(c.image || "./assets/buddy-ecommerce-3d.webp"),
              outfitColors: ["#0d9488", "#0f766e"],
            })),
          ];
          renderBuddyCarousel();
        }
      }
    })
    .catch(() => {});

  if (currentRenderMode === "3d") {
    initBuddy3DStage();
  }
  renderBuddyCarousel();
  switchBuddy(selectedBuddySlug, { persist: false, silent: true });
  applyRenderMode(currentRenderMode);
  if ($("avatarRenderMode")) $("avatarRenderMode").value = currentRenderMode;
  if (savedStageSize) applyStageSize(savedStageSize);
  checkPageForErrors();
  checkSavedCheckpoint();
  updateGreetingContext();
  startRotatingPlaceholders();
  loadModelHubStatus();
  if ($("headerModelLabel")) {
    if (preferredModel && preferredModel !== "auto") {
      const matchedOpt = Array.from($("modelSelector")?.options || []).find(
        (o) => o.value === preferredModel,
      );
      $("headerModelLabel").textContent = matchedOpt
        ? matchedOpt.text.split(" (")[0]
        : preferredModel;
    } else {
      $("headerModelLabel").textContent = "Auto Model";
    }
  }
}

function applyRenderMode(mode) {
  currentRenderMode = mode || "3d";
  if (currentRenderMode === "3d" && !buddy3dViewer && !webglFallbackActive) {
    initBuddy3DStage();
  }
  const wrap3d = $("buddy3dCanvasWrap");
  const svg = $("characterSvg");
  const img = $("buddy3dImg");
  if (!svg || !img) return;

  const stageHidden = $("sizeSelect")?.value === "hidden";

  if (currentRenderMode === "3d" && !webglFallbackActive && buddy3dViewer) {
    if (wrap3d) wrap3d.hidden = false;
    svg.style.display = "none";
    img.hidden = true;
    buddy3dViewer.setPaused?.(stageHidden);
    if (!stageHidden) buddy3dViewer.resize();
  } else if (currentRenderMode === "artwork") {
    buddy3dViewer?.setPaused?.(true);
    if (wrap3d) wrap3d.hidden = true;
    svg.style.display = "none";
    img.hidden = false;
  } else {
    buddy3dViewer?.setPaused?.(true);
    if (wrap3d) wrap3d.hidden = true;
    svg.style.display = "block";
    img.hidden = true;
  }
}

async function checkPageForErrors() {
  try {
    const res = await sendRuntimeMessage({ type: "GET_PAGE_SNAPSHOT" }, { silent: true });
    const snapshot = res?.snapshot;
    if (!snapshot) return;

    const rt = window.Buddy3DRuntime;
    const focusedPassword = (snapshot.forms || []).some(
      (f) => f.focused && (f.type === "password" || rt?.detectPrivacyTrigger?.({ activeFieldLabel: f.label || f.name, activeFieldType: f.type })?.isPrivacy),
    );
    if (focusedPassword || snapshot.hasFocusedPassword) {
      setRigEmotion("privacy", "Privacy");
      return;
    }

    const rawAlerts = snapshot.alerts || [];
    const alerts = rawAlerts.filter((a) => String(a?.errorMessage || a?.name || "").trim().length > 0);
    const invalidForms = (snapshot.forms || []).filter((f) => f.invalid);

    const banner = $("pageErrorBanner");
    const text = $("pageErrorText");
    if (!banner || !text) return;

    if (alerts.length > 0 || invalidForms.length > 0) {
      const parts = [];
      if (alerts.length > 0) {
        const firstAlertText = String(alerts[0].errorMessage || alerts[0].name || "").trim();
        parts.push(`${alerts.length} alert(s): "${firstAlertText.slice(0, 80)}"`);
      }
      if (invalidForms.length > 0) {
        parts.push(`${invalidForms.length} invalid form field(s) require attention.`);
      }
      text.textContent = parts.join(" — ");
      banner.hidden = false;
      setRigEmotion("concerned", "Issues Found");
    } else {
      banner.hidden = true;
    }
  } catch {
    // Non-fatal
  }
}

async function executeScroll(
  direction = "down",
  amount = 450,
  targetText = null,
  announceInChat = false,
  targetContainerText = null,
) {
  const active = getActiveBuddy();
  const isHindi = active.defaultLanguage !== "english";
  setRigEmotion("working", "Scrolling");
  $("statusText").textContent = targetContainerText
    ? `Scrolling "${targetContainerText}" ${direction}…`
    : targetText
      ? `Scrolling to "${targetText}"…`
      : `Scrolling page ${direction}…`;

  const res = await sendRuntimeMessage({
    type: "EXECUTE_ACTION",
    action: "scroll",
    value: direction,
    options: {
      direction,
      amount,
      targetText,
      containerText: targetContainerText || undefined,
    },
  });

  if (res?.ok) {
    recordSessionAction(
      res.message ||
        (targetContainerText
          ? `Scrolled "${targetContainerText}" ${direction}`
          : targetText
            ? `Scrolled to "${targetText}"`
            : `Scrolled page ${direction}`),
      "confirmed",
    );
    $("statusText").textContent = res.message || `Scrolled ${direction}.`;
    if (res.hasMoreBelow !== undefined && $("pageCompletenessBanner")) {
      $("pageCompletenessBanner").hidden = !res.hasMoreBelow;
    }
    if (announceInChat) {
      const msg = isHindi
        ? targetContainerText
          ? `📜 "${targetContainerText}" area ko ${direction} scroll kar diya hai.${res.movedPx ? ` (${res.movedPx}px)` : ""}`
          : targetText
            ? `📜 "${targetText}" tak scroll kar diya hai.`
            : `📜 Page ${direction} scroll kar diya hai.${res.movedPx ? ` (${res.movedPx}px)` : ""}`
        : res.message || `Scrolled ${direction}.`;
      appendHistory("buddy", msg);
      speakResponse(msg, "happy");
    }
  } else {
    recordSessionAction(res?.message || `Scroll ${targetContainerText || targetText || direction} failed`, "failed");
    if (announceInChat) {
      const failMsg =
        res?.message ||
        (isHindi
          ? `Page ko "${targetContainerText || targetText || direction}" scroll nahi kiya ja saka.`
          : `Could not scroll ${direction}.`);
      $("statusText").textContent = failMsg;
      appendHistory("buddy", `⚠️ ${failMsg}`);
    }
  }
  setTimeout(() => setRigEmotion("idle", "Idle"), 1000);
}

async function executeFind(query, mode = "find", extraOpts = {}) {
  setRigEmotion("thinking", mode === "point" ? "Pointing" : "Finding");
  $("statusText").textContent =
    mode === "point" ? `Pointing to "${query}"…` : `Searching page for "${query}"…`;
  const active = getActiveBuddy();
  const isHindi = active.defaultLanguage !== "english";
  const res = await sendRuntimeMessage({
    type: "FIND_CONTENT",
    query,
    options: {
      scroll: true,
      highlight: true,
      targetIndex: typeof extraOpts.targetIndex === "number" ? extraOpts.targetIndex : undefined,
      title: mode === "point" ? `Pointing: ${query}` : `Match: ${query}`,
      buddyVisual: {
        outfit: active.outfit,
        outfitColor: active.outfitColors?.[0] || "#0d9488",
        buddyName: active.name,
      },
    },
  });
  if (res?.ok && res.ambiguous && Array.isArray(res.ambiguousCandidates) && res.ambiguousCandidates.length > 1) {
    pendingDisambiguation = {
      action: mode === "point" ? "point" : "find",
      target: query,
      candidates: res.ambiguousCandidates.map((c, idx) => ({
        index: idx + 1,
        text: c.textSnippet || c.fullText || query,
        context: c.context || "",
        selector: c.selector,
        tag: c.tag,
      })),
    };
    recordTaskContext({
      actionType: mode === "point" ? "point" : "find",
      items: res.matches || res.ambiguousCandidates,
    });
    const listText = pendingDisambiguation.candidates
      .map((c) => `${c.index}. "${c.text}"${c.context ? ` — [${c.context}]` : ` (${c.tag})`}`)
      .join("\n");
    const askWhichMsg = isHindi
      ? `🤔 Is page par "${query}" se match karne wale ${pendingDisambiguation.candidates.length} barabar options mile:\n${listText}\nKripya batayein kaunsa chahiye ("pehla", "doosra", ya number 1-${pendingDisambiguation.candidates.length})?`
      : `🤔 Found ${pendingDisambiguation.candidates.length} matching elements for "${query}":\n${listText}\nWhich one do you mean? Reply with 1-${pendingDisambiguation.candidates.length} (e.g. "first", "second").`;
    setRigEmotion("confused", "Which one?");
    $("statusText").textContent = `Clarification needed for "${query}"`;
    appendHistory("buddy", askWhichMsg);
    recordSessionAction(`Asked clarification among ${pendingDisambiguation.candidates.length} "${query}" matches`, "unconfirmed");
    speakResponse(askWhichMsg, "confused");
    return;
  }
  if (res?.ok && res.totalMatches > 0) {
    const pointCoords =
      typeof res.targetYRatio === "number"
        ? {
            skipHighlightRpc: true,
            targetXRatio: res.targetXRatio,
            targetYRatio: res.targetYRatio,
          }
        : null;
    setRigEmotion("pointing", mode === "point" ? "Pointing!" : "Found!", pointCoords || {});
    lastHighlightSelector = res.firstSelector;
    lastHighlightFrameId = typeof res.frameId === "number" ? res.frameId : 0;
    recordTaskContext({
      actionType: mode === "point" ? "point" : "find",
      targetSelector: res.firstSelector,
      items: res.matches || [],
    });
    lastCallout = {
      title: mode === "point" ? `Pointing: ${query}` : `Match: ${query}`,
      description: res.targetMatch?.textSnippet || `Located "${query}" (no click performed).`,
    };
    if ($("highlightBtn")) $("highlightBtn").hidden = false;
    pointArmAtElement(pointCoords);
    recordSessionAction(`Found "${query}" (${res.totalMatches} match)`, "confirmed");
    const msg =
      mode === "point"
        ? isHindi
          ? `Maine page par "${query}" par point aur highlight kar diya hai (click nahi kiya hai).`
          : `Pointing to "${query}" on this page (visual highlight only, not clicked).`
        : isHindi
          ? `Maine page par "${query}" (${res.totalMatches} match) dhoondh liya hai! Lamba Haath se point kar raha hoon.`
          : `Found ${res.totalMatches} match${res.totalMatches > 1 ? "es" : ""} for "${query}". Pointing with Lamba Haath!`;
    $("statusText").textContent = msg;
    appendHistory(
      "buddy",
      `🎯 ${msg}${res.targetMatch?.textSnippet ? `\nElement: "${res.targetMatch.textSnippet}"` : ""}`,
    );
    speakResponse(
      isHindi ? `Maine ${query} par point kar diya hai.` : `I am pointing to ${query} on this page.`,
      "pointing",
    );
  } else {
    setRigEmotion("idle", "Not found");
    recordSessionAction(`Could not find "${query}" on page`, "failed");
    const msg =
      res && res.ok === false && res.message
        ? res.message
        : isHindi
          ? `Visible page par "${query}" nahi mila. Kripya neeche scroll karein ya sahi naam batayein.`
          : `Could not find "${query}" in visible page content.`;
    $("statusText").textContent = msg;
    appendHistory("buddy", `⚠️ ${msg}`);
  }
}

// --- ACTIVE UPLOADED DOCUMENT STATE (Aadhaar, PAN, Invoice, Shipping Label, PDF/Image) ---
let activeUploadedDocument = null;

function maskSensitiveDocValue(key, val) {
  const s = String(val || "").trim();
  if (!s) return "";
  const nk = String(key || "").replace(/[^a-z]/gi, "").toLowerCase();
  if (nk.includes("aadhaar") || nk.includes("aadhar")) {
    const digits = s.replace(/\D/g, "");
    return digits.length >= 4 ? `XXXX-XXXX-${digits.slice(-4)}` : "XXXX-XXXX";
  }
  if (nk === "pan" || nk === "pannumber") {
    return s.length >= 4 ? `${"X".repeat(Math.max(0, s.length - 4))}${s.slice(-4)}` : "XXXXXXXXXX";
  }
  return s;
}

function renderUploadedDocBar() {
  const bar = $("uploadedDocBar");
  const lbl = $("uploadedDocLabel");
  if (!bar || !lbl) return;
  if (!activeUploadedDocument) {
    bar.hidden = true;
    return;
  }
  const fieldsCount = Object.keys(activeUploadedDocument.fields || {}).length;
  const tableRowsCount = activeUploadedDocument.table?.rowCount || 0;
  const typeLabel =
    activeUploadedDocument.documentType === "aadhaar"
      ? "Aadhaar Card"
      : activeUploadedDocument.documentType === "pan"
        ? "PAN Card"
        : activeUploadedDocument.documentType === "invoice"
          ? "Invoice"
          : activeUploadedDocument.documentType === "shipping_label"
            ? "Shipping Label"
            : tableRowsCount > 0
              ? "Spreadsheet"
              : "Document";
  const countLabel =
    tableRowsCount > 0 && fieldsCount === 0
      ? `${tableRowsCount} row${tableRowsCount === 1 ? "" : "s"}`
      : `${fieldsCount} field${fieldsCount === 1 ? "" : "s"} ready`;
  lbl.textContent = `📄 ${typeLabel} (${activeUploadedDocument.fileName}) · ${countLabel}`;
  bar.hidden = false;
}

function setActiveUploadedDocument(docResult) {
  if (!docResult) {
    activeUploadedDocument = null;
    renderUploadedDocBar();
    try {
      chrome.storage?.session?.remove?.("ai_buddy_uploaded_doc");
    } catch {}
    return;
  }

  // Detect conflicts if a previous uploaded document had different values for key identity fields
  const conflicts = [...(docResult.conflicts || [])];
  if (activeUploadedDocument?.fields && docResult.fields) {
    for (const k of ["name", "dob", "aadhaarNumber", "panNumber", "address", "phone"]) {
      const prevV = activeUploadedDocument.fields[k];
      const nextV = docResult.fields[k];
      if (prevV && nextV && prevV.toLowerCase() !== nextV.toLowerCase()) {
        conflicts.push({
          field: k,
          prev: maskSensitiveDocValue(k, prevV),
          next: maskSensitiveDocValue(k, nextV),
        });
      }
    }
  }

  activeUploadedDocument = {
    ...docResult,
    fields: docResult.fields || {},
    ambiguousFields: docResult.ambiguousFields || [],
    conflicts,
  };
  renderUploadedDocBar();
  try {
    chrome.storage?.session?.set?.({ ai_buddy_uploaded_doc: activeUploadedDocument });
  } catch {}
}

function clearActiveUploadedDocument() {
  setActiveUploadedDocument(null);
}

try {
  chrome.storage?.session?.get?.("ai_buddy_uploaded_doc", (data) => {
    if (data?.ai_buddy_uploaded_doc) {
      activeUploadedDocument = data.ai_buddy_uploaded_doc;
      renderUploadedDocBar();
    }
  });
} catch {}

function extractRequestedDocFieldKeys(text) {
  const lower = String(text || "").toLowerCase();
  const keys = [];
  if (/\b(?:name|naam|full\s*name)\b/i.test(lower)) keys.push("name");
  if (/\b(?:father|father'?s\s*name|s\/o)\b/i.test(lower)) keys.push("fatherName");
  if (/\b(?:dob|date\s+of\s+birth|birth\s*date|janam)\b/i.test(lower)) keys.push("dob");
  if (/\b(?:gender|sex)\b/i.test(lower)) keys.push("gender");
  if (/\b(?:phone|mobile|contact\s*number)\b/i.test(lower)) keys.push("phone");
  if (/\b(?:email|mail)\b/i.test(lower)) keys.push("email");
  if (/\b(?:address|pata)\b/i.test(lower)) keys.push("address");
  if (/\bcity\b/i.test(lower)) keys.push("city");
  if (/\bstate\b/i.test(lower)) keys.push("state");
  if (/\b(?:pincode|pin\s*code|zip)\b/i.test(lower)) keys.push("pincode");
  if (/\b(?:aadhaar|aadhar)\s*(?:number|no|num|digit|id)\b/i.test(lower)) keys.push("aadhaarNumber");
  if (/\bpan\s*(?:number|no|num|id)\b/i.test(lower)) keys.push("panNumber");
  if (/\b(?:gstin|gst)\b/i.test(lower)) keys.push("gstin");
  if (/\b(?:invoice)(?:\s*number|\s*no)?\b/i.test(lower)) keys.push("invoiceNumber");
  if (/\b(?:order\s*id|order\s*number)\b/i.test(lower)) keys.push("orderId");
  if (/\b(?:tracking|awb)\b/i.test(lower)) keys.push("trackingNumber");
  return [...new Set(keys)];
}

function stripBuddyPrefix(text) {
  return String(text || "")
    .trim()
    .replace(/^(?:(?:hey|hi|hello|ok|okay|dear|please|kripya|bhai|yaar|dost|sun|suno)\s+)?(?:ai\s+)?buddy\b[,:\s-]*/i, "")
    .replace(/^(?:bhai|yaar|dost|sun|suno|please|kripya|plz|pls)\b[,\s:-]+(?=\S)/i, "")
    .replace(/^(?:please|kripya|plz|pls)\s+/i, "")
    .replace(/\s+(?:please|kripya|plz|pls)[.!?\s]*$/i, "")
    .trim();
}

function normalizeHinglishCommand(rawText) {
  const quotes = [];
  const masked = String(rawText || "").replace(/(["'])([^"']+)\1/g, (m) => {
    quotes.push(m);
    return `__Q${quotes.length - 1}__`;
  });

  let out = masked
    .replace(/\bhnn+\b|\bhn+\b|\bhaa+n\b/gi, "haan")
    .replace(/\bkrdo\b|\bkr\s+do\b/gi, "kar do")
    .replace(/\bkro\b|\bkrr+o\b/gi, "karo")
    .replace(/\bkr\b(?=\s+(?:do|de|dein|ke|na|rha|raha|rahi|lo)|[.!?\s]*$)/gi, "kar")
    .replace(/\bkyuu+n?\b|\bkyu+\b|\bq\b(?=\s+(?:kar|karo|ho|h|hai|nahi|nhi|likh|fill|bhai|buddy)?\s*[?!.]*$)/gi, "kyun")
    .replace(/\bsb+\b/gi, "sab")
    .replace(/\bkch+\b/gi, "kuch")
    .replace(/\bbtaa*o\b/gi, "batao")
    .replace(/\bbta+\b/gi, "bata")
    .replace(/\bbss+\b/gi, "bas")
    .replace(/\blgta\b/gi, "lagta")
    .replace(/\blgbhg\b/gi, "lagbhag")
    .replace(/\bdall*o\b|\bdalo\b/gi, "daalo")
    .replace(/\blkho\b|\blikhh+o\b/gi, "likho")
    .replace(/\blkh\b/gi, "likh")
    .replace(/\bkholl+o\b/gi, "kholo")
    .replace(/\bdikk*hao\b/gi, "dikhao")
    .replace(/\bbnao\b/gi, "banao")
    .replace(/\byhi\b/gi, "yahi")
    .replace(/\bwhi\b/gi, "wahi")
    .replace(/\btk\b(?=\s+kya)/gi, "tak")
    .replace(/\bh\b(?=\s*(?:kya|na|to|bhai|buddy)?[.!?\s]*$)/gi, "hai")
    .replace(/\bhu\b(?=\s*(?:main|bhai)?[.!?\s]*$)/gi, "hoon")
    .replace(/\bsmjhao\b/gi, "samjhao");

  return out.replace(/__Q(\d+)__/g, (_m, idx) => quotes[Number(idx)] || "");
}

function resolvePositionalFieldTarget(raw) {
  const s = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/\b(?:field|input|box|textbox|textarea|area|dropdown|select|jagah|wal[aei]|wle|number|no\.?)\b/gi, " ")
    .replace(/\b(?:mein|me|main|par|pe|pr|ko|ka|ki|ke|the|is|this)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return null;
  if (/^(?:1|1st|first|pehl[aei]|pahl[aei])$/.test(s)) return "__INDEX_0__";
  if (/^(?:2|2nd|second|doosr[aei]|dusr[aei])$/.test(s)) return "__INDEX_1__";
  if (/^(?:3|3rd|third|teesr[aei]|tisr[aei])$/.test(s)) return "__INDEX_2__";
  if (/^(?:4|4th|fourth|chauth[aei])$/.test(s)) return "__INDEX_3__";
  if (/^(?:5|5th|fifth|paanchv[aei]|panchv[aei])$/.test(s)) return "__INDEX_4__";
  if (/^(?:last|final|aakhri|akhri|aakhiri)$/.test(s)) return "__INDEX_LAST__";
  return null;
}

function normalizeFillTarget(raw) {
  const cleaned = String(raw || "")
    .trim()
    .replace(
      /^(?:is\s+page\s+(?:par|pe|pr|mein|me|main)|page\s+(?:par|pe|pr|mein|me|main)|is\s+form\s+(?:mein|me|main)|form\s+(?:mein|me|main)|ye|yeh|is|the|a|an|my|apna|mera|yha|yaha|yahan)\s+/i,
      "",
    )
    .replace(
      /\s+(?:waa?l[aei]|wle)\s*(?:field|input|box|textbox|textarea|area|dropdown|select|jagah)?(?:\s+(?:ki|ka|ke|par|pe|pr|ko))?$/i,
      "",
    )
    .replace(
      /\s+(?:field|input|box|textbox|textarea|area|dropdown|select|jagah|waa?l[aei]|ki|ka|ke|par|pe|pr|ko)$/i,
      "",
    )
    .replace(/\s+(?:waa?l[aei]|wle)$/i, "")
    .trim()
    .toLowerCase();
  const positional = resolvePositionalFieldTarget(raw);
  if (positional) return positional;
  if (cleaned === "surname" || cleaned === "family name") return "lastname";
  return cleaned;
}

function resolveOrdinalChoiceIndex(text) {
  const clean = String(text || "")
    .trim()
    .toLowerCase()
    .replace(
      /\b(?:ab|now|phir|fir|then|option|number|no\.?|waa?l[aei]|wle|select|click|open|kholo|pick|choose|karo|kro|(?:kar|kr)\s*do|par|pe|pr|ko|ki|ke|mein|me|main)\b/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return null;
  if (/^(?:1|1st|first|one|ek|pehl[aei]|pahl[aei])$/.test(clean)) return 1;
  if (/^(?:2|2nd|second|two|do|doosr[aei]|dusr[aei])$/.test(clean)) return 2;
  if (/^(?:3|3rd|third|three|teen|teesr[aei]|tisr[aei])$/.test(clean)) return 3;
  if (/^(?:4|4th|fourth|four|chaar|chauth[aei])$/.test(clean)) return 4;
  if (/^(?:5|5th|fifth|five|paanch|panchv[aei]|paanchv[aei])$/.test(clean)) return 5;
  if (/^(?:6|6th|sixth|six|chhath[aei])$/.test(clean)) return 6;
  if (/^(?:7|7th|seventh|seven|saatv[aei])$/.test(clean)) return 7;
  if (/^(?:8|8th|eighth|eight|aathv[aei])$/.test(clean)) return 8;
  return null;
}

function isNonValuePlaceholder(rawVal) {
  const normVal = normalizeHinglishCommand(String(rawVal || "").trim().toLowerCase());
  return /^(?:kuch|kch|kuch\s+bhi|something|anything|text|value|data|details|info|information|ye|yeh|ye\s*wal[aei]|yeh\s*wal[aei]|is\s*wal[aei]|isko|isme|is\s*(?:box|field|input)|this|this\s*(?:box|field|input)|the\s*(?:box|field|input)|it|yahan|yaha|yha|karo|kro|kar\s*do|kr\s*do|krdo|kar\s*de|fill|bharo|bhar\s*do|daalo|daal\s*do|likho|likh\s*do|type|form|all\s+fields|fields|inputs|page|errors?|issues?)$/i.test(
    normVal,
  );
}

function extractFillDetails(text) {
  const rawCleaned = stripBuddyPrefix(text)
    .replace(
      /^(?:is\s+form\s+(?:mein|me|main)|form\s+(?:mein|me|main)|is\s+page\s+(?:mein|me|main|par|pe|pr))\s+/i,
      "",
    )
    .trim();
  const cleanedNoSubmit = rawCleaned
    .replace(
      /(?:,\s*|\s+)(?:but\s+)?(?:don'?t|do\s+not)\s+(?:search|submit|send|press\s+enter)(?:\s+yet)?[.!?\s]*$/i,
      "",
    )
    .replace(
      /(?:,\s*|\s+)(?:without\s+(?:searching|submitting|sending)|bina\s+(?:search|submit)\s+(?:kiye|kare)|abhi\s+(?:search|submit)\s+mat\s+(?:karna|karo))[.!?\s]*$/i,
      "",
    )
    .trim();
  const hasExplicitNoSubmit =
    cleanedNoSubmit.length < rawCleaned.length ||
    /\b(?:don'?t\s+(?:search|submit)|do\s+not\s+(?:search|submit)|mat\s+(?:search|submit)|without\s+(?:searching|submitting)|bina\s+(?:search|submit))\b/i.test(
      rawCleaned,
    );
  const cleaned = cleanedNoSubmit || rawCleaned;
  const overwrite = /\b(?:change|update|replace|overwrite|badal|badlo|modify)\b/i.test(cleaned);
  const fields = {};
  const explicitPairs = [];
  let hasPositionalOrKnownAssign = false;

  if (
    /\b(?:analyze|analyse|explain|why\s+(?:they|it|this)|occurred|step-by-step|instructions\s+to\s+fix|samjhao|kyun\s+(?:hua|aaya|aa\s+rha|aa\s+raha))\b/i.test(
      cleaned,
    )
  ) {
    return {
      fields: null,
      explicitPairs: null,
      overwrite,
      explicitUserProvided: false,
      hasExplicitNoSubmit,
    };
  }

  const hasFillVerbOrAssign =
    /\b(?:fill|type|likh|likho|lkh|lkho|daal|daalo|dalo|bhar|bharo|enter|set|populate|change|update|replace)\b|[:=]/i.test(
      cleaned,
    );
  if (
    !hasFillVerbOrAssign &&
    (/\b(?:select|choose|chuno|point|highlight|click|press|tap|dabao|scroll|find|locate|dhoondho|dhundo|kaha|kahan|kidhar|where)\b/i.test(
      cleaned,
    ) ||
      /\bsearch\s*(?:karo|kro|(?:kar|kr)\s*do|krdo|karein|for)\b/i.test(cleaned))
  ) {
    return {
      fields: null,
      explicitPairs: null,
      overwrite,
      explicitUserProvided: false,
      hasExplicitNoSubmit,
    };
  }

  const trailingVerbSuffix =
    "(?:fill\\s+(?:(?:kar|kr)\\s*do|krdo|(?:kar|kr)o|karein)|fill|type\\s+(?:(?:kar|kr)\\s*do|krdo|(?:kar|kr)o)|type|likh\\s*(?:do|de|kar|kr)?|likho|lkho|daal\\s*(?:do|de)?|daalo|dalo|bhar\\s*(?:do|de)?|bharo|enter\\s*(?:(?:kar|kr)\\s*do|krdo|(?:kar|kr)o)?|set\\s*(?:(?:kar|kr)\\s*do|krdo|(?:kar|kr)o)|(?:kar|kr)\\s*do|krdo|(?:kar|kr)o)";

  // 1. Explicit key: value or key = value (supports comma, semicolon, newline, AND aur/and/phir/then separators)
  const keyValPreSplit = cleaned.replace(
    /\s+(?:and|aur|phir|fir|then)\s+(?=(?:first[\s_]*name|last[\s_]*name|full[\s_]*name|father[\s_]*name|legal_name|trade_name|name|naam|fullname|email|phone|mobile(?:\s*(?:number|no))?|mobilenumber|city|state|country|pincode|pin(?:\s*code)?|zip(?:\s*code)?|gstin|pan(?:\s*number)?|aadhaar(?:\s*number)?|aadhar(?:\s*number)?|dob|gender|father_name|category|bio|notes?|address|pata|search|describe|description|prompt|message|msg|comment|company|subject|title|username|password)\s*[:=])/gi,
    ", ",
  );
  const keyValRegex =
    /\b(first[\s_]*name|last[\s_]*name|full[\s_]*name|father[\s_]*name|legal_name|trade_name|name|naam|fullname|surname|email|phone|mobile[\s_]*(?:number|no)|mobile|mobilenumber|city|state|country|pincode|pin[\s_]*code|pin|zip[\s_]*code|zip|gstin|pan[\s_]*number|pan|aadhaar[\s_]*number|aadhaar|aadhar[\s_]*number|aadhar|dob|gender|father_name|category|bio|notes?|address|pata|search|describe|description|prompt|message|msg|comment|company|subject|title|username|password)\s*[:=]\s*([^,;\n]+)/gi;
  const kvNormMap = {
    naam: "name",
    fullname: "name",
    full_name: "name",
    "full name": "name",
    first_name: "first name",
    last_name: "lastname",
    "last name": "lastname",
    surname: "lastname",
    father_name: "fathername",
    "father name": "fathername",
    mobilenumber: "phone",
    "mobile number": "phone",
    "mobile no": "phone",
    mobile: "phone",
    pata: "address",
    pin: "pincode",
    "pin code": "pincode",
    pin_code: "pincode",
    zip: "pincode",
    "zip code": "pincode",
    zip_code: "pincode",
    aadhaar: "aadhaarnumber",
    aadhar: "aadhaarnumber",
    "aadhaar number": "aadhaarnumber",
    "aadhar number": "aadhaarnumber",
    "pan number": "pannumber",
    pan: "pannumber",
  };
  let m;
  while ((m = keyValRegex.exec(keyValPreSplit)) !== null) {
    const rawKey = m[1].toLowerCase().replace(/\s+/g, " ").trim();
    const key = kvNormMap[rawKey] || rawKey;
    const val = m[2]
      .replace(new RegExp(`\\s+${trailingVerbSuffix}.*$`, "i"), "")
      .replace(/^["']|["']$/g, "")
      .trim();
    if (val && !isNonValuePlaceholder(val)) {
      fields[key] = val;
      explicitPairs.push({ target: key, value: val, overwrite });
    }
  }
  if (explicitPairs.length > 0) {
    return {
      fields,
      explicitPairs,
      overwrite,
      explicitUserProvided: true,
      hasExplicitNoSubmit,
    };
  }

  // Split multi-field instructions cleanly (without mutating values inside clauses)
  const clauses = cleaned
    .split(
      /\s*(?:,|;|\bphir\b|\bfir\b|\bthen\b|\band then\b|\buske baad\b|\b(?:and|aur)\b(?=\s+(?:fill|type|enter|write|set|likh|likho|daal|daalo|dalo|bhar|bharo|naam|name|full\s*name|first\s*name|last\s*name|surname|family\s*name|(?:1st|2nd|3rd|4th|first|second|third|fourth|last|final|next|pehl[aei]|pahl[aei]|doosr[aei]|dusr[aei]|teesr[aei]|tisr[aei]|aakhri|akhri|agla)\s*(?:field|box|input|textbox|wal[aei])|email|phone|mobile|address|pata|city|state|country|pincode|pin|zip|gstin|gst|pan|aadhaar|aadhar|dob|date\s*of\s*birth|father\s*name|gender|company|category|bio|message|msg|comment|subject|title|username)\b))\s*/i,
    )
    .map((c) =>
      c
        .replace(
          /^(?:pehle\s+(?!field\b|box\b|input\b|textbox\b|dropdown\b|wal[aei]\b)|first\s+(?!field\b|box\b|input\b|textbox\b|dropdown\b|wal[aei]\b|name\b)|(?:aur|and|also|next)\s+)/i,
          "",
        )
        .trim(),
    )
    .filter(Boolean);

  const KNOWN_FIELD_ALIASES =
    "(?:full\\s*name|legal\\s*name|trade\\s*name|first\\s*name|last\\s*name|surname|family\\s*name|father\\s*name|user\\s*name|date\\s*of\\s*birth|dob|gender|category|bio|mobile\\s*(?:number|no)?|phone\\s*(?:number|no)?|pin\\s*code|zip\\s*code|email\\s*(?:id|address)?|aadhaar\\s*(?:number|no)?|aadhar\\s*(?:number|no)?|naam|name|mail|email|phone|mobile|address|pata|city|state|country|pincode|pin|zip|gstin|gst|pan|search|describe|description|prompt|message|msg|chat|comment|comments|note|notes|company|subject|title|username|password)";

  const patternARegex = new RegExp(
    `^(.+?)\\s+(?:mein|me|main|per|par|pe|pr|in|into)\\s+["']?(.+?)["']?\\s*(?:${trailingVerbSuffix})?[.!?\\s]*$`,
    "i",
  );
  const patternBRegex =
    /^(?:fill|type|enter|write|put|set|likho|lkho|likh\s+do|daalo|dalo|daal\s+do|bharo)\s+["']?(.+?)["']?\s+(?:in|into|inside|mein|me|main|par|pe|pr)\s+(?:the\s+)?(.+?)[.!?\s]*$/i;
  const patternBKoRegex = new RegExp(
    `^["']?(.+?)["']?\\s+ko\\s+(?:the\\s+)?(.+?)\\s+(?:mein|me|main|par|pe|pr|in|into)\\s+${trailingVerbSuffix}[.!?\\s]*$`,
    "i",
  );
  const patternCRegex1 =
    /^(?:fill|type|populate)\s+(?:this(?:\s+box|\s+field)?|it)\s+(?:with|as)\s+["']?(.+?)["']?[.!?\s]*$/i;
  const patternCRegex2 =
    /^(?:isko|is\s+box\s+ko|is\s+field\s+ko|yha|yaha|yahan)\s+["']?(.+?)["']?\s+(?:se\s+)?(?:fill|bhar|type|likh|daal)\s*(?:(?:kar|kr)\s*do|krdo|(?:kar|kr)o|do)?[.!?\s]*$/i;
  const knownFieldValRe = new RegExp(
    `\\b(${KNOWN_FIELD_ALIASES})\\s+(?:change\\s+karke\\s+|update\\s+karke\\s+|as\\s+|is\\s+|to\\s+|ko\\s+|ka\\s+|:)?["']?(.+?)["']?(?:\\s+${trailingVerbSuffix})?[.!?\\s]*$`,
    "i",
  );

  const knownFieldExactRe = new RegExp(`^(?:${KNOWN_FIELD_ALIASES})$`, "i");
  const cleanEdgeQuotes = (s) => String(s || "").trim().replace(/^["']|["']$/g, "").trim();

  for (const clause of clauses) {
    // Pattern B-ko: "<value> ko <field> mein daal do"
    let match = clause.match(patternBKoRegex);
    if (match) {
      const rawVal = cleanEdgeQuotes(match[1]);
      const rawTarget = match[2].trim();
      const normT = normalizeFillTarget(rawTarget);
      if (rawVal && !isNonValuePlaceholder(rawVal)) {
        if (/^(?:is|ye|yeh|isko|isme|is\s*box|this|this\s*box|this\s*field|yahan|yaha|yha)$/i.test(rawTarget)) {
          explicitPairs.push({ target: "__CURRENT__", value: rawVal, overwrite });
          continue;
        }
        if (normT) {
          fields[normT] = rawVal;
          explicitPairs.push({ target: normT, value: rawVal, overwrite });
          continue;
        }
      }
    }

    // Pattern B FIRST when explicit fill/type/enter verb places value before in/into/mein <field>
    match = clause.match(patternBRegex);
    if (match) {
      const rawVal = cleanEdgeQuotes(match[1]);
      const rawTarget = match[2].trim();
      const normTCheck = normalizeFillTarget(rawTarget);
      const valLooksLikeField = knownFieldExactRe.test(normalizeFillTarget(rawVal));
      const targetLooksLikeField =
        /^(?:this|this\s*box|this\s*field|it|here|isko|isme|yahan|yaha|yha)$/i.test(rawTarget) ||
        /\b(?:box|field|input|textbox|textarea|area|dropdown|select|bar|wala|wali|wale)\b/i.test(rawTarget) ||
        /\b(?:into|inside)\b/i.test(clause) ||
        knownFieldExactRe.test(normTCheck);

      if (!valLooksLikeField && targetLooksLikeField && !isNonValuePlaceholder(rawVal)) {
        if (/^(?:this|this\s*box|this\s*field|it|here|isko|isme|yahan|yaha|yha)$/i.test(rawTarget)) {
          explicitPairs.push({ target: "__CURRENT__", value: rawVal, overwrite });
          continue;
        }
        if (normTCheck && rawVal) {
          fields[normTCheck] = rawVal;
          explicitPairs.push({ target: normTCheck, value: rawVal, overwrite });
          continue;
        }
      }
    }

    // Pattern A: "<field> (wale)? (box|field|input)? mein/me/main/per/par/pr/in/into <value> (fill|type|likh|daal|bhar|kr do)?"
    match = clause.match(patternARegex);
    if (
      match &&
      !/\b(?:give|tell|show|help|ask|explain|send|let|teach|guide|write)\s+me\b/i.test(clause) &&
      !/\b(?:click|press|dabao|scroll|point|highlight|find|kholo|open)\b/i.test(clause)
    ) {
      const rawTarget = match[1]
        .trim()
        .replace(/^(?:fill|type|enter|write|put|set)\s+/i, "")
        .trim();
      const rawVal = cleanEdgeQuotes(match[2]);
      const normT = normalizeFillTarget(rawTarget);
      const isPositionalOrKnown =
        Boolean(resolvePositionalFieldTarget(rawTarget)) ||
        knownFieldExactRe.test(normT) ||
        /\b(?:field|box|input|textbox|textarea)\b/i.test(rawTarget);
      if ((hasFillVerbOrAssign || isPositionalOrKnown) && !isNonValuePlaceholder(rawVal)) {
        if (/^(?:is|ye|yeh|isko|isme|is\s*box|this|this\s*box|this\s*field|yahan|yaha|yha)$/i.test(rawTarget)) {
          explicitPairs.push({ target: "__CURRENT__", value: rawVal, overwrite });
          continue;
        }
        if (normT && rawVal) {
          fields[normT] = rawVal;
          if (isPositionalOrKnown) hasPositionalOrKnownAssign = true;
          explicitPairs.push({ target: normT, value: rawVal, overwrite });
          continue;
        }
      }
    }

    // Fallback Pattern B (when not matched by Pattern A)
    match = clause.match(patternBRegex);
    if (match) {
      const rawVal = cleanEdgeQuotes(match[1]);
      const rawTarget = match[2].trim();
      if (!isNonValuePlaceholder(rawVal)) {
        if (/^(?:this|this\s*box|this\s*field|it|here|isko|isme|yahan|yaha|yha)$/i.test(rawTarget)) {
          explicitPairs.push({ target: "__CURRENT__", value: rawVal, overwrite });
          continue;
        }
        const normT = normalizeFillTarget(rawTarget);
        if (normT && rawVal) {
          fields[normT] = rawVal;
          explicitPairs.push({ target: normT, value: rawVal, overwrite });
          continue;
        }
      }
    }

    // Pattern C: "isko/this <value> se fill/bhar kar do" or "fill this with <value>"
    match = clause.match(patternCRegex1) || clause.match(patternCRegex2);
    if (match && match[1] && !isNonValuePlaceholder(match[1])) {
      explicitPairs.push({ target: "__CURRENT__", value: cleanEdgeQuotes(match[1]), overwrite });
      continue;
    }

    // Pattern D: "<knownField> (as|is|change karke|update karke|ko)? <value> (fill|type|likh|daal|bhar|kar do|kr do)?"
    match = clause.match(knownFieldValRe);
    if (match && match[1] && match[2]) {
      const rawT = match[1].toLowerCase().replace(/\s+/g, "");
      const keyMap = {
        naam: "name",
        fullname: "name",
        firstname: "first name",
        lastname: "lastname",
        surname: "lastname",
        familyname: "lastname",
        dateofbirth: "dob",
        mobilenumber: "phone",
        mobileno: "phone",
        mobile: "phone",
        phonenumber: "phone",
        phoneno: "phone",
        mail: "email",
        emailid: "email",
        emailaddress: "email",
        pata: "address",
        pincode: "pincode",
        pin: "pincode",
        zipcode: "pincode",
        zip: "pincode",
        aadhaar: "aadhaarnumber",
        aadhar: "aadhaarnumber",
        aadharnumber: "aadhaarnumber",
        msg: "message",
      };
      const mappedKey = keyMap[rawT] || rawT;
      let cleanVal = cleanEdgeQuotes(
        match[2].replace(new RegExp(`\\s+${trailingVerbSuffix}$`, "i"), ""),
      );
      if (/\s+(?:hai|he|h|hoon)$/i.test(cleanVal)) {
        cleanVal = cleanVal.replace(/\s+(?:hai|he|h|hoon)$/i, "").trim();
      }
      if (cleanVal && !isNonValuePlaceholder(cleanVal)) {
        fields[mappedKey] = cleanVal;
        explicitPairs.push({ target: mappedKey, value: cleanVal, overwrite });
        continue;
      }
    }

    // Pattern F: Value-first fill without naming a field (e.g. "1234 FILL KR DO", "9560798373 YE FILL KR DO",
    // "9560798373 isme fill kr do", "hello world likh do", "fill 1234", "fill kar do 9560798373")
    if (
      clauses.length === 1 &&
      hasFillVerbOrAssign &&
      !/\b(?:click|press|dabao|scroll|point|highlight|find|kholo|open|ki\s+jagah|instead\s+of)\b/i.test(clause)
    ) {
      const bareVerbEndRe =
        /^(?:["']([^"']+)["']|(.+?))\s+(?:(?:ye|yeh|isko|isme|yahan|yaha|yha|ye\s+wal[aei]|is\s+(?:box|field|input)(?:\s+(?:mein|me|main|ko))?)\s+)?(?:(?:fill|type|likh|likho|lkh|lkho|daal|daalo|dalo|bhar|bharo|enter)\s*(?:(?:kar|kr)\s*do|krdo|(?:kar|kr)\s*de|(?:kar|kr)o|karein|do|de)?)[.!?\s]*$/i;
      const bareVerbStartRe =
        /^(?:fill|type|likho|lkho|likh\s+do|enter|daalo|dalo|daal\s+do|bharo)\s+(?:(?:(?:kar|kr)\s*(?:do|de|o)|krdo|do|de)\s+)?(?:(?:in|into|inside)\s+(?:this(?:\s+box|\s+field)?|it|here)\s+)?(?:["']([^"']+)["']|(.+?))[.!?\s]*$/i;
      const fMatch = clause.match(bareVerbEndRe) || clause.match(bareVerbStartRe);
      if (fMatch) {
        const rawCandidate = (fMatch[1] || fMatch[2] || "").trim();
        const candidateClean = rawCandidate
          .replace(/^(?:(?:ye|yeh|is)\s+wal[aei]|isme|isko|is\s*box\s*(?:mein|me|main)?|is\s*field\s*(?:mein|me|main)?|ye|yeh|yahan|yaha|yha|ab|please)\s+/i, "")
          .replace(/\s+(?:ko|ka|ke|ki|mein|me|main|par|pe|pr|in|into|se|ye|yeh|isko|isme|ye\s+wal[aei])$/i, "")
          .trim();
        const candNormTarget = normalizeFillTarget(candidateClean);
        const looksLikeQuestion =
          /^(?:what|why|how|where|when|which|who|kya|kyun|kaise|kahan|kidhar|kaun|kaunsa|kab|kitna)\b/i.test(
            candidateClean,
          ) || /[?]$/.test(clause.trim());
        const endsWithLocationCase = /\b(?:ko|ke|mein|me|main|par|pe|pr|in|into|from|se)$/i.test(rawCandidate);
        const looksLikeFormOrFieldOnly =
          !fMatch[1] &&
          (knownFieldExactRe.test(candNormTarget) ||
            /^(?:(?:the|this|is|my|apna)\s+)?(?:(?:is|this)\s+page\s+ka\s+)?(?:form|all\s+fields|inputs?|fields?|box(?:es)?|details|info|information|data|sab|sab\s*kuch|kuch\s*bhi)$/i.test(
              candidateClean,
            ) ||
            /\b(?:ka|this|the|is)\s+form\b/i.test(candidateClean));
        if (
          candidateClean &&
          !isNonValuePlaceholder(rawCandidate) &&
          !isNonValuePlaceholder(candidateClean) &&
          !looksLikeFormOrFieldOnly &&
          !looksLikeQuestion &&
          !endsWithLocationCase
        ) {
          explicitPairs.push({ target: "__CURRENT__", value: candidateClean, overwrite });
          continue;
        }
      }
    }
  }

  // Comma-safe Pattern F fallback when user types e.g. "hello, world type kar do"
  if (
    explicitPairs.length === 0 &&
    clauses.length > 1 &&
    hasFillVerbOrAssign &&
    !/\b(?:click|press|dabao|scroll|point|highlight|find|kholo|open)\b/i.test(cleaned)
  ) {
    const multiFieldAliasRe = new RegExp(`\\b${KNOWN_FIELD_ALIASES}\\b`, "gi");
    const aliasHits = cleaned.match(multiFieldAliasRe) || [];
    if (aliasHits.length < 2) {
      const bareVerbEndWholeRe =
        /^(?:["']([^"']+)["']|(.+?))\s+(?:(?:ye|yeh|isko|isme|yahan|yaha|yha|ye\s+wal[aei]|is\s+(?:box|field|input)(?:\s+(?:mein|me|main|ko))?)\s+)?(?:(?:fill|type|likh|likho|lkh|lkho|daal|daalo|dalo|bhar|bharo|enter)\s*(?:(?:kar|kr)\s*do|krdo|(?:kar|kr)\s*de|(?:kar|kr)o|karein|do|de)?)[.!?\s]*$/i;
      const bareVerbStartWholeRe =
        /^(?:fill|type|likho|lkho|likh\s+do|enter|daalo|dalo|daal\s+do|bharo)\s+(?:(?:(?:kar|kr)\s*(?:do|de|o)|krdo|do|de)\s+)?(?:(?:in|into|inside)\s+(?:this(?:\s+box|\s+field)?|it|here)\s+)?(?:["']([^"']+)["']|(.+?))[.!?\s]*$/i;
      const wholeMatch = cleaned.match(bareVerbEndWholeRe) || cleaned.match(bareVerbStartWholeRe);
      if (wholeMatch) {
        const rawWhole = (wholeMatch[1] || wholeMatch[2] || "").trim();
        const wholeClean = rawWhole
          .replace(/^(?:(?:ye|yeh|is)\s+wal[aei]|isme|isko|is\s*box\s*(?:mein|me|main)?|is\s*field\s*(?:mein|me|main)?|ye|yeh|yahan|yaha|yha|ab|please)\s+/i, "")
          .replace(/\s+(?:ko|ka|ke|ki|mein|me|main|par|pe|pr|in|into|se|ye|yeh|isko|isme|ye\s+wal[aei])$/i, "")
          .trim();
        if (
          wholeClean &&
          !isNonValuePlaceholder(rawWhole) &&
          !isNonValuePlaceholder(wholeClean) &&
          !/[?]$/.test(cleaned.trim())
        ) {
          explicitPairs.push({ target: "__CURRENT__", value: wholeClean, overwrite });
        }
      }
    }
  }

  // Fallback Pattern E: natural comma-separated attributes ("name Rahul, email rahul@gmail.com, city Delhi")
  if (explicitPairs.length === 0) {
    const patterns = [
      { key: "first name", regex: /\bfirst\s+name\s+(?:as\s+|is\s+|:\s*)?([A-Za-z\s]+?)(?:,|\s+last\s+name|\s+surname|\s+email|\s+city|\s+pin|\s+phone|\s+mobile|\s+bhar|\s+fill|$)/i },
      { key: "lastname", regex: /\b(?:last\s+name|surname)\s+(?:as\s+|is\s+|:\s*)?([A-Za-z\s]+?)(?:,|\s+email|\s+city|\s+pin|\s+phone|\s+mobile|\s+bhar|\s+fill|$)/i },
      { key: "name", regex: /\b(?:name|naam)\s+(?:as\s+|is\s+|:\s*)?([A-Za-z\s]+?)(?:,|\s+email|\s+city|\s+pin|\s+phone|\s+mobile|\s+address|\s+bhar|\s+fill|$)/i },
      { key: "email", regex: /\b(?:email|mail)\s+(?:as\s+|is\s+|:\s*)?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i },
      { key: "phone", regex: /\b(?:phone|mobile(?:\s+number)?)\s+(?:as\s+|is\s+|:\s*)?(\+?\d{10,13})/i },
      { key: "address", regex: /\b(?:address|pata)\s+(?:as\s+|is\s+|:\s*)?([^,\n]+?)(?:,|\s+city|\s+state|\s+pin|\s+bhar|\s+fill|$)/i },
      { key: "city", regex: /\bcity\s+(?:as\s+|is\s+|:\s*)?([A-Za-z\s]+?)(?:,|\s+state|\s+pin|\s+phone|\s+fill|$)/i },
      { key: "state", regex: /\bstate\s+(?:as\s+|is\s+|:\s*)?([A-Za-z\s]+?)(?:,|\s+pin|\s+city|\s+phone|\s+fill|$)/i },
      { key: "pincode", regex: /\b(?:pin|pincode|zip)\s+(?:as\s+|is\s+|:\s*)?(\d{5,6})/i },
      { key: "gstin", regex: /\b(?:gstin|gst)\s+(?:as\s+|is\s+|:\s*)?([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1})/i },
    ];
    for (const p of patterns) {
      if ((p.key === "name") && (fields["first name"] || fields["lastname"])) continue;
      const match = cleaned.match(p.regex);
      if (match && match[1]) {
        const val = match[1].trim();
        if (!isNonValuePlaceholder(val)) {
          fields[p.key] = val;
          explicitPairs.push({ target: p.key, value: val, overwrite });
        }
      }
    }
  }

  return {
    fields: Object.keys(fields).length > 0 ? fields : null,
    explicitPairs: explicitPairs.length > 0 ? explicitPairs : null,
    overwrite,
    explicitUserProvided: explicitPairs.length > 0,
    hasPositionalOrKnownAssign,
    hasExplicitNoSubmit,
  };
}

function extractFieldsFromMessage(text) {
  return extractFillDetails(text).fields;
}

function isLikelyActionCommand(text) {
  const norm = normalizeHinglishCommand(String(text || "")).toLowerCase().trim();
  if (!norm) return false;
  return /\b(?:fill|type|likh|likho|daal|daalo|bhar|bharo|enter|click|press|dabao|scroll|open|kholo|search|dhoondho|dhundo|select|choose|chuno|check|uncheck|badal|badlo|change|update|replace|modify|remove|hatao|hatana|lagao|submit|bhejo|rakh|rakhna|isme|isko|usko|ye\s+wala|wahi|yahi|kar\s+do|karo)\b/i.test(
    norm,
  );
}

function parseActionIntent(text) {
  const ctx = arguments.length > 1 ? arguments[1] : null;
  const trimmed = (text || "").trim();
  const stripped = stripBuddyPrefix(trimmed);
  const normStripped = normalizeHinglishCommand(stripped);
  const lower = normStripped.toLowerCase();

  // 0. CONVERSATIONAL CONTEXT FOLLOW-UPS (pending slot, pending confirmation, corrections, contextual pronouns)
  if (ctx) {
    if (
      /^(?:cancel|rehne\s+do|chhodo|mat\s+karo|nahi|no|skip|band\s+karo)[.!?\s]*$/i.test(lower) &&
      (ctx.pendingSlot || ctx.hasPendingAction || ctx.pendingDisambiguation || ctx.activeFormSession?.active)
    ) {
      return { type: "CANCEL_PENDING" };
    }

    // Correction 1 (Test G): Move previously filled value to a different field ("Nahi, doosre field mein daalna tha")
    const moveFieldMatch =
      normStripped.match(
        /^(?:nahi|no|galat|wrong(?:\s+field)?)[,\s]+(?:isko\s+|use\s+|wo\s+|ye\s+)?(.+?)\s+(?:mein|me|main|par|pe|pr|in|into)\s+(?:daalna|dalna|bharna|likhna|fill\s+karna|daalo|daal\s+do|bharo)\s*(?:tha)?[.!?\s]*$/i,
      ) ||
      normStripped.match(
        /^(?:wrong\s+field[,\s]+)?(?:put|move|fill)\s+(?:it|that)\s+(?:in|into)\s+(?:the\s+)?(.+?)(?:\s+instead)?[.!?\s]*$/i,
      );
    if (moveFieldMatch?.[1] && ctx.activeFormSession?.lastFilled?.value) {
      const destField = normalizeFillTarget(moveFieldMatch[1]);
      if (destField) {
        return {
          type: "MOVE_LAST_FILL",
          targetField: destField,
          prevSelector: ctx.activeFormSession.lastFilled.selector,
          value: ctx.activeFormSession.lastFilled.value,
        };
      }
    }

    // Correction 2 (Test F): Replace previous value ("Nahi, Murshad ki jagah Murshid likho", "instead of X write Y")
    const replaceValMatch =
      normStripped.match(
        /^(?:nahi|no)[,\s]+(?:["']?(.+?)["']?\s+ki\s+jagah|instead\s+of\s+["']?(.+?)["']?(?:\s*,|\s+))\s*["']?(.+?)["']?\s*(?:likh\s*(?:do|de|karo)?|likho|daal\s*(?:do|de|karo)?|daalo|bhar\s*(?:do|de|karo)?|bharo|kar\s+do|karo|write|fill|type)?[.!?\s]*$/i,
      ) ||
      normStripped.match(
        /^(?:["']?(.+?)["']?\s+ki\s+jagah|instead\s+of\s+["']?(.+?)["']?(?:\s*,|\s+))\s*["']?(.+?)["']?\s*(?:likh\s*(?:do|de|karo)?|likho|daal\s*(?:do|de|karo)?|daalo|kar\s+do|karo|write|fill|type)[.!?\s]*$/i,
      );
    if (replaceValMatch && (ctx.activeFormSession?.lastFilled || ctx.session?.lastTargetSelector || ctx.session?.lastTargetField)) {
      const oldVal = (replaceValMatch[1] || replaceValMatch[2] || "").trim();
      const newVal = (replaceValMatch[3] || "").trim();
      if (newVal && !isNonValuePlaceholder(newVal)) {
        return {
          type: "CORRECT_LAST_FILL",
          oldValue: oldVal,
          newValue: newVal,
        };
      }
    }

    // Incomplete Google/web search reply ("Google par search karna hai" -> "HGH injections")
    if (ctx.pendingSlot?.type === "search_query") {
      const qClean = trimmed
        .replace(/^["']|["']$/g, "")
        .replace(/\s+(?:search\s*(?:karo|kro|(?:kar|kr)\s*do)?|dhoondho|dhundo)[.!?\s]*$/i, "")
        .trim();
      if (
        qClean &&
        !/^(?:scroll\s+|go\s+back|refresh|reload|close|help|what\s+can\s+you\s+do|explain\s+this\s+page)/i.test(
          lower,
        )
      ) {
        return { type: "WEB_SEARCH", query: qClean, engine: ctx.pendingSlot.engine || "google" };
      }
    }

    if (
      ctx.pendingSlot?.type === "fill_target" &&
      Array.isArray(ctx.pendingSlot.candidates) &&
      ctx.pendingSlot.candidates.length > 0
    ) {
      const idx = resolveOrdinalChoiceIndex(lower);
      if (idx && idx <= ctx.pendingSlot.candidates.length) {
        const chosen = ctx.pendingSlot.candidates[idx - 1];
        return {
          type: "FORM_FILL",
          explicitPairs: [
            {
              target: chosen.label || "__CURRENT__",
              selector: chosen.selector,
              value: ctx.pendingSlot.value,
              overwrite: true,
            },
          ],
          explicitUserProvided: true,
          fromFormSession: Boolean(ctx.activeFormSession?.active),
          noSubmitPrompt: Boolean(ctx.pendingSlot.noSubmitPrompt),
        };
      }
      const matchedCand = ctx.pendingSlot.candidates.find((c) =>
        String(c.label || "")
          .toLowerCase()
          .includes(lower.replace(/\s+(?:wala|wali|mein|me|field|box)$/i, "").trim()),
      );
      if (matchedCand) {
        return {
          type: "FORM_FILL",
          explicitPairs: [
            {
              target: matchedCand.label || "__CURRENT__",
              selector: matchedCand.selector,
              value: ctx.pendingSlot.value,
              overwrite: true,
            },
          ],
          explicitUserProvided: true,
          fromFormSession: Boolean(ctx.activeFormSession?.active),
          noSubmitPrompt: Boolean(ctx.pendingSlot.noSubmitPrompt),
        };
      }
    }

    // Structured field+value turn during an active form-filling session ("First field mein Murshad", "Last field mein Ali")
    if (ctx.activeFormSession?.active || ctx.pendingSlot?.type === "fill_value") {
      const sessionFill = extractFillDetails(stripped);
      if (
        sessionFill.explicitPairs?.length &&
        (sessionFill.hasPositionalOrKnownAssign ||
          /\b(?:fill|type|likh|likho|daal|daalo|bhar|bharo|enter|set)\b|[:=]/i.test(normStripped))
      ) {
        return {
          type: "FORM_FILL",
          fields: sessionFill.fields,
          explicitPairs: sessionFill.explicitPairs,
          overwrite: Boolean(sessionFill.overwrite || true),
          explicitUserProvided: true,
          fromChatCommand: true,
          fromFormSession: true,
          noSubmitPrompt: Boolean(ctx.pendingSlot?.noSubmitPrompt || sessionFill.hasExplicitNoSubmit),
        };
      }
    }

    // Bare value response to "Kya likhna hai? / Kya fill karna hai?"
    const quotedReplyMatch = trimmed.match(/^["'](.+)["']$/);
    const fillValueCandidate = quotedReplyMatch ? quotedReplyMatch[1].trim() : trimmed;
    const isCommandNotLiteralValue =
      !quotedReplyMatch &&
      (isLikelyActionCommand(normStripped) ||
        isNonValuePlaceholder(stripped) ||
        /\b(?:kya\s+(?:kar|kiya|hai|h|likh|fill|bharna)|explain|samjhao|batao|bata|check\s+karo|dobara|kholo|kahan|kidhar|where\s+is|abhi\s+submit\s+mat|next\s+field)\b/i.test(
          lower,
        ));
    if (
      ctx.pendingSlot?.type === "fill_value" &&
      fillValueCandidate.length > 0 &&
      fillValueCandidate.length <= 240 &&
      !isCommandNotLiteralValue &&
      !/^(?:scroll\s+|click\s+|point\s+|go\s+back|refresh|reload|help|what\s+can\s+you\s+do|explain\s+this\s+page|ye\s+page\s+samjhao|yahan\s+kya)/i.test(
        lower,
      ) &&
      !/(?:kholo|kahan\s+hai|kidhar\s+hai|samjhao|page\s+par\s+kya)/i.test(lower)
    ) {
      const target = ctx.pendingSlot.targetField || ctx.session?.lastTargetField || "__CURRENT__";
      const isBoxSingle =
        target === "__CURRENT__" || /\b(?:search|chat|msg|message|comment|prompt|query)\b/i.test(String(target));
      return {
        type: "FORM_FILL",
        explicitPairs: [
          {
            target,
            selector: ctx.pendingSlot.targetSelector || undefined,
            value: fillValueCandidate,
            overwrite: true,
          },
        ],
        explicitUserProvided: true,
        fromChatCommand: true,
        fromFormSession: Boolean(ctx.pendingSlot.fromFormSession || ctx.activeFormSession?.active),
        noSubmitPrompt: Boolean(ctx.pendingSlot.noSubmitPrompt || isBoxSingle),
      };
    }

    // Ordinal click from recent find/search results ("Ab doosre wale par click karo")
    if (
      !ctx.pendingDisambiguation &&
      Array.isArray(ctx.session?.lastItems) &&
      ctx.session.lastItems.length > 1 &&
      /\b(?:click|open|kholo|press|dabao|select)\b/i.test(lower)
    ) {
      const ord = resolveOrdinalChoiceIndex(lower);
      if (ord && ord >= 1 && ord <= ctx.session.lastItems.length) {
        const chosen = ctx.session.lastItems[ord - 1];
        if (chosen?.selector) {
          return {
            type: "CLICK",
            target: chosen.textSnippet || chosen.fullText || `item ${ord}`,
            selector: chosen.selector,
            candidateIndex: ord,
            isConsequential: false,
          };
        }
      }
    }

    // Resume interrupted / paused multi-step plan ("continue from where you stopped", "jahan ruke the wahan se aage badho")
    if (
      /^(?:continue\s+from\s+where\s+(?:you|we)\s+stopped|resume\s+(?:task|plan|workflow|from\s+checkpoint)|(?:jahan|jaha)\s+ruke\s+the\s+(?:wahan\s+se\s+)?(?:aage|continue|shuru)\s*(?:karo|kro|(?:kar|kr)\s*do)?|aage\s+continue\s*(?:karo|kro)?)[.!?\s]*$/i.test(
        lower,
      )
    ) {
      return { type: "RESUME_PLAN" };
    }

    // Contextual pronoun actions referencing last highlighted/targeted element ("hover over it", "double click this", "right click it", "open it in another tab")
    const refSel = ctx.session?.lastTargetRef?.selector || ctx.session?.lastTargetSelector || null;
    const refLabel = ctx.session?.lastTargetRef?.label || ctx.session?.lastTargetField || null;
    if (refSel || refLabel) {
      if (/^(?:hover(?:\s+(?:over|on))?\s+(?:it|this|that)|(?:is|us)\s*(?:par|pe|pr)\s+hover\s*(?:karo|kro)?)[.!?\s]*$/i.test(lower)) {
        return { type: "HOVER", target: refLabel || "__CURRENT__", selector: refSel };
      }
      if (/^(?:double[\s-]*click(?:\s+on)?\s+(?:it|this|that)|(?:is|us)\s*(?:par|pe|pr)\s+double[\s-]*click\s*(?:karo|kro)?)[.!?\s]*$/i.test(lower)) {
        return { type: "DOUBLE_CLICK", target: refLabel || "__CURRENT__", selector: refSel };
      }
      if (/^(?:right[\s-]*click(?:\s+on)?\s+(?:it|this|that)|(?:is|us)\s*(?:par|pe|pr)\s+right[\s-]*click\s*(?:karo|kro)?)[.!?\s]*$/i.test(lower)) {
        return { type: "RIGHT_CLICK", target: refLabel || "__CURRENT__", selector: refSel };
      }
      if (/^(?:open\s+(?:it|this|that)\s+in\s+(?:another|a\s+new|new)\s+tab|(?:isko|use)\s+naye\s+tab\s+mein\s+kholo)[.!?\s]*$/i.test(lower)) {
        return { type: "TAB_ACTION", action: "open_tab", target: refLabel || "__CURRENT__", selector: refSel };
      }
    }

    // Short affirmative follow-up ("hnn kr do", "haan kar do", "ok kar do", "yes")
    if (
      /^(?:haan|yes|ok|okay|theek\s+hai|thik\s+hai|sahi\s+hai)?\s*(?:kar\s+do|karo|do\s+it|proceed|confirm|chalo)?[.!?\s]*$/i.test(
        lower,
      ) &&
      /^(?:haan|yes|ok|okay|theek|thik|kar\s+do|karo|proceed)/i.test(lower)
    ) {
      if (ctx.hasPendingAction) {
        return { type: "CONFIRM_PENDING" };
      }
      if (ctx.session?.lastActionProposal) {
        return { type: "EXECUTE_CONTEXT_PROPOSAL", proposal: ctx.session.lastActionProposal };
      }
    }

    // Demonstrative selection ("bss ye wala", "ye wala", "yahi wala")
    if (/^(?:bas\s+)?(?:yahi|ye|yeh)\s*(?:wala|wali|wale)?[.!?\s]*$/i.test(lower)) {
      if (ctx.pendingDisambiguation?.candidates?.length) {
        return { type: "SELECT_CONTEXT_ITEM", index: 1 };
      }
      if (ctx.pendingSlot?.type === "fill_target" && ctx.pendingSlot.candidates?.length) {
        const chosen = ctx.pendingSlot.candidates[0];
        return {
          type: "FORM_FILL",
          explicitPairs: [
            {
              target: chosen.label || "__CURRENT__",
              selector: chosen.selector,
              value: ctx.pendingSlot.value,
              overwrite: true,
            },
          ],
          explicitUserProvided: true,
          fromFormSession: Boolean(ctx.activeFormSession?.active),
        };
      }
    }
  }

  // 1. GREETING
  if (
    /^(?:hi+|hello+|hey+|namaste|pranam|hola|kya haal(?:\s+hai)?|ram ram|good\s+(?:morning|afternoon|evening)|kaise ho|buddy)[.!?\s]*$/i.test(
      lower,
    )
  ) {
    return { type: "GREETING" };
  }

  // 2. HELP / CAPABILITIES
  if (
    /^(?:what can you do|help|kaam kya hai|kya kar sakte ho|features|commands|guide me)[.!?\s]*$/i.test(
      lower,
    )
  ) {
    return { type: "HELP" };
  }

  // 2b. BROWSER HISTORY (BACK / FORWARD / REFRESH)
  if (
    /^(?:go\s+back|back|previous\s+page|pichle\s+page\s+(?:par|pe|pr)\s+(?:jao|wapas\s+jao|chalo)|wapas\s+jao|peeche\s+(?:jao|chalo))[.!?\s]*$/i.test(
      lower,
    )
  ) {
    return { type: "HISTORY_NAV", direction: "back" };
  }
  if (
    /^(?:go\s+forward|forward|next\s+history|aage\s+(?:jao|badho)|agle\s+page\s+(?:par|pe|pr)\s+(?:jao|chalo))[.!?\s]*$/i.test(
      lower,
    )
  ) {
    return { type: "HISTORY_NAV", direction: "forward" };
  }
  if (
    /^(?:refresh|reload|refresh\s+(?:the\s+|this\s+)?page|reload\s+(?:the\s+|this\s+)?page|page\s+(?:ko\s+)?(?:refresh|reload)\s*(?:karo|kro|(?:kar|kr)\s*do)?)[.!?\s]*$/i.test(
      lower,
    )
  ) {
    return { type: "HISTORY_NAV", direction: "reload" };
  }

  // 2b-2. UNDO REVERSIBLE ACTION ("undo", "undo last edit", "wapas pehle jaisa karo")
  if (
    /^(?:undo(?:\s+(?:last\s+(?:edit|change|fill|action)|that|it|tab|navigation))?|revert\s+last\s+(?:edit|change|field)|wapas\s+pehle\s+jaisa\s*(?:karo|kro|(?:kar|kr)\s*do)?|pichla\s+(?:change|edit)\s+hatao)[.!?\s]*$/i.test(
      lower,
    )
  ) {
    return {
      type: "UNDO_ACTION",
      scope: /\b(?:navigation|page\s+nav|history)\b/i.test(lower) ? "navigation" : "field",
    };
  }

  // 2b-3. MULTI-TAB ORCHESTRATION ("return to original tab", "open X in another tab", "close this tab")
  if (
    /^(?:return\s+to\s+(?:the\s+)?original\s+tab|go\s+back\s+to\s+(?:the\s+)?(?:original|first|previous)\s+tab|(?:original|pehle|pichle)\s+tab\s+(?:par|pe|pr)\s+(?:wapas\s+)?(?:jao|chalo|aao))[.!?\s]*$/i.test(
      lower,
    )
  ) {
    return { type: "TAB_ACTION", action: "return_original" };
  }
  const openTabMatch =
    normStripped.match(/^(?:open|launch)\s+(.+?)\s+in\s+(?:another|a\s+new|new)\s+tab[.!?\s]*$/i) ||
    normStripped.match(/^(.+?)\s+(?:ko\s+)?(?:naye|new)\s+tab\s+(?:mein|me|main)\s+(?:kholo|khol\s+do|open\s*(?:karo|kro)?)[.!?\s]*$/i);
  if (openTabMatch?.[1]) {
    return { type: "TAB_ACTION", action: "open_tab", target: openTabMatch[1].trim() };
  }
  if (/^(?:close\s+(?:this|the\s+current)\s+tab|(?:ye|yeh|is|current)\s+tab\s+(?:band|close)\s*(?:karo|kro|(?:kar|kr)\s*do)?)[.!?\s]*$/i.test(lower)) {
    return { type: "TAB_ACTION", action: "close_tab" };
  }
  const switchTabMatch =
    normStripped.match(/^switch\s+(?:to\s+)?(?:the\s+)?(.+?)\s+tab[.!?\s]*$/i) ||
    normStripped.match(/^(.+?)\s+tab\s+(?:par|pe|pr)\s+(?:switch|jao)[.!?\s]*$/i);
  if (switchTabMatch?.[1] && !/^(?:orders?|settings?|history|home)$/i.test(switchTabMatch[1].trim())) {
    return { type: "TAB_ACTION", action: "switch_tab", target: switchTabMatch[1].trim() };
  }

  // 2b-4. COMPARE TWO PAGES ("compare two pages", "compare these two pages", "compare those two pages", "dono pages compare karo")
  if (
    /^(?:compare\s+(?:(?:the|these|those|both)\s+)?(?:two\s+)?(?:pages?|tabs?)|(?:in\s+|ye\s+)?dono\s+(?:pages?|tabs?)\s+(?:ko\s+)?compare(?:\s+(?:karo|kro|(?:kar|kr)\s*do))?|dono\s+(?:pages?|tabs?)\s+ka\s+compar(?:e|ison)(?:\s+(?:karo|kro|dikhao))?)[.!?\s]*$/i.test(
      lower,
    )
  ) {
    return { type: "COMPARE_TWO_PAGES" };
  }

  // 2c. PAGE INVENTORY ("Is page par kya kya hai") — works locally without AI key
  if (
    /^(?:is\s+page\s+(?:par|pe|pr|mein|me|main)\s+kya\s+(?:kya\s+)?(?:hai|he)|page\s+(?:par|pe|pr|mein|me|main)\s+kya\s+(?:kya\s+)?(?:hai|he)|what\s+is\s+on\s+(?:this\s+)?page|what'?s\s+on\s+(?:this\s+)?page|list\s+(?:page\s+)?(?:elements|fields|buttons|controls))[.!?\s]*$/i.test(
      lower,
    )
  ) {
    return { type: "PAGE_INVENTORY" };
  }

  // 1b. BARE AFFIRMATIVE WITHOUT PENDING PROPOSAL ("hnn kr do" when nothing is pending)
  if (
    /^(?:(?:haan|yes|ok|okay|theek\s+hai|thik\s+hai|sahi\s+hai)\s+(?:kar\s+do|karo|do\s+it|proceed|confirm)|kar\s+do|karo)[.!?\s]*$/i.test(
      lower,
    )
  ) {
    return { type: "CLARIFY_AFFIRMATIVE" };
  }

  // 2d. SESSION ACTIVITY LOG / VERIFICATION CHECK ("ab tak kya kiya", "Maine jo bola tha wo kiya kya?")
  if (
    /^(?:ab\s+(?:tak|tk)\s+kya\s+(?:kiya|kya|kra|kara)(?:\s+hai)?|aapne\s+kya\s+kiya|what\s+(?:did\s+you\s+do|have\s+you\s+done)|action\s+log|activity\s+log)[.!?\s]*$/i.test(
      lower,
    ) ||
    /(?:maine\s+(?:jo|jaisa)\s+(?:bola|kaha)\s+(?:tha\s+)?(?:wo|woh)\s+(?:kiya|hua|ho\s+gaya)|jo\s+(?:bola|kaha)\s+(?:tha\s+)?(?:kiya|hua)|wo\s+(?:kiya|kar\s+diya)\s+kya|kaam\s+(?:kiya|hua|ho\s+gaya)\s+kya|did\s+you\s+(?:do|complete)\s+(?:what\s+i\s+(?:asked|said)|that)|have\s+you\s+done\s+(?:that|it))\s*(?:kya)?[.!?\s]*$/i.test(
      lower,
    )
  ) {
    return { type: "ACTIVITY_LOG" };
  }

  // 2e-0. VALIDATE FORM ERRORS ("check form errors", "validate form", "form mein errors check karo")
  if (
    /^(?:check\s+(?:the\s+)?form\s+errors?|validate\s+(?:the\s+|this\s+)?form|form\s+(?:validate\s*(?:karo|kro|(?:kar|kr)\s*do)?|(?:mein|me)\s+errors?\s+check\s*(?:karo|kro)?))[.!?\s]*$/i.test(
      lower,
    )
  ) {
    return { type: "VALIDATE_FORM" };
  }

  // 2e-0. EXPLAIN PAGE ERRORS / INVALID FIELDS (Strictly separated from FORM_FILL)
  if (
    /(?:analyze|analyse|fix\s*&?\s*explain|explain)\s+.*?\b(?:errors?|alerts?|invalid\s+(?:form\s+)?fields?|issues?)\b/i.test(
      lower,
    ) ||
    /^(?:is\s+page\s+(?:par|pe|pr|mein|me)\s+)?(?:kya\s+)?(?:error|errors|issue|issues|galti|problem)\s+(?:hai|he|aa\s+r(?:aha|ahi)\s+hai|kyun|explain|samjhao|batao)/i.test(
      lower,
    ) ||
    /^(?:error|errors|alert|alerts|validation)\s+(?:explain|samjhao|batao|fix)\s*(?:karo|kro|(?:kar|kr)\s*do)?[.!?\s]*$/i.test(
      lower,
    )
  ) {
    return { type: "EXPLAIN_ERRORS" };
  }

  // 2e. EXPLAIN PAGE (Strictly separated from filling/actions!)
  if (
    /^(?:explain\s+(?:this\s+|the\s+)?page|page\s+(?:explain|samjhao)\s*(?:karo|kar\s+do)?|(?:ye|yeh|is)\s+page\s+(?:ko\s+)?(?:explain\s*(?:karo|kar\s+do)?|samjhao|kya\s+hai)|is\s+page\s+ke\s+baare\s+mein\s+batao|summarize\s+(?:this\s+)?page|what\s+is\s+this\s+page)[.!?\s]*$/i.test(
      lower,
    )
  ) {
    return { type: "EXPLAIN" };
  }

  // 3. SMART SCROLLING, PAGINATION & INFINITE SCROLL
  const infiniteScrollMatch =
    lower.match(/^(?:keep\s+scrolling|infinite\s+scroll|scroll\s+and\s+(?:load|collect)(?:\s+all)?(?:\s+items)?|(?:neeche|niche)\s+scroll\s+karke\s+(?:sab|saare|all)\s+items?\s+(?:collect|load|nikaalo)\s*(?:karo|kro)?)(?:\s+until\s+(.+))?[.!?\s]*$/i);
  if (infiniteScrollMatch) {
    return { type: "INFINITE_SCROLL", targetText: infiniteScrollMatch[1]?.trim() || undefined };
  }

  const scrollUntilTextMatch =
    lower.match(/^scroll\s+until\s+(?:you\s+see\s+|the\s+)?["']?(.+?)["']?(?:\s+appears?)?[.!?\s]*$/i) ||
    lower.match(/^jab\s+tak\s+["']?(.+?)["']?\s+na\s+dikhe\s+scroll\s*(?:karo|kro|(?:kar|kr)\s*do)?[.!?\s]*$/i);
  if (scrollUntilTextMatch?.[1]) {
    return { type: "SCROLL_UNTIL_TEXT", text: scrollUntilTextMatch[1].trim() };
  }

  const paginateMatch =
    lower.match(/^(?:go\s+to\s+(?:the\s+)?(last|next)\s+page|(last|aakhri|agle|next)\s+page\s+(?:par|pe|pr)\s+(?:jao|chalo)|(?:go\s+to\s+)?page\s+(\d+)|page\s+(\d+)\s+(?:par|pe|pr)\s+(?:jao|chalo))[.!?\s]*$/i);
  if (paginateMatch) {
    const rawPg = (paginateMatch[1] || paginateMatch[2] || paginateMatch[3] || paginateMatch[4] || "next").toLowerCase();
    const mappedPg = rawPg === "aakhri" ? "last" : rawPg === "agle" ? "next" : rawPg;
    return { type: "PAGINATE", targetPage: mappedPg };
  }

  const namedContainerScrollMatch =
    lower.match(
      /^(.+?)\s+(?:ko|box\s+ko|area\s+ko|section\s+ko|panel\s+ko)\s+(neeche|niche|upar|left|right|baayein|daayein|down|up)\s+scroll\s*(?:karo|kro|(?:kar|kr)\s*do|karein)?[.!?\s]*$/i,
    ) ||
    lower.match(
      /^scroll\s+(?:the\s+)?(.+?)\s+(down|up|left|right)[.!?\s]*$/i,
    );
  if (namedContainerScrollMatch) {
    const rawName = namedContainerScrollMatch[1]
      .replace(/^(?:is\s+page\s+(?:ke|par|pr)|page\s+(?:ke|par|pr)|the|this)\s+/i, "")
      .replace(/\s+(?:ko|box|area|section|panel)$/i, "")
      .trim();
    const rawDir = namedContainerScrollMatch[2].toLowerCase();
    if (rawName && !/^(?:page|window|screen|to|thoda|slightly)$/i.test(rawName)) {
      const dirMap = { neeche: "down", niche: "down", upar: "up", baayein: "left", daayein: "right" };
      return {
        type: "SCROLL",
        direction: dirMap[rawDir] || rawDir,
        targetContainerText: rawName,
      };
    }
  }

  const scrollToTargetMatch =
    lower.match(/^(.+?)\s+(?:tak|par|pe|pr)\s+scroll\s*(?:karo|kro|(?:kar|kr)\s*do|karein)?[.!?\s]*$/i) ||
    lower.match(/^scroll\s+(?:to|until)\s+(?:the\s+)?(.+?)(?:\s+is\s+visible)?[.!?\s]*$/i);
  if (
    scrollToTargetMatch &&
    !/^(?:top|bottom|up|down|left|right|last|end|neeche|niche|upar)$/i.test(scrollToTargetMatch[1].trim())
  ) {
    const cleanScrollTarget = scrollToTargetMatch[1]
      .replace(/^(?:is\s+page\s+(?:ke|par|pr)|page\s+(?:ke|par|pr)|the)\s+/i, "")
      .trim();
    if (cleanScrollTarget) {
      return { type: "SCROLL", direction: "to_element", target: cleanScrollTarget };
    }
  }

  if (
    /^(?:(?:thoda|thoda\s+aur|aur|please|ab)?\s*)?(?:scroll\s+(?:down|up|left|right|to\s+top|top|to\s+bottom|bottom)|(?:neeche|niche|upar|left|right|baayein|daayein)\s+scroll(?:\s*(?:karo|kro|(?:kar|kr)\s*do|karein))?|(?:page\s+ko\s+)?(?:neeche|niche|upar)\s+(?:jao|le\s+jao|(?:kar|kr)o|(?:kar|kr)do)|neeche\s+jao|upar\s+jao|page\s+down|page\s+up|(?:page\s+ke\s+)?(?:last|bottom|end|aakhri)\s+(?:mein|me|par|pr)\s+(?:jao|le\s+jao)|(?:page\s+ke\s+)?(?:top|shuru)\s+(?:mein|me|par|pr)\s+(?:jao|le\s+jao))[.!?\s]*$/i.test(
      lower,
    )
  ) {
    let dir = "down";
    if (/\b(?:up|upar)\b/i.test(lower)) dir = "up";
    else if (/\b(?:left|baayein|baaye)\b/i.test(lower)) dir = "left";
    else if (/\b(?:right|daayein|daaye)\b/i.test(lower)) dir = "right";
    else if (/\b(?:top|shuru)\b/i.test(lower)) dir = "top";
    else if (/\b(?:bottom|last|end|aakhri)\b/i.test(lower)) dir = "bottom";
    return { type: "SCROLL", direction: dir };
  }

  // 3a-2. PHASE 2 ELEMENT INTERACTIONS (HOVER, DOUBLE CLICK, RIGHT CLICK, FOCUS, CLEAR FIELD, DRAG & DROP, ORDINAL ITEMS)
  const hoverMatch =
    lower.match(/^hover\s+(?:over|on)\s+(?:the\s+)?(.+?)[.!?\s]*$/i) ||
    lower.match(/^(.+?)\s+(?:par|pe|pr)\s+hover\s*(?:karo|kro|(?:kar|kr)\s*do)?[.!?\s]*$/i);
  if (hoverMatch) {
    const t = (hoverMatch[1] || hoverMatch[2] || "").trim();
    if (t) return { type: "HOVER", target: t };
  }

  const dblClickMatch =
    lower.match(/^double[\s-]*click\s+(?:on\s+)?(?:the\s+)?(.+?)[.!?\s]*$/i) ||
    lower.match(/^(.+?)\s+(?:par|pe|pr)\s+double[\s-]*click\s*(?:karo|kro|(?:kar|kr)\s*do)?[.!?\s]*$/i);
  if (dblClickMatch) {
    const t = (dblClickMatch[1] || dblClickMatch[2] || "").trim();
    if (t) return { type: "DOUBLE_CLICK", target: t };
  }

  const rightClickMatch =
    lower.match(/^right[\s-]*click\s+(?:on\s+)?(?:the\s+)?(.+?)[.!?\s]*$/i) ||
    lower.match(/^(.+?)\s+(?:par|pe|pr)\s+right[\s-]*click\s*(?:karo|kro|(?:kar|kr)\s*do)?[.!?\s]*$/i);
  if (rightClickMatch) {
    const t = (rightClickMatch[1] || rightClickMatch[2] || "").trim();
    if (t) return { type: "RIGHT_CLICK", target: t };
  }

  const focusMatch =
    lower.match(/^focus\s+(?:on\s+)?(?:the\s+)?(.+?)[.!?\s]*$/i) ||
    lower.match(/^(.+?)\s+(?:par|pe|pr)\s+focus\s*(?:karo|kro|(?:kar|kr)\s*do)?[.!?\s]*$/i);
  if (focusMatch) {
    const t = (focusMatch[1] || focusMatch[2] || "").trim();
    if (t) return { type: "FOCUS", target: t };
  }

  const clearFieldMatch =
    lower.match(/^clear\s+(?:the\s+)?(.+?)\s+(?:field|box|input|textbox)[.!?\s]*$/i) ||
    lower.match(/^(.+?)\s+(?:field|box|input|textbox)\s+(?:clear|saaf|khali)\s*(?:karo|kro|(?:kar|kr)\s*do)?[.!?\s]*$/i) ||
    lower.match(/^clear\s+(?:the\s+)?(name|email|phone|mobile|address|search|city|state|pincode)\s*(?:field)?[.!?\s]*$/i);
  if (clearFieldMatch) {
    const t = (clearFieldMatch[1] || "").trim();
    if (t) return { type: "CLEAR_FIELD", target: normalizeFillTarget(t) || t };
  }

  const dragMatch =
    normStripped.match(/^drag\s+(?:the\s+)?(.+?)\s+(?:to|onto|into)\s+(?:the\s+)?(.+?)[.!?\s]*$/i) ||
    normStripped.match(/^(.+?)\s+ko\s+(.+?)\s+(?:mein|me|par|pe|pr)\s+drag\s*(?:karo|kro|(?:kar|kr)\s*do)?[.!?\s]*$/i);
  if (dragMatch?.[1] && dragMatch?.[2]) {
    return { type: "DRAG_AND_DROP", source: dragMatch[1].trim(), target: dragMatch[2].trim() };
  }

  const ordinalItemMatch =
    lower.match(/^(?:open|click(?:\s+on)?|select)\s+(?:the\s+)?(1st|2nd|3rd|4th|5th|first|second|third|fourth|fifth|last)\s+(product|listing|item|result|card|row|order)[.!?\s]*$/i) ||
    lower.match(/^(pehl[aei]|doosr[aei]|dusr[aei]|teesr[aei]|tisr[aei]|chauth[aei]|aakhri)\s+(product|listing|item|result|card|row|order)\s+(?:par\s+click\s*(?:karo|kro|(?:kar|kr)\s*do)?|kholo|open\s*(?:karo|kro)?|select\s*(?:karo|kro)?)[.!?\s]*$/i);
  if (ordinalItemMatch) {
    const ordToken = ordinalItemMatch[1].toLowerCase();
    const kind = ordinalItemMatch[2].toLowerCase();
    const ordMap = {
      "1st": 1, first: 1, pehla: 1, pehli: 1, pehle: 1,
      "2nd": 2, second: 2, doosra: 2, doosri: 2, doosre: 2, dusra: 2, dusri: 2, dusre: 2,
      "3rd": 3, third: 3, teesra: 3, teesri: 3, teesre: 3, tisra: 3, tisri: 3, tisre: 3,
      "4th": 4, fourth: 4, chautha: 4, chauthi: 4, chauthe: 4,
      "5th": 5, fifth: 5,
      last: -1, aakhri: -1,
    };
    const isOpen = /\b(?:open|kholo)\b/i.test(lower);
    return {
      type: "ORDINAL_ITEM",
      index: ordMap[ordToken] ?? 1,
      targetKind: kind,
      openAction: isOpen,
    };
  }

  // 3b. NEXT FORM FIELD / FORM INSPECT ("Ab next field mein kya bharna hai?", "Yahan kya fill karna hai?")
  if (
    /^(?:ab\s+)?(?:next|agla|agle)\s+(?:field|box|input)\s+(?:mein|me|main)?\s*(?:kya\s+)?(?:bharna|fill\s+karna|daalna|likhna|hai)?\s*(?:hai)?[.!?\s]*$/i.test(
      lower,
    ) ||
    /^(?:ab\s+)?(?:aage|next)\s+kya\s+(?:bharna|fill\s+karna|daalna|likhna)\s*(?:hai)?[.!?\s]*$/i.test(
      lower,
    )
  ) {
    return { type: "NEXT_FORM_FIELD" };
  }

  if (
    /(?:yahan|yaha|yha|is\s+page\s+(?:par|pe|pr)|is\s+form\s+(?:mein|me|main)|form\s+(?:mein|me|main)|here)\s+kya\s+(?:fill|bharna|bhar|daalna|enter|likhna|details|info|information)\s*(?:karna\s+(?:h|hai|he)|h|hai|he|chahiye)?/i.test(
      lower,
    ) ||
    /(?:what\s+(?:information|info|details|fields)\s+(?:does\s+this\s+form\s+require|do\s+i\s+need\s+to\s+fill|should\s+i\s+fill|are\s+required)|which\s+fields\s+(?:are\s+required|to\s+fill)|is\s+form\s+ke\s+liye\s+kya\s+(?:chahiye|details\s+chahiye))/i.test(
      lower,
    )
  ) {
    return { type: "FORM_INSPECT" };
  }

  // 3b-2. WEB SEARCH & OPEN EXTERNAL WEBSITE ("Google par HGH injections search karo", "Google par search karna hai")
  const hasExplicitInPage = /\b(?:is\s+page\s+(?:par|pe|pr|mein|me|main)|page\s+(?:par|pe|pr|mein|me|main)|on\s+this\s+page|in\s+this\s+page)\b/i.test(
    lower,
  );
  if (!hasExplicitInPage) {
    // Incomplete external search command missing a query ("Bhai Google par search karna hai" / "Google par search karo")
    if (
      /^(?:mujhe\s+)?(?:google|web|internet)\s+(?:par|pe|pr|mein|me|on)\s+(?:kuch\s+|kch\s+|something\s+)?search\s*(?:karna\s+(?:hai|he)|karo|kar\s+do|karein)?[.!?\s]*$/i.test(
        lower,
      ) ||
      /^search\s+(?:on|in)\s+google[.!?\s]*$/i.test(lower)
    ) {
      return { type: "SEARCH_NEED_QUERY", engine: "google" };
    }

    const googleWebSearchMatch =
      normStripped.match(
        /^(?:google|web|internet)\s+(?:par|pe|pr|mein|me|on)\s+(.+?)\s+(?:search|find|dhoondho|dhundo)\s*(?:karo|kar\s+do|karna\s+(?:hai|he)|karein)?[.!?\s]*$/i,
      ) ||
      normStripped.match(
        /^(.+?)\s+(?:google|web|internet)\s+(?:par|pe|pr|mein|me|on)\s+(?:search|find|dhoondho|dhundo)\s*(?:karo|kar\s+do|karna\s+(?:hai|he))?[.!?\s]*$/i,
      ) ||
      normStripped.match(
        /^(?:search\s+(?:for|about)\s+)(.+?\b(?:website|site|portal|official\s+page|official\s+site)\b.*?)[.!?\s]*$/i,
      ) ||
      normStripped.match(
        /^(.+?\b(?:website|site|portal)\b)\s+(?:search\s*(?:karo|kar\s+do)|dhoondho|dhundo)[.!?\s]*$/i,
      );
    if (googleWebSearchMatch?.[1]) {
      const cleanedWebQ = googleWebSearchMatch[1]
        .replace(/^(?:mujhe|for|about|ke\s+baare\s+mein)\s+/i, "")
        .replace(/\s+(?:ke\s+baare\s+mein|ka|ki|ke|for|about)$/i, "")
        .trim();
      if (cleanedWebQ && !/^(?:kuch|something|kya)$/i.test(cleanedWebQ)) {
        return { type: "WEB_SEARCH", query: cleanedWebQ };
      }
      return { type: "SEARCH_NEED_QUERY", engine: "google" };
    }

    // Retry last failed/unresponsive click or try alternate way
    if (
      /^(?:(?:doosre|dusre|alternate|other|try\s+another)\s+(?:method|tareeke|way)(?:\s+se\s+(?:try|click)\s*(?:karo|kar\s+do)?)?|(?:phir\s+se|dobara|again)\s+(?:click|try)\s*(?:karo|kar\s+do)?|try\s+alternate\s+click)[.!?\s]*$/i.test(
        lower,
      )
    ) {
      if (ctx?.lastExecutionAttempt) {
        return { type: "RETRY_LAST_CLICK", attempt: ctx.lastExecutionAttempt };
      }
      if (ctx?.session?.lastTargetRef?.label || ctx?.session?.lastTargetSelector) {
        return {
          type: "RETRY_LAST_CLICK",
          attempt: {
            action: "click",
            target: ctx.session.lastTargetRef?.label || "__CURRENT__",
            selector: ctx.session.lastTargetRef?.selector || ctx.session.lastTargetSelector,
          },
        };
      }
    }

    const openWebsiteMatch =
      normStripped.match(/^(?:open|visit|go\s+to)\s+(?:the\s+)?(.+?\b(?:website|site|portal|dashboard|hub|panel)\b.*?)[.!?\s]*$/i) ||
      normStripped.match(/^(.+?\b(?:website|site|portal|dashboard|hub|panel)\b)\s+(?:open\s*(?:karo|kar\s+do)?|kholo|khol\s+do|dikhao)[.!?\s]*$/i) ||
      normStripped.match(/^(?:(?:open|visit|go\s+to)\s+)?(google(?:\s+(?:sheets|docs|drive))?|youtube|amazon(?:\s+seller)?|flipkart(?:\s+seller(?:\s+hub)?)?|meesho(?:\s+(?:seller|supplier(?:\s+panel)?))?|uidai|myaadhaar|aadhaar|digilocker|irctc|gst(?:\s+portal)?|income\s*tax|parivahan|github|wikipedia)\s*(?:kholo|khol\s+do|open\s*(?:karo|kar\s+do)?)?[.!?\s]*$/i);
    const hasPortalName = /\b(?:google(?:\s+(?:sheets|docs|drive))?|youtube|amazon|flipkart|meesho|seller|uidai|myaadhaar|aadhaar|aadhar|digilocker|irctc|gst|income\s*tax|efiling|itr|parivahan|github|wikipedia)\b/i.test(lower);
    const isLocalUiTarget = /\b(?:tab|button|link|menu|drawer|modal|popup)\b/i.test(lower);
    if (
      openWebsiteMatch?.[1] &&
      !isLocalUiTarget &&
      (!/\bdashboard\b/i.test(lower) || hasPortalName)
    ) {
      return { type: "OPEN_WEBSITE", query: openWebsiteMatch[1].trim() };
    }
  }

  // 3b-3. FILE DOWNLOAD ("download kar do", "invoice download karo", "https://...pdf download karo")
  const directDownloadUrlMatch = stripped.match(/(https?:\/\/[^\s"'<>]+)/i);
  if (/\b(?:download|save\s+file|export\s+(?:pdf|csv|xlsx|report))\b/i.test(lower)) {
    if (directDownloadUrlMatch?.[1]) {
      return { type: "DOWNLOAD", url: directDownloadUrlMatch[1] };
    }
    const dlClean = stripped
      .replace(/^(?:download|save|export)\s+(?:the\s+|this\s+)?/i, "")
      .replace(/\s+(?:download|save|export)\s*(?:karo|kro|(?:kar|kr)\s*do|karein|file)?[.!?\s]*$/i, "")
      .replace(/\s+(?:file|pdf|document|doc|report|label|invoice)$/i, (m) => m)
      .trim();
    return {
      type: "DOWNLOAD",
      target: dlClean && !/^(?:this|it|ye|yeh|file)$/i.test(dlClean) ? dlClean : "download",
    };
  }

  // 3c. IN-PAGE EXPLICIT SEARCH ("122 search karo is page par", "is page par pension search kr do")
  if (!/\b(?:fill|type|likh|likho|daal|daalo|bhar|bharo|enter|click|press|dabao|open|kholo)\b/i.test(lower)) {
    const inPageSearchMatch =
      lower.match(
        /^(?:is\s+page\s+(?:par|pe|pr|mein|me|main)|page\s+(?:par|pe|pr|mein|me|main)|yahan|yaha|yha|on\s+this\s+page|in\s+this\s+page)\s+(.+?)\s+(?:search|find|locate|dhoondho|dhundo)\s*(?:karo|kro|(?:kar|kr)\s*do|karein)?[.!?\s]*$/i,
      ) ||
      lower.match(
        /^(.+?)\s+(?:search|find|locate|dhoondho|dhundo)\s*(?:karo|kro|(?:kar|kr)\s*do|karein)?\s+(?:is\s+page\s+(?:par|pe|pr|mein|me|main)|page\s+(?:par|pe|pr|mein|me|main)|yahan|yaha|yha|on\s+this\s+page|in\s+this\s+page|here)[.!?\s]*$/i,
      ) ||
      lower.match(
        /^(?:search|find|locate)\s+["']?(.+?)["']?\s+(?:on\s+this\s+page|in\s+this\s+page|here|is\s+page\s+(?:par|pe|pr|mein|me))[.!?\s]*$/i,
      );
    if (inPageSearchMatch?.[1]) {
      const cleanQ = inPageSearchMatch[1]
        .replace(/^(?:the|a|an|ye|yeh)\s+/i, "")
        .trim();
      if (cleanQ) {
        return { type: "FIND", target: cleanQ, inPageOnly: true };
      }
    }
  }

  // 4. EXTRACT / SEARCH DATA (check early for "search karke ... nikaalo")
  if (
    /(?:search|dhoondh|dhundh)\s+karke.*(?:nikaalo|nikalo|lao|batao|copy)/i.test(lower) ||
    /^(?:extract|copy|nikaalo|nikalo)\s+(?:the\s+)?(?:order(?:\s*id)?s?|table|data|details|info|information)/i.test(
      lower,
    ) ||
    /(?:order(?:\s*id)?s?|table|data|details|information)\s+(?:nikaalo|nikalo|copy\s+(?:karo|kro|(?:kar|kr)\s*do)|extract\s+(?:karo|kro|(?:kar|kr)\s*do))/i.test(
      lower,
    )
  ) {
    let target = stripped
      .replace(/^(?:search\s+karke|extract|copy|dhoondh\s+ke|dhundh\s+ke)\s+/i, "")
      .replace(/\s+(?:nikaalo|nikalo|lao|batao|copy\s+(?:karo|kro)|extract\s+(?:karo|kro))$/i, "")
      .trim();
    return { type: "EXTRACT", target: target || "data" };
  }

  // 5. DOCUMENT-BACKED OR EXPLICIT FILL DETAILS CHECK
  const isDocBackedFill =
    /(?:aadhaar|aadhar|pan\s+card|pan\s+details|uploaded\s+(?:id|document|doc|file|pdf|image)|document\s+(?:se|details|info)|id\s+(?:se|details))/i.test(
      lower,
    ) && /\b(?:fill|type|likh|likho|daal|daalo|bhar|bharo|enter|(?:kar|kr)\s*do|(?:kar|kr)o)\b/i.test(lower);

  const isFieldFromDoc =
    /(?:is\s+field\s+(?:mein|me|main)|isko|this\s+field)\s+.*?(?:aadhaar|aadhar|pan|dob|address|pincode|name)\s*(?:number|no)?\s*(?:daal|daalo|fill|likho|enter)/i.test(
      lower,
    );

  if (
    (isDocBackedFill || isFieldFromDoc) &&
    !/\b(?:open|click|press|dabao|kholo)\b/i.test(lower)
  ) {
    const reqKeys = extractRequestedDocFieldKeys(lower);
    return {
      type: "FORM_FILL",
      useUploadedDocument: true,
      targetCurrentBox: isFieldFromDoc,
      requestedDocKeys: reqKeys.length > 0 ? reqKeys : null,
      overwrite: /\b(?:change|update|replace|overwrite|badal|badlo)\b/i.test(lower),
      explicitUserProvided: true,
    };
  }

  const fillDetails = extractFillDetails(stripped);
  const isWholeFormTrigger =
    /(?:form\s+(?:fill|bhar|bharo)|fill\s+(?:the\s+|this\s+|is\s+page\s+ka\s+)?form|is\s+page\s+ka\s+form\s+(?:fill|bhar)|auto\s*fill|fill\s+(?:all\s+)?(?:inputs|fields)|form\s+bhar\s+do|is\s+form\s+ko\s+bharo)/i.test(
      lower,
    );
  const hasSingleFillVerb =
    /\b(?:fill|type|likh|likho|daal|daalo|bhar|bharo|enter)\b/i.test(lower) &&
    !/\b(?:click|press|dabao|scroll|point|highlight|find|kholo)\b/i.test(lower);

  if (fillDetails.explicitPairs && (hasSingleFillVerb || fillDetails.hasPositionalOrKnownAssign)) {
    const targets = fillDetails.explicitPairs.map((p) => String(p.target || "").toLowerCase());
    const noSubmitPrompt =
      Boolean(fillDetails.hasExplicitNoSubmit) ||
      (fillDetails.explicitPairs.length === 1 &&
        targets.every((t) => t === "__current__" || /\b(?:search|chat|msg|message|comment|prompt|query)\b/.test(t)));
    return {
      type: "FORM_FILL",
      fields: fillDetails.fields,
      explicitPairs: fillDetails.explicitPairs,
      overwrite: fillDetails.overwrite,
      explicitUserProvided: fillDetails.explicitUserProvided,
      fromChatCommand: true,
      noSubmitPrompt,
    };
  }

  // 5b. FILL / WRITE INTENT MISSING VALUE ("Buddy, ye fill karo", "buddy isme kch likh do", "isme daal do", "ye wala bhar do")
  if (
    !fillDetails.explicitPairs &&
    !isWholeFormTrigger &&
    hasSingleFillVerb &&
    !/\b(?:aur|and|then|phir|fir|,)\b/i.test(lower)
  ) {
    let targetField = "__CURRENT__";
    const fieldMention = lower.match(
      /^(?:(?:ab|please)\s+)?(.+?)\s+(?:mein|me|main|par|pe|pr|ko)\s+(?:kuch\s+|something\s+)?(?:fill|type|likh|likho|daal|daalo|bhar|bharo|enter)/i,
    );
    if (fieldMention?.[1]) {
      const candT = fieldMention[1].trim();
      if (/^(?:is|ye|yeh|isko|isme|is\s*box|this|this\s*box|this\s*field|yahan|yaha|yha|ye\s+wala)$/i.test(candT)) {
        targetField = ctx?.session?.lastTargetField || "__CURRENT__";
      } else {
        targetField = normalizeFillTarget(candT) || "__CURRENT__";
      }
    } else if (/\b(?:isme|isko|ye|yeh|ye\s+wala|this|it)\b/i.test(lower)) {
      targetField = ctx?.session?.lastTargetField || "__CURRENT__";
    }
    const verb = /\b(?:likh|likho|type)\b/i.test(lower) ? "write" : "fill";
    return {
      type: "FILL_NEED_VALUE",
      targetField,
      verb,
      noSubmitPrompt: /\b(?:search|chat|msg|message|comment|prompt|query)\b/.test(String(targetField)),
    };
  }

  // 6. MULTI-STEP TASK
  const hasStepDelimiters =
    /(?:,\s*(?:aur|then|and then|uske baad|phir|fir)\s*|\s+(?:aur|then|and then|uske baad|phir|fir)\s+|;\s*|,\s+)/i.test(
      lower,
    );
  const actionVerbs =
    lower.match(
      /\b(?:open|click|press|dabao|fill|type|likh|likho|daal|daalo|bhar|bharo|find|point|highlight|dhundo|dhoondho|extract|copy|search|kholo|scroll|select|check|uncheck|tick)\b/gi,
    ) || [];

  if (
    (hasStepDelimiters && actionVerbs.length >= 2) ||
    (/^pehle\b.+\b(?:phir|fir|uske baad|then)\b/i.test(lower) && actionVerbs.length >= 1)
  ) {
    if (
      /\b(?:fill|type|likh|daal|bhar)\b/i.test(lower) &&
      !/\b(?:open|click|press|dabao|kholo|scroll|find|point|extract|copy)\b/i.test(lower)
    ) {
      if (fillDetails.explicitPairs) {
        return {
          type: "FORM_FILL",
          fields: fillDetails.fields,
          explicitPairs: fillDetails.explicitPairs,
          overwrite: fillDetails.overwrite,
          explicitUserProvided: fillDetails.explicitUserProvided,
          fromChatCommand: true,
        };
      }
      const segs = lower
        .split(/\s*(?:,|;|\bphir\b|\bfir\b|\bthen\b|\band then\b|\buske baad\b)\s*/i)
        .map((s) =>
          s
            .replace(/^(?:pehle|first|aur|and|next)\s+/i, "")
            .replace(/\s+(?:fill\s+(?:(?:kar|kr)\s*do|(?:kar|kr)o)|fill|type\s+(?:karo|kro)|bharo|bhar\s*do|likho|daalo)[.!?\s]*$/i, "")
            .trim(),
        )
        .filter((s) => s.length > 0);
      if (segs.length >= 1) {
        return { type: "FORM_FILL", fields: null, requestedFieldNames: segs };
      }
    }
    return { type: "MULTI_STEP", instruction: stripped };
  }

  // 7. FORM FILL (explicit key-value or general form fill trigger)
  if (
    isWholeFormTrigger &&
    !fillDetails.explicitPairs &&
    !/\b(?:saved|profile|document|doc|aadhaar|aadhar|pan)\b/i.test(lower) &&
    /\busing\s+(?:the\s+)?(?:info|information|details|data)\s+i\s+(?:provide|give|share|send)\b/i.test(lower)
  ) {
    return { type: "FORM_INSPECT" };
  }
  if (isWholeFormTrigger || fillDetails.explicitPairs) {
    return {
      type: "FORM_FILL",
      fields: fillDetails.fields,
      explicitPairs: fillDetails.explicitPairs,
      overwrite: fillDetails.overwrite,
      explicitUserProvided: fillDetails.explicitUserProvided,
      fromChatCommand: true,
      noSubmitPrompt: Boolean(fillDetails.hasExplicitNoSubmit),
      useUploadedDocument: Boolean(activeUploadedDocument && !fillDetails.explicitPairs),
    };
  }

  // 7b. PARTIAL CONVERSATIONAL FIELD / CUSTOM DROPDOWN UPDATE ("change the product color to black", "product color ko black kar do")
  const partialChangeMatch =
    normStripped.match(/^(?:change|update|set|modify)\s+(?:the\s+)?(.+?)\s+(?:to|as)\s+["']?(.+?)["']?[.!?\s]*$/i) ||
    normStripped.match(/^(.+?)\s+(?:ko|ka)\s+["']?(.+?)["']?\s+(?:badal|change|update|set)\s*(?:karo|kro|(?:kar|kr)\s*do)?[.!?\s]*$/i);
  if (partialChangeMatch?.[1] && partialChangeMatch?.[2] && !/\b(?:tab|page|buddy|language|mode)\b/i.test(partialChangeMatch[1])) {
    const pf = normalizeFillTarget(partialChangeMatch[1]) || partialChangeMatch[1].trim();
    const pv = partialChangeMatch[2].trim();
    if (pf && pv && !isNonValuePlaceholder(pv)) {
      return { type: "PARTIAL_UPDATE", targetField: pf, value: pv };
    }
  }

  // 8. SELECT / DROPDOWN COMMAND
  const selectMatch =
    lower.match(/^(?:select|choose|chuno)\s+["']?(.+?)["']?\s+(?:in|from|mein|me|main)\s+(?:the\s+)?(.+?)(?:\s+dropdown|\s+select)?[.!?\s]*$/i) ||
    lower.match(/^(.+?)\s+(?:dropdown\s+)?(?:mein|me|main|par|pe|pr)\s+["']?(.+?)["']?\s+(?:select|choose|chuno)\s*(?:karo|kro|(?:kar|kr)\s*do)?[.!?\s]*$/i);
  if (selectMatch) {
    const isFirstPattern = /^(?:select|choose|chuno)\b/i.test(lower);
    const val = (isFirstPattern ? selectMatch[1] : selectMatch[2]).trim();
    const targetField = normalizeFillTarget(isFirstPattern ? selectMatch[2] : selectMatch[1]);
    if (val) {
      return { type: "SELECT", targetField, value: val };
    }
  }
  const simpleSelectMatch = lower.match(/^(.+?)\s+(?:select\s+(?:karo|kro|(?:kar|kr)\s*do)|choose\s+(?:karo|kro)|chuno)[.!?\s]*$/i);
  if (simpleSelectMatch && !/\bradio\b/i.test(lower)) {
    const words = simpleSelectMatch[1].trim().split(/\s+/);
    if (words.length >= 2) {
      return {
        type: "SELECT",
        targetField: normalizeFillTarget(words[0]),
        value: words.slice(1).join(" "),
      };
    }
    return { type: "SELECT", targetField: "", value: simpleSelectMatch[1].trim() };
  }
  const leadingSelectMatch = lower.match(/^(?:select|choose|chuno)\s+(?:the\s+)?["']?(.+?)["']?(?:\s+option)?[.!?\s]*$/i);
  if (leadingSelectMatch && !/\bradio\b/i.test(lower)) {
    const optVal = leadingSelectMatch[1].trim();
    if (optVal) {
      return { type: "SELECT", targetField: "", value: optVal };
    }
  }

  // 8b. DIRECT URL NAVIGATION ("Open https://example.com", "https://example.com kholo", "go to www.google.com")
  const urlNavMatch = stripped.match(/(https?:\/\/[^\s"'<>]+|www\.[^\s"'<>]+\.[a-z]{2,})/i);
  if (
    urlNavMatch &&
    (/\b(?:open|go\s+to|navigate|visit|kholo|khol\s+do|jao|le\s+jao)\b/i.test(lower) ||
      lower.replace(urlNavMatch[0].toLowerCase(), "").trim().length === 0) &&
    !/\b(?:fill|type|find|point|click|extract|copy)\b/i.test(lower)
  ) {
    const rawUrl = urlNavMatch[1];
    const fullUrl = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
    return { type: "NAVIGATE", url: fullUrl };
  }

  // 9. CHECKBOX / RADIO COMMAND
  const uncheckMatch =
    lower.match(/^(.+?)\s+(?:checkbox\s+)?(?:uncheck|untick)\s*(?:karo|kro|(?:kar|kr)\s*do)?[.!?\s]*$/i) ||
    lower.match(/^(?:uncheck|untick)\s+(?:the\s+)?(.+?)(?:\s+checkbox)?[.!?\s]*$/i);
  if (uncheckMatch) {
    return { type: "CHECK", target: normalizeFillTarget(uncheckMatch[1]), checked: false };
  }
  const checkMatch =
    lower.match(/^(.+?)\s+(?:checkbox\s+)?(?:check|tick)\s*(?:karo|kro|(?:kar|kr)\s*do)?[.!?\s]*$/i) ||
    lower.match(/^(?:check|tick)\s+(?:the\s+)?(.+?)(?:\s+checkbox)?[.!?\s]*$/i);
  if (checkMatch) {
    return { type: "CHECK", target: normalizeFillTarget(checkMatch[1]), checked: true };
  }

  // 10. POINT / HIGHLIGHT ACTION (STRICT: NEVER CLICKS)
  const findAndPointMatch = lower.match(
    /^(?:find|locate|search(?:\s+for)?|dhoondho|dhundo|show\s+me)\s+(?:the\s+)?(.+?)(?:\s+and|\s+aur|,)?\s+(?:point\s*(?:to\s+it|at\s+it|on\s+it|karo|kro|(?:kar|kr)\s*do)?|highlight\s*(?:it|karo|kro|(?:kar|kr)\s*do)?)[.!?\s]*$/i,
  );
  const pointTrailingMatch = lower.match(
    /(.+?)\s+(?:(?:par|pe|pr|ko)\s+)?(?:point\s*(?:karo|kro|(?:kar|kr)\s*do|kijiye)?|highlight\s*(?:karo|kro|(?:kar|kr)\s*do|kijiye)?)[.!?\s]*$/i,
  );
  const pointLeadingMatch = lower.match(
    /^(?:point\s+(?:to|at|on)|highlight)\s+(?:the\s+)?(.+?)[.!?\s]*$/i,
  );
  if (findAndPointMatch || pointTrailingMatch || pointLeadingMatch) {
    const raw = findAndPointMatch
      ? findAndPointMatch[1]
      : pointTrailingMatch
        ? pointTrailingMatch[1]
        : pointLeadingMatch[1];
    const cleanNoPunct = raw.replace(/[.!?\s]+$/, "").trim();
    const withoutPrefix = cleanNoPunct
      .replace(/^(?:(?:ab|now|phir|fir|then|yha|yaha|yahan)\s+)?(?:is\s+page\s+(?:par|pe|pr|se)|page\s+(?:par|pe|pr|se)|ye|yeh|wo|woh|is|this|the|a|an|kripya|please)\s+/i, "")
      .replace(/^(?:ab|now|phir|fir)\s+/i, "")
      .trim();
    const clean = /^search\s+(?:box|field|input)$/i.test(withoutPrefix)
      ? withoutPrefix
      : withoutPrefix.replace(/\s+(?:button|tab|link|icon|menu|bar|option|field|input|box)$/i, "").trim();
    if (clean.length > 0) {
      return { type: "POINT", target: clean };
    }
  }

  // 10b. STANDALONE SUBMIT COMMAND ("Submit karo", "Submit kr do", "Form submit karo")
  if (/^(?:(?:ab|now|phir|fir)\s+)?(?:(?:is|the|this)\s+)?(?:form\s+)?submit\s*(?:karo|kro|(?:kar|kr)\s*do|kijiye|kar\s+dein)?[.!?\s]*$/i.test(lower)) {
    return { type: "CLICK", target: "submit", isConsequential: true };
  }

  // 11. CLICK / PRESS / TAP / FOLLOW-UP OPEN ACTION (supports "ab click karo", "ab kholo", "open it", "Login pr click kr do")
  if (
    /^(?:(?:ab|now|phir|fir|then|yahan|yaha|yha|here|isko|this|it|is\s+(?:par|pe|pr|ko)|us\s+(?:par|pe|pr|ko))\s+)?(?:(?:par|pe|pr|ko)\s+)?(?:click\s*(?:karo|kro|(?:kar|kr)\s*do|kijiye|do)?|press\s*(?:karo|kro|(?:kar|kr)\s*do)|tap\s*(?:karo|kro|(?:kar|kr)\s*do)|dabao|daba\s*do|open\s*(?:karo|kro|(?:kar|kr)\s*do|it)?|kholo|khol\s*do)(?:\s+(?:karo|kro|(?:kar|kr)\s*do))?[.!?\s]*$/i.test(
      lower,
    )
  ) {
    if (ctx?.pendingDisambiguation?.candidates?.length > 0) {
      return { type: "DISAMBIGUATION_CLARIFY" };
    }
    return { type: "CLICK", target: "__CURRENT__", isConsequential: false };
  }

  const clickTrailingMatch = lower.match(
    /(.+?)\s+(?:par\s+click\s*(?:karo|kro|(?:kar|kr)\s*do)?|pe\s+click\s*(?:karo|kro|(?:kar|kr)\s*do)?|pr\s+click\s*(?:karo|kro|(?:kar|kr)\s*do)?|ko\s+click\s*(?:karo|kro|(?:kar|kr)\s*do)?|click\s+karo|click\s+kro|click\s+(?:kar|kr)\s*do|click\s+kijiye|click\s+do|dabao|daba\s+do|press\s+(?:karo|kro|(?:kar|kr)\s*do|kijiye)|tap\s+(?:karo|kro|(?:kar|kr)\s*do)|khol\s+do|kholo|open\s+(?:karo|kro|(?:kar|kr)\s*do)|select\s+(?:karo|kro|(?:kar|kr)\s*do))[.!?\s]*$/i,
  );
  const clickLeadingMatch = lower.match(
    /^(?:(?:ab|now|phir|fir)\s+)?(?:click|press|tap|dabao|open|kholo)\s+(?:on\s+)?(?:the\s+)?(.+)[.!?\s]*$/i,
  );

  if (
    (clickTrailingMatch || clickLeadingMatch) &&
    !lower.includes("how to") &&
    !lower.includes("kaise") &&
    !lower.includes("explain") &&
    !lower.includes("kaha") &&
    !lower.includes("where")
  ) {
    let raw = clickTrailingMatch ? clickTrailingMatch[1] : clickLeadingMatch[1];
    raw = raw.replace(/^(?:ab|now|phir|fir|then)\s+/i, "").trim();
    if (/^(?:yahan|yaha|yha|here|isko|this|is\s+par|is\s+pe|is\s+pr|us\s+par)$/i.test(raw)) {
      return { type: "CLICK", target: "__CURRENT__", isConsequential: false };
    }
    let clean = raw
      .replace(/^(?:is\s+page\s+(?:par|pe|pr|se)|page\s+(?:par|pe|pr|se)|ye|yeh|wo|woh|the|a|an|kripya|please|jaldi)\s+/i, "")
      .replace(/\s+(?:button|btn|tab|link|icon|menu|bar|option|radio|checkbox)$/i, "")
      .trim();

    if (clean.length > 0) {
      const isConsequential =
        /purchase|buy|pay|delete|remove account|confirm payment|place\s*order|checkout|confirm\s*order|\bsubmit\b|file\s*return|transfer\s*money|send\s*money/i.test(
          clean,
        );
      return { type: "CLICK", target: clean, isConsequential };
    }
  }

  // 12. SEARCH BOX SUBMIT vs ELEMENT LOCATE ("Delhi search karo" vs "Orders tab kahan hai")
  const searchSubmitTrailing = normStripped.match(
    /^(.+?)\s+search\s+(?:karo|kar\s+do|karein|do)[.!?\s]*$/i,
  );
  const searchSubmitLeading = normStripped.match(
    /^search\s+["']?([^"'\n]+?)["']?[.!?\s]*$/i,
  );
  if (
    (searchSubmitTrailing || searchSubmitLeading) &&
    !/\b(?:button|btn|tab|link|icon|menu|bar|field|input|box|website|site|portal|form|kahan|where|how to|kaise|explain)\b/i.test(
      lower,
    )
  ) {
    const rawQ = (searchSubmitTrailing ? searchSubmitTrailing[1] : searchSubmitLeading[1])
      .replace(/^(?:the|a|an|for|about|search\s*box\s*mein|search\s*mein)\s+/i, "")
      .trim();
    if (rawQ) {
      return { type: "SEARCH_SUBMIT", target: "search", query: rawQ };
    }
  }

  // 12b. FIND / LOCATE ACTION (STRICT: NEVER CLICKS)
  const findTrailingMatch = lower.match(
    /(.+?)\s+(?:find\s*(?:karo|kro|(?:kar|kr)\s*do)|locate\s*(?:karo|kro|(?:kar|kr)\s*do)|search\s*(?:karo|kro|(?:kar|kr)\s*do)|dhoondho|dhundo|dhoondh\s+ke\s+dikhao|kaha(?:n)?\s+(?:hai|h|he)|kidhar\s+(?:hai|h|he)|kdr\s+(?:hai|h|he)|khaa\s+(?:hai|h|he)|kha\s+(?:hai|h|he|karna\s+h)|dikhao|batao)[.!?\s]*$/i,
  );
  const findLeadingMatch = lower.match(
    /^(?:find|locate|search(?:\s+for)?|where\s+is|where's|wheres|where\s+are|show\s+me|dhoondho|dhundo)\s+(?:the\s+)?(.+?)[.!?\s]*$/i,
  );

  if (
    (findTrailingMatch || findLeadingMatch) &&
    !lower.includes("form") &&
    !lower.includes("explain") &&
    !lower.includes("how to")
  ) {
    let raw = (findTrailingMatch ? findTrailingMatch[1] : findLeadingMatch[1]).replace(/[.!?\s]+$/, "").trim();
    let withoutPrefix = raw
      .replace(/^(?:(?:ab|now|phir|fir|yha|yaha|yahan)\s+)?(?:is\s+page\s+(?:par|pe|pr|se)|page\s+(?:par|pe|pr|se)|ye|yeh|wo|woh|the|a|an|kripya|please)\s+/i, "")
      .replace(/^(?:ab|now|phir|fir)\s+/i, "")
      .trim();
    let clean = /^search\s+(?:box|field|input)$/i.test(withoutPrefix)
      ? withoutPrefix
      : withoutPrefix.replace(/\s+(?:button|tab|link|icon|menu|bar|option|field|box)$/i, "").trim();

    if (clean.length > 0) {
      return { type: "FIND", target: clean };
    }
  }

  // 13. Default: GENERAL ASK / GEMINI INTERPRETATION
  return { type: "ASK" };
}

function resolveWebsiteDestination(query, forceSearchOnly = false) {
  const q = String(query || "").trim();
  const clean = q
    .replace(/\b(?:official|ki|ka|ke|website|site|portal|web|page|dashboard|hub)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const lower = clean.toLowerCase();
  if (!forceSearchOnly) {
    if (/\bflipkart\b/i.test(q) && /\b(?:seller|dashboard|hub|merchant)\b/i.test(q)) {
      return { url: "https://seller.flipkart.com", isSearch: false, label: "Flipkart Seller Hub" };
    }
    if (/\bamazon\b/i.test(q) && /\b(?:seller|dashboard|central|merchant)\b/i.test(q)) {
      return { url: "https://sellercentral.amazon.in", isSearch: false, label: "Amazon Seller Central" };
    }
    if (/^amazon$/i.test(lower)) {
      return {
        ambiguous: true,
        label: "Amazon",
        options: [
          { label: "Amazon India Shopping (amazon.in)", url: "https://www.amazon.in" },
          { label: "Amazon Seller Central (sellercentral.amazon.in)", url: "https://sellercentral.amazon.in" },
        ],
      };
    }
    if (/^flipkart$/i.test(lower)) {
      return {
        ambiguous: true,
        label: "Flipkart",
        options: [
          { label: "Flipkart Shopping (flipkart.com)", url: "https://www.flipkart.com" },
          { label: "Flipkart Seller Hub (seller.flipkart.com)", url: "https://seller.flipkart.com" },
        ],
      };
    }
    const KNOWN_PORTALS = [
      { re: /\b(?:amazon\s*seller|seller\s*central)\b/i, url: "https://sellercentral.amazon.in" },
      { re: /\b(?:flipkart\s*seller|seller\s*hub)\b/i, url: "https://seller.flipkart.com" },
      { re: /\bgoogle\s*sheets?\b/i, url: "https://docs.google.com/spreadsheets" },
      { re: /\bgoogle\s*docs?\b/i, url: "https://docs.google.com/document" },
      { re: /\bgoogle\s*drive\b/i, url: "https://drive.google.com" },
      { re: /\b(?:aadhaar|aadhar|uidai)\b/i, url: "https://uidai.gov.in" },
      { re: /\bmyaadhaar\b/i, url: "https://myaadhaar.uidai.gov.in" },
      { re: /\b(?:gst|gst\s*portal)\b/i, url: "https://www.gst.gov.in" },
      { re: /\b(?:income\s*tax|efiling|itr)\b/i, url: "https://www.incometax.gov.in" },
      { re: /\bdigilocker\b/i, url: "https://www.digilocker.gov.in" },
      { re: /\bparivahan\b/i, url: "https://parivahan.gov.in" },
      { re: /\birctc\b/i, url: "https://www.irctc.co.in" },
      { re: /\bflipkart\b/i, url: "https://www.flipkart.com" },
      { re: /\bamazon\b/i, url: "https://www.amazon.in" },
      { re: /\bmeesho\b/i, url: "https://supplier.meesho.com" },
      { re: /\byoutube\b/i, url: "https://www.youtube.com" },
      { re: /\bgoogle\b/i, url: "https://www.google.com" },
      { re: /\bwikipedia\b/i, url: "https://www.wikipedia.org" },
      { re: /\bgithub\b/i, url: "https://github.com" },
    ];
    for (const p of KNOWN_PORTALS) {
      if (p.re.test(lower)) return { url: p.url, isSearch: false, label: clean || q };
    }
  }
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(q)}`;
  return { url: searchUrl, isSearch: true, label: q };
}

async function executeNaturalBrowserAction(intent, trimmed) {
  const active = getActiveBuddy();
  const isHindi = active.defaultLanguage !== "english";
  const mutatingIntents = new Set([
    "NAVIGATE",
    "OPEN_WEBSITE",
    "WEB_SEARCH",
    "SEARCH_SUBMIT",
    "MULTI_STEP",
    "SELECT",
    "CHECK",
    "CLICK",
    "RETRY_LAST_CLICK",
    "DOWNLOAD",
    "FORM_FILL",
    "PARTIAL_UPDATE",
    "HOVER",
    "DOUBLE_CLICK",
    "RIGHT_CLICK",
    "CLEAR_FIELD",
    "DRAG_AND_DROP",
    "SCROLL_UNTIL_TEXT",
    "INFINITE_SCROLL",
    "PAGINATE",
    "UNDO_ACTION",
    "TAB_ACTION",
    "ORDINAL_ITEM",
    "RESUME_PLAN",
  ]);
  if (mutatingIntents.has(intent.type)) {
    const { permissionLevel } = await getPermissionSettings();
    if (permissionLevel === "observe" || permissionLevel === "explain") {
      appendHistory("user", trimmed);
      $("promptInput").value = "";
      if (permissionLevel === "explain" && (intent.target || intent.value)) {
        await executeFind(intent.target || intent.value, "point");
      }
      const blockedMsg = isHindi
        ? `🛡️ Settings mein abhi "${permissionLevel === "observe" ? "Level 1: Observe" : "Level 2: Explain"}" mode active hai, isliye main page par action execute nahi kar raha hoon. Actions chalane ke liye Settings tab mein Assist (Level 4) ya Execute (Level 5) select karein.`
        : `🛡️ Permission is set to "${permissionLevel === "observe" ? "Level 1: Observe" : "Level 2: Explain"}" in Settings, so page mutations are paused. Switch to Level 4: Assist or Level 5: Execute in Settings to allow actions.`;
      setRigEmotion("concerned", "Read-Only");
      $("statusText").textContent = blockedMsg;
      appendHistory("buddy", blockedMsg);
      return true;
    }
  }

  if (intent.type === "CANCEL_PENDING") {
    pendingSlot = null;
    pendingAction = null;
    pendingDisambiguation = null;
    activeFormSession = null;
    pendingAutoListenAfterSpeech = false;
    sessionTaskContext.lastActionProposal = null;
    if ($("confirmCard")) $("confirmCard").hidden = true;
    appendHistory("user", trimmed);
    $("promptInput").value = "";
    const cancelMsg = isHindi ? "Theek hai, pending action cancel kar diya." : "Okay, cancelled the pending action.";
    setRigEmotion("idle", "Cancelled");
    $("statusText").textContent = cancelMsg;
    appendHistory("buddy", cancelMsg);
    speakResponse(cancelMsg, "idle");
    return true;
  }

  if (intent.type === "CONFIRM_PENDING" && pendingAction) {
    appendHistory("user", trimmed);
    $("promptInput").value = "";
    $("confirmApproveBtn")?.click();
    return true;
  }

  if (intent.type === "EXECUTE_CONTEXT_PROPOSAL" && intent.proposal) {
    sessionTaskContext.lastActionProposal = null;
    return executeNaturalBrowserAction(intent.proposal, trimmed);
  }

  if (intent.type === "SELECT_CONTEXT_ITEM" && pendingDisambiguation?.candidates?.length) {
    const chosen = pendingDisambiguation.candidates[(intent.index || 1) - 1] || pendingDisambiguation.candidates[0];
    const disAction = pendingDisambiguation.action || "click";
    const disTarget = pendingDisambiguation.target;
    pendingDisambiguation = null;
    if (disAction === "open_url" && chosen.url) {
      return executeNaturalBrowserAction({ type: "NAVIGATE", url: chosen.url, label: chosen.text }, trimmed);
    }
    return executeNaturalBrowserAction(
      {
        type: "CLICK",
        action: disAction === "open_link" ? "open_link" : "click",
        target: chosen.text || disTarget,
        selector: chosen.selector,
        candidateIndex: intent.index || 1,
      },
      trimmed,
    );
  }

  if (intent.type === "DISAMBIGUATION_CLARIFY" && pendingDisambiguation?.candidates?.length) {
    appendHistory("user", trimmed);
    $("promptInput").value = "";
    const cands = pendingDisambiguation.candidates;
    const listText = cands.map((c) => `${c.index}. "${c.text}" (${c.tag})`).join("\n");
    const clarMsg = isHindi
      ? `🤔 Abhi ${cands.length} matching options hain — pehle option number (1-${cands.length}) batayein:\n${listText}`
      : `🤔 There are still ${cands.length} matching options — please choose 1-${cands.length} first:\n${listText}`;
    setRigEmotion("confused", "Choose Option");
    $("statusText").textContent = clarMsg;
    appendHistory("buddy", clarMsg);
    speakResponse(clarMsg, "confused");
    return true;
  }

  if (intent.type === "CLARIFY_AFFIRMATIVE") {
    appendHistory("user", trimmed);
    $("promptInput").value = "";
    const clarMsg = isHindi
      ? "Kya karna hai? Abhi koi pending action confirm karne ke liye nahi hai — kripya batayein kaunsa button click karna hai ya kya fill karna hai."
      : "There is no pending action to confirm right now. Please tell me which button to click or what you want to fill.";
    setRigEmotion("curious", "Clarify");
    $("statusText").textContent = clarMsg;
    appendHistory("buddy", clarMsg);
    speakResponse(clarMsg, "curious");
    return true;
  }

  if (intent.type === "SEARCH_NEED_QUERY") {
    appendHistory("user", trimmed);
    $("promptInput").value = "";
    pendingSlot = {
      type: "search_query",
      engine: intent.engine || "google",
    };
    const askSearchMsg = isHindi
      ? "Google par kya search karna hai? Topic ya keyword likhein ya bolein."
      : "What would you like me to search on Google?";
    setRigEmotion("curious", "Search Query?");
    $("statusText").textContent = askSearchMsg;
    appendHistory("buddy", askSearchMsg);
    recordConversationTurn(trimmed, askSearchMsg);
    speakResponse(askSearchMsg, "curious", {
      autoListenOnFinish: true,
      autoListenReason: "incomplete_search",
    });
    return true;
  }

  if (intent.type === "CORRECT_LAST_FILL") {
    appendHistory("user", trimmed);
    $("promptInput").value = "";
    const targetEntry =
      (intent.oldValue &&
        activeFormSession?.filledFields?.find((f) =>
          String(f.value || "").toLowerCase().includes(intent.oldValue.toLowerCase()),
        )) ||
      activeFormSession?.lastFilled ||
      (sessionTaskContext.lastTargetSelector || sessionTaskContext.lastTargetField
        ? {
            field: sessionTaskContext.lastTargetField || "__CURRENT__",
            selector: sessionTaskContext.lastTargetSelector || undefined,
          }
        : null);

    if (!targetEntry) {
      const noPrevMsg = isHindi
        ? "Abhi pichla filled field mila nahi. Kripya batayein kis field mein nayi value likhni hai."
        : "I couldn't identify the previous field to update. Please tell me which field should get the new value.";
      appendHistory("buddy", noPrevMsg);
      speakResponse(noPrevMsg, "curious");
      return true;
    }

    await startSmartFormFill(null, {
      explicitPairs: [
        {
          target: targetEntry.field || "__CURRENT__",
          selector: targetEntry.selector,
          value: intent.newValue,
          overwrite: true,
        },
      ],
      overwrite: true,
      explicitUserProvided: true,
      fromChatCommand: true,
      fromFormSession: Boolean(activeFormSession?.active),
      isCorrection: true,
    });
    return true;
  }

  if (intent.type === "MOVE_LAST_FILL") {
    appendHistory("user", trimmed);
    $("promptInput").value = "";
    await startSmartFormFill(null, {
      explicitPairs: [
        {
          target: intent.targetField,
          value: intent.value,
          overwrite: true,
        },
      ],
      clearSelector: intent.prevSelector,
      overwrite: true,
      explicitUserProvided: true,
      fromChatCommand: true,
      fromFormSession: Boolean(activeFormSession?.active),
      isCorrection: true,
    });
    return true;
  }

  if (intent.type === "NEXT_FORM_FIELD") {
    appendHistory("user", trimmed);
    $("promptInput").value = "";
    let nextField = activeFormSession?.remainingFields?.[0] || null;
    if (!nextField) {
      const snapRes = await sendRuntimeMessage({ type: "GET_PAGE_SNAPSHOT" });
      const forms = snapRes?.snapshot?.forms || [];
      const emptyFormFields = forms.filter(
        (f) => f.visible !== false && !f.disabled && !String(f.value || "").trim(),
      );
      if (emptyFormFields.length > 0) {
        const f = emptyFormFields[0];
        nextField = {
          index: 1,
          label: f.name || f.label || f.placeholder || f.id || "next field",
          selector: f.selector,
          name: f.name || f.id || "",
          type: f.type || f.tag || "text",
        };
        activeFormSession = {
          active: true,
          filledFields: activeFormSession?.filledFields || [],
          lastFilled: activeFormSession?.lastFilled || null,
          remainingFields: emptyFormFields.map((ef, i) => ({
            index: i + 1,
            label: ef.name || ef.label || ef.placeholder || ef.id || `field ${i + 1}`,
            selector: ef.selector,
            name: ef.name || ef.id || "",
            type: ef.type || ef.tag || "text",
          })),
          awaitingField: nextField,
        };
      }
    }
    if (!nextField) {
      const doneMsg = isHindi
        ? "✅ Is form ke sabhi visible fields pehle se bhare hue lag rahe hain! Agar kuch badalna ho ya submit karna ho to batayein."
        : "✅ All visible fields in this form appear filled! Let me know if you want to edit anything or submit.";
      setRigEmotion("happy", "Complete");
      appendHistory("buddy", doneMsg);
      speakResponse(doneMsg, "happy");
      return true;
    }
    if (nextField.selector) {
      lastHighlightSelector = nextField.selector;
      lastCallout = {
        title: `Next: ${nextField.label}`,
        description: "Waiting for your value",
      };
      pointArmAtElement().catch(() => {});
    }
    pendingSlot = {
      type: "fill_value",
      targetField: nextField.label || "__CURRENT__",
      targetSelector: nextField.selector || undefined,
      fromFormSession: true,
    };
    if (activeFormSession) activeFormSession.awaitingField = nextField;
    const askNextMsg = isHindi
      ? `Ab **${nextField.label}** mein kya bharna hai?`
      : `Next, what value should I enter in **${nextField.label}**?`;
    setRigEmotion("curious", "Next Field");
    $("statusText").textContent = askNextMsg;
    appendHistory("buddy", askNextMsg);
    recordConversationTurn(trimmed, askNextMsg);
    speakResponse(askNextMsg, "curious", {
      autoListenOnFinish: true,
      autoListenReason: "next_form_field",
    });
    return true;
  }

  if (intent.type === "FILL_NEED_VALUE") {
    appendHistory("user", trimmed);
    $("promptInput").value = "";
    pendingSlot = {
      type: "fill_value",
      targetField: intent.targetField || "__CURRENT__",
      targetSelector: intent.selector || lastHighlightSelector || undefined,
      verb: intent.verb || "fill",
      noSubmitPrompt: Boolean(intent.noSubmitPrompt),
    };
    recordTaskContext({
      actionType: "ask_clarification",
      targetField: pendingSlot.targetField,
      targetSelector: pendingSlot.targetSelector,
    });
    if (pendingSlot.targetField && pendingSlot.targetField !== "__CURRENT__") {
      try {
        await executeFind(pendingSlot.targetField, "point");
      } catch {}
    }
    const askText = isHindi
      ? intent.verb === "write"
        ? "Kya likhna hai? Text bata do."
        : "Kya fill karna hai?"
      : intent.verb === "write"
        ? "What should I type here? Please share the text."
        : "What value should I fill here?";
    setRigEmotion("curious", "Need Value");
    $("statusText").textContent = askText;
    appendHistory("buddy", askText);
    recordConversationTurn(trimmed, askText);
    speakResponse(askText, "curious", {
      autoListenOnFinish: true,
      autoListenReason: "missing_value",
    });
    return true;
  }

  if (intent.type === "NAVIGATE") {
    appendHistory("user", trimmed);
    $("promptInput").value = "";
    setRigEmotion("working", "Opening URL…");
    $("statusText").textContent = `Opening ${intent.url}…`;
    const res = await sendRuntimeMessage({ type: "NAVIGATE_TAB", url: intent.url });
    if (res?.ok) {
      setRigEmotion("happy", "Opened!");
      lastHighlightSelector = null;
      const msg = isHindi
        ? `🌐 ${intent.label || intent.url} khol diya hai (${res.url || intent.url}).`
        : `🌐 Opened ${intent.label || intent.url} (${res.url || intent.url}).`;
      recordSessionAction(msg, "confirmed");
      $("statusText").textContent = msg;
      appendHistory("buddy", msg);
      recordConversationTurn(trimmed, msg);
      speakResponse(msg, "happy");
    } else {
      setRigEmotion("error", "Failed");
      const failMsg = res?.message || `Could not open ${intent.url}.`;
      recordSessionAction(failMsg, "failed");
      $("statusText").textContent = failMsg;
      appendHistory("buddy", `⚠️ ${failMsg}`);
    }
    return true;
  }

  if (intent.type === "WEB_SEARCH" || intent.type === "OPEN_WEBSITE") {
    appendHistory("user", trimmed);
    $("promptInput").value = "";
    const dest = resolveWebsiteDestination(intent.query, intent.type === "WEB_SEARCH");
    if (dest.ambiguous && Array.isArray(dest.options) && dest.options.length > 1) {
      pendingDisambiguation = {
        action: "open_url",
        target: dest.label,
        candidates: dest.options.map((opt, idx) => ({
          index: idx + 1,
          text: opt.label,
          url: opt.url,
          tag: "portal",
        })),
      };
      const listText = pendingDisambiguation.candidates
        .map((c) => `${c.index}. ${c.text}`)
        .join("\n");
      const askMsg = isHindi
        ? `🤔 Aap "${dest.label}" ka kaunsa portal kholna chahte hain?\n${listText}\nNumber (1-${pendingDisambiguation.candidates.length}) batayein.`
        : `🤔 Which "${dest.label}" portal would you like to open?\n${listText}\nReply with 1 or 2.`;
      setRigEmotion("curious", "Which portal?");
      $("statusText").textContent = `Clarify ${dest.label} destination`;
      appendHistory("buddy", askMsg);
      speakResponse(askMsg, "curious");
      return true;
    }
    setRigEmotion("working", intent.type === "WEB_SEARCH" ? "Searching web…" : "Opening site…");
    $("statusText").textContent = `Opening ${dest.url}…`;
    const res = await sendRuntimeMessage({ type: "NAVIGATE_TAB", url: dest.url });
    if (res?.ok) {
      setRigEmotion("happy", "Opened!");
      lastHighlightSelector = null;
      recordTaskContext({ actionType: intent.type.toLowerCase(), targetField: null, targetSelector: null });
      const msg =
        intent.type === "WEB_SEARCH"
          ? isHindi
            ? `🌐 Web par "${dest.label}" search khol diya hai (${res.url || dest.url}).`
            : `🌐 Opened web search for "${dest.label}" (${res.url || dest.url}).`
          : isHindi
            ? `🌐 "${dest.label}" website khol di hai (${res.url || dest.url}).`
            : `🌐 Opened "${dest.label}" at ${res.url || dest.url}.`;
      recordSessionAction(msg, "confirmed");
      $("statusText").textContent = msg;
      appendHistory("buddy", msg);
      recordConversationTurn(trimmed, msg);
      speakResponse(msg, "happy");
    } else {
      setRigEmotion("error", "Failed");
      const failMsg = res?.message || `Could not open ${dest.url}.`;
      recordSessionAction(failMsg, "failed");
      $("statusText").textContent = failMsg;
      appendHistory("buddy", `⚠️ ${failMsg}`);
    }
    return true;
  }

  if (intent.type === "DOWNLOAD") {
    appendHistory("user", trimmed);
    $("promptInput").value = "";
    setRigEmotion("working", "Downloading…");
    $("statusText").textContent = "Initiating & verifying download…";
    if (intent.url) {
      const dlRes = await sendRuntimeMessage({
        type: "DOWNLOAD_FILE",
        url: intent.url,
        filenameHint: intent.filenameHint || undefined,
      });
      if (dlRes?.ok) {
        setRigEmotion("success", "Downloaded!");
        const msg = isHindi
          ? `⬇️ Download ${dlRes.state === "complete" ? "complete" : "shuru"} ho gaya${dlRes.filename ? ` (${dlRes.filename})` : ""}.`
          : `⬇️ Download ${dlRes.state === "complete" ? "completed" : "started"}${dlRes.filename ? ` (${dlRes.filename})` : ""}.`;
        recordSessionAction(msg, "confirmed");
        $("statusText").textContent = msg;
        appendHistory("buddy", msg);
        speakResponse(msg, "success");
      } else {
        setRigEmotion("error", "Failed");
        const failMsg = dlRes?.message || "Could not start download for that URL.";
        recordSessionAction(failMsg, "failed");
        $("statusText").textContent = failMsg;
        appendHistory("buddy", `⚠️ ${failMsg}`);
      }
      return true;
    }

    const clickDlRes = await sendRuntimeMessage({
      type: "EXECUTE_ACTION",
      action: "click",
      selector: intent.selector || lastHighlightSelector || undefined,
      value: intent.target || "download",
      options: {
        trackDownload: true,
        fallbackSelector: lastHighlightSelector || undefined,
      },
    });
    if (clickDlRes?.ambiguous && Array.isArray(clickDlRes.candidates) && clickDlRes.candidates.length > 1) {
      pendingDisambiguation = {
        action: "click",
        target: intent.target || "download",
        candidates: clickDlRes.candidates,
      };
      const listText = clickDlRes.candidates
        .map((c) => `${c.index}. "${c.text}"${c.context ? ` — [${c.context}]` : ` (${c.tag})`}`)
        .join("\n");
      const askMsg = isHindi
        ? `🤔 "${intent.target || "download"}" ke ${clickDlRes.candidates.length} options mile:\n${listText}\nKaunsa download karna hai?`
        : `🤔 Found ${clickDlRes.candidates.length} download controls:\n${listText}\nWhich one should I download?`;
      setRigEmotion("confused", "Which one?");
      appendHistory("buddy", askMsg);
      speakResponse(askMsg, "confused");
      return true;
    }
    if (clickDlRes?.ok) {
      const dlInfo = clickDlRes.download;
      if (dlInfo?.ok || clickDlRes.downloadTriggered) {
        setRigEmotion("success", "Downloaded!");
        const msg = isHindi
          ? `⬇️ Download ${dlInfo?.state === "complete" ? "complete" : "verify"} ho gaya${dlInfo?.filename ? ` (${dlInfo.filename})` : ""}!`
          : `⬇️ Download ${dlInfo?.state === "complete" ? "completed" : "started"}${dlInfo?.filename ? ` (${dlInfo.filename})` : ""}!`;
        recordSessionAction(msg, "confirmed");
        $("statusText").textContent = msg;
        appendHistory("buddy", msg);
        speakResponse(msg, "success");
      } else {
        setRigEmotion("concerned", "Check Tab");
        const msg = isHindi
          ? `✅ "${clickDlRes.text || "Download"}" click kar diya hai, lekin Chrome downloads list mein abhi nayi file detect nahi hui.`
          : `✅ Clicked "${clickDlRes.text || "Download"}", though no new file appeared in Chrome downloads yet.`;
        recordSessionAction(msg, "unconfirmed");
        $("statusText").textContent = msg;
        appendHistory("buddy", msg);
      }
    } else {
      setRigEmotion("error", "Not found");
      const failMsg =
        clickDlRes?.message ||
        (isHindi ? "Page par matching download button ya link nahi mila." : "Could not find a matching download button or link on this page.");
      recordSessionAction(failMsg, "failed");
      $("statusText").textContent = failMsg;
      appendHistory("buddy", `⚠️ ${failMsg}`);
    }
    return true;
  }

  if (intent.type === "RETRY_LAST_CLICK" && intent.attempt) {
    appendHistory("user", trimmed);
    $("promptInput").value = "";
    setRigEmotion("working", "Retrying…");
    $("statusText").textContent = `Retrying "${intent.attempt.target || "click"}" with alternate method…`;
    const retryRes = await sendRuntimeMessage({
      type: "EXECUTE_ACTION",
      action: intent.attempt.action || "click",
      selector: intent.attempt.selector || undefined,
      value: intent.attempt.target || undefined,
      options: {
        clickMethod: "alternate",
        fallbackSelector: intent.attempt.selector || lastHighlightSelector || undefined,
      },
    });
    if (retryRes?.ok) {
      setRigEmotion("success", "Done!");
      const msg = isHindi
        ? `✅ Alternate click method se "${retryRes.text || intent.attempt.target}" execute ho gaya!`
        : `✅ Retried "${retryRes.text || intent.attempt.target}" with alternate click method successfully!`;
      recordSessionAction(msg, "confirmed");
      $("statusText").textContent = msg;
      appendHistory("buddy", msg);
      speakResponse(msg, "success");
    } else {
      setRigEmotion("error", "Blocked");
      const failMsg = retryRes?.message || "Alternate click method also could not complete this action.";
      recordSessionAction(failMsg, "failed");
      $("statusText").textContent = failMsg;
      appendHistory("buddy", `⚠️ ${failMsg}`);
    }
    return true;
  }

  if (intent.type === "SEARCH_SUBMIT") {
    appendHistory("user", trimmed);
    $("promptInput").value = "";
    setRigEmotion("working", "Searching…");
    $("statusText").textContent = `Searching "${intent.query}" in page search box…`;
    const res = await sendRuntimeMessage({
      type: "EXECUTE_ACTION",
      action: "search_submit",
      selector: intent.selector || undefined,
      value: intent.query,
      options: { query: intent.query },
    });
    if (res?.ok) {
      setRigEmotion("happy", "Searched!");
      recordTaskContext({ actionType: "search_submit", targetField: res.field || "search" });
      const msg = isHindi
        ? `🔍 Search box mein "${intent.query}" daal kar search kar diya hai (${res.submittedWith === "search_button" ? "Search button" : "Enter"}).`
        : `🔍 Entered "${intent.query}" in search box and submitted search.`;
      recordSessionAction(msg, "confirmed");
      $("statusText").textContent = msg;
      appendHistory("buddy", msg);
      recordConversationTurn(trimmed, msg);
      speakResponse(msg, "happy");
    } else {
      setRigEmotion("confused", "No Search");
      const failMsg = res?.noSearchInput
        ? isHindi
          ? `⚠️ Is page par koi visible search box nahi mila. Agar aap page text highlight karna chahte hain to "is page par ${intent.query} search karo" bolein, ya web search ke liye "search for ${intent.query} website" bolein.`
          : `⚠️ No visible search box was found on this page. Say "search ${intent.query} on this page" to highlight text on page.`
        : res?.message || `Could not run search for "${intent.query}".`;
      recordSessionAction(failMsg, "failed");
      $("statusText").textContent = failMsg;
      appendHistory("buddy", failMsg);
      speakResponse(failMsg, "confused");
    }
    return true;
  }

  if (intent.type === "GREETING") {
    appendHistory("user", trimmed);
    $("promptInput").value = "";
    setRigEmotion("celebrate", "Namaste!");
    const greetingText = isHindi
      ? `Namaste! Main aapka ${active.name} hoon. Main is page par aapke liye buttons click karne, forms fill karne, scroll karne aur elements par point karne ke liye ready hoon. Bataiye kya karna hai!`
      : `Hey there! I am ${active.name}. I am active on this page and ready to click buttons, fill forms, scroll, point to elements, or automate workflows! What would you like me to do?`;
    appendHistory("buddy", greetingText);
    $("statusText").textContent = `Ready with ${active.name}.`;
    speakResponse(greetingText, "happy");
    return true;
  }

  if (intent.type === "HELP") {
    appendHistory("user", trimmed);
    $("promptInput").value = "";
    setRigEmotion("happy", "Ready");
    const helpMsg = isHindi
      ? `Main aapka ${active.name} hoon! Aap mujhe seedhe chat mein koi bhi action bol sakte hain:\n• Point: "address field par point karo"\n• Click: "submit button click karo"\n• Fill: "is form mein naam fill kar do"\n• Scroll: "neeche scroll karo" ya "page ke last mein jao"\n• Multi-step: "Meesho dashboard open karo, pending orders find karo..."`
      : `I am ${active.name}, your browser action companion! Just tell me what to do:\n• Point: "Point to address field" (highlights without clicking)\n• Click: "Click submit button"\n• Fill: "Fill this form"\n• Scroll: "Scroll down" / "Scroll to footer"\n• Multi-step: Chain steps in one message`;
    appendHistory("buddy", helpMsg);
    $("statusText").textContent = `Capabilities of ${active.name}.`;
    speakResponse(helpMsg, "happy");
    return true;
  }

  if (intent.type === "HISTORY_NAV") {
    appendHistory("user", trimmed);
    $("promptInput").value = "";
    setRigEmotion("working", intent.direction === "reload" ? "Refreshing…" : "Navigating…");
    $("statusText").textContent = `Executing browser ${intent.direction}…`;
    const res = await sendRuntimeMessage({ type: "NAVIGATE_HISTORY", direction: intent.direction });
    if (res?.ok) {
      setRigEmotion("happy", "Done!");
      lastHighlightSelector = null;
      const msg = res.message || `Navigated ${intent.direction}.`;
      recordSessionAction(msg, "confirmed");
      $("statusText").textContent = msg;
      appendHistory("buddy", `🌐 ${msg}`);
      speakResponse(msg, "happy");
    } else {
      setRigEmotion("error", "Failed");
      const failMsg = res?.message || `Could not go ${intent.direction}.`;
      recordSessionAction(failMsg, "failed");
      $("statusText").textContent = failMsg;
      appendHistory("buddy", `⚠️ ${failMsg}`);
    }
    return true;
  }

  if (intent.type === "PAGE_INVENTORY") {
    appendHistory("user", trimmed);
    $("promptInput").value = "";
    setRigEmotion("thinking", "Scanning…");
    $("statusText").textContent = "Inspecting active webpage elements…";
    const snapRes = await sendRuntimeMessage({ type: "GET_PAGE_SNAPSHOT" });
    if (!snapRes?.ok || !snapRes.snapshot) {
      setRigEmotion("error", "Unreadable");
      const errMsg = "Unable to read the active webpage right now.";
      recordSessionAction("Page inventory failed", "failed");
      $("statusText").textContent = errMsg;
      appendHistory("buddy", `⚠️ ${errMsg}`);
      return true;
    }
    const snap = snapRes.snapshot;
    const parts = [];
    parts.push(`📄 **${snap.title || "Current Page"}** (${snap.url || ""})`);
    if (snap.headings?.length) {
      parts.push(
        `• Headings (${snap.headings.length}): ${snap.headings.slice(0, 6).map((h) => h.name || h.text).filter(Boolean).join(" | ")}`,
      );
    }
    if (snap.forms?.length) {
      const formItems = snap.forms.slice(0, 12).map((f) => {
        const lbl = f.name || f.placeholder || f.role || f.tag;
        const optTxt = f.options?.length ? ` [options: ${f.options.slice(0, 5).join(", ")}]` : "";
        return `${lbl}${optTxt}`;
      });
      parts.push(`• Form Fields (${snap.forms.length}): ${formItems.join(", ")}`);
    }
    if (snap.controls?.length) {
      const btnItems = snap.controls
        .slice(0, 14)
        .map((c) => c.name || c.text)
        .filter(Boolean);
      parts.push(`• Buttons & Links (${snap.controls.length}): ${btnItems.join(", ")}`);
    }
    if (snap.scrollableContainers?.length) {
      const boxNames = snap.scrollableContainers.map(
        (sc) => sc.ariaLabel || sc.selector || sc.tag,
      );
      parts.push(`• Scrollable Areas (${snap.scrollableContainers.length}): ${boxNames.join(", ")}`);
    }
    if (snap.alerts?.length) {
      parts.push(`• Page Alerts (${snap.alerts.length}): ${snap.alerts.slice(0, 3).map((a) => a.errorMessage || a.name).filter(Boolean).join(" | ")}`);
    }
    const summaryMsg = parts.join("\n");
    setRigEmotion("happy", "Ready");
    recordSessionAction(`Listed page inventory (${snap.forms?.length || 0} fields, ${snap.controls?.length || 0} controls)`, "confirmed");
    $("statusText").textContent = "Listed visible page structure.";
    appendHistory("buddy", summaryMsg);
    speakResponse(
      isHindi
        ? `Is page par ${snap.forms?.length || 0} form fields aur ${snap.controls?.length || 0} buttons/links hain.`
        : `This page has ${snap.forms?.length || 0} form fields and ${snap.controls?.length || 0} controls.`,
      "happy",
    );
    return true;
  }

  if (intent.type === "ACTIVITY_LOG") {
    appendHistory("user", trimmed);
    $("promptInput").value = "";
    setRigEmotion("happy", "Log");
    if (sessionActionLog.length === 0) {
      const emptyMsg = isHindi
        ? "📋 Abhi tak is session mein koi browser action execute nahi kiya gaya hai."
        : "📋 No browser actions have been executed in this session yet.";
      $("statusText").textContent = "Activity log is empty.";
      appendHistory("buddy", emptyMsg);
      return true;
    }
    const lines = sessionActionLog.map((e, i) => `${i + 1}. ${e.icon} [${e.ts}] ${e.summary}`);
    const logMsg = `📋 **Session Activity Log (${sessionActionLog.length}):**\n${lines.join("\n")}`;
    $("statusText").textContent = `Showing ${sessionActionLog.length} session actions.`;
    appendHistory("buddy", logMsg);
    return true;
  }

  if (intent.type === "EXPLAIN_ERRORS") {
    appendHistory("user", trimmed);
    $("promptInput").value = "";
    setRigEmotion("thinking", "Checking…");
    $("statusText").textContent = "Inspecting page alerts and validation errors…";

    const snapRes = await sendRuntimeMessage({ type: "GET_PAGE_SNAPSHOT" });
    const snap = snapRes?.snapshot;
    if (!snapRes?.ok || !snap) {
      setRigEmotion("error", "Unreadable");
      const failMsg = isHindi
        ? "Is page ke errors check nahi kiye ja sake — kripya page reload karein ya doosra tab check karein."
        : "Could not read this page to inspect errors. Try refreshing the tab.";
      appendHistory("buddy", `⚠️ ${failMsg}`);
      $("statusText").textContent = failMsg;
      return true;
    }

    const realAlerts = (snap.alerts || []).filter(
      (a) => String(a?.errorMessage || a?.name || "").trim().length > 0,
    );
    const invalidForms = (snap.forms || []).filter((f) => f.invalid);

    if (realAlerts.length === 0 && invalidForms.length === 0) {
      if ($("pageErrorBanner")) $("pageErrorBanner").hidden = true;
      setRigEmotion("happy", "All Clear");
      const cleanMsg = isHindi
        ? `✅ Is page ("${snap.title || "Current Page"}") par abhi koi active website error ya invalid form field nahi mila. (Agar pehle empty alert banner dikh raha tha to maine use clear kar diya hai.)`
        : `✅ No active website errors or invalid form fields were found on "${snap.title || "Current Page"}". (Cleared any stale alert banner.)`;
      appendHistory("buddy", cleanMsg);
      $("statusText").textContent = "No active page errors found.";
      speakResponse(cleanMsg, "happy");
      return true;
    }

    const lines = [];
    lines.push(
      isHindi
        ? `🚨 **Website Errors & Form Validation Issues (${realAlerts.length + invalidForms.length}):**`
        : `🚨 **Website Errors & Validation Issues Found (${realAlerts.length + invalidForms.length}):**`,
    );

    if (realAlerts.length > 0) {
      lines.push(isHindi ? "\n• **Website Alerts / Banners:**" : "\n• **Website Alerts / Banners:**");
      for (const a of realAlerts.slice(0, 5)) {
        const msg = String(a.errorMessage || a.name).trim();
        lines.push(`  - "${msg}"`);
      }
    }

    if (invalidForms.length > 0) {
      lines.push(isHindi ? "\n• **Invalid Form Fields:**" : "\n• **Invalid Form Fields:**");
      for (const f of invalidForms.slice(0, 8)) {
        const label = f.name || f.placeholder || f.role || "field";
        const reason = f.errorMessage || (isHindi ? "Required ya invalid format" : "Required or failed validation");
        lines.push(`  - **${label}**: ${reason}`);
      }
      const firstInvalid = invalidForms[0];
      if (firstInvalid?.selector) {
        lastHighlightSelector = firstInvalid.selector;
        if ($("highlightBtn")) $("highlightBtn").hidden = false;
        pointArmAtElement();
      }
    }

    lines.push(
      isHindi
        ? "\n💡 **Kaise Fix Karein:** Upar bataye gaye field(s) mein sahi details daalein (ya mujhe bolein jaise: `\"email mein name@example.com fill kar do\"`) aur alert message check karke dobara submit karein."
        : "\n💡 **How to Fix:** Update the highlighted/listed field(s) with valid input (or tell me e.g. `fill name@example.com in email`), then review before submitting.",
    );

    const reportMsg = lines.join("\n");
    setRigEmotion("concerned", "Explained");
    $("statusText").textContent = `Found ${realAlerts.length} alert(s) and ${invalidForms.length} invalid field(s).`;
    recordSessionAction(`Explained ${realAlerts.length} page alert(s) and ${invalidForms.length} invalid field(s)`, "confirmed");
    appendHistory("buddy", reportMsg);
    speakResponse(reportMsg, "concerned");
    return true;
  }

  if (intent.type === "RESUME_PLAN") {
    appendHistory("user", trimmed);
    $("promptInput").value = "";
    if (!activePlan || activePlan.currentStepIndex >= (activePlan.steps?.length || 0)) {
      const noPlanMsg = isHindi
        ? "ℹ️ Abhi koi ruka hua multi-step task nahi hai jise resume kiya jaye."
        : "ℹ️ There is no paused or interrupted multi-step task to resume right now.";
      appendHistory("buddy", noPlanMsg);
      $("statusText").textContent = noPlanMsg;
      return true;
    }
    isPlanPaused = false;
    setRigEmotion("working", "Resuming…");
    const resumeMsg = isHindi
      ? `▶️ Jahan task ruka tha (Step ${(activePlan.currentStepIndex || 0) + 1}/${activePlan.steps.length}) wahan se continue kar raha hoon.`
      : `▶️ Resuming task from step ${(activePlan.currentStepIndex || 0) + 1} of ${activePlan.steps.length}.`;
    appendHistory("buddy", resumeMsg);
    await runPlanLoop();
    return true;
  }

  if (intent.type === "UNDO_ACTION") {
    appendHistory("user", trimmed);
    $("promptInput").value = "";
    const lastUndo = sessionTaskContext.undoStack?.length
      ? sessionTaskContext.undoStack[sessionTaskContext.undoStack.length - 1]
      : null;
    if (!lastUndo && intent.scope !== "navigation") {
      const noneMsg = isHindi
        ? "ℹ️ Undo karne ke liye abhi koi recent verified edit nahi hai."
        : "ℹ️ There is no recent verified field edit to undo.";
      setRigEmotion("idle", "No Undo");
      appendHistory("buddy", noneMsg);
      $("statusText").textContent = noneMsg;
      return true;
    }
    setRigEmotion("working", "Undoing…");
    const res = await sendRuntimeMessage({
      type: "EXECUTE_ACTION",
      action: "undo_reversible_action",
      selector: lastUndo?.selector || undefined,
      options: { scope: intent.scope || "field", undoRecord: lastUndo },
    });
    if (res?.ok) {
      if (intent.scope !== "navigation" && sessionTaskContext.undoStack.length > 0) {
        sessionTaskContext.undoStack.pop();
      }
      setRigEmotion("happy", "Undone!");
      const okMsg = isHindi
        ? `↩️ ${res.message || "Pichla change wapas pehle jaisa kar diya hai."}`
        : `↩️ ${res.message}`;
      recordSessionAction(okMsg, "confirmed");
      appendHistory("buddy", okMsg);
      $("statusText").textContent = okMsg;
      speakResponse(okMsg, "happy");
    } else {
      setRigEmotion("error", "Undo Failed");
      const errMsg = res?.message || "Could not undo the last action.";
      appendHistory("buddy", `⚠️ ${errMsg}`);
      $("statusText").textContent = errMsg;
    }
    return true;
  }

  if (intent.type === "TAB_ACTION") {
    appendHistory("user", trimmed);
    $("promptInput").value = "";
    if (intent.action === "return_original") {
      const origId = sessionTaskContext.originalTabId;
      if (!origId) {
        const msg = isHindi
          ? "ℹ️ Original tab ID record nahi hai — pehle kisi doosre tab mein jaane par yeh track hota hai."
          : "ℹ️ No original tab recorded yet in this session.";
        appendHistory("buddy", msg);
        return true;
      }
      const res = await sendRuntimeMessage({ type: "SWITCH_TAB", tabId: origId });
      const msg = res?.ok
        ? isHindi
          ? `🗂️ Original tab ("${res.title || origId}") par wapas aa gaye hain.`
          : `🗂️ Returned to original tab ("${res.title || origId}").`
        : res?.message || "Could not return to the original tab.";
      setRigEmotion(res?.ok ? "happy" : "error", res?.ok ? "Switched" : "Failed");
      appendHistory("buddy", res?.ok ? msg : `⚠️ ${msg}`);
      return true;
    }
    if (intent.action === "open_tab") {
      const activeTab = await queryActiveWebTab().catch(() => null);
      if (activeTab?.id && !sessionTaskContext.originalTabId) {
        recordTaskContext({ originalTabId: activeTab.id });
      }
      let targetUrl = intent.url;
      if (!targetUrl && /^https?:\/\//i.test(String(intent.target || ""))) {
        targetUrl = intent.target;
      } else if (!targetUrl) {
        const dest = resolveWebsiteDestination(intent.target || "", false);
        targetUrl = dest?.url;
      }
      const res = await sendRuntimeMessage({ type: "OPEN_TAB", url: targetUrl });
      if (res?.ok && res.tabId) {
        recordTaskContext({ openTabId: res.tabId });
      }
      const msg = res?.ok
        ? isHindi
          ? `🗂️ Naya tab khol diya hai (${res.url || targetUrl}). Wapas aane ke liye "return to original tab" bolein.`
          : `🗂️ Opened in a new tab (${res.url || targetUrl}). Say "return to original tab" anytime.`
        : res?.message || "Could not open a new tab.";
      setRigEmotion(res?.ok ? "happy" : "error", res?.ok ? "Tab Opened" : "Blocked");
      recordSessionAction(msg, res?.ok ? "confirmed" : "failed");
      appendHistory("buddy", res?.ok ? msg : `⚠️ ${msg}`);
      return true;
    }
    if (intent.action === "close_tab") {
      const activeTab = await queryActiveWebTab().catch(() => null);
      const res = await sendRuntimeMessage({ type: "CLOSE_TAB", tabId: activeTab?.id });
      const msg = res?.ok
        ? isHindi
          ? "🗂️ Tab safely band kar diya hai."
          : "🗂️ Closed the tab safely."
        : res?.message || "Could not close that tab safely.";
      setRigEmotion(res?.ok ? "happy" : "concerned", res?.ok ? "Closed" : "Protected");
      appendHistory("buddy", res?.ok ? msg : `🛡️ ${msg}`);
      return true;
    }
    if (intent.action === "switch_tab") {
      const tabsRes = await sendRuntimeMessage({ type: "GET_ALL_TABS" });
      const q = String(intent.target || "").toLowerCase();
      const matched = (tabsRes?.tabs || []).find(
        (t) => (t.title || "").toLowerCase().includes(q) || (t.url || "").toLowerCase().includes(q),
      );
      if (!matched) {
        appendHistory("buddy", `⚠️ Could not find an open tab matching "${intent.target}".`);
        return true;
      }
      const activeTab = await queryActiveWebTab().catch(() => null);
      if (activeTab?.id && !sessionTaskContext.originalTabId) {
        recordTaskContext({ originalTabId: activeTab.id });
      }
      const res = await sendRuntimeMessage({ type: "SWITCH_TAB", tabId: matched.id });
      setRigEmotion(res?.ok ? "happy" : "error", res?.ok ? "Switched" : "Failed");
      appendHistory("buddy", res?.ok ? `🗂️ Switched to tab "${matched.title}".` : `⚠️ ${res?.message || "Switch failed."}`);
      return true;
    }
  }

  if (intent.type === "COMPARE_TWO_PAGES") {
    appendHistory("user", trimmed);
    $("promptInput").value = "";
    setRigEmotion("thinking", "Reading 2 Pages…");

    const tabsRes = await sendRuntimeMessage({ type: "GET_ALL_TABS" });
    const activeTab = await queryActiveWebTab().catch(() => null);
    const accessibleTabs = (tabsRes?.tabs || []).filter(
      (t) => t?.id && /^https?:\/\//i.test(String(t.url || "")),
    );
    const tabA =
      accessibleTabs.find((t) => t.id === activeTab?.id) ||
      accessibleTabs.find((t) => t.active) ||
      accessibleTabs[0];
    const preferredSecondaryId =
      tabA?.id === sessionTaskContext.originalTabId
        ? sessionTaskContext.openTabId
        : sessionTaskContext.originalTabId || sessionTaskContext.openTabId;
    const tabB =
      (preferredSecondaryId
        ? accessibleTabs.find((t) => t.id === preferredSecondaryId && t.id !== tabA?.id)
        : null) || accessibleTabs.find((t) => t.id !== tabA?.id);

    if (!tabA || !tabB || tabA.id === tabB.id) {
      setRigEmotion("concerned", "Need 2 Tabs");
      const errMsg = isHindi
        ? "⚠️ Compare karne ke liye kam se kam 2 open webpage tabs (http/https) chahiye. Abhi sirf 1 accessible tab mila."
        : "⚠️ Need at least two open accessible webpage tabs (http/https) to compare. Only one accessible tab was found.";
      $("statusText").textContent = errMsg;
      recordSessionAction(errMsg, "failed");
      appendHistory("buddy", errMsg);
      return true;
    }

    const [snapARes, snapBRes] = await Promise.all([
      sendRuntimeMessage({ type: "READ_TAB_SNAPSHOT", tabId: tabA.id }),
      sendRuntimeMessage({ type: "READ_TAB_SNAPSHOT", tabId: tabB.id }),
    ]);

    if (!snapARes?.ok || !snapARes.snapshot || !snapBRes?.ok || !snapBRes.snapshot) {
      const failedPages = [];
      if (!snapARes?.ok || !snapARes?.snapshot) {
        failedPages.push(`Tab 1 ("${tabA.title || tabA.url}"): ${snapARes?.message || "unreadable"}`);
      }
      if (!snapBRes?.ok || !snapBRes?.snapshot) {
        failedPages.push(`Tab 2 ("${tabB.title || tabB.url}"): ${snapBRes?.message || "unreadable"}`);
      }
      setRigEmotion("error", "Read Failed");
      const errMsg = isHindi
        ? `❌ Dono pages read nahi ho paaye, isliye comparison complete nahi hua:\n• ${failedPages.join("\n• ")}`
        : `❌ Could not read both pages, so comparison was aborted:\n• ${failedPages.join("\n• ")}`;
      $("statusText").textContent = errMsg;
      recordSessionAction(errMsg, "failed");
      appendHistory("buddy", errMsg);
      return true;
    }

    const snapA = snapARes.snapshot;
    const snapB = snapBRes.snapshot;
    const hA = new Set((snapA.headings || []).map((h) => String(h.name || h.text || "").trim()).filter(Boolean));
    const hB = new Set((snapB.headings || []).map((h) => String(h.name || h.text || "").trim()).filter(Boolean));
    const sharedHeadings = [...hA].filter((h) => hB.has(h)).slice(0, 5);
    const onlyA = [...hA].filter((h) => !hB.has(h)).slice(0, 4);
    const onlyB = [...hB].filter((h) => !hA.has(h)).slice(0, 4);
    const wordsA = String(snapA.text || "").trim().split(/\s+/).filter(Boolean).length;
    const wordsB = String(snapB.text || "").trim().split(/\s+/).filter(Boolean).length;
    const formsA = (snapA.forms || []).length;
    const formsB = (snapB.forms || []).length;
    const controlsA = (snapA.controls || []).length;
    const controlsB = (snapB.controls || []).length;
    const alertsA = (snapA.alerts || []).length;
    const alertsB = (snapB.alerts || []).length;

    const comparisonReport = [
      isHindi ? "📊 **Two-Page Live Comparison:**" : "📊 **Two-Page Live Comparison:**",
      `• **Page 1:** ${snapA.title || tabA.title} (${snapA.url || tabA.url})`,
      `  Headings: ${hA.size} | Forms: ${formsA} | Controls: ${controlsA} | Alerts: ${alertsA} | Words: ~${wordsA}`,
      `• **Page 2:** ${snapB.title || tabB.title} (${snapB.url || tabB.url})`,
      `  Headings: ${hB.size} | Forms: ${formsB} | Controls: ${controlsB} | Alerts: ${alertsB} | Words: ~${wordsB}`,
      sharedHeadings.length ? `• **Shared Headings:** ${sharedHeadings.join(", ")}` : null,
      onlyA.length ? `• **Only on Page 1:** ${onlyA.join(", ")}` : null,
      onlyB.length ? `• **Only on Page 2:** ${onlyB.join(", ")}` : null,
      `• **Delta:** Forms (${formsA - formsB >= 0 ? "+" : ""}${formsA - formsB}), Controls (${controlsA - controlsB >= 0 ? "+" : ""}${controlsA - controlsB}), Words (${wordsA - wordsB >= 0 ? "+" : ""}${wordsA - wordsB}).`,
    ]
      .filter(Boolean)
      .join("\n");

    setRigEmotion("happy", "Compared");
    $("statusText").textContent = `Compared "${snapA.title || tabA.title}" vs "${snapB.title || tabB.title}".`;
    recordSessionAction(`Compared 2 pages: ${snapA.url || tabA.url} vs ${snapB.url || tabB.url}`, "confirmed");
    appendHistory("buddy", comparisonReport);
    speakResponse(
      isHindi
        ? `Dono pages compare kar diye hain: ${snapA.title || "Page 1"} aur ${snapB.title || "Page 2"}.`
        : `Compared ${snapA.title || "Page 1"} and ${snapB.title || "Page 2"}.`,
      "happy",
    );
    return true;
  }

  if (intent.type === "VALIDATE_FORM") {
    appendHistory("user", trimmed);
    $("promptInput").value = "";
    setRigEmotion("thinking", "Validating…");
    const res = await sendRuntimeMessage({ type: "VALIDATE_FORM_ERRORS" });
    if (res?.ok) {
      setRigEmotion(res.valid ? "success" : "concerned", res.valid ? "Valid" : "Issues");
      const msg = res.valid
        ? isHindi
          ? "✅ Form ke sabhi visible fields valid hain!"
          : "✅ Form validation passed with zero errors!"
        : `⚠️ ${res.errorCount} validation issue(s):\n${(res.errors || []).map((e) => `• ${e.field}: ${e.message}`).join("\n")}`;
      appendHistory("buddy", msg);
      $("statusText").textContent = res.message || msg;
      speakResponse(msg, res.valid ? "success" : "concerned");
    } else {
      setRigEmotion("error", "Failed");
      appendHistory("buddy", `⚠️ ${res?.message || "Could not validate form on this page."}`);
    }
    return true;
  }

  if (intent.type === "HOVER" || intent.type === "DOUBLE_CLICK" || intent.type === "RIGHT_CLICK" || intent.type === "FOCUS" || intent.type === "CLEAR_FIELD" || intent.type === "DRAG_AND_DROP") {
    appendHistory("user", trimmed);
    $("promptInput").value = "";
    const actMap = {
      HOVER: "hover_element",
      DOUBLE_CLICK: "double_click",
      RIGHT_CLICK: "right_click",
      FOCUS: "focus_element",
      CLEAR_FIELD: "clear_field",
      DRAG_AND_DROP: "drag_and_drop",
    };
    const actionName = actMap[intent.type];
    setRigEmotion("pointing", "Acting…");
    let dragTargetSel = undefined;
    let dragSourceSel = intent.selector || undefined;
    if (intent.type === "DRAG_AND_DROP") {
      const snapRes = await sendRuntimeMessage({ type: "GET_PAGE_SNAPSHOT" });
      const pool = [...(snapRes?.snapshot?.controls || []), ...(snapRes?.snapshot?.forms || [])];
      const findSel = (q) =>
        pool.find((e) => `${e.name || ""} ${e.text || ""} ${e.placeholder || ""}`.toLowerCase().includes(q.toLowerCase()))?.selector;
      dragSourceSel = findSel(intent.source || "") || intent.source;
      dragTargetSel = findSel(intent.target || "") || intent.target;
    }
    const res = await sendRuntimeMessage({
      type: "EXECUTE_ACTION",
      action: actionName,
      selector: dragSourceSel,
      value: intent.type === "DRAG_AND_DROP" ? dragTargetSel : intent.target,
      options: {
        text: intent.target,
        targetSelector: dragTargetSel,
      },
    });
    if (res?.ok) {
      if (res.selector) {
        lastHighlightSelector = res.selector;
        recordTaskContext({
          actionType: actionName,
          targetField: intent.target || res.text || null,
          targetSelector: res.selector,
          targetRef: { label: intent.target || res.text || "element", selector: res.selector, actionType: actionName, capturedAt: Date.now() },
          undoRecord: res.undoRecord || undefined,
        });
      }
      setRigEmotion("success", "Done!");
      const msg = `✅ ${res.message}`;
      recordSessionAction(msg, "confirmed");
      appendHistory("buddy", msg);
      $("statusText").textContent = msg;
      speakResponse(msg, "success");
    } else {
      setRigEmotion("error", "Not found");
      const failMsg = res?.message || `Could not perform ${actionName} on "${intent.target}".`;
      recordSessionAction(failMsg, "failed");
      appendHistory("buddy", `⚠️ ${failMsg}`);
      $("statusText").textContent = failMsg;
    }
    return true;
  }

  if (intent.type === "SCROLL_UNTIL_TEXT" || intent.type === "INFINITE_SCROLL" || intent.type === "PAGINATE") {
    appendHistory("user", trimmed);
    $("promptInput").value = "";
    const actionMap = {
      SCROLL_UNTIL_TEXT: "scroll_until_text",
      INFINITE_SCROLL: "infinite_scroll",
      PAGINATE: "paginate",
    };
    const actName = actionMap[intent.type];
    setRigEmotion("working", "Navigating…");
    const res = await sendRuntimeMessage({
      type: "EXECUTE_ACTION",
      action: actName,
      value: intent.text || intent.targetText || intent.targetPage,
      options: {
        text: intent.text,
        targetText: intent.targetText,
        targetPage: intent.targetPage,
      },
    });
    if (res?.ok) {
      setRigEmotion("happy", "Done!");
      const msg = `📜 ${res.message}`;
      recordSessionAction(msg, "confirmed");
      appendHistory("buddy", msg);
      $("statusText").textContent = msg;
      speakResponse(msg, "happy");
    } else {
      setRigEmotion("error", "Not found");
      const failMsg = res?.message || `Could not complete ${actName}.`;
      recordSessionAction(failMsg, "failed");
      appendHistory("buddy", `⚠️ ${failMsg}`);
      $("statusText").textContent = failMsg;
    }
    return true;
  }

  if (intent.type === "ORDINAL_ITEM") {
    appendHistory("user", trimmed);
    $("promptInput").value = "";
    setRigEmotion("thinking", "Locating…");
    const snapRes = await sendRuntimeMessage({ type: "GET_PAGE_SNAPSHOT" });
    const controls = snapRes?.snapshot?.controls || [];
    const products = controls.filter(
      (c) => /\b(a|button)\b/i.test(c.tag || "") && (c.name || c.text || "").trim().length >= 2,
    );
    if (products.length === 0) {
      setRigEmotion("confused", "Not found");
      appendHistory("buddy", `⚠️ Could not find selectable ${intent.targetKind || "item"} cards on this page.`);
      return true;
    }
    const idx = intent.index === -1 ? products.length - 1 : Math.min(products.length - 1, Math.max(0, intent.index - 1));
    const chosen = products[idx];
    const res = await sendRuntimeMessage({
      type: "EXECUTE_ACTION",
      action: intent.openAction ? "open_link" : "click",
      selector: chosen.selector,
      value: chosen.name || chosen.text,
    });
    if (res?.ok) {
      recordTaskContext({
        actionType: "ordinal_click",
        targetField: chosen.name || chosen.text,
        targetSelector: chosen.selector,
        targetRef: { label: chosen.name || chosen.text, selector: chosen.selector, actionType: "click", capturedAt: Date.now() },
      });
      setRigEmotion("success", "Opened!");
      const msg = `✅ ${res.message || `Clicked item #${idx + 1}.`}`;
      appendHistory("buddy", msg);
      speakResponse(msg, "success");
    } else {
      appendHistory("buddy", `⚠️ ${res?.message || `Could not click item #${idx + 1}.`}`);
    }
    return true;
  }

  if (intent.type === "PARTIAL_UPDATE") {
    appendHistory("user", trimmed);
    $("promptInput").value = "";
    const customDrop = await sendRuntimeMessage({
      type: "EXECUTE_ACTION",
      action: "select_custom_dropdown",
      value: intent.value,
      options: { targetField: intent.targetField, value: intent.value },
    });
    if (customDrop?.ok) {
      if (customDrop.undoRecord) recordTaskContext({ undoRecord: customDrop.undoRecord });
      setRigEmotion("success", "Updated!");
      const okMsg = `✅ ${customDrop.message}`;
      recordSessionAction(okMsg, "confirmed");
      appendHistory("buddy", okMsg);
      speakResponse(okMsg, "success");
      return true;
    }
    await startSmartFormFill(null, {
      explicitPairs: [{ target: intent.targetField, value: intent.value, overwrite: true }],
      overwrite: true,
      explicitUserProvided: true,
      fromChatCommand: true,
    });
    return true;
  }

  if (intent.type === "SCROLL") {
    appendHistory("user", trimmed);
    $("promptInput").value = "";
    recordTaskContext({ actionType: "scroll" });
    await executeScroll(
      intent.direction,
      450,
      intent.target || null,
      true,
      intent.targetContainerText || null,
    );
    return true;
  }

  if (intent.type === "NAVIGATE") {
    appendHistory("user", trimmed);
    $("promptInput").value = "";
    setRigEmotion("working", "Navigating…");
    $("statusText").textContent = `Opening ${intent.url}…`;
    const res = await sendRuntimeMessage({ type: "NAVIGATE_TAB", url: intent.url });
    if (res?.ok) {
      setRigEmotion("happy", "Opened!");
      lastHighlightSelector = null;
      recordTaskContext({ actionType: "navigate" });
      const msg = isHindi
        ? `🌐 Tab ko ${res.url || intent.url} par navigate kar diya hai.`
        : `🌐 Navigated to ${res.url || intent.url}.`;
      recordSessionAction(`Navigated to ${res.url || intent.url}`, "confirmed");
      $("statusText").textContent = msg;
      appendHistory("buddy", msg);
      speakResponse(msg, "happy");
    } else {
      setRigEmotion("error", "Blocked");
      const failMsg = res?.message || `Could not open ${intent.url}.`;
      recordSessionAction(`Navigate to ${intent.url} failed: ${failMsg}`, "failed");
      $("statusText").textContent = failMsg;
      appendHistory("buddy", `⚠️ ${failMsg}`);
    }
    return true;
  }

  if (intent.type === "MULTI_STEP") {
    appendHistory("user", trimmed);
    $("promptInput").value = "";
    startMultiActionPlan(intent.instruction || trimmed, true);
    return true;
  }

  if (intent.type === "SELECT") {
    appendHistory("user", trimmed);
    $("promptInput").value = "";
    setRigEmotion("working", "Selecting…");
    $("statusText").textContent = `Selecting "${intent.value}"…`;
    let res = await sendRuntimeMessage({
      type: "EXECUTE_ACTION",
      action: "select",
      value: intent.value,
      options: { targetField: intent.targetField || "", text: intent.value },
    });
    if (!res?.ok) {
      res = await sendRuntimeMessage({
        type: "EXECUTE_ACTION",
        action: "select_custom_dropdown",
        value: intent.value,
        options: { targetField: intent.targetField || "", value: intent.value },
      });
    }
    if (res?.ok) {
      if (res.undoRecord) recordTaskContext({ undoRecord: res.undoRecord });
      setRigEmotion("happy", "Selected!");
      const msg = isHindi
        ? `✅ Dropdown mein "${intent.value}" select kar diya hai.`
        : `✅ ${res.message}`;
      recordSessionAction(`Selected "${intent.value}"`, "confirmed");
      $("statusText").textContent = msg;
      appendHistory("buddy", msg);
      speakResponse(msg, "happy");
    } else {
      setRigEmotion("idle", "Notice");
      const failMsg = res?.message || `Could not select "${intent.value}" on this page.`;
      recordSessionAction(failMsg, "failed");
      $("statusText").textContent = failMsg;
      appendHistory("buddy", `⚠️ ${failMsg}`);
    }
    return true;
  }

  if (intent.type === "CHECK") {
    appendHistory("user", trimmed);
    $("promptInput").value = "";
    setRigEmotion("working", intent.checked ? "Checking…" : "Unchecking…");
    const res = await sendRuntimeMessage({
      type: "EXECUTE_ACTION",
      action: intent.checked ? "check" : "uncheck",
      value: intent.target,
      options: { text: intent.target },
    });
    if (res?.ok) {
      setRigEmotion("happy", "Updated!");
      const msg = isHindi
        ? `✅ "${intent.target}" ko ${intent.checked ? "check" : "uncheck"} kar diya hai.`
        : `✅ ${res.message}`;
      recordSessionAction(`${intent.checked ? "Checked" : "Unchecked"} "${intent.target}"`, "confirmed");
      $("statusText").textContent = msg;
      appendHistory("buddy", msg);
      speakResponse(msg, "happy");
    } else {
      setRigEmotion("idle", "Notice");
      const failMsg = res?.message || `Could not find checkbox "${intent.target}".`;
      recordSessionAction(failMsg, "failed");
      $("statusText").textContent = failMsg;
      appendHistory("buddy", `⚠️ ${failMsg}`);
    }
    return true;
  }

  if (intent.type === "FORM_INSPECT") {
    appendHistory("user", trimmed);
    $("promptInput").value = "";
    setRigEmotion("thinking", "Inspecting…");
    $("statusText").textContent = "Inspecting visible form fields on active page…";

    const snapRes = await sendRuntimeMessage({ type: "GET_PAGE_SNAPSHOT" });
    const forms = snapRes?.snapshot?.forms || [];
    if (!snapRes?.ok || forms.length === 0) {
      setRigEmotion("confused", "No forms");
      const noFormMsg = isHindi
        ? "Is page par koi visible form input field detect nahi hua. Agar form neeche hai to scroll karein ya page check karein."
        : "No visible form fields were detected on this page. Try scrolling if the form is further down.";
      $("statusText").textContent = noFormMsg;
      appendHistory("buddy", noFormMsg);
      speakResponse(noFormMsg, "confused");
      return true;
    }

    const reqFields = [];
    const optFields = [];
    const filledFields = [];
    for (const f of forms) {
      const label = f.name || f.placeholder || f.role || f.tag || "Input field";
      const hasVal = Boolean(f.value && String(f.value).trim());
      if (hasVal) filledFields.push(label);
      else if (f.required || f.invalid) reqFields.push(label + (f.invalid ? " (invalid)" : ""));
      else optFields.push(label);
    }

    const docFields = activeUploadedDocument?.fields || {};
    const docMatches = [];
    if (Object.keys(docFields).length > 0) {
      for (const f of forms) {
        const fname = String(f.name || f.placeholder || "").toLowerCase();
        for (const dk of Object.keys(docFields)) {
          if (
            fname.includes(dk.toLowerCase()) ||
            (dk === "aadhaarNumber" && /aadhaar|aadhar|uid/i.test(fname)) ||
            (dk === "panNumber" && /\bpan\b/i.test(fname)) ||
            (dk === "phone" && /phone|mobile|contact/i.test(fname)) ||
            (dk === "pincode" && /pin|zip|postal/i.test(fname))
          ) {
            docMatches.push(f.name || f.placeholder || dk);
            break;
          }
        }
      }
    }

    const parts = [];
    if (isHindi) {
      parts.push(`📋 Is page ("${snapRes.snapshot.title || "Current Page"}") par ${forms.length} form fields hain:`);
      if (reqFields.length) parts.push(`• Required / Empty: ${reqFields.join(", ")}`);
      if (optFields.length) parts.push(`• Other Empty Fields: ${optFields.join(", ")}`);
      if (filledFields.length) parts.push(`• Already Filled: ${filledFields.join(", ")}`);
      if (docMatches.length > 0) {
        parts.push(`• ✅ Aapke uploaded ${activeUploadedDocument.documentType} se auto-fill ho sakte hain: ${[...new Set(docMatches)].join(", ")}. ("Is page ka form fill kar do" bolein)`);
      } else if (reqFields.length + optFields.length > 0) {
        parts.push(`• 💡 Aap apna Aadhaar/PAN/document 📎 Attach kar sakte hain ya chat mein details likh kar fill karwa sakte hain.`);
      }
    } else {
      parts.push(`📋 This form requires ${forms.length} field(s) on "${snapRes.snapshot.title || "Current Page"}":`);
      if (reqFields.length) parts.push(`• Required / Empty: ${reqFields.join(", ")}`);
      if (optFields.length) parts.push(`• Other Empty Fields: ${optFields.join(", ")}`);
      if (filledFields.length) parts.push(`• Already Filled: ${filledFields.join(", ")}`);
      if (docMatches.length > 0) {
        parts.push(`• ✅ Ready to auto-fill from uploaded ${activeUploadedDocument.documentType}: ${[...new Set(docMatches)].join(", ")}.`);
      }
    }
    const inspectMsg = parts.join("\n");
    setRigEmotion("happy", "Inspected");
    $("statusText").textContent = `Inspected ${forms.length} form field(s).`;
    appendHistory("buddy", inspectMsg);
    speakResponse(inspectMsg, "happy");
    return true;
  }

  if (intent.type === "CLICK") {
    appendHistory("user", trimmed);
    $("promptInput").value = "";

    if (intent.target === "__CURRENT__" && !intent.selector && !lastHighlightSelector) {
      setRigEmotion("confused", "Which one?");
      const needTargetMsg = isHindi
        ? "⚠️ Abhi koi element highlighted ya selected nahi hai. Kripya pehle element ka naam batayein (jaise 'Login button click karo') ya 'point karo' bolein."
        : "⚠️ No element is currently highlighted. Please name the button/link to click or ask me to point to it first.";
      $("statusText").textContent = needTargetMsg;
      appendHistory("buddy", needTargetMsg);
      speakResponse(needTargetMsg, "confused");
      return true;
    }

    // Consequential actions approval gate & permission ladder check
    const { permissionLevel, requireConsent } = await getPermissionSettings();
    let needsConfirm =
      permissionLevel === "suggest" ||
      (requireConsent !== false && Boolean(intent.isConsequential));
    try {
      const activeT = await queryActiveWebTab();
      const activeUrl = (activeT?.url || "").toLowerCase();
      const isGovSite = /\.gov(?:\.in)?|uidai|incometax|gst\.gov|parivahan|passportindia/i.test(activeUrl);
      if (isGovSite && /submit|final|apply|file\s+return|confirm|proceed/i.test(intent.target)) {
        needsConfirm = true;
      }
    } catch {}

    if (needsConfirm) {
      const resolvedSel =
        intent.selector ||
        (intent.target === "__CURRENT__" ? lastHighlightSelector || undefined : undefined);
      pendingAction = {
        type: intent.action || "click",
        selector: resolvedSel,
        value: intent.target,
        text: intent.target,
        candidateIndex: intent.candidateIndex,
        fallbackSelector: lastHighlightSelector || undefined,
      };
      if ($("confirmDesc")) {
        $("confirmDesc").textContent = isHindi
          ? `Kripya confirm karein: Buddy "${intent.target}" action execute karne ja raha hai. Kya aap proceed karna chahte hain?`
          : `Confirmation required: Buddy is about to execute "${intent.target}". Proceed?`;
      }
      if ($("confirmCard")) $("confirmCard").hidden = false;
      setRigEmotion("concerned", "Confirm");
      $("statusText").textContent = `Awaiting confirmation for ${intent.target}…`;
      return true;
    }

    setRigEmotion("pointing", "Clicking…");
    $("statusText").textContent =
      intent.target === "__CURRENT__"
        ? "Clicking highlighted element…"
        : `Clicking "${intent.target}" on active page…`;

    const resolvedSel =
      intent.selector ||
      (intent.target === "__CURRENT__" ? lastHighlightSelector || undefined : undefined);
    lastExecutionAttempt = {
      action: intent.action || "click",
      target: intent.target,
      selector: resolvedSel,
      at: Date.now(),
    };

    const res = await sendRuntimeMessage({
      type: "EXECUTE_ACTION",
      action: intent.action || "click",
      selector: resolvedSel,
      value: intent.target,
      options: {
        fallbackSelector: lastHighlightSelector || undefined,
        candidateIndex: intent.candidateIndex,
      },
    });

    if (res?.ambiguous && Array.isArray(res.candidates) && res.candidates.length > 1) {
      pendingDisambiguation = {
        action: res.action || intent.action || "click",
        target: intent.target,
        candidates: res.candidates,
      };
      const listText = res.candidates
        .map((c) => `${c.index}. "${c.text}"${c.context ? ` — [${c.context}]` : ` (${c.tag})`}`)
        .join("\n");
      const askMsg = isHindi
        ? `🤔 Page par "${intent.target}" ke ${res.candidates.length} alag-alag controls mile:\n${listText}\nKaunsa click karna hai? ("pehla", "doosra", ya number 1-${res.candidates.length} likhein)`
        : `🤔 Found ${res.candidates.length} controls matching "${intent.target}":\n${listText}\nWhich one should I click? Reply with 1-${res.candidates.length} (e.g. "first", "second").`;
      setRigEmotion("confused", "Which one?");
      $("statusText").textContent = `Clarification needed for "${intent.target}"`;
      appendHistory("buddy", askMsg);
      recordSessionAction(`Asked user to pick among ${res.candidates.length} "${intent.target}" controls`, "unconfirmed");
      speakResponse(askMsg, "confused");
      return true;
    }

    if (res?.stale) {
      lastHighlightSelector = null;
    }

    if (res?.ok) {
      const hasErrFb = Boolean(res.hasErrorFeedback);
      const isOpenLink = (res.action || intent.action) === "open_link";
      setRigEmotion(
        hasErrFb ? "concerned" : "success",
        hasErrFb ? "Notice" : isOpenLink ? "Opened!" : "Clicked!",
      );
      const clickedName = res.text || intent.target;
      let outcome = isOpenLink
        ? isHindi
          ? `Maine link "${clickedName}" khol diya hai${res.newUrl ? ` (${res.newUrl})` : ""}!`
          : `Opened link "${clickedName}"${res.newUrl ? ` -> ${res.newUrl}` : ""}!`
        : isHindi
          ? `Maine page par "${clickedName}" click kar diya hai!`
          : `Successfully clicked "${clickedName}"!`;
      if (res.stateChange === "navigated") {
        lastHighlightSelector = null;
        if (!isOpenLink) {
          outcome += isHindi ? ` Page naye URL par navigate ho gaya.` : ` Page navigated.`;
        }
      } else if (res.stateChange === "modal_opened") {
        outcome += isHindi ? ` Dialog/popup open ho gaya.` : ` Modal dialog opened.`;
      } else if (res.stateChange === "toggled" || res.stateChange === "selected") {
        outcome += ` (${res.stateChange})`;
      }
      if (Array.isArray(res.pageFeedback) && res.pageFeedback.length > 0) {
        outcome += isHindi
          ? `\nPage ka jawab: "${res.pageFeedback[0]}"`
          : `\nPage reported: "${res.pageFeedback[0]}"`;
      }
      recordSessionAction(outcome, hasErrFb ? "unconfirmed" : "confirmed");
      $("statusText").textContent = outcome;
      appendHistory("buddy", `${hasErrFb ? "⚠️" : "✅"} ${outcome}`);
      speakResponse(outcome, hasErrFb ? "concerned" : "success");
    } else {
      setRigEmotion("error", "Not found");
      const failMsg =
        res?.message ||
        (isHindi
          ? `Active page par "${intent.target}" button nahi mila. Kripya check karein ya page scroll karein.`
          : `Could not find button "${intent.target}" on this page.`);
      recordSessionAction(failMsg, "failed");
      $("statusText").textContent = failMsg;
      appendHistory("buddy", `⚠️ ${failMsg}`);
    }
    return true;
  }

  if (intent.type === "POINT") {
    appendHistory("user", trimmed);
    $("promptInput").value = "";
    // STRICT RULE: NEVER CLICK
    await executeFind(intent.target, "point");
    return true;
  }

  if (intent.type === "FIND") {
    appendHistory("user", trimmed);
    $("promptInput").value = "";
    // STRICT RULE: NEVER CLICK
    await executeFind(intent.target);
    return true;
  }

  if (intent.type === "FORM_FILL") {
    appendHistory("user", trimmed);
    $("promptInput").value = "";

    // 1. Uploaded document auto-fill ("Aadhaar details fill kar do", "is page ka form fill kar do", "Is field mein Aadhaar number daalo")
    if (intent.useUploadedDocument) {
      if (!activeUploadedDocument || Object.keys(activeUploadedDocument.fields || {}).length === 0) {
        setRigEmotion("confused", "Need Doc");
        const askDocMsg = isHindi
          ? "📄 Abhi koi readable document upload nahi hai. Kripya neeche 📎 Attach button se apna Aadhaar, PAN, invoice ya PDF/image upload karein—main kabhi bhi fake details nahi banata."
          : "📄 No readable document is uploaded yet. Please attach your Aadhaar, PAN, invoice, or ID image/PDF using 📎 Attach so I can fill verified details without guessing.";
        $("statusText").textContent = "Please upload a document to auto-fill.";
        appendHistory("buddy", askDocMsg);
        speakResponse(askDocMsg, "confused");
        return true;
      }

      if (activeUploadedDocument.conflicts?.length > 0) {
        setRigEmotion("concerned", "Clarify");
        const conflictSummary = activeUploadedDocument.conflicts
          .map((c) => `${c.field} ("${c.prev}" vs "${c.next}")`)
          .join(", ");
        const askConflictMsg = isHindi
          ? `⚠️ Uploaded documents mein in fields ki alag-alag values hain: ${conflictSummary}. Kripya confirm karein ki kaunsi value fill karni hai.`
          : `⚠️ Conflicting values detected across uploaded documents for: ${conflictSummary}. Please clarify which value you want me to enter.`;
        $("statusText").textContent = "Clarification needed for conflicting document data.";
        appendHistory("buddy", askConflictMsg);
        speakResponse(askConflictMsg, "concerned");
        return true;
      }

      const docFields = activeUploadedDocument.fields;
      let explicitPairs = [];

      if (intent.targetCurrentBox && intent.requestedDocKeys?.length) {
        const docKey = intent.requestedDocKeys[0];
        const val = docFields[docKey];
        if (!val) {
          const missMsg = isHindi
            ? `⚠️ Uploaded document mein "${docKey}" clear nahi mila. Kripya ise manually enter karein.`
            : `⚠️ Uploaded document did not contain a clear value for "${docKey}". Please enter it directly.`;
          appendHistory("buddy", missMsg);
          return true;
        }
        explicitPairs.push({
          target: "__CURRENT__",
          value: val,
          overwrite: Boolean(intent.overwrite),
        });
      } else if (intent.requestedDocKeys?.length) {
        const missingReq = [];
        for (const k of intent.requestedDocKeys) {
          if (docFields[k]) {
            explicitPairs.push({ target: k, value: docFields[k], overwrite: Boolean(intent.overwrite) });
          } else {
            missingReq.push(k);
          }
        }
        if (missingReq.length > 0 && explicitPairs.length === 0) {
          const missMsg = isHindi
            ? `⚠️ Uploaded document mein yeh requested fields clear nahi mile: ${missingReq.join(", ")}.`
            : `⚠️ Could not find clear values in uploaded document for: ${missingReq.join(", ")}.`;
          appendHistory("buddy", missMsg);
          return true;
        }
      } else {
        explicitPairs = Object.entries(docFields)
          .filter(([, v]) => Boolean(v))
          .map(([k, v]) => ({ target: k, value: v, overwrite: Boolean(intent.overwrite) }));
      }

      await startSmartFormFill(null, {
        explicitPairs,
        overwrite: Boolean(intent.overwrite),
        explicitUserProvided: true,
        fromUploadedDocument: true,
      });

      if (activeUploadedDocument.ambiguousFields?.length > 0) {
        const ambMsg = isHindi
          ? `ℹ️ Note: Document mein yeh fields unclear/blurry the aur auto-fill nahi kiye gaye: ${activeUploadedDocument.ambiguousFields.join(", ")}.`
          : `ℹ️ Note: These fields were unclear in the document and were not guessed: ${activeUploadedDocument.ambiguousFields.join(", ")}.`;
        appendHistory("buddy", ambMsg);
      }
      return true;
    }

    // 2. User named specific fields (e.g. "Pehle naam fill karo, phir mobile number") without values:
    // Check uploaded document first, then non-sensitive userProfile; otherwise ask cleanly!
    if (intent.requestedFieldNames && intent.requestedFieldNames.length > 0 && !intent.explicitPairs) {
      const userProfile = await getScopedProfile();
      const docFields = activeUploadedDocument?.fields || {};
      const matchedPairs = [];
      const missingFields = [];
      for (const fname of intent.requestedFieldNames) {
        const normF = fname.toLowerCase();
        const docVal =
          (normF.includes("naam") || normF.includes("name") ? docFields.name : undefined) ||
          (normF.includes("mobile") || normF.includes("phone") ? docFields.phone : undefined) ||
          (normF.includes("email") ? docFields.email : undefined) ||
          (normF.includes("address") || normF.includes("pata") ? docFields.address : undefined) ||
          (normF.includes("aadhaar") || normF.includes("aadhar") ? docFields.aadhaarNumber : undefined) ||
          (normF.includes("pan") ? docFields.panNumber : undefined) ||
          (normF.includes("dob") ? docFields.dob : undefined) ||
          (normF.includes("pin") ? docFields.pincode : undefined);
        const savedVal =
          docVal ||
          userProfile?.[normF] ||
          (normF.includes("naam") || normF.includes("name") ? userProfile?.name : undefined) ||
          (normF.includes("mobile") || normF.includes("phone") ? userProfile?.phone : undefined) ||
          (normF.includes("email") ? userProfile?.email : undefined);
        if (savedVal) {
          matchedPairs.push({ target: normF, value: savedVal, overwrite: false });
        } else {
          missingFields.push(fname);
        }
      }
      if (matchedPairs.length > 0) {
        await startSmartFormFill(null, {
          explicitPairs: matchedPairs,
          explicitUserProvided: true,
          fromUploadedDocument: Boolean(activeUploadedDocument),
        });
      }
      if (missingFields.length > 0) {
        const askMsg = isHindi
          ? `Main in fields ko fill karne ke liye ready hoon: ${missingFields.join(", ")}. Kripya inki values likhein ya document 📎 Attach karein taaki main bina guess kiye sahi details bhar sakoon!`
          : `I am ready to fill: ${missingFields.join(", ")}. Please share the exact values or attach a document so I never invent your personal info.`;
        appendHistory("buddy", askMsg);
        $("statusText").textContent = "Waiting for field values…";
        speakResponse(askMsg, "curious");
      }
      return true;
    }

    // 3. Explicit key-value pairs OR generic "form fill kar do" without document
    if (!intent.explicitPairs && !intent.fields) {
      const SENSITIVE_PROFILE_RE =
        /pass|otp|(?<!postal[\s_-])(?<![a-z0-9])pin(?![a-z0-9]|[\s_-]*code\b)|cvv|cvc|secret|token|card|aadhaar|aadhar|\bpan\b|ifsc|account/i;
      const EPHEMERAL_PROFILE_RE =
        /^(?:__current__|search|query|q|chat|msg|message|comment|comments|prompt|note|notes|subject|title)$/i;
      // Check saved non-sensitive userProfile before asking user step-by-step
      const userProfile = await getScopedProfile();
      const profilePairs = userProfile
        ? Object.entries(userProfile)
            .filter(([k, v]) => {
              const kTrim = String(k || "").trim();
              return (
                kTrim &&
                kTrim.length <= 40 &&
                !SENSITIVE_PROFILE_RE.test(kTrim) &&
                !EPHEMERAL_PROFILE_RE.test(kTrim) &&
                typeof v === "string" &&
                v.trim()
              );
            })
            .map(([k, v]) => ({ target: k, value: v, overwrite: false }))
        : [];
      if (profilePairs.length > 0) {
        await startSmartFormFill(null, {
          explicitPairs: profilePairs,
          overwrite: Boolean(intent.overwrite),
          explicitUserProvided: true,
          fromFormSession: true,
        });
        return true;
      }

      // Inspect form first & start an interactive step-by-step form session without inventing fake details!
      setRigEmotion("curious", "Need Details");
      const snapRes = await sendRuntimeMessage({ type: "GET_PAGE_SNAPSHOT" });
      const emptyFields = (snapRes?.snapshot?.forms || [])
        .filter((f) => f.visible !== false && !f.disabled && !String(f.value || "").trim())
        .map((f, idx) => ({
          index: idx + 1,
          label: f.name || f.label || f.placeholder || f.id || `Field ${idx + 1}`,
          selector: f.selector,
          name: f.name || f.id || "",
          type: f.type || f.tag || "text",
        }));
      const fieldNames = emptyFields.map((f) => f.label).filter(Boolean).slice(0, 8);

      if (emptyFields.length > 0) {
        const firstField = emptyFields[0];
        activeFormSession = {
          active: true,
          filledFields: [],
          lastFilled: null,
          remainingFields: emptyFields,
          awaitingField: firstField,
        };
        pendingSlot = {
          type: "fill_value",
          targetField: firstField.label || "__CURRENT__",
          targetSelector: firstField.selector || undefined,
          fromFormSession: true,
        };
        if (firstField.selector) {
          lastHighlightSelector = firstField.selector;
          lastCallout = {
            title: `Fill: ${firstField.label}`,
            description: "Waiting for your value",
          };
          pointArmAtElement().catch(() => {});
        }
        const askDetailsMsg = isHindi
          ? `📋 Main is form ko fill karne ke liye ready hoon (${emptyFields.length} fields: ${fieldNames.join(", ")}). Main bina aapki jankari ke fake details nahi bharunga.\nSabse pehle **${firstField.label}** mein kya bharna hai?`
          : `📋 I'm ready to fill this form (${emptyFields.length} fields: ${fieldNames.join(", ")}). I never invent personal details.\nFirst, what should I enter in **${firstField.label}**?`;
        $("statusText").textContent = `Waiting for ${firstField.label}…`;
        appendHistory("buddy", askDetailsMsg);
        recordConversationTurn(trimmed, askDetailsMsg);
        speakResponse(askDetailsMsg, "curious", {
          autoListenOnFinish: true,
          autoListenReason: "incomplete_form_fill",
        });
        return true;
      }

      const askDetailsMsg = isHindi
        ? `📋 Is page par koi khali form field nahi mila. Agar kisi specific box mein kuch likhna ho to batayein.`
        : `📋 I didn't find any empty form fields on this page. Tell me which field and value you'd like me to enter.`;
      $("statusText").textContent = "No empty form fields detected.";
      appendHistory("buddy", askDetailsMsg);
      speakResponse(askDetailsMsg, "curious");
      return true;
    }

    await startSmartFormFill(intent.fields, {
      explicitPairs: intent.explicitPairs,
      overwrite: Boolean(intent.overwrite),
      explicitUserProvided: Boolean(intent.explicitUserProvided),
      fromChatCommand: Boolean(intent.fromChatCommand ?? true),
      fromFormSession: Boolean(intent.fromFormSession),
      noSubmitPrompt: Boolean(intent.noSubmitPrompt),
    });
    return true;
  }

  if (intent.type === "EXTRACT") {
    appendHistory("user", trimmed);
    $("promptInput").value = "";
    setRigEmotion("working", "Extracting…");
    $("statusText").textContent = `Extracting ${intent.target} from page…`;

    const res = await sendRuntimeMessage({
      type: "EXECUTE_ACTION",
      action: "copy_to_clipboard",
      value: intent.target,
      options: { limit: 10 },
    });

    if (res?.ok) {
      setRigEmotion("happy", "Extracted");
      const msg = `📋 ${res.message || "Extracted data to clipboard."}\nItems:\n${(res.copiedItems || []).map((it) => `• ${it}`).join("\n")}`;
      appendHistory("buddy", msg);
      $("statusText").textContent = res.message;
      speakResponse(
        isHindi ? `Data extract karke clipboard mein copy kar diya hai.` : `Extracted data to clipboard.`,
        "happy",
      );
    } else {
      setRigEmotion("idle", "Idle");
      const failMsg = res?.message || "Could not find matching tabular or list items to extract.";
      appendHistory("buddy", `⚠️ ${failMsg}`);
      $("statusText").textContent = failMsg;
    }
    return true;
  }

  return false;
}

async function sendQuery(question, intent, options = {}) {
  if (busy || !question || !question.trim()) return;

  // Interrupt active speech if user sends a new message
  if (isBuddySpeaking && !options?.fromVoice) {
    interruptBuddySpeech({ resumeListening: false });
  }

  // Always dismiss any existing confirmation cards unless confirming them
  const trimmed = question.trim();
  const parserCtx = {
    pendingSlot,
    pendingDisambiguation,
    hasPendingAction: Boolean(pendingAction),
    session: sessionTaskContext,
    activeFormSession,
  };

  // 0. Automatic Privacy Gesture Trigger (never logs sensitive data, turns head+torso away & closes eyes)
  const privacyCheck = window.Buddy3DRuntime?.detectPrivacyTrigger?.({ userText: trimmed });
  if (privacyCheck?.isPrivacy) {
    setRigEmotion("privacy", "Privacy");
    if (privacyCheck.reason === "explicit_request") {
      const active = getActiveBuddy();
      const isHindi = active.defaultLanguage !== "english";
      appendHistory("user", trimmed);
      $("promptInput").value = "";
      const pMsg = isHindi
        ? "🙈 Theek hai, maine apna chehra ghuma liya hai aur aankhein band kar li hain (Privacy Mode). Note: Yeh ek expressive companion posture hai; sensitive password/OTP/CVV fields par automated interaction hamesha blocked rehta hai."
        : "🙈 Got it — I have turned away and closed my eyes in Privacy Mode. Note: This is an expressive companion posture; sensitive password, OTP, and payment fields remain excluded from automated interaction.";
      $("statusText").textContent = "Privacy Mode active — Buddy turned away.";
      appendHistory("buddy", pMsg);
      speakResponse(pMsg, "privacy");
      return;
    }
  }

  // 0b. Ordinal disambiguation follow-up ("pehla", "doosra", "teesra", "2", "2nd option")
  if (pendingDisambiguation && Array.isArray(pendingDisambiguation.candidates)) {
    const pickedIdx = resolveOrdinalChoiceIndex(trimmed);
    const active = getActiveBuddy();
    const isHindi = active.defaultLanguage !== "english";
    if (pickedIdx !== null) {
      if (pickedIdx >= 1 && pickedIdx <= pendingDisambiguation.candidates.length) {
        const chosen = pendingDisambiguation.candidates[pickedIdx - 1];
        const disAction = pendingDisambiguation.action;
        const disTarget = pendingDisambiguation.target;
        pendingDisambiguation = null;

        if (disAction === "point" || disAction === "find") {
          appendHistory("user", trimmed);
          $("promptInput").value = "";
          await executeFind(disTarget, disAction, { targetIndex: pickedIdx - 1 });
          return;
        }

        if (disAction === "open_url" && chosen.url) {
          appendHistory("user", trimmed);
          $("promptInput").value = "";
          await executeNaturalBrowserAction(
            { type: "NAVIGATE", url: chosen.url, label: chosen.text },
            trimmed,
          );
          return;
        }
        const isConseq =
          /purchase|buy|pay|delete|remove account|confirm payment|place\s*order|checkout|confirm\s*order|\bsubmit\b|file\s*return/i.test(
            `${chosen.text || ""} ${disTarget || ""}`,
          );
        await executeNaturalBrowserAction(
          {
            type: "CLICK",
            action: disAction === "open_link" ? "open_link" : "click",
            target: chosen.text || disTarget,
            selector: chosen.selector,
            candidateIndex: pickedIdx,
            isConsequential: isConseq,
          },
          trimmed,
        );
        return;
      } else {
        appendHistory("user", trimmed);
        $("promptInput").value = "";
        const rangeMsg = isHindi
          ? `⚠️ Sirf ${pendingDisambiguation.candidates.length} options hain (1 se ${pendingDisambiguation.candidates.length} ke beech batayein).`
          : `⚠️ Please choose a number between 1 and ${pendingDisambiguation.candidates.length}.`;
        appendHistory("buddy", rangeMsg);
        return;
      }
    }
    // Keep disambiguation when user says "bss ye wala" OR asks underspecified "ab click karo" without picking an index
    const normForDisCheck = normalizeHinglishCommand(stripBuddyPrefix(trimmed)).toLowerCase();
    const isUnderspecifiedClick =
      /^(?:(?:ab|now|phir|fir|then|yahan|yaha|yha|here|isko|this|is\s+(?:par|pe|pr)|us\s+(?:par|pe|pr))\s+)?(?:(?:par|pe|pr|ko)\s+)?(?:click\s*(?:karo|kro|(?:kar|kr)\s*do|kijiye|do)?|press\s*(?:karo|kro|(?:kar|kr)\s*do)|tap\s*(?:karo|kro|(?:kar|kr)\s*do)|dabao|daba\s*do)[.!?\s]*$/i.test(
        normForDisCheck,
      );
    if (!/^(?:bas\s+)?(?:yahi|ye|yeh)\s*(?:wala|wali|wale)?[.!?\s]*$/i.test(trimmed) && !isUnderspecifiedClick) {
      pendingDisambiguation = null;
    }
  }

  // 1. Unified Natural Language Browser Action Intent Parser & Dispatcher
  const parsed = parseActionIntent(trimmed, parserCtx);
  if (parsed.type !== "CONFIRM_PENDING" && parsed.type !== "CANCEL_PENDING") {
    if ($("confirmCard")) $("confirmCard").hidden = true;
    pendingAction = null;
  }
  const prevPendingSlot = pendingSlot;
  const handled = await executeNaturalBrowserAction(parsed, trimmed);
  if (handled) {
    if (parsed.type === "FORM_FILL" && pendingSlot && pendingSlot === prevPendingSlot) {
      pendingSlot = null;
    }
    return;
  }

  busy = true;
  $("sendBtn").disabled = true;
  $("sendBtn").classList.add("is-loading");
  $("sendBtn").innerHTML = '<span class="btn-spinner"></span> Thinking…';

  const historyPayload = getRecentHistoryContext();
  appendHistory("user", trimmed);
  $("promptInput").value = "";

  showChatLoadingSpinner("Buddy is thinking & analyzing…");

  setRigEmotion("thinking", "Thinking…");
  $("statusText").textContent = "Inspecting active webpage & reasoning…";
  $("highlightBtn").hidden = true;
  $("speakAnswerBtn").hidden = true;

  try {
    const active = getActiveBuddy();
    const isHindi = active.defaultLanguage !== "english";
    const { preferredModel, selectedProvider: storedProvider } = await chrome.storage.local.get([
      "preferredModel",
      "selectedProvider",
    ]);
    const activeProv = selectedProvider || storedProvider || "auto";
    const pageToggleEl = $("pageContextToggle");
    const pageVisionActive = pageToggleEl
      ? pageToggleEl.type === "checkbox"
        ? pageToggleEl.checked
        : pageToggleEl.classList.contains("active")
      : true;
    const detachPage = !pageVisionActive;
    const hasActiveTaskState = Boolean(pendingSlot || pendingDisambiguation || activeFormSession?.active);
    const hasExplicitPageRef = /\b(?:this\s+page|current\s+page|active\s+page|this\s+webpage|webpage|website\s+par|is\s+page|ye\s+page|yeh\s+page|page\s+(?:par|pe|pr|mein|me|kya|explain|summary|summarize|overview|errors?|issues?|alerts?|headings?|links?|buttons?|forms?|tables?)|on\s+this\s+screen|screen\s+(?:par|pe)|visible\s+(?:here|on\s+page)|is\s+form|ye\s+form|this\s+form|(?:1st|2nd|3rd|4th|first|second|third|fourth|last|next|pehl[aei]|doosr[aei]|teesr[aei]|aakhri)\s+(?:field|box|input|textbox|wal[aei])|these\s+products?|this\s+product|ye\s+product|in\s+dono|compare\s+these|these\s+items|is\s+table|this\s+table|duplicate\s+entries|rto\s+orders?|orders?\s+tab|is\s+button|this\s+button|is\s+field|ismein|isme|isko|yahan|yaha|here\s+on|ord-\d+)\b/i.test(
      trimmed,
    );
    const isActionCmd = isLikelyActionCommand(trimmed);
    const isCreativeGeneralWriting =
      /\b(?:write|draft|compose)\s+(?:a|an|me)?\s*(?:professional\s+)?(?:email|letter|essay|poem|story|post|caption|code|script|sql|function|message|reply|bio)\b/i.test(
        trimmed,
      ) && !hasExplicitPageRef;
    const lastAssistantMsg = historyPayload.length
      ? [...historyPayload].reverse().find((h) => h.role === "assistant")?.content || ""
      : "";
    const isPageFollowUp =
      /^(?:and\s+)?(?:ab|now|then|uske\s+baad|next|what\s+about\s+that|why\s+is\s+it|how\s+to\s+fix\s+it|is\s+that\s+good)\b/i.test(
        trimmed,
      ) &&
      /\b(?:highlighted|clicked|filled|orders?\s+tab|active\s+page|form\s+field|selector|element)\b/i.test(
        lastAssistantMsg,
      );
    const isGeneralChatQuery =
      detachPage ||
      (!intent &&
        !hasActiveTaskState &&
        !hasExplicitPageRef &&
        !isPageFollowUp &&
        (isCreativeGeneralWriting || !isActionCmd));

    const shouldInterpretWithGemini =
      !detachPage &&
      !isGeneralChatQuery &&
      !options?.fromGeminiInterpret &&
      (isActionCmd || hasActiveTaskState || Boolean(sessionTaskContext.lastTargetField));
    const finalIntent = isGeneralChatQuery
      ? "general"
      : shouldInterpretWithGemini && (!intent || intent === "answer")
        ? "interpret_command"
        : intent || "answer";
    const uploadedDocumentSummary = activeUploadedDocument
      ? {
          fileName: activeUploadedDocument.fileName,
          documentType: activeUploadedDocument.documentType || "other",
          availableFields: Object.keys(activeUploadedDocument.fields || {}),
        }
      : undefined;
    const actionContextPayload = {
      lastTargetField: sessionTaskContext.lastTargetField || null,
      lastActionType: sessionTaskContext.lastActionType || null,
      pendingSlotType: pendingSlot?.type || null,
      activeElementLabel: lastCallout?.title || null,
      recentFields: sessionTaskContext.recentFields || [],
    };
    const res = await sendRuntimeMessage({
      type: "ASK",
      question: trimmed,
      intent: finalIntent,
      actionContext: actionContextPayload,
      history: historyPayload,
      uploadedDocumentSummary,
      buddySlug: active.slug,
      customBuddyId: active.isCustom ? active.id || active.slug.replace("custom:", "") : undefined,
      preferredProvider: activeProv,
      preferredModel: preferredModel && preferredModel !== "auto" ? preferredModel : undefined,
    });

    hideChatLoadingSpinner();

    if (!res || res.error || res.activeProvider === "error") {
      setRigEmotion("error", "Unavailable");
      const errMsg =
        res?.pageReadable === false && !isGeneralChatQuery
          ? "I cannot read the current webpage right now. Please refresh or allow page access."
          : res?.reply?.answer ||
            res?.providerFailure?.message ||
            res?.message ||
            res?.error ||
            "I encountered an issue reaching AI Buddy. Please verify your AI provider key or connection.";
      $("statusText").textContent = res?.providerFailure?.message || errMsg;
      appendHistory("buddy", errMsg);
      if (res?.providerWarning || res?.providerFailure) {
        appendProviderWarningNotice(res.providerWarning, res.providerFailure);
      }
      return;
    }

    currentAnswer =
      res.clarificationQuestion ||
      res.reply?.clarificationQuestion ||
      res.reply?.answer ||
      "I am ready to help!";
    appendHistory("buddy", currentAnswer);
    recordConversationTurn(trimmed, currentAnswer);

    if (res.orchestration || res.sessionContext || res.costTelemetry) {
      updateLiveOrchestrationState(
        res.orchestration || null,
        res.sessionContext || null,
        res.costTelemetry || res.sessionContext?.costTelemetry || null,
      );
    }
    if (Array.isArray(res.proactiveSuggestions) && res.proactiveSuggestions.length > 0) {
      renderProactiveSuggestionsUI(res.proactiveSuggestions);
    }
    if (res.workflowDraft) {
      showWorkflowDraftPreview(res.workflowDraft);
    }

    if (res.providerWarning || res.providerFailure) {
      appendProviderWarningNotice(res.providerWarning, res.providerFailure);
    }
    if (res.aiFallbackUsed || res.activeProvider === "local_grounded") {
      const failureReason = res.providerFailure?.message || res.providerWarning?.message;
      $("statusText").textContent = failureReason
        ? `Local Helper Mode — ${failureReason}`
        : isHindi
          ? "Local Helper Mode (AI provider unavailable)"
          : "Local Helper Mode (AI provider unavailable)";
    }

    const modeRec =
      res.recommendedMode || getLocalModeRecommendation(trimmed, active.slug, active.defaultLanguage);
    if (modeRec) {
      appendModeRecommendationNotice(modeRec);
    }

    // If AI returned a clarifying question ("Kya likhna hai? Text bata do."), store pendingSlot only when asking for a field value
    if (res.actionType === "ask_clarification" || res.needsClarification || res.reply?.needsClarification) {
      const wantsFillValue = res.reply?.needs === "value_to_fill" || Boolean(res.targetField);
      if (wantsFillValue) {
        pendingSlot = {
          type: "fill_value",
          targetField: res.targetField || res.targetText || sessionTaskContext.lastTargetField || "__CURRENT__",
          targetSelector: res.targetSelector || res.highlightSelector || undefined,
          noSubmitPrompt: Boolean(
            res.targetField && /\b(?:search|chat|msg|message|comment|prompt|query)\b/i.test(String(res.targetField)),
          ),
        };
        recordTaskContext({
          actionType: "ask_clarification",
          targetField: pendingSlot.targetField,
          targetSelector: pendingSlot.targetSelector || null,
        });
      }
      lastHighlightSelector = res.highlightSelector || res.targetSelector || null;
      if (lastHighlightSelector) {
        $("highlightBtn").hidden = false;
        pointArmAtElement();
      }
      setRigEmotion("curious", "Clarify");
      if (!(res.aiFallbackUsed || res.activeProvider === "local_grounded")) {
        $("statusText").textContent = "Awaiting clarification…";
      }
      speakResponse(currentAnswer, "curious");
      return;
    }

    // If AI planned real action(s), execute them instead of only explaining!
    const CONSEQUENTIAL_RE =
      /pay|checkout|purchase|\bbuy\b|place\s*order|delete|remove\s*account|confirm\s*order|\bsubmit\b|file\s*return/i;
    const { permissionLevel, requireConsent } = await getPermissionSettings();
    const consentRequired = requireConsent !== false;
    const readOnlyMode = permissionLevel === "observe" || permissionLevel === "explain";

    if (readOnlyMode && (res.steps?.length || (res.actionType && res.actionType !== "point" && res.actionType !== "inspect" && res.actionType !== "explain_page"))) {
      if (res.highlightSelector || res.targetSelector) {
        lastHighlightSelector = res.highlightSelector || res.targetSelector;
      }
      appendHistory(
        "buddy",
        isHindi
          ? `🛡️ Permission level "${permissionLevel}" active hai, isliye page action auto-run nahi kiya gaya.`
          : `🛡️ Permission level "${permissionLevel}" is active, so automated page changes were skipped.`,
      );
    } else if (Array.isArray(res.steps) && res.steps.length > 0) {
      const planId = `plan_ai_${Date.now()}`;
      activePlan = {
        id: planId,
        title: trimmed.length > 45 ? trimmed.slice(0, 42) + "..." : trimmed,
        originalInstruction: trimmed,
        steps: res.steps.map((s, idx) => ({
          id: `${planId}_${idx + 1}`,
          stepNumber: idx + 1,
          title: s.title || `${s.action || "step"} ${s.textTarget || ""}`.trim(),
          action: s.action || "click",
          textTarget: s.textTarget || undefined,
          value: s.value || undefined,
          url: s.url || undefined,
          filenameHint: s.filenameHint || undefined,
          expectedText: s.expectedText || undefined,
          waitMs: s.waitMs || undefined,
          alternateTargets: Array.isArray(s.alternateTargets) ? s.alternateTargets : undefined,
          selector: s.selector || undefined,
          requiresApproval:
            permissionLevel === "suggest" ||
            (consentRequired &&
              (Boolean(s.isConsequential) ||
                CONSEQUENTIAL_RE.test(`${s.title || ""} ${s.textTarget || ""}`))),
          status: "pending",
        })),
        currentStepIndex: 0,
        status: "pending",
        extractedData: [],
      };
      isPlanPaused = false;
      pendingApprovalStep = null;
      if ($("consequentialApprovalCard")) $("consequentialApprovalCard").hidden = true;
      if ($("planRetryBtn")) $("planRetryBtn").hidden = true;
      renderTaskPlanUI();
      await runPlanLoop();
    } else if (res.actionType === "download") {
      if (res.targetValue && /^https?:\/\//i.test(String(res.targetValue))) {
        const dlRes = await sendRuntimeMessage({ type: "DOWNLOAD_FILE", url: res.targetValue });
        recordSessionAction(dlRes?.ok ? `Downloaded ${dlRes.filename || res.targetValue}` : "Download failed", dlRes?.ok ? "confirmed" : "failed");
      } else if (res.targetSelector || res.targetText) {
        await sendRuntimeMessage({
          type: "EXECUTE_ACTION",
          action: "click",
          selector: res.targetSelector || undefined,
          value: res.targetText || "download",
          options: { trackDownload: true },
        });
      }
    } else if (res.actionType === "web_search" || res.actionType === "open_website") {
      const dest = resolveWebsiteDestination(
        res.targetText || res.targetValue || trimmed,
        res.actionType === "web_search",
      );
      if (dest.ambiguous && Array.isArray(dest.options) && dest.options.length > 1) {
        pendingDisambiguation = {
          action: "open_url",
          target: dest.label,
          candidates: dest.options.map((opt, idx) => ({
            index: idx + 1,
            text: opt.label,
            url: opt.url,
            tag: "portal",
          })),
        };
        const askPortalMsg = `${dest.label}: ${dest.options.map((o, i) => `${i + 1}. ${o.label}`).join(" | ")}`;
        appendHistory("buddy", askPortalMsg);
      } else {
        await sendRuntimeMessage({ type: "NAVIGATE_TAB", url: dest.url });
        recordSessionAction(`Navigated to ${dest.url}`, "confirmed");
      }
    } else if (res.actionType === "search_submit" && (res.targetValue || res.targetText)) {
      await sendRuntimeMessage({
        type: "EXECUTE_ACTION",
        action: "search_submit",
        selector: res.targetSelector || undefined,
        value: String(res.targetValue || res.targetText),
      });
      recordTaskContext({ actionType: "search_submit", targetField: "search" });
    } else if (res.actionType === "point") {
      // Strictly highlight/point without clicking
      lastHighlightSelector = res.highlightSelector || res.targetSelector || null;
      recordTaskContext({
        actionType: "point",
        targetField: res.targetText || res.calloutTitle || null,
        targetSelector: lastHighlightSelector,
      });
    } else if (
      (res.actionType === "click" || res.actionType === "open_link") &&
      (res.targetSelector || res.targetText)
    ) {
      const actionLabel = res.targetText || res.targetSelector || "target";
      if (permissionLevel === "suggest" || (consentRequired && CONSEQUENTIAL_RE.test(actionLabel))) {
        pendingAction = {
          type: res.actionType === "open_link" ? "open_link" : "click",
          selector: res.targetSelector || undefined,
          value: res.targetText || undefined,
          text: actionLabel,
        };
        if ($("confirmDesc")) {
          $("confirmDesc").textContent = isHindi
            ? `Kripya confirm karein: Buddy "${actionLabel}" execute karne ja raha hai. Proceed?`
            : `Confirmation required: Buddy is about to execute "${actionLabel}". Proceed?`;
        }
        if ($("confirmCard")) $("confirmCard").hidden = false;
        setRigEmotion("concerned", "Confirm");
        $("statusText").textContent = `Awaiting confirmation for ${actionLabel}…`;
      } else {
        setRigEmotion("working", res.actionType === "open_link" ? "Opening" : "Acting");
        const execActionName = res.actionType === "open_link" ? "open_link" : "click";
        const clickRes = await sendRuntimeMessage({
          type: "EXECUTE_ACTION",
          action: execActionName,
          selector: res.targetSelector || undefined,
          value: res.targetText || undefined,
        });
        if (clickRes?.ambiguous && Array.isArray(clickRes.candidates) && clickRes.candidates.length > 1) {
          pendingDisambiguation = {
            action: execActionName,
            target: actionLabel,
            candidates: clickRes.candidates,
          };
          const listText = clickRes.candidates
            .map((c) => `${c.index}. "${c.text}"${c.context ? ` — [${c.context}]` : ` (${c.tag})`}`)
            .join("\n");
          const askMsg = isHindi
            ? `🤔 "${actionLabel}" ke ${clickRes.candidates.length} controls mile:\n${listText}\nKaunsa chahiye?`
            : `🤔 Found ${clickRes.candidates.length} controls matching "${actionLabel}":\n${listText}\nWhich one should I pick?`;
          setRigEmotion("confused", "Which one?");
          $("statusText").textContent = askMsg;
          appendHistory("buddy", askMsg);
          recordSessionAction(
            `Asked user to pick among ${clickRes.candidates.length} "${actionLabel}" controls`,
            "unconfirmed",
          );
          speakResponse(askMsg, "confused");
        } else if (clickRes?.ok) {
          const hasErrFb = Boolean(clickRes.hasErrorFeedback);
          setRigEmotion(hasErrFb ? "concerned" : "happy", hasErrFb ? "Notice" : execActionName === "open_link" ? "Opened!" : "Clicked!");
          let clickedMsg =
            execActionName === "open_link"
              ? isHindi
                ? `Maine link "${clickRes.text || res.targetText}" khol diya hai${clickRes.newUrl ? ` (${clickRes.newUrl})` : ""}!`
                : `Opened link "${clickRes.text || res.targetText}"${clickRes.newUrl ? ` -> ${clickRes.newUrl}` : ""}!`
              : isHindi
                ? `Maine page par "${clickRes.text || res.targetText}" click kar diya hai!`
                : `Clicked "${clickRes.text || res.targetText}"!`;
          if (Array.isArray(clickRes.pageFeedback) && clickRes.pageFeedback.length > 0) {
            clickedMsg += `\nPage reported: "${clickRes.pageFeedback[0]}"`;
          }
          recordSessionAction(clickedMsg, hasErrFb ? "unconfirmed" : "confirmed");
          $("statusText").textContent = clickedMsg;
          appendHistory("buddy", `${hasErrFb ? "⚠️" : "✅"} ${clickedMsg}`);
        } else if (clickRes && !clickRes.ok) {
          if (clickRes.stale) lastHighlightSelector = null;
          setRigEmotion("confused", "Blocked");
          const failMsg = clickRes.message || `Could not ${execActionName} "${res.targetText || "target"}".`;
          recordSessionAction(failMsg, "failed");
          $("statusText").textContent = failMsg;
          appendHistory("buddy", `⚠️ ${failMsg}`);
        }
      }
    } else if ((res.actionType === "type" || res.actionType === "fill") && (res.targetValue !== null && res.targetValue !== undefined)) {
      await startSmartFormFill(null, {
        explicitPairs: [
          {
            target: res.targetField || res.targetText || "__CURRENT__",
            value: String(res.targetValue),
            selector: res.targetSelector || undefined,
            overwrite: true,
          },
        ],
        explicitUserProvided: true,
        fromChatCommand: true,
        noSubmitPrompt: /\b(?:search|chat|msg|message|comment|prompt|query)\b/i.test(
          String(res.targetField || res.targetText || ""),
        ),
      });
    } else if (
      (res.actionType === "select" || res.actionType === "check" || res.actionType === "uncheck") &&
      (res.targetSelector || res.targetText || res.targetField)
    ) {
      setRigEmotion("working", "Updating");
      const actRes = await sendRuntimeMessage({
        type: "EXECUTE_ACTION",
        action: res.actionType,
        selector: res.targetSelector || undefined,
        value: res.targetValue || res.targetText || res.targetField || undefined,
        options: { text: res.targetText || res.targetField || undefined },
      });
      if (actRes?.ok) {
        setRigEmotion("happy", "Done!");
        const doneMsg = actRes.message || `Executed ${res.actionType} on page.`;
        $("statusText").textContent = doneMsg;
        appendHistory("buddy", `✅ ${doneMsg}`);
      } else if (actRes && !actRes.ok) {
        setRigEmotion("confused", "Blocked");
        const failMsg = actRes.message || `Could not ${res.actionType} target element.`;
        $("statusText").textContent = failMsg;
        appendHistory("buddy", `⚠️ ${failMsg}`);
      }
    } else if (res.actionType === "form_fill") {
      if (res.fields && typeof res.fields === "object" && Object.keys(res.fields).length > 0) {
        await startSmartFormFill(res.fields, {
          explicitUserProvided: true,
          fromChatCommand: true,
        });
      } else if (res.targetField && res.targetValue) {
        await startSmartFormFill(
          { [res.targetField]: res.targetValue },
          { explicitUserProvided: true, selector: res.targetSelector || undefined, fromChatCommand: true },
        );
      } else {
        await startSmartFormFill();
      }
    } else if (res.actionType === "scroll") {
      await executeScroll(res.scrollDirection || "down", 450, res.scrollTarget || null, true);
    }

    lastHighlightSelector =
      res.highlightSelector ||
      (res.actionType === "point" ? res.targetSelector : null) ||
      null;
    lastCallout = { title: res.calloutTitle || null, description: res.calloutDescription || null };

    if (lastHighlightSelector) {
      $("highlightBtn").hidden = false;
      const coordsArg = res.highlightCoords
        ? { ...res.highlightCoords, skipHighlightRpc: true }
        : res.actionType === "point"
          ? null
          : res.highlightSelector
            ? { skipHighlightRpc: true }
            : null;
      pointArmAtElement(coordsArg);
    }
    $("speakAnswerBtn").hidden = false;

    // Check page completeness from snapshot or metadata
    if (res.snapshot?.pageCompleteness?.hasMoreBelow && $("pageCompletenessBanner")) {
      $("pageCompletenessBanner").hidden = false;
    }

    if (!pendingAction) {
      if ($("confirmCard")) $("confirmCard").hidden = true;
    }

    const actionExecutedAlreadySpoke =
      res.actionType === "type" ||
      res.actionType === "fill" ||
      res.actionType === "form_fill" ||
      res.actionType === "scroll" ||
      pendingSlot?.type === "fill_target";

    const emotion = pendingAction
      ? "concerned"
      : lastHighlightSelector
        ? "pointing"
        : res.reply?.emotion || "idle";
    if (!actionExecutedAlreadySpoke) {
      setRigEmotion(emotion, emotion.toUpperCase());
      speakResponse(currentAnswer, emotion);
      if (res.aiFallbackUsed || res.activeProvider === "local_grounded") {
        const failureReason = res.providerFailure?.message || res.providerWarning?.message;
        $("statusText").textContent = failureReason
          ? `Local Helper Mode — ${failureReason}`
          : isHindi
            ? "Local Helper Mode (AI provider unavailable)"
            : "Local Helper Mode (AI provider unavailable)";
      } else {
        $("statusText").textContent = res.pageReadable
          ? `Grounded on active page (${active.name}).`
          : "Answered using specialist knowledge.";
      }
    }
  } catch (err) {
    hideChatLoadingSpinner();
    setRigEmotion("error", "Error");
    $("statusText").textContent = "Could not reach AI service. Please verify your connection.";
  } finally {
    hideChatLoadingSpinner();
    busy = false;
    $("sendBtn").disabled = false;
    $("sendBtn").classList.remove("is-loading");
    $("sendBtn").textContent = "Send ↵";
    if (
      isLiveVoiceMode &&
      !isBuddySpeaking &&
      !isRecognizing &&
      liveVoiceState !== "error" &&
      !liveVoiceRestartTimer &&
      !pendingAction
    ) {
      liveVoiceRestartTimer = setTimeout(() => {
        if (isLiveVoiceMode && !busy && !isBuddySpeaking && !isRecognizing) {
          startVoiceListening();
        }
      }, 360);
    }
  }
}

// --- SMART FORM FILLING WORKFLOW ---
async function startSmartFormFill(sampleData = null, extraOpts = {}) {
  const active = getActiveBuddy();
  const isHindi = active.defaultLanguage !== "english";
  if ($("formFillCard")) $("formFillCard").hidden = false;

  try {
    const { permissionLevel } = await getPermissionSettings();
    if (permissionLevel === "observe" || permissionLevel === "explain") {
      const blockedMsg = isHindi
        ? `🛡️ Settings mein abhi "${permissionLevel === "observe" ? "Level 1: Observe" : "Level 2: Explain"}" mode active hai, isliye main form inputs change nahi kar raha hoon.`
        : `🛡️ Permission is set to "${permissionLevel === "observe" ? "Level 1: Observe" : "Level 2: Explain"}" in Settings, so form filling is paused.`;
      if ($("formFillReport")) {
        $("formFillReport").hidden = false;
        $("formFillReport").textContent = blockedMsg;
      }
      setRigEmotion("concerned", "Read-Only");
      $("statusText").textContent = blockedMsg;
      appendHistory("buddy", blockedMsg);
      return;
    }
  } catch {}

  $("statusText").textContent = "Inspecting & filling form fields on active page…";

  const SENSITIVE_FIELD_RE =
    /pass|otp|(?<!postal[\s_-])(?<![a-z0-9])pin(?![a-z0-9]|[\s_-]*code\b)|cvv|cvc|secret|token|card|aadhaar|aadhar|\bpan\b|ifsc|account/i;
  const hasExplicit = Boolean(extraOpts?.explicitPairs?.length) || Boolean(sampleData);

  const candidateKeys = [
    ...Object.keys(sampleData || {}),
    ...((extraOpts?.explicitPairs || []).map((p) => p.target || "")),
  ];
  const hasSensitiveInput = candidateKeys.some((k) => SENSITIVE_FIELD_RE.test(String(k)));

  if (hasSensitiveInput) {
    setRigEmotion("privacy", "Privacy");
  } else {
    setRigEmotion("thinking", "Filling…");
  }

  const EPHEMERAL_PROFILE_TARGET_RE =
    /^(?:__current__|search|query|q|chat|msg|message|comment|comments|prompt|note|notes|subject|title)$/i;
  let savedProfileData = null;
  if (!sampleData && !extraOpts?.explicitPairs) {
    if (activeUploadedDocument?.fields && Object.keys(activeUploadedDocument.fields).length > 0) {
      savedProfileData = activeUploadedDocument.fields;
    } else {
      try {
        const userProfile = await getScopedProfile();
        const localMemories = await getLocalMemoriesStore();
        if (userProfile && Object.keys(userProfile).length > 0) {
          const cleanProfile = {};
          for (const [pk, pv] of Object.entries(userProfile)) {
            const kTrim = String(pk || "").trim();
            if (
              kTrim &&
              kTrim.length <= 40 &&
              !SENSITIVE_FIELD_RE.test(kTrim) &&
              !EPHEMERAL_PROFILE_TARGET_RE.test(kTrim) &&
              pv
            ) {
              cleanProfile[kTrim] = pv;
            }
          }
          if (Object.keys(cleanProfile).length > 0) savedProfileData = cleanProfile;
        }
        if (!savedProfileData && Array.isArray(localMemories) && localMemories.length > 0) {
          const MEM_META_KEYS = new Set(["preferred_language", "ecommerce_platform"]);
          const memFields = {};
          for (const item of localMemories) {
            const k = String(item?.key || "").trim();
            const v = String(item?.value || "").trim();
            if (
              k &&
              v &&
              k.length <= 40 &&
              !MEM_META_KEYS.has(k.toLowerCase()) &&
              !SENSITIVE_FIELD_RE.test(k) &&
              !EPHEMERAL_PROFILE_TARGET_RE.test(k)
            ) {
              memFields[k] = v;
            }
          }
          if (Object.keys(memFields).length > 0) savedProfileData = memFields;
        }
      } catch {}
    }
  }

  const dataToFill = sampleData || (extraOpts?.explicitPairs ? null : savedProfileData);

  if (!dataToFill && !extraOpts?.explicitPairs?.length) {
    const snapRes = await sendRuntimeMessage({ type: "GET_SNAPSHOT" });
    const fieldCount = snapRes?.snapshot?.forms?.length || 0;
    const reportEl = $("formFillReport");
    if (reportEl) {
      reportEl.hidden = false;
      reportEl.textContent = isHindi
        ? `Page par ${fieldCount} form field(s) mile. Kripya apna document attach karein ya field values chat mein batayein.`
        : `Detected ${fieldCount} form field(s) on this page. Attach a document or share your field values in chat so Buddy never fills invented data.`;
    }
    setRigEmotion("confused", "Need Info");
    const askDetailsMsg = isHindi
      ? `Main is page ke ${fieldCount} form field(s) fill karne ke liye taiyar hoon, lekin mere paas abhi aapke saved details ya uploaded document nahi hain. Kripya Attach se document upload karein ya batayein kaunsi values bharni hain.`
      : `I detected ${fieldCount} form field(s) on this page, but have no saved profile or attached document values yet. Attach a document or tell me the exact details to fill.`;
    $("statusText").textContent = askDetailsMsg;
    appendHistory("buddy", askDetailsMsg);
    return;
  }

  // Note: NEVER persist to userProfile before SMART_FILL_FORM verifies field filling succeeded.

  const res = await sendRuntimeMessage({
    type: "SMART_FILL_FORM",
    fields: dataToFill,
    options: {
      overwrite: Boolean(extraOpts?.overwrite),
      clearSelector: extraOpts?.clearSelector || undefined,
      explicitPairs: extraOpts?.explicitPairs || undefined,
      explicitUserProvided: Boolean(extraOpts?.explicitUserProvided),
      fromUploadedDocument: Boolean(extraOpts?.fromUploadedDocument),
      fromChatCommand: Boolean(extraOpts?.fromChatCommand ?? true),
      noSubmitPrompt: Boolean(extraOpts?.noSubmitPrompt),
      fallbackSelector: lastHighlightSelector || undefined,
    },
  });

  const reportEl = $("formFillReport");
  if (reportEl) reportEl.hidden = false;

  if (res?.ambiguous && Array.isArray(res.candidates) && res.candidates.length > 1) {
    pendingSlot = {
      type: "fill_target",
      value: res.value,
      candidates: res.candidates,
      noSubmitPrompt: Boolean(extraOpts?.noSubmitPrompt),
    };
    const listText = res.candidates.map((c) => `${c.index}. "${c.label}"`).join("\n");
    const askFieldMsg = isHindi
      ? `🤔 Kis field mein "${res.value}" fill karna hai?\n${listText}\nNumber (1-${res.candidates.length}) ya field ka naam batayein.`
      : `🤔 Which field should I fill "${res.value}" into?\n${listText}\nReply with 1-${res.candidates.length} or the field name.`;
    setRigEmotion("confused", "Which field?");
    $("statusText").textContent = "Clarification needed: choose field";
    appendHistory("buddy", askFieldMsg);
    if (reportEl) reportEl.textContent = askFieldMsg;
    speakResponse(askFieldMsg, "confused");
    return;
  }

  if (res?.ok && res.results) {
    const { filled, preserved, skipped, errors, remainingFields = [] } = res.results;
    if (filled.length > 0) {
      const lastFilledItem = filled[filled.length - 1];
      for (const fItem of filled) {
        if (fItem?.undoRecord) {
          recordTaskContext({ undoRecord: fItem.undoRecord });
        }
      }
      recordTaskContext({
        actionType: "fill",
        targetField: lastFilledItem.field,
        targetSelector: lastFilledItem.selector || undefined,
        targetRef: lastFilledItem.selector
          ? { label: lastFilledItem.field, selector: lastFilledItem.selector, actionType: "fill", capturedAt: Date.now() }
          : undefined,
      });
      if (!activeFormSession) {
        activeFormSession = {
          active: Boolean(extraOpts?.fromFormSession || remainingFields.length > 0),
          filledFields: [],
          lastFilled: null,
          remainingFields: [],
          awaitingField: null,
        };
      }
      activeFormSession.filledFields = [
        ...(activeFormSession.filledFields || []).filter((f) => f.selector !== lastFilledItem.selector),
        ...filled.map((f) => ({
          key: f.key,
          field: f.field,
          selector: f.selector,
          value: f.value,
        })),
      ];
      activeFormSession.lastFilled = {
        key: lastFilledItem.key,
        field: lastFilledItem.field,
        selector: lastFilledItem.selector,
        value: lastFilledItem.value,
      };
      activeFormSession.remainingFields = remainingFields;
      activeFormSession.awaitingField = null;

      if (extraOpts?.explicitUserProvided) {
        try {
          const userProfile = await getScopedProfile();
          let changed = false;
          for (const f of filled) {
            const rawKey = String(f.key && f.key !== "__CURRENT__" ? f.key : f.field || "").trim().toLowerCase();
            if (
              rawKey &&
              !/^__INDEX_/.test(rawKey) &&
              rawKey.length <= 40 &&
              !SENSITIVE_FIELD_RE.test(rawKey) &&
              !EPHEMERAL_PROFILE_TARGET_RE.test(rawKey) &&
              f.value &&
              !/^•+$/.test(String(f.value))
            ) {
              userProfile[rawKey] = f.value;
              changed = true;
            }
          }
          if (changed) await setScopedProfile(userProfile);
        } catch {}
      }
    }
    const lines = [];
    const formatFieldDisplay = (f) =>
      SENSITIVE_FIELD_RE.test(String(f.field || "")) ? `${f.field} = "•••"` : `${f.field} = "${f.value}"`;
    const filledSensitive = filled.some((f) => SENSITIVE_FIELD_RE.test(String(f.field || "")));

    if (filled.length > 0) {
      lines.push(
        `✅ Filled & verified (${filled.length}): ${filled.map(formatFieldDisplay).join(", ")}`,
      );
    }
    if (preserved.length > 0) {
      lines.push(
        `🔒 Preserved existing values (${preserved.length}): ${preserved.map((p) => p.field).join(", ")}`,
      );
    }
    if (skipped.length > 0 && (hasExplicit || filled.length === 0)) {
      lines.push(
        `🛡️ Skipped (${skipped.length}): ${skipped.map((s) => `${s.key === "__CURRENT__" ? "target box" : s.key} (${s.reason})`).join(", ")}`,
      );
    }
    if (errors.length > 0) {
      lines.push(`⚠️ Issues: ${errors.map((e) => e.key).join(", ")}`);
    }

    if (reportEl) {
      reportEl.innerHTML =
        lines.length === 0
          ? "No matching inputs found on this page. Navigate to a form page to fill."
          : lines.join("<br>");
    }

    if (filled.length > 0) {
      const targetEmotion = filledSensitive || hasSensitiveInput ? "privacy" : "success";
      setRigEmotion(targetEmotion, targetEmotion === "privacy" ? "Privacy" : "Filled");
      $("statusText").textContent =
        `Filled ${filled.length} field${filled.length > 1 ? "s" : ""} & verified.`;
      let summaryMsg = isHindi
        ? `📝 Ho gaya! Maine ${filled
            .map((f) =>
              SENSITIVE_FIELD_RE.test(String(f.field || ""))
                ? `"${f.field}" mein safe value`
                : `"${f.field}" mein "${f.value}"`,
            )
            .join(", ")} fill aur verify kar diya hai.${
            preserved.length > 0
              ? ` (${preserved.length} pehle se bhare fields ko safe rakha gaya hai)`
              : ""
          }${skipped.length > 0 ? `\n🛡️ Skipped: ${skipped.map((s) => `${s.key} (${s.reason})`).join(", ")}` : ""}${errors.length > 0 ? `\n⚠️ Failed: ${errors.map((e) => `${e.key} (${e.error})`).join(", ")}` : ""}`
        : `📝 Filled & verified ${filled.length} field(s): ${filled.map(formatFieldDisplay).join(", ")}.${
            preserved.length > 0 ? ` Preserved ${preserved.length} existing field(s).` : ""
          }${skipped.length > 0 ? `\n🛡️ Skipped: ${skipped.map((s) => `${s.key} (${s.reason})`).join(", ")}` : ""}${errors.length > 0 ? `\n⚠️ Failed: ${errors.map((e) => `${e.key} (${e.error})`).join(", ")}` : ""}`;

      let shouldPromptNext = false;
      if (extraOpts?.fromFormSession && remainingFields.length > 0 && errors.length === 0) {
        const nextField = remainingFields[0];
        activeFormSession.active = true;
        activeFormSession.awaitingField = nextField;
        pendingSlot = {
          type: "fill_value",
          targetField: nextField.label || "__CURRENT__",
          targetSelector: nextField.selector || undefined,
          fromFormSession: true,
          noSubmitPrompt: Boolean(extraOpts?.noSubmitPrompt),
        };
        if (nextField.selector) {
          lastHighlightSelector = nextField.selector;
          lastCallout = {
            title: `Next: ${nextField.label}`,
            description: "Waiting for value",
          };
          pointArmAtElement().catch(() => {});
        }
        summaryMsg += isHindi
          ? `\nAb **${nextField.label}** mein kya daalna hai?`
          : `\nNext, what should I enter in **${nextField.label}**?`;
        shouldPromptNext = true;
      } else if (extraOpts?.fromFormSession && remainingFields.length === 0) {
        if (activeFormSession) activeFormSession.active = false;
        pendingSlot = null;
        summaryMsg += isHindi
          ? `\n✅ Sabhi required fields complete ho gaye! Jab aap bolein tab hi submit karunga.`
          : `\n✅ All form fields are now complete! Let me know when you'd like to submit.`;
      }

      recordSessionAction(
        `Filled & verified ${filled.length} field(s): ${filled.map(formatFieldDisplay).join(", ")}`,
        errors.length > 0 ? "unconfirmed" : "confirmed",
      );
      appendHistory("buddy", summaryMsg);
      speakResponse(
        summaryMsg,
        targetEmotion,
        shouldPromptNext
          ? { autoListenOnFinish: true, autoListenReason: "incomplete_form_fill" }
          : {},
      );
    } else if (errors.length > 0) {
      setRigEmotion("error", "Rejected");
      const errDetail = errors.map((e) => `${e.key}: ${e.error}`).join("; ");
      const rejectMsg = isHindi
        ? `⚠️ Page ne value accept nahi ki ya clear kar di: ${errDetail}`
        : `⚠️ Field rejected or cleared value: ${errDetail}`;
      recordSessionAction(rejectMsg, "failed");
      $("statusText").textContent = rejectMsg;
      appendHistory("buddy", rejectMsg);
    } else if (skipped.length > 0 && hasExplicit) {
      setRigEmotion("concerned", "Skipped");
      const skipDetail = skipped.map((s) => `${s.key === "__CURRENT__" ? "target box" : s.key}: ${s.reason}`).join("; ");
      const skipMsg = isHindi
        ? `🛡️ Yeh field(s) skip kiye gaye: ${skipDetail}`
        : `🛡️ Refused / skipped: ${skipDetail}`;
      recordSessionAction(skipMsg, "failed");
      $("statusText").textContent = skipMsg;
      appendHistory("buddy", skipMsg);
    } else if (preserved.length > 0) {
      if (extraOpts?.fromFormSession && remainingFields.length > 0 && errors.length === 0) {
        const nextField = remainingFields[0];
        if (!activeFormSession) {
          activeFormSession = {
            active: true,
            filledFields: [],
            lastFilled: null,
            remainingFields,
            awaitingField: nextField,
          };
        } else {
          activeFormSession.active = true;
          activeFormSession.remainingFields = remainingFields;
          activeFormSession.awaitingField = nextField;
        }
        pendingSlot = {
          type: "fill_value",
          targetField: nextField.label || "__CURRENT__",
          targetSelector: nextField.selector || undefined,
          fromFormSession: true,
          noSubmitPrompt: Boolean(extraOpts?.noSubmitPrompt),
        };
        if (nextField.selector) {
          lastHighlightSelector = nextField.selector;
          lastCallout = {
            title: `Fill: ${nextField.label}`,
            description: "Waiting for your value",
          };
          pointArmAtElement().catch(() => {});
        }
        const presNextMsg = isHindi
          ? `🔒 Pehle se bhare field (${preserved.map((p) => p.field).join(", ")}) safe rakhe gaye hain.\nAb **${nextField.label}** mein kya daalna hai?`
          : `🔒 Existing field(s) (${preserved.map((p) => p.field).join(", ")}) preserved.\nNext, what should I enter in **${nextField.label}**?`;
        setRigEmotion("curious", "Need Details");
        recordSessionAction(`Preserved ${preserved.map((p) => p.field).join(", ")}; waiting for ${nextField.label}`, "confirmed");
        $("statusText").textContent = `Waiting for ${nextField.label}…`;
        appendHistory("buddy", presNextMsg);
        speakResponse(presNextMsg, "curious", {
          autoListenOnFinish: true,
          autoListenReason: "incomplete_form_fill",
        });
      } else {
        setRigEmotion("idle", "Preserved");
        const presMsg = isHindi
          ? `🔒 Field "${preserved.map((p) => p.field).join(", ")}" mein pehle se data bhara hua hai. Agar aap badalna chahte hain to "change karke <nayi value> kar do" bolein.`
          : `🔒 Existing data in "${preserved.map((p) => p.field).join(", ")}" was preserved. Say "change <field> to <value>" if you want to overwrite it.`;
        recordSessionAction(`Preserved existing values in ${preserved.map((p) => p.field).join(", ")}`, "confirmed");
        $("statusText").textContent = "Existing field values preserved.";
        appendHistory("buddy", presMsg);
      }
    } else {
      setRigEmotion("confused", "Not found");
      const notFoundMsg = isHindi
        ? `⚠️ Is page par matching editable input field nahi mila. Kripya pehle field par point karein ya page scroll karein.`
        : `⚠️ Could not find matching editable input field on this page.`;
      recordSessionAction(notFoundMsg, "failed");
      $("statusText").textContent = notFoundMsg;
      appendHistory("buddy", notFoundMsg);
    }

    // Explicit User-Confirmation Gate before submission (only when user filled multiple form fields, not a quick search box)
    if (res.results.pendingSubmission && filled.length >= 2) {
      pendingAction = {
        type: "click_submit",
        selector: res.results.pendingSubmission.submitButtonSelector || 'button[type="submit"]',
        text: res.results.pendingSubmission.submitButtonText || "Submit Form",
      };
      if ($("confirmDesc")) {
        $("confirmDesc").textContent = isHindi
          ? `${filled.length} fields fill aur verify ho gaye hain. Kya Buddy "${pendingAction.text}" se form submit kare?`
          : `All ${filled.length} fields filled & verified. Would you like Buddy to submit the form via "${pendingAction.text}"?`;
      }
      if ($("confirmCard")) $("confirmCard").hidden = false;
      if (!filledSensitive && !hasSensitiveInput) {
        setRigEmotion("concerned", "Confirm");
      }
    }
  } else {
    setRigEmotion("error", "Error");
    const errText = res?.message || "Could not fill form on this page.";
    if (reportEl) reportEl.textContent = errText;
    appendHistory("buddy", `⚠️ ${errText}`);
  }
}

// --- MULTI-ACTION TASK OPERATOR ENGINE ---
let activePlan = null;
let isPlanPaused = false;
let pendingApprovalStep = null;

function buildMultiActionPlan(instruction) {
  const trimmed = (instruction || "").trim();
  const lower = trimmed.toLowerCase();
  const planId = `plan_${Date.now()}`;
  const steps = [];

  // 1. Meesho Supplier Panel workflow
  if (lower.includes("meesho") && (lower.includes("order") || lower.includes("supplier"))) {
    steps.push({
      id: `${planId}_1`,
      stepNumber: 1,
      title: "Open Meesho Supplier Panel",
      action: "navigate",
      value: "https://supplier.meesho.com/panel/orders",
      skipIfUrlPattern: "meesho\\.com\\/panel|mock.*meesho|localhost.*meesho",
      status: "pending",
    });
    steps.push({
      id: `${planId}_2`,
      stepNumber: 2,
      title: "Navigate to Orders",
      action: "click",
      selector: 'a[href*="orders"], [role="tab"][data-tab="orders"]',
      textTarget: "Orders",
      alternateTargets: ["Orders", "My Orders", "All Orders", "Order", "Orders Dashboard"],
      status: "pending",
    });
    steps.push({
      id: `${planId}_3`,
      stepNumber: 3,
      title: "Filter today's orders",
      action: "click",
      selector: '[data-filter="today"], input[value="today"]',
      textTarget: "Today",
      alternateTargets: ["Today", "Today's Orders", "Created Today", "Date", "Order Date"],
      status: "pending",
    });
    steps.push({
      id: `${planId}_4`,
      stepNumber: 4,
      title: "Find pending orders",
      action: "click",
      selector: '[data-tab="pending"], input[value="pending"]',
      textTarget: "Pending",
      alternateTargets: ["Pending", "Pending Orders", "Ready to Ship", "Unshipped", "New Orders"],
      status: "pending",
    });
    steps.push({
      id: `${planId}_5`,
      stepNumber: 5,
      title: "Copy pending order IDs",
      action: "extract",
      value: "order_id",
      statusFilter: lower.includes("pending") ? "pending" : undefined,
      status: "pending",
    });
    steps.push({
      id: `${planId}_6`,
      stepNumber: 6,
      title: "Prepare verified order list",
      action: "extract",
      value: "copy_list",
      status: "pending",
    });
  } else if (lower.includes("table") && lower.includes("copy")) {
    steps.push({
      id: `${planId}_1`,
      stepNumber: 1,
      title: "Locate table on active page",
      action: "wait_for",
      selector: "table",
      status: "pending",
    });
    steps.push({
      id: `${planId}_2`,
      stepNumber: 2,
      title: "Extract table rows and cells",
      action: "extract",
      value: "table",
      status: "pending",
    });
    steps.push({
      id: `${planId}_3`,
      stepNumber: 3,
      title: "Copy table list to clipboard",
      action: "extract",
      value: "copy_list",
      status: "pending",
    });
  } else {
    // General parser: split on English & Hinglish conjunctions, semicolons, and commas
    const segments = trimmed
      .split(
        /(?:\r?\n|\s*(?:then|and then|after that|next|finally|phir|fir|uske baad)\s*|[;]\s*|,\s*(?:aur\s+|and\s+)?|\s+(?:aur|and)\s+(?=(?:go|open|click|press|select|find|point|highlight|copy|type|fill|submit|search|verify|extract|purchase|delete|confirm|scroll|likho|daalo|bharo|dabao|kholo)\b)|\s*\d+[\.\)]\s+)/i,
      )
      .map((s) =>
        s
          .trim()
          .replace(/^[\d+\.\-\*\)]\s*/, "")
          .replace(/^(?:and|aur|pehle|first)\s+/i, ""),
      )
      .filter((s) => s.length > 2);

    let idx = 1;
    for (const seg of segments) {
      const segLower = seg.toLowerCase();
      const isConsequential = /purchase|buy|pay|delete|confirm payment/i.test(segLower);
      let act = "click";
      let val = undefined;
      let textTarget = undefined;

      if (
        segLower.startsWith("open ") ||
        segLower.startsWith("go to ") ||
        segLower.startsWith("navigate ") ||
        segLower.includes("kholo") ||
        segLower.includes("khol do") ||
        segLower.includes("open karo") ||
        segLower.includes("open kar do")
      ) {
        if (segLower.includes("http") || segLower.includes(".com") || segLower.includes(".in")) {
          act = "navigate";
          const m = seg.match(/https?:\/\/[^\s]+/i);
          val = m ? m[0] : undefined;
        } else {
          act = "click";
          textTarget = seg
            .replace(/^(?:open|go to|navigate to)\s+/i, "")
            .replace(/\s+(?:kholo|khol\s*do|open\s*karo|open\s*kar\s*do)$/i, "")
            .replace(/\s+(?:tab|button|link)$/i, "")
            .trim();
        }
      } else if (
        segLower.includes("copy") ||
        segLower.includes("extract") ||
        segLower.includes("prepare a list") ||
        segLower.includes("nikaalo")
      ) {
        act = "extract";
        val = "order_id";
      } else if (segLower.includes("scroll") || segLower.includes("neeche jao") || segLower.includes("upar jao")) {
        act = "scroll";
        val = segLower.includes("up") || segLower.includes("upar")
          ? "up"
          : segLower.includes("left")
            ? "left"
            : segLower.includes("right")
              ? "right"
              : segLower.includes("top")
                ? "top"
                : segLower.includes("bottom") || segLower.includes("last")
                  ? "bottom"
                  : "down";
      } else if (/\b(?:fill|type|likho|likh|daalo|daal|bharo|bhar)\b/i.test(segLower)) {
        const isDocSeg =
          /(?:uploaded\s+(?:id|document|doc|file)|document\s+se|id\s+se|aadhaar|aadhar|pan)/i.test(
            segLower,
          );
        if (isDocSeg) {
          act = "fill_from_document";
          const reqKeys = extractRequestedDocFieldKeys(segLower);
          textTarget = reqKeys.length > 0 ? reqKeys.join(",") : "all";
        } else {
          const subFill = extractFillDetails(seg);
          if (subFill.explicitPairs?.[0]) {
            act = "fill_field";
            textTarget = subFill.explicitPairs[0].target;
            val = subFill.explicitPairs[0].value;
          } else {
            act = "fill_field";
          }
        }
      } else if (segLower.includes("delete")) {
        act = "click_delete";
      } else if (
        segLower.includes("purchase") ||
        segLower.includes("buy") ||
        segLower.includes("pay")
      ) {
        act = "purchase";
      } else if (segLower.includes("submit") || segLower.includes("confirm")) {
        act = "click_submit";
        textTarget = "submit";
      } else {
        act = "click";
        textTarget = seg
          .replace(/^(?:click|press|tap|dabao)\s+/i, "")
          .replace(/\s+(?:par click karo|click karo|dabao|press karo)$/i, "")
          .replace(/\s+(?:tab|button|link)$/i, "")
          .trim();
      }

      const stepObj = {
        id: `${planId}_${idx}`,
        stepNumber: idx,
        title: seg.charAt(0).toUpperCase() + seg.slice(1),
        action: act,
        value: val,
        textTarget,
        status: "pending",
        isConsequential,
        requiresApproval: isConsequential,
        approvalPrompt: isConsequential
          ? `Please confirm: Buddy is about to execute "${seg}". Proceed?`
          : undefined,
      };
      if (act === "fill_from_document") {
        stepObj.requestedFields =
          textTarget && textTarget !== "all" ? textTarget.split(",").filter(Boolean) : [];
      }
      steps.push(stepObj);
      idx++;
    }
  }

  return {
    id: planId,
    title: trimmed.length > 45 ? trimmed.slice(0, 42) + "..." : trimmed,
    originalInstruction: trimmed,
    steps,
    currentStepIndex: 0,
    status: "pending",
    extractedData: [],
  };
}

function renderTaskPlanUI() {
  if (!activePlan) {
    if ($("taskPlanCard")) $("taskPlanCard").hidden = true;
    return;
  }
  $("taskPlanCard").hidden = false;
  $("planTitle").textContent = activePlan.title;
  $("planMeta").textContent =
    `${activePlan.steps.length} sequential steps · status: ${activePlan.status}`;
  $("planStatusBadge").textContent = activePlan.status.toUpperCase();
  $("planStatusBadge").className = `status-badge ${activePlan.status}`;

  const completedCount = activePlan.steps.filter((s) => s.status === "completed").length;
  const total = activePlan.steps.length;
  const pct = total > 0 ? Math.round((completedCount / total) * 100) : 0;

  $("progressStepsLabel").textContent = `${completedCount} of ${total} steps completed`;
  $("progressPercentLabel").textContent = `${pct}%`;
  $("progressBarFill").style.width = `${pct}%`;

  // Render steps list cleanly with textContent
  const listEl = $("planStepsList");
  listEl.textContent = "";
  activePlan.steps.forEach((st, idx) => {
    const row = document.createElement("div");
    row.className = `plan-step-row ${st.status}`;
    const info = document.createElement("div");
    info.className = "step-info";
    const numEl = document.createElement("span");
    numEl.className = "step-num";
    numEl.textContent = `${idx + 1}.`;
    const textEl = document.createElement("span");
    textEl.className = "step-text";
    textEl.title = st.title || "";
    textEl.textContent = st.title || "";
    info.appendChild(numEl);
    info.appendChild(textEl);
    const statusEl = document.createElement("span");
    statusEl.className = `step-status-tag ${st.status}`;
    statusEl.textContent = st.status;
    row.appendChild(info);
    row.appendChild(statusEl);
    listEl.appendChild(row);
  });

  const costTel = typeof latestCostTelemetry !== "undefined" ? latestCostTelemetry : null;
  const orchMeta = typeof latestOrchestrationMeta !== "undefined" ? latestOrchestrationMeta : null;
  if ($("planCostBadge")) {
    const tokens = costTel?.totalEstimatedTokens ?? costTel?.estimatedTokensUsed ?? 0;
    const calls = costTel?.totalModelCalls ?? costTel?.totalAiCalls ?? 0;
    if (tokens > 0 || calls > 0) {
      $("planCostBadge").textContent = `${tokens} tok · ${calls} calls`;
      $("planCostBadge").hidden = false;
    } else {
      $("planCostBadge").hidden = true;
    }
  }
  if ($("planAgentsBar")) {
    const agents = orchMeta?.agentsAssigned || orchMeta?.selectedAgents || [];
    if (agents.length > 0) {
      $("planAgentsBar").textContent = `Agents: ${agents.join(", ")}`;
      $("planAgentsBar").hidden = false;
    } else {
      $("planAgentsBar").hidden = true;
    }
  }
  if ($("planApproveBtn")) {
    $("planApproveBtn").hidden = activePlan.status !== "awaiting_approval";
  }
  if ($("planLogsBox") && !$("planLogsBox").hidden && typeof refreshPlanLogsBoxContent === "function") {
    refreshPlanLogsBoxContent();
  }

  // Pause button label
  $("planPauseResumeBtn").textContent = isPlanPaused ? "▶️ Resume" : "⏸️ Pause";
}

let planRunToken = 0;
let planLoopRunning = false;

async function persistPlanCheckpoint(plan) {
  if (!plan) return;
  try {
    plan.updatedAt = new Date().toISOString();
    const checkpoint = {
      id: plan.id,
      title: plan.title,
      originalInstruction: plan.originalInstruction,
      status: plan.status,
      currentStepIndex: plan.currentStepIndex || 0,
      totalSteps: Array.isArray(plan.steps) ? plan.steps.length : 0,
      steps: plan.steps,
      extractedData: plan.extractedData || [],
      updatedAt: plan.updatedAt,
    };
    await chrome.storage.local.set({
      ai_buddy_active_plan: plan,
      savedCheckpoint: checkpoint,
    });
  } catch {
    // Non-fatal
  }
}

async function clearPlanCheckpoints() {
  try {
    await chrome.storage.local.remove(["savedCheckpoint", "ai_buddy_active_plan"]);
  } catch {
    // Non-fatal
  }
}

function sanitizeStepSelector(sel) {
  if (!sel || typeof sel !== "string") return "";
  const validParts = sel
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p && !/:has-text\(|:contains\(/i.test(p));
  return validParts.join(", ");
}

function resolveSnapshotElementForStep(step, freshSnap, strategyIndex = 0) {
  if (!freshSnap || !step) return null;
  const allElements = [
    ...(freshSnap.controls || []),
    ...(freshSnap.forms || []),
    ...(freshSnap.headings || []),
    ...(freshSnap.alerts || []),
  ];

  // Clean non-standard CSS pseudo selectors so querySelectorAll never chokes
  const sanitized = sanitizeStepSelector(step.selector);
  if (sanitized !== (step.selector || "")) {
    step.selector = sanitized || undefined;
  }

  // If this is a fresh attempt and existing selector still matches snapshot, keep it (unless retrying with alternate strategy)
  if (strategyIndex === 0 && step.selector && step.selector !== "body") {
    const stillPresent = allElements.find((el) => el.selector === step.selector);
    if (stillPresent) {
      return { selector: stillPresent.selector, strategy: "direct", element: stillPresent };
    }
    // Stale selector was deleted/mutated in live DOM — clear it so we re-ground below
    step.selector = undefined;
  } else if (strategyIndex > 0) {
    // On retry, clear previously failing selector so alternate locators take precedence
    step.selector = undefined;
  }

  const rawQueries = [
    step.dynamicTargetQuery,
    step.textTarget,
    ...(Array.isArray(step.alternateTargets) ? step.alternateTargets : []),
    step.title,
  ]
    .filter((q) => typeof q === "string" && q.trim().length > 0)
    .map((q) =>
      q
        .toLowerCase()
        .trim()
        .replace(/^(?:click|open|press|select|go to|navigate to|find|locate|fill|type|search|copy)\s+/i, "")
        .replace(/\s+(?:button|btn|link|tab|input|field|box|section)$/i, "")
        .trim(),
    )
    .filter(Boolean);

  const uniqueQueries = [...new Set(rawQueries)];
  const orderedQueries =
    strategyIndex > 0 && uniqueQueries.length > 1
      ? [...uniqueQueries.slice(strategyIndex % uniqueQueries.length), ...uniqueQueries.slice(0, strategyIndex % uniqueQueries.length)]
      : uniqueQueries;

  const isClickableStep = ["click", "click_submit", "click_delete", "open_link", "open"].includes(step.action);
  const pool = isClickableStep && (freshSnap.controls || []).length > 0
    ? [...(freshSnap.controls || []), ...(freshSnap.forms || []), ...(freshSnap.headings || [])]
    : allElements;

  for (const q of orderedQueries) {
    const exact = pool.find((el) => (el.name || "").toLowerCase().trim() === q);
    if (exact?.selector) {
      return { selector: exact.selector, strategy: "exact_name", queryUsed: q, element: exact };
    }
  }
  for (const q of orderedQueries) {
    const prefix = pool.find((el) => {
      const name = (el.name || "").toLowerCase().trim();
      const ph = (el.placeholder || "").toLowerCase().trim();
      return name.startsWith(q) || ph.startsWith(q);
    });
    if (prefix?.selector) {
      return { selector: prefix.selector, strategy: "prefix_match", queryUsed: q, element: prefix };
    }
  }
  for (const q of orderedQueries) {
    const sub = pool.find((el) => {
      const name = (el.name || "").toLowerCase();
      const ph = (el.placeholder || "").toLowerCase();
      const sel = (el.selector || "").toLowerCase();
      return name.includes(q) || ph.includes(q) || (sel.includes(q) && !/:has-text/i.test(sel));
    });
    if (sub?.selector) {
      return { selector: sub.selector, strategy: "substring_match", queryUsed: q, element: sub };
    }
  }

  return null;
}

function normalizePlannerSteps(rawSteps, planId) {
  if (!Array.isArray(rawSteps) || rawSteps.length === 0) return null;
  const ALLOWED = new Set([
    "navigate",
    "open_website",
    "open",
    "click",
    "click_submit",
    "click_delete",
    "open_link",
    "type",
    "fill_field",
    "fill_from_document",
    "select",
    "check",
    "uncheck",
    "scroll",
    "point",
    "extract",
    "download",
    "verify_page",
    "wait_for",
    "keyboard",
    "switch_tab",
    "purchase",
  ]);
  const normalized = [];
  rawSteps.forEach((raw, idx) => {
    if (!raw || typeof raw !== "object") return;
    const rawAct = String(raw.action || "click").toLowerCase().trim();
    const action = ALLOWED.has(rawAct) ? rawAct : "click";
    const title = String(raw.title || `${action} step ${idx + 1}`).trim();
    const isConsequential =
      Boolean(raw.isConsequential) ||
      /purchase|click_delete|click_submit|send_message/i.test(action) ||
      /\b(?:purchase|buy|pay|delete|remove\s+account|place\s+order)\b/i.test(title);
    normalized.push({
      id: `${planId}_${idx + 1}`,
      stepNumber: idx + 1,
      title,
      action,
      value: raw.value ?? raw.url ?? undefined,
      url: raw.url ?? undefined,
      filenameHint: raw.filenameHint ?? undefined,
      expectedText: raw.expectedText ?? undefined,
      waitMs: typeof raw.waitMs === "number" ? raw.waitMs : undefined,
      textTarget: raw.textTarget ?? undefined,
      selector: sanitizeStepSelector(raw.selector) || undefined,
      alternateTargets: Array.isArray(raw.alternateTargets) ? raw.alternateTargets : undefined,
      requestedFields: Array.isArray(raw.requestedFields) ? raw.requestedFields : undefined,
      status: "pending",
      isConsequential,
      requiresApproval: isConsequential,
      approvalPrompt: isConsequential
        ? `Please confirm: Buddy is about to execute "${title}". Proceed?`
        : undefined,
    });
  });
  return normalized.length > 0 ? normalized : null;
}

async function startMultiActionPlan(instruction, isExplicitPlan = false) {
  // Invalidate any previous running loop immediately so a fresh plan is never blocked or corrupted
  planRunToken++;
  planLoopRunning = false;
  let plan = buildMultiActionPlan(instruction);

  // For complex/non-template instructions, consult AI planner (5s timeout) and keep local fallback if unavailable
  const isPresetWorkflow =
    isExplicitPlan &&
    /meesho supplier panel|seller orders portal|multi-source research|find tables on this page/i.test(
      String(instruction || ""),
    );
  if (!isPresetWorkflow) {
    try {
      const modelSel = $("modelSelector");
      const activeMod = modelSel?.value && modelSel.value !== "auto" ? modelSel.value : undefined;
      const activeProv = selectedProvider || "auto";
      const aiPlanRes = await Promise.race([
        sendRuntimeMessage(
          {
            type: "ASK",
            question: instruction,
            intent: "plan",
            buddySlug: selectedBuddySlug,
            customBuddyId: activeCustomBuddyId,
            preferredProvider: activeProv,
            preferredModel: activeMod,
          },
          { silent: true },
        ).catch(() => null),
        new Promise((r) => setTimeout(() => r(null), 5000)),
      ]);
      if (aiPlanRes && aiPlanRes.activeProvider !== "error" && Array.isArray(aiPlanRes.steps) && aiPlanRes.steps.length > 0) {
        const aiSteps = normalizePlannerSteps(aiPlanRes.steps, plan.id);
        if (aiSteps && aiSteps.length > 0) {
          plan = {
            ...plan,
            steps: aiSteps,
            plannedByAi: true,
          };
        }
      }
    } catch {
      // Fall back seamlessly to local deterministic plan
    }
  }

  activePlan = plan;
  isPlanPaused = false;
  pendingApprovalStep = null;
  if ($("consequentialApprovalCard")) $("consequentialApprovalCard").hidden = true;
  if ($("extractedDataCard")) $("extractedDataCard").hidden = true;
  if ($("planRetryBtn")) $("planRetryBtn").hidden = true;

  appendHistory("user", instruction);
  appendHistory(
    "buddy",
    `🎯 Created ${plan.steps.length}-step execution plan for: "${plan.title}"`,
  );
  setRigEmotion("working", "Planning");
  renderTaskPlanUI();
  await persistPlanCheckpoint(plan);

  // Execute steps sequentially
  await runPlanLoop();
}

async function runPlanLoop() {
  if (!activePlan || activePlan.status === "cancelled" || planLoopRunning) return;
  const plan = activePlan;
  const myRunToken = ++planRunToken;
  planLoopRunning = true;

  const isStaleRun = () =>
    !activePlan || activePlan !== plan || myRunToken !== planRunToken || plan.status === "cancelled";

  const regroundStep = async (currentStep, strategyIdx = 0) => {
    try {
      const snapRes = await sendRuntimeMessage({ type: "GET_PAGE_SNAPSHOT" });
      if (isStaleRun()) return null;
      if (snapRes?.ok && snapRes.snapshot) {
        const freshSnap = snapRes.snapshot;
        // Skip redundant navigation if browser is already on the target portal
        if (currentStep.action === "navigate" && currentStep.skipIfUrlPattern && freshSnap.url) {
          try {
            if (new RegExp(currentStep.skipIfUrlPattern, "i").test(freshSnap.url)) {
              return { skipNavigateAlreadyThere: true, currentUrl: freshSnap.url };
            }
          } catch {}
        }
        const resolved = resolveSnapshotElementForStep(currentStep, freshSnap, strategyIdx);
        if (resolved?.selector) {
          currentStep.selector = sanitizeStepSelector(resolved.selector) || resolved.selector;
          currentStep.resolvedSelector = currentStep.selector;
          currentStep.locatorStrategy = resolved.strategy;
          if (resolved.queryUsed) currentStep.textTarget = currentStep.textTarget || resolved.queryUsed;
        } else if (
          currentStep.action !== "navigate" &&
          currentStep.action !== "open_website" &&
          currentStep.action !== "verify_page" &&
          currentStep.action !== "download" &&
          currentStep.action !== "scroll" &&
          currentStep.action !== "extract"
        ) {
          const urlLower = String(freshSnap.url || "").toLowerCase();
          const hasOtpOrCaptchaAlert = (freshSnap.alerts || []).some((a) =>
            /otp|captcha|two-factor|2fa|verify\s+your\s+identity|sign\s+in\s+required|session\s+expired/i.test(
              `${a.name || ""} ${a.text || ""}`,
            ),
          );
          const hasAuthInputs = (freshSnap.forms || []).some(
            (f) => f.type === "password" || /\b(?:otp|captcha|verification\s*code)\b/i.test(`${f.name || ""} ${f.placeholder || ""}`),
          );
          const onAuthRoute = /(?:\/login|\/signin|\/sign-in|\/auth|\/otp|\/captcha|\/verify-account)/i.test(urlLower);
          const stepWantsAuth = /\b(?:login|sign\s*in|password|otp|captcha|verify)\b/i.test(
            `${currentStep.textTarget || ""} ${currentStep.title || ""}`,
          );
          if ((hasOtpOrCaptchaAlert || (onAuthRoute && hasAuthInputs)) && !stepWantsAuth) {
            return { authWallDetected: true, currentUrl: freshSnap.url };
          }
        }
      }
    } catch {
      // Non-fatal: continue with pre-configured step target
    }
    return null;
  };

  try {
    while (!isStaleRun() && plan.currentStepIndex < plan.steps.length) {
      if (isPlanPaused) {
        plan.status = "paused";
        await persistPlanCheckpoint(plan);
        if (!isStaleRun()) renderTaskPlanUI();
        return;
      }

      const currentStep = plan.steps[plan.currentStepIndex];

      // Consequential Approval Gate
      if (currentStep.requiresApproval && currentStep.status !== "awaiting_approval") {
        currentStep.status = "awaiting_approval";
        plan.status = "awaiting_approval";
        pendingApprovalStep = currentStep;
        await persistPlanCheckpoint(plan);
        if (isStaleRun()) return;
        renderTaskPlanUI();

        if ($("consequentialApprovalCard")) {
          $("consequentialApprovalCard").hidden = false;
          $("consequentialPrompt").textContent =
            currentStep.approvalPrompt ||
            `Buddy needs your confirmation to execute "${currentStep.title}". This step performs changes.`;
        }
        setRigEmotion("concerned", "Approval");
        return; // Wait for user approval click
      }

      currentStep.status = "running";
      plan.status = "running";
      renderTaskPlanUI();
      setRigEmotion("working", `Step ${currentStep.stepNumber}`);
      await persistPlanCheckpoint(plan);
      if (isStaleRun()) return;

      // --- OAV STAGE 1 & 4: OBSERVE FRESH LIVE DOM & RE-GROUND TARGET ---
      const strategyIdx = currentStep.locatorStrategyIndex || currentStep.retryCount || 0;
      const navCheck = await regroundStep(currentStep, strategyIdx);
      if (isStaleRun()) return;

      if (navCheck?.authWallDetected) {
        currentStep.status = "pending";
        plan.status = "paused";
        isPlanPaused = true;
        await persistPlanCheckpoint(plan);
        if (isStaleRun()) return;
        renderTaskPlanUI();
        setRigEmotion("concerned", "Login / OTP");
        const active = getActiveBuddy();
        const isHindi = active?.defaultLanguage !== "english";
        appendHistory(
          "buddy",
          isHindi
            ? `🔒 Page par Login / OTP / CAPTCHA verification dikh raha hai (${navCheck.currentUrl || "portal"}). Kripya pehle sign-in ya OTP complete karein, phir "continue" bolein ya Resume button dabayein.`
            : `🔒 A Login, OTP, or CAPTCHA verification wall was detected (${navCheck.currentUrl || "portal"}). Please complete sign-in manually, then say "continue" or click Resume.`,
        );
        return;
      }

      let res;
      if (navCheck?.skipNavigateAlreadyThere) {
        res = {
          ok: true,
          verified: true,
          result: `Already on target portal (${navCheck.currentUrl}).`,
        };
      } else {
        // --- OAV STAGE 5: DISPATCH STEP ACTION ---
        res = await sendRuntimeMessage({
          type: "EXECUTE_STEP",
          step: currentStep,
          options: {
            extractedDataStore: plan.extractedData,
            uploadedDocumentFields: activeUploadedDocument?.fields || {},
            statusFilter: currentStep.statusFilter,
            useAlternateLocators: strategyIdx > 0,
            locatorStrategyIndex: strategyIdx,
          },
        });
        if (isStaleRun()) return;

        // Automatic recoverable alternate-locator + alternate clickMethod retry (max 1 auto-retry before AI recovery/manual Retry)
        if (
          !res?.ok &&
          !res?.awaitingApproval &&
          (currentStep.retryCount || 0) < 1 &&
          currentStep.action !== "navigate" &&
          currentStep.action !== "open_website"
        ) {
          currentStep.retryCount = (currentStep.retryCount || 0) + 1;
          currentStep.locatorStrategyIndex = currentStep.retryCount;
          currentStep.selector = undefined;
          await sendRuntimeMessage({ type: "WAIT_FOR_PAGE_SETTLE", timeoutMs: 1500 }).catch(() => {});
          if (isStaleRun()) return;
          await regroundStep(currentStep, currentStep.locatorStrategyIndex);
          if (isStaleRun()) return;
          res = await sendRuntimeMessage({
            type: "EXECUTE_STEP",
            step: currentStep,
            options: {
              extractedDataStore: plan.extractedData,
              uploadedDocumentFields: activeUploadedDocument?.fields || {},
              statusFilter: currentStep.statusFilter,
              useAlternateLocators: true,
              locatorStrategyIndex: currentStep.locatorStrategyIndex,
              clickMethod: "alternate",
            },
          });
        }

        // Max 1 AI-assisted recovery on non-consequential steps if local alternate retry also failed
        if (
          !res?.ok &&
          !res?.awaitingApproval &&
          !currentStep.isConsequential &&
          !currentStep._aiRecovered &&
          currentStep.action !== "navigate" &&
          currentStep.action !== "open_website" &&
          currentStep.action !== "download"
        ) {
          currentStep._aiRecovered = true;
          try {
            const aiRec = await Promise.race([
              sendRuntimeMessage(
                {
                  type: "ASK",
                  question: `Step "${currentStep.title}" (action=${currentStep.action}, target=${currentStep.textTarget || ""}) failed with "${res?.error || res?.message || "not found"}". Pick the best matching control or selector on the current page.`,
                  intent: "interpret_command",
                  buddySlug: selectedBuddySlug,
                  customBuddyId: activeCustomBuddyId,
                  preferredProvider: selectedProvider || "auto",
                  preferredModel: $("modelSelector")?.value && $("modelSelector").value !== "auto" ? $("modelSelector").value : undefined,
                },
                { silent: true },
              ).catch(() => null),
              new Promise((r) => setTimeout(() => r(null), 4000)),
            ]);
            if (isStaleRun()) return;
            if (aiRec && aiRec.activeProvider !== "error" && (aiRec.targetText || aiRec.targetSelector)) {
              if (aiRec.targetText) currentStep.textTarget = aiRec.targetText;
              if (aiRec.targetSelector) currentStep.selector = sanitizeStepSelector(aiRec.targetSelector) || undefined;
              res = await sendRuntimeMessage({
                type: "EXECUTE_STEP",
                step: currentStep,
                options: {
                  extractedDataStore: plan.extractedData,
                  uploadedDocumentFields: activeUploadedDocument?.fields || {},
                  statusFilter: currentStep.statusFilter,
                  useAlternateLocators: true,
                  clickMethod: "alternate",
                },
              });
            }
          } catch {}
        }
      }

      if (isStaleRun()) return;

      // --- OAV STAGE 6: TRIPLE-SIGNAL PAGE SETTLE DETECTOR ---
      try {
        await sendRuntimeMessage({
          type: "WAIT_FOR_PAGE_SETTLE",
          timeoutMs: 4000,
        });
      } catch {
        // Non-fatal
      }

      if (isStaleRun()) return;

      if (res?.awaitingApproval) {
        currentStep.status = "awaiting_approval";
        plan.status = "awaiting_approval";
        pendingApprovalStep = currentStep;
        await persistPlanCheckpoint(plan);
        renderTaskPlanUI();
        return;
      }

      if (res?.ok) {
        currentStep.status = "completed";
        currentStep.verified = true;
        currentStep.error = undefined;
        currentStep.result = res.result;

        if (res.extractedData) {
          currentStep.extractedData = res.extractedData;
          if (!Array.isArray(plan.extractedData)) plan.extractedData = [];
          if (Array.isArray(res.extractedData)) {
            plan.extractedData.push(...res.extractedData);
          } else {
            plan.extractedData.push(res.extractedData);
          }
          renderExtractedDataUI();
        }

        plan.currentStepIndex++;
        await persistPlanCheckpoint(plan);
        if (isStaleRun()) return;
        renderTaskPlanUI();
        await new Promise((r) => setTimeout(r, 350));
        if (isStaleRun()) return;
      } else {
        currentStep.status = "failed";
        currentStep.error = res?.error || res?.message || "Action execution failed";
        plan.status = "failed";
        await persistPlanCheckpoint(plan);
        recordTaskExecution(plan).catch(() => {});
        if (isStaleRun()) return;
        renderTaskPlanUI();
        setRigEmotion("error", "Failed");
        appendHistory("buddy", `⚠️ Step ${currentStep.stepNumber} failed: ${currentStep.error}`);
        if ($("planRetryBtn")) $("planRetryBtn").hidden = false;
        return;
      }
    }

    if (isStaleRun()) return;
    // All steps completed
    plan.status = "completed";
    if ($("planRetryBtn")) $("planRetryBtn").hidden = true;
    await persistPlanCheckpoint(plan);
    recordTaskExecution(plan).catch(() => {});
    await clearPlanCheckpoints();
    if (isStaleRun()) return;
    renderTaskPlanUI();
    setRigEmotion("celebrate", "Done");
    const extractedCount = Array.isArray(plan.extractedData) ? plan.extractedData.length : 0;
    appendHistory(
      "buddy",
      `✅ Multi-action workflow completed! Executed and verified all ${plan.steps.length} steps.${extractedCount > 0 ? ` Extracted ${extractedCount} items.` : ""}`,
    );
  } finally {
    if (myRunToken === planRunToken || activePlan !== plan) {
      planLoopRunning = false;
    }
  }
}

function renderExtractedDataUI() {
  if (!activePlan || activePlan.extractedData.length === 0) return;
  const card = $("extractedDataCard");
  if (!card) return;
  card.hidden = false;

  const count = activePlan.extractedData.length;
  if ($("extractedCountTitle")) {
    $("extractedCountTitle").textContent = `📊 Extracted Data (${count} items)`;
  }

  let contentText = "";
  if (activePlan.extractedData.every((d) => typeof d === "string")) {
    contentText = activePlan.extractedData.join("\n");
  } else if (activePlan.extractedData.some((d) => d.orderId)) {
    contentText = activePlan.extractedData
      .map((d) => `• ${d.orderId} (${d.status || "pending"}) — ${d.details || ""}`)
      .join("\n");
  } else {
    contentText = JSON.stringify(activePlan.extractedData, null, 2);
  }

  if ($("extractedContent")) {
    $("extractedContent").textContent = contentText;
  }
}

// --- IN-FLIGHT NATURAL LANGUAGE TASK CONTROL HANDLER ---
function handleInFlightControlCommand(text) {
  const norm = text
    .toLowerCase()
    .trim()
    .replace(/[.!?,]+$/, "");

  const isResumeCmd =
    /^(continue|resume|go ahead|proceed|carry on|aage ke kaam karo|aage ka kaam karo|aage badho|aage chalo|isse aage badhao|chalu karo|chalu rakho|jaari rakho|shuru karo|start karo|continue karo)$/i.test(
      norm,
    );

  if (!activePlan) {
    if (isResumeCmd) {
      appendHistory("user", text);
      // Check if there is a saved checkpoint available to resume
      chrome.storage.local.get(["savedCheckpoint", "ai_buddy_active_plan"], (data) => {
        if (data.savedCheckpoint) {
          $("resumeSavedTaskBtn")?.click();
        } else if (data.ai_buddy_active_plan) {
          activePlan = data.ai_buddy_active_plan;
          isPlanPaused = false;
          pendingApprovalStep = null;
          const curStep = activePlan.steps?.[activePlan.currentStepIndex || 0];
          if (curStep && (curStep.status === "running" || curStep.status === "failed")) {
            curStep.status = "pending";
          }
          activePlan.status = "running";
          planLoopRunning = false;
          renderTaskPlanUI();
          if (Array.isArray(activePlan.extractedData) && activePlan.extractedData.length > 0) {
            renderExtractedDataUI();
          }
          runPlanLoop();
          appendHistory("buddy", "Resuming saved workflow plan…");
        } else {
          appendHistory(
            "buddy",
            "Koi active task pause nahi tha. Mujhe bataiye aap is page par kaunsa task perform karwana chahte hain!",
          );
        }
      });
      return true;
    }
    return false;
  }

  if (isResumeCmd) {
    appendHistory("user", text);
    if (activePlan.status === "awaiting_approval") {
      $("approveConsequentialBtn")?.click();
    } else if (activePlan.status === "paused") {
      $("planPauseResumeBtn")?.click();
    } else if (activePlan.status === "failed") {
      $("planRetryBtn")?.click();
    } else {
      appendHistory("buddy", "Task execution is active and proceeding.");
    }
    return true;
  }

  if (
    /^(pause|hold on|wait a moment|wait|pause for a moment|ruko|ruk jao|thahar jao|ek minute ruko|ek minute|wait karo|pause karo)$/i.test(
      norm,
    )
  ) {
    appendHistory("user", text);
    if (activePlan.status === "running") {
      $("planPauseResumeBtn")?.click();
    } else {
      appendHistory("buddy", "Task is currently paused.");
    }
    return true;
  }

  if (
    /^(skip|skip this step|skip step|next step|chhod do|is step ko chhod do|ye step chhod do|agla step|agle step par jao|skip karo)$/i.test(
      norm,
    )
  ) {
    appendHistory("user", text);
    $("planSkipBtn")?.click();
    return true;
  }

  if (
    /^(use another method|retry|try another way|try again|dusra tareeka use karo|dusra tareeka|phir se try karo|dobara try karo|dobara koshish karo|try again karo)$/i.test(
      norm,
    )
  ) {
    appendHistory("user", text);
    $("planRetryBtn")?.click();
    return true;
  }

  if (
    /^(stop|stop this task|cancel task|cancel|abort|rok do|band karo|khatam karo|task band karo|cancel karo)$/i.test(
      norm,
    )
  ) {
    appendHistory("user", text);
    $("planStopBtn")?.click();
    return true;
  }

  if (
    /^(summary|progress summary|show summary|prepare a summary|summary dikhao|kya hua batao|progress batao|kitna kaam hua batao)$/i.test(
      norm,
    )
  ) {
    appendHistory("user", text);
    const completed = activePlan.steps.filter((s) => s.status === "completed").length;
    appendHistory(
      "buddy",
      `📊 Plan Progress: ${completed} of ${activePlan.steps.length} steps completed. Current status: ${activePlan.status}.`,
    );
    return true;
  }

  return false;
}

// Smart Mode & Placeholders Registry
let currentActiveMode = "auto";
const NATURAL_PLACEHOLDERS = [
  "Ask anything about this page or type a task…",
  "Compare options from this page in a spreadsheet…",
  "Find all prices and product names…",
  "Fill in this checkout/signup form safely…",
  "Summarize key takeaways with verified citations…",
  "Find duplicate entries in open files…",
];
let naturalPlaceholderTimer = null;
let placeholderIdx = 0;

function startRotatingPlaceholders() {
  if (naturalPlaceholderTimer) clearInterval(naturalPlaceholderTimer);
  naturalPlaceholderTimer = setInterval(() => {
    const input = $("promptInput");
    if (input && !input.value.trim() && document.activeElement !== input) {
      placeholderIdx = (placeholderIdx + 1) % NATURAL_PLACEHOLDERS.length;
      input.placeholder = NATURAL_PLACEHOLDERS[placeholderIdx];
    }
  }, 4500);
}

// Auto-expanding composer textarea
const promptInputEl = $("promptInput");
if (promptInputEl) {
  promptInputEl.addEventListener("input", () => {
    promptInputEl.style.height = "auto";
    promptInputEl.style.height = Math.min(promptInputEl.scrollHeight, 140) + "px";
  });
}
// Mode Selector & Quick Action Compatibility Hooks
document.querySelectorAll(".mode-pill").forEach((pill) => {
  pill.onclick = () => {
    document.querySelectorAll(".mode-pill").forEach((p) => p.classList.remove("active"));
    pill.classList.add("active");
    currentActiveMode = pill.getAttribute("data-mode") || "auto";
  };
});

if ($("qaExplainPage")) {
  $("qaExplainPage").onclick = () => {
    sendQuery("Explain what this page is about simply and summarize key points.", "explain_page");
  };
}
if ($("qaResearch")) {
  $("qaResearch").onclick = () => sendQuery("Research: ", "deep_research");
}
if ($("qaWorkWithFiles")) {
  $("qaWorkWithFiles").onclick = () => sendQuery("Analyze spreadsheet and find duplicates: ", "file_analysis");
}
if ($("qaAutomateTask")) {
  $("qaAutomateTask").onclick = () => sendQuery("Automate task: ", "workflow");
}

// Downscale oversized document photos on client Canvas so Chrome IPC + OCR stay fast and under payload limits
async function compressImageFileForOcr(file) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read image."));
    reader.readAsDataURL(file);
  });
  if (file.size <= 800 * 1024 && typeof Image === "undefined") {
    return { base64Data: dataUrl, mimeType: file.type || "image/png" };
  }
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = dataUrl;
    });
    const maxDim = 1600;
    const scale = Math.min(1, maxDim / Math.max(img.width || 1, img.height || 1));
    if (scale === 1 && file.size <= 800 * 1024) {
      return { base64Data: dataUrl, mimeType: file.type || "image/png" };
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return { base64Data: dataUrl, mimeType: file.type || "image/png" };
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return {
      base64Data: canvas.toDataURL("image/jpeg", 0.82),
      mimeType: "image/jpeg",
    };
  } catch {
    return { base64Data: dataUrl, mimeType: file.type || "image/png" };
  }
}

// File / Document Attachment & OCR Understanding (Aadhaar, PAN, Invoices, PDFs, Images, CSV, XLSX, DOCX)
async function handleUploadedDocumentFile(file) {
  if (!file) return;
  const active = getActiveBuddy();
  const isHindi = active.defaultLanguage !== "english";
  const isImage = file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(file.name);
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  const isOfficeDoc = /\.(xlsx|xls|docx)$/i.test(file.name);
  const isTextLike = /\.(txt|csv|tsv|json)$/i.test(file.name);

  if (!isImage && !isPdf && !isTextLike && !isOfficeDoc) {
    const tag = `[Attached: ${file.name} (${Math.round(file.size / 1024)} KB)] `;
    if ($("promptInput") && !$("promptInput").value.includes(file.name)) {
      $("promptInput").value = tag + $("promptInput").value;
    }
    $("promptInput")?.focus();
    return;
  }

  $("statusText").textContent = `📄 Reading uploaded document (${file.name})…`;
  setRigEmotion("thinking", "Reading Doc…");

  try {
    let base64Data = undefined;
    let textContent = undefined;
    let resolvedMime = file.type || (isPdf ? "application/pdf" : "image/png");

    if (isTextLike) {
      textContent = await file.text();
    } else if (isImage) {
      const compressed = await compressImageFileForOcr(file);
      base64Data = compressed.base64Data;
      resolvedMime = compressed.mimeType;
    } else {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("Could not read file."));
        reader.readAsDataURL(file);
      });
      base64Data = dataUrl;
      // For PDFs, also extract any plain ASCII text snippets as offline fallback
      if (isPdf) {
        try {
          const buf = await file.arrayBuffer();
          const decoded = new TextDecoder("latin1").decode(buf);
          const textChunks = [...decoded.matchAll(/\(([^()]{3,120})\)/g)].map((m) => m[1]);
          if (textChunks.length > 0) {
            textContent = textChunks.join("\n");
          }
        } catch {}
      }
    }

    // For Office files (.xlsx/.xls/.docx), upload directly to Real File Workspace parser
    if (isOfficeDoc) {
      const wsRes = await sendRuntimeMessage({
        type: "WORKSPACE_API",
        action: "upload",
        payload: {
          filename: file.name,
          mimeType: resolvedMime,
          base64Data,
        },
      });
      if (wsRes?.ok) {
        setActiveUploadedDocument({
          fileName: file.name,
          documentType: wsRes.extension || "spreadsheet",
          fields: {},
          table: wsRes.preview?.headers
            ? {
                headers: wsRes.preview.headers,
                rowCount: wsRes.preview.rowCount || 0,
                rows: wsRes.preview.sampleRows || [],
              }
            : undefined,
        });
        setRigEmotion("happy", "Workspace Ready");
        const summaryLine = wsRes.summary || `Parsed "${file.name}" into File Workspace.`;
        $("statusText").textContent = summaryLine;
        appendHistory("buddy", `📂 ${summaryLine}`);
        loadWorkspaceArtifacts().catch(() => {});
        return;
      }
      setRigEmotion("error", "Parse Failed");
      const errMsg = wsRes?.message || `Could not parse "${file.name}" in File Workspace.`;
      $("statusText").textContent = errMsg;
      appendHistory("buddy", `⚠️ ${errMsg}`);
      return;
    }

    // For CSV/TSV/TXT/JSON/PDF, sync to File Workspace in parallel while preserving ID/OCR EXTRACT_DOCUMENT
    if (isTextLike || isPdf) {
      sendRuntimeMessage({
        type: "WORKSPACE_API",
        action: "upload",
        payload: {
          filename: file.name,
          mimeType: resolvedMime,
          base64Data: isPdf ? base64Data : undefined,
          textContent: isTextLike ? textContent : undefined,
        },
      })
        .then((wsRes) => {
          if (wsRes?.ok) loadWorkspaceArtifacts().catch(() => {});
        })
        .catch(() => {});
    }

    const extractRes = await sendRuntimeMessage({
      type: "EXTRACT_DOCUMENT",
      document: {
        fileName: file.name,
        mimeType: resolvedMime,
        base64Data,
        textContent,
      },
    });

    const hasFields = Object.keys(extractRes?.fields || {}).length > 0;
    const hasTable = Boolean(extractRes?.table?.rowCount > 0);
    if (extractRes?.ok && (hasFields || hasTable)) {
      setActiveUploadedDocument(extractRes);
      const maskedKeys = Object.entries(extractRes.fields || {}).map(
        ([k, v]) => `${k}: ${maskSensitiveDocValue(k, v)}`,
      );
      setRigEmotion("happy", hasTable && !hasFields ? "Sheet Ready" : "Doc Ready");
      if (hasTable && !hasFields) {
        const cols = (extractRes.table.headers || []).join(", ");
        $("statusText").textContent = `Spreadsheet "${file.name}" loaded (${extractRes.table.rowCount} rows).`;
        const msg = isHindi
          ? `📊 Spreadsheet "${file.name}" read kar li hai! ${extractRes.table.rowCount} rows aur columns (${cols}) parsed hain.`
          : `📊 Loaded "${file.name}": ${extractRes.table.rowCount} rows across columns: ${cols}.`;
        appendHistory("buddy", msg);
        speakResponse(msg, "happy");
      } else {
        $("statusText").textContent = `Document "${file.name}" read (${maskedKeys.length} fields).`;
        const msg = isHindi
          ? `📄 Document (${extractRes.documentType?.toUpperCase() || "ID"}) read kar liya gaya hai! Extracted fields: ${Object.keys(extractRes.fields).join(", ")}.\nAb aap bol sakte hain: "Buddy, is page ka form fill kar do."`
          : `📄 Read "${file.name}" (${extractRes.documentType || "document"}). Extracted fields: ${Object.keys(extractRes.fields).join(", ")}.\nSay "Buddy, fill this form" whenever you're ready!`;
        appendHistory("buddy", msg);
        speakResponse(msg, "happy");
      }
    } else {
      setActiveUploadedDocument({
        fileName: file.name,
        documentType: extractRes?.documentType || "other",
        fields: extractRes?.fields || {},
        ambiguousFields: extractRes?.ambiguousFields || [],
      });
      setRigEmotion("concerned", "Unclear");
      const failNote =
        extractRes?.notes ||
        (isHindi
          ? `⚠️ "${file.name}" se fields clear read nahi ho paye. Kripya clear image upload karein ya chat mein details share karein.`
          : `⚠️ Could not clearly read fields from "${file.name}". Please upload a clearer image/PDF or provide details manually.`);
      $("statusText").textContent = "Document attached (needs clearer scan or Vision AI key).";
      appendHistory("buddy", failNote);
    }
  } catch (err) {
    setRigEmotion("error", "Error");
    $("statusText").textContent = `Could not read "${file.name}".`;
    appendHistory("buddy", `⚠️ Could not read "${file.name}": ${err?.message || err}`);
  }
}

if ($("clearUploadedDocBtn")) {
  $("clearUploadedDocBtn").onclick = () => {
    clearActiveUploadedDocument();
    $("statusText").textContent = "Uploaded document cleared.";
  };
}

if ($("attachFileBtn") && $("composerFileInput")) {
  $("attachFileBtn").onclick = () => {
    $("composerFileInput").click();
  };
  $("composerFileInput").onchange = async (e) => {
    const file = e.target.files?.[0];
    if (file) {
      await handleUploadedDocumentFile(file);
      e.target.value = "";
    }
  };
}

// Page Context Toggle
if ($("pageContextToggle")) {
  const syncPageContextUi = (enabled) => {
    const toggleBtn = $("pageContextToggle");
    toggleBtn.classList.toggle("active", enabled);
    toggleBtn.setAttribute("aria-pressed", String(enabled));
    if ($("pageContextStatus")) {
      $("pageContextStatus").textContent = enabled ? "Page Vision On" : "Detached";
      $("pageContextStatus").style.color = enabled ? "var(--teal)" : "var(--muted)";
    } else {
      toggleBtn.textContent = enabled ? "👁️ Page Vision On" : "👁️ Page Detached";
    }
  };
  $("pageContextToggle").onclick = () => {
    const el = $("pageContextToggle");
    const nextEnabled =
      el.type === "checkbox" ? Boolean(el.checked) : !el.classList.contains("active");
    syncPageContextUi(nextEnabled);
  };
}

async function queryActiveWebTab() {
  if (typeof chrome === "undefined" || !chrome.tabs?.query) return null;
  try {
    const [normTab] = await chrome.tabs.query({
      active: true,
      windowType: "normal",
      lastFocusedWindow: true,
    });
    if (normTab?.url && !RESTRICTED.test(normTab.url)) return normTab;
  } catch {}
  try {
    const normTabs = await chrome.tabs.query({ active: true, windowType: "normal" });
    const webTab = normTabs.find((t) => t?.url && !RESTRICTED.test(t.url));
    if (webTab) return webTab;
  } catch {}
  try {
    const [fallbackTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return fallbackTab || null;
  } catch {
    return null;
  }
}

// Contextual Greeting & Domain Tracker
async function updateGreetingContext() {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  if ($("greetingTime")) $("greetingTime").textContent = greeting;
  try {
    const tab = await queryActiveWebTab();
    if (tab?.url && !RESTRICTED.test(tab.url)) {
      try {
        const u = new URL(tab.url);
        if ($("greetingContext")) {
          $("greetingContext").textContent =
            `Active on ${u.hostname} · ${tab.title ? tab.title.slice(0, 32) + (tab.title.length > 32 ? "…" : "") : "Current Tab"}`;
        }
      } catch {
        if ($("greetingContext")) $("greetingContext").textContent = "Active in browser";
      }
    } else if ($("greetingContext")) {
      $("greetingContext").textContent = "Workspace ready · Send a command to start";
    }
  } catch {
    // Non-fatal
  }
}

// Unified Composer Handlers
$("sendBtn").onclick = () => {
  const val = $("promptInput").value;
  if (!val.trim()) return;

  if (handleInFlightControlCommand(val)) {
    $("promptInput").value = "";
    if (promptInputEl) promptInputEl.style.height = "auto";
    return;
  }

  $("promptInput").value = "";
  if (promptInputEl) promptInputEl.style.height = "auto";
  sendQuery(val);
};

$("promptInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    const val = $("promptInput").value;
    if (!val.trim()) return;

    if (handleInFlightControlCommand(val)) {
      $("promptInput").value = "";
      if (promptInputEl) promptInputEl.style.height = "auto";
      return;
    }

    $("promptInput").value = "";
    if (promptInputEl) promptInputEl.style.height = "auto";
    sendQuery(val);
  }
});

// Multi-task chip clicks
document.querySelectorAll("[data-multi-task]").forEach((chip) => {
  chip.onclick = () => {
    const task = chip.dataset.multiTask;
    if (task) startMultiActionPlan(task);
  };
});

if ($("planPauseResumeBtn")) {
  $("planPauseResumeBtn").onclick = async () => {
    if (!activePlan) return;
    isPlanPaused = !isPlanPaused;
    sendRuntimeMessage({
      type: "ORCHESTRATION_CONTROL",
      action: isPlanPaused ? "pause" : "resume",
    }).catch(() => {});
    if (isPlanPaused) {
      activePlan.status = "paused";
      await persistPlanCheckpoint(activePlan);
      renderTaskPlanUI();
    } else {
      const curStep = activePlan.steps?.[activePlan.currentStepIndex || 0];
      if (curStep && (curStep.status === "running" || curStep.status === "failed")) {
        curStep.status = "pending";
      }
      activePlan.status = "running";
      await persistPlanCheckpoint(activePlan);
      renderTaskPlanUI();
      if (!planLoopRunning) {
        runPlanLoop();
      }
    }
  };
}

if ($("planApproveBtn")) {
  $("planApproveBtn").onclick = () => {
    $("approveConsequentialBtn")?.click();
  };
}

if ($("planInspectLogsBtn")) {
  $("planInspectLogsBtn").onclick = () => {
    const box = $("planLogsBox");
    if (!box) return;
    box.hidden = !box.hidden;
    if (!box.hidden) refreshPlanLogsBoxContent();
  };
}

if ($("planSkipBtn")) {
  $("planSkipBtn").onclick = async () => {
    if (!activePlan || activePlan.currentStepIndex >= activePlan.steps.length) return;
    planRunToken++;
    planLoopRunning = false;
    isPlanPaused = false;
    const st = activePlan.steps[activePlan.currentStepIndex];
    st.status = "skipped";
    activePlan.currentStepIndex++;
    activePlan.status = "running";
    pendingApprovalStep = null;
    if ($("consequentialApprovalCard")) $("consequentialApprovalCard").hidden = true;
    if ($("planRetryBtn")) $("planRetryBtn").hidden = true;
    await persistPlanCheckpoint(activePlan);
    renderTaskPlanUI();
    runPlanLoop();
  };
}

if ($("planStopBtn")) {
  $("planStopBtn").onclick = () => {
    if (!activePlan) return;
    planRunToken++;
    planLoopRunning = false;
    activePlan.status = "cancelled";
    isPlanPaused = false;
    pendingApprovalStep = null;
    sendRuntimeMessage({ type: "ORCHESTRATION_CONTROL", action: "cancel" }).catch(() => {});
    if ($("consequentialApprovalCard")) $("consequentialApprovalCard").hidden = true;
    if ($("planRetryBtn")) $("planRetryBtn").hidden = true;
    clearPlanCheckpoints();
    renderTaskPlanUI();
    setRigEmotion("idle", "Stopped");
    appendHistory("buddy", "⏹️ Multi-action execution plan stopped by user.");
  };
}

if ($("planRetryBtn")) {
  $("planRetryBtn").onclick = async () => {
    if (!activePlan) return;
    planRunToken++;
    planLoopRunning = false;
    isPlanPaused = false;
    const st = activePlan.steps[activePlan.currentStepIndex];
    if (st) {
      st.status = "pending";
      st.error = undefined;
      st.retryCount = (st.retryCount || 0) + 1;
      st.locatorStrategyIndex = st.retryCount;
      // Clear stale selector so alternate locator strategies run fresh against live DOM
      st.selector = undefined;
      st.resolvedSelector = undefined;
    }
    activePlan.status = "running";
    if ($("planRetryBtn")) $("planRetryBtn").hidden = true;
    await persistPlanCheckpoint(activePlan);
    renderTaskPlanUI();
    runPlanLoop();
  };
}

if ($("approveConsequentialBtn")) {
  $("approveConsequentialBtn").onclick = async () => {
    if (!pendingApprovalStep || !activePlan) return;
    planRunToken++;
    planLoopRunning = false;
    if ($("consequentialApprovalCard")) $("consequentialApprovalCard").hidden = true;
    pendingApprovalStep.requiresApproval = false;
    pendingApprovalStep.status = "pending";
    pendingApprovalStep = null;
    activePlan.status = "running";
    await persistPlanCheckpoint(activePlan);
    renderTaskPlanUI();
    await runPlanLoop();
  };
}

if ($("rejectConsequentialBtn")) {
  $("rejectConsequentialBtn").onclick = async () => {
    if (!pendingApprovalStep || !activePlan) return;
    planRunToken++;
    planLoopRunning = false;
    if ($("consequentialApprovalCard")) $("consequentialApprovalCard").hidden = true;
    pendingApprovalStep.status = "skipped";
    pendingApprovalStep = null;
    activePlan.currentStepIndex++;
    activePlan.status = "running";
    await persistPlanCheckpoint(activePlan);
    renderTaskPlanUI();
    runPlanLoop();
  };
}

if ($("copyExtractedBtn")) {
  $("copyExtractedBtn").onclick = async () => {
    const text = $("extractedContent")?.textContent || "";
    if (!text) return;
    let copied = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        copied = true;
      }
    } catch {}
    if (!copied) {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        copied = document.execCommand("copy");
        ta.remove();
      } catch {}
    }
    if (copied) {
      $("copyExtractedBtn").textContent = "✅ Copied!";
      setTimeout(() => {
        if ($("copyExtractedBtn")) $("copyExtractedBtn").textContent = "📋 Copy List";
      }, 2000);
    }
  };
}

document.querySelectorAll("[data-q]").forEach((btn) => {
  btn.onclick = () => sendQuery(btn.dataset.q, btn.dataset.i);
});

if ($("scrollDownChip")) $("scrollDownChip").onclick = () => executeScroll("down");
if ($("scrollUpChip")) $("scrollUpChip").onclick = () => executeScroll("up");
if ($("scrollDownBannerBtn")) $("scrollDownBannerBtn").onclick = () => executeScroll("down");

if ($("openFormAssistantChip")) $("openFormAssistantChip").onclick = () => startSmartFormFill();
if ($("autoFillSampleBtn")) {
  $("autoFillSampleBtn").onclick = () => startSmartFormFill();
}
if ($("verifyFormInputsBtn")) {
  $("verifyFormInputsBtn").onclick = () => {
    switchTab("chat");
    sendQuery("What information does this form require?", "locate_element");
  };
}
if ($("closeFormFillBtn")) {
  $("closeFormFillBtn").onclick = () => {
    if ($("formFillCard")) $("formFillCard").hidden = true;
  };
}

if ($("highlightBtn")) $("highlightBtn").onclick = () => pointArmAtElement();
if ($("speakAnswerBtn")) {
  $("speakAnswerBtn").onclick = () => {
    if (currentAnswer) speakResponse(currentAnswer);
  };
}

if ($("voiceBtn")) {
  $("voiceBtn").onclick = () => {
    if (isBuddySpeaking) {
      interruptBuddySpeech({ resumeListening: true });
      return;
    }
    if (isRecognizing) {
      try {
        recognition?.stop?.();
      } catch {}
    } else {
      startVoiceListening();
    }
  };
}

if ($("liveVoiceBtn")) {
  $("liveVoiceBtn").onclick = () => {
    toggleLiveVoice();
  };
}

if ($("fixErrorsBtn")) {
  $("fixErrorsBtn").onclick = () => {
    sendQuery(
      "Analyze and explain all page errors, alerts, and invalid form fields on this page.",
      "classify",
    );
  };
}
if ($("dismissErrorsBtn")) {
  $("dismissErrorsBtn").onclick = () => {
    if ($("pageErrorBanner")) $("pageErrorBanner").hidden = true;
  };
}

if ($("confirmApproveBtn")) {
  $("confirmApproveBtn").onclick = async () => {
    const actionToRun = pendingAction;
    pendingAction = null;
    if ($("confirmCard")) $("confirmCard").hidden = true;

    if (!actionToRun) {
      setRigEmotion("idle", "Ready");
      return;
    }

    $("statusText").textContent = `Executing ${actionToRun.type}…`;
    setRigEmotion("working", "Acting");

    try {
      const res = await sendRuntimeMessage({
        type: "EXECUTE_ACTION",
        action: actionToRun.type,
        selector: actionToRun.selector,
        value: actionToRun.value,
        options: {
          candidateIndex: actionToRun.candidateIndex,
          fallbackSelector: actionToRun.fallbackSelector,
        },
      });

      if (res?.ambiguous && Array.isArray(res.candidates) && res.candidates.length > 1) {
        const active = getActiveBuddy();
        const isHindi = active?.defaultLanguage !== "english";
        pendingDisambiguation = {
          action: res.action || actionToRun.type || "click",
          target: actionToRun.text || actionToRun.value || "element",
          candidates: res.candidates,
        };
        const listText = res.candidates
          .map((c) => `${c.index}. "${c.text}"${c.context ? ` — [${c.context}]` : ` (${c.tag})`}`)
          .join("\n");
        const askMsg = isHindi
          ? `🤔 "${pendingDisambiguation.target}" ke ${res.candidates.length} controls mile:\n${listText}\nKaunsa chahiye? (1-${res.candidates.length})`
          : `🤔 Found ${res.candidates.length} controls matching "${pendingDisambiguation.target}":\n${listText}\nWhich one should I pick? (1-${res.candidates.length})`;
        setRigEmotion("confused", "Which one?");
        $("statusText").textContent = askMsg;
        appendHistory("buddy", askMsg);
        speakResponse(askMsg, "confused");
      } else if (res?.ok) {
        const hasErrFb = Boolean(res.hasErrorFeedback);
        if (res.stateChange === "navigated") lastHighlightSelector = null;
        setRigEmotion(hasErrFb ? "concerned" : "happy", hasErrFb ? "Notice" : "Done");
        let doneText = res.message || "Action finished successfully.";
        if (Array.isArray(res.pageFeedback) && res.pageFeedback.length > 0 && !doneText.includes(res.pageFeedback[0])) {
          doneText += ` Page reported: "${res.pageFeedback[0]}"`;
        }
        recordSessionAction(doneText, hasErrFb ? "unconfirmed" : "confirmed");
        $("statusText").textContent = doneText;
        appendHistory("buddy", hasErrFb ? `⚠️ ${doneText}` : `✅ Done: ${doneText}`);
        speakResponse(doneText, hasErrFb ? "concerned" : "happy");
      } else {
        if (res?.stale) lastHighlightSelector = null;
        setRigEmotion("error", "Notice");
        const failText = res?.message || "Action failed or was blocked.";
        recordSessionAction(failText, "failed");
        $("statusText").textContent = failText;
        appendHistory("buddy", `⚠️ ${failText}`);
      }
    } catch {
      setRigEmotion("idle", "Idle");
      $("statusText").textContent = "Action finished.";
    } finally {
      setTimeout(() => setRigEmotion("idle", "Idle"), 2000);
    }
  };
}

if ($("confirmCancelBtn")) {
  $("confirmCancelBtn").onclick = () => {
    pendingAction = null;
    if ($("confirmCard")) $("confirmCard").hidden = true;
    setRigEmotion("idle", "Idle");
    $("statusText").textContent = "Action dismissed.";
  };
}

if ($("connectBtn")) {
  $("connectBtn").onclick = async () => {
    setRigEmotion("thinking", "Connecting…");
    $("statusText").textContent = "Checking active AI Buddy connections…";

    // Dynamic resolution in sidepanel connect button
    const { lastBase, session } = await chrome.storage.local.get(["lastBase", "session"]);
    const resolvedBase = await getResolvedBackendBase();
    await chrome.storage.local.set({ lastBase: resolvedBase });

    // 1. Check if user already has a verified AI Buddy tab open in their browser
    try {
      const allTabs = await chrome.tabs.query({});
      let buddyTab = null;
      for (const t of allTabs) {
        if (!t.url) continue;
        try {
          const u = new URL(t.url);
          if (u.hostname.includes("aistudio.google.com")) {
            continue;
          }
          if (t.title?.includes("AI Buddy") || t.title?.includes("your-ai-companion")) {
            buddyTab = t;
            break;
          }
          if (
            (u.hostname.includes("run.app") || u.hostname === "localhost" || u.hostname === "127.0.0.1") &&
            (await probeBuddyHealthOrigin(u.origin, 1200))
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
          connectUrl.searchParams.set("src", "extension_sidepanel");
          await chrome.tabs.update(buddyTab.id, { url: connectUrl.toString() });
        }
        setRigEmotion("celebrate", "Connected!");
        $("statusText").textContent = `✓ Synced with active tab (${tabOrigin})!`;
        await render();
        return;
      }
    } catch {}

    // 2. Open /connect handshake tab if not signed in & activate immediate Guest Session
    const connectUrl = new URL(`${resolvedBase}/connect`);
    if (session?.accessToken) {
      connectUrl.searchParams.set("ext_session", "active");
      if (session.email) connectUrl.searchParams.set("email", session.email);
    }
    connectUrl.searchParams.set("src", "extension_sidepanel");

    if (!session?.accessToken) {
      try {
        await chrome.tabs.create({ url: connectUrl.toString() });
      } catch {}
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

    setRigEmotion("celebrate", "Connected!");
    $("statusText").textContent = "✓ Connected in Guest Mode! Complete web sign-in on /connect anytime.";
    await render();
  };
}

if ($("signoutBtn")) {
  $("signoutBtn").onclick = async () => {
    conversationBuffer.length = 0;
    activeFormSession = null;
    pendingSlot = null;
    pendingAction = null;
    pendingDisambiguation = null;
    lastExecutionAttempt = null;
    activePlan = null;
    isPlanPaused = false;
    pendingApprovalStep = null;
    clearActiveUploadedDocument();
    if ($("historyBox")) $("historyBox").innerHTML = "";
    if ($("taskPlanCard")) $("taskPlanCard").hidden = true;
    await sendRuntimeMessage({ type: "SIGN_OUT" });
    render();
  };
}

// --- MASTER COMMAND CENTRE NAVIGATION & WORKSPACE HANDLERS ---
function escapeHtml(str) {
  return String(str || "").replace(
    /[&<>"']/g,
    (m) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[m],
  );
}

function switchTab(tabName) {
  const btn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
  if (btn) btn.click();
}

// Tab Switching
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.onclick = () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const targetTab = btn.getAttribute("data-tab");
    if ($("tabChat")) $("tabChat").hidden = targetTab !== "chat";
    if ($("tabPage")) $("tabPage").hidden = targetTab !== "page";
    if ($("tabTasks")) $("tabTasks").hidden = targetTab !== "tasks";
    if ($("tabModels")) $("tabModels").hidden = targetTab !== "models";
    if ($("tabRig")) $("tabRig").hidden = targetTab !== "rig";
    if ($("tabSettings")) $("tabSettings").hidden = targetTab !== "settings";

    if (targetTab === "page") loadPageContextSummary();
    if (targetTab === "tasks") {
      loadMemories();
      loadTasksHistory();
      loadWorkspaceArtifacts();
      loadConnectorsStatus();
      loadWorkflowsList();
      syncProactiveQuietState();
    }
    if (targetTab === "models") loadModelHubStatus();
    if (targetTab === "settings") loadSettingsTab();
  };
});

// Clear Chat History Button
if ($("clearChatBtn")) {
  $("clearChatBtn").onclick = () => {
    hideChatLoadingSpinner();
    conversationBuffer.length = 0;
    chrome.storage.local.remove("conversationBuffer").catch(() => {});
    pendingAction = null;
    pendingDisambiguation = null;
    if ($("confirmCard")) $("confirmCard").hidden = true;
    if ($("consequentialApprovalCard")) $("consequentialApprovalCard").hidden = true;
    if ($("taskPlanCard")) $("taskPlanCard").hidden = true;
    if ($("extractedDataCard")) $("extractedDataCard").hidden = true;
    if ($("highlightBtn")) $("highlightBtn").hidden = true;
    if ($("speakAnswerBtn")) $("speakAnswerBtn").hidden = true;
    if ($("historyBox")) {
      $("historyBox").innerHTML =
        '<div class="msg-bubble msg-buddy">Conversation cleared. What can I help you with?</div>';
    }
    $("statusText").textContent = "Conversation cleared.";
  };
}

// Page Context Summary
async function loadPageContextSummary() {
  const summaryBox = $("pageSummaryBox");
  if ($("formFillCard")) $("formFillCard").hidden = false;
  if (!summaryBox) return;
  summaryBox.textContent = "Scanning active tab…";
  try {
    const snap = await sendRuntimeMessage({ type: "GET_SNAPSHOT" });
    if (snap?.ok && snap.snapshot) {
      const s = snap.snapshot;
      summaryBox.innerHTML = `
        <div style="font-weight: 700; color: var(--text); margin-bottom: 2px;">${escapeHtml(s.title || "Current Webpage")}</div>
        <div style="font-size: 10px; color: var(--muted); margin-bottom: 5px; word-break: break-all;">${escapeHtml(s.url || "")}</div>
        <div style="display: flex; gap: 8px; font-size: 10px; color: var(--accent);">
          <span>📝 Forms: ${s.forms?.length || 0}</span>
          <span>🔘 Controls: ${s.controls?.length || 0}</span>
          <span>📑 Headings: ${s.headings?.length || 0}</span>
        </div>
      `;
    } else {
      summaryBox.textContent = "No page context found. Make sure an active website tab is focused.";
    }
  } catch {
    summaryBox.textContent = "Page context could not be read.";
  }
}

if ($("refreshPageContextBtn")) $("refreshPageContextBtn").onclick = loadPageContextSummary;

if ($("pageExplainActionBtn")) {
  $("pageExplainActionBtn").onclick = () => {
    switchTab("chat");
    sendQuery("Explain what this page is about simply and summarize key points.", "explain_page");
  };
}

if ($("pageCheckErrorsActionBtn")) {
  $("pageCheckErrorsActionBtn").onclick = () => {
    switchTab("chat");
    sendQuery("Are there any validation errors or missing required fields?", "classify");
  };
}

if ($("pageExtractTableActionBtn")) {
  $("pageExtractTableActionBtn").onclick = () => {
    switchTab("chat");
    startMultiActionPlan(
      "Find tables on this page, extract all rows and columns, copy list to clipboard",
      true,
    );
  };
}

if ($("pageScrollDownBtn")) {
  $("pageScrollDownBtn").onclick = async () => {
    await executeScroll("down", 450, null, false);
  };
}

if ($("pageScrollUpBtn")) {
  $("pageScrollUpBtn").onclick = async () => {
    await executeScroll("up", 450, null, false);
  };
}

// Preset Workflows
if ($("runMeeshoWorkflowBtn")) {
  $("runMeeshoWorkflowBtn").onclick = () => {
    switchTab("chat");
    startMultiActionPlan(
      "Open Meesho Supplier Panel, go to Orders, open today's orders, find pending orders, copy their order IDs, and prepare a list of them",
      true,
    );
  };
}

if ($("runReconcileWorkflowBtn")) {
  $("runReconcileWorkflowBtn").onclick = () => {
    switchTab("chat");
    startMultiActionPlan(
      "Open seller orders portal, collect today's order numbers and pricing, compare against spreadsheet, identify missing orders, calculate differences, and prepare a non-destructive audit report",
      true,
    );
  };
}

if ($("runResearchWorkflowBtn")) {
  $("runResearchWorkflowBtn").onclick = () => {
    switchTab("chat");
    startMultiActionPlan(
      "Conduct multi-source research across web sources, categorize verified consensus versus conflicting evidence, and generate structured cited report",
      true,
    );
  };
}

if ($("runExtractTableWorkflowBtn")) {
  $("runExtractTableWorkflowBtn").onclick = () => {
    switchTab("chat");
    startMultiActionPlan(
      "Find tables on this page, extract all rows and columns, copy list to clipboard",
      true,
    );
  };
}

if ($("resumeSavedTaskBtn")) {
  $("resumeSavedTaskBtn").onclick = async () => {
    const { savedCheckpoint, ai_buddy_active_plan } = await chrome.storage.local.get([
      "savedCheckpoint",
      "ai_buddy_active_plan",
    ]);
    const card = $("savedCheckpointCard") || $("savedTaskCheckpointCard");
    if (card) card.hidden = true;
    switchTab("chat");

    const sourcePlan =
      ai_buddy_active_plan &&
      Array.isArray(ai_buddy_active_plan.steps) &&
      ai_buddy_active_plan.steps.length > 0 &&
      ai_buddy_active_plan.status !== "completed" &&
      ai_buddy_active_plan.status !== "cancelled"
        ? ai_buddy_active_plan
        : savedCheckpoint &&
            Array.isArray(savedCheckpoint.steps) &&
            savedCheckpoint.steps.length > 0 &&
            savedCheckpoint.status !== "completed" &&
            savedCheckpoint.status !== "cancelled"
          ? savedCheckpoint
          : null;

    if (sourcePlan) {
      planRunToken++;
      planLoopRunning = false;
      activePlan = sourcePlan;
      if (!Array.isArray(activePlan.extractedData)) activePlan.extractedData = [];
      isPlanPaused = false;
      pendingApprovalStep = null;
      const idx = Math.min(Math.max(0, activePlan.currentStepIndex || 0), activePlan.steps.length - 1);
      activePlan.currentStepIndex = idx;
      const curStep = activePlan.steps[idx];
      if (curStep && (curStep.status === "failed" || curStep.status === "running")) {
        curStep.status = "pending";
        curStep.selector = undefined;
      }
      activePlan.status = "running";
      if ($("planRetryBtn")) $("planRetryBtn").hidden = true;
      appendHistory(
        "buddy",
        `▶️ Resuming task: "${activePlan.title}". Continuing from step ${idx + 1} of ${activePlan.steps.length}.`,
      );
      setRigEmotion("working", "Resuming");
      renderTaskPlanUI();
      if (activePlan.extractedData.length > 0) renderExtractedDataUI();
      await runPlanLoop();
    } else if (savedCheckpoint?.originalInstruction || savedCheckpoint?.title) {
      await startMultiActionPlan(savedCheckpoint.originalInstruction || savedCheckpoint.title, true);
    } else {
      appendHistory("buddy", "No active checkpoint found to resume.");
    }
  };
}

if ($("discardSavedTaskBtn")) {
  $("discardSavedTaskBtn").onclick = async () => {
    await chrome.storage.local.remove(["savedCheckpoint", "ai_buddy_active_plan"]);
    const card = $("savedCheckpointCard") || $("savedTaskCheckpointCard");
    if (card) card.hidden = true;
  };
}

async function getLocalMemoriesStore() {
  try {
    const { session, localMemories, scopedLocalMemories = {} } = await chrome.storage.local.get([
      "session",
      "localMemories",
      "scopedLocalMemories",
    ]);
    const scope = getActiveScopeKey(session);
    if (scope === "guest") {
      if (Array.isArray(localMemories)) return localMemories;
    } else if (Array.isArray(scopedLocalMemories?.[scope])) {
      return scopedLocalMemories[scope];
    } else {
      return [];
    }
  } catch {}
  return [
    { key: "preferred_language", value: "Hinglish / English friendly mix", kind: "preference" },
    { key: "ecommerce_platform", value: "Meesho & Amazon Seller Central", kind: "workflow" },
  ];
}

async function setLocalMemoriesStore(memories) {
  try {
    const { session, scopedLocalMemories = {} } = await chrome.storage.local.get([
      "session",
      "scopedLocalMemories",
    ]);
    const scope = getActiveScopeKey(session);
    if (scope === "guest") {
      await chrome.storage.local.set({ localMemories: memories }).catch(() => {});
    } else {
      await chrome.storage.local
        .set({
          scopedLocalMemories: {
            ...scopedLocalMemories,
            [scope]: memories,
          },
        })
        .catch(() => {});
    }
  } catch {}
}

function renderMemoriesListUI(memories) {
  const list = $("memoriesList");
  if (!list) return;
  list.textContent = "";
  if (Array.isArray(memories) && memories.length > 0) {
    memories.forEach((m) => {
      const row = document.createElement("div");
      row.className = "item-row";
      const left = document.createElement("div");
      left.style.overflow = "hidden";
      const title = document.createElement("div");
      title.style.fontWeight = "600";
      title.style.color = "var(--text)";
      title.textContent = `${m.key || ""}${m.kind ? ` [${m.kind}]` : ""}`;
      const val = document.createElement("div");
      val.style.fontSize = "10px";
      val.style.color = "var(--muted)";
      val.textContent = m.value || "";
      left.append(title, val);

      const delBtn = document.createElement("button");
      delBtn.className = "ghost delete-mem-btn";
      delBtn.style.padding = "2px 5px";
      delBtn.style.fontSize = "10px";
      delBtn.style.color = "var(--destructive)";
      delBtn.textContent = "🗑️";
      delBtn.onclick = () => deleteMemory(m.key);

      row.append(left, delBtn);
      list.appendChild(row);
    });
  } else {
    const empty = document.createElement("div");
    empty.style.color = "var(--muted)";
    empty.style.fontSize = "10px";
    empty.textContent = "No custom memories saved yet. Click Add to save preferences.";
    list.appendChild(empty);
  }
}

// Memory Handlers
async function loadMemories() {
  const list = $("memoriesList");
  if (!list) return;
  list.innerHTML = '<div style="color: var(--muted); font-size: 10px;">Loading memories…</div>';
  try {
    const { session } = await chrome.storage.local.get("session");
    const base = await getResolvedBackendBase();
    const headers = {};
    const token = session?.accessToken || session?.access_token;
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetchWithTimeout(`${base}/api/public/extension/memories`, { headers }, 6000);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data?.ok && Array.isArray(data.memories)) {
      const localList = await getLocalMemoriesStore();
      const merged = [...data.memories];
      for (const lm of localList) {
        if (!merged.some((m) => m.key === lm.key)) merged.push(lm);
      }
      await setLocalMemoriesStore(merged);
      renderMemoriesListUI(merged);
      return;
    }
  } catch {
    // Fall back to local extension storage memories seamlessly
  }
  const fallbackList = await getLocalMemoriesStore();
  renderMemoriesListUI(fallbackList);
}

async function deleteMemory(key) {
  if (!key) return;
  try {
    const existing = await getLocalMemoriesStore();
    const filtered = existing.filter((m) => m.key !== key);
    await setLocalMemoriesStore(filtered);

    const { session } = await chrome.storage.local.get("session");
    const base = await getResolvedBackendBase();
    const headers = {};
    const token = session?.accessToken || session?.access_token;
    if (token) headers["Authorization"] = `Bearer ${token}`;
    await fetchWithTimeout(
      `${base}/api/public/extension/memories?key=${encodeURIComponent(key)}`,
      { method: "DELETE", headers },
      5000,
    ).catch(() => {});
    loadMemories();
  } catch (err) {
    if ($("statusText")) $("statusText").textContent = "Could not delete memory right now.";
    console.error("deleteMemory error", err);
  }
}

if ($("addMemoryToggleBtn")) {
  $("addMemoryToggleBtn").onclick = () => {
    if ($("memErrorMsg")) $("memErrorMsg").hidden = true;
    $("addMemoryForm").hidden = !$("addMemoryForm").hidden;
  };
}

if ($("cancelMemoryBtn")) {
  $("cancelMemoryBtn").onclick = () => {
    $("addMemoryForm").hidden = true;
    if ($("memErrorMsg")) $("memErrorMsg").hidden = true;
    if ($("memKeyInput")) $("memKeyInput").value = "";
    if ($("memValInput")) $("memValInput").value = "";
  };
}

if ($("saveMemoryBtn")) {
  $("saveMemoryBtn").onclick = async () => {
    const key = $("memKeyInput")?.value.trim() || "";
    const value = $("memValInput")?.value.trim() || "";
    const kind = $("memKindSelect")?.value || "user_preference";
    const errEl = $("memErrorMsg");
    if (!key || !value) {
      if (errEl) {
        errEl.textContent = "Please enter both a key and a value.";
        errEl.hidden = false;
      }
      return;
    }
    if (errEl) errEl.hidden = true;
    const btn = $("saveMemoryBtn");
    btn.disabled = true;

    try {
      const { session } = await chrome.storage.local.get("session");
      const base = await getResolvedBackendBase();
      const headers = { "Content-Type": "application/json" };
      const token = session?.accessToken || session?.access_token;
      if (token) headers["Authorization"] = `Bearer ${token}`;

      let serverRejected = false;
      try {
        const res = await fetchWithTimeout(
          `${base}/api/public/extension/memories`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({ key, value, kind, scope: "long_term" }),
          },
          6000,
        );
        const data = await res.json().catch(() => null);
        if (!res.ok || data?.ok === false) {
          serverRejected = true;
          if (errEl) {
            errEl.textContent = data?.message || data?.error || `Memory rejected (HTTP ${res.status}).`;
            errEl.hidden = false;
          }
        }
      } catch {
        // Offline / unreachable backend -> allow local extension storage fallback for non-sensitive preferences
      }

      if (serverRejected) {
        return;
      }

      const existing = await getLocalMemoriesStore();
      const updated = [
        { key, value, kind, created_at: new Date().toISOString() },
        ...existing.filter((m) => m.key !== key),
      ];
      await setLocalMemoriesStore(updated);

      $("addMemoryForm").hidden = true;
      if ($("memKeyInput")) $("memKeyInput").value = "";
      if ($("memValInput")) $("memValInput").value = "";
      if ($("statusText")) $("statusText").textContent = `✓ Saved memory "${key}" [${kind}].`;
      loadMemories();
    } finally {
      btn.disabled = false;
    }
  };
}

async function getScopedTaskHistoryStore() {
  const { session, localTaskHistory = [], scopedTaskHistory = {} } = await chrome.storage.local
    .get(["session", "localTaskHistory", "scopedTaskHistory"])
    .catch(() => ({ localTaskHistory: [], scopedTaskHistory: {} }));
  const scope = getActiveScopeKey(session);
  const items = scope === "guest" ? localTaskHistory : scopedTaskHistory?.[scope] || [];
  return { scope, session, scopedTaskHistory, items: Array.isArray(items) ? items : [] };
}

async function recordTaskExecution(plan) {
  if (!plan?.title) return;
  const entry = {
    id: plan.id || `task_${Date.now()}`,
    title: plan.title,
    buddy_slug: selectedBuddySlug || "friendly",
    status: plan.status || "completed",
    created_at: new Date().toISOString(),
  };
  try {
    const { scope, session, scopedTaskHistory, items } = await getScopedTaskHistoryStore();
    const nextHistory = [entry, ...items.filter((t) => t.id !== entry.id)].slice(0, 20);
    if (scope === "guest") {
      await chrome.storage.local.set({ localTaskHistory: nextHistory }).catch(() => {});
    } else {
      await chrome.storage.local
        .set({
          scopedTaskHistory: {
            ...scopedTaskHistory,
            [scope]: nextHistory,
          },
        })
        .catch(() => {});
    }

    const base = await getResolvedBackendBase();
    const headers = { "Content-Type": "application/json" };
    const token = session?.accessToken || session?.access_token;
    if (token) headers["Authorization"] = `Bearer ${token}`;
    await fetchWithTimeout(
      `${base}/api/public/extension/tasks`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          id: entry.id,
          title: entry.title,
          buddySlug: entry.buddy_slug,
          status: entry.status,
        }),
      },
      5000,
    ).catch(() => {});
  } catch {}
}

function renderTasksHistoryUI(tasks) {
  const list = $("tasksHistoryList");
  if (!list) return;
  if (Array.isArray(tasks) && tasks.length > 0) {
    list.innerHTML = tasks
      .map(
        (t) => `
      <div class="item-row">
        <div style="overflow: hidden; max-width: 80%;">
          <div style="font-weight: 600; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(t.title)}</div>
          <div style="font-size: 10px; color: var(--muted);">${t.created_at ? new Date(t.created_at).toLocaleTimeString() : ""} · ${escapeHtml(t.buddy_slug || t.buddySlug || "friendly")}</div>
        </div>
        <span class="step-status-tag ${escapeHtml(t.status || "completed")}">${escapeHtml(t.status || "completed")}</span>
      </div>
    `,
      )
      .join("");
  } else {
    list.innerHTML =
      '<div style="color: var(--muted); font-size: 10px;">No recent tasks executed yet.</div>';
  }
}

// Tasks History Handlers
async function loadTasksHistory() {
  const list = $("tasksHistoryList");
  if (!list) return;
  list.innerHTML = '<div style="color: var(--muted); font-size: 10px;">Loading task history…</div>';
  const { session, items: scopedHistory } = await getScopedTaskHistoryStore();
  try {
    const base = await getResolvedBackendBase();
    const headers = {};
    const token = session?.accessToken || session?.access_token;
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetchWithTimeout(`${base}/api/public/extension/tasks`, { headers }, 6000);
    if (res.ok) {
      const data = await res.json();
      if (data?.ok && Array.isArray(data.tasks)) {
        const merged = [...data.tasks];
        for (const lt of scopedHistory) {
          if (!merged.some((t) => t.id === lt.id)) merged.push(lt);
        }
        renderTasksHistoryUI(merged.slice(0, 20));
        checkSavedCheckpoint();
        return;
      }
    }
  } catch {
    // Fallback to scoped task history cleanly
  }
  renderTasksHistoryUI(scopedHistory);
  checkSavedCheckpoint();
}

async function checkSavedCheckpoint() {
  try {
    const { savedCheckpoint, ai_buddy_active_plan } = await chrome.storage.local.get([
      "savedCheckpoint",
      "ai_buddy_active_plan",
    ]);
    const card = $("savedCheckpointCard") || $("savedTaskCheckpointCard");
    const resumablePlan =
      ai_buddy_active_plan &&
      Array.isArray(ai_buddy_active_plan.steps) &&
      ai_buddy_active_plan.steps.length > 0 &&
      ai_buddy_active_plan.status !== "completed" &&
      ai_buddy_active_plan.status !== "cancelled"
        ? ai_buddy_active_plan
        : null;

    if (savedCheckpoint && savedCheckpoint.status !== "completed") {
      if (card) {
        card.hidden = false;
        if ($("savedTaskCheckpointDesc")) {
          $("savedTaskCheckpointDesc").textContent =
            `Task "${savedCheckpoint.title}" is paused at step ${(savedCheckpoint.currentStepIndex || 0) + 1} of ${savedCheckpoint.totalSteps || savedCheckpoint.steps?.length || 1}.`;
        }
      }
    } else if (resumablePlan) {
      if (card) {
        card.hidden = false;
        if ($("savedTaskCheckpointDesc")) {
          $("savedTaskCheckpointDesc").textContent =
            `Task "${resumablePlan.title}" is paused at step ${(resumablePlan.currentStepIndex || 0) + 1} of ${resumablePlan.steps.length}.`;
        }
      }
    } else {
      if (card) card.hidden = true;
    }
  } catch {
    // Non-fatal
  }
}

if ($("refreshTasksHistoryBtn")) $("refreshTasksHistoryBtn").onclick = loadTasksHistory;

// ================= PHASE 3 + PHASE 4 CONTROLLERS =================
let latestOrchestrationMeta = null;
let latestSessionContext = null;
let latestCostTelemetry = null;
let proactiveQuietMode = false;
let pendingWorkflowDraft = null;
let cachedWorkspaceArtifacts = [];

function refreshPlanLogsBoxContent() {
  const box = $("planLogsBox");
  if (!box) return;
  const lines = [];
  if (latestOrchestrationMeta?.path) {
    const agents = latestOrchestrationMeta.agentsAssigned || latestOrchestrationMeta.selectedAgents || [];
    lines.push(
      `[Orchestrator] path=${latestOrchestrationMeta.path} | agents=${agents.join(", ") || "none"}`,
    );
  }
  if (latestOrchestrationMeta?.dagSummary || latestOrchestrationMeta?.subtaskCounts) {
    const d = latestOrchestrationMeta.dagSummary || {};
    const c = latestOrchestrationMeta.subtaskCounts || {};
    lines.push(
      `[DAG] total=${c.total ?? 0}, completed=${c.completed ?? 0}, failed=${c.failed ?? 0}, awaiting=${c.awaitingApproval ?? 0}, waves=${d.parallelWaves ?? 0}, maxConcurrency=${d.maxObservedConcurrency ?? 1}`,
    );
  }
  if (Array.isArray(latestSessionContext?.decisions)) {
    latestSessionContext.decisions.slice(-6).forEach((dec) => {
      lines.push(`[Decision:${dec.madeBy || dec.agentId || "agent"}] ${dec.summary || dec.decision || ""} — ${dec.rationale || ""}`);
    });
  }
  if (Array.isArray(latestSessionContext?.executionHistory)) {
    latestSessionContext.executionHistory.slice(-6).forEach((h) => {
      lines.push(`[Exec:${h.agentId}] ${h.action} (${h.outcome}): ${h.detail}`);
    });
  }
  if (Array.isArray(activePlan?.steps)) {
    activePlan.steps.forEach((s) => {
      lines.push(
        `[Step ${s.stepNumber}] ${s.status}: ${s.title}${s.error ? ` (err: ${s.error})` : ""}`,
      );
    });
  }
  box.textContent = lines.length > 0 ? lines.join("\n") : "No orchestration logs captured yet.";
}

function updateLiveOrchestrationState(meta, sessionCtx, costTelemetry) {
  latestOrchestrationMeta = meta;
  latestSessionContext = sessionCtx;
  latestCostTelemetry = costTelemetry || sessionCtx?.costTelemetry || null;

  const summaryEl = $("agentDashboardSummary");
  const listEl = $("liveSubtaskDetailsList");
  const calls = latestCostTelemetry?.totalModelCalls ?? latestCostTelemetry?.totalAiCalls ?? 0;
  const tok = latestCostTelemetry?.totalEstimatedTokens ?? latestCostTelemetry?.estimatedTokensUsed ?? 0;
  const conc = meta?.dagSummary?.maxObservedConcurrency || 1;
  const assignedAgents = meta?.agentsAssigned || meta?.selectedAgents || [];

  if (summaryEl) {
    summaryEl.textContent = `${meta?.path || "idle"} · ${calls} calls · ${tok} tok · x${conc} parallel`;
  }
  if (listEl) {
    listEl.textContent = "";
    const subs = Array.isArray(meta?.subtaskDetails) ? meta.subtaskDetails : [];
    if (subs.length === 0) {
      const msg = document.createElement("div");
      msg.style.color = "var(--text-muted)";
      msg.style.fontSize = "10px";
      msg.textContent =
        assignedAgents.length
          ? `Fast path verified (${assignedAgents.join(", ")}).`
          : "No active multi-agent subtasks yet.";
      listEl.appendChild(msg);
    } else {
      subs.forEach((sub) => {
        const row = document.createElement("div");
        row.className = "item-row";
        const left = document.createElement("div");
        left.style.overflow = "hidden";
        const title = document.createElement("div");
        title.style.fontWeight = "600";
        title.style.fontSize = "10px";
        title.style.color = "var(--text)";
        title.textContent = `${sub.agentName || sub.agentId}: ${sub.responsibility || sub.title || ""}`;
        const subMeta = document.createElement("div");
        subMeta.style.fontSize = "9px";
        subMeta.style.color = "var(--muted)";
        const depList = Array.isArray(sub.dependencies)
          ? sub.dependencies
          : Array.isArray(sub.dependsOn)
            ? sub.dependsOn
            : [];
        const deps = depList.length ? `deps: ${depList.join(", ")}` : "root branch";
        const retries = sub.retryCount ?? sub.retriesUsed ?? 0;
        subMeta.textContent = `${deps} · retries=${retries}${sub.error ? ` · ${sub.error}` : ""}`;
        left.append(title, subMeta);

        const badge = document.createElement("span");
        badge.className = `step-status-tag ${sub.status || "completed"}`;
        badge.textContent = sub.verified ? "verified" : sub.status || "done";
        row.append(left, badge);
        listEl.appendChild(row);
      });
    }
  }
  if ($("planCostBadge") && latestCostTelemetry) {
    $("planCostBadge").textContent = `${tok} tok · ${calls} calls`;
    $("planCostBadge").hidden = false;
  }
  refreshPlanLogsBoxContent();
}

async function syncProactiveQuietState() {
  try {
    const data = await chrome.storage.local.get("proactiveQuietMode");
    proactiveQuietMode = Boolean(data.proactiveQuietMode);
    if ($("proactiveQuietToggle")) {
      $("proactiveQuietToggle").checked = proactiveQuietMode;
    }
  } catch {}
}

if ($("proactiveQuietToggle")) {
  $("proactiveQuietToggle").onchange = async (e) => {
    proactiveQuietMode = Boolean(e.target.checked);
    await chrome.storage.local.set({ proactiveQuietMode }).catch(() => {});
    if (proactiveQuietMode && $("proactiveInsightsCard")) {
      $("proactiveInsightsCard").hidden = true;
    }
  };
}

function renderProactiveSuggestionsUI(suggestions) {
  const card = $("proactiveInsightsCard");
  const list = $("proactiveSuggestionsList");
  if (!card || !list) return;
  if (proactiveQuietMode || !Array.isArray(suggestions) || suggestions.length === 0) {
    card.hidden = true;
    return;
  }
  list.textContent = "";
  suggestions.forEach((s) => {
    const row = document.createElement("div");
    row.className = "item-row";
    const left = document.createElement("div");
    left.style.flex = "1";
    const title = document.createElement("div");
    title.style.fontWeight = "600";
    title.style.fontSize = "10px";
    title.style.color = "var(--text)";
    title.textContent = s.title || s.category || "Suggestion";
    const reason = document.createElement("div");
    reason.style.fontSize = "9px";
    reason.style.color = "var(--muted)";
    reason.textContent = s.message || s.reason || "";
    left.append(title, reason);

    const runBtn = document.createElement("button");
    runBtn.className = "ghost";
    runBtn.style.padding = "2px 7px";
    runBtn.style.fontSize = "10px";
    runBtn.textContent = "Run";
    runBtn.onclick = () => {
      switchTab("chat");
      if ($("promptInput")) {
        $("promptInput").value = s.suggestedActionPrompt || s.suggestedPrompt || s.title || "";
        $("promptInput").focus();
      }
    };
    row.append(left, runBtn);
    list.appendChild(row);
  });
  card.hidden = false;
}

async function loadWorkspaceArtifacts() {
  const list = $("workspaceArtifactsList");
  if (!list) return;
  const res = await sendRuntimeMessage({ type: "WORKSPACE_API", action: "list" }).catch(() => null);
  if (!res?.ok) {
    list.textContent = "";
    const msg = document.createElement("div");
    msg.style.color = "var(--muted)";
    msg.style.fontSize = "10px";
    msg.textContent = res?.message || "Workspace API offline.";
    list.appendChild(msg);
    return;
  }
  cachedWorkspaceArtifacts = Array.isArray(res.artifacts) ? res.artifacts : [];
  list.textContent = "";
  if (cachedWorkspaceArtifacts.length === 0) {
    const empty = document.createElement("div");
    empty.style.color = "var(--muted)";
    empty.style.fontSize = "10px";
    empty.textContent = "No files in workspace yet. Click Upload or Attach.";
    list.appendChild(empty);
    return;
  }
  cachedWorkspaceArtifacts.forEach((art) => {
    const row = document.createElement("div");
    row.className = "item-row";
    const left = document.createElement("div");
    left.style.overflow = "hidden";
    left.style.maxWidth = "62%";
    const name = document.createElement("div");
    name.style.fontWeight = "600";
    name.style.fontSize = "10px";
    name.style.color = "var(--text)";
    name.textContent = `${art.filename} (${Math.max(1, Math.round((art.sizeBytes || 0) / 1024))} KB)`;
    const summary = document.createElement("div");
    summary.style.fontSize = "9px";
    summary.style.color = "var(--muted)";
    summary.textContent = art.summary || art.extension || "";
    left.append(name, summary);

    const actions = document.createElement("div");
    actions.style.display = "flex";
    actions.style.gap = "3px";

    const inspectBtn = document.createElement("button");
    inspectBtn.className = "ghost";
    inspectBtn.style.padding = "2px 5px";
    inspectBtn.style.fontSize = "9px";
    inspectBtn.textContent = "View";
    inspectBtn.onclick = async () => {
      const insp = await sendRuntimeMessage({
        type: "WORKSPACE_API",
        action: "inspect",
        artifactId: art.artifactId,
      });
      if (insp?.ok && insp.artifact && $("extractedDataCard") && $("extractedContent")) {
        $("extractedDataCard").hidden = false;
        if ($("extractedCountTitle")) $("extractedCountTitle").textContent = `📂 ${insp.artifact.filename}`;
        $("extractedContent").textContent = JSON.stringify(insp.artifact.parsedPreview || insp.artifact, null, 2);
      }
    };

    const dlBtn = document.createElement("button");
    dlBtn.className = "ghost";
    dlBtn.style.padding = "2px 5px";
    dlBtn.style.fontSize = "9px";
    dlBtn.textContent = "⬇️";
    dlBtn.onclick = async () => {
      const dlRes = await sendRuntimeMessage({
        type: "WORKSPACE_API",
        action: "download",
        artifactId: art.artifactId,
        filenameHint: art.filename,
      });
      if ($("workspaceStatusMsg")) {
        $("workspaceStatusMsg").textContent = dlRes?.ok
          ? `Downloaded ${art.filename}.`
          : dlRes?.message || "Download failed.";
        $("workspaceStatusMsg").hidden = false;
      }
    };

    const delBtn = document.createElement("button");
    delBtn.className = "ghost";
    delBtn.style.padding = "2px 5px";
    delBtn.style.fontSize = "9px";
    delBtn.style.color = "var(--destructive)";
    delBtn.textContent = "🗑️";
    delBtn.onclick = async () => {
      await sendRuntimeMessage({ type: "WORKSPACE_API", action: "delete", artifactId: art.artifactId });
      loadWorkspaceArtifacts();
    };

    actions.append(inspectBtn, dlBtn, delBtn);
    row.append(left, actions);
    list.appendChild(row);
  });
}

if ($("refreshWorkspaceBtn")) $("refreshWorkspaceBtn").onclick = loadWorkspaceArtifacts;
if ($("workspaceUploadTriggerBtn")) {
  $("workspaceUploadTriggerBtn").onclick = () => $("composerFileInput")?.click();
}
if ($("workspaceCompareBtn")) {
  $("workspaceCompareBtn").onclick = async () => {
    const sheets = cachedWorkspaceArtifacts.filter((a) => /^(xlsx|csv|tsv)$/i.test(a.extension || ""));
    const statusEl = $("workspaceStatusMsg");
    if (sheets.length < 2) {
      if (statusEl) {
        statusEl.textContent = "Upload at least 2 CSV/TSV/XLSX files to compare.";
        statusEl.hidden = false;
      }
      return;
    }
    const cmpRes = await sendRuntimeMessage({
      type: "WORKSPACE_API",
      action: "compare",
      payload: {
        baseArtifactId: sheets[1].artifactId,
        compareArtifactId: sheets[0].artifactId,
      },
    });
    if (cmpRes?.ok && $("extractedDataCard") && $("extractedContent")) {
      $("extractedDataCard").hidden = false;
      if ($("extractedCountTitle")) $("extractedCountTitle").textContent = "⚖️ Sheet Comparison";
      $("extractedContent").textContent = JSON.stringify(cmpRes.comparison || cmpRes, null, 2);
      if (statusEl) {
        statusEl.textContent = `Compared ${sheets[1].filename} vs ${sheets[0].filename}.`;
        statusEl.hidden = false;
      }
    } else if (statusEl) {
      statusEl.textContent = cmpRes?.message || "Comparison failed.";
      statusEl.hidden = false;
    }
  };
}
if ($("workspaceExportReportBtn")) {
  $("workspaceExportReportBtn").onclick = async () => {
    const statusEl = $("workspaceStatusMsg");
    const title = activePlan?.title || "AI Buddy Verified Report";
    const bodyText =
      $("extractedContent")?.textContent?.trim() ||
      cachedWorkspaceArtifacts.map((a) => `${a.filename}: ${a.summary}`).join("\n") ||
      "Generated from AI Buddy File Workspace.";
    const genRes = await sendRuntimeMessage({
      type: "WORKSPACE_API",
      action: "generate",
      payload: {
        format: "pdf",
        filename: `ai-buddy-report-${Date.now()}.pdf`,
        title,
        sections: [{ heading: title, body: bodyText.slice(0, 6000) }],
      },
    });
    if (genRes?.ok && genRes.artifactId) {
      await sendRuntimeMessage({
        type: "WORKSPACE_API",
        action: "download",
        artifactId: genRes.artifactId,
        filenameHint: genRes.filename,
      });
      if (statusEl) {
        statusEl.textContent = `${genRes.summary} Download started.`;
        statusEl.hidden = false;
      }
      loadWorkspaceArtifacts();
    } else if (statusEl) {
      statusEl.textContent = genRes?.message || "PDF export failed.";
      statusEl.hidden = false;
    }
  };
}

async function loadConnectorsStatus() {
  const list = $("connectedAppsList");
  if (!list) return;
  const res = await sendRuntimeMessage({ type: "CONNECTORS_API", action: "list" }).catch(() => null);
  list.textContent = "";
  if (!res?.ok || !Array.isArray(res.connectors)) {
    const msg = document.createElement("div");
    msg.style.color = "var(--muted)";
    msg.style.fontSize = "10px";
    msg.textContent = res?.message || "Connectors status unavailable.";
    list.appendChild(msg);
    return;
  }
  res.connectors.forEach((c) => {
    const row = document.createElement("div");
    row.className = "item-row";
    row.style.flexDirection = "column";
    row.style.alignItems = "stretch";
    row.style.gap = "4px";

    const top = document.createElement("div");
    top.style.display = "flex";
    top.style.justifyContent = "space-between";
    top.style.alignItems = "center";

    const info = document.createElement("div");
    const title = document.createElement("div");
    title.style.fontWeight = "600";
    title.style.fontSize = "10px";
    title.style.color = "var(--text)";
    title.textContent = `${c.name} · ${c.operational ? "Connected" : c.authState || "Not Authorized"}`;
    const sub = document.createElement("div");
    sub.style.fontSize = "9px";
    sub.style.color = "var(--muted)";
    sub.textContent =
      Array.isArray(c.missingRequirements) && c.missingRequirements.length > 0
        ? c.missingRequirements.join("; ")
        : c.description || c.reason || (c.requiredScopes || []).join(", ");
    info.append(title, sub);

    const btn = document.createElement("button");
    btn.className = "ghost";
    btn.style.padding = "2px 6px";
    btn.style.fontSize = "9px";
    btn.textContent = c.operational ? "Disconnect" : "Connect Token";

    const tokenForm = document.createElement("div");
    tokenForm.hidden = true;
    tokenForm.style.display = "flex";
    tokenForm.style.gap = "4px";
    const tokIn = document.createElement("input");
    tokIn.type = "password";
    tokIn.placeholder = `Paste ${c.name} token (stored server-side)`;
    tokIn.style.flex = "1";
    tokIn.style.fontSize = "10px";
    tokIn.style.padding = "4px";
    tokIn.style.background = "#0b0f19";
    tokIn.style.color = "var(--text)";
    tokIn.style.border = "1px solid var(--border)";
    tokIn.style.borderRadius = "var(--radius-sm)";
    const saveTokBtn = document.createElement("button");
    saveTokBtn.className = "ghost";
    saveTokBtn.style.fontSize = "9px";
    saveTokBtn.style.padding = "2px 6px";
    saveTokBtn.textContent = "Save";
    saveTokBtn.onclick = async () => {
      const accessToken = tokIn.value.trim();
      if (!accessToken) return;
      await sendRuntimeMessage({
        type: "CONNECTORS_API",
        action: "connect",
        payload: { connectorId: c.id, accessToken },
      });
      loadConnectorsStatus();
    };
    tokenForm.append(tokIn, saveTokBtn);

    btn.onclick = async () => {
      if (c.operational) {
        await sendRuntimeMessage({ type: "CONNECTORS_API", action: "disconnect", connectorId: c.id });
        loadConnectorsStatus();
      } else {
        tokenForm.hidden = !tokenForm.hidden;
      }
    };

    top.append(info, btn);
    row.append(top, tokenForm);
    list.appendChild(row);
  });
}

if ($("refreshConnectorsBtn")) $("refreshConnectorsBtn").onclick = loadConnectorsStatus;

function showWorkflowDraftPreview(draft) {
  pendingWorkflowDraft = draft;
  const box = $("workflowDraftPreview");
  const summary = $("workflowDraftSummary");
  if (!box || !summary || !draft) return;
  const r = draft.recipe || draft;
  const missingArr = draft.missingDetails || draft.missingRequirements || [];
  const missing = Array.isArray(missingArr) && missingArr.length
    ? ` | Missing: ${missingArr.join(", ")}`
    : "";
  const schedLabel =
    draft.scheduleSummary ||
    r.schedule?.humanReadable ||
    r.schedule?.frequency ||
    r.schedule?.type ||
    "manual";
  summary.textContent = `${r.name || "Workflow"} · Schedule: ${schedLabel}${missing}`;
  box.hidden = false;
}

if ($("previewWorkflowBtn")) {
  $("previewWorkflowBtn").onclick = async () => {
    const prompt = $("nlWorkflowInput")?.value.trim();
    if (!prompt) return;
    const res = await sendRuntimeMessage({
      type: "WORKFLOWS_API",
      action: "parse",
      payload: {
        prompt,
        availableFiles: cachedWorkspaceArtifacts.map((a) => a.filename),
      },
    });
    if (res?.ok && res.draft) {
      showWorkflowDraftPreview({ ...res.draft, sourcePrompt: prompt });
    }
  };
}

if ($("discardWorkflowDraftBtn")) {
  $("discardWorkflowDraftBtn").onclick = () => {
    pendingWorkflowDraft = null;
    if ($("workflowDraftPreview")) $("workflowDraftPreview").hidden = true;
  };
}

if ($("approveWorkflowBtn")) {
  $("approveWorkflowBtn").onclick = async () => {
    const prompt = pendingWorkflowDraft?.sourcePrompt || $("nlWorkflowInput")?.value.trim();
    if (!prompt) return;
    const created = await sendRuntimeMessage({
      type: "WORKFLOWS_API",
      action: "create",
      payload: {
        prompt,
        availableFiles: cachedWorkspaceArtifacts.map((a) => a.filename),
      },
    });
    if (created?.ok && created.workflow?.id) {
      await sendRuntimeMessage({
        type: "WORKFLOWS_API",
        action: "approve",
        payload: { workflowId: created.workflow.id },
      });
      pendingWorkflowDraft = null;
      if ($("workflowDraftPreview")) $("workflowDraftPreview").hidden = true;
      if ($("nlWorkflowInput")) $("nlWorkflowInput").value = "";
      loadWorkflowsList();
    }
  };
}

async function loadWorkflowsList() {
  const list = $("workflowsList");
  const noteEl = $("schedulerInfraNote");
  if (!list) return;
  const res = await sendRuntimeMessage({ type: "WORKFLOWS_API", action: "list" }).catch(() => null);
  list.textContent = "";
  if (noteEl && res?.schedulerInfrastructure?.honestLimitation) {
    noteEl.textContent = res.schedulerInfrastructure.honestLimitation;
  }
  const wfs = Array.isArray(res?.workflows) ? res.workflows : [];
  if (wfs.length === 0) {
    const empty = document.createElement("div");
    empty.style.color = "var(--muted)";
    empty.style.fontSize = "10px";
    empty.textContent = "No saved automated workflows yet.";
    list.appendChild(empty);
    return;
  }
  wfs.forEach((wf) => {
    const row = document.createElement("div");
    row.className = "item-row";
    const left = document.createElement("div");
    left.style.overflow = "hidden";
    const title = document.createElement("div");
    title.style.fontWeight = "600";
    title.style.fontSize = "10px";
    title.style.color = "var(--text)";
    title.textContent = `${wf.name} (${wf.enabled ? "Active" : "Paused"})`;
    const sub = document.createElement("div");
    sub.style.fontSize = "9px";
    sub.style.color = "var(--muted)";
    const schedInfo =
      wf.schedule?.cronExpression ||
      wf.schedule?.timeOfDay ||
      wf.schedule?.frequency ||
      wf.schedule?.type ||
      "manual";
    const runCount = wf.executionHistory?.length ?? wf.executionCount ?? wf.runHistory?.length ?? 0;
    sub.textContent = `${schedInfo} · runs=${runCount}`;
    left.append(title, sub);

    const actions = document.createElement("div");
    actions.style.display = "flex";
    actions.style.gap = "3px";

    const runBtn = document.createElement("button");
    runBtn.className = "ghost";
    runBtn.style.padding = "2px 5px";
    runBtn.style.fontSize = "9px";
    runBtn.textContent = "▶";
    runBtn.onclick = async () => {
      await sendRuntimeMessage({
        type: "WORKFLOWS_API",
        action: "run_now",
        payload: { workflowId: wf.id },
      });
      loadWorkflowsList();
    };

    const toggleBtn = document.createElement("button");
    toggleBtn.className = "ghost";
    toggleBtn.style.padding = "2px 5px";
    toggleBtn.style.fontSize = "9px";
    toggleBtn.textContent = wf.enabled ? "⏸" : "▶";
    toggleBtn.onclick = async () => {
      await sendRuntimeMessage({
        type: "WORKFLOWS_API",
        action: wf.enabled ? "pause" : "resume",
        payload: { workflowId: wf.id },
      });
      loadWorkflowsList();
    };

    const delBtn = document.createElement("button");
    delBtn.className = "ghost";
    delBtn.style.padding = "2px 5px";
    delBtn.style.fontSize = "9px";
    delBtn.style.color = "var(--destructive)";
    delBtn.textContent = "🗑️";
    delBtn.onclick = async () => {
      await sendRuntimeMessage({ type: "WORKFLOWS_API", action: "delete", workflowId: wf.id });
      loadWorkflowsList();
    };

    actions.append(runBtn, toggleBtn, delBtn);
    row.append(left, actions);
    list.appendChild(row);
  });
}

// Models & Providers Handlers
function updateProviderNoticeUI(providerId) {
  const pid = providerId || selectedProvider || "auto";
  const info = cachedProviderStatuses[pid] || DEFAULT_PROVIDER_META[pid] || DEFAULT_PROVIDER_META.gemini;
  const badge = $("activeProviderStatusBadge");
  const notice = $("providerSelectionNotice");

  if (pid === "auto") {
    const anyReady = Object.values(cachedProviderStatuses).some((p) => p?.configured);
    if (badge) {
      badge.textContent = anyReady ? "Auto Ready" : "Check Keys";
      badge.className = `step-status-tag ${anyReady ? "completed" : "pending"}`;
    }
    if (notice) {
      notice.style.borderColor = anyReady ? "rgba(16, 185, 129, 0.35)" : "rgba(245, 158, 11, 0.35)";
      notice.style.color = anyReady ? "var(--text)" : "#fde68a";
      notice.textContent = anyReady
        ? "Auto Routing active — picks the best connected AI provider automatically."
        : "Auto Routing active — add a provider API key on server or Gemini key in Settings for full AI.";
    }
    return;
  }

  const statusLabel =
    info.statusLabel ||
    (info.configured ? "Connected" : info.supportsLocal ? "Not Connected" : "Missing API");
  const isConnected = info.configured === true || info.status === "connected";

  if (badge) {
    badge.textContent = statusLabel;
    badge.className = `step-status-tag ${isConnected ? "completed" : "pending"}`;
  }

  if (notice) {
    if (isConnected) {
      notice.style.borderColor = "rgba(16, 185, 129, 0.35)";
      notice.style.color = "var(--text)";
      notice.textContent = `${info.name} is connected and strictly selected as your active provider.`;
    } else {
      const missingKey = info.missingKeyName || `${pid.toUpperCase()}_API_KEY`;
      notice.style.borderColor = "rgba(245, 158, 11, 0.35)";
      notice.style.color = "#fde68a";
      notice.textContent = `${info.name}: ${statusLabel} (${missingKey}). Add ${missingKey} or switch to Auto Routing to allow automatic provider selection.`;
    }
  }
}

function inferProviderFromModelId(modelId) {
  const m = String(modelId || "").toLowerCase();
  if (!m || m === "auto") return null;
  if (m.startsWith("gemini-")) return "gemini";
  if (m.startsWith("groq-")) return "groq";
  if (m.startsWith("openai-")) return "openai";
  if (m.startsWith("openrouter-")) return "openrouter";
  if (m.startsWith("ollama-")) return "ollama";
  if (m.startsWith("github-")) return "github";
  if (m.startsWith("cf-") || m.startsWith("cloudflare-")) return "cloudflare";
  if (m.startsWith("hf-") || m.startsWith("huggingface-")) return "huggingface";
  return null;
}

async function selectProvider(providerId) {
  if (!providerId) return;
  selectedProvider = providerId;
  for (const key of [...warnedMissingProviders]) {
    if (key === providerId || key.startsWith(`${providerId}:`)) {
      warnedMissingProviders.delete(key);
    }
  }
  const updates = { selectedProvider: providerId };
  if (providerId !== "auto" && $("modelSelector")) {
    const curModel = $("modelSelector").value;
    const inferred = inferProviderFromModelId(curModel);
    if (inferred && inferred !== providerId) {
      $("modelSelector").value = "auto";
      updates.preferredModel = "auto";
      if ($("headerModelLabel")) $("headerModelLabel").textContent = "Auto Model";
    }
  }
  await chrome.storage.local.set(updates);
  if ($("providerSelector")) {
    $("providerSelector").value = providerId;
  }
  updateProviderNoticeUI(providerId);
  document.querySelectorAll("#providerStatusList .provider-row-item").forEach((row) => {
    const isSel = row.getAttribute("data-provider") === providerId;
    row.style.borderColor = isSel ? "var(--accent-cyan)" : "";
    row.style.background = isSel ? "rgba(6, 182, 212, 0.08)" : "";
  });
}

async function loadModelHubStatus() {
  const list = $("providerStatusList");
  if (!list) return;
  list.innerHTML =
    '<div style="color: var(--muted); font-size: 10px;">Checking provider statuses…</div>';
  try {
    const { preferredModel, selectedProvider: storedProvider, userApiKey } =
      await chrome.storage.local.get(["preferredModel", "selectedProvider", "userApiKey"]);
    selectedProvider = storedProvider || "auto";

    const base = await getResolvedBackendBase();
    const res = await fetchWithTimeout(`${base}/api/public/extension/models`, {}, 8000);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data?.ok) {
      if (data.providers && data.providers.length > 0) {
        data.providers.forEach((p) => {
          const effectiveConfigured = p.configured || (p.id === "gemini" && Boolean(userApiKey));
          const statusLabel = effectiveConfigured
            ? "Connected"
            : p.supportsLocal
              ? "Not Connected"
              : "Missing API";
          cachedProviderStatuses[p.id] = {
            ...p,
            configured: effectiveConfigured,
            status: effectiveConfigured
              ? "connected"
              : p.supportsLocal
                ? "not_connected"
                : "missing_api",
            statusLabel,
          };
        });

        if ($("providerSelector")) {
          const autoOption = `<option value="auto" ${selectedProvider === "auto" ? "selected" : ""}>Auto (Smart Provider Routing)</option>`;
          $("providerSelector").innerHTML =
            autoOption +
            data.providers
              .map((p) => {
                const info = cachedProviderStatuses[p.id] || p;
                return `<option value="${escapeHtml(p.id)}" ${p.id === selectedProvider ? "selected" : ""}>${escapeHtml(p.name)} — ${escapeHtml(info.statusLabel)}</option>`;
              })
              .join("");
        }

        list.innerHTML = data.providers
          .map((p) => {
            const info = cachedProviderStatuses[p.id] || p;
            const isSel = p.id === selectedProvider;
            const statusText = info.statusLabel;
            const detailNote = info.configured
              ? p.rateLimitNote || "Ready for inference"
              : `Missing ${p.missingKeyName || `${p.id.toUpperCase()}_API_KEY`}`;
            return `
          <div class="item-row provider-row-item" data-provider="${escapeHtml(p.id)}" style="cursor: pointer; ${isSel ? "border-color: var(--accent-cyan); background: rgba(6, 182, 212, 0.08);" : ""}">
            <div>
              <span style="font-weight: 600; color: var(--text);">${escapeHtml(p.name)}</span>
              <div style="font-size: 9px; color: var(--muted);">${escapeHtml(detailNote)}</div>
            </div>
            <span class="step-status-tag ${info.configured ? "completed" : "pending"}">${escapeHtml(statusText)}</span>
          </div>
        `;
          })
          .join("");

        list.querySelectorAll(".provider-row-item").forEach((row) => {
          row.onclick = () => {
            const pid = row.getAttribute("data-provider");
            if (pid) selectProvider(pid);
          };
        });

        updateProviderNoticeUI(selectedProvider);
      }

      if (data.models && $("modelSelector")) {
        const currentVal = preferredModel || $("modelSelector").value || "auto";
        const optionsHtml = [
          `<option value="auto" ${currentVal === "auto" ? "selected" : ""}>Auto (Intelligent Routing)</option>`,
          ...data.models.map(
            (m) =>
              `<option value="${m.id}" ${m.id === currentVal ? "selected" : ""}>${escapeHtml(m.name)} (${m.tier})</option>`,
          ),
        ].join("");
        $("modelSelector").innerHTML = optionsHtml;

        if ($("headerModelLabel")) {
          const selectedOption = $("modelSelector").options[$("modelSelector").selectedIndex];
          $("headerModelLabel").textContent =
            selectedOption && currentVal !== "auto"
              ? selectedOption.text.split(" (")[0]
              : "Auto Model";
        }
      }

      if ($("activeModelRecommendation")) {
        const recText =
          currentActiveMode === "research"
            ? "Gemini 4 Hydrogen / 3.8 Flash recommended for high-accuracy claim verification and web synthesis."
            : currentActiveMode === "file"
              ? "Gemini 4 Hydrogen recommended for multi-tab spreadsheets, document OCR, and structured forms."
              : "Gemini 4 Hydrogen recommended for fast DOM grounding, pointing animations, and browser tasks.";
        $("activeModelRecommendation").textContent = recText;
      }
    }
  } catch {
    const { userApiKey } = await chrome.storage.local.get("userApiKey").catch(() => ({}));
    const fallbackProviders = Object.values(DEFAULT_PROVIDER_META)
      .filter((p) => p.id !== "auto")
      .map((p) => {
        const configured = p.id === "gemini" && Boolean(userApiKey);
        return {
          ...p,
          configured,
          status: configured ? "connected" : p.supportsLocal ? "not_connected" : "missing_api",
          statusLabel: configured ? "Connected" : p.supportsLocal ? "Not Connected" : "Missing API",
        };
      });
    fallbackProviders.forEach((p) => {
      cachedProviderStatuses[p.id] = p;
    });
    updateProviderNoticeUI(selectedProvider);
    list.innerHTML = fallbackProviders
      .map((info) => {
        const isSel = info.id === selectedProvider;
        const detailNote = info.configured
          ? "Direct API key saved"
          : `Backend unreachable & missing ${info.missingKeyName}`;
        return `
      <div class="item-row provider-row-item" data-provider="${escapeHtml(info.id)}" style="cursor: pointer; ${isSel ? "border-color: var(--accent-cyan); background: rgba(6, 182, 212, 0.08);" : ""}">
        <div>
          <span style="font-weight: 600; color: var(--text);">${escapeHtml(info.name)}</span>
          <div style="font-size: 9px; color: var(--muted);">${escapeHtml(detailNote)}</div>
        </div>
        <span class="step-status-tag ${info.configured ? "completed" : "pending"}">${escapeHtml(info.statusLabel)}</span>
      </div>
    `;
      })
      .join("");
    list.querySelectorAll(".provider-row-item").forEach((row) => {
      row.onclick = () => {
        const pid = row.getAttribute("data-provider");
        if (pid) selectProvider(pid);
      };
    });
  }
}

if ($("providerSelector")) {
  $("providerSelector").onchange = (e) => {
    selectProvider(e.target.value);
  };
}

if ($("modelSelector")) {
  $("modelSelector").onchange = (e) => {
    const val = e.target.value;
    chrome.storage.local.set({ preferredModel: val });
    const inferredProvider = inferProviderFromModelId(val);
    if (inferredProvider && inferredProvider !== selectedProvider) {
      selectProvider(inferredProvider);
    }
    if ($("headerModelLabel")) {
      const selectedOption = $("modelSelector").options[$("modelSelector").selectedIndex];
      $("headerModelLabel").textContent =
        selectedOption && val !== "auto" ? selectedOption.text.split(" (")[0] : "Auto Model";
    }
  };
}

if ($("headerModelPill")) {
  $("headerModelPill").onclick = () => {
    switchTab("models");
  };
}

if ($("toggleModelComparisonBtn")) {
  $("toggleModelComparisonBtn").onclick = () => {
    const comp = $("modelComparisonView");
    if (comp) {
      comp.hidden = !comp.hidden;
      $("toggleModelComparisonBtn").textContent = comp.hidden
        ? "📊 Compare"
        : "Hide Comparison";
    }
  };
}

if ($("testActiveProviderBtn")) {
  $("testActiveProviderBtn").onclick = async () => {
    const pingBox = $("pingTestResult");
    const targetProv = selectedProvider || "gemini";
    const info = cachedProviderStatuses[targetProv] || DEFAULT_PROVIDER_META[targetProv];
    if (pingBox) {
      pingBox.hidden = false;
      pingBox.style.color = "var(--accent-cyan)";
      pingBox.textContent = `Checking ${info?.name || targetProv} connection…`;
    }
    const { userApiKey } = await chrome.storage.local.get("userApiKey").catch(() => ({}));
    try {
      const base = await getResolvedBackendBase();
      const bodyPayload = { provider: targetProv };
      if (targetProv === "gemini" && userApiKey) {
        bodyPayload.userApiKey = userApiKey;
      }
      const res = await fetchWithTimeout(`${base}/api/public/extension/test-model`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyPayload),
      }, 8000);
      const data = await res.json().catch(() => null);
      if (pingBox && data) {
        if (res.ok && data.ok) {
          pingBox.style.color = "var(--success)";
          pingBox.textContent = `⚡ ${info?.name || targetProv} Connected (${data.latencyMs}ms): ${data.message}`;
          return;
        } else if (targetProv !== "gemini" || !userApiKey) {
          pingBox.style.color = "var(--warning)";
          pingBox.textContent = `ℹ️ ${info?.name || targetProv}: ${data?.message || "Missing API or not connected"}`;
          return;
        }
      }
    } catch {
      // Fallback below if Gemini direct key is present
    }
    if (targetProv === "gemini" && userApiKey) {
      try {
        const started = Date.now();
        const directRes = await fetchWithTimeout(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-4-hydrogen:generateContent?key=${encodeURIComponent(userApiKey)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "Reply OK" }] }] }),
          },
          6000,
        );
        if (pingBox) {
          if (directRes.ok) {
            pingBox.style.color = "var(--success)";
            pingBox.textContent = `⚡ Direct Gemini Key Connected (${Date.now() - started}ms)`;
          } else {
            pingBox.style.color = "var(--warning)";
            pingBox.textContent = `⚠️ Direct Gemini Key rejected (HTTP ${directRes.status}).`;
          }
          return;
        }
      } catch {}
    }
    if (pingBox) {
      pingBox.style.color = "var(--warning)";
      pingBox.textContent = "Ping check unavailable in offline mode.";
    }
  };
}

// Speech / Mute & Display Settings (No manual animation selector in UI)
if ($("muteToggle")) {
  $("muteToggle").onchange = (e) => {
    persistMutedState(e.target.checked);
  };
}

if ($("avatarRenderMode")) {
  $("avatarRenderMode").onchange = (e) => {
    applyRenderMode(e.target.value);
    chrome.storage.local.set({ avatarRenderMode: e.target.value });
  };
}

if ($("sizeSelect")) {
  $("sizeSelect").onchange = (e) => {
    applyStageSize(e.target.value);
    chrome.storage.local.set({ stageSize: e.target.value }).catch(() => {});
  };
}

// ================= TAB 6: SETTINGS LOGIC =================
async function loadSettingsTab() {
  const { session, lastBase, permissionLevel, requireConsent, userApiKey } =
    await chrome.storage.local.get([
      "session",
      "lastBase",
      "permissionLevel",
      "requireConsent",
      "userApiKey",
    ]);

  if ($("settingsAccountBadge")) {
    $("settingsAccountBadge").textContent = session ? "Connected" : "Guest Mode";
    $("settingsAccountBadge").className = `status-badge ${session ? "happy" : ""}`;
  }
  if ($("settingsUserEmail")) {
    $("settingsUserEmail").textContent = session?.email
      ? `Connected as ${session.email}`
      : "Guest mode (All 16 specialist buddies ready offline). Connect for cloud memory.";
  }
  if ($("settingsApiBaseInput")) {
    const resolved = session?.apiBase || lastBase;
    $("settingsApiBaseInput").value = resolved || DEFAULT_BASE;
  }
  if ($("settingsApiKeyInput")) {
    $("settingsApiKeyInput").value = userApiKey || "";
  }

  if ($("settingsPermissionLevel")) {
    $("settingsPermissionLevel").value = permissionLevel || "assist";
  }
  if ($("settingsConsequentialGate")) {
    $("settingsConsequentialGate").checked = requireConsent !== false;
  }

  if ($("settingsVoiceToggleBtn")) {
    $("settingsVoiceToggleBtn").textContent = isMuted ? "🔇 Muted" : "🔊 Unmuted";
  }
}

if ($("settingsSaveApiKeyBtn")) {
  $("settingsSaveApiKeyBtn").onclick = async () => {
    const val = $("settingsApiKeyInput")?.value?.trim() || "";
    await chrome.storage.local.set({ userApiKey: val });
    warnedMissingProviders.clear();
    loadModelHubStatus();
    if ($("settingsApiKeyFeedback")) {
      $("settingsApiKeyFeedback").textContent = val
        ? "✓ Gemini API Key saved! Buddy is now 100% direct & serverless."
        : "✓ Key cleared. Buddy using grounded companion engine.";
      $("settingsApiKeyFeedback").style.display = "block";
      setTimeout(() => {
        if ($("settingsApiKeyFeedback")) $("settingsApiKeyFeedback").style.display = "none";
      }, 3000);
    }
  };
}

if ($("settingsSaveApiBaseBtn")) {
  $("settingsSaveApiBaseBtn").onclick = async () => {
    const val = $("settingsApiBaseInput")?.value?.trim();
    if (val) {
      try {
        const parsed = new URL(val);
        if (parsed.protocol === "http:" || parsed.protocol === "https:") {
          await chrome.storage.local.set({ lastBase: parsed.origin });
          if ($("settingsHostFeedback")) {
            $("settingsHostFeedback").textContent = `✓ Saved server: ${parsed.origin}`;
            $("settingsHostFeedback").style.display = "block";
            setTimeout(() => {
              if ($("settingsHostFeedback")) $("settingsHostFeedback").style.display = "none";
            }, 2500);
          }
          return;
        }
      } catch {}
      if ($("settingsHostFeedback")) {
        $("settingsHostFeedback").textContent = "⚠️ Invalid URL (must be http:// or https://)";
        $("settingsHostFeedback").style.display = "block";
        setTimeout(() => {
          if ($("settingsHostFeedback")) $("settingsHostFeedback").style.display = "none";
        }, 3000);
      }
    }
  };
}

if ($("settingsDetectHostBtn")) {
  $("settingsDetectHostBtn").onclick = async () => {
    const feedbackEl = $("settingsHostFeedback");
    if (feedbackEl) {
      feedbackEl.textContent = "🔍 Probing healthy AI Buddy backend…";
      feedbackEl.style.display = "block";
    }
    try {
      const candidates = [];
      try {
        const allTabs = await chrome.tabs.query({});
        for (const t of allTabs) {
          if (!t?.url || RESTRICTED.test(t.url)) continue;
          const u = new URL(t.url);
          const isBuddyTab =
            t.title?.includes("AI Buddy") ||
            t.title?.includes("your-ai-companion") ||
            u.port === "3000" ||
            u.hostname.includes("run.app");
          if (
            u.protocol.startsWith("http") &&
            !u.hostname.includes("aistudio.google.com") &&
            isBuddyTab
          ) {
            if (t.title?.includes("AI Buddy")) candidates.unshift(u.origin);
            else candidates.push(u.origin);
          }
        }
      } catch {}
      candidates.push("http://localhost:3000", DEFAULT_BASE, FALLBACK_PRE_BASE);
      const uniqueCandidates = [...new Set(candidates)];
      let verifiedOrigin = null;
      for (const origin of uniqueCandidates) {
        if (await probeBuddyHealthOrigin(origin, 2500)) {
          verifiedOrigin = origin;
          verifiedBackendBaseCache = origin;
          break;
        }
      }
      if (verifiedOrigin) {
        if ($("settingsApiBaseInput")) $("settingsApiBaseInput").value = verifiedOrigin;
        await chrome.storage.local.set({ lastBase: verifiedOrigin });
        if (feedbackEl) {
          feedbackEl.textContent = `✓ Verified AI Buddy server: ${verifiedOrigin}`;
        }
      } else if (feedbackEl) {
        feedbackEl.textContent = "⚠️ No live AI Buddy backend responded cleanly. Keeping current server.";
      }
    } catch {
      if (feedbackEl) {
        feedbackEl.textContent = "⚠️ Could not probe backend right now.";
      }
    } finally {
      if (feedbackEl) {
        setTimeout(() => {
          if ($("settingsHostFeedback")) $("settingsHostFeedback").style.display = "none";
        }, 3000);
      }
    }
  };
}

if ($("settingsConnectWebBtn")) {
  $("settingsConnectWebBtn").onclick = () => {
    $("connectBtn")?.click();
  };
}

if ($("settingsSignOutBtn")) {
  $("settingsSignOutBtn").onclick = () => {
    $("signoutBtn")?.click();
    loadSettingsTab();
  };
}

if ($("settingsPermissionLevel")) {
  $("settingsPermissionLevel").onchange = (e) => {
    chrome.storage.local.set({ permissionLevel: e.target.value });
  };
}

if ($("settingsConsequentialGate")) {
  $("settingsConsequentialGate").onchange = (e) => {
    chrome.storage.local.set({ requireConsent: e.target.checked });
  };
}

if ($("settingsVoiceToggleBtn")) {
  $("settingsVoiceToggleBtn").onclick = () => {
    persistMutedState(!isMuted);
  };
}

if ($("settingsClearBufferBtn")) {
  $("settingsClearBufferBtn").onclick = async () => {
    conversationBuffer.length = 0;
    await chrome.storage.local.remove("conversationBuffer");
    if ($("settingsStorageFeedback")) {
      $("settingsStorageFeedback").textContent = "✓ Cleared conversation buffer";
      $("settingsStorageFeedback").style.display = "block";
      setTimeout(() => {
        if ($("settingsStorageFeedback")) $("settingsStorageFeedback").style.display = "none";
      }, 2500);
    }
  };
}

if ($("settingsClearStorageBtn")) {
  $("settingsClearStorageBtn").onclick = async () => {
    const { session } = await chrome.storage.local.get("session");
    await chrome.storage.local.clear();
    if (session) await chrome.storage.local.set({ session });
    conversationBuffer.length = 0;
    if ($("settingsStorageFeedback")) {
      $("settingsStorageFeedback").textContent = "✓ Local storage refreshed";
      $("settingsStorageFeedback").style.display = "block";
      setTimeout(() => {
        if ($("settingsStorageFeedback")) $("settingsStorageFeedback").style.display = "none";
      }, 2500);
    }
    render();
    loadSettingsTab();
  };
}

if ($("settingsOpenDashboardBtn")) {
  $("settingsOpenDashboardBtn").onclick = async () => {
    const { lastBase, session } = await chrome.storage.local.get(["lastBase", "session"]);
    const base = session?.apiBase || lastBase || DEFAULT_BASE;
    chrome.tabs.create({ url: `${base}/dashboard` });
  };
}

// Listen for tab switch, step progress, and session changes
chrome.runtime?.onMessage?.addListener?.((msg) => {
  if (!msg || typeof msg !== "object" || typeof msg.type !== "string") {
    spLog("warn", "onMessage:invalid_payload");
    return false;
  }
  spLog("debug", "onMessage:received", {
    type: msg.type,
    tabId: msg.tabId,
    planId: msg.planId,
    stepIndex: msg.stepIndex,
    stepStatus: msg.stepStatus,
  });
  if (msg.type === "TAB_CHANGED" || msg.type === "TAB_UPDATED") {
    if (msg.type === "TAB_CHANGED" || msg.active !== false) {
      BuddyStateManager.handleTabSwitch(msg.tabId);
    }
    return false;
  }
  if (msg.type === "PLAN_STEP_PROGRESS" && activePlan && msg.planId === activePlan.id) {
    const step = activePlan.steps?.[msg.stepIndex];
    if (step) {
      step.status = msg.stepStatus || step.status;
      if (msg.result) step.result = msg.result;
      if (msg.error) step.error = msg.error;
      renderTaskPlanUI();
    }
    return false;
  }
  if (msg.type === "SELF_HEAL_EVENT" && msg.session) {
    handleIncomingSelfHealSession(msg.session);
    return false;
  }
  return false;
});

// --- SELF-HEALING SIDEPANEL MONITOR & GRANULAR APPROVAL CONTROLLER ---
let activeSelfHealSession = null;

function renderSelfHealCard(session, previewText) {
  const card = $("selfHealCard");
  if (!card) return;
  if (!session) {
    card.hidden = true;
    return;
  }
  activeSelfHealSession = session;
  const badge = $("selfHealAttributionBadge");
  const summary = $("selfHealSummary");
  const preview = $("selfHealPreview");
  if (badge) {
    badge.textContent = `${session.report?.attribution || "triaged"} · ${session.status}`;
  }
  if (summary) {
    summary.textContent =
      session.diagnosis?.rootCause ||
      session.report?.errorMessage ||
      "Self-healing diagnostic ready.";
  }
  if (preview) {
    if (previewText) {
      preview.textContent = previewText;
      preview.hidden = false;
    } else {
      preview.hidden = true;
    }
  }
  card.hidden = false;
}

function handleIncomingSelfHealSession(session) {
  // Only prompt the user with the repair card for internal AI Buddy code issues needing escalation
  if (session?.localRecovery?.shouldCallAi && session?.report?.attribution === "ai_buddy_code") {
    renderSelfHealCard(session, session.localRecovery?.description || "");
  }
}

async function dispatchSelfHealAction(action, approvedAction) {
  if (!activeSelfHealSession?.repairId) return;
  const summary = $("selfHealSummary");
  if (summary) summary.textContent = `Running ${action}...`;
  const res = await sendRuntimeMessage({
    type: "SELF_HEAL_ACTION",
    payload: {
      action,
      repairId: activeSelfHealSession.repairId,
      approvedAction,
    },
  });
  if (res?.session) {
    activeSelfHealSession = res.session;
  }
  let previewText = res?.message || "";
  if (res?.excerpts?.length) {
    previewText = res.excerpts
      .map((ex) => `// ${ex.file}:${ex.startLine}-${ex.endLine}\n${ex.snippet}`)
      .join("\n\n");
  } else if (res?.diffPreviews?.length) {
    previewText = res.diffPreviews.map((d) => d.unifiedDiff).join("\n\n");
  } else if (res?.verificationResults?.length) {
    previewText =
      `${res.message}\n\n` +
      res.verificationResults
        .map((v) => `${v.passed ? "PASS" : "FAIL"} ${v.name}: ${v.summary}`)
        .join("\n");
  } else if (res?.preparedPatch) {
    previewText = `${res.message}\n\n${res.preparedPatch}`;
  } else if (res?.prUrl) {
    previewText = `${res.message}\nPR: ${res.prUrl}`;
  }
  renderSelfHealCard(activeSelfHealSession, previewText);
}

if ($("selfHealDiagnoseBtn")) {
  $("selfHealDiagnoseBtn").onclick = () => dispatchSelfHealAction("diagnose", "diagnose_only");
}
if ($("selfHealShowCodeBtn")) {
  $("selfHealShowCodeBtn").onclick = () =>
    dispatchSelfHealAction("show_code", "show_affected_code");
}
if ($("selfHealPrepareBtn")) {
  $("selfHealPrepareBtn").onclick = () =>
    dispatchSelfHealAction("prepare_repair", "prepare_repair");
}
if ($("selfHealApplyBtn")) {
  $("selfHealApplyBtn").onclick = () =>
    dispatchSelfHealAction("apply_repair_and_test", "apply_repair_and_test");
}
if ($("selfHealPrBtn")) {
  $("selfHealPrBtn").onclick = () =>
    dispatchSelfHealAction("create_github_pr", "create_github_pr");
}
if ($("selfHealCancelBtn")) {
  $("selfHealCancelBtn").onclick = async () => {
    if (activeSelfHealSession?.repairId) {
      await sendRuntimeMessage({
        type: "SELF_HEAL_ACTION",
        payload: { action: "cancel", repairId: activeSelfHealSession.repairId },
      });
    }
    renderSelfHealCard(null);
  };
}

if ($("settingsSelfHealStatusBtn")) {
  $("settingsSelfHealStatusBtn").onclick = async () => {
    const fb = $("settingsSelfHealFeedback");
    if (fb) {
      fb.textContent = "Checking Self-Healing telemetry & Knowledge Base...";
      fb.style.display = "block";
    }
    const res = await sendRuntimeMessage({ type: "SELF_HEAL_GET_STATUS" });
    if (fb) {
      if (res?.usage) {
        fb.textContent = `KB: ${res.kbCount || 0} repairs · Local recoveries: ${res.usage.localRecoveriesCount} · Suppressed dupes: ${res.usage.suppressedDuplicatesCount} · AI calls/hr: ${res.usage.aiCallsThisHour}`;
      } else {
        fb.textContent = res?.offline
          ? `Offline mode · ${(res.recentReports || []).length} local buffered report(s).`
          : "Self-Healing telemetry ready.";
      }
    }
    if (res?.sessions?.length) {
      const latest = res.sessions[0];
      if (latest && latest.status !== "cancelled") {
        renderSelfHealCard(
          {
            repairId: latest.repairId,
            status: latest.status,
            report: { attribution: latest.attribution, errorMessage: latest.errorMessage },
          },
          "",
        );
      }
    }
  };
}

window.addEventListener("error", (ev) => {
  sendRuntimeMessage(
    {
      type: "SELF_HEAL_REPORT",
      component: "side_panel",
      errorMessage: ev.error?.message || ev.message || "Sidepanel runtime error",
      errorType: ev.error?.name || "Error",
      stackTrace: ev.error?.stack,
      file: ev.filename,
      line: ev.lineno,
      column: ev.colno,
      currentOperation: "sidepanel_global_error",
    },
    { silent: true },
  );
});

window.addEventListener("unhandledrejection", (ev) => {
  const reason = ev.reason;
  sendRuntimeMessage(
    {
      type: "SELF_HEAL_REPORT",
      component: "unhandled_rejection",
      errorMessage:
        reason instanceof Error ? reason.message : String(reason || "Sidepanel unhandled rejection"),
      errorType: reason instanceof Error ? reason.name : "PromiseRejection",
      stackTrace: reason instanceof Error ? reason.stack : undefined,
      currentOperation: "sidepanel_unhandled_rejection",
    },
    { silent: true },
  );
});

// Guard against blank states on window focus and tab visibility transitions
window.addEventListener("focus", () => {
  BuddyStateManager.ensureNonBlankState();
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    BuddyStateManager.ensureNonBlankState();
  }
});

chrome.storage?.onChanged?.addListener?.((changes, area) => {
  if (area !== "local") return;
  if (changes.selectedBuddySlug?.newValue && changes.selectedBuddySlug.newValue !== selectedBuddySlug) {
    switchBuddy(changes.selectedBuddySlug.newValue, { persist: false, silent: true });
  }
  if (
    changes.session &&
    JSON.stringify(changes.session.oldValue) !== JSON.stringify(changes.session.newValue)
  ) {
    render();
  }
});

render();
