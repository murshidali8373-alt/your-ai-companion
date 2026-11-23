/**
 * Typed RPC surface for the web app. Public reads use the publishable key;
 * everything user-scoped goes through requireSupabaseAuth so RLS applies.
 */

import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { PERMISSION_LEVELS } from "@/shared/permissions";
import { containsSensitive } from "@/shared/sensitive";

function publicClient() {
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key) throw new Error("Backend is not configured");
  return createClient<Database>(url, key, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        if (key.startsWith("sb_") && headers.get("Authorization") === `Bearer ${key}`) {
          headers.delete("Authorization");
        }
        headers.set("apikey", key);
        return fetch(input, { ...init, headers });
      },
    },
  });
}

export const listBuddies = createServerFn({ method: "GET" }).handler(async () => {
  const { BUDDY_PRESETS } = await import("./ai/buddy-personas");
  try {
    const url = process.env["SUPABASE_URL"];
    const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
    if (url && key) {
      const { data, error } = await publicClient()
        .from("buddies")
        .select(
          "slug, name, tagline, expertise, personality, teaching_style, humor_level, seriousness, default_language, accent_color, recommended_skills, sort_order",
        )
        .order("sort_order", { ascending: true });
      if (!error && data && data.length > 0) {
        return { buddies: data, error: null as string | null };
      }
    }
    return { buddies: BUDDY_PRESETS, error: null as string | null };
  } catch {
    return { buddies: BUDDY_PRESETS, error: null as string | null };
  }
});

export const getDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const [profile, subscription, permissions, tasks, memories, usage, customBuddies] =
      await Promise.all([
        supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
        supabase.from("subscriptions").select("*").eq("user_id", userId).maybeSingle(),
        supabase.from("permission_settings").select("*").eq("user_id", userId).maybeSingle(),
        supabase
          .from("tasks")
          .select(
            "id, title, status, intent, page_title, page_url, answer, error, model, created_at",
          )
          .order("created_at", { ascending: false })
          .limit(10),
        supabase
          .from("memories")
          .select("id, kind, key, value, updated_at")
          .order("updated_at", { ascending: false })
          .limit(50),
        supabase
          .from("usage_counters")
          .select("day, requests")
          .order("day", { ascending: false })
          .limit(7),
        supabase
          .from("custom_buddies")
          .select("id, name, tagline, personality, language, permission_level, accent_color")
          .order("created_at", { ascending: false }),
      ]);

    return {
      profile: profile.data,
      subscription: subscription.data,
      permissions: permissions.data,
      tasks: tasks.data ?? [],
      memories: memories.data ?? [],
      usage: usage.data ?? [],
      customBuddies: customBuddies.data ?? [],
    };
  });

export const selectBuddy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ slug: z.string().max(60).nullable(), customId: z.string().uuid().nullable() })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("profiles")
      .update({
        selected_buddy_slug: data.slug,
        selected_custom_buddy_id: data.customId,
      })
      .eq("id", context.userId);
    if (error) throw new Error("Could not save your Buddy choice. Please try again.");
    return { ok: true };
  });

export const updateProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        display_name: z.string().max(80).optional(),
        language: z.enum(["english", "hindi", "hinglish"]).optional(),
        voice: z.string().max(40).optional(),
        graphics_mode: z.enum(["low", "balanced", "high"]).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("profiles")
      .update(Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)) as never)
      .eq("id", context.userId);
    if (error) throw new Error("Could not save your settings.");
    return { ok: true };
  });

export const updatePermissions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        level: z.enum(PERMISSION_LEVELS).optional(),
        confirm_high_impact: z.boolean().optional(),
        allow_screenshots: z.boolean().optional(),
        privacy_mode: z.boolean().optional(),
        allow_memory: z.boolean().optional(),
        blocked_domains: z.array(z.string().max(120)).max(50).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("permission_settings")
      .upsert({
        user_id: context.userId,
        ...Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)),
        updated_at: new Date().toISOString(),
      } as never)
      .eq("user_id", context.userId);
    if (error) throw new Error("Could not save your permissions.");
    await context.supabase.rpc("write_audit", {
      _action: "permissions_changed",
      _target: data.level ?? "settings",
      _metadata: data as never,
    });
    return { ok: true };
  });

