/**
 * AI orchestrator — server only.
 *
 * Responsibilities: pick a model, call it, stream it (so long reasoning runs never
 * die on a request timeout), detect a stalled stream, normalise every failure, and
 * walk an ordered fallback chain with a hard attempt cap. No infinite retries.
 */

import { AiError, isFallbackWorthy, normalizeGatewayError, normalizeProviderError } from "./errors";
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

async function callOnce(
  model: ModelEntry,
  system: string,
  user: string,
  options?: { userApiKey?: string; customBaseUrl?: string },
): Promise<string> {
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
        userApiKey: options?.userApiKey,
        customBaseUrl: options?.customBaseUrl,
      });
    }

    if (!text.trim()) {
      throw new AiError("invalid_response", "The AI service returned an empty answer.", {
        retryable: true,
        provider: model.provider,
      });
    }
    return text;
  } catch (error) {
    if (error instanceof AiError) {
      if (!error.provider) error.provider = model.provider;
      throw error;
    }
    throw normalizeProviderError(error, model.provider);
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface ExecutionTraceStep {
  model: string;
  provider: string;
  error: string;
  kind: string;
}

/**
 * Run a request against the routed candidates. Tries at most MAX_ATTEMPTS times in
 * total across all eligible providers; handles authentication failures by failing over
 * to secondary providers, without wasting attempts on the same unconfigured provider.
 */
export async function generate(input: {
  system: string;
  user: string;
  routing: RouteRequest;
  /** Override the candidate list (used by tests and by explicit model choice). */
  candidates?: ModelEntry[];
  call?: (
    model: ModelEntry,
    system: string,
    user: string,
    options?: { userApiKey?: string; customBaseUrl?: string },
  ) => Promise<string>;
  userApiKey?: string;
  customBaseUrl?: string;
  userProvider?: string;
}): Promise<ModelCallResult> {
  const candidates = input.candidates ?? route(input.routing);
  const call = input.call ?? callOnce;
  // Exclude providers with no server key (unless the caller supplied their own key for it).
  const { isProviderConfigured } = await import("./provider-keys.server");
  const userKeyProvider = input.userApiKey
    ? (input.userProvider ?? candidates[0]?.provider)
    : undefined;
  const usable = (list: ModelEntry[]) =>
    input.call ? list : list.filter((m) => isProviderConfigured(m.provider, userKeyProvider));
  const pool = usable(candidates).length ? usable(candidates) : usable(MODELS);
  if (!pool.length) {
    throw new AiError("auth", "No AI provider is configured on the server.", {
      resolution: "Add GEMINI_API_KEY (or GOOGLE_API_KEY) in Project Settings → Secrets.",
    });
  }
  const started = Date.now();

  let attempts = 0;
  let lastError: AiError | undefined;
  const failedProviders = new Set<string>();
  const executionTrace: ExecutionTraceStep[] = [];
  const primaryProvider = input.userProvider ?? pool[0]?.provider;

  for (const model of pool) {
    if (attempts >= MAX_ATTEMPTS) break;

    // Skip candidate if this provider already failed with non-recoverable auth or balance error
    if (failedProviders.has(model.provider)) {
      continue;
    }

    attempts += 1;
    try {
      const isTargetProvider = !primaryProvider || model.provider === primaryProvider;
      const callOptions = isTargetProvider
        ? { userApiKey: input.userApiKey, customBaseUrl: input.customBaseUrl }
        : undefined;

      const text = await call(model, input.system, input.user, callOptions);
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
        error instanceof AiError ? error : normalizeProviderError(error, model.provider);

      if (!aiError.provider) aiError.provider = model.provider;
      lastError = aiError;

      executionTrace.push({
        model: model.id,
        provider: model.provider,
        error: aiError.userMessage,
        kind: aiError.kind,
      });

      // Avoid retrying subsequent models on the exact same provider if credentials failed
      if (aiError.kind === "auth" || aiError.kind === "credits") {
        failedProviders.add(model.provider);
      }

      if (!isFallbackWorthy(aiError)) throw aiError;
      if (aiError.kind === "rate_limit") {
        await sleep(Math.min((aiError.retryAfterSeconds ?? 1) * 1000, 5_000));
      }
    }
  }

  const finalError =
    lastError ??
    new AiError("outage", "No AI provider was available. Please try again in a moment.");
  (finalError as Error & { executionTrace?: ExecutionTraceStep[] }).executionTrace = executionTrace;
  throw finalError;
}
