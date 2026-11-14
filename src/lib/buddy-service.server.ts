/**
 * The one place a Buddy request is executed. Shared by the web app (server function)
 * and the extension endpoint, so both behave identically.
 *
 * Flow: OBSERVE (snapshot arrives) → gate (URL + permission + usage) → UNDERSTAND
 * (persona + memory + budgeted context) → ASK the model with fallback → EXPLAIN.
 * Every phase is written to task_events so a failure is always attributable.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { AiError } from "./ai/errors";
import { generate } from "./ai/orchestrator.server";
import { buildSystemPrompt, parseBuddyReply, type BuddyReply } from "./ai/prompt";
import { getBuddyPreset } from "./ai/buddy-personas";
import { recommendSpecialistBuddy, type BuddyModeRecommendation } from "./ai/mode-recommendations";
import { PROVIDERS, type ProviderId } from "./ai/model-hub";
import { isProviderConfigured } from "./ai/provider-keys.server";
import { MODELS, findModel, route, type ModelEntry, type TaskIntent } from "./ai/registry";
import {
  buildPageContext,
  estimateTokens,
  resolveRef,
  type PageSnapshot,
  type SnapshotElement,
} from "@/shared/page-snapshot";
import { can, type PermissionLevel } from "@/shared/permissions";
import { permissionDeniedMessage } from "@/shared/permissions";
import { checkUrl } from "@/shared/restricted-url";

export const DAILY_REQUEST_LIMIT = 300;

type Db = SupabaseClient<Database>;

export interface AskInput {
  question: string;
  intent: TaskIntent;
  snapshot: PageSnapshot | null;
  source: "extension" | "web";
  history?: Array<{ role: "user" | "assistant"; content: string }> | null;
  preferredProvider?: string | null;
  preferredModel?: string | null;
  userApiKey?: string | null;
  customBaseUrl?: string | null;
  buddySlug?: string | null;
  customBuddyId?: string | null;
  screenshotBase64?: string | null;
  uploadedDocumentSummary?: {
    fileName: string;
    documentType: string;
    availableFields: string[];
  } | null;
}

async function callGeminiWithScreenshot(params: {
  system: string;
  userText: string;
  screenshotBase64: string;
  userApiKey?: string | null;
}): Promise<{ text: string; model: string } | null> {
  const { getGeminiKey } = await import("./ai/provider-keys.server");
  const apiKey = params.userApiKey?.trim() || getGeminiKey();
  if (!apiKey) return null;

  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: { headers: { "User-Agent": "aistudio-build" } },
  });
  const cleanData = params.screenshotBase64.replace(/^data:image\/[^;]+;base64,/, "");
  const models = ["gemini-4-hydrogen", "gemini-3.8-flash", "gemini-3.1-flash-lite"];
  for (const model of models) {
    try {
      const res = await ai.models.generateContent({
        model,
        contents: {
          parts: [
            { inlineData: { mimeType: "image/jpeg", data: cleanData } },
            { text: params.userText },
          ],
        },
        config: { systemInstruction: params.system },
      });
      const text = (res.text ?? "").trim();
      if (text) return { text, model };
    } catch {
      // try next fallback model
    }
  }
  return null;
}

export interface AskOutput {
  taskId: string | null;
  reply: BuddyReply;
  /** The element to highlight, re-resolved against the snapshot we were given. */
  highlightSelector: string | null;
  calloutTitle?: string | null;
  calloutDescription?: string | null;
  actionType?: "click" | "type" | "scroll" | "inspect" | null;
  targetRect?: SnapshotElement["rect"] | null;
  buddyName: string;
  permission: PermissionLevel;
  model?: string;
  activeProvider?: string;
  latencyMs?: number;
  blocked?: boolean;
  fellBack?: boolean;
  aiFallbackUsed?: boolean;
  providerWarning?: {
    requestedProvider: string;
    requestedProviderName: string;
    status: "missing_api" | "not_connected";
    missingKey?: string;
    fallbackUsed: string;
    message: string;
  } | null;
  recommendedMode?: BuddyModeRecommendation | null;
}

