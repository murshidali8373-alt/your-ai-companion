const $ = (id) => document.getElementById(id);
const DEFAULT_BASE = "https://ais-dev-5t53lwemhepi2nbkqb2reo-152127168827.asia-east1.run.app";
const RESTRICTED =
  /^(chrome|edge|about|chrome-extension|devtools|view-source):|chromewebstore\.google\.com|chrome\.google\.com\/webstore/;

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
  } = await chrome.storage.local.get([
    "session",
    "selectedBuddySlug",
    "selectedCustomBuddyId",
    "avatarRenderMode",
  ]);

  if (savedSlug) selectedBuddySlug = savedSlug;
  if (savedCustomId) selectedCustomBuddyId = savedCustomId;
  if (savedMode) currentRenderMode = savedMode;

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
  const apiBase = session?.apiBase || DEFAULT_BASE;
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

async function executeScroll(direction = "down", amount = 450) {
  setRigEmotion("working", "Scrolling");
  $("statusText").textContent = `Scrolling page ${direction}…`;
  const res = await chrome.runtime.sendMessage({
    type: "EXECUTE_ACTION",
    action: "scroll",
    value: direction,
    options: { direction, amount },
  });
  if (res?.ok) {
    $("statusText").textContent = res.message || `Scrolled ${direction}.`;
    if (res.hasMoreBelow !== undefined && $("pageCompletenessBanner")) {
      $("pageCompletenessBanner").hidden = !res.hasMoreBelow;
    }
  }
  setTimeout(() => setRigEmotion("idle", "Idle"), 1000);
}

async function executeFind(query) {
  setRigEmotion("thinking", "Finding");
  $("statusText").textContent = `Searching page for "${query}"…`;
  const active = getActiveBuddy();
  const res = await chrome.runtime.sendMessage({
    type: "FIND_CONTENT",
    query,
    options: {
      scroll: true,
      highlight: true,
      buddyVisual: {
        outfitColor: active.outfitColors?.[0] || "#0d9488",
        name: active.name,
      },
    },
  });
  if (res?.ok && res.totalMatches > 0) {
    setRigEmotion("pointing", "Found!");
    lastHighlightSelector = res.firstSelector;
    $("highlightBtn").hidden = false;
    const msg = `Found ${res.totalMatches} match${res.totalMatches > 1 ? "es" : ""} for "${query}". Pointing with Lamba Haath!`;
    $("statusText").textContent = msg;
    appendHistory("buddy", `🎯 ${msg}\nSnippet: "${res.targetMatch?.textSnippet || ""}"`);
    speakResponse(`I found ${res.totalMatches} match on this page.`);
  } else {
    setRigEmotion("idle", "Not found");
    const msg = `Could not find "${query}" in visible page content.`;
    $("statusText").textContent = msg;
    appendHistory("buddy", msg);
  }
}