export const createCustomBuddy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        name: z.string().min(1).max(60),
        tagline: z.string().max(120).default(""),
        expertise: z.array(z.string().max(40)).max(12).default([]),
        personality: z.string().max(400).default(""),
        teaching_style: z.string().max(40).default("practical"),
        humor_level: z.number().int().min(1).max(5).default(3),
        seriousness: z.number().int().min(1).max(5).default(3),
        language: z.enum(["english", "hindi", "hinglish"]).default("hinglish"),
        voice: z.string().max(40).default("default"),
        accent_color: z.string().max(20).default("primary"),
        allowed_tools: z.array(z.string().max(40)).max(30).default([]),
        permission_level: z.enum(PERMISSION_LEVELS).default("explain"),
        memory_enabled: z.boolean().default(true),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const systemPrompt = [
      `You are ${data.name}${data.tagline ? `, ${data.tagline}` : ""}.`,
      data.personality ? `Personality: ${data.personality}.` : "",
      data.expertise.length ? `You specialise in ${data.expertise.join(", ")}.` : "",
      `Teach in a ${data.teaching_style} way. Humour ${data.humor_level}/5, seriousness ${data.seriousness}/5.`,
      "You are not a licensed professional. Never invent facts, figures, citations or user details — ask instead.",
    ]
      .filter(Boolean)
      .join(" ");

    const { data: created, error } = await context.supabase
      .from("custom_buddies")
      .insert({ ...data, user_id: context.userId, system_prompt: systemPrompt })
      .select("id")
      .maybeSingle();
    if (error || !created) throw new Error("Could not create that Buddy. Please try again.");

    await context.supabase
      .from("profiles")
      .update({ selected_custom_buddy_id: created.id, selected_buddy_slug: null })
      .eq("id", context.userId);
    return { id: created.id };
  });

export const deleteCustomBuddy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("custom_buddies").delete().eq("id", data.id);
    if (error) throw new Error("Could not delete that Buddy.");
    return { ok: true };
  });

export const addMemory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        key: z.string().min(1).max(120),
        value: z.string().min(1).max(1000),
        kind: z.enum(["preference", "context", "template", "workflow"]).default("preference"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    if (containsSensitive(data.key, data.value)) {
      return {
        ok: false as const,
        message:
          "I will not store that — it looks like a password, OTP, card or key. Buddy never keeps secrets.",
      };
    }
    const { error } = await context.supabase
      .from("memories")
      .insert({ ...data, user_id: context.userId, source: "user" });
    if (error) {
      const blocked = error.message.includes("sensitive_memory_blocked");
      return {
        ok: false as const,
        message: blocked
          ? "That looks sensitive, so I did not store it."
          : "Could not save that memory.",
      };
    }
    return { ok: true as const, message: "Saved." };
  });

export const deleteMemory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("memories").delete().eq("id", data.id);
    if (error) throw new Error("Could not forget that.");
    return { ok: true };
  });

export const clearMemory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { error } = await context.supabase
      .from("memories")
      .delete()
      .eq("user_id", context.userId);
    if (error) throw new Error("Could not clear your memory.");
    await context.supabase.rpc("write_audit", {
      _action: "memory_cleared",
      _target: "memory",
      _metadata: {},
    });
    return { ok: true };
  });

export const listTasks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: tasks } = await context.supabase
      .from("tasks")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    const ids = (tasks ?? []).map((t: { id: string }) => t.id);
    const { data: events } = ids.length
      ? await context.supabase
          .from("task_events")
          .select("task_id, phase, detail, created_at")
          .in("task_id", ids)
          .order("created_at", { ascending: true })
      : { data: [] };
    return { tasks: tasks ?? [], events: events ?? [] };
  });