function matchSnapshotElementForFallback(
  snapshot: PageSnapshot | null,
  question: string,
): SnapshotElement | null {
  if (!snapshot || !question) return null;
  const STOPWORDS = new Set([
    "khaa",
    "kha",
    "kahan",
    "kaha",
    "kidhar",
    "kdr",
    "hai",
    "hain",
    "tha",
    "the",
    "tab",
    "button",
    "link",
    "section",
    "menu",
    "dikhao",
    "batao",
    "page",
    "par",
    "mein",
    "me",
    "ko",
    "ka",
    "ki",
    "ke",
    "where",
    "what",
    "which",
    "show",
    "tell",
    "find",
    "locate",
    "search",
    "this",
    "that",
    "click",
    "press",
    "dabao",
    "tap",
    "kholo",
    "open",
    "point",
    "highlight",
    "to",
    "on",
    "and",
    "pe",
    "karo",
    "please",
    "without",
    "submitting",
    "submit",
  ]);
  const norm = (s: string) =>
    String(s || "")
      .toLowerCase()
      .replace(/[-_]+/g, " ")
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const termsAll = norm(question)
    .split(/\s+/)
    .filter((t) => t.length > 1);
  const meaningful = termsAll.filter((t) => !STOPWORDS.has(t));
  const qTerms = meaningful.length > 0 ? meaningful : termsAll;
  if (qTerms.length === 0) return null;

  const elements: SnapshotElement[] = [
    ...(snapshot.controls || []),
    ...(snapshot.forms || []),
    ...(snapshot.headings || []),
  ];

  let best: SnapshotElement | null = null;
  let bestScore = 0;
  const targetPhrase = qTerms.join(" ");

  for (const el of elements) {
    const rawText = norm(
      `${el.name || ""} ${el.placeholder || ""} ${(el as { text?: string }).text || ""} ${el.role || ""}`,
    );
    if (!rawText) continue;
    const nameLower = norm(el.name || (el as { text?: string }).text || el.placeholder || "");
    const isClickable =
      el.role === "button" || el.role === "link" || el.tag === "button" || el.tag === "a";
    let score = 0;
    if (nameLower && nameLower === targetPhrase) score += 12;
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

function buildGroundedSnapshotFallback(params: {
  question: string;
  snapshot: PageSnapshot | null;
  buddyName: string;
  language: string;
  aiError: AiError;
}): {
  reply: BuddyReply;
  highlightSelector: string | null;
  calloutTitle?: string | null;
  calloutDescription?: string | null;
  actionType?: "click" | "type" | "scroll" | "inspect" | null;
  targetRect?: SnapshotElement["rect"] | null;
} {
  const { question, snapshot, buddyName, language, aiError } = params;
  const isEnglish = language === "english";
  const qLower = question.toLowerCase().trim();
  const isGreeting = /^(?:hi+|hello+|hey+|namaste|pranam|hola|kya haal|ram ram)[.!?\s]*$/i.test(
    question,
  );

  if (isGreeting) {
    return {
      reply: {
        answer: isEnglish
          ? `Hello! I am ${buddyName}. I am active and ready to help you navigate, inspect fields, check data, or perform tasks across this page!`
          : `Namaste! Main aapka ${buddyName} hoon. Main is webpage par aapki poori help karne ke liye ready hoon. Bataiye aap kya karna chahte hain!`,
        highlight: null,
        confidence: "high",
        needs: null,
        emotion: "happy",
      },
      highlightSelector: null,
    };
  }

  if (snapshot && (aiError.kind === "auth" || aiError.kind === "outage")) {
    const isScroll =
      /\b(?:scroll|neeche\s+(?:jao|le\s+jao)|upar\s+(?:jao|le\s+jao)|bottom\s+par\s+jao|top\s+par\s+jao)\b/i.test(
        qLower,
      );
    if (isScroll) {
      const dir = /\b(?:up|upar|top)\b/i.test(qLower) ? "up" : "down";
      return {
        reply: {
          answer: isEnglish
            ? `Scrolling page ${dir} now.`
            : `Main page ko ${dir} scroll kar raha hoon.`,
          highlight: null,
          confidence: "high",
          needs: null,
          emotion: "thinking",
          actionType: "scroll",
        },
        highlightSelector: null,
        actionType: "scroll",
      };
    }

    const isExplicitFill =
      /\b(?:fill|bhar|bharo)\b/i.test(qLower) &&
      /\b(?:with|se|form|field|input|sku|name|email|phone)\b/i.test(qLower);
    const isPointOrFind =
      !isExplicitFill &&
      /\b(?:point|highlight|find|where|locate|search|dhoondho|dhundo|kaha|kahan|kidhar|dikhao|batao)\b/i.test(
        qLower,
      );
    const isClickOrOpen =
      /(?:\b(?:click|press|dabao|tap|kholo|tick|check|uncheck)\b|\bopen\b.*\b(?:link|tab|page|url)\b)/i.test(
        qLower,
      );

    if (isPointOrFind && !isClickOrOpen) {
      const matchEl = matchSnapshotElementForFallback(snapshot, question);
      if (matchEl) {
        const label =
          matchEl.name ||
          matchEl.placeholder ||
          (matchEl as { text?: string }).text ||
          matchEl.role ||
          "element";
        return {
          reply: {
            answer: isEnglish
              ? `Pointing to "${label}" on this page without clicking.`
              : `Maine "${label}" dhoondh kar point kar diya hai (bina click kiye).`,
            highlight: matchEl.ref || null,
            confidence: "high",
            needs: null,
            emotion: "curious",
            actionType: "inspect",
          },
          highlightSelector: matchEl.selector || null,
          calloutTitle: label.slice(0, 50),
          calloutDescription: "Pointing here",
          actionType: "inspect",
          targetRect: matchEl.rect ?? null,
        };
      }
      return {
        reply: {
          answer: isEnglish
            ? "I could not find a matching visible element on this page. Please share its exact label or scroll so it is visible."
            : "Is page par matching element abhi visible nahi mila. Kripya exact naam batayein ya thoda scroll karein.",
          highlight: null,
          confidence: "low",
          needs: null,
          emotion: "concerned",
        },
        highlightSelector: null,
      };
    }

    if (isClickOrOpen) {
      const matchEl = matchSnapshotElementForFallback(snapshot, question);
      if (matchEl) {
        const label =
          matchEl.name ||
          matchEl.placeholder ||
          (matchEl as { text?: string }).text ||
          matchEl.role ||
          "button";
        return {
          reply: {
            answer: isEnglish
              ? `Targeting "${label}" for interaction.`
              : `Main "${label}" par action ke liye ready hoon.`,
            highlight: matchEl.ref || null,
            confidence: "high",
            needs: null,
            emotion: "thinking",
            actionType: "click",
          },
          highlightSelector: matchEl.selector || null,
          calloutTitle: label.slice(0, 50),
          calloutDescription: "Target interactive control",
          actionType: "click",
          targetRect: matchEl.rect ?? null,
        };
      }
      return {
        reply: {
          answer: isEnglish
            ? "I could not find a matching clickable button or link on this page."
            : "Is page par aisa matching button ya link nahi mila.",
          highlight: null,
          confidence: "low",
          needs: null,
          emotion: "concerned",
        },
        highlightSelector: null,
      };
    }

    if (/\b(?:fill|form|input|fields)\b/i.test(qLower)) {
      const matchEl =
        matchSnapshotElementForFallback(snapshot, question) || snapshot.forms?.[0] || null;
      if (matchEl) {
        const label = matchEl.name || matchEl.placeholder || matchEl.role || "form field";
        return {
          reply: {
            answer: isEnglish
              ? `Located form field "${label}" ready to fill without submitting.`
              : `Form field "${label}" mil gaya hai, bina submit kiye fill karne ke liye ready hai.`,
            highlight: matchEl.ref || null,
            confidence: "high",
            needs: null,
            emotion: "thinking",
            actionType: "type",
          },
          highlightSelector: matchEl.selector || null,
          calloutTitle: label.slice(0, 50),
          calloutDescription: "Form field target",
          actionType: "type",
          targetRect: matchEl.rect ?? null,
        };
      }
      return {
        reply: {
          answer: isEnglish
            ? "No visible input fields were detected on this page."
            : "Is page par abhi koi visible form field nahi mila.",
          highlight: null,
          confidence: "low",
          needs: null,
          emotion: "concerned",
        },
        highlightSelector: null,
      };
    }

    const title = snapshot.title || "active page";
    const headings = (snapshot.headings || [])
      .map((h) => h.name || (h as { text?: string }).text)
      .filter(Boolean)
      .slice(0, 5);
    const formCount = snapshot.forms?.length || 0;
    const btnCount = snapshot.controls?.length || 0;
    let answer = "";
    if (isEnglish) {
      answer = `You are on "${title}".\n\n📌 **Page Overview:**\n`;
      if (headings.length) answer += `• Key Sections: ${headings.join(" • ")}\n`;
      if (btnCount > 0 || formCount > 0)
        answer += `• Interactive Elements: ${btnCount} clickable controls and ${formCount} input fields.\n`;
      answer += `\nI am grounded on this page and ready to assist you with form filling, locating buttons, or automating workflows!`;
    } else {
      answer = `Aap abhi "${title}" par hain.\n\n📌 **Page Overview:**\n`;
      if (headings.length) answer += `• Key Sections: ${headings.join(" • ")}\n`;
      if (btnCount > 0 || formCount > 0)
        answer += `• Interactive Elements: ${btnCount} clickable buttons aur ${formCount} form fields.\n`;
      answer += `\nMain is page par grounded hoon aur forms fill karne, buttons dhoondhne, ya tasks automate karne ke liye ready hoon!`;
    }
    return {
      reply: {
        answer,
        highlight: null,
        confidence: "high",
        needs: null,
        emotion: "happy",
      },
      highlightSelector: null,
    };
  }

  return {
    reply: {
      answer: aiError.resolution
        ? `${aiError.userMessage} ${aiError.resolution}`
        : aiError.userMessage,
      highlight: null,
      confidence: "low",
      needs: null,
      emotion: "concerned",
    },
    highlightSelector: null,
  };
}

export function resolveProviderRouting(params: {
  preferredProvider?: string | null;
  preferredModel?: string | null;
  userApiKey?: string | null;
  defaultCandidates: ModelEntry[];
  language?: string | null;
}): {
  candidates: ModelEntry[];
  effectiveProvider: string;
  providerWarning: AskOutput["providerWarning"];
} {
  const targetModel =
    params.preferredModel && params.preferredModel !== "auto"
      ? findModel(params.preferredModel)
      : undefined;

  const explicitProvider =
    params.preferredProvider && params.preferredProvider !== "auto"
      ? params.preferredProvider.trim().toLowerCase()
      : undefined;

  const requestedProvider = explicitProvider || targetModel?.provider || "gemini";
  const provConfig = PROVIDERS[requestedProvider as ProviderId];

  // Extension Settings userApiKey is specifically Google Gemini Direct Key when starting with AIza
  const trimmedKey = params.userApiKey?.trim();
  const keyProvider = trimmedKey
    ? trimmedKey.startsWith("AIza")
      ? "gemini"
      : requestedProvider
    : undefined;

  const isRequestedConfigured = isProviderConfigured(requestedProvider, keyProvider);
  const geminiModels = [
    ...params.defaultCandidates.filter((m) => m.provider === "gemini"),
    ...MODELS.filter(
      (m) => m.provider === "gemini" && !params.defaultCandidates.some((d) => d.id === m.id),
    ),
  ];

  if (requestedProvider !== "gemini" && !isRequestedConfigured) {
    const provName = provConfig?.name || requestedProvider;
    const isLocal = Boolean(provConfig?.supportsLocal);
    const missingKey =
      provConfig?.envKeyName || (requestedProvider === "ollama" ? "OLLAMA_BASE_URL" : undefined);
    const isEnglish = params.language === "english";
    const missingLabel = isLocal
      ? isEnglish
        ? "local Ollama server connection (OLLAMA_BASE_URL)"
        : "local Ollama server (OLLAMA_BASE_URL)"
      : missingKey || `${provName} API key`;

    const message = isEnglish
      ? `${provName} is currently not connected (missing ${missingLabel}). Continuing with Google Gemini so your task is not interrupted.`
      : `${provName} abhi connected nahi hai (${missingLabel} missing hai). Task rukne na dene ke liye maine Google Gemini use kiya hai.`;

    const fallbackCandidates = [
      ...geminiModels,
      ...params.defaultCandidates.filter((m) => m.provider !== "gemini"),
    ];

    return {
      candidates: fallbackCandidates,
      effectiveProvider: "gemini",
      providerWarning: {
        requestedProvider,
        requestedProviderName: provName,
        status: isLocal ? "not_connected" : "missing_api",
        missingKey,
        fallbackUsed: "Google Gemini",
        message,
      },
    };
  }

  let candidates = params.defaultCandidates;
  if (explicitProvider && explicitProvider !== "gemini") {
    const providerCandidates = [
      ...(targetModel && targetModel.provider === explicitProvider ? [targetModel] : []),
      ...params.defaultCandidates.filter((m) => m.provider === explicitProvider),
      ...MODELS.filter(
        (m) =>
          m.provider === explicitProvider && !params.defaultCandidates.some((d) => d.id === m.id),
      ),
    ];
    const uniqueIds = new Set<string>();
    const dedupedPrimary = providerCandidates.filter((m) => {
      if (uniqueIds.has(m.id)) return false;
      uniqueIds.add(m.id);
      return true;
    });
    candidates = [
      ...dedupedPrimary,
      ...geminiModels.filter((m) => !uniqueIds.has(m.id)),
      ...params.defaultCandidates.filter((m) => !uniqueIds.has(m.id) && m.provider !== "gemini"),
    ];
  } else if (targetModel) {
    candidates = [targetModel, ...params.defaultCandidates.filter((m) => m.id !== targetModel.id)];
  }

  return {
    candidates,
    effectiveProvider: requestedProvider,
    providerWarning: null,
  };
}

interface Persona {
  name: string;
  personality: string;
  teachingStyle: string;
  humorLevel: number;
  seriousness: number;
  language: string;
  expertise: string[];
  systemPrompt: string;
  slug: string;
}

const DEFAULT_PERSONA: Persona = {
  slug: "friendly",
  name: "Buddy",
  personality: "Cheerful, encouraging, casual",
  teachingStyle: "practical",
  humorLevel: 4,
  seriousness: 2,
  language: "hinglish",
  expertise: ["General"],
  systemPrompt: "You are Buddy, a helpful everyday browser companion.",
};

async function loadPersona(db: Db, userId: string): Promise<Persona> {
  const { data: profile } = await db
    .from("profiles")
    .select("selected_buddy_slug, selected_custom_buddy_id, language, voice")
    .eq("id", userId)
    .maybeSingle();

  if (profile?.selected_custom_buddy_id) {
    const { data: custom } = await db
      .from("custom_buddies")
      .select("*")
      .eq("id", profile.selected_custom_buddy_id)
      .maybeSingle();
    if (custom) {
      return {
        slug: `custom:${custom.id}`,
        name: custom.name,
        personality: custom.personality || DEFAULT_PERSONA.personality,
        teachingStyle: custom.teaching_style,
        humorLevel: custom.humor_level,
        seriousness: custom.seriousness,
        language: custom.language,
        expertise: custom.expertise ?? [],
        systemPrompt:
          custom.system_prompt ||
          `You are ${custom.name}, a custom AI companion built by this user.`,
      };
    }
  }

  const slug = profile?.selected_buddy_slug ?? "friendly";
  const { data: buddy } = await db.from("buddies").select("*").eq("slug", slug).maybeSingle();
  if (!buddy) {
    const { getBuddyPreset } = await import("./ai/buddy-personas");
    const preset = getBuddyPreset(slug);
    return {
      slug: preset.slug,
      name: preset.name,
      personality: preset.personality,
      teachingStyle: preset.teaching_style,
      humorLevel: preset.humor_level,
      seriousness: preset.seriousness,
      language: profile?.language ?? preset.default_language,
      expertise: preset.expertise,
      systemPrompt: preset.system_prompt,
    };
  }
  return {
    slug: buddy.slug,
    name: buddy.name,
    personality: buddy.personality,
    teachingStyle: buddy.teaching_style,
    humorLevel: buddy.humor_level,
    seriousness: buddy.seriousness,
    language: profile?.language ?? buddy.default_language,
    expertise: buddy.expertise ?? [],
    systemPrompt: buddy.system_prompt,
  };
}

async function event(
  db: Db,
  taskId: string | null,
  userId: string,
  phase: string,
  detail: string,
): Promise<void> {
  if (!taskId) return;
  await db
    .from("task_events")
    .insert({ task_id: taskId, user_id: userId, phase, detail: detail.slice(0, 500) });
}

export async function ask(db: Db, userId: string, input: AskInput): Promise<AskOutput> {
  const question = input.question.trim().slice(0, 2000);
  if (!question) throw new AiError("bad_request", "Ask me something first.");

  const cId = input.customBuddyId;
  const explicitPersonaPromise: Promise<Persona> = cId
    ? (async () => {
        const { data: custom } = await db
          .from("custom_buddies")
          .select("*")
          .eq("id", cId)
          .maybeSingle();
        if (custom) {
          return {
            slug: `custom:${custom.id}`,
            name: custom.name,
            personality: custom.personality || DEFAULT_PERSONA.personality,
            teachingStyle: custom.teaching_style,
            humorLevel: custom.humor_level,
            seriousness: custom.seriousness,
            language: custom.language,
            expertise: custom.expertise ?? [],
            systemPrompt:
              custom.system_prompt ||
              `You are ${custom.name}, a custom AI companion built by this user.`,
          };
        }
        return loadPersona(db, userId);
      })()
    : input.buddySlug
      ? (async () => {
          const { getBuddyPreset } = await import("./ai/buddy-personas");
          const preset = getBuddyPreset(input.buddySlug);
          return {
            slug: preset.slug,
            name: preset.name,
            personality: preset.personality,
            teachingStyle: preset.teaching_style,
            humorLevel: preset.humor_level,
            seriousness: preset.seriousness,
            language: preset.default_language,
            expertise: preset.expertise,
            systemPrompt: preset.system_prompt,
          };
        })()
      : loadPersona(db, userId);

  const [{ data: settings }, persona] = await Promise.all([
    db
      .from("permission_settings")
      .select("level, privacy_mode, allow_memory, blocked_domains, confirm_high_impact")
      .eq("user_id", userId)
      .maybeSingle(),
    explicitPersonaPromise,
  ]);

  const permission = (settings?.level ?? "explain") as PermissionLevel;
  const privacyMode = settings?.privacy_mode ?? false;
  const blockedDomains = settings?.blocked_domains ?? [];

  const refuse = (message: string): AskOutput => ({
    taskId: null,
    reply: {
      answer: message,
      highlight: null,
      confidence: "high",
      needs: null,
      emotion: "concerned",
    },
    highlightSelector: null,
    buddyName: persona.name,
    permission,
    blocked: true,
  });

  if (input.snapshot) {
    const restriction = checkUrl(input.snapshot.url, blockedDomains);
    if (restriction.restricted) return refuse(restriction.reason ?? "I cannot read this page.");
  }
  if (!can(permission, "answer")) {
    return refuse(permissionDeniedMessage(permission, "answer"));
  }

  let allowed = true;
  try {
    const { data, error: usageError } = await db.rpc("bump_usage", {
      _max: DAILY_REQUEST_LIMIT,
      _tokens: 0,
    });
    if (!usageError && data === false) allowed = false;
  } catch (err) {
    void err;
  }
  if (!allowed) {
    return refuse(
      `You have reached today's limit of ${DAILY_REQUEST_LIMIT} Buddy requests. It resets at midnight UTC.`,
    );
  }

  let memories: Array<{ key: string; value: string }> = [];
  if (!privacyMode && settings?.allow_memory !== false) {
    try {
      const res = await db
        .from("memories")
        .select("key, value")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false })
        .limit(20);
      memories = (res.data as Array<{ key: string; value: string }>) ?? [];
    } catch (err) {
      void err;
    }
  }

  let taskId: string | null = null;
  try {
    const { data: task } = await db
      .from("tasks")
      .insert({
        user_id: userId,
        title: question.slice(0, 140),
        intent: input.intent,
        status: "running",
        buddy_slug: persona.slug,
        page_url: input.snapshot?.url ?? null,
        page_title: input.snapshot?.title ?? null,
      })
      .select("id")
      .maybeSingle();
    taskId = task?.id ?? null;
  } catch (err) {
    void err;
  }

  try {
    await event(
      db,
      taskId,
      userId,
      "observe",
      input.snapshot
        ? `Snapshot: ${input.snapshot.forms.length} fields, ${input.snapshot.controls.length} controls, ${input.snapshot.alerts.length} alerts`
        : "No page snapshot was provided",
    );
  } catch (err) {
    void err;
  }

  const pageContext = input.snapshot
    ? buildPageContext(input.snapshot)
    : "No page context available.";
  const system = buildSystemPrompt({
    persona: {
      name: persona.name,
      personality: persona.personality,
      teachingStyle: persona.teachingStyle,
      humorLevel: persona.humorLevel,
      seriousness: persona.seriousness,
      language: persona.language,
      expertise: persona.expertise,
      systemPrompt: persona.systemPrompt,
    },
    permission,
    memories,
    privacyMode,
    providerDisclosure: "Google Gemini",
  });
  const docSummaryBlock = input.uploadedDocumentSummary
    ? `\n\nUPLOADED DOCUMENT IN SESSION:\nFile: ${input.uploadedDocumentSummary.fileName} (Type: ${input.uploadedDocumentSummary.documentType})\nAvailable extracted fields: ${input.uploadedDocumentSummary.availableFields.join(", ") || "none"}`
    : "";
  const historyBlock = input.history?.length
    ? `\n\nRECENT CONVERSATION:\n${input.history.map((h) => `${h.role === "user" ? "USER" : persona.name}: ${h.content}`).join("\n\n")}`
    : "";
  const user = `${pageContext}${docSummaryBlock}${historyBlock}\n\nUSER (${input.source}): ${question}`;
  await event(db, taskId, userId, "understand", `Context ~${estimateTokens(user)} tokens`);

  const recommendedMode = recommendSpecialistBuddy({
    question,
    activeSlug: persona.slug,
    language: persona.language,
  });

  const routingParams = {
    intent: input.intent,
    needsVision: Boolean(input.screenshotBase64),
    contextTokens: estimateTokens(system + user) + 1200,
    latencySensitive: input.intent === "locate_element",
    costSensitive: false,
  };
  const defaultCandidates = route(routingParams);
  const routingDecision = resolveProviderRouting({
    preferredProvider: input.preferredProvider,
    preferredModel: input.preferredModel,
    userApiKey: input.userApiKey,
    defaultCandidates,
    language: persona.language,
  });

  try {
    const candidates = routingDecision.candidates;
    const useGeminiScreenshot =
      Boolean(input.screenshotBase64) && routingDecision.effectiveProvider === "gemini";

    const visionResult =
      useGeminiScreenshot && input.screenshotBase64
        ? await callGeminiWithScreenshot({
            system,
            userText: user,
            screenshotBase64: input.screenshotBase64,
            userApiKey: input.userApiKey,
          })
        : null;

    const geminiDirectKey =
      input.userApiKey &&
      (routingDecision.effectiveProvider === "gemini" || !input.userApiKey.startsWith("AIza"))
        ? input.userApiKey
        : undefined;

    const result = visionResult
      ? {
          text: visionResult.text,
          model: visionResult.model,
          provider: "gemini",
          latencyMs: 0,
          attempts: 1,
          fellBack: false,
        }
      : await generate({
          system,
          user,
          routing: routingParams,
          candidates,
          userApiKey: geminiDirectKey,
          customBaseUrl: input.customBaseUrl ?? undefined,
          userProvider: routingDecision.effectiveProvider,
        });
    const reply = parseBuddyReply(result.text);

    let highlightSelector: string | null = null;
    let targetRect: SnapshotElement["rect"] | null = null;
    let element: SnapshotElement | null = null;
    if (reply.highlight && input.snapshot) {
      element = resolveRef(input.snapshot, reply.highlight) as SnapshotElement | null;
      highlightSelector = element?.selector ?? null;
      targetRect = element?.rect ?? null;
      if (!element) reply.highlight = null;
    }

    const calloutTitle = reply.calloutTitle || (element?.name ? element.name.slice(0, 50) : null);
    const calloutDescription =
      reply.calloutDescription || (element?.errorMessage ? element.errorMessage : null);
    const actionType =
      reply.actionType ||
      (element?.role === "textbox" || element?.role === "textarea" ? "type" : "click");

    if (result.fellBack && input.preferredModel) {
      await event(
        db,
        taskId,
        userId,
        "fallback",
        `Preferred model ${input.preferredModel} was unavailable; successfully fell back to ${result.model} (${result.provider})`,
      );
    }

    await event(
      db,
      taskId,
      userId,
      "verify",
      `${result.model} in ${result.latencyMs}ms, attempts ${result.attempts}${result.fellBack ? " (fell back)" : ""}; confidence ${reply.confidence}`,
    );
    if (taskId) {
      await db
        .from("tasks")
        .update({
          status: "succeeded",
          answer: reply.answer.slice(0, 4000),
          provider: result.provider,
          model: result.model,
          latency_ms: result.latencyMs,
        })
        .eq("id", taskId);
    }
    await db.rpc("write_audit", {
      _action: "buddy_ask",
      _target: input.snapshot?.origin ?? input.source,
      _metadata: { intent: input.intent, model: result.model },
    });

    return {
      taskId,
      reply,
      highlightSelector,
      calloutTitle,
      calloutDescription,
      actionType,
      targetRect,
      buddyName: persona.name,
      permission,
      model: result.model,
      activeProvider: result.provider,
      latencyMs: result.latencyMs,
      fellBack: result.fellBack || Boolean(routingDecision.providerWarning),
      providerWarning: routingDecision.providerWarning,
      recommendedMode,
    };
  } catch (error) {
    const aiError =
      error instanceof AiError
        ? error
        : new AiError("outage", "Something went wrong on my side. Try once more.", {
            cause: error,
          });
    await event(db, taskId, userId, "recover", `${aiError.kind}: ${aiError.userMessage}`);
    if (taskId) {
      await db
        .from("tasks")
        .update({ status: "failed", error: `${aiError.kind}: ${aiError.userMessage}` })
        .eq("id", taskId);
    }
    const fallback = buildGroundedSnapshotFallback({
      question,
      snapshot: input.snapshot,
      buddyName: persona.name,
      language: persona.language,
      aiError,
    });

    return {
      taskId,
      reply: fallback.reply,
      highlightSelector: fallback.highlightSelector,
      calloutTitle: fallback.calloutTitle,
      calloutDescription: fallback.calloutDescription,
      actionType: fallback.actionType,
      targetRect: fallback.targetRect,
      buddyName: persona.name,
      permission,
      activeProvider: "local_grounded",
      fellBack: true,
      aiFallbackUsed: true,
      blocked: aiError.kind === "credits" || aiError.kind === "blocked",
      providerWarning: routingDecision.providerWarning,
      recommendedMode,
    };
  }
}

