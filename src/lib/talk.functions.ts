/**
 * Public talk endpoint: powers real-time voice and text chat with AI Buddy.
 * Seamlessly injects active Buddy persona and routes to Gemini backend.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const quickTalk = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        text: z.string().trim().min(1).max(2000),
        buddySlug: z.string().max(60).optional(),
        preferredModel: z.string().max(100).optional(),
        history: z
          .array(z.object({ role: z.enum(["user", "buddy"]), text: z.string().max(2000) }))
          .max(20)
          .default([]),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    // Ensure server-side env vars are loaded
    if (typeof process.loadEnvFile === "function") {
      try {
        process.loadEnvFile(".env");
      } catch {
        // Environment variables already present in runtime
      }
    }

    const { generate } = await import("./ai/orchestrator.server");
    const { AiError } = await import("./ai/errors");
    const { getBuddyPreset, buildBuddySystemPrompt } = await import("./ai/buddy-personas");
    const { findModel } = await import("./ai/registry");

    const persona = getBuddyPreset(data.buddySlug);
    const systemPrompt = buildBuddySystemPrompt(persona, {
      isVoice: true,
      providerDisclosure: "Google Gemini",
    });

    const convo = data.history
      .map((h) => `${h.role === "user" ? "User" : persona.name}: ${h.text}`)
      .join("\n");

    try {
      const candidates = data.preferredModel
        ? [findModel(data.preferredModel)!].filter(Boolean)
        : undefined;

      const result = await generate({
        system: systemPrompt,
        user: `${convo ? convo + "\n" : ""}User: ${data.text}`,
        routing: {
          intent: "answer",
          needsVision: false,
          contextTokens: 1200,
          latencySensitive: true,
          costSensitive: true,
        },
        candidates,
      });

      return {
        ok: true as const,
        reply: result.text.trim(),
        model: result.model,
        provider: result.provider,
        buddyName: persona.name,
      };
    } catch (error) {
      const message =
        error instanceof AiError ? error.userMessage : "Something went wrong. Try once more.";
      return { ok: false as const, reply: message, buddyName: persona.name };
    }
  });