async function sendQuery(question, intent) {
  if (busy || !question.trim()) return;

  const trimmed = question.trim();
  const lower = trimmed.toLowerCase();

  // 1. Direct browser command intercepts for zero-latency execution
  const greetingMatch = lower.match(
    /^(?:hi+|hello+|hey+|namaste|pranam|hola|kya haal(?:\s+hai)?|ram ram|good\s+(?:morning|afternoon|evening)|kaise ho)(?:\s+(?:buddy|dost|ai buddy|ji))?[.!?\s]*$/i,
  );
  if (greetingMatch) {
    appendHistory("user", trimmed);
    $("promptInput").value = "";
    const active = getActiveBuddy();
    setRigEmotion("celebrate", "Namaste!");
    const greetingText =
      active.defaultLanguage === "english"
        ? `Hey there! I am ${active.name}. Ask me anything about this page, or tell me what action to take (fill forms, find elements, analyze tables, or automate workflows)!`
        : `Namaste! Main aapka ${active.name} hoon. Aap is page par jo bhi karna chahte hain—forms fill karna, buttons dhoondhna, data copy karna ya Meesho orders check karna—bataiye, main turant help karunga!`;
    appendHistory("buddy", greetingText);
    $("statusText").textContent = `Ready with ${active.name}.`;
    speakResponse(greetingText, "happy");
    return;
  }

  const helpMatch = lower.match(
    /^(?:what can you do|help|kaam kya hai|kya kar sakte ho|features|commands|guide me)[.!?\s]*$/i,
  );
  if (helpMatch) {
    appendHistory("user", trimmed);
    $("promptInput").value = "";
    const active = getActiveBuddy();
    setRigEmotion("happy", "Ready");
    const helpMsg =
      active.defaultLanguage === "english"
        ? `I am ${active.name}, your browser companion! Here is what I can do:\n• Explain any webpage or dashboard\n• Find & highlight any button, link or menu (e.g. 'find login button')\n• Auto-fill form fields and verify mistakes\n• Extract order lists and tables (Meesho, Flipkart, Excel)\n• Automate multi-step browser tasks\n\nTry typing: 'Explain this page' or 'Check pending orders'!`
        : `Main aapka ${active.name} hoon! Main aapke browser par ye sab kar sakta hoon:\n• Current page explain karna\n• Kisi bhi button ya menu ko dhundh kar highlight karna ('find submit button')\n• Safe form filling aur errors check karna\n• Meesho / Flipkart orders aur tables extract karna\n• Multi-step browser workflows automate karna\n\nTry kijiye: 'Explain this page' ya 'Check pending orders'!`;
    appendHistory("buddy", helpMsg);
    $("statusText").textContent = `Capabilities of ${active.name}.`;
    speakResponse(helpMsg, "happy");
    return;
  }

  if (
    /^(?:scroll\s+(?:down|up|to top|top|to bottom|bottom)|neeche jao|upar jao|page down|page up)$/i.test(
      lower,
    )
  ) {
    let dir = "down";
    if (lower.includes("up") || lower.includes("upar")) dir = "up";
    else if (lower.includes("top")) dir = "top";
    else if (lower.includes("bottom")) dir = "bottom";
    appendHistory("user", trimmed);
    $("promptInput").value = "";
    await executeScroll(dir);
    return;
  }

  const findMatch = lower.match(/^(?:find|search|dhoondho|locate|show me)\s+(.+)/i);
  if (findMatch && !lower.includes("form") && !lower.includes("error") && !lower.includes("page")) {
    appendHistory("user", trimmed);
    $("promptInput").value = "";
    await executeFind(findMatch[1]);
    return;
  }

  const copyMatch = lower.match(/^copy\s+(.+)/i);
  if (copyMatch) {
    appendHistory("user", trimmed);
    $("promptInput").value = "";
    setRigEmotion("working", "Copying");
    const res = await chrome.runtime.sendMessage({
      type: "EXECUTE_ACTION",
      action: "copy_to_clipboard",
      value: copyMatch[1],
      options: { limit: 4 },
    });
    if (res?.ok) {
      setRigEmotion("happy", "Copied");
      const msg = `📋 ${res.message || "Copied to clipboard."}\nItems:\n${(res.copiedItems || []).map((it) => `• ${it}`).join("\n")}`;
      appendHistory("buddy", msg);
      $("statusText").textContent = res.message;
    } else {
      setRigEmotion("idle", "Idle");
      appendHistory("buddy", res?.message || "Could not find items to copy.");
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
    const { preferredModel } = await chrome.storage.local.get("preferredModel");
    const detachPage = $("pageContextToggle") && !$("pageContextToggle").checked;
    const finalIntent = detachPage ? "general" : intent;
    const res = await chrome.runtime.sendMessage({
      type: "ASK",
      question,
      intent: finalIntent,
      history: historyPayload,
      buddySlug: active.slug,
      customBuddyId: active.isCustom ? active.id || active.slug.replace("custom:", "") : undefined,
      preferredModel: preferredModel && preferredModel !== "auto" ? preferredModel : undefined,
    });

    hideChatLoadingSpinner();

    if (res?.error) {
      setRigEmotion("error", "Notice");
      const errMsg =
        res.pageReadable === false
          ? "I cannot read the current webpage right now. Please refresh or allow page access."
          : res.message || "Buddy encountered an issue. Please try again.";
      $("statusText").textContent = errMsg;
      appendHistory("buddy", errMsg);
      return;
    }

    currentAnswer = res.reply?.answer || "I could not find information on this page.";
    appendHistory("buddy", currentAnswer);
    recordConversationTurn(trimmed, currentAnswer);

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

    // Detect if high-impact action needs confirmation
    const qLower = question.toLowerCase();
    if (
      qLower.includes("submit") ||
      qLower.includes("click") ||
      qLower.includes("pay") ||
      qLower.includes("delete")
    ) {
      pendingAction = {
        type: qLower.includes("click") ? "click" : "scroll",
        selector: lastHighlightSelector,
        value: "",
      };
      $("confirmDesc").textContent =
        `Buddy is requesting approval before executing action: "${question.slice(0, 80)}"`;
      $("confirmCard").hidden = false;
      setRigEmotion("thinking", "Confirm");
    } else {
      const emotion = lastHighlightSelector ? "pointing" : res.reply?.emotion || "idle";
      setRigEmotion(emotion, emotion.toUpperCase());
      speakResponse(currentAnswer, emotion);
    }

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
async function startSmartFormFill(sampleData = null) {
  $("formFillCard").hidden = false;
  $("statusText").textContent = "Inspecting form fields on active page…";

  const dataToFill = sampleData || {
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
  };

  const res = await chrome.runtime.sendMessage({
    type: "SMART_FILL_FORM",
    fields: dataToFill,
    options: { overwrite: false }, // Preserves existing user data!
  });

  const reportEl = $("formFillReport");
  if (!reportEl) return;
  reportEl.hidden = false;

  if (res?.ok && res.results) {
    const { filled, preserved, skipped, errors } = res.results;
    const lines = [];

    if (filled.length > 0) {
      lines.push(
        `✅ Filled & verified (${filled.length}): ${filled.map((f) => f.field).join(", ")}`,
      );
    }
    if (preserved.length > 0) {
      lines.push(
        `🔒 Preserved existing values (${preserved.length}): ${preserved.map((p) => p.field).join(", ")}`,
      );
    }
    if (skipped.length > 0) {
      lines.push(
        `🛡️ Skipped (${skipped.length}): ${skipped.map((s) => s.key || s.field).join(", ")}`,
      );
    }
    if (errors.length > 0) {
      lines.push(`⚠️ Issues: ${errors.map((e) => e.key).join(", ")}`);
    }

    if (lines.length === 0) {
      reportEl.textContent =
        "No matching inputs found on this page. Navigate to a form page to fill.";
    } else {
      reportEl.innerHTML = lines.join("<br>");
    }

    setRigEmotion("happy", "Filled");
    $("statusText").textContent =
      `Form filled: ${filled.length} verified, ${preserved.length} preserved.`;
    appendHistory(
      "buddy",
      `📝 Smart Form Fill complete: ${filled.length} fields filled & verified, ${preserved.length} preserved.`,
    );

    // Explicit User-Confirmation Gate before submission
    if (res.results.pendingSubmission) {
      pendingAction = {
        type: "click_submit",
        selector: res.results.pendingSubmission.submitButtonSelector || 'button[type="submit"]',
        text: res.results.pendingSubmission.submitButtonText || "Submit Form",
      };
      if ($("confirmText")) {
        $("confirmText").textContent =
          `All ${filled.length} fields filled & verified. Would you like Buddy to submit the form via "${pendingAction.text}"?`;
      }
      if ($("confirmCard")) $("confirmCard").hidden = false;
      setRigEmotion("thinking", "Confirm");
    }
  } else {
    reportEl.textContent = res?.message || "Could not fill form on this page.";
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
    // General parser: split on conjunctions, semicolons, and commas
    const segments = trimmed
      .split(
        /(?:\r?\n|\s*(?:then|and then|after that|next|finally)\s*|[;]\s*|,\s*(?:and\s+)?|\s+and\s+(?=(?:go|open|click|press|select|find|copy|type|fill|submit|search|verify|extract|purchase|delete|confirm)\b)|\s*\d+[\.\)]\s+)/i,
      )
      .map((s) =>
        s
          .trim()
          .replace(/^[\d+\.\-\*\)]\s*/, "")
          .replace(/^and\s+/i, ""),
      )
      .filter((s) => s.length > 2);

    let idx = 1;
    for (const seg of segments) {
      const segLower = seg.toLowerCase();
      const isConsequential = /purchase|buy|pay|delete|submit|confirm/i.test(segLower);
      let act = "click";
      let val = undefined;
      let textTarget = undefined;

      if (
        segLower.startsWith("open ") ||
        segLower.startsWith("go to ") ||
        segLower.startsWith("navigate ")
      ) {
        if (segLower.includes("http") || segLower.includes(".com") || segLower.includes(".in")) {
          act = "navigate";
          const m = seg.match(/https?:\/\/[^\s]+/i);
          val = m ? m[0] : undefined;
        } else {
          act = "click";
          textTarget = seg.replace(/^(?:open|go to|navigate to)\s+/i, "").trim();
        }
      } else if (
        segLower.includes("copy") ||
        segLower.includes("extract") ||
        segLower.includes("prepare a list")
      ) {
        act = "extract";
        val = "order_id";
      } else if (segLower.includes("scroll")) {
        act = "scroll";
        val = segLower.includes("up") ? "up" : "down";
      } else if (segLower.startsWith("type ") || segLower.startsWith("fill ")) {
        act = "fill_field";
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
      } else {
        act = "click";
        textTarget = seg.replace(/^(?:click|press|tap)\s+/i, "").trim();
      }

      steps.push({
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
      });
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
  $("extractedCountTitle").textContent = `📊 Extracted Data (${count} items)`;

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

  $("extractedContent").textContent = contentText;
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

// Mode Selector Pills
document.querySelectorAll(".mode-pill").forEach((pill) => {
  pill.onclick = () => {
    document.querySelectorAll(".mode-pill").forEach((p) => p.classList.remove("active"));
    pill.classList.add("active");
    currentActiveMode = pill.getAttribute("data-mode") || "auto";
    const input = $("promptInput");
    if (!input) return;
    const modePlaceholders = {
      auto: NATURAL_PLACEHOLDERS[0],
      chat: "Chat with Buddy directly…",
      browser: "Direct action: Click, fill, inspect or navigate…",
      research: "Deep Research: Synthesize sources and verify claims…",
      file: "Files & Sheets: Compare files, find duplicates, edit cells…",
      workflow: "Workflow: Describe a repeatable multi-step recipe…",
    };
    input.placeholder = modePlaceholders[currentActiveMode] || NATURAL_PLACEHOLDERS[0];
    input.focus();
  };
});

// Quick Action Cards
if ($("qaExplainPage")) {
  $("qaExplainPage").onclick = () => {
    sendQuery("Explain what this page is about simply and summarize key points.", "explain_page");
  };
}
if ($("qaResearch")) {
  $("qaResearch").onclick = () => {
    const pill = document.querySelector('.mode-pill[data-mode="research"]');
    if (pill) pill.click();
    const input = $("promptInput");
    if (input) {
      input.value = "Research: ";
      input.focus();
    }
  };
}
if ($("qaWorkWithFiles")) {
  $("qaWorkWithFiles").onclick = () => {
    const pill = document.querySelector('.mode-pill[data-mode="file"]');
    if (pill) pill.click();
    const input = $("promptInput");
    if (input) {
      input.value = "Analyze spreadsheet and find duplicates: ";
      input.focus();
    }
  };
}
if ($("qaAutomateTask")) {
  $("qaAutomateTask").onclick = () => {
    const pill = document.querySelector('.mode-pill[data-mode="workflow"]');
    if (pill) pill.click();
    const input = $("promptInput");
    if (input) {
      input.value = "Automate task: ";
      input.focus();
    }
  };
}

// File Attachment Button
if ($("attachFileBtn") && $("composerFileInput")) {
  $("attachFileBtn").onclick = () => {
    $("composerFileInput").click();
  };
  $("composerFileInput").onchange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      const tag = `[Attached: ${file.name} (${Math.round(file.size / 1024)} KB)] `;
      if (!$("promptInput").value.includes(file.name)) {
        $("promptInput").value = tag + $("promptInput").value;
      }
      $("promptInput").focus();
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
          $("greetingContext").textContent = "Workspace ready · Select an action to start";
        }
      });
    }
  } catch {
    // Non-fatal
  }
}

