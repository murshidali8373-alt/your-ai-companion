/**
 * AI orchestrator — server only.
 *
 * Responsibilities: pick a model, call it, stream it (so long reasoning runs never
 * die on a request timeout), detect a stalled stream, normalise every failure, and
 * walk an ordered fallback chain with a hard attempt cap. No infinite retries.
 */

import { AiError, isFallbackWorthy, normalizeGatewayError } from "./errors";
import { MODELS, route, type ModelEntry, type RouteRequest } from "./registry";

const GATEWAY = "https://ai.gateway.lovable.dev/v1";

/** If no bytes arrive for this long the stream is considered stalled and cancelled. */
const STALL_MS = 45_000;
const MAX_ATTEMPTS = 3;

export interface ModelCallResult {
  text: string;
  model: string;
  provider: string;
  latencyMs: number;
  attempts: number;
  fellBack: boolean;
}

function apiKey(): string {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) {
    throw new AiError("auth", "The AI service is not configured on our side yet.");
  }
  return key;
}

/** Read an SSE body, applying an inactivity (not total-duration) guard. */
async function readEventStream(
  response: Response,
  onEvent: (event: Record<string, unknown>) => void,
): Promise<void> {
  const body = response.body;
  if (!body) throw new AiError("invalid_response", "The AI service sent an empty reply.");
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const timer = new Promise<"stalled">((resolve) =>
      setTimeout(() => resolve("stalled"), STALL_MS),
    );
    const next = await Promise.race([reader.read(), timer]);
    if (next === "stalled") {
      await reader.cancel().catch(() => undefined);
      throw new AiError("timeout", "The AI service stopped responding midway.", {
        retryable: true,
      });
    }
    if (next.done) break;
    buffer += decoder.decode(next.value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";
    for (const chunk of chunks) {
      for (const rawLine of chunk.split("\n")) {
        const line = rawLine.trim();
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          onEvent(JSON.parse(payload) as Record<string, unknown>);
        } catch {
          // A partial or non-JSON keep-alive frame: ignore it.
        }
      }
    }
  }
}

async function callResponses(model: ModelEntry, system: string, user: string): Promise<string> {
  const response = await fetch(`${GATEWAY}/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": apiKey(),
      "X-Lovable-AIG-SDK": "fetch",
    },
    body: JSON.stringify({
      model: model.id,
      instructions: system,
      input: user,
      stream: true,
      store: false,
      reasoning: { effort: model.reasoningEffort ?? "low", summary: "auto" },
    }),
  });

  if (!response.ok) {
    throw normalizeGatewayError(
      response.status,
      await response.text().catch(() => ""),
      response.headers.get("retry-after"),
    );
  }

  let text = "";
  await readEventStream(response, (event) => {
    if (event["type"] === "response.output_text.delta" && typeof event["delta"] === "string") {
      text += event["delta"];
    }
    if (event["type"] === "response.completed") {
      const payload = event["response"] as { output_text?: string } | undefined;
      if (!text && typeof payload?.output_text === "string") text = payload.output_text;
    }
  });
  return text;
}

async function callChat(model: ModelEntry, system: string, user: string): Promise<string> {
  const response = await fetch(`${GATEWAY}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": apiKey(),
      "X-Lovable-AIG-SDK": "fetch",
    },
    body: JSON.stringify({
      model: model.id,
      stream: true,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });

  if (!response.ok) {
    throw normalizeGatewayError(
      response.status,
      await response.text().catch(() => ""),
      response.headers.get("retry-after"),
    );
  }

  let text = "";
  await readEventStream(response, (event) => {
    const choices = event["choices"] as
      Array<{ delta?: { content?: string }; message?: { content?: string } }> | undefined;
    const delta = choices?.[0]?.delta?.content ?? choices?.[0]?.message?.content;
    if (typeof delta === "string") text += delta;
  });
  return text;
}

async function callGemini(model: ModelEntry, system: string, user: string): Promise<string> {
  const geminiKey = process.env["GEMINI_API_KEY"];
  if (!geminiKey) {
    throw new AiError("auth", "Gemini API key is not configured.");
  }
  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey: geminiKey });
  const modelId = model.id.includes("/") ? model.id.split("/")[1] || "gemini-3.8-flash" : model.id;
  const response = await ai.models.generateContent({
    model: modelId,
    contents: user,
    config: {
      systemInstruction: system,
    },
  });
  return response.text ?? "";
}

async function callOnce(model: ModelEntry, system: string, user: string): Promise<string> {
  try {
    let text = "";
    if (model.provider === "lovable-gateway") {
      if (model.api === "responses") {
        text = await callResponses(model, system, user);
      } else {
        text = await callChat(model, system, user);
      }
    } else {
      const { dispatchModelCall } = await import("./provider-adapters.server");
      const { findCatalogModel } = await import("./model-hub");
      const catalog = findCatalogModel(model.id) ?? {
        id: model.id,
        name: model.id,
        provider: model.provider,
        providerModelId: model.providerModelId || model.id,
        tier: "free" as const,
        contextWindow: model.contextTokens,
        capabilities: model.vision ? (["vision", "streaming"] as const) : (["streaming"] as const),
        speedRating: 4 as const,
        costRating: 1 as const,
        recommendedUse: "Dynamic catalog entry",
      };
      text = await dispatchModelCall(catalog as never, {
        systemPrompt: system,
        userPrompt: user,
      });
    }

    if (!text.trim()) {
      throw new AiError("invalid_response", "The AI service returned an empty answer.", {
        retryable: true,
      });
    }
    return text;
  } catch (error) {
    if (error instanceof AiError) throw error;
    throw new AiError("network", "I could not reach the AI service.", {
      retryable: true,
      cause: error,
    });
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run a request against the routed candidates. Tries at most MAX_ATTEMPTS times in
 * total across all providers; a terminal error (bad request, auth, credits, blocked)
 * stops immediately because retrying it returns the same failure.
 */
export async function generate(input: {
  system: string;
  user: string;
  routing: RouteRequest;
  /** Override the candidate list (used by tests and by explicit model choice). */
  candidates?: ModelEntry[] | undefined;
  call?: (model: ModelEntry, system: string, user: string) => Promise<string>;
}): Promise<ModelCallResult> {
  const candidates = input.candidates ?? route(input.routing);
  const call = input.call ?? callOnce;
  const pool = candidates.length ? candidates : MODELS;
  const started = Date.now();

  let attempts = 0;
  let lastError: AiError | undefined;

  for (const model of pool) {
    if (attempts >= MAX_ATTEMPTS) break;
    attempts += 1;
    try {
      const text = await call(model, input.system, input.user);
      return {
        text,
        model: model.id,
        provider: model.provider,
        latencyMs: Date.now() - started,
        attempts,
        fellBack: model !== pool[0],
      };
    } catch (error) {
      const aiError =
        error instanceof AiError
          ? error
          : new AiError("network", "I could not reach the AI service.", { cause: error });
      lastError = aiError;
      if (!isFallbackWorthy(aiError)) throw aiError;
      if (aiError.kind === "rate_limit") {
        await sleep(Math.min((aiError.retryAfterSeconds ?? 1) * 1000, 5_000));
      }
    }
  }

  throw (
    lastError ??
    new AiError("outage", "No AI provider was available. Please try again in a moment.")
  );
}