export const getModelHubStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { MODEL_CATALOG, PROVIDERS } = await import("./ai/model-hub");
    const { verifyProviderConnection } = await import("./ai/provider-adapters.server");

    // Check baseline provider states
    const providerIds = Object.keys(PROVIDERS) as Array<keyof typeof PROVIDERS>;
    const statuses = await Promise.all(
      providerIds.map(async (id) => {
        // Quick check without external network lag for initial load
        let status: "connected" | "available_free" | "needs_key" | "offline" = "needs_key";
        let message = PROVIDERS[id].rateLimitNote;

        const isRealKey = (key?: string) =>
          Boolean(key && !key.startsWith("MY_") && !key.includes("your-key"));

        if (id === "gemini") {
          const { getGeminiKey } = await import("./ai/provider-keys.server");
          const key = getGeminiKey() ?? process.env["GEMINI_API_KEY"];
          status = isRealKey(key) ? "connected" : "needs_key";
          message =
            status === "connected"
              ? "Google Gemini is active via server key."
              : key?.startsWith("MY_")
                ? "GEMINI_API_KEY has placeholder value; configure in AI Model Hub."
                : "Requires GEMINI_API_KEY or user key in AI Model Hub.";
        } else if (id === "groq") {
          status = isRealKey(process.env["GROQ_API_KEY"]) ? "connected" : "available_free";
          message =
            status === "connected"
              ? "GroqCloud key configured on server."
              : "Free tier available with user key in AI Model Hub.";
        } else if (id === "openrouter") {
          status = isRealKey(process.env["OPENROUTER_API_KEY"]) ? "connected" : "available_free";
          message =
            status === "connected"
              ? "OpenRouter key active on server."
              : "Supports free and paid routing via AI Model Hub.";
        } else if (id === "openai") {
          status = isRealKey(process.env["OPENAI_API_KEY"]) ? "connected" : "needs_key";
          message =
            status === "connected"
              ? "OpenAI key active on server."
              : "Requires OpenAI API key (add in AI Model Hub).";
        } else if (id === "ollama") {
          status = "available_free";
          message = "Runs locally on your machine at localhost:11434.";
        } else if (id === "lovable-gateway") {
          status = isRealKey(process.env["LOVABLE_API_KEY"]) ? "connected" : "available_free";
          message = "Built-in fallback gateway route.";
        } else {
          status = "available_free";
        }

        return {
          providerId: id,
          config: PROVIDERS[id],
          status,
          message,
        };
      }),
    );

    return {
      providers: statuses,
      totalModels: MODEL_CATALOG.length,
      models: MODEL_CATALOG,
    };
  });

export const testProvider = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        providerId: z.string(),
        apiKey: z.string().optional(),
        baseUrl: z.string().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { verifyProviderConnection } = await import("./ai/provider-adapters.server");
    return await verifyProviderConnection(data.providerId as never, data.apiKey, data.baseUrl);
  });

export const askBuddy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        question: z.string().min(1).max(2000),
        preferredModel: z.string().max(100).optional(),
        snapshot: z.any().optional(),
        intent: z
          .enum(["explain_page", "locate_element", "answer", "plan", "summarize", "classify"])
          .default("answer"),
        userApiKey: z.string().max(200).optional(),
        customBaseUrl: z.string().max(300).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { ask } = await import("./buddy-service.server");
    const result = await ask(context.supabase, context.userId, {
      question: data.question,
      intent: data.intent,
      snapshot: (data.snapshot as never) ?? null,
      source: "web",
      preferredModel: data.preferredModel,
      userApiKey: data.userApiKey,
      customBaseUrl: data.customBaseUrl,
    });
    return {
      answer: result.reply.answer,
      confidence: result.reply.confidence,
      emotion: result.reply.emotion,
      needs: result.reply.needs,
      highlight: result.reply.highlight,
      highlightSelector: result.highlightSelector,
      buddyName: result.buddyName,
      model: result.model ?? null,
      activeProvider: result.activeProvider ?? null,
      blocked: result.blocked ?? false,
      fellBack: result.fellBack ?? false,
      aiFallbackUsed: result.aiFallbackUsed ?? false,
      providerWarning: result.providerWarning ?? null,
      providerFailure: result.providerFailure ?? null,
    };
  });

