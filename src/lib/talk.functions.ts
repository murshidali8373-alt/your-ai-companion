/**
 * Testing-only public talk endpoint: plain voice chat with the cheapest model.
 * No page context, no memory; input is bounded to keep cost low.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const quickTalk = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        text: z.string().trim().min(1).max(500),
        history: z
          .array(z.object({ role: z.enum(["user", "buddy"]), text: z.string().max(600) }))
          .max(6)
          .default([]),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { generate } = await import("./ai/orchestrator.server");
    const { AiError } = await import("./ai/errors");
    const convo = data.history.map((h) => `${h.role === "user" ? "User" : "Buddy"}: ${h.text}`).join("\n");
    try {
      const result = await generate({
        system:
          "You are AI Buddy, a warm, friendly voice companion. Reply in the same language the user speaks (English, Hindi or Hinglish in Latin script). Keep replies short: 1-3 spoken sentences, no markdown, no lists, no emojis.",
        user: `${convo ? convo + "\n" : ""}User: ${data.text}`,
        routing: {
          intent: "answer",
          needsVision: false,
          contextTokens: 800,
          latencySensitive: true,
          costSensitive: true,
        },
      });
      return { ok: true as const, reply: result.text.trim() };
    } catch (error) {
      const message =
        error instanceof AiError ? error.userMessage : "Something went wrong. Try once more.";
      return { ok: false as const, reply: message };
    }
  });
