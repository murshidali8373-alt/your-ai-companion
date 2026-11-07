import * as React from "react";
import type { TalkingBuddyState } from "@/components/talking-buddy-character";

export const BUDDY_EMOTION_STATES = {
  IDLE: "idle",
  LISTENING: "listening",
  THINKING: "thinking",
  SPEAKING: "speaking",
  HAPPY: "happy",
  EXCITED: "excited",
  LAUGHING: "laughing",
  SAD: "sad",
  SCARED: "scared",
  SURPRISED: "surprised",
  CONFUSED: "confused",
  SLEEPY: "sleepy",
  WORKING: "working",
  SUCCESS: "success",
  ERROR: "error",
  DISCONNECTED: "disconnected",
  PERMISSION_REQUIRED: "permission_required",
} as const;

export type BuddyEmotionState = TalkingBuddyState;
export type BuddyEmotionInput = BuddyEmotionState | keyof typeof BUDDY_EMOTION_STATES | string;

export interface SetEmotionOptions {
  /** Automatically revert to a baseline state after duration in milliseconds */
  durationMs?: number | undefined;
  /** State to revert back to after durationMs (defaults to 'idle') */
  revertTo?: BuddyEmotionInput | undefined;
  /** Optional status description or contextual note */
  reason?: string | undefined;
  /** Priority flag to prevent low-priority animations from overriding task progress */
  priority?: "low" | "normal" | "high" | undefined;
}

export interface StateHistoryEntry {
  emotion: BuddyEmotionState;
  timestamp: number;
  reason?: string | undefined;
}

export interface ActiveBuddyCharacter {
  slug: string;
  id?: string;
  name: string;
  tagline: string;
  expertise: string[];
  personality?: string;
  teachingStyle?: string;
  defaultLanguage?: string;
  accentColor?: string;
  outfit: string;
  outfitColors: [string, string];
  cue: string;
  image: string;
  isCustom: boolean;
}

/**
 * Canonical 16 active characters:
 * 15 specialist buddies + 1 user Custom Buddy
 */