export const diagnose = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { ensureServerEnvLoaded, getProviderKey } = await import("./ai/provider-keys.server");
    ensureServerEnvLoaded();
    const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
    const configured: string[] = [];
    if (getProviderKey("gemini")) configured.push("Gemini");
    if (getProviderKey("groq")) configured.push("Groq");
    if (getProviderKey("openrouter")) configured.push("OpenRouter");
    if (getProviderKey("openai")) configured.push("OpenAI");
    if (getProviderKey("lovable-gateway")) configured.push("Lovable Gateway");

    const hasPlaceholder =
      process.env["GEMINI_API_KEY"]?.startsWith("MY_") ||
      process.env["GOOGLE_API_KEY"]?.startsWith("MY_") ||
      process.env["LOVABLE_API_KEY"]?.startsWith("MY_");

    checks.push({
      name: "AI provider",
      ok: configured.length > 0,
      detail:
        configured.length > 0
          ? `Server keys active (${configured.join(", ")})`
          : hasPlaceholder
            ? "Server has placeholder API key; enter key in AI Model Hub"
            : "No server keys configured; enter key in AI Model Hub",
    });
    const { error: dbError } = await context.supabase
      .from("profiles")
      .select("id")
      .eq("id", context.userId)
      .maybeSingle();
    checks.push({
      name: "Database",
      ok: !dbError,
      detail: dbError ? "Unreachable" : "Reachable",
    });
    const { data: perms } = await context.supabase
      .from("permission_settings")
      .select("level, privacy_mode")
      .eq("user_id", context.userId)
      .maybeSingle();
    checks.push({
      name: "Permissions",
      ok: Boolean(perms),
      detail: perms
        ? `Level ${perms.level}${perms.privacy_mode ? ", privacy mode on" : ""}`
        : "Not set",
    });
    const { data: failures } = await context.supabase
      .from("tasks")
      .select("id")
      .eq("status", "failed")
      .limit(5);
    checks.push({
      name: "Recent failures",
      ok: (failures?.length ?? 0) === 0,
      detail: `${failures?.length ?? 0} failed task(s) recently`,
    });
    return { checks, ok: checks.every((c) => c.ok) };
  });

type SerializablePrimitive = string | number | boolean | null;
type SerializableRow = Record<string, SerializablePrimitive>;

export interface SerializableDagSubtask {
  id: string;
  title: string;
  agentId: string;
  capabilityId: string;
  dependencies: string[];
  priority: number;
  retryLimit: number;
  retryCount: number;
  status: string;
  requiresApproval?: boolean;
  approved?: boolean;
  error?: string;
}

export interface SerializableDagRun {
  runId: string;
  userId: string;
  objective: string;
  status:
    | "planned"
    | "running"
    | "paused"
    | "awaiting_approval"
    | "completed"
    | "partially_completed"
    | "failed"
    | "cancelled";
  selectedAgents: string[];
  subtasks: SerializableDagSubtask[];
  checkpoints: Array<{
    checkpointId: string;
    runId: string;
    capturedAt: string;
    completedIds: string[];
    failedIds: string[];
    pendingIds: string[];
    awaitingApprovalIds: string[];
  }>;
  artifacts: Array<{
    id: string;
    kind: string;
    title: string;
    fileName?: string;
    downloadUrl?: string;
    summary?: string;
    verified?: boolean;
  }>;
  verifications: Array<{
    checkName: string;
    passed: boolean;
    detail: string;
    provenance: string;
  }>;
  replanCount: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  finalSummary?: string;
  unconfirmedStopNote?: string;
}

export interface SerializableWorkCenterOverview {
  agents: Array<{
    id: string;
    name: string;
    role: string;
    capabilities: string[];
    requiredPermission: string;
    supportsParallelExecution: boolean;
    requiresApprovalForSideEffects: boolean;
  }>;
  dagRuns: SerializableDagRun[];
  files: Array<{ fileName: string; sizeBytes: number; updatedAt: string }>;
  connectors: Array<{
    id: string;
    name: string;
    category: string;
    operational: boolean;
    status: string;
    requiredScopes: string[];
    missingRequirements: string[];
    supportsLiveHealthTest: boolean;
    requiresApprovalForWrites: boolean;
    documentationNotice: string;
    reconnectUrl?: string;
    lastCheckedAt: string;
  }>;
  connectorAuditLog: Array<{
    id: string;
    connectorId: string;
    action: string;
    status: string;
    detail: string;
    timestamp: string;
  }>;
  workflows: Array<{
    id: string;
    userId: string;
    name: string;
    description: string;
    triggerType: "cron" | "interval" | "one_time" | "event" | "manual";
    cronExpression?: string;
    intervalMinutes?: number;
    status: string;
    approvedByUser: boolean;
    runCount: number;
    createdAt: string;
    updatedAt: string;
    nextRunAt?: string;
  }>;
  workflowLogs: Array<{
    runId: string;
    workflowId: string;
    workflowName: string;
    triggerSource: string;
    status: string;
    summary: string;
    executedAt: string;
  }>;
  notifications: Array<{
    id: string;
    category: string;
    title: string;
    body: string;
    read: boolean;
    createdAt: string;
  }>;
  environmentNotice: string;
  suggestions: Array<{
    id: string;
    category: string;
    title: string;
    reason: string;
    recommendedAction: string;
    confidence: number;
    createdAt: string;
  }>;
  proactiveSuppressed: boolean;
  drafts: Array<{
    id: string;
    userId: string;
    channel: string;
    recipient: string;
    subject: string;
    body: string;
    status: string;
    createdAt: string;
  }>;
  memoriesV2: Array<{
    id: string;
    key: string;
    value: string;
    category?: string;
    scope?: string;
    updatedAt: string;
  }>;
  memoryConflicts: Array<{
    key: string;
    reason: string;
  }>;
  staleMemoryCount: number;
  optOut: {
    globalDontRemember: boolean;
    suppressedKeys: string[];
  };
}

