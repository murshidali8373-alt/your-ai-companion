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
  const { data, error } = await publicClient()
    .from("buddies")
    .select(
      "slug, name, tagline, expertise, personality, teaching_style, humor_level, seriousness, default_language, accent_color, recommended_skills, sort_order",
    )
    .order("sort_order", { ascending: true });
  if (error) {
    console.error("[listBuddies]", error.message);
    return { buddies: [], error: "The Buddy list is temporarily unavailable." };
  }
  return { buddies: data ?? [], error: null as string | null };
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
          .select("id, title, status, intent, page_title, page_url, answer, error, model, created_at")
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
    await context.supabase.rpc("write_audit", { _action: "memory_cleared", _target: "memory", _metadata: {} });
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
    const ids = (tasks ?? []).map((t) => t.id);
    const { data: events } = ids.length
      ? await context.supabase
          .from("task_events")
          .select("task_id, phase, detail, created_at")
          .in("task_id", ids)
          .order("created_at", { ascending: true })
      : { data: [] };
    return { tasks: tasks ?? [], events: events ?? [] };
  });

export const askBuddy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ question: z.string().min(1).max(2000) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { ask } = await import("./buddy-service.server");
    const result = await ask(context.supabase, context.userId, {
      question: data.question,
      intent: "answer",
      snapshot: null,
      source: "web",
    });
    return {
      answer: result.reply.answer,
      confidence: result.reply.confidence,
      emotion: result.reply.emotion,
      needs: result.reply.needs,
      buddyName: result.buddyName,
      model: result.model ?? null,
      blocked: result.blocked ?? false,
    };
  });

export const diagnose = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
    checks.push({
      name: "AI provider",
      ok: Boolean(process.env["LOVABLE_API_KEY"]),
      detail: process.env["LOVABLE_API_KEY"] ? "Key configured" : "Key missing",
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
      detail: perms ? `Level ${perms.level}${perms.privacy_mode ? ", privacy mode on" : ""}` : "Not set",
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