export const BUDDY_CHARACTERS: ActiveBuddyCharacter[] = [
  {
    slug: "friendly",
    name: "Friendly Buddy",
    tagline: "Your everyday browser companion",
    expertise: ["General", "Guidance", "Explanation"],
    personality: "Cheerful, encouraging, casual",
    teachingStyle: "practical",
    defaultLanguage: "hinglish",
    accentColor: "primary",
    outfit: "teal",
    outfitColors: ["#0d9488", "#0f766e"],
    cue: "none",
    image: "/assets/buddy-general-3d.webp",
    isCustom: false,
  },
  {
    slug: "developer",
    name: "Developer Buddy",
    tagline: "Read code, find bugs, propose patches",
    expertise: ["Debugging", "Refactoring", "Testing", "Security"],
    personality: "Direct, analytical, no fluff",
    teachingStyle: "socratic",
    defaultLanguage: "english",
    accentColor: "chart-2",
    outfit: "charcoal",
    outfitColors: ["#334155", "#1e293b"],
    cue: "laptop",
    image: "/assets/buddy-developer-3d.webp",
    isCustom: false,
  },
  {
    slug: "ca",
    name: "CA Buddy",
    tagline: "GST, invoices and compliance, explained simply",
    expertise: ["GST", "Accounting", "Compliance", "Reconciliation"],
    personality: "Precise, patient, checklist-driven",
    teachingStyle: "step-by-step",
    defaultLanguage: "hinglish",
    accentColor: "chart-1",
    outfit: "charcoal",
    outfitColors: ["#334155", "#1e293b"],
    cue: "ledger",
    image: "/assets/buddy-ca-3d.webp",
    isCustom: false,
  },
  {
    slug: "legal",
    name: "Legal Buddy",
    tagline: "Understand documents and clauses without the jargon",
    expertise: ["Contracts", "Compliance", "Drafting", "Research"],
    personality: "Careful, formal, evidence-first",
    teachingStyle: "explanatory",
    defaultLanguage: "english",
    accentColor: "chart-3",
    outfit: "charcoal",
    outfitColors: ["#334155", "#1e293b"],
    cue: "book",
    image: "/assets/buddy-legal-3d.webp",
    isCustom: false,
  },
  {
    slug: "ecommerce",
    name: "E-commerce Buddy",
    tagline: "Listings, keywords and marketplace workflows",
    expertise: ["Listings", "SEO", "Ads", "Catalog", "Pricing"],
    personality: "Commercial, growth-minded, fast-paced",
    teachingStyle: "action-oriented",
    defaultLanguage: "hinglish",
    accentColor: "chart-4",
    outfit: "teal",
    outfitColors: ["#0d9488", "#0f766e"],
    cue: "parcel",
    image: "/assets/buddy-ecommerce-3d.webp",
    isCustom: false,
  },
  {
    slug: "business",
    name: "Business Buddy",
    tagline: "Plans, numbers and decisions",
    expertise: ["Strategy", "Finance", "Operations"],
    personality: "Strategic, structured, ROI-focused",
    teachingStyle: "executive-summary",
    defaultLanguage: "hinglish",
    accentColor: "chart-5",
    outfit: "blue",
    outfitColors: ["#2563eb", "#1d4ed8"],
    cue: "briefcase",
    image: "/assets/buddy-business-3d.webp",
    isCustom: false,
  },
  {
    slug: "marketing",
    name: "Marketing Buddy",
    tagline: "Copy, campaigns and creative angles",
    expertise: ["Copywriting", "Ads", "SEO", "Social"],
    personality: "Creative, persuasive, trend-aware",
    teachingStyle: "iterative",
    defaultLanguage: "hinglish",
    accentColor: "chart-1",
    outfit: "coral",
    outfitColors: ["#ea580c", "#c2410c"],
    cue: "campaign",
    image: "/assets/buddy-marketing-3d.webp",
    isCustom: false,
  },
  {
    slug: "research",
    name: "Research Buddy",
    tagline: "Find, compare and summarise",
    expertise: ["Research", "Summarisation", "Comparison"],
    personality: "Curious, thorough, objective",
    teachingStyle: "synthesis",
    defaultLanguage: "english",
    accentColor: "chart-2",
    outfit: "sage",
    outfitColors: ["#4d7c0f", "#3f6212"],
    cue: "book",
    image: "/assets/buddy-research-3d.webp",
    isCustom: false,
  },
  {
    slug: "data",
    name: "Data Buddy",
    tagline: "Spreadsheets, tables and patterns",
    expertise: ["Spreadsheets", "Analysis", "Reporting"],
    personality: "Quantitative, methodical, pattern-seeking",
    teachingStyle: "visual-first",
    defaultLanguage: "english",
    accentColor: "chart-3",
    outfit: "blue",
    outfitColors: ["#2563eb", "#1d4ed8"],
    cue: "chart",
    image: "/assets/buddy-data-3d.webp",
    isCustom: false,
  },
  {
    slug: "content",
    name: "Content Buddy",
    tagline: "Write and rewrite anything",
    expertise: ["Writing", "Editing", "Structure"],
    personality: "Expressive, versatile, audience-tuned",
    teachingStyle: "workshop",
    defaultLanguage: "hinglish",
    accentColor: "chart-4",
    outfit: "burgundy",
    outfitColors: ["#831843", "#701a75"],
    cue: "pen",
    image: "/assets/buddy-content-3d.webp",
    isCustom: false,
  },
  {
    slug: "design",
    name: "Design Buddy",
    tagline: "Layout, hierarchy and visual polish",
    expertise: ["UI", "Layout", "Branding"],
    personality: "Visual, critical, detail-obsessed",
    teachingStyle: "critique-and-refine",
    defaultLanguage: "english",
    accentColor: "chart-5",
    outfit: "lilac",
    outfitColors: ["#9333ea", "#7e22ce"],
    cue: "swatches",
    image: "/assets/buddy-design-3d.webp",
    isCustom: false,
  },
  {
    slug: "operations",
    name: "Operations Buddy",
    tagline: "Process, checklists and follow-through",
    expertise: ["Process", "SOPs", "Automation"],
    personality: "Systematic, efficient, preventative",
    teachingStyle: "flowcharts-and-checklists",
    defaultLanguage: "hinglish",
    accentColor: "chart-1",
    outfit: "blue",
    outfitColors: ["#2563eb", "#1d4ed8"],
    cue: "briefcase",
    image: "/assets/buddy-business-3d.webp",
    isCustom: false,
  },
  {
    slug: "professor",
    name: "Professor Buddy",
    tagline: "Teaches until it actually clicks",
    expertise: ["Teaching", "Explanation", "Examples"],
    personality: "Academic, encouraging, deeply knowledgeable",
    teachingStyle: "first-principles",
    defaultLanguage: "hinglish",
    accentColor: "chart-2",
    outfit: "sage",
    outfitColors: ["#4d7c0f", "#3f6212"],
    cue: "book",
    image: "/assets/buddy-professor-3d.webp",
    isCustom: false,
  },
  {
    slug: "dadaji",
    name: "Dadaji Buddy",
    tagline: "Old-school wisdom, gentle pace",
    expertise: ["Guidance", "Patience", "BasicTech"],
    personality: "Warm, grandfatherly, deeply patient",
    teachingStyle: "story-driven",
    defaultLanguage: "hindi",
    accentColor: "chart-3",
    outfit: "teal",
    outfitColors: ["#0d9488", "#0f766e"],
    cue: "none",
    image: "/assets/buddy-family-3d.png",
    isCustom: false,
  },
  {
    slug: "detective",
    name: "Detective Buddy",
    tagline: "Finds what is actually wrong",
    expertise: ["Diagnosis", "RootCause", "Verification"],
    personality: "Skeptical, investigative, evidence-bound",
    teachingStyle: "forensic",
    defaultLanguage: "english",
    accentColor: "chart-4",
    outfit: "sage",
    outfitColors: ["#4d7c0f", "#3f6212"],
    cue: "book",
    image: "/assets/buddy-research-3d.webp",
    isCustom: false,
  },
  {
    slug: "custom:user_custom_buddy_1",
    id: "user_custom_buddy_1",
    name: "My Custom Buddy",
    tagline: "Tailored to my workflow, forms and personal preferences",
    expertise: ["Custom Workflows", "Form Automation", "Document Review", "Specialized Guidance"],
    personality: "Attentive, proactive, tailored to my workflow",
    teachingStyle: "step-by-step",
    defaultLanguage: "hinglish",
    accentColor: "ecommerce",
    outfit: "teal",
    outfitColors: ["#0d9488", "#0f766e"],
    cue: "parcel",
    image: "/assets/buddy-ecommerce-3d.webp",
    isCustom: true,
  },
];