// Handlers
$("sendBtn").onclick = () => {
  const val = $("promptInput").value;
  if (!val.trim()) return;

  // Intercept in-flight task commands
  if (handleInFlightControlCommand(val)) {
    $("promptInput").value = "";
    if (promptInputEl) promptInputEl.style.height = "auto";
    return;
  }

  const lower = val.toLowerCase();
  if (
    currentActiveMode === "workflow" ||
    lower.includes("meesho") ||
    lower.includes("and then") ||
    lower.includes("copy their order") ||
    lower.includes("prepare a list") ||
    (lower.includes("open") && lower.includes("find")) ||
    (lower.includes("go to") && lower.includes("click"))
  ) {
    $("promptInput").value = "";
    if (promptInputEl) promptInputEl.style.height = "auto";
    startMultiActionPlan(val);
  } else if (currentActiveMode === "research") {
    $("promptInput").value = "";
    if (promptInputEl) promptInputEl.style.height = "auto";
    sendQuery(val, "deep_research");
  } else if (currentActiveMode === "browser") {
    $("promptInput").value = "";
    if (promptInputEl) promptInputEl.style.height = "auto";
    sendQuery(val, "browser_action");
  } else if (currentActiveMode === "file") {
    $("promptInput").value = "";
    if (promptInputEl) promptInputEl.style.height = "auto";
    sendQuery(val, "file_analysis");
  } else {
    $("promptInput").value = "";
    if (promptInputEl) promptInputEl.style.height = "auto";
    sendQuery(val, "answer");
  }
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

    const lower = val.toLowerCase();
    if (
      currentActiveMode === "workflow" ||
      lower.includes("meesho") ||
      lower.includes("and then") ||
      lower.includes("copy their order") ||
      lower.includes("prepare a list") ||
      (lower.includes("open") && lower.includes("find"))
    ) {
      $("promptInput").value = "";
      if (promptInputEl) promptInputEl.style.height = "auto";
      startMultiActionPlan(val);
    } else if (currentActiveMode === "research") {
      $("promptInput").value = "";
      if (promptInputEl) promptInputEl.style.height = "auto";
      sendQuery(val, "deep_research");
    } else if (currentActiveMode === "browser") {
      $("promptInput").value = "";
      if (promptInputEl) promptInputEl.style.height = "auto";
      sendQuery(val, "browser_action");
    } else if (currentActiveMode === "file") {
      $("promptInput").value = "";
      if (promptInputEl) promptInputEl.style.height = "auto";
      sendQuery(val, "file_analysis");
    } else {
      $("promptInput").value = "";
      if (promptInputEl) promptInputEl.style.height = "auto";
      sendQuery(val, "answer");
    }
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

$("openFormAssistantChip").onclick = () => startSmartFormFill();
$("autoFillSampleBtn").onclick = () => startSmartFormFill();
$("verifyFormInputsBtn").onclick = () =>
  sendQuery("Find and verify all form fields on this page.", "locate_element");
$("closeFormFillBtn").onclick = () => {
  $("formFillCard").hidden = true;
};

$("highlightBtn").onclick = () => pointArmAtElement();
$("speakAnswerBtn").onclick = () => {
  if (currentAnswer) speakResponse(currentAnswer);
};

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

$("fixErrorsBtn").onclick = () => {
  sendQuery(
    "Analyze the errors, alerts, and invalid form fields on this page. Explain why they occurred and give me step-by-step instructions to fix them.",
    "classify",
  );
};
$("dismissErrorsBtn").onclick = () => {
  if ($("pageErrorBanner")) $("pageErrorBanner").hidden = true;
};

$("confirmApproveBtn").onclick = async () => {
  if (!pendingAction) return;
  $("confirmCard").hidden = true;
  $("statusText").textContent = `Executing ${pendingAction.type}…`;
  setRigEmotion("working", "Acting");

  const res = await chrome.runtime.sendMessage({
    type: "EXECUTE_ACTION",
    action: pendingAction.type,
    selector: pendingAction.selector,
    value: pendingAction.value,
  });

  if (res?.ok) {
    setRigEmotion("happy", "Done");
    $("statusText").textContent = res.message || "Action finished successfully.";
    appendHistory("buddy", `✅ Done: ${res.message || "Action completed."}`);
  } else {
    setRigEmotion("error", "Notice");
    $("statusText").textContent = res?.message || "Action failed or was blocked.";
  }
  pendingAction = null;
  setTimeout(() => setRigEmotion("idle", "Idle"), 2500);
};

$("confirmCancelBtn").onclick = () => {
  $("confirmCard").hidden = true;
  pendingAction = null;
  setRigEmotion("idle", "Idle");
  $("statusText").textContent = "Action cancelled.";
};

$("connectBtn").onclick = async () => {
  // Dynamically fetch active backend base and session state from chrome.storage.local
  const { lastBase, session } = await chrome.storage.local.get(["lastBase", "session"]);
  let targetBase = session?.apiBase || lastBase;

  // Fallback checks: Settings DOM input, active tab, and open AI Buddy tabs
  if (!targetBase) {
    try {
      const settingsInput = $("settingsApiBaseInput");
      if (settingsInput?.value?.trim()?.startsWith("http")) {
        targetBase = new URL(settingsInput.value.trim()).origin;
      }
    } catch {}
  }

  if (!targetBase) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.url && !RESTRICTED.test(tab.url)) {
        const u = new URL(tab.url);
        if (
          u.protocol.startsWith("http") &&
          (u.hostname.includes("run.app") ||
            u.hostname === "localhost" ||
            u.hostname === "127.0.0.1" ||
            tab.title?.includes("AI Buddy") ||
            tab.title?.includes("your-ai-companion") ||
            u.hostname.includes("aistudio.google.com"))
        ) {
          if (u.hostname.includes("aistudio.google.com")) {
            targetBase = DEFAULT_BASE;
          } else {
            targetBase = u.origin;
          }
        }
      }
    } catch {}
  }

  if (!targetBase) {
    try {
      const allTabs = await chrome.tabs.query({});
      for (const t of allTabs) {
        if (t.url && !RESTRICTED.test(t.url)) {
          const u = new URL(t.url);
          if (
            u.protocol.startsWith("http") &&
            (u.hostname.includes("run.app") ||
              u.hostname === "localhost" ||
              t.title?.includes("AI Buddy") ||
              t.title?.includes("your-ai-companion") ||
              u.hostname.includes("aistudio.google.com"))
          ) {
            targetBase = u.hostname.includes("aistudio.google.com") ? DEFAULT_BASE : u.origin;
            break;
          }
        }
      }
    } catch {}
  }

  const resolvedBase = targetBase || DEFAULT_BASE;
  // Synchronize lastBase in storage so background worker and subsequent calls use it
  await chrome.storage.local.set({ lastBase: resolvedBase });

  // Ensure it correctly redirects to /connect with the active extension session state
  const connectUrl = new URL(`${resolvedBase}/connect`);
  if (session?.accessToken) {
    connectUrl.searchParams.set("ext_session", "active");
    if (session.email) connectUrl.searchParams.set("email", session.email);
  }
  connectUrl.searchParams.set("src", "extension_sidepanel");

  chrome.tabs.create({ url: connectUrl.toString() });
};