export interface SerializableParsedWorkspaceDoc {
  fileName: string;
  format: string;
  sizeBytes: number;
  rows?: SerializableRow[];
  spreadsheetAnalysis?: { summary?: string };
  textContent?: string;
  warnings: string[];
}

export interface SerializableCompiledWorkflow {
  draftRecipe: {
    name: string;
    description: string;
    steps: Array<{
      id: string;
      action: string;
      description: string;
    }>;
  };
  triggerType: "cron" | "interval" | "one_time" | "event" | "manual";
  cronExpression?: string;
  missingParameters: string[];
  previewSummary: string;
}

export const getPhase4WorkCenterOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SerializableWorkCenterOverview> => {
    const { listSpecializedAgents } = await import("./agents/agent-registry");
    const { listPersistedWorkflows } = await import("./workflows/scheduler.server");
    const { MODULAR_CONNECTORS, getModularConnectorHealthSnapshot, listConnectorAuditTrail } =
      await import("./integrations/connectors");
    const { generateProactiveSuggestions } =
      await import("./engines/communication-proactive.server");
    const { detectMemoryConflicts, detectStaleMemories } = await import("./engines/memory-engine");
    const { listWorkspaceFiles, readScopedCollection } = await import("./persistence/store.server");

    const userId = context.userId;
    const [wfData, proactive, auditLog, files, dagRuns, memoriesV2, drafts, optOut] =
      await Promise.all([
        listPersistedWorkflows(userId),
        generateProactiveSuggestions({ userId }),
        listConnectorAuditTrail(userId),
        listWorkspaceFiles(userId),
        readScopedCollection(userId, "dag_runs", []),
        readScopedCollection(userId, "memories_v2", []),
        readScopedCollection(userId, "pending_drafts", []),
        readScopedCollection(userId, "memory_opt_outs", {
          globalDontRemember: false,
          suppressedKeys: [],
        }),
      ]);

    const connectorIds = Object.keys(MODULAR_CONNECTORS) as Array<keyof typeof MODULAR_CONNECTORS>;
    const connectors = connectorIds.map((id) => getModularConnectorHealthSnapshot(id));
    const memoryConflicts = detectMemoryConflicts(memoriesV2);
    const staleMemories = detectStaleMemories(memoriesV2);

    return {
      agents: listSpecializedAgents(),
      dagRuns: dagRuns as unknown as SerializableDagRun[],
      files,
      connectors,
      connectorAuditLog: auditLog as unknown as SerializableWorkCenterOverview["connectorAuditLog"],
      workflows: wfData.workflows as unknown as SerializableWorkCenterOverview["workflows"],
      workflowLogs: wfData.logs as unknown as SerializableWorkCenterOverview["workflowLogs"],
      notifications:
        wfData.notifications as unknown as SerializableWorkCenterOverview["notifications"],
      environmentNotice: wfData.environmentNotice,
      suggestions: proactive.suggestions,
      proactiveSuppressed: proactive.suppressed,
      drafts: drafts as unknown as SerializableWorkCenterOverview["drafts"],
      memoriesV2: memoriesV2 as unknown as SerializableWorkCenterOverview["memoriesV2"],
      memoryConflicts: memoryConflicts.map((c) => ({ key: c.key, reason: c.reason })),
      staleMemoryCount: staleMemories.length,
      optOut,
    };
  });