export interface BuddyStateManagerValue {
  // --- Character Synchronization & Persistent Selection ---
  /** All 16 synchronized active characters (15 specialists + 1 Custom Buddy) */
  buddies: ActiveBuddyCharacter[];
  /** Alias for buddies */
  allBuddies: ActiveBuddyCharacter[];
  /** Current selected Buddy slug (guaranteed valid string, defaults to 'friendly') */
  selectedBuddySlug: string;
  /** Active selected Buddy character record (guaranteed non-null) */
  selectedBuddy: ActiveBuddyCharacter;
  /** Alias for selectedBuddy */
  activeBuddy: ActiveBuddyCharacter;
  /** Selected Custom Buddy ID if custom buddy is chosen */
  selectedCustomBuddyId: string | null;
  /** Select and persistently activate a character across tabs and views */
  selectBuddy: (slugOrId: string) => void;
  /** Alias for selectBuddy */
  setSelectedBuddy: (slugOrId: string) => void;
  /** Retrieve the active character with reliable non-blank fallback */
  getActiveBuddy: () => ActiveBuddyCharacter;
  /** Lookup buddy by slug */
  getBuddyBySlug: (slug: string) => ActiveBuddyCharacter | undefined;
  /** Custom buddies collection */
  customBuddies: ActiveBuddyCharacter[];
  /** Register or update a custom buddy */
  registerCustomBuddy: (
    custom: Partial<ActiveBuddyCharacter> & { id: string; name: string },
  ) => void;
  /** Ready state indicating persistent state has hydrated */
  isReady: boolean;
  /** Verify and enforce non-blank state across window and tab switches */
  ensureNonBlankState: () => ActiveBuddyCharacter;
  /** Synchronize tab and window state */
  syncTabState: () => void;