/**
 * Public guest execution: Allows browser extension and unauthenticated users to
 * inspect pages and receive grounded AI Buddy guidance without an account gate.
 */
export async function askGuest(input: AskInput): Promise<AskOutput> {
  const question = input.question.trim().slice(0, 2000);
  if (!question) throw new AiError("bad_request", "Ask me something first.");

  const selectedSlug = input.buddySlug || "friendly";
  let persona: {
    slug: string;
    name: string;
    personality: string;
    teaching_style: string;
    humor_level: number;
    seriousness: number;
    default_language: string;
    expertise: string[];
    system_prompt: string;
  };

  if (selectedSlug.startsWith("custom:") || input.customBuddyId) {
    persona = {
      slug: selectedSlug,
      name: "Custom Buddy",
      personality: "Attentive, proactive, tailored to my workflow",
      teaching_style: "step-by-step",
      humor_level: 3,
      seriousness: 3,
      default_language: "hinglish",
      expertise: ["Custom Workflows", "Form Automation", "Document Review", "Specialized Guidance"],
      system_prompt:
        "You are Custom Buddy, the user's personalized AI companion. Ground every answer in the actual webpage and document, fill forms accurately, and explain steps clearly.",
    };
  } else {
    const preset = getBuddyPreset(selectedSlug);
    persona = {
      slug: preset.slug,
      name: preset.name,
      personality: preset.personality,
      teaching_style: preset.teaching_style,
      humor_level: preset.humor_level,
      seriousness: preset.seriousness,
      default_language: preset.default_language,
      expertise: preset.expertise,
      system_prompt: preset.system_prompt,
    };
  }
  const permission: PermissionLevel = "explain";

  if (input.snapshot) {
    const restriction = checkUrl(input.snapshot.url, []);
    if (restriction.restricted) {
      return {
        taskId: null,
        reply: {
          answer: restriction.reason ?? "I cannot read this restricted page.",
          highlight: null,
          confidence: "high",
          needs: null,
          emotion: "concerned",
        },
        highlightSelector: null,
        buddyName: persona.name,
        permission,
        blocked: true,
      };
    }
  }

  const pageContext = input.snapshot
    ? buildPageContext(input.snapshot)
    : "No page context available.";
  const system = buildSystemPrompt({
    persona: {
      name: persona.name,
      personality: persona.personality,
      teachingStyle: persona.teaching_style,
      humorLevel: persona.humor_level,
      seriousness: persona.seriousness,
      language: persona.default_language,
      expertise: persona.expertise,
      systemPrompt: persona.system_prompt,
    },
    permission,
    memories: [],
    privacyMode: true,
    providerDisclosure: "Google Gemini",
  });
  const docSummaryBlock = input.uploadedDocumentSummary
    ? `\n\nUPLOADED DOCUMENT IN SESSION:\nFile: ${input.uploadedDocumentSummary.fileName} (Type: ${input.uploadedDocumentSummary.documentType})\nAvailable extracted fields: ${input.uploadedDocumentSummary.availableFields.join(", ") || "none"}`
    : "";
  const historyBlock = input.history?.length
    ? `\n\nRECENT CONVERSATION:\n${input.history.map((h) => `${h.role === "user" ? "USER" : persona.name}: ${h.content}`).join("\n\n")}`
    : "";
  const user = `${pageContext}${docSummaryBlock}${historyBlock}\n\nUSER (${input.source}): ${question}`;

  const recommendedMode = recommendSpecialistBuddy({
    question,
    activeSlug: persona.slug,
    language: persona.default_language,
  });

  const routingParams = {
    intent: input.intent,
    needsVision: Boolean(input.screenshotBase64),
    contextTokens: estimateTokens(system + user) + 1200,
    latencySensitive: input.intent === "locate_element",
    costSensitive: false,
  };
  const defaultCandidates = route(routingParams);
  const routingDecision = resolveProviderRouting({
    preferredProvider: input.preferredProvider,
    preferredModel: input.preferredModel,
    userApiKey: input.userApiKey,
    defaultCandidates,
    language: persona.default_language,
  });

  try {
    const candidates = routingDecision.candidates;
    const useGeminiScreenshot =
      Boolean(input.screenshotBase64) && routingDecision.effectiveProvider === "gemini";

    const visionResult =
      useGeminiScreenshot && input.screenshotBase64
        ? await callGeminiWithScreenshot({
            system,
            userText: user,
            screenshotBase64: input.screenshotBase64,
            userApiKey: input.userApiKey,
          })
        : null;

    const geminiDirectKey =
      input.userApiKey &&
      (routingDecision.effectiveProvider === "gemini" || !input.userApiKey.startsWith("AIza"))
        ? input.userApiKey
        : undefined;

    const result = visionResult
      ? {
          text: visionResult.text,
          model: visionResult.model,
          provider: "gemini",
          latencyMs: 0,
          attempts: 1,
          fellBack: false,
        }
      : await generate({
          system,
          user,
          routing: routingParams,
          candidates,
          userApiKey: geminiDirectKey,
          customBaseUrl: input.customBaseUrl ?? undefined,
          userProvider: routingDecision.effectiveProvider,
        });

    const reply = parseBuddyReply(result.text);
    let highlightSelector: string | null = null;
    let targetRect: SnapshotElement["rect"] | null = null;
    let resolved: SnapshotElement | null = null;
    if (reply.highlight && input.snapshot) {
      resolved = resolveRef(input.snapshot, reply.highlight) as SnapshotElement | null;
      highlightSelector = resolved?.selector ?? null;
      targetRect = resolved?.rect ?? null;
      if (!resolved) reply.highlight = null;
    }

    const calloutTitle = reply.calloutTitle || (resolved?.name ? resolved.name.slice(0, 50) : null);
    const calloutDescription =
      reply.calloutDescription || (resolved?.errorMessage ? resolved.errorMessage : null);
    const actionType =
      reply.actionType ||
      (resolved?.role === "textbox" || resolved?.role === "textarea" ? "type" : "click");

    return {
      taskId: null,
      reply,
      highlightSelector,
      calloutTitle,
      calloutDescription,
      actionType,
      targetRect,
      buddyName: persona.name,
      permission,
      model: result.model,
      activeProvider: result.provider,
      latencyMs: result.latencyMs,
      fellBack: result.fellBack || Boolean(routingDecision.providerWarning),
      providerWarning: routingDecision.providerWarning,
      recommendedMode,
    };
  } catch (error) {
    const aiError =
      error instanceof AiError
        ? error
        : new AiError("outage", "Something went wrong on my side. Try once more.", {
            cause: error,
          });
    const fallback = buildGroundedSnapshotFallback({
      question,
      snapshot: input.snapshot,
      buddyName: persona.name,
      language: persona.default_language,
      aiError,
    });

    return {
      taskId: null,
      reply: fallback.reply,
      highlightSelector: fallback.highlightSelector,
      calloutTitle: fallback.calloutTitle,
      calloutDescription: fallback.calloutDescription,
      actionType: fallback.actionType,
      targetRect: fallback.targetRect,
      buddyName: persona.name,
      permission,
      activeProvider: "local_grounded",
      fellBack: true,
      aiFallbackUsed: true,
      blocked: aiError.kind === "credits" || aiError.kind === "blocked",
      providerWarning: routingDecision.providerWarning,
      recommendedMode,
    };
  }
}