export const runWebMultiAgentObjective = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        objective: z.string().min(2).max(2000),
        fileName: z.string().optional(),
        rows: z.array(z.record(z.unknown())).optional(),
        comparisonFileName: z.string().optional(),
        comparisonRows: z.array(z.record(z.unknown())).optional(),
        outputFormats: z.array(z.enum(["xlsx", "docx", "pdf", "csv", "json"])).optional(),
        asyncMode: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<SerializableDagRun> => {
    const { buildObjectiveDagPlan, selectAgentsForObjective } =
      await import("./agents/agent-registry");
    const { executeAgentDag } = await import("./agents/dag-executor");
    const { createSpecializedSubtaskRunner } = await import("./agents/specialized-agents");
    const { updateScopedCollection } = await import("./persistence/store.server");

    const runId = `dag_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const selectedAgents = selectAgentsForObjective(data.objective, {
      hasFiles: Boolean(data.fileName),
      hasSpreadsheet: Boolean(data.rows?.length || /\.(xlsx|csv)$/i.test(data.fileName || "")),
      hasComparisonFiles: Boolean(data.comparisonRows?.length),
    });
    const subtasks = buildObjectiveDagPlan({
      runId,
      objective: data.objective,
      selectedAgents,
      fileName: data.fileName,
      comparisonFileName: data.comparisonFileName,
      outputFormats: data.outputFormats?.filter(
        (f): f is "xlsx" | "docx" | "pdf" => f === "xlsx" || f === "docx" || f === "pdf",
      ),
    });
    const runner = createSpecializedSubtaskRunner({
      userId: context.userId,
      objective: data.objective,
      rows: data.rows,
      comparisonRows: data.comparisonRows,
      fileName: data.fileName,
      comparisonFileName: data.comparisonFileName,
      outputFormats: data.outputFormats,
    });

    const persistState = async (state: import("./agents/types").AgentDagRunState) => {
      await updateScopedCollection<(typeof state)[]>(context.userId, "dag_runs", [], (runs) => {
        const idx = runs.findIndex((r) => r.runId === state.runId);
        if (idx >= 0) {
          const copy = [...runs];
          copy[idx] = state;
          return copy;
        }
        return [state, ...runs.slice(0, 29)];
      });
    };

    if (data.asyncMode) {
      const now = new Date().toISOString();
      const initialRun: import("./agents/types").AgentDagRunState = {
        runId,
        userId: context.userId,
        objective: data.objective,
        status: "running",
        selectedAgents,
        subtasks,
        checkpoints: [],
        artifacts: [],
        verifications: [],
        replanCount: 0,
        createdAt: now,
        updatedAt: now,
      };
      await persistState(initialRun);
      void executeAgentDag({
        runId,
        userId: context.userId,
        objective: data.objective,
        subtasks,
        runner,
        existingRunState: initialRun,
        onCheckpoint: persistState,
      }).catch(() => {});
      return initialRun as unknown as SerializableDagRun;
    }

    const result = await executeAgentDag({
      runId,
      userId: context.userId,
      objective: data.objective,
      subtasks,
      runner,
      onCheckpoint: persistState,
    });
    return result as unknown as SerializableDagRun;
  });

export const controlWebDagRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        runId: z.string().min(1),
        action: z.enum(["pause", "resume", "cancel", "retry_failed", "approve_step", "skip_step"]),
        subtaskId: z.string().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<SerializableDagRun> => {
    const { executeAgentDag, getDagController, skipDagSubtask } =
      await import("./agents/dag-executor");
    const { createSpecializedSubtaskRunner } = await import("./agents/specialized-agents");
    const { readScopedCollection, updateScopedCollection } =
      await import("./persistence/store.server");

    const runs = await readScopedCollection<Array<import("./agents/types").AgentDagRunState>>(
      context.userId,
      "dag_runs",
      [],
    );
    const existing = runs.find((r) => r.runId === data.runId);
    if (!existing) throw new Error("DAG run not found.");

    const persist = async (state: import("./agents/types").AgentDagRunState) => {
      await updateScopedCollection<typeof runs>(context.userId, "dag_runs", [], (list) =>
        list.map((r) => (r.runId === state.runId ? state : r)),
      );
    };

    const ctrl = getDagController(data.runId);
    if (data.action === "pause") {
      ctrl?.pause();
      existing.status = "paused";
      existing.updatedAt = new Date().toISOString();
      await persist(existing);
      return existing as unknown as SerializableDagRun;
    }
    if (data.action === "cancel") {
      ctrl?.cancel();
      if (existing.subtasks.some((s) => s.status === "running")) {
        existing.unconfirmedStopNote =
          "Cancelled while in-flight step(s) were active; external actions already dispatched cannot be rolled back automatically.";
      }
      existing.status = "cancelled";
      for (const st of existing.subtasks) {
        if (
          st.status === "pending" ||
          st.status === "ready" ||
          st.status === "paused" ||
          st.status === "awaiting_approval"
        ) {
          st.status = "cancelled";
        }
      }
      existing.updatedAt = new Date().toISOString();
      await persist(existing);
      return existing as unknown as SerializableDagRun;
    }
    if (data.action === "skip_step") {
      if (!data.subtaskId) {
        throw new Error("subtaskId is required for skip_step.");
      }
      const skipOutcome = ctrl
        ? ctrl.skipStep(data.subtaskId)
        : skipDagSubtask(existing, data.subtaskId);
      if (!skipOutcome.ok) {
        throw new Error(skipOutcome.reason || "Cannot skip this subtask.");
      }
      // Also mirror onto persisted copy if controller operated on a different reference
      if (ctrl) {
        const persistedTarget = existing.subtasks.find((s) => s.id === data.subtaskId);
        if (persistedTarget) {
          persistedTarget.status = "skipped";
          persistedTarget.error = "Skipped by user.";
        }
      }
      await persist(existing);
      if (skipOutcome.completedRun || existing.status !== "running") {
        return existing as unknown as SerializableDagRun;
      }
    }

    if (data.action === "retry_failed") {
      for (const st of existing.subtasks) {
        if (st.status === "failed") {
          st.status = "pending";
          st.retryCount = 0;
          st.error = undefined;
        }
      }
    } else if (data.action === "approve_step" && data.subtaskId) {
      ctrl?.approveStep(data.subtaskId);
      for (const st of existing.subtasks) {
        if (st.id === data.subtaskId) {
          st.approved = true;
          st.status = "pending";
        }
      }
    } else if (data.action === "resume") {
      ctrl?.resume();
      for (const st of existing.subtasks) {
        if (st.status === "paused") st.status = "pending";
      }
    }

    const runner = createSpecializedSubtaskRunner({
      userId: context.userId,
      objective: existing.objective,
    });
    const res = await executeAgentDag({
      runId: existing.runId,
      userId: context.userId,
      objective: existing.objective,
      subtasks: existing.subtasks,
      runner,
      existingRunState: existing,
      onCheckpoint: persist,
    });
    return res as unknown as SerializableDagRun;
  });

export const uploadAndAnalyzeWorkspaceFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        fileName: z.string().min(1),
        base64Data: z.string().min(1),
        mimeType: z.string().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<SerializableParsedWorkspaceDoc> => {
    const { parseWorkspaceBuffer } = await import("./workspace/file-processor.server");
    const { saveWorkspaceBinaryFile } = await import("./persistence/store.server");

    const buf = Buffer.from(data.base64Data.replace(/^data:[^;]+;base64,/, ""), "base64");
    const parsed = await parseWorkspaceBuffer({
      fileName: data.fileName,
      mimeType: data.mimeType,
      buffer: buf,
    });
    await saveWorkspaceBinaryFile(context.userId, data.fileName, buf);
    return {
      fileName: parsed.fileName,
      format: parsed.format,
      sizeBytes: parsed.sizeBytes,
      rows: parsed.rows as SerializableRow[] | undefined,
      spreadsheetAnalysis: parsed.spreadsheetAnalysis
        ? { summary: parsed.spreadsheetAnalysis.summary }
        : undefined,
      textContent: parsed.textContent,
      warnings: parsed.warnings,
    };
  });

export const generateWebReportArtifact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        format: z.enum(["xlsx", "docx", "pdf", "csv", "json"]),
        title: z.string().min(1).max(200),
        summary: z.string().optional(),
        rows: z.array(z.record(z.unknown())).optional(),
        sections: z
          .array(z.object({ heading: z.string(), bullets: z.array(z.string()) }))
          .optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { generateWorkspaceArtifact } = await import("./workspace/file-processor.server");
    const res = await generateWorkspaceArtifact({
      format: data.format,
      title: data.title,
      summary: data.summary,
      rows: data.rows,
      sections: data.sections,
      scopeId: context.userId,
    });
    return {
      fileName: res.fileName,
      format: res.format,
      sizeBytes: res.sizeBytes,
      verified: res.verified,
      verificationDetail: res.verificationDetail,
      base64Output: res.buffer.toString("base64"),
      mimeType: res.mimeType,
    };
  });

export type SerializableWorkflowActionResult =
  | { mode: "compile"; compiled: SerializableCompiledWorkflow }
  | { mode: "save"; workflow: SerializableWorkCenterOverview["workflows"][number] }
  | { mode: "run"; log: SerializableWorkCenterOverview["workflowLogs"][number] }
  | { mode: "toggle"; workflow: SerializableWorkCenterOverview["workflows"][number] | null }
  | { mode: "delete"; deleted: boolean };

export const compileOrSaveWebWorkflow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        mode: z.enum(["compile", "save", "run", "toggle", "delete"]),
        instruction: z.string().optional(),
        workflowId: z.string().optional(),
        name: z.string().optional(),
        description: z.string().optional(),
        triggerType: z.enum(["cron", "interval", "one_time", "event", "manual"]).optional(),
        cronExpression: z.string().optional(),
        steps: z.array(z.any()).optional(),
        approvedByUser: z.boolean().optional(),
        nextStatus: z.enum(["active", "paused"]).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<SerializableWorkflowActionResult> => {
    const { compileNaturalLanguageWorkflow } = await import("./engines/workflow-recipe-engine");
    const {
      deletePersistedWorkflow,
      runPersistedWorkflowNow,
      savePersistedWorkflow,
      updateWorkflowStatusOrFields,
    } = await import("./workflows/scheduler.server");

    if (data.mode === "compile") {
      return {
        mode: "compile",
        compiled: compileNaturalLanguageWorkflow(
          data.instruction || "",
        ) as unknown as SerializableCompiledWorkflow,
      };
    }
    if (data.mode === "save") {
      if (!data.approvedByUser) throw new Error("Explicit user confirmation is required.");
      const wf = await savePersistedWorkflow(context.userId, {
        id: data.workflowId || `wf_${Date.now().toString(36)}`,
        name: data.name || "Scheduled Workflow",
        description: data.description || "",
        triggerType: data.triggerType || "manual",
        cronExpression: data.cronExpression,
        steps: (data.steps || []) as never,
        status: "active",
        approvedByUser: true,
        retryLimit: 2,
      });
      return {
        mode: "save",
        workflow: wf as unknown as SerializableWorkCenterOverview["workflows"][number],
      };
    }
    if (data.mode === "run" && data.workflowId) {
      return {
        mode: "run",
        log: (await runPersistedWorkflowNow({
          userId: context.userId,
          workflowId: data.workflowId,
          triggerSource: "manual",
        })) as unknown as SerializableWorkCenterOverview["workflowLogs"][number],
      };
    }
    if (data.mode === "toggle" && data.workflowId && data.nextStatus) {
      return {
        mode: "toggle",
        workflow: (await updateWorkflowStatusOrFields(context.userId, data.workflowId, {
          status: data.nextStatus,
        })) as unknown as SerializableWorkCenterOverview["workflows"][number] | null,
      };
    }
    if (data.mode === "delete" && data.workflowId) {
      return {
        mode: "delete",
        deleted: await deletePersistedWorkflow(context.userId, data.workflowId),
      };
    }
    throw new Error("Unsupported workflow action.");
  });

export const testWebConnector = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        connectorId: z.enum([
          "gmail",
          "google_drive",
          "google_sheets",
          "google_calendar",
          "slack",
          "microsoft_excel",
          "github",
          "meesho_supplier",
        ]),
        userToken: z.string().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { testModularConnectorConnection } = await import("./integrations/connectors");
    return testModularConnectorConnection({
      connectorId: data.connectorId,
      userId: context.userId,
      userToken: data.userToken,
    });
  });

export const approveWebDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ draftId: z.string().min(1), confirmedByUser: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { sendApprovedDraft } = await import("./engines/communication-proactive.server");
    return sendApprovedDraft({
      userId: context.userId,
      draftId: data.draftId,
      confirmedByUser: data.confirmedByUser,
    });
  });