  // --- Emotion Engine & Visual State ---
  /** Current canonical emotion state (lowercase, e.g. "idle", "speaking", "thinking") */
  emotion: BuddyEmotionState;
  /** Alias for emotion */
  state: BuddyEmotionState;
  /** Alias for emotion */
  currentEmotion: BuddyEmotionState;
  /** Current canonical emotion state in UPPERCASE (e.g. "IDLE", "SPEAKING", "THINKING") */
  emotionUpper: string;
  /** Descriptive status message corresponding to current emotion */
  statusMessage: string;
  /** Set emotion with optional auto-reset duration and context */
  setEmotion: (emotion: BuddyEmotionInput, options?: SetEmotionOptions) => void;
  /** Reset emotion back to idle */
  resetEmotion: (reason?: string) => void;

  // Convenient Conversation and Task Helpers
  startListening: (reason?: string) => void;
  startThinking: (reason?: string) => void;
  startSpeaking: (reason?: string) => void;
  stopSpeaking: (reason?: string) => void;
  returnToIdle: () => void;
  setSuccess: (durationMs?: number, reason?: string) => void;
  setError: (reason?: string, durationMs?: number) => void;
  setWorking: (taskName?: string) => void;
  requirePermission: (reason?: string) => void;
  poke: () => void;

  /**
   * Automatically manage emotion lifecycle around an async conversation turn or background task.
   */
  runTask: <T>(
    task: () => Promise<T>,
    options?: {
      taskName?: string;
      workingEmotion?: BuddyEmotionInput;
      successEmotion?: BuddyEmotionInput;
      successDurationMs?: number;
      errorDurationMs?: number;
    },
  ) => Promise<T>;

  // Booleans for quick conditional rendering
  isIdle: boolean;
  isListening: boolean;
  isThinking: boolean;
  isSpeaking: boolean;
  isWorking: boolean;
  isError: boolean;
  isSuccess: boolean;
  isHappy: boolean;

  /** History of recent emotion changes */
  history: StateHistoryEntry[];
  /** Clear history */
  clearHistory: () => void;
}

/**
 * Normalizes input string/constant to a valid canonical BuddyEmotionState.
 */
export function normalizeEmotion(input: BuddyEmotionInput): BuddyEmotionState {
  if (!input) return "idle";
  const clean = String(input).trim().toLowerCase();

  switch (clean) {
    case "idle":
    case "neutral":
      return "idle";
    case "listening":
    case "listen":
      return "listening";
    case "thinking":
    case "think":
      return "thinking";
    case "speaking":
    case "speak":
    case "talking":
      return "speaking";
    case "happy":
      return "happy";
    case "excited":
      return "excited";
    case "laughing":
    case "laugh":
    case "giggle":
      return "laughing";
    case "sad":
      return "sad";
    case "scared":
    case "fear":
      return "scared";
    case "surprised":
    case "surprise":
      return "surprised";
    case "confused":
    case "curious":
      return "confused";
    case "sleepy":
    case "sleeping":
      return "sleepy";
    case "working":
    case "executing":
    case "task":
      return "working";
    case "success":
    case "celebrate":
    case "done":
      return "success";
    case "error":
    case "concerned":
    case "failed":
      return "error";
    case "disconnected":
    case "offline":
      return "disconnected";
    case "permission_required":
    case "permission":
    case "confirm":
      return "permission_required";
    default:
      return "idle";
  }
}

