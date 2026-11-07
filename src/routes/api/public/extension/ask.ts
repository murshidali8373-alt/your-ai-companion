/**
 * The extension's ask endpoint. Public by route prefix, so this handler owns its
 * security: bearer verification, body validation, permission gate (inside `ask`),
 * usage cap, and no error leakage.
 */

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { ask, askGuest } from "@/lib/buddy-service.server";
import { verifyBearer } from "@/lib/supabase-bearer.server";

const elementSchema = z.object({
  ref: z.string().max(24),
  role: z.string().max(24),
  name: z.string().max(300).default(""),
  tag: z.string().max(24).default(""),
  selector: z.string().max(400).default(""),
  value: z.string().max(300).optional(),
  placeholder: z.string().max(200).optional(),
  required: z.boolean().optional(),
  disabled: z.boolean().optional(),
  invalid: z.boolean().optional(),
  options: z.array(z.string().max(120)).max(40).optional(),
  level: z.number().optional(),
  sensitive: z.boolean().optional(),
});

const bodySchema = z.object({
  question: z.string().min(1).max(2000),
  intent: z
    .enum(["explain_page", "locate_element", "answer", "plan", "summarize", "classify"])
    .default("answer"),
  snapshot: z
    .object({
      url: z.string().max(2000),
      origin: z.string().max(300).default(""),
      title: z.string().max(400).default(""),
      capturedAt: z.string().max(40).default(""),
      headings: z.array(elementSchema).max(80).default([]),
      forms: z.array(elementSchema).max(120).default([]),
      controls: z.array(elementSchema).max(120).default([]),
      alerts: z.array(elementSchema).max(40).default([]),
      text: z.string().max(20000).default(""),
      truncated: z.boolean().default(false),
    })
    .passthrough()
    .nullable()
    .default(null),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(2000),
      }),
    )
    .max(10)
    .optional(),
  preferredModel: z.string().max(100).optional(),
  userApiKey: z.string().max(200).optional(),
  customBaseUrl: z.string().max(300).optional(),
  buddySlug: z.string().max(80).optional(),
  customBuddyId: z.string().max(80).optional(),
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

export const Route = createFileRoute("/api/public/extension/ask")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await verifyBearer(request.headers.get("authorization"));

        let parsed: z.infer<typeof bodySchema>;
        try {
          parsed = bodySchema.parse(await request.json());
        } catch {
          return json({ error: "bad_request", message: "That request was malformed." }, 400);
        }

        try {
          if (auth) {
            const result = await ask(auth.db, auth.userId, {
              question: parsed.question,
              intent: parsed.intent,
              snapshot: parsed.snapshot as never,
              source: "extension",
              history: parsed.history,
              preferredModel: parsed.preferredModel,
              userApiKey: parsed.userApiKey,
              customBaseUrl: parsed.customBaseUrl,
              buddySlug: parsed.buddySlug,
              customBuddyId: parsed.customBuddyId,
            });
            return json(result);
          } else {
            // Guest mode: unauthenticated users can still inspect pages and ask Buddy
            const result = await askGuest({
              question: parsed.question,
              intent: parsed.intent,
              snapshot: parsed.snapshot as never,
              source: "extension",
              history: parsed.history,
              preferredModel: parsed.preferredModel,
              userApiKey: parsed.userApiKey,
              customBaseUrl: parsed.customBaseUrl,
              buddySlug: parsed.buddySlug,
              customBuddyId: parsed.customBuddyId,
            });
            return json({ ...result, guest: true });
          }
        } catch (error) {
          console.error("[extension/ask]", error);
          return json(
            { error: "server_error", message: "Buddy could not finish that. Try again." },
            500,
          );
        }
      },
    },
  },
});
