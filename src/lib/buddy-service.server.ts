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
import { findModel, route, type TaskIntent } from "./ai/registry";
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
  preferredModel?: string | null;
  userApiKey?: string | null;
  customBaseUrl?: string | null;
  buddySlug?: string | null;
  customBuddyId?: string | null;
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
  latencyMs?: number;
  blocked?: boolean;
  fellBack?: boolean;
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
  const historyBlock = input.history?.length
    ? `\n\nRECENT CONVERSATION:\n${input.history.map((h) => `${h.role === "user" ? "USER" : persona.name}: ${h.content}`).join("\n\n")}`
    : "";
  const user = `${pageContext}${historyBlock}\n\nUSER (${input.source}): ${question}`;
  await event(db, taskId, userId, "understand", `Context ~${estimateTokens(user)} tokens`);

  try {
    const routingParams = {
      intent: input.intent,
      needsVision: false,
      contextTokens: estimateTokens(system + user) + 1200,
      latencySensitive: input.intent === "locate_element",
      costSensitive: false,
    };
    const defaultCandidates = route(routingParams);
    const targetModel = input.preferredModel ? findModel(input.preferredModel) : undefined;
    const candidates = targetModel
      ? [targetModel, ...defaultCandidates.filter((m) => m.id !== targetModel.id)]
      : defaultCandidates;

    const result = await generate({
      system,
      user,
      routing: routingParams,
      candidates,
      userApiKey: input.userApiKey ?? undefined,
      customBaseUrl: input.customBaseUrl ?? undefined,
      userProvider: targetModel?.provider,
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
      latencyMs: result.latencyMs,
      fellBack: result.fellBack,
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
    console.error("[buddy] ask failed", aiError.kind, aiError.cause ?? aiError.message);
    const answer = aiError.resolution
      ? `${aiError.userMessage} ${aiError.resolution}`
      : aiError.userMessage;
    return {
      taskId,
      reply: {
        answer,
        highlight: null,
        confidence: "low",
        needs: null,
        emotion: "concerned",
      },
      highlightSelector: null,
      buddyName: persona.name,
      permission,
      blocked: aiError.kind === "credits" || aiError.kind === "blocked",
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
  const historyBlock = input.history?.length
    ? `\n\nRECENT CONVERSATION:\n${input.history.map((h) => `${h.role === "user" ? "USER" : persona.name}: ${h.content}`).join("\n\n")}`
    : "";
  const user = `${pageContext}${historyBlock}\n\nUSER (${input.source}): ${question}`;

  try {
    const routingParams = {
      intent: input.intent,
      needsVision: false,
      contextTokens: estimateTokens(system + user) + 1200,
      latencySensitive: input.intent === "locate_element",
      costSensitive: false,
    };
    const defaultCandidates = route(routingParams);
    const targetModel = input.preferredModel ? findModel(input.preferredModel) : undefined;
    const candidates = targetModel
      ? [targetModel, ...defaultCandidates.filter((m) => m.id !== targetModel.id)]
      : defaultCandidates;

    const result = await generate({
      system,
      user,
      routing: routingParams,
      candidates,
      userApiKey: input.userApiKey ?? undefined,
      customBaseUrl: input.customBaseUrl ?? undefined,
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
      latencyMs: result.latencyMs,
      fellBack: result.fellBack,
    };
  } catch (error) {
    const aiError =
      error instanceof AiError
        ? error
        : new AiError("outage", "Something went wrong on my side. Try once more.", {
            cause: error,
          });
    const answer = aiError.resolution
      ? `${aiError.userMessage} ${aiError.resolution}`
      : aiError.userMessage;
    return {
      taskId: null,
      reply: {
        answer,
        highlight: null,
        confidence: "low",
        needs: null,
        emotion: "concerned",
      },
      highlightSelector: null,
      buddyName: persona.name,
      permission,
      blocked: aiError.kind === "credits" || aiError.kind === "blocked",
    };
  }
}