function getDefaultStatus(state: BuddyEmotionState): string {
  switch (state) {
    case "listening":
      return "Listening to your voice…";
    case "thinking":
      return "Thinking and observing…";
    case "speaking":
      return "Speaking…";
    case "happy":
      return "Happy to help!";
    case "excited":
      return "Ready to go!";
    case "laughing":
      return "Hehe!";
    case "working":
      return "Working on your page task…";
    case "success":
      return "Task completed successfully!";
    case "error":
      return "Something went wrong.";
    case "permission_required":
      return "Approval required before proceeding.";
    case "disconnected":
      return "Disconnected from backend.";
    case "sleepy":
      return "Taking a quick rest…";
    case "confused":
      return "Not quite sure about that.";
    case "idle":
    default:
      return "Ready and listening.";
  }
}

const STORAGE_KEY_SLUG = "ai_buddy_selected_slug";
const STORAGE_KEY_CUSTOM_ID = "ai_buddy_selected_custom_id";
const STORAGE_KEY_CUSTOM_LIST = "ai_buddy_custom_buddies";
const SYNC_EVENT_NAME = "ai-buddy-selection-changed";

function getSavedSlug(): string {
  if (typeof window === "undefined") return "friendly";
  try {
    const saved =
      window.localStorage.getItem(STORAGE_KEY_SLUG) ||
      window.localStorage.getItem("selectedBuddySlug");
    if (saved && saved.trim()) return saved.trim();
  } catch {
    // fallback
  }
  return "friendly";
}

function getSavedCustomId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY_CUSTOM_ID);
    if (saved && saved.trim()) return saved.trim();
  } catch {
    // fallback
  }
  return null;
}

/**
 * Centralized BuddyStateManager hook:
 * Synchronizes the 16 active characters, handles persistent selection across tabs/reloads,
 * and guarantees non-blank character states across tab switches and window transitions.
 */
