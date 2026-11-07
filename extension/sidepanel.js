const $ = (id) => document.getElementById(id);
const DEFAULT_BASE = "https://id-preview--142f3fbd-6878-42b4-9fe5-1517e2fe8f28.lovable.app";

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

async function sendQuery(question, intent) {
  if (busy || !question.trim()) return;
  busy = true;
  $("sendBtn").disabled = true;

  const historyPayload = getRecentHistoryContext();
  appendHistory("user", question.trim());
  $("promptInput").value = "";

  setRigEmotion("thinking", "Thinking…");
  $("statusText").textContent = "Inspecting active webpage & reasoning…";
  $("highlightBtn").hidden = true;
  $("speakAnswerBtn").hidden = true;

  try {
    const active = getActiveBuddy();
    const res = await chrome.runtime.sendMessage({
      type: "ASK",
      question,
      intent,
      history: historyPayload,
      buddySlug: active.slug,
      customBuddyId: active.isCustom ? active.id || active.slug.replace("custom:", "") : undefined,
    });

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
    recordConversationTurn(question.trim(), currentAnswer);

    lastHighlightSelector = res.highlightSelector || null;
    lastCallout = { title: res.calloutTitle || null, description: res.calloutDescription || null };

    if (lastHighlightSelector) {
      $("highlightBtn").hidden = false;
      pointArmAtElement();
    }
    $("speakAnswerBtn").hidden = false;

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
    setRigEmotion("error", "Error");
    $("statusText").textContent = "Could not reach AI service. Please verify your connection.";
  } finally {
    busy = false;
    $("sendBtn").disabled = false;
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

// Handlers
$("sendBtn").onclick = () => sendQuery($("promptInput").value, "answer");
$("promptInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendQuery($("promptInput").value, "answer");
  }
});

document.querySelectorAll("[data-q]").forEach((btn) => {
  btn.onclick = () => sendQuery(btn.dataset.q, btn.dataset.i);
});

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
  const { lastBase } = await chrome.storage.local.get("lastBase");
  chrome.tabs.create({ url: `${lastBase || DEFAULT_BASE}/connect` });
};

$("signoutBtn").onclick = async () => {
  conversationBuffer.length = 0;
  if ($("historyBox")) $("historyBox").innerHTML = "";
  await chrome.runtime.sendMessage({ type: "SIGN_OUT" });
  render();
};

$("settingsToggle").onclick = () => {
  $("settingsBox").hidden = !$("settingsBox").hidden;
};

$("muteToggle").onchange = (e) => {
  isMuted = e.target.checked;
  if (isMuted && window.speechSynthesis) window.speechSynthesis.cancel();
};

$("avatarRenderMode").onchange = (e) => {
  applyRenderMode(e.target.value);
  chrome.storage.local.set({ avatarRenderMode: e.target.value });
};

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
    $("characterSvg").style.width = "130px";
    $("characterSvg").style.height = "140px";
    if ($("buddy3dImg")) {
      $("buddy3dImg").style.width = "120px";
      $("buddy3dImg").style.height = "120px";
    }
  }
};

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