$("signoutBtn").onclick = async () => {
  conversationBuffer.length = 0;
  if ($("historyBox")) $("historyBox").innerHTML = "";
  await chrome.runtime.sendMessage({ type: "SIGN_OUT" });
  render();
};

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
    const { lastBase, session } = await chrome.storage.local.get(["lastBase", "session"]);
    const base = lastBase || DEFAULT_BASE;
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
    const { lastBase, session } = await chrome.storage.local.get(["lastBase", "session"]);
    const base = lastBase || DEFAULT_BASE;
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
      const { lastBase, session } = await chrome.storage.local.get(["lastBase", "session"]);
      const base = lastBase || DEFAULT_BASE;
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
    const { lastBase, session } = await chrome.storage.local.get(["lastBase", "session"]);
    const base = lastBase || DEFAULT_BASE;
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
async function loadModelHubStatus() {
  const list = $("providerStatusList");
  if (!list) return;
  list.innerHTML =
    '<div style="color: var(--muted); font-size: 10px;">Checking provider statuses…</div>';
  try {
    const { lastBase, preferredModel } = await chrome.storage.local.get([
      "lastBase",
      "preferredModel",
    ]);
    const base = lastBase || DEFAULT_BASE;
    const res = await fetch(`${base}/api/public/extension/models`);
    const data = await res.json();
    if (data?.ok) {
      if (data.providers && data.providers.length > 0) {
        list.innerHTML = data.providers
          .map(
            (p) => `
          <div class="item-row">
            <div>
              <span style="font-weight: 600; color: var(--text);">${escapeHtml(p.name)}</span>
              <div style="font-size: 9px; color: var(--muted);">${escapeHtml(p.rateLimitNote || "")}</div>
            </div>
            <span class="step-status-tag ${p.configured ? "completed" : "pending"}">${p.configured ? "Available" : p.freeTier ? "Free Tier" : "Config Required"}</span>
          </div>
        `,
          )
          .join("");
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
            ? "Gemini 2.5 Flash / Pro recommended for high-accuracy claim verification and web synthesis."
            : currentActiveMode === "file"
              ? "Gemini 2.5 Pro recommended for multi-tab spreadsheets and large dataset reasoning."
              : "Gemini 2.5 Flash recommended for fast DOM grounding, pointing animations, and browser tasks.";
        $("activeModelRecommendation").textContent = recText;
      }
    }
  } catch {
    list.innerHTML =
      '<div style="color: var(--muted); font-size: 10px;">Could not check provider status.</div>';
  }
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
        ? "Show Model Comparison"
        : "Hide Model Comparison";
    }
  };
}

if ($("testActiveProviderBtn")) {
  $("testActiveProviderBtn").onclick = async () => {
    const pingBox = $("pingTestResult");
    if (pingBox) {
      pingBox.hidden = false;
      pingBox.textContent = "Pinging Google Gemini API…";
    }
    try {
      const { lastBase } = await chrome.storage.local.get("lastBase");
      const base = lastBase || DEFAULT_BASE;
      const res = await fetch(`${base}/api/public/extension/test-model`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "gemini" }),
      });
      const data = await res.json();
      if (pingBox) {
        if (data?.ok) {
          pingBox.style.color = "var(--success)";
          pingBox.textContent = `⚡ Gemini active: ${data.latencyMs}ms latency · ${data.message}`;
        } else {
          pingBox.style.color = "var(--warning)";
          pingBox.textContent = `Notice: ${data.message || "Provider verification completed"}`;
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
  const { session, lastBase, permissionLevel, requireConsent } = await chrome.storage.local.get([
    "session",
    "lastBase",
    "permissionLevel",
    "requireConsent",
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
    $("settingsApiBaseInput").value = session?.apiBase || lastBase || DEFAULT_BASE;
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
