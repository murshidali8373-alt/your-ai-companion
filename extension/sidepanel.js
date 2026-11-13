const $ = (id) => document.getElementById(id);
const DEFAULT_BASE = "https://ais-dev-asfavkynho62d5znlmqa5n-711254288483.asia-southeast1.run.app";
const RESTRICTED =
  /^(chrome|edge|about|chrome-extension|devtools|view-source):|chromewebstore\.google\.com|chrome\.google\.com\/webstore/;

async function getResolvedBackendBase() {
  const { lastBase, session } = await chrome.storage.local.get(["lastBase", "session"]);
  let base = session?.apiBase || lastBase;
  if (base && (base.includes("5t53lwemhepi") || base.includes("152127168827"))) {
    base = DEFAULT_BASE;
    chrome.storage.local.set({ lastBase: DEFAULT_BASE }).catch(() => {});
  }
  if (!base) {
    try {
      const allTabs = await chrome.tabs.query({});
      for (const t of allTabs) {
        if (t?.url && !RESTRICTED.test(t.url)) {
          const u = new URL(t.url);
          if (
            u.protocol.startsWith("http") &&
            (u.hostname.includes("run.app") ||
              u.hostname === "localhost" ||
              u.hostname === "127.0.0.1" ||
              t.title?.includes("AI Buddy"))
          ) {
            if (!u.hostname.includes("5t53lwemhepi") && !u.hostname.includes("aistudio.google.com")) {
              base = u.origin;
              chrome.storage.local.set({ lastBase: base }).catch(() => {});
              break;
            }
          }
        }
      }
    } catch {}
    if (!base) base = DEFAULT_BASE;
  }
  return base;
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
let currentRenderMode = "rigged"; // "rigged" | "3d"
let selectedProvider = "gemini";
let cachedProviderStatuses = {};
const warnedMissingProviders = new Set();
const recommendedModesShown = new Set();

const DEFAULT_PROVIDER_META = {
  gemini: { id: "gemini", name: "Google Gemini", status: "connected", statusLabel: "Connected", missingKeyName: "GEMINI_API_KEY", supportsLocal: false },
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
let lastCallout = { title: null, description: null };
let pendingAction = null;
let recognition = null;
let isRecognizing = false;
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
  if (stage && stage.style.display === "none" && $("sizeSelect")?.value !== "hidden") {
    stage.style.display = "flex";
  }
  const active = getActiveBuddy();
  if ($("activeBuddyName") && !$("activeBuddyName").textContent) {
    switchBuddy(selectedBuddySlug || "friendly");
  }
  applyRenderMode(currentRenderMode || "rigged");
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
    ensureNonBlankState();
    checkPageForErrors();
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

function setRigEmotion(emotion, label) {
  currentEmotion = emotion;
  const badge = $("buddyEmotionBadge");
  if (badge) {
    badge.textContent = label || emotion.toUpperCase();
    badge.className = `status-badge ${emotion}`;
  }

  const browLeft = $("rigBrowLeft");
  const browRight = $("rigBrowRight");
  const armLeft = $("rigArmLeft");
  const armRight = $("rigArmRight");

  if (!browLeft || !browRight) return;

  switch (emotion) {
    case "happy":
    case "excited":
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
    case "pointing":
      // NATURAL MOVABLE CONNECTED ARM: arm articulates organically from shoulder joint (34, 60)
      browLeft.setAttribute("transform", "translate(40, 36) rotate(-5)");
      browRight.setAttribute("transform", "translate(61, 36) rotate(5)");
      setMouthShape("smile");
      if (armLeft) armLeft.setAttribute("transform", "rotate(52 34 62) scale(1.15 1)");
      if (armRight) armRight.removeAttribute("transform");
      break;
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
    case "speaking":
      browLeft.setAttribute("transform", "translate(40, 36) rotate(-4)");
      browRight.setAttribute("transform", "translate(61, 36) rotate(4)");
      if (armLeft) armLeft.removeAttribute("transform");
      if (armRight) armRight.removeAttribute("transform");
      break;
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
function switchBuddy(slugOrId) {
  const target = allBuddies.find((b) => b.slug === slugOrId || b.id === slugOrId);
  if (!target) return;

  selectedBuddySlug = target.slug;
  selectedCustomBuddyId = target.isCustom ? target.id || target.slug.replace("custom:", "") : null;

  chrome.storage.local.set({
    selectedBuddySlug,
    selectedCustomBuddyId,
  });

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

  // 5. Update Pre-rendered 3D Artwork
  const img3d = $("buddy3dImg");
  if (img3d) {
    img3d.src = target.image || "./assets/buddy-general-3d.webp";
    img3d.alt = target.name;
  }

  // 6. Natural giggle feedback on switch
  setRigEmotion("happy", target.name.split(" ")[0]);
  setTimeout(() => {
    if (currentEmotion === "happy") setRigEmotion("idle", "Ready");
  }, 900);
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
    img.src = buddy.image || "./assets/buddy-general-3d.webp";
    img.alt = buddy.name;
    img.loading = "lazy";
    img.onerror = () => {
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

// Setup Gaze tracking
window.addEventListener("mousemove", (e) => {
  const stage = $("characterStage");
  if (!stage) return;
  const rect = stage.getBoundingClientRect();
  const dx = ((e.clientX - (rect.left + rect.width / 2)) / (window.innerWidth / 2)) * 1.1;
  const dy = ((e.clientY - (rect.top + rect.height * 0.4)) / (window.innerHeight / 2)) * 0.8;
  const pupilLeft = $("rigPupilLeft");
  const pupilRight = $("rigPupilRight");
  if (pupilLeft && pupilRight) {
    const clampX = Math.max(-1.1, Math.min(1.1, dx));
    const clampY = Math.max(-0.8, Math.min(0.8, dy));
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

// Tap Buddy to trigger giggle
$("characterStage").addEventListener("click", () => {
  if (busy || isRecognizing) return;
  setRigEmotion("happy", "Giggle");
  setMouthShape("laugh");
  setTimeout(() => {
    setRigEmotion("idle", "Idle");
  }, 900);
});

// Speech recognition setup
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.lang = "en-IN";

  recognition.onstart = () => {
    isRecognizing = true;
    $("voiceBtn").classList.add("active");
    $("voiceBtn").textContent = "🛑 Listening…";
    setRigEmotion("listening", "Listening");
    $("statusText").textContent = "Listening to your voice…";
  };

  recognition.onresult = (event) => {
    const transcript = event.results[0]?.[0]?.transcript || "";
    if (transcript.trim()) {
      $("promptInput").value = transcript;
      sendQuery(transcript, "answer");
    }
  };

  recognition.onerror = () => stopVoice();
  recognition.onend = () => stopVoice();
}

function stopVoice() {
  isRecognizing = false;
  $("voiceBtn").classList.remove("active");
  $("voiceBtn").textContent = "🎤 Talk";
  if (!busy) setRigEmotion("idle", "Idle");
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

function appendProviderWarningNotice(warning) {
  if (!warning || !warning.requestedProvider || warnedMissingProviders.has(warning.requestedProvider)) {
    return;
  }
  warnedMissingProviders.add(warning.requestedProvider);
  const box = $("historyBox");
  if (!box) return;
  const notice = document.createElement("div");
  notice.className = "msg-bubble msg-buddy";
  notice.style.cssText =
    "font-size: 10px; border-color: rgba(245, 158, 11, 0.35); background: rgba(245, 158, 11, 0.08); color: #fde68a;";
  notice.textContent = `ℹ️ ${warning.message}`;
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

function speakResponse(text, finishEmotion = "idle") {
  if (isMuted || !window.speechSynthesis) {
    setRigEmotion(finishEmotion, finishEmotion.toUpperCase());
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = /[\u0900-\u097F]/.test(text) ? "hi-IN" : "en-IN";

  utterance.onstart = () => {
    setRigEmotion("speaking", "Speaking");
    startSpeechMouthCycle();
  };
  utterance.onend = () => {
    stopSpeechMouthCycle();
    setRigEmotion(finishEmotion, finishEmotion.toUpperCase());
  };
  utterance.onerror = () => {
    stopSpeechMouthCycle();
    setRigEmotion(finishEmotion, finishEmotion.toUpperCase());
  };

  window.speechSynthesis.speak(utterance);
}

/**
 * Pointing action:
 * Articulates the connected arm from Buddy's shoulder,
 * and commands the active page to extend the connected arm toward the element.
 */
function pointArmAtElement() {
  setRigEmotion("pointing", "Pointing");
  const active = getActiveBuddy();

  if (lastHighlightSelector) {
    chrome.runtime.sendMessage({
      type: "HIGHLIGHT",
      selector: lastHighlightSelector,
      title: lastCallout.title,
      description: lastCallout.description,
      buddyVisual: {
        outfit: active.outfit,
        buddyName: active.name,
      },
    });
  }

  setTimeout(() => {
    if (currentEmotion === "pointing") setRigEmotion("idle", "Idle");
  }, 4000);
}

async function render() {
  const {
    session,
    selectedBuddySlug: savedSlug,
    selectedCustomBuddyId: savedCustomId,
    avatarRenderMode: savedMode,
    selectedProvider: savedProvider,
  } = await chrome.storage.local.get([
    "session",
    "selectedBuddySlug",
    "selectedCustomBuddyId",
    "avatarRenderMode",
    "selectedProvider",
  ]);

  if (savedSlug) selectedBuddySlug = savedSlug;
  if (savedCustomId) selectedCustomBuddyId = savedCustomId;
  if (savedMode) currentRenderMode = savedMode;
  if (savedProvider) selectedProvider = savedProvider;
  if ($("providerSelector")) $("providerSelector").value = selectedProvider;
  updateProviderNoticeUI(selectedProvider);

  const isAuth = Boolean(session);
  $("signoutBtn").hidden = !isAuth;
  $("connectBtn").hidden = isAuth;

  if (session) {
    $("userAccount").textContent = `Connected: ${session.email || "User"}`;
    if (session.apiBase) {
      chrome.storage.local.set({ lastBase: session.apiBase });
    }
  } else {
    $("userAccount").textContent = "Guest Mode (All 16 Buddies active)";
  }

  // Sync latest custom buddies from backend if available
  const apiBase = await getResolvedBackendBase();
  fetch(`${apiBase}/api/public/extension/buddies`, {
    headers: session?.accessToken ? { authorization: `Bearer ${session.accessToken}` } : {},
  })
    .then((r) => r.json())
    .then((data) => {
      if (data?.ok && Array.isArray(data.buddies) && data.buddies.length > 0) {
        // Merge without breaking registry
        const customItems = data.buddies.filter((b) => b.isCustom);
        if (customItems.length > 0) {
          allBuddies = [
            ...BUDDIES_REGISTRY.filter((b) => !b.isCustom),
            ...customItems.map((c) => ({
              ...c,
              outfitColors: ["#0d9488", "#0f766e"],
            })),
          ];
          renderBuddyCarousel();
        }
      }
    })
    .catch(() => {});

  renderBuddyCarousel();
  switchBuddy(selectedBuddySlug);
  applyRenderMode(currentRenderMode);
  checkPageForErrors();
  updateGreetingContext();
  startRotatingPlaceholders();
  loadModelHubStatus();
  chrome.storage.local
    .get("preferredModel")
    .then(({ preferredModel }) => {
      if ($("headerModelLabel") && preferredModel && preferredModel !== "auto") {
        $("headerModelLabel").textContent = preferredModel;
      }
    })
    .catch(() => {});
}

function applyRenderMode(mode) {
  currentRenderMode = mode;
  const svg = $("characterSvg");
  const img = $("buddy3dImg");
  if (!svg || !img) return;

  if (mode === "3d") {
    svg.style.display = "none";
    img.hidden = false;
  } else {
    svg.style.display = "block";
    img.hidden = true;
  }
}

async function checkPageForErrors() {
  try {
    const res = await chrome.runtime.sendMessage({ type: "GET_PAGE_SNAPSHOT" });
    const snapshot = res?.snapshot;
    if (!snapshot) return;

    const alerts = snapshot.alerts || [];
    const invalidForms = (snapshot.forms || []).filter((f) => f.invalid);

    const banner = $("pageErrorBanner");
    const text = $("pageErrorText");
    if (!banner || !text) return;

    if (alerts.length > 0 || invalidForms.length > 0) {
      const parts = [];
      if (alerts.length > 0) {
        parts.push(`${alerts.length} alert(s): "${alerts[0].name.slice(0, 60)}"`);
      }
      if (invalidForms.length > 0) {
        parts.push(`${invalidForms.length} invalid form field(s) require attention.`);
      }
      text.textContent = parts.join(" — ");
      banner.hidden = false;
      setRigEmotion("confused", "Issues Found");
    } else {
      banner.hidden = true;
    }
  } catch {
    // Non-fatal
  }
}

async function executeScroll(direction = "down", amount = 450, targetText = null, announceInChat = false) {
  const active = getActiveBuddy();
  const isHindi = active.defaultLanguage !== "english";
  setRigEmotion("working", "Scrolling");
  $("statusText").textContent = targetText
    ? `Scrolling to "${targetText}"…`
    : `Scrolling page ${direction}…`;

  const res = await chrome.runtime.sendMessage({
    type: "EXECUTE_ACTION",
    action: "scroll",
    value: direction,
    options: { direction, amount, targetText },
  });

  if (res?.ok) {
    $("statusText").textContent = res.message || `Scrolled ${direction}.`;
    if (res.hasMoreBelow !== undefined && $("pageCompletenessBanner")) {
      $("pageCompletenessBanner").hidden = !res.hasMoreBelow;
    }
    if (announceInChat) {
      const msg = isHindi
        ? targetText
          ? `📜 "${targetText}" tak scroll kar diya hai.`
          : `📜 Page ${direction} scroll kar diya hai.${res.movedPx ? ` (${res.movedPx}px)` : ""}`
        : res.message || `Scrolled ${direction}.`;
      appendHistory("buddy", msg);
      speakResponse(msg, "happy");
    }
  } else if (announceInChat) {
    const failMsg =
      res?.message ||
      (isHindi ? `Page ko "${targetText || direction}" scroll nahi kiya ja saka.` : `Could not scroll ${direction}.`);
    $("statusText").textContent = failMsg;
    appendHistory("buddy", `⚠️ ${failMsg}`);
  }
  setTimeout(() => setRigEmotion("idle", "Idle"), 1000);
}

async function executeFind(query, mode = "find") {
  setRigEmotion("thinking", mode === "point" ? "Pointing" : "Finding");
  $("statusText").textContent =
    mode === "point" ? `Pointing to "${query}"…` : `Searching page for "${query}"…`;
  const active = getActiveBuddy();
  const res = await chrome.runtime.sendMessage({
    type: "FIND_CONTENT",
    query,
    options: {
      scroll: true,
      highlight: true,
      title: mode === "point" ? `Pointing: ${query}` : `Match: ${query}`,
      buddyVisual: {
        outfit: active.outfit,
        outfitColor: active.outfitColors?.[0] || "#0d9488",
        buddyName: active.name,
      },
    },
  });
  if (res?.ok && res.totalMatches > 0) {
    setRigEmotion("pointing", mode === "point" ? "Pointing!" : "Found!");
    lastHighlightSelector = res.firstSelector;
    lastCallout = {
      title: mode === "point" ? `Pointing: ${query}` : `Match: ${query}`,
      description: res.targetMatch?.textSnippet || `Located "${query}" (no click performed).`,
    };
    if ($("highlightBtn")) $("highlightBtn").hidden = false;
    pointArmAtElement();
    const isHindi = active.defaultLanguage !== "english";
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
    const isHindi = active.defaultLanguage !== "english";
    const msg = isHindi
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
  const typeLabel =
    activeUploadedDocument.documentType === "aadhaar"
      ? "Aadhaar Card"
      : activeUploadedDocument.documentType === "pan"
        ? "PAN Card"
        : activeUploadedDocument.documentType === "invoice"
          ? "Invoice"
          : activeUploadedDocument.documentType === "shipping_label"
            ? "Shipping Label"
            : "Document";
  lbl.textContent = `📄 ${typeLabel} (${activeUploadedDocument.fileName}) · ${fieldsCount} field${fieldsCount === 1 ? "" : "s"} ready`;
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
    .replace(/^(?:(?:hey|hi|hello|ok|okay|dear|please|kripya|bhai|yaar)\s+)?(?:ai\s+)?buddy\b[,:\s-]*/i, "")
    .replace(/^(?:please|kripya|plz|pls)\s+/i, "")
    .replace(/\s+(?:please|kripya|plz|pls)[.!?\s]*$/i, "")
    .trim();
}

function normalizeFillTarget(raw) {
  return String(raw || "")
    .trim()
    .replace(/^(?:is\s+page\s+(?:par|pe|mein|me)|page\s+(?:par|pe|mein|me)|is\s+form\s+(?:mein|me)|form\s+(?:mein|me)|ye|yeh|is|the|a|an|my|apna|mera)\s+/i, "")
    .replace(/\s+(?:field|input|box|textbox|textarea|area|dropdown|select|ki|ka|ke|par|pe|ko)$/i, "")
    .trim()
    .toLowerCase();
}

function extractFillDetails(text) {
  const cleaned = stripBuddyPrefix(text)
    .replace(/^(?:is\s+form\s+(?:mein|me|main)|form\s+(?:mein|me|main)|is\s+page\s+(?:mein|me|par|pe))\s+/i, "")
    .trim();
  const overwrite = /\b(?:change|update|replace|overwrite|badal|badlo|modify)\b/i.test(cleaned);
  const fields = {};
  const explicitPairs = [];

  const hasFillVerbOrAssign =
    /\b(?:fill|type|likh|likho|daal|daalo|bhar|bharo|enter|set|populate|change|update|replace)\b|[:=]/i.test(
      cleaned,
    );
  if (
    !hasFillVerbOrAssign &&
    /\b(?:point|highlight|click|press|tap|dabao|scroll|find|locate|dhoondho|dhundo|kaha|kahan|kidhar|where)\b/i.test(
      cleaned,
    )
  ) {
    return { fields: null, explicitPairs: null, overwrite, explicitUserProvided: false };
  }

  // 1. Explicit key: value or key = value
  const keyValRegex =
    /\b(name|naam|fullname|legal_name|trade_name|email|phone|mobile|mobilenumber|city|state|country|pincode|pin|zip|gstin|pan|address|pata|search|describe|description|prompt|message|comment|company|subject|title|username|password)\s*[:=]\s*([^,;\n]+)/gi;
  let m;
  while ((m = keyValRegex.exec(cleaned)) !== null) {
    const key = m[1].toLowerCase();
    const val = m[2].replace(/\s+(?:fill|type|likho|likh\s+do|daalo|daal\s+do|bharo|bhar\s+do|karo|kar\s+do).*$/i, "").trim();
    if (val) {
      fields[key] = val;
      explicitPairs.push({ target: key, value: val, overwrite });
    }
  }
  if (explicitPairs.length > 0) {
    return { fields, explicitPairs, overwrite, explicitUserProvided: true };
  }

  // Split multi-field instructions cleanly (e.g. "Pehle naam Murshad fill karo, phir mobile 9876543210 fill karo")
  const clauses = cleaned
    .split(/\s*(?:,|;|\bphir\b|\bfir\b|\bthen\b|\band then\b|\buske baad\b)\s*/i)
    .map((c) => c.replace(/^(?:pehle|first|aur|and|also|next)\s+/i, "").trim())
    .filter(Boolean);

  const KNOWN_FIELD_ALIASES =
    "(?:full\\s*name|legal\\s*name|trade\\s*name|first\\s*name|last\\s*name|user\\s*name|mobile\\s*(?:number|no)?|phone\\s*(?:number|no)?|pin\\s*code|zip\\s*code|email\\s*(?:id|address)?|naam|name|mail|email|phone|mobile|address|pata|city|state|country|pincode|pin|zip|gstin|gst|pan|search|describe|description|prompt|message|comment|comments|company|subject|title|username|password)";

  for (const clause of clauses) {
    // Pattern A: "<field> (box|field|input)? mein/me/main/in/into <value> (fill|type|likh|daal|bhar|enter|set|kar)?"
    let match = clause.match(
      /^(.+?)\s+(?:mein|me|main|per|par|in|into)\s+["']?(.+?)["']?\s*(?:fill\s+kar\s*do|fill\s+karo|fill\s+karein|fill|type\s+kar\s*do|type\s+karo|type|likh\s+do|likho|daal\s+do|daalo|bhar\s+do|bharo|enter\s+karo|enter|set\s+karo|kar\s+do|karo)?[.!?\s]*$/i,
    );
    if (match) {
      const rawTarget = match[1].trim();
      const rawVal = match[2].trim();
      if (/^(?:is|ye|yeh|isko|is\s*box|this|this\s*box|this\s*field|yahan)$/i.test(rawTarget)) {
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

    // Pattern B: "(fill|type|enter|write|likho|daalo|set) <value> in/into/mein <field>"
    match = clause.match(
      /^(?:fill|type|enter|write|put|set|likho|likh\s+do|daalo|daal\s+do|bharo)\s+["']?(.+?)["']?\s+(?:in|into|inside|mein|me|main|par)\s+(?:the\s+)?(.+?)[.!?\s]*$/i,
    );
    if (match) {
      const rawVal = match[1].trim();
      const rawTarget = match[2].trim();
      if (/^(?:this|this\s*box|this\s*field|it|here|isko|yahan)$/i.test(rawTarget)) {
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

    // Pattern C: "isko/this <value> se fill/bhar kar do" or "fill this with <value>"
    match = clause.match(
      /^(?:fill|type|populate)\s+(?:this(?:\s+box|\s+field)?|it)\s+(?:with|as)\s+["']?(.+?)["']?[.!?\s]*$/i,
    ) ||
      clause.match(
        /^(?:isko|is\s+box\s+ko|is\s+field\s+ko)\s+["']?(.+?)["']?\s+(?:se\s+)?(?:fill|bhar|type|likh|daal)\s*(?:kar\s*do|karo|do)?[.!?\s]*$/i,
      );
    if (match && match[1]) {
      explicitPairs.push({ target: "__CURRENT__", value: match[1].trim(), overwrite });
      continue;
    }

    // Pattern D: "<knownField> (as|is|change karke|update karke|ko)? <value> (fill|type|likh|daal|bhar|kar do)?"
    const knownFieldValRe = new RegExp(
      `\\b(${KNOWN_FIELD_ALIASES})\\s+(?:change\\s+karke\\s+|update\\s+karke\\s+|as\\s+|is\\s+|to\\s+|ko\\s+|ka\\s+|:)?["']?(.+?)["']?(?:\\s+(?:fill\\s+kar\\s*do|fill\\s+karo|fill|type\\s+karo|type|likh\\s+do|likho|daal\\s+do|daalo|bhar\\s+do|bharo|kar\\s*do|karo))?[.!?\\s]*$`,
      "i",
    );
    match = clause.match(knownFieldValRe);
    if (match && match[1] && match[2]) {
      const rawT = match[1].toLowerCase().replace(/\s+/g, "");
      const keyMap = {
        naam: "name",
        fullname: "name",
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
      };
      const mappedKey = keyMap[rawT] || rawT;
      const cleanVal = match[2]
        .replace(/\s+(?:fill\s+kar\s*do|fill\s+karo|fill|type\s+karo|type|likh\s+do|likho|daal\s+do|daalo|bhar\s+do|bharo|kar\s*do|karo)$/i, "")
        .trim();
      if (
        cleanVal &&
        !/^(?:karo|kar\s*do|fill|bharo|bhar\s*do|daalo|daal\s*do|field|input|box)$/i.test(cleanVal)
      ) {
        fields[mappedKey] = cleanVal;
        explicitPairs.push({ target: mappedKey, value: cleanVal, overwrite });
        continue;
      }
    }
  }

  // Fallback Pattern E: natural comma-separated attributes ("name Rahul, email rahul@gmail.com, city Delhi")
  if (explicitPairs.length === 0) {
    const patterns = [
      { key: "name", regex: /\b(?:name|naam)\s+(?:as\s+|is\s+|:\s*)?([A-Za-z\s]+?)(?:,|\s+email|\s+city|\s+pin|\s+phone|\s+mobile|\s+bhar|\s+fill|$)/i },
      { key: "email", regex: /\b(?:email|mail)\s+(?:as\s+|is\s+|:\s*)?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i },
      { key: "phone", regex: /\b(?:phone|mobile(?:\s+number)?)\s+(?:as\s+|is\s+|:\s*)?(\+?\d{10,13})/i },
      { key: "city", regex: /\bcity\s+(?:as\s+|is\s+|:\s*)?([A-Za-z\s]+?)(?:,|\s+state|\s+pin|\s+fill|$)/i },
      { key: "state", regex: /\bstate\s+(?:as\s+|is\s+|:\s*)?([A-Za-z\s]+?)(?:,|\s+pin|\s+city|\s+fill|$)/i },
      { key: "pincode", regex: /\b(?:pin|pincode|zip)\s+(?:as\s+|is\s+|:\s*)?(\d{5,6})/i },
      { key: "gstin", regex: /\b(?:gstin|gst)\s+(?:as\s+|is\s+|:\s*)?([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1})/i },
    ];
    for (const p of patterns) {
      const match = cleaned.match(p.regex);
      if (match && match[1]) {
        const val = match[1].trim();
        fields[p.key] = val;
        explicitPairs.push({ target: p.key, value: val, overwrite });
      }
    }
  }

  return {
    fields: Object.keys(fields).length > 0 ? fields : null,
    explicitPairs: explicitPairs.length > 0 ? explicitPairs : null,
    overwrite,
    explicitUserProvided: explicitPairs.length > 0,
  };
}

function extractFieldsFromMessage(text) {
  return extractFillDetails(text).fields;
}

function parseActionIntent(text) {
  const trimmed = (text || "").trim();
  const stripped = stripBuddyPrefix(trimmed);
  const lower = stripped.toLowerCase();

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

  // 3. SCROLL (up, down, left, right, top, bottom, or scroll-to-element)
  const scrollToTargetMatch =
    lower.match(/^(.+?)\s+(?:tak|par|pe)\s+scroll\s*(?:karo|kar\s*do|karein)?[.!?\s]*$/i) ||
    lower.match(/^scroll\s+(?:to|until)\s+(?:the\s+)?(.+?)(?:\s+is\s+visible)?[.!?\s]*$/i);
  if (
    scrollToTargetMatch &&
    !/^(?:top|bottom|up|down|left|right|last|end|neeche|upar)$/i.test(scrollToTargetMatch[1].trim())
  ) {
    const cleanScrollTarget = scrollToTargetMatch[1]
      .replace(/^(?:is\s+page\s+(?:ke|par)|page\s+(?:ke|par)|the)\s+/i, "")
      .trim();
    if (cleanScrollTarget) {
      return { type: "SCROLL", direction: "to_element", target: cleanScrollTarget };
    }
  }

  if (
    /^(?:(?:thoda|thoda\s+aur|aur|please|ab)?\s*)?(?:scroll\s+(?:down|up|left|right|to\s+top|top|to\s+bottom|bottom)|(?:neeche|niche|upar|left|right|baayein|daayein)\s+scroll(?:\s+karo|\s+kar\s*do|\s+karein)?|(?:page\s+ko\s+)?(?:neeche|niche|upar)\s+(?:jao|le\s+jao|karo|kardo)|neeche\s+jao|upar\s+jao|page\s+down|page\s+up|(?:page\s+ke\s+)?(?:last|bottom|end|aakhir)\s+(?:mein|me|par)\s+(?:jao|le\s+jao)|(?:page\s+ke\s+)?(?:top|shuru)\s+(?:mein|me|par)\s+(?:jao|le\s+jao))[.!?\s]*$/i.test(
      lower,
    )
  ) {
    let dir = "down";
    if (/\b(?:up|upar)\b/i.test(lower)) dir = "up";
    else if (/\b(?:left|baayein|baaye)\b/i.test(lower)) dir = "left";
    else if (/\b(?:right|daayein|daaye)\b/i.test(lower)) dir = "right";
    else if (/\b(?:top|shuru)\b/i.test(lower)) dir = "top";
    else if (/\b(?:bottom|last|end|aakhir)\b/i.test(lower)) dir = "bottom";
    return { type: "SCROLL", direction: dir };
  }

  // 3b. FORM INSPECT ("Yahan kya fill karna hai?", "What information does this form require?")
  if (
    /(?:yahan|yaha|is\s+page\s+(?:par|pe)|is\s+form\s+(?:mein|me|main)|form\s+(?:mein|me|main)|here)\s+kya\s+(?:fill|bharna|bhar|daalna|enter|likhna|details|info|information)\s*(?:karna\s+(?:h|hai|he)|h|hai|he|chahiye)?/i.test(
      lower,
    ) ||
    /(?:what\s+(?:information|info|details|fields)\s+(?:does\s+this\s+form\s+require|do\s+i\s+need\s+to\s+fill|should\s+i\s+fill|are\s+required)|which\s+fields\s+(?:are\s+required|to\s+fill)|is\s+form\s+ke\s+liye\s+kya\s+(?:chahiye|details\s+chahiye))/i.test(
      lower,
    )
  ) {
    return { type: "FORM_INSPECT" };
  }

  // 4. EXTRACT / SEARCH DATA (check early for "search karke ... nikaalo")
  if (
    /(?:search|dhoondh|dhundh)\s+karke.*(?:nikaalo|nikalo|lao|batao|copy)/i.test(lower) ||
    /^(?:extract|copy|nikaalo|nikalo)\s+(?:the\s+)?(?:order(?:\s*id)?s?|table|data|details|info|information)/i.test(
      lower,
    ) ||
    /(?:order(?:\s*id)?s?|table|data|details|information)\s+(?:nikaalo|nikalo|copy\s+karo|extract\s+karo)/i.test(
      lower,
    )
  ) {
    let target = stripped
      .replace(/^(?:search\s+karke|extract|copy|dhoondh\s+ke|dhundh\s+ke)\s+/i, "")
      .replace(/\s+(?:nikaalo|nikalo|lao|batao|copy\s+karo|extract\s+karo)$/i, "")
      .trim();
    return { type: "EXTRACT", target: target || "data" };
  }

  // 5. DOCUMENT-BACKED OR EXPLICIT FILL DETAILS CHECK
  const isDocBackedFill =
    /(?:aadhaar|aadhar|pan\s+card|pan\s+details|uploaded\s+(?:id|document|doc|file|pdf|image)|document\s+(?:se|details|info)|id\s+(?:se|details))/i.test(
      lower,
    ) && /\b(?:fill|type|likh|likho|daal|daalo|bhar|bharo|enter|kar\s*do|karo)\b/i.test(lower);

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
  const isFormTrigger =
    /(?:form\s+(?:fill|bhar|bharo)|fill\s+(?:the\s+|this\s+|is\s+page\s+ka\s+)?form|is\s+page\s+ka\s+form\s+(?:fill|bhar)|auto\s*fill|fill\s+(?:all\s+)?(?:inputs|fields)|form\s+bhar\s+do|is\s+form\s+ko\s+bharo|\bisko\s+fill\s+kar\s*(?:do|o)?|\bis\s+(?:box|field|input)\s+ko\s+fill\s+kar\s*(?:do|o)?|fill\s+this\s*(?:box|field|input)?)/i.test(
      lower,
    );
  const hasSingleFillVerb =
    /\b(?:fill|type|likh|likho|daal|daalo|bhar|bharo|enter)\b/i.test(lower) &&
    !/\b(?:click|press|dabao|scroll|point|highlight|find|open|kholo)\b/i.test(lower);

  if (fillDetails.explicitPairs && hasSingleFillVerb) {
    return {
      type: "FORM_FILL",
      fields: fillDetails.fields,
      explicitPairs: fillDetails.explicitPairs,
      overwrite: fillDetails.overwrite,
      explicitUserProvided: fillDetails.explicitUserProvided,
    };
  }

  // 6. MULTI-STEP TASK
  // Matches chained commands like:
  // - "Meesho dashboard open karo, pending orders find karo, first order open karo aur uska order ID batao"
  // - "Buddy, profile tab open karo, edit button click karo, meri uploaded ID se naam aur address fill karo."
  // - "Pehle naam fill karo, phir mobile number"
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
    // Special case: "Pehle naam fill karo, phir mobile number" (multi-field fill without navigation/clicks)
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
        };
      }
      // Extract requested field names with no values provided (so Buddy checks uploaded doc or asks cleanly instead of inventing!)
      const segs = lower
        .split(/\s*(?:,|;|\bphir\b|\bfir\b|\bthen\b|\band then\b|\buske baad\b)\s*/i)
        .map((s) =>
          s
            .replace(/^(?:pehle|first|aur|and|next)\s+/i, "")
            .replace(/\s+(?:fill\s+kar\s*do|fill\s+karo|fill|type\s+karo|bharo|bhar\s+do|likho|daalo)[.!?\s]*$/i, "")
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
  if (isFormTrigger || fillDetails.explicitPairs) {
    return {
      type: "FORM_FILL",
      fields: fillDetails.fields,
      explicitPairs: fillDetails.explicitPairs,
      overwrite: fillDetails.overwrite,
      explicitUserProvided: fillDetails.explicitUserProvided,
      useUploadedDocument: Boolean(activeUploadedDocument && !fillDetails.explicitPairs),
    };
  }

  // 8. SELECT / DROPDOWN COMMAND
  const selectMatch =
    lower.match(/^(?:select|choose|chuno)\s+["']?(.+?)["']?\s+(?:in|from|mein|me)\s+(?:the\s+)?(.+?)(?:\s+dropdown|\s+select)?[.!?\s]*$/i) ||
    lower.match(/^(.+?)\s+(?:dropdown\s+)?(?:mein|me|main)\s+["']?(.+?)["']?\s+(?:select|choose|chuno)\s*(?:karo|kar\s*do)?[.!?\s]*$/i);
  if (selectMatch) {
    const isFirstPattern = /^(?:select|choose|chuno)\b/i.test(lower);
    const val = (isFirstPattern ? selectMatch[1] : selectMatch[2]).trim();
    const targetField = normalizeFillTarget(isFirstPattern ? selectMatch[2] : selectMatch[1]);
    if (val) {
      return { type: "SELECT", targetField, value: val };
    }
  }
  const simpleSelectMatch = lower.match(/^(.+?)\s+(?:select\s+karo|choose\s+karo|chuno)[.!?\s]*$/i);
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

  // 9. CHECKBOX / RADIO COMMAND
  const uncheckMatch =
    lower.match(/^(.+?)\s+(?:checkbox\s+)?(?:uncheck|untick)\s*(?:karo|kar\s*do)?[.!?\s]*$/i) ||
    lower.match(/^(?:uncheck|untick)\s+(?:the\s+)?(.+?)(?:\s+checkbox)?[.!?\s]*$/i);
  if (uncheckMatch) {
    return { type: "CHECK", target: normalizeFillTarget(uncheckMatch[1]), checked: false };
  }
  const checkMatch =
    lower.match(/^(.+?)\s+(?:checkbox\s+)?(?:check|tick)\s*(?:karo|kar\s*do)?[.!?\s]*$/i) ||
    lower.match(/^(?:check|tick)\s+(?:the\s+)?(.+?)(?:\s+checkbox)?[.!?\s]*$/i);
  if (checkMatch) {
    return { type: "CHECK", target: normalizeFillTarget(checkMatch[1]), checked: true };
  }

  // 10. POINT / HIGHLIGHT ACTION (STRICT: NEVER CLICKS)
  const pointTrailingMatch = lower.match(
    /(.+?)\s+(?:par\s+point\s+karo|pe\s+point\s+karo|ko\s+point\s+karo|par\s+point|pe\s+point|point\s+karo|point\s+kar\s*do|point\s+kijiye|highlight\s+karo|highlight\s+kar\s*do)[.!?\s]*$/i,
  );
  const pointLeadingMatch = lower.match(
    /^(?:point\s+(?:to|at|on)|highlight)\s+(?:the\s+)?(.+?)[.!?\s]*$/i,
  );
  if (pointTrailingMatch || pointLeadingMatch) {
    const raw = pointTrailingMatch ? pointTrailingMatch[1] : pointLeadingMatch[1];
    const clean = raw
      .replace(/^(?:is\s+page\s+(?:par|pe|se)|page\s+(?:par|pe|se)|ye|yeh|wo|woh|is|this|the|a|an|kripya|please)\s+/i, "")
      .replace(/\s+(?:button|tab|link|icon|menu|bar|option|field|input|box)$/i, "")
      .trim();
    if (clean.length > 0) {
      return { type: "POINT", target: clean };
    }
  }

  // 11. CLICK / PRESS / TAP ACTION
  const clickTrailingMatch = lower.match(
    /(.+?)\s+(?:par\s+click\s+karo|pe\s+click\s+karo|ko\s+click\s+karo|par\s+click|pe\s+click|click\s+karo|click\s+kar\s*do|click\s+kijiye|click\s+do|dabao|daba\s+do|press\s+karo|press\s+kar\s*do|press\s+kijiye|tap\s+karo|khol\s+do|kholo|open\s+karo|select\s+karo)[.!?\s]*$/i,
  );
  const clickLeadingMatch = lower.match(
    /^(?:click|press|tap|dabao|open|kholo)\s+(?:on\s+)?(?:the\s+)?(.+)[.!?\s]*$/i,
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
    if (/^(?:yahan|yaha|here|isko|this|is\s+par|is\s+pe|us\s+par)$/i.test(raw.trim())) {
      return { type: "CLICK", target: "__CURRENT__", isConsequential: false };
    }
    let clean = raw
      .replace(/^(?:is\s+page\s+(?:par|pe|se)|page\s+(?:par|pe|se)|ye|yeh|wo|woh|the|a|an|kripya|please|jaldi)\s+/i, "")
      .replace(/\s+(?:button|tab|link|icon|menu|bar|option|radio|checkbox)$/i, "")
      .trim();

    if (clean.length > 0) {
      const isConsequential = /purchase|buy|pay|delete|remove account|confirm payment/i.test(
        clean,
      );
      return { type: "CLICK", target: clean, isConsequential };
    }
  }

  // 12. FIND / LOCATE ACTION (STRICT: NEVER CLICKS)
  const findTrailingMatch = lower.match(
    /(.+?)\s+(?:find\s+karo|locate\s+karo|search\s+karo|dhoondho|dhundo|dhoondh\s+ke\s+dikhao|kaha(?:n)?\s+(?:hai|h|he)|kidhar\s+(?:hai|h|he)|kdr\s+(?:hai|h|he)|khaa\s+(?:hai|h|he)|kha\s+(?:hai|h|he|karna\s+h)|dikhao|batao)[.!?\s]*$/i,
  );
  const findLeadingMatch = lower.match(
    /^(?:find|locate|search(?:\s+for)?|where\s+is|where's|wheres|where\s+are|show\s+me|dhoondho|dhundo)\s+(?:the\s+)?(.+)[.!?\s]*$/i,
  );

  if (
    (findTrailingMatch || findLeadingMatch) &&
    !lower.includes("form") &&
    !lower.includes("explain") &&
    !lower.includes("how to")
  ) {
    let raw = findTrailingMatch ? findTrailingMatch[1] : findLeadingMatch[1];
    let clean = raw
      .replace(/^(?:is\s+page\s+(?:par|pe|se)|page\s+(?:par|pe|se)|ye|yeh|wo|woh|the|a|an|kripya|please)\s+/i, "")
      .replace(/\s+(?:button|tab|link|icon|menu|bar|option|field|box)$/i, "")
      .trim();

    if (clean.length > 0) {
      return { type: "FIND", target: clean };
    }
  }

  // 13. EXPLAIN PAGE
  if (
    /^(?:explain\s+(?:this\s+)?page|page\s+explain\s+karo|summarize\s+page|what\s+is\s+this\s+page)[.!?\s]*$/i.test(
      lower,
    )
  ) {
    return { type: "EXPLAIN" };
  }

  // 14. Default: GENERAL ASK / QUESTION
  return { type: "ASK" };
}

async function executeNaturalBrowserAction(intent, trimmed) {
  const active = getActiveBuddy();
  const isHindi = active.defaultLanguage !== "english";

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
      ? `Main aapka ${active.name} hoon! Aap mujhe seedhe chat mein koi bhi action bol sakte hain:\n• Point: "address field par point karo"\n• Click: "submit button click karo"\n• Fill: "is form mein naam Murshad Ali fill kar do"\n• Scroll: "neeche scroll karo" ya "page ke last mein jao"\n• Multi-step: "Meesho dashboard open karo, pending orders find karo..."`
      : `I am ${active.name}, your browser action companion! Just tell me what to do:\n• Point: "Point to address field" (highlights without clicking)\n• Click: "Click submit button"\n• Fill: "Fill name Murshad Ali in this form"\n• Scroll: "Scroll down" / "Scroll to footer"\n• Multi-step: Chain steps in one message`;
    appendHistory("buddy", helpMsg);
    $("statusText").textContent = `Capabilities of ${active.name}.`;
    speakResponse(helpMsg, "happy");
    return true;
  }

  if (intent.type === "SCROLL") {
    appendHistory("user", trimmed);
    $("promptInput").value = "";
    await executeScroll(intent.direction, 450, intent.target || null, true);
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
    const res = await chrome.runtime.sendMessage({
      type: "EXECUTE_ACTION",
      action: "select",
      value: intent.value,
      options: { targetField: intent.targetField || "", text: intent.value },
    });
    if (res?.ok) {
      setRigEmotion("happy", "Selected!");
      const msg = isHindi
        ? `✅ Dropdown mein "${intent.value}" select kar diya hai.`
        : `✅ ${res.message}`;
      $("statusText").textContent = msg;
      appendHistory("buddy", msg);
      speakResponse(msg, "happy");
    } else {
      setRigEmotion("idle", "Notice");
      const failMsg = res?.message || `Could not select "${intent.value}" on this page.`;
      $("statusText").textContent = failMsg;
      appendHistory("buddy", `⚠️ ${failMsg}`);
    }
    return true;
  }

  if (intent.type === "CHECK") {
    appendHistory("user", trimmed);
    $("promptInput").value = "";
    setRigEmotion("working", intent.checked ? "Checking…" : "Unchecking…");
    const res = await chrome.runtime.sendMessage({
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
      $("statusText").textContent = msg;
      appendHistory("buddy", msg);
      speakResponse(msg, "happy");
    } else {
      setRigEmotion("idle", "Notice");
      const failMsg = res?.message || `Could not find checkbox "${intent.target}".`;
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

    const snapRes = await chrome.runtime.sendMessage({ type: "GET_PAGE_SNAPSHOT" });
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

    // Consequential actions approval gate (payment, purchase, deletion, government form submission)
    let needsConfirm = Boolean(intent.isConsequential);
    try {
      const [activeT] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      const activeUrl = (activeT?.url || "").toLowerCase();
      const isGovSite = /\.gov(?:\.in)?|uidai|incometax|gst\.gov|parivahan|passportindia/i.test(activeUrl);
      if (isGovSite && /submit|final|apply|file\s+return|confirm|proceed/i.test(intent.target)) {
        needsConfirm = true;
      }
    } catch {}

    if (needsConfirm) {
      pendingAction = {
        type: "click",
        value: intent.target,
        text: intent.target,
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

    setRigEmotion("working", "Clicking…");
    $("statusText").textContent =
      intent.target === "__CURRENT__"
        ? "Clicking highlighted element…"
        : `Clicking "${intent.target}" on active page…`;

    const res = await chrome.runtime.sendMessage({
      type: "EXECUTE_ACTION",
      action: "click",
      selector: intent.target === "__CURRENT__" ? lastHighlightSelector || undefined : undefined,
      value: intent.target,
      options: { fallbackSelector: lastHighlightSelector || undefined },
    });

    if (res?.ok) {
      setRigEmotion("happy", "Clicked!");
      const clickedName = res.text || intent.target;
      let outcome = isHindi
        ? `Maine page par "${clickedName}" click kar diya hai!`
        : `Successfully clicked "${clickedName}"!`;
      if (res.stateChange === "navigated") {
        outcome += isHindi ? ` Page naye URL par navigate ho gaya.` : ` Page navigated.`;
      } else if (res.stateChange === "modal_opened") {
        outcome += isHindi ? ` Dialog/popup open ho gaya.` : ` Modal dialog opened.`;
      } else if (res.stateChange === "toggled" || res.stateChange === "selected") {
        outcome += ` (${res.stateChange})`;
      }
      $("statusText").textContent = outcome;
      appendHistory("buddy", `✅ ${outcome}`);
      speakResponse(outcome, "happy");
    } else {
      setRigEmotion("idle", "Not found");
      const failMsg =
        res?.message ||
        (isHindi
          ? `Active page par "${intent.target}" button nahi mila. Kripya check karein ya page scroll karein.`
          : `Could not find button "${intent.target}" on this page.`);
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
      const { userProfile } = await chrome.storage.local.get("userProfile").catch(() => ({}));
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
      // Check saved userProfile (excluding sensitive fields) before asking user
      const { userProfile } = await chrome.storage.local.get("userProfile").catch(() => ({}));
      const profilePairs = userProfile
        ? Object.entries(userProfile)
            .filter(([, v]) => typeof v === "string" && v.trim())
            .map(([k, v]) => ({ target: k, value: v, overwrite: false }))
        : [];
      if (profilePairs.length > 0) {
        await startSmartFormFill(null, {
          explicitPairs: profilePairs,
          overwrite: Boolean(intent.overwrite),
          explicitUserProvided: true,
        });
        return true;
      }

      // Inspect form first & ask cleanly without inventing missing personal info!
      setRigEmotion("curious", "Need Details");
      const snapRes = await chrome.runtime.sendMessage({ type: "GET_PAGE_SNAPSHOT" });
      const fieldNames = (snapRes?.snapshot?.forms || [])
        .map((f) => f.name || f.placeholder || f.role)
        .filter(Boolean)
        .slice(0, 8);
      const askDetailsMsg = isHindi
        ? `📋 Is page par yeh fields hain${fieldNames.length ? ` (${fieldNames.join(", ")})` : ""}. Main bina aapki jankari ke fake details nahi bharunga! Kripya 📎 Attach se apna Aadhaar/PAN/document upload karein ya chat mein details likhein (jaise: "naam ..., phone ..., city ...").`
        : `📋 Detected form fields${fieldNames.length ? ` (${fieldNames.join(", ")})` : ""}. I never invent personal details—please attach an ID/document with 📎 Attach or type the values you want filled.`;
      $("statusText").textContent = "Awaiting document or field details.";
      appendHistory("buddy", askDetailsMsg);
      speakResponse(askDetailsMsg, "curious");
      return true;
    }

    await startSmartFormFill(intent.fields, {
      explicitPairs: intent.explicitPairs,
      overwrite: Boolean(intent.overwrite),
      explicitUserProvided: Boolean(intent.explicitUserProvided),
    });
    return true;
  }

  if (intent.type === "EXTRACT") {
    appendHistory("user", trimmed);
    $("promptInput").value = "";
    setRigEmotion("working", "Extracting…");
    $("statusText").textContent = `Extracting ${intent.target} from page…`;

    const res = await chrome.runtime.sendMessage({
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

async function sendQuery(question, intent) {
  if (busy || !question || !question.trim()) return;

  // Always dismiss any existing confirmation cards on new user input
  if ($("confirmCard")) $("confirmCard").hidden = true;
  pendingAction = null;

  const trimmed = question.trim();

  // 1. Unified Natural Language Browser Action Intent Parser & Dispatcher
  const parsed = parseActionIntent(trimmed);
  const handled = await executeNaturalBrowserAction(parsed, trimmed);
  if (handled) return;

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
    const activeProv = selectedProvider || storedProvider || "gemini";
    const detachPage = $("pageContextToggle") && !$("pageContextToggle").checked;
    const finalIntent = detachPage ? "general" : intent || "answer";
    const uploadedDocumentSummary = activeUploadedDocument
      ? {
          fileName: activeUploadedDocument.fileName,
          documentType: activeUploadedDocument.documentType || "other",
          availableFields: Object.keys(activeUploadedDocument.fields || {}),
        }
      : undefined;
    const res = await chrome.runtime.sendMessage({
      type: "ASK",
      question: trimmed,
      intent: finalIntent,
      history: historyPayload,
      uploadedDocumentSummary,
      buddySlug: active.slug,
      customBuddyId: active.isCustom ? active.id || active.slug.replace("custom:", "") : undefined,
      preferredProvider: activeProv,
      preferredModel: preferredModel && preferredModel !== "auto" ? preferredModel : undefined,
    });

    hideChatLoadingSpinner();

    if (res?.error) {
      setRigEmotion("error", "Notice");
      const errMsg =
        res.pageReadable === false
          ? "I cannot read the current webpage right now. Please refresh or allow page access."
          : res.message || "I encountered an issue with the page. Please ensure your tab is open and refreshed.";
      $("statusText").textContent = errMsg;
      appendHistory("buddy", errMsg);
      return;
    }

    currentAnswer = res.reply?.answer || "I am grounded on this page and ready to assist you.";
    appendHistory("buddy", currentAnswer);
    recordConversationTurn(trimmed, currentAnswer);

    if (res.providerWarning) {
      appendProviderWarningNotice(res.providerWarning);
    }

    const modeRec =
      res.recommendedMode || getLocalModeRecommendation(trimmed, active.slug, active.defaultLanguage);
    if (modeRec) {
      appendModeRecommendationNotice(modeRec);
    }

    // If AI planned an action, actually execute it instead of only explaining!
    if (res.actionType === "click" && (res.targetSelector || res.targetText)) {
      setRigEmotion("working", "Acting");
      const clickRes = await chrome.runtime.sendMessage({
        type: "EXECUTE_ACTION",
        action: "click",
        selector: res.targetSelector,
        value: res.targetText,
      });
      if (clickRes?.ok) {
        setRigEmotion("happy", "Clicked!");
        const clickedMsg = isHindi
          ? `Maine page par "${clickRes.text || res.targetText}" click kar diya hai!`
          : `Clicked "${clickRes.text || res.targetText}"!`;
        $("statusText").textContent = clickedMsg;
        appendHistory("buddy", `✅ ${clickedMsg}`);
      }
    } else if (res.actionType === "form_fill") {
      await startSmartFormFill();
    } else if (res.actionType === "scroll") {
      await executeScroll(res.scrollDirection || "down", 450, res.scrollTarget || null, true);
    }

    lastHighlightSelector = res.highlightSelector || null;
    lastCallout = { title: res.calloutTitle || null, description: res.calloutDescription || null };

    if (lastHighlightSelector) {
      $("highlightBtn").hidden = false;
      pointArmAtElement();
    }
    $("speakAnswerBtn").hidden = false;

    // Check page completeness from snapshot or metadata
    if (res.snapshot?.pageCompleteness?.hasMoreBelow && $("pageCompletenessBanner")) {
      $("pageCompletenessBanner").hidden = false;
    }

    if ($("confirmCard")) $("confirmCard").hidden = true;
    pendingAction = null;

    const emotion = lastHighlightSelector ? "pointing" : res.reply?.emotion || "idle";
    setRigEmotion(emotion, emotion.toUpperCase());
    speakResponse(currentAnswer, emotion);

    $("statusText").textContent = res.pageReadable
      ? `Grounded on active page (${active.name}).`
      : "Answered using specialist knowledge.";
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
  }
}

// --- SMART FORM FILLING WORKFLOW ---
async function startSmartFormFill(sampleData = null, extraOpts = {}) {
  const active = getActiveBuddy();
  const isHindi = active.defaultLanguage !== "english";
  if ($("formFillCard")) $("formFillCard").hidden = false;
  $("statusText").textContent = "Inspecting & filling form fields on active page…";

  const hasExplicit = Boolean(extraOpts?.explicitPairs?.length) || Boolean(sampleData);

  const dataToFill = sampleData || (extraOpts?.explicitPairs ? null : {
    name: "Murshid Ali",
    legal_name: "Ali Enterprises Pvt Ltd",
    trade_name: "Ali Retail & Co",
    gstin: "27AABCU9603R1ZM",
    email: "contact@alienterprises.com",
    phone: "9876543210",
    address: "Shop 12, Commercial Market, Central Plaza",
    city: "Mumbai",
    state: "Maharashtra",
    pincode: "400001",
  });

  // Save explicitly provided non-sensitive user preferences to local userProfile for future sequential convenience
  if (extraOpts?.explicitUserProvided && extraOpts?.explicitPairs) {
    try {
      const { userProfile = {} } = await chrome.storage.local.get("userProfile");
      const SENSITIVE_KEY = /pass|otp|\bpin\b|cvv|cvc|secret|token|card/i;
      let changed = false;
      for (const p of extraOpts.explicitPairs) {
        if (p.target && p.target !== "__CURRENT__" && !SENSITIVE_KEY.test(p.target) && p.value) {
          userProfile[p.target] = p.value;
          changed = true;
        }
      }
      if (changed) await chrome.storage.local.set({ userProfile });
    } catch {}
  }

  const res = await chrome.runtime.sendMessage({
    type: "SMART_FILL_FORM",
    fields: dataToFill,
    options: {
      overwrite: Boolean(extraOpts?.overwrite),
      explicitPairs: extraOpts?.explicitPairs || undefined,
      explicitUserProvided: Boolean(extraOpts?.explicitUserProvided),
      fromUploadedDocument: Boolean(extraOpts?.fromUploadedDocument),
      fallbackSelector: lastHighlightSelector || undefined,
    },
  });

  const reportEl = $("formFillReport");
  if (reportEl) reportEl.hidden = false;

  if (res?.ok && res.results) {
    const { filled, preserved, skipped, errors } = res.results;
    const lines = [];

    if (filled.length > 0) {
      lines.push(
        `✅ Filled & verified (${filled.length}): ${filled.map((f) => `${f.field} = "${f.value}"`).join(", ")}`,
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
      setRigEmotion("happy", "Filled");
      $("statusText").textContent =
        `Filled ${filled.length} field${filled.length > 1 ? "s" : ""} & verified.`;
      const summaryMsg = isHindi
        ? `📝 Maine ${filled.map((f) => `"${f.field}" mein "${f.value}"`).join(", ")} fill aur verify kar diya hai!${
            preserved.length > 0
              ? ` (${preserved.length} pehle se bhare fields ko safe rakha gaya hai)`
              : ""
          }`
        : `📝 Filled & verified ${filled.length} field(s): ${filled.map((f) => `${f.field}="${f.value}"`).join(", ")}.${
            preserved.length > 0 ? ` Preserved ${preserved.length} existing field(s).` : ""
          }`;
      appendHistory("buddy", summaryMsg);
      speakResponse(summaryMsg, "happy");
    } else if (preserved.length > 0) {
      setRigEmotion("idle", "Preserved");
      const presMsg = isHindi
        ? `🔒 Field "${preserved.map((p) => p.field).join(", ")}" mein pehle se data bhara hua hai. Agar aap badalna chahte hain to "change karke <nayi value> kar do" bolein.`
        : `🔒 Existing data in "${preserved.map((p) => p.field).join(", ")}" was preserved. Say "change <field> to <value>" if you want to overwrite it.`;
      $("statusText").textContent = "Existing field values preserved.";
      appendHistory("buddy", presMsg);
    } else {
      setRigEmotion("confused", "Not found");
      const notFoundMsg = isHindi
        ? `⚠️ Is page par matching editable input field nahi mila. Kripya pehle field par point karein ya page scroll karein.`
        : `⚠️ Could not find matching editable input field on this page.`;
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
      setRigEmotion("thinking", "Confirm");
    }
  } else {
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
      status: "pending",
    });
    steps.push({
      id: `${planId}_2`,
      stepNumber: 2,
      title: "Navigate to Orders",
      action: "click",
      textTarget: "Orders",
      status: "pending",
    });
    steps.push({
      id: `${planId}_3`,
      stepNumber: 3,
      title: "Filter today's orders",
      action: "click",
      textTarget: "Today",
      status: "pending",
    });
    steps.push({
      id: `${planId}_4`,
      stepNumber: 4,
      title: "Find pending orders",
      action: "click",
      textTarget: "Pending",
      status: "pending",
    });
    steps.push({
      id: `${planId}_5`,
      stepNumber: 5,
      title: "Copy pending order IDs",
      action: "extract",
      value: "order_id",
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

  // Render steps list
  const listEl = $("planStepsList");
  listEl.innerHTML = "";
  activePlan.steps.forEach((st, idx) => {
    const row = document.createElement("div");
    row.className = `plan-step-row ${st.status}`;
    row.innerHTML = `
      <div class="step-info">
        <span class="step-num">${idx + 1}.</span>
        <span class="step-text" title="${st.title}">${st.title}</span>
      </div>
      <span class="step-status-tag ${st.status}">${st.status}</span>
    `;
    listEl.appendChild(row);
  });

  // Pause button label
  $("planPauseResumeBtn").textContent = isPlanPaused ? "▶️ Resume" : "⏸️ Pause";
}

async function startMultiActionPlan(instruction) {
  const plan = buildMultiActionPlan(instruction);
  activePlan = plan;
  isPlanPaused = false;
  pendingApprovalStep = null;
  if ($("consequentialApprovalCard")) $("consequentialApprovalCard").hidden = true;
  if ($("extractedDataCard")) $("extractedDataCard").hidden = true;

  appendHistory("user", instruction);
  appendHistory(
    "buddy",
    `🎯 Created ${plan.steps.length}-step execution plan for: "${plan.title}"`,
  );
  setRigEmotion("working", "Planning");
  renderTaskPlanUI();

  // Execute steps sequentially
  await runPlanLoop();
}

async function runPlanLoop() {
  if (!activePlan) return;

  // Persist plan state to chrome.storage.local to survive service worker / sidepanel cycles
  const persistPlanState = async () => {
    try {
      await chrome.storage.local.set({ ai_buddy_active_plan: activePlan });
    } catch {
      // Non-fatal
    }
  };

  while (activePlan.currentStepIndex < activePlan.steps.length) {
    if (isPlanPaused) {
      activePlan.status = "paused";
      await persistPlanState();
      renderTaskPlanUI();
      return;
    }

    const currentStep = activePlan.steps[activePlan.currentStepIndex];

    // Consequential Approval Gate
    if (currentStep.requiresApproval && currentStep.status !== "awaiting_approval") {
      currentStep.status = "awaiting_approval";
      activePlan.status = "awaiting_approval";
      pendingApprovalStep = currentStep;
      await persistPlanState();
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
    activePlan.status = "running";
    renderTaskPlanUI();
    setRigEmotion("working", `Step ${currentStep.stepNumber}`);

    // --- OAV STAGE 1 & 4: OBSERVE FRESH LIVE DOM & RE-GROUND TARGET ---
    try {
      const snapRes = await chrome.runtime.sendMessage({ type: "GET_PAGE_SNAPSHOT" });
      if (snapRes?.ok && snapRes.snapshot) {
        const freshSnap = snapRes.snapshot;
        const allElements = [
          ...(freshSnap.controls || []),
          ...(freshSnap.forms || []),
          ...(freshSnap.headings || []),
          ...(freshSnap.alerts || []),
        ];

        // If step lacks direct selector or if previous step navigated/mutated DOM
        const targetQ = (
          currentStep.dynamicTargetQuery ||
          currentStep.textTarget ||
          currentStep.title ||
          ""
        )
          .toLowerCase()
          .trim();

        if (targetQ && (!currentStep.selector || currentStep.selector === "body")) {
          const cleanQ = targetQ
            .replace(/^(click|open|press|select|go to|fill|type|search|find|copy)\s+/i, "")
            .replace(/\s+(button|link|tab|input|field|box)$/i, "")
            .trim();

          const matched = allElements.find((el) => {
            const name = (el.name || "").toLowerCase();
            const ph = (el.placeholder || "").toLowerCase();
            return name === cleanQ || name.includes(cleanQ) || ph.includes(cleanQ);
          });

          if (matched) {
            currentStep.selector = matched.selector;
            currentStep.resolvedSelector = matched.selector;
          }
        }
      }
    } catch {
      // Non-fatal: continue with pre-configured step target
    }

    // --- OAV STAGE 5: DISPATCH STEP ACTION ---
    const res = await chrome.runtime.sendMessage({
      type: "EXECUTE_STEP",
      step: currentStep,
      options: {
        extractedDataStore: activePlan.extractedData,
        uploadedDocumentFields: activeUploadedDocument?.fields || {},
      },
    });

    // --- OAV STAGE 6: TRIPLE-SIGNAL PAGE SETTLE DETECTOR ---
    try {
      await chrome.runtime.sendMessage({
        type: "WAIT_FOR_PAGE_SETTLE",
        timeoutMs: 4000,
      });
    } catch {
      // Non-fatal
    }

    if (res?.ok) {
      currentStep.status = "completed";
      currentStep.verified = true;
      currentStep.result = res.result;

      if (res.extractedData) {
        currentStep.extractedData = res.extractedData;
        if (Array.isArray(res.extractedData)) {
          activePlan.extractedData.push(...res.extractedData);
        } else {
          activePlan.extractedData.push(res.extractedData);
        }
        renderExtractedDataUI();
      }

      activePlan.currentStepIndex++;
      await persistPlanState();
      renderTaskPlanUI();
      await new Promise((r) => setTimeout(r, 400));
    } else {
      currentStep.status = "failed";
      currentStep.error = res?.error || "Action execution failed";
      activePlan.status = "failed";
      await persistPlanState();
      renderTaskPlanUI();
      setRigEmotion("error", "Failed");
      appendHistory("buddy", `⚠️ Step ${currentStep.stepNumber} failed: ${currentStep.error}`);
      if ($("planRetryBtn")) $("planRetryBtn").hidden = false;
      return;
    }
  }

  // All steps completed
  activePlan.status = "completed";
  await persistPlanState();
  renderTaskPlanUI();
  setRigEmotion("celebrate", "Done");
  const extractedCount = activePlan.extractedData.length;
  appendHistory(
    "buddy",
    `✅ Multi-action workflow completed! Executed and verified all ${activePlan.steps.length} steps.${extractedCount > 0 ? ` Extracted ${extractedCount} items.` : ""}`,
  );
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
          activePlan.status = "running";
          renderTaskPlanUI();
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

// File / Document Attachment & OCR Understanding (Aadhaar, PAN, Invoices, PDFs, Images, CSV)
async function handleUploadedDocumentFile(file) {
  if (!file) return;
  const active = getActiveBuddy();
  const isHindi = active.defaultLanguage !== "english";
  const isImage = file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(file.name);
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  const isTextLike = /\.(txt|csv|json)$/i.test(file.name);

  if (!isImage && !isPdf && !isTextLike) {
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

    if (isTextLike) {
      textContent = await file.text();
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

    const extractRes = await chrome.runtime.sendMessage({
      type: "EXTRACT_DOCUMENT",
      document: {
        fileName: file.name,
        mimeType: file.type || (isPdf ? "application/pdf" : "image/png"),
        base64Data,
        textContent,
      },
    });

    if (extractRes?.ok && Object.keys(extractRes.fields || {}).length > 0) {
      setActiveUploadedDocument(extractRes);
      const maskedKeys = Object.entries(extractRes.fields).map(
        ([k, v]) => `${k}: ${maskSensitiveDocValue(k, v)}`,
      );
      setRigEmotion("happy", "Doc Ready");
      $("statusText").textContent = `Document "${file.name}" read (${maskedKeys.length} fields).`;
      const msg = isHindi
        ? `📄 Document (${extractRes.documentType?.toUpperCase() || "ID"}) read kar liya gaya hai! Extracted fields: ${Object.keys(extractRes.fields).join(", ")}.\nAb aap bol sakte hain: "Buddy, is page ka form fill kar do."`
        : `📄 Read "${file.name}" (${extractRes.documentType || "document"}). Extracted fields: ${Object.keys(extractRes.fields).join(", ")}.\nSay "Buddy, fill this form" whenever you're ready!`;
      appendHistory("buddy", msg);
      speakResponse(msg, "happy");
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
  $("pageContextToggle").onchange = (e) => {
    if ($("pageContextStatus")) {
      $("pageContextStatus").textContent = e.target.checked ? "Page Vision On" : "Detached";
      $("pageContextStatus").style.color = e.target.checked ? "var(--teal)" : "var(--muted)";
    }
  };
}

// Contextual Greeting & Domain Tracker
function updateGreetingContext() {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  if ($("greetingTime")) $("greetingTime").textContent = greeting;
  try {
    if (typeof chrome !== "undefined" && chrome.tabs && chrome.tabs.query) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs?.[0];
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
      });
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
  $("planPauseResumeBtn").onclick = () => {
    if (!activePlan) return;
    isPlanPaused = !isPlanPaused;
    if (!isPlanPaused && activePlan.status === "paused") {
      activePlan.status = "running";
      renderTaskPlanUI();
      runPlanLoop();
    } else {
      renderTaskPlanUI();
    }
  };
}

if ($("planSkipBtn")) {
  $("planSkipBtn").onclick = () => {
    if (!activePlan || activePlan.currentStepIndex >= activePlan.steps.length) return;
    const st = activePlan.steps[activePlan.currentStepIndex];
    st.status = "skipped";
    activePlan.currentStepIndex++;
    if ($("consequentialApprovalCard")) $("consequentialApprovalCard").hidden = true;
    renderTaskPlanUI();
    runPlanLoop();
  };
}

if ($("planStopBtn")) {
  $("planStopBtn").onclick = () => {
    if (!activePlan) return;
    activePlan.status = "cancelled";
    isPlanPaused = false;
    if ($("consequentialApprovalCard")) $("consequentialApprovalCard").hidden = true;
    renderTaskPlanUI();
    setRigEmotion("idle", "Stopped");
    appendHistory("buddy", "⏹️ Multi-action execution plan stopped by user.");
  };
}

if ($("planRetryBtn")) {
  $("planRetryBtn").onclick = () => {
    if (!activePlan) return;
    const st = activePlan.steps[activePlan.currentStepIndex];
    if (st) st.status = "pending";
    activePlan.status = "running";
    if ($("planRetryBtn")) $("planRetryBtn").hidden = true;
    renderTaskPlanUI();
    runPlanLoop();
  };
}

if ($("approveConsequentialBtn")) {
  $("approveConsequentialBtn").onclick = async () => {
    if (!pendingApprovalStep || !activePlan) return;
    if ($("consequentialApprovalCard")) $("consequentialApprovalCard").hidden = true;
    pendingApprovalStep.requiresApproval = false;
    pendingApprovalStep.status = "pending";
    pendingApprovalStep = null;
    activePlan.status = "running";
    renderTaskPlanUI();
    await runPlanLoop();
  };
}

if ($("rejectConsequentialBtn")) {
  $("rejectConsequentialBtn").onclick = () => {
    if (!pendingApprovalStep || !activePlan) return;
    if ($("consequentialApprovalCard")) $("consequentialApprovalCard").hidden = true;
    pendingApprovalStep.status = "skipped";
    pendingApprovalStep = null;
    activePlan.currentStepIndex++;
    activePlan.status = "running";
    renderTaskPlanUI();
    runPlanLoop();
  };
}

if ($("copyExtractedBtn")) {
  $("copyExtractedBtn").onclick = () => {
    const text = $("extractedContent")?.textContent || "";
    if (text && navigator.clipboard) {
      navigator.clipboard.writeText(text);
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
  $("autoFillSampleBtn").onclick = () =>
    startSmartFormFill({
      name: "Murshid Ali",
      legal_name: "Ali Enterprises Pvt Ltd",
      trade_name: "Ali Retail & Co",
      gstin: "27AABCU9603R1ZM",
      email: "contact@alienterprises.com",
      phone: "9876543210",
      address: "Shop 12, Commercial Market, Central Plaza",
      city: "Mumbai",
      state: "Maharashtra",
      pincode: "400001",
    });
}
if ($("verifyFormInputsBtn")) {
  $("verifyFormInputsBtn").onclick = () =>
    sendQuery("Find and verify all form fields on this page.", "locate_element");
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
    if (!recognition) {
      alert("Speech recognition is not supported in this browser window.");
      return;
    }
    if (isRecognizing) {
      recognition.stop();
    } else {
      try {
        recognition.start();
      } catch {
        stopVoice();
      }
    }
  };
}

if ($("fixErrorsBtn")) {
  $("fixErrorsBtn").onclick = () => {
    sendQuery(
      "Analyze the errors, alerts, and invalid form fields on this page. Explain why they occurred and give me step-by-step instructions to fix them.",
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
      const res = await chrome.runtime.sendMessage({
        type: "EXECUTE_ACTION",
        action: actionToRun.type,
        selector: actionToRun.selector,
        value: actionToRun.value,
      });

      if (res?.ok) {
        setRigEmotion("happy", "Done");
        $("statusText").textContent = res.message || "Action finished successfully.";
        appendHistory("buddy", `✅ Done: ${res.message || "Action completed."}`);
      } else {
        setRigEmotion("error", "Notice");
        $("statusText").textContent = res?.message || "Action failed or was blocked.";
        appendHistory("buddy", `⚠️ ${res?.message || "Action could not be completed on this page."}`);
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

    // 1. Check if user already has an active AI Buddy tab open in their browser
    try {
      const allTabs = await chrome.tabs.query({});
      const buddyTab = allTabs.find((t) => {
        if (!t.url) return false;
        try {
          const u = new URL(t.url);
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

    // 2. Activate immediate Guest Session locally so user is connected with zero obstacles
    await chrome.storage.local.set({
      lastBase: resolvedBase,
      session: {
        email: "Guest User",
        isGuest: true,
        apiBase: resolvedBase,
      },
    });

    // Prepare fallback connect URL
    const connectUrl = new URL(`${resolvedBase}/connect`);
    if (session?.accessToken) {
      connectUrl.searchParams.set("ext_session", "active");
      if (session.email) connectUrl.searchParams.set("email", session.email);
    }
    connectUrl.searchParams.set("src", "extension_sidepanel");

    setRigEmotion("celebrate", "Connected!");
    $("statusText").textContent = "✓ Connected in Guest Mode! All 16 Specialist Buddies ready.";
    await render();

    // 3. Switch smoothly to Settings tab for optional API key / custom server settings
    switchTab("settings");
  };
}

if ($("signoutBtn")) {
  $("signoutBtn").onclick = async () => {
    conversationBuffer.length = 0;
    clearActiveUploadedDocument();
    if ($("historyBox")) $("historyBox").innerHTML = "";
    await chrome.runtime.sendMessage({ type: "SIGN_OUT" });
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
  if (!summaryBox) return;
  summaryBox.textContent = "Scanning active tab…";
  try {
    const snap = await chrome.runtime.sendMessage({ type: "GET_SNAPSHOT" });
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
    $("promptInput").value = "Explain what this page is about simply and summarize key points.";
    askQuestion("explain_page");
  };
}

if ($("pageCheckErrorsActionBtn")) {
  $("pageCheckErrorsActionBtn").onclick = () => {
    switchTab("chat");
    $("promptInput").value = "Are there any validation errors or missing required fields?";
    askQuestion("classify");
  };
}

if ($("pageExtractTableActionBtn")) {
  $("pageExtractTableActionBtn").onclick = () => {
    switchTab("chat");
    startMultiStepWorkflow(
      "Find tables on this page, extract all rows and columns, copy list to clipboard",
    );
  };
}

if ($("pageScrollDownBtn")) {
  $("pageScrollDownBtn").onclick = async () => {
    await chrome.runtime.sendMessage({
      type: "EXECUTE_ACTION",
      action: "scroll_down",
      selector: "window",
    });
    setRigEmotion("working", "Scrolling");
    setTimeout(() => setRigEmotion("idle", "Idle"), 800);
  };
}

if ($("pageScrollUpBtn")) {
  $("pageScrollUpBtn").onclick = async () => {
    await chrome.runtime.sendMessage({
      type: "EXECUTE_ACTION",
      action: "scroll_up",
      selector: "window",
    });
    setRigEmotion("working", "Scrolling");
    setTimeout(() => setRigEmotion("idle", "Idle"), 800);
  };
}

// Preset Workflows
if ($("runMeeshoWorkflowBtn")) {
  $("runMeeshoWorkflowBtn").onclick = () => {
    switchTab("chat");
    startMultiStepWorkflow(
      "Open Meesho Supplier Panel, go to Orders, open today's orders, find pending orders, copy their order IDs, and prepare a list of them",
    );
  };
}

if ($("runReconcileWorkflowBtn")) {
  $("runReconcileWorkflowBtn").onclick = () => {
    switchTab("chat");
    startMultiStepWorkflow(
      "Open seller orders portal, collect today's order numbers and pricing, compare against spreadsheet, identify missing orders, calculate differences, and prepare a non-destructive audit report",
    );
  };
}

if ($("runResearchWorkflowBtn")) {
  $("runResearchWorkflowBtn").onclick = () => {
    switchTab("chat");
    startMultiStepWorkflow(
      "Conduct multi-source research across web sources, categorize verified consensus versus conflicting evidence, and generate structured cited report",
    );
  };
}

if ($("runExtractTableWorkflowBtn")) {
  $("runExtractTableWorkflowBtn").onclick = () => {
    switchTab("chat");
    startMultiStepWorkflow(
      "Find tables on this page, extract all rows and columns, copy list to clipboard",
    );
  };
}

if ($("resumeSavedTaskBtn")) {
  $("resumeSavedTaskBtn").onclick = async () => {
    const { savedCheckpoint } = await chrome.storage.local.get("savedCheckpoint");
    if (savedCheckpoint) {
      const card = $("savedCheckpointCard") || $("savedTaskCheckpointCard");
      if (card) card.hidden = true;
      switchTab("chat");
      appendHistory(
        "buddy",
        `▶️ Resuming task: "${savedCheckpoint.title}". Continuing from step ${savedCheckpoint.currentStepIndex + 1} of ${savedCheckpoint.totalSteps}.`,
      );
      setRigEmotion("working", "Resuming");
    }
  };
}

if ($("discardSavedTaskBtn")) {
  $("discardSavedTaskBtn").onclick = async () => {
    await chrome.storage.local.remove("savedCheckpoint");
    const card = $("savedCheckpointCard") || $("savedTaskCheckpointCard");
    if (card) card.hidden = true;
  };
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
    if (session?.access_token) headers["Authorization"] = `Bearer ${session.access_token}`;
    const res = await fetch(`${base}/api/public/extension/memories`, { headers });
    const data = await res.json();
    if (data?.ok && data.memories && data.memories.length > 0) {
      list.innerHTML = data.memories
        .map(
          (m) => `
        <div class="item-row">
          <div>
            <div style="font-weight: 600; color: var(--text);">${escapeHtml(m.key)}</div>
            <div style="font-size: 10px; color: var(--muted);">${escapeHtml(m.value)}</div>
          </div>
          <button class="ghost delete-mem-btn" data-key="${escapeHtml(m.key)}" style="padding: 2px 5px; font-size: 10px; color: var(--destructive);">🗑️</button>
        </div>
      `,
        )
        .join("");

      list.querySelectorAll(".delete-mem-btn").forEach((btn) => {
        btn.onclick = async () => {
          const key = btn.getAttribute("data-key");
          await deleteMemory(key);
        };
      });
    } else {
      list.innerHTML =
        '<div style="color: var(--muted); font-size: 10px;">No custom memories saved yet. Click Add to save preferences.</div>';
    }
  } catch {
    list.innerHTML =
      '<div style="color: var(--muted); font-size: 10px;">Could not load memories.</div>';
  }
}

async function deleteMemory(key) {
  try {
    const { session } = await chrome.storage.local.get("session");
    const base = await getResolvedBackendBase();
    const headers = {};
    if (session?.access_token) headers["Authorization"] = `Bearer ${session.access_token}`;
    await fetch(`${base}/api/public/extension/memories?key=${encodeURIComponent(key)}`, {
      method: "DELETE",
      headers,
    });
    loadMemories();
  } catch (err) {
    console.error("deleteMemory error", err);
  }
}

if ($("addMemoryToggleBtn")) {
  $("addMemoryToggleBtn").onclick = () => {
    $("addMemoryForm").hidden = !$("addMemoryForm").hidden;
  };
}

if ($("cancelMemoryBtn")) {
  $("cancelMemoryBtn").onclick = () => {
    $("addMemoryForm").hidden = true;
    $("memKeyInput").value = "";
    $("memValInput").value = "";
  };
}

if ($("saveMemoryBtn")) {
  $("saveMemoryBtn").onclick = async () => {
    const key = $("memKeyInput").value.trim();
    const value = $("memValInput").value.trim();
    if (!key || !value) return;

    try {
      const { session } = await chrome.storage.local.get("session");
      const base = await getResolvedBackendBase();
      const headers = { "Content-Type": "application/json" };
      if (session?.access_token) headers["Authorization"] = `Bearer ${session.access_token}`;
      const res = await fetch(`${base}/api/public/extension/memories`, {
        method: "POST",
        headers,
        body: JSON.stringify({ key, value, kind: "preference" }),
      });
      const data = await res.json();
      if (data?.ok) {
        $("addMemoryForm").hidden = true;
        $("memKeyInput").value = "";
        $("memValInput").value = "";
        loadMemories();
      } else {
        alert(data?.message || data?.error || "Failed to save memory");
      }
    } catch {
      alert("Error saving memory");
    }
  };
}

// Tasks History Handlers
async function loadTasksHistory() {
  const list = $("tasksHistoryList");
  if (!list) return;
  list.innerHTML = '<div style="color: var(--muted); font-size: 10px;">Loading task history…</div>';
  try {
    const { session } = await chrome.storage.local.get("session");
    const base = await getResolvedBackendBase();
    const headers = {};
    if (session?.access_token) headers["Authorization"] = `Bearer ${session.access_token}`;
    const res = await fetch(`${base}/api/public/extension/tasks`, { headers });
    const data = await res.json();
    if (data?.ok && data.tasks && data.tasks.length > 0) {
      list.innerHTML = data.tasks
        .map(
          (t) => `
        <div class="item-row">
          <div style="overflow: hidden; max-width: 80%;">
            <div style="font-weight: 600; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(t.title)}</div>
            <div style="font-size: 10px; color: var(--muted);">${t.created_at ? new Date(t.created_at).toLocaleTimeString() : ""} · ${escapeHtml(t.buddy_slug || t.buddySlug || "friendly")}</div>
          </div>
          <span class="step-status-tag ${t.status}">${escapeHtml(t.status)}</span>
        </div>
      `,
        )
        .join("");
    } else {
      list.innerHTML =
        '<div style="color: var(--muted); font-size: 10px;">No recent tasks executed yet.</div>';
    }
  } catch {
    list.innerHTML =
      '<div style="color: var(--muted); font-size: 10px;">Could not load task history.</div>';
  }
  checkSavedCheckpoint();
}

async function checkSavedCheckpoint() {
  try {
    const { savedCheckpoint } = await chrome.storage.local.get("savedCheckpoint");
    const card = $("savedCheckpointCard") || $("savedTaskCheckpointCard");
    if (savedCheckpoint && savedCheckpoint.status !== "completed") {
      if (card) {
        card.hidden = false;
        if ($("savedTaskCheckpointDesc")) {
          $("savedTaskCheckpointDesc").textContent =
            `Task "${savedCheckpoint.title}" is paused at step ${savedCheckpoint.currentStepIndex + 1} of ${savedCheckpoint.totalSteps}.`;
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

// Models & Providers Handlers
function updateProviderNoticeUI(providerId) {
  const pid = providerId || selectedProvider || "gemini";
  const info = cachedProviderStatuses[pid] || DEFAULT_PROVIDER_META[pid] || DEFAULT_PROVIDER_META.gemini;
  const badge = $("activeProviderStatusBadge");
  const notice = $("providerSelectionNotice");

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
      notice.textContent =
        pid === "gemini"
          ? "Google Gemini is connected and active as the default AI engine."
          : `${info.name} is connected and selected as your active provider.`;
    } else {
      const missingKey = info.missingKeyName || `${pid.toUpperCase()}_API_KEY`;
      notice.style.borderColor = "rgba(245, 158, 11, 0.35)";
      notice.style.color = "#fde68a";
      notice.textContent = `${info.name}: ${statusLabel} (${missingKey}). Your selection is saved — Google Gemini stays active as fallback until ${missingKey} is configured.`;
    }
  }
}

async function selectProvider(providerId) {
  if (!providerId) return;
  selectedProvider = providerId;
  warnedMissingProviders.delete(providerId);
  await chrome.storage.local.set({ selectedProvider: providerId });
  if ($("providerSelector")) {
    $("providerSelector").value = providerId;
  }
  updateProviderNoticeUI(providerId);
  // Highlight active row in providerStatusList if already rendered
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
    if (storedProvider) selectedProvider = storedProvider;

    const base = await getResolvedBackendBase();
    const res = await fetch(`${base}/api/public/extension/models`);
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
          $("providerSelector").innerHTML = data.providers
            .map((p) => {
              const info = cachedProviderStatuses[p.id] || p;
              const defaultSuffix = p.id === "gemini" ? " (Default)" : "";
              return `<option value="${escapeHtml(p.id)}" ${p.id === selectedProvider ? "selected" : ""}>${escapeHtml(p.name)}${defaultSuffix} — ${escapeHtml(info.statusLabel)}</option>`;
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
              : `Missing ${p.missingKeyName || `${p.id.toUpperCase()}_API_KEY`} · Falls back to Gemini`;
            return `
          <div class="item-row provider-row-item" data-provider="${escapeHtml(p.id)}" style="cursor: pointer; ${isSel ? "border-color: var(--accent-cyan); background: rgba(6, 182, 212, 0.08);" : ""}">
            <div>
              <span style="font-weight: 600; color: var(--text);">${escapeHtml(p.name)}${p.id === "gemini" ? " · Default" : ""}</span>
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
            ? "Gemini 3.8 Flash / Pro recommended for high-accuracy claim verification and web synthesis."
            : currentActiveMode === "file"
              ? "Gemini 3.8 Flash recommended for multi-tab spreadsheets, document OCR, and structured forms."
              : "Gemini 3.8 Flash recommended for fast DOM grounding, pointing animations, and browser tasks.";
        $("activeModelRecommendation").textContent = recText;
      }
    }
  } catch {
    updateProviderNoticeUI(selectedProvider);
    list.innerHTML =
      '<div style="color: var(--muted); font-size: 10px;">Could not reach server to refresh live provider status. Local defaults shown above.</div>';
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
    try {
      const base = await getResolvedBackendBase();
      const res = await fetch(`${base}/api/public/extension/test-model`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: targetProv }),
      });
      const data = await res.json();
      if (pingBox) {
        if (data?.ok) {
          pingBox.style.color = "var(--success)";
          pingBox.textContent = `⚡ ${info?.name || targetProv} Connected (${data.latencyMs}ms): ${data.message}`;
        } else {
          pingBox.style.color = "var(--warning)";
          pingBox.textContent = `ℹ️ ${info?.name || targetProv}: ${data?.message || "Missing API or not connected"}`;
        }
      }
    } catch {
      if (pingBox) {
        pingBox.style.color = "var(--warning)";
        pingBox.textContent = "Ping check unavailable in offline mode.";
      }
    }
  };
}

// Rig Animations & Audio Handlers
if ($("testArmWaveBtn")) {
  $("testArmWaveBtn").onclick = () => {
    setRigEmotion("waving", "Hello!");
    const arm = $("rigArmRight");
    if (arm) {
      arm.style.transform = "rotate(-40deg) translateY(-8px)";
      setTimeout(() => {
        arm.style.transform = "rotate(-20deg) translateY(-4px)";
      }, 300);
      setTimeout(() => {
        arm.style.transform = "rotate(-40deg) translateY(-8px)";
      }, 600);
      setTimeout(() => {
        arm.style.transform = "none";
        setRigEmotion("idle", "Idle");
      }, 1000);
    }
  };
}

if ($("testMouthTalkBtn")) {
  $("testMouthTalkBtn").onclick = () => {
    setRigEmotion("speaking", "Talking");
    startSpeechMouthAnimation();
    setTimeout(() => {
      stopSpeechMouthAnimation();
      setRigEmotion("idle", "Idle");
    }, 2500);
  };
}

// Manual CSS Emotion Testing Handlers
if ($("btnEmoCurious")) {
  $("btnEmoCurious").onclick = () => {
    setRigEmotion("curious", "Curious");
    const avatar = $("buddyAvatar");
    if (avatar) avatar.setAttribute("data-emotion", "curious");
  };
}
if ($("btnEmoConcerned")) {
  $("btnEmoConcerned").onclick = () => {
    setRigEmotion("concerned", "Concerned");
    const avatar = $("buddyAvatar");
    if (avatar) avatar.setAttribute("data-emotion", "concerned");
  };
}
if ($("btnEmoHappy")) {
  $("btnEmoHappy").onclick = () => {
    setRigEmotion("happy", "Happy");
    const avatar = $("buddyAvatar");
    if (avatar) avatar.setAttribute("data-emotion", "happy");
  };
}
if ($("btnEmoThinking")) {
  $("btnEmoThinking").onclick = () => {
    setRigEmotion("thinking", "Thinking");
    const avatar = $("buddyAvatar");
    if (avatar) avatar.setAttribute("data-emotion", "thinking");
  };
}
if ($("btnEmoCelebrate")) {
  $("btnEmoCelebrate").onclick = () => {
    setRigEmotion("celebrate", "Celebrate");
    const avatar = $("buddyAvatar");
    if (avatar) avatar.setAttribute("data-emotion", "celebrate");
  };
}
if ($("btnEmoIdle")) {
  $("btnEmoIdle").onclick = () => {
    setRigEmotion("idle", "Idle");
    const avatar = $("buddyAvatar");
    if (avatar) avatar.setAttribute("data-emotion", "idle");
  };
}

if ($("muteToggle")) {
  $("muteToggle").onchange = (e) => {
    isMuted = e.target.checked;
    if (isMuted && window.speechSynthesis) window.speechSynthesis.cancel();
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
    const stage = $("characterStage");
    if (!stage) return;
    if (e.target.value === "hidden") {
      stage.style.display = "none";
    } else if (e.target.value === "compact") {
      stage.style.display = "flex";
      $("characterSvg").style.width = "90px";
      $("characterSvg").style.height = "100px";
      if ($("buddy3dImg")) {
        $("buddy3dImg").style.width = "90px";
        $("buddy3dImg").style.height = "90px";
      }
    } else {
      stage.style.display = "flex";
      $("characterSvg").style.width = "120px";
      $("characterSvg").style.height = "120px";
      if ($("buddy3dImg")) {
        $("buddy3dImg").style.width = "110px";
        $("buddy3dImg").style.height = "110px";
      }
    }
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
    let resolved = session?.apiBase || lastBase;
    if (resolved && (resolved.includes("5t53lwemhepi") || resolved.includes("152127168827"))) {
      resolved = DEFAULT_BASE;
    }
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
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.url && !RESTRICTED.test(tab.url)) {
        const u = new URL(tab.url);
        if (u.protocol.startsWith("http")) {
          if ($("settingsApiBaseInput")) $("settingsApiBaseInput").value = u.origin;
          await chrome.storage.local.set({ lastBase: u.origin });
          if ($("settingsHostFeedback")) {
            $("settingsHostFeedback").textContent = `✓ Auto-detected: ${u.origin}`;
            $("settingsHostFeedback").style.display = "block";
            setTimeout(() => {
              if ($("settingsHostFeedback")) $("settingsHostFeedback").style.display = "none";
            }, 2500);
          }
        }
      }
    } catch {}
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
    $("voiceToggleBtn")?.click();
    if ($("settingsVoiceToggleBtn")) {
      $("settingsVoiceToggleBtn").textContent = isMuted ? "🔇 Muted" : "🔊 Unmuted";
    }
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

// Listen for tab switch and session changes
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "TAB_CHANGED" || msg.type === "TAB_UPDATED") {
    BuddyStateManager.handleTabSwitch(msg.tabId);
  }
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

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.session || changes.selectedBuddySlug)) {
    render();
  }
});

render();