export function useBuddyStateManager(
  initialEmotion: BuddyEmotionInput = "idle",
  initialSlug?: string,
): BuddyStateManagerValue {
  // Character Registry State
  const [buddies, setBuddies] = React.useState<ActiveBuddyCharacter[]>(BUDDY_CHARACTERS);
  const [selectedSlug, setSelectedSlugState] = React.useState<string>(() => {
    if (initialSlug && initialSlug.trim()) return initialSlug.trim();
    return getSavedSlug();
  });
  const [selectedCustomId, setSelectedCustomId] = React.useState<string | null>(getSavedCustomId);
  const [isReady, setIsReady] = React.useState<boolean>(false);

  // Emotion Engine State
  const [emotion, setRawEmotion] = React.useState<BuddyEmotionState>(() =>
    normalizeEmotion(initialEmotion),
  );
  const [statusMessage, setStatusMessage] = React.useState<string>(() =>
    getDefaultStatus(normalizeEmotion(initialEmotion)),
  );
  const [history, setHistory] = React.useState<StateHistoryEntry[]>(() => [
    { emotion: normalizeEmotion(initialEmotion), timestamp: Date.now() },
  ]);

  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Helper to safely get active buddy
  const resolveActiveBuddy = React.useCallback(
    (slug: string, list: ActiveBuddyCharacter[]): ActiveBuddyCharacter => {
      const match = list.find((b) => b.slug === slug || b.id === slug);
      return match || list[0] || BUDDY_CHARACTERS[0];
    },
    [],
  );

  const selectedBuddy = React.useMemo(() => {
    return resolveActiveBuddy(selectedSlug, buddies);
  }, [resolveActiveBuddy, selectedSlug, buddies]);

  // Ensure persistent selection across localStorage, Chrome storage, and cross-tab events
  const selectBuddy = React.useCallback(
    (slugOrId: string) => {
      if (!slugOrId) return;
      const target = resolveActiveBuddy(slugOrId, buddies);
      const newSlug = target.slug;
      const customId = target.isCustom ? target.id || target.slug.replace("custom:", "") : null;

      setSelectedSlugState(newSlug);
      setSelectedCustomId(customId);

      try {
        if (typeof window !== "undefined") {
          window.localStorage.setItem(STORAGE_KEY_SLUG, newSlug);
          window.localStorage.setItem("selectedBuddySlug", newSlug);
          if (customId) {
            window.localStorage.setItem(STORAGE_KEY_CUSTOM_ID, customId);
          } else {
            window.localStorage.removeItem(STORAGE_KEY_CUSTOM_ID);
          }

          // Chrome extension storage bridge if available
          const chromeObj = (
            window as unknown as {
              chrome?: { storage?: { local?: { set: (d: Record<string, unknown>) => void } } };
            }
          ).chrome;
          if (chromeObj?.storage?.local?.set) {
            chromeObj.storage.local.set({
              selectedBuddySlug: newSlug,
              selectedCustomBuddyId: customId,
            });
          }

          // Broadcast cross-tab and component sync event
          window.dispatchEvent(
            new CustomEvent(SYNC_EVENT_NAME, {
              detail: { slug: newSlug, customId, buddy: target },
            }),
          );
        }
      } catch {
        // Safe fallback in restricted environments
      }
    },
    [buddies, resolveActiveBuddy],
  );

  // Tab switch synchronization and blank state avoidance
  const syncTabState = React.useCallback(() => {
    const currentSaved = getSavedSlug();
    if (currentSaved && currentSaved !== selectedSlug) {
      const valid = resolveActiveBuddy(currentSaved, buddies);
      setSelectedSlugState(valid.slug);
    }
  }, [buddies, resolveActiveBuddy, selectedSlug]);

  const ensureNonBlankState = React.useCallback((): ActiveBuddyCharacter => {
    const active = resolveActiveBuddy(selectedSlug, buddies);
    if (!active) {
      setSelectedSlugState("friendly");
      return BUDDY_CHARACTERS[0];
    }
    return active;
  }, [buddies, resolveActiveBuddy, selectedSlug]);

  // Synchronize on hydration and listen for cross-tab storage changes and visibility changes
  React.useEffect(() => {
    setIsReady(true);

    // Initial check from localStorage
    const saved = getSavedSlug();
    if (saved && saved !== selectedSlug) {
      setSelectedSlugState(saved);
    }

    // Load custom buddies from localStorage if available
    try {
      const rawCustom = window.localStorage.getItem(STORAGE_KEY_CUSTOM_LIST);
      if (rawCustom) {
        const parsed = JSON.parse(rawCustom);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setBuddies((prev) => {
            const canonical15 = prev.filter((b) => !b.isCustom);
            return [...canonical15, ...parsed];
          });
        }
      }
    } catch {
      // ignore
    }

    // 1. Cross-tab synchronization via standard StorageEvent
    const handleStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY_SLUG || e.key === "selectedBuddySlug") {
        if (e.newValue && e.newValue.trim()) {
          setSelectedSlugState(e.newValue.trim());
        }
      }
    };

    // 2. In-window custom event synchronization
    const handleCustomSync = (e: Event) => {
      const customEvent = e as CustomEvent<{ slug?: string; customId?: string }>;
      if (customEvent.detail?.slug) {
        setSelectedSlugState(customEvent.detail.slug);
      }
    };

    // 3. Tab Visibility & Focus listener: prevents blank states when switching browser tabs
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        syncTabState();
        ensureNonBlankState();
      }
    };

    const handleWindowFocus = () => {
      syncTabState();
      ensureNonBlankState();
    };

    window.addEventListener("storage", handleStorage);
    window.addEventListener(SYNC_EVENT_NAME, handleCustomSync);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleWindowFocus);

    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(SYNC_EVENT_NAME, handleCustomSync);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleWindowFocus);
    };
  }, [syncTabState, ensureNonBlankState, selectedSlug]);

  // Register Custom Buddy
  const registerCustomBuddy = React.useCallback(
    (custom: Partial<ActiveBuddyCharacter> & { id: string; name: string }) => {
      const newCustom: ActiveBuddyCharacter = {
        slug: `custom:${custom.id}`,
        id: custom.id,
        name: custom.name,
        tagline: custom.tagline || "Tailored personal companion",
        expertise: custom.expertise || ["Custom Workflows", "Form Automation"],
        personality: custom.personality || "Attentive and helpful",
        teachingStyle: custom.teachingStyle || "practical",
        defaultLanguage: custom.defaultLanguage || "hinglish",
        accentColor: custom.accentColor || "ecommerce",
        outfit: custom.outfit || "teal",
        outfitColors: custom.outfitColors || ["#0d9488", "#0f766e"],
        cue: custom.cue || "parcel",
        image: custom.image || "/assets/buddy-ecommerce-3d.webp",
        isCustom: true,
      };

      setBuddies((prev) => {
        const filtered = prev.filter((b) => b.slug !== newCustom.slug && b.id !== newCustom.id);
        const updated = [...filtered, newCustom];
        try {
          const customOnly = updated.filter((b) => b.isCustom);
          window.localStorage.setItem(STORAGE_KEY_CUSTOM_LIST, JSON.stringify(customOnly));
        } catch {
          // ignore
        }
        return updated;
      });

      selectBuddy(newCustom.slug);
    },
    [selectBuddy],
  );

  // Clear emotion timer on unmount
  React.useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const setEmotion = React.useCallback(
    (nextInput: BuddyEmotionInput, options?: SetEmotionOptions) => {
      const canonical = normalizeEmotion(nextInput);

      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }

      setRawEmotion(canonical);
      setStatusMessage(options?.reason || getDefaultStatus(canonical));

      setHistory((prev) => [
        ...prev.slice(-25),
        { emotion: canonical, timestamp: Date.now(), reason: options?.reason },
      ]);

      // Handle auto-revert timeout
      if (options?.durationMs && options.durationMs > 0) {
        const revertState = normalizeEmotion(options.revertTo || "idle");
        timerRef.current = setTimeout(() => {
          setRawEmotion(revertState);
          setStatusMessage(getDefaultStatus(revertState));
          setHistory((prev) => [
            ...prev.slice(-25),
            {
              emotion: revertState,
              timestamp: Date.now(),
              reason: "Auto-revert to baseline",
            },
          ]);
        }, options.durationMs);
      }
    },
    [],
  );

  // Conversation & Task Lifecycle Triggers
  const startListening = React.useCallback(
    (reason?: string) => setEmotion("listening", { reason }),
    [setEmotion],
  );

  const startThinking = React.useCallback(
    (reason?: string) => setEmotion("thinking", { reason }),
    [setEmotion],
  );

  const startSpeaking = React.useCallback(
    (reason?: string) => setEmotion("speaking", { reason }),
    [setEmotion],
  );

  const stopSpeaking = React.useCallback(
    (reason?: string) => setEmotion("idle", { reason }),
    [setEmotion],
  );

  const returnToIdle = React.useCallback(() => setEmotion("idle"), [setEmotion]);

  const setSuccess = React.useCallback(
    (durationMs = 2500, reason?: string) =>
      setEmotion("success", { durationMs, revertTo: "idle", reason }),
    [setEmotion],
  );

  const setError = React.useCallback(
    (reason?: string, durationMs = 3500) =>
      setEmotion("error", { durationMs, revertTo: "idle", reason }),
    [setEmotion],
  );

  const setWorking = React.useCallback(
    (taskName?: string) =>
      setEmotion("working", { reason: taskName ? `Working on: ${taskName}` : undefined }),
    [setEmotion],
  );

  const requirePermission = React.useCallback(
    (reason?: string) => setEmotion("permission_required", { reason }),
    [setEmotion],
  );

  const resetEmotion = React.useCallback(
    (reason?: string) => setEmotion("idle", { reason: reason || "Returned to idle" }),
    [setEmotion],
  );

  const runTask = React.useCallback(
    async <T,>(
      task: () => Promise<T>,
      options?: {
        taskName?: string;
        workingEmotion?: BuddyEmotionInput;
        successEmotion?: BuddyEmotionInput;
        successDurationMs?: number;
        errorDurationMs?: number;
      },
    ): Promise<T> => {
      const working = options?.workingEmotion || "working";
      const success = options?.successEmotion || "success";
      const taskName = options?.taskName || "Task execution";
      setEmotion(working, { reason: `Working on: ${taskName}` });

      try {
        const result = await task();
        setEmotion(success, {
          durationMs: options?.successDurationMs ?? 2500,
          revertTo: "idle",
          reason: `${taskName} completed successfully`,
        });
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setEmotion("error", {
          durationMs: options?.errorDurationMs ?? 3500,
          revertTo: "idle",
          reason: `Error in ${taskName}: ${message}`,
        });
        throw err;
      }
    },
    [setEmotion],
  );

  const poke = React.useCallback(() => {
    setEmotion("laughing", { durationMs: 1200, revertTo: "idle", reason: "Giggle!" });
  }, [setEmotion]);

  const clearHistory = React.useCallback(() => {
    setHistory([{ emotion, timestamp: Date.now(), reason: "History cleared" }]);
  }, [emotion]);

  const getActiveBuddy = React.useCallback(() => {
    return resolveActiveBuddy(selectedSlug, buddies);
  }, [buddies, resolveActiveBuddy, selectedSlug]);

  const getBuddyBySlug = React.useCallback(
    (slug: string) => {
      return buddies.find((b) => b.slug === slug || b.id === slug);
    },
    [buddies],
  );

  const customBuddies = React.useMemo(() => {
    return buddies.filter((b) => b.isCustom);
  }, [buddies]);

  return {
    // Character Synchronization & Selection
    buddies,
    allBuddies: buddies,
    selectedBuddySlug: selectedSlug,
    selectedBuddy,
    activeBuddy: selectedBuddy,
    selectedCustomBuddyId: selectedCustomId,
    selectBuddy,
    setSelectedBuddy: selectBuddy,
    getActiveBuddy,
    getBuddyBySlug,
    customBuddies,
    registerCustomBuddy,
    isReady,
    ensureNonBlankState,
    syncTabState,

    // Emotion & Visual State
    emotion,
    state: emotion,
    currentEmotion: emotion,
    emotionUpper: emotion.toUpperCase(),
    statusMessage,
    setEmotion,
    resetEmotion,

    startListening,
    startThinking,
    startSpeaking,
    stopSpeaking,
    returnToIdle,
    setSuccess,
    setError,
    setWorking,
    requirePermission,
    poke,
    runTask,

    isIdle: emotion === "idle",
    isListening: emotion === "listening",
    isThinking: emotion === "thinking",
    isSpeaking: emotion === "speaking",
    isWorking: emotion === "working",
    isError: emotion === "error",
    isSuccess: emotion === "success",
    isHappy: emotion === "happy" || emotion === "excited" || emotion === "laughing",

    history,
    clearHistory,
  };
}

// Global Context for sharing character selection and emotion across all application components
const BuddyStateContext = React.createContext<BuddyStateManagerValue | null>(null);

export interface BuddyStateProviderProps {
  initialState?: BuddyEmotionInput;
  initialSlug?: string;
  children: React.ReactNode;
}

export function BuddyStateProvider({
  initialState = "idle",
  initialSlug,
  children,
}: BuddyStateProviderProps) {
  const manager = useBuddyStateManager(initialState, initialSlug);
  return <BuddyStateContext.Provider value={manager}>{children}</BuddyStateContext.Provider>;
}

/**
 * Hook to consume the shared centralized BuddyStateManager context,
 * or falls back to an independent state manager if used outside provider.
 */
export function useBuddyState(
  defaultState?: BuddyEmotionInput,
  defaultSlug?: string,
): BuddyStateManagerValue {
  const context = React.useContext(BuddyStateContext);
  const localManager = useBuddyStateManager(defaultState || "idle", defaultSlug);
  return context ?? localManager;
}

/**
 * BuddyStateManager hook (matches exact user naming).
 * Centralized hook to synchronize the 16 active characters, handle persistent selection,
 * and ensure non-blank states across tab switches.
 */
export function BuddyStateManager(
  initialEmotion: BuddyEmotionInput = "idle",
  initialSlug?: string,
): BuddyStateManagerValue {
  return useBuddyStateManager(initialEmotion, initialSlug);
}

export default useBuddyStateManager;
