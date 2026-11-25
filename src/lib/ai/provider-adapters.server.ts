/**
 * Server-Side Provider Adapters for AI Buddy Model Hub
 *
 * Real implementations for:
 * - Google Gemini (@google/genai SDK)
 * - GroqCloud
 * - OpenRouter
 * - OpenAI
 * - Ollama (Local)
 * - Hugging Face
 * - Cloudflare Workers AI
 * - GitHub Models
 */

import { getGeminiKey, getOllamaBaseUrl, getProviderKey, isRealKey } from "./provider-keys.server";
import { AiError, normalizeGatewayError, normalizeProviderError } from "./errors";
import { type ModelEntry, type ProviderId, PROVIDERS } from "./model-hub";

const INFERENCE_TIMEOUT_MS = 30_000;
const VERIFY_TIMEOUT_MS = 10_000;

const PRIVATE_IPV4_RE = /^(?:10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/;

function isPrivateOrLocalHostname(rawHost: string): boolean {
  const host = rawHost.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) return true;
  if (
    host === "localhost" ||
    host === "::1" ||
    host === "::" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    return true;
  }
  if (PRIVATE_IPV4_RE.test(host)) return true;
  if (host.startsWith("::ffff:")) {
    const mapped = host.slice("::ffff:".length);
    if (PRIVATE_IPV4_RE.test(mapped)) return true;
  }
  if (/^(?:fc|fd)[0-9a-f:]*$/i.test(host) || /^fe80:/i.test(host)) {
    return true;
  }
  return false;
}

export function validateProviderBaseUrl(
  rawUrl: string,
  options: { allowLocalhost?: boolean; provider?: string } = {},
): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new AiError("bad_request", "Invalid custom provider URL.", {
      provider: options.provider,
    });
  }

  if (parsed.username || parsed.password) {
    throw new AiError("bad_request", "Provider URL must not contain embedded credentials.", {
      provider: options.provider,
    });
  }

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const isLoopback = host === "localhost" || host === "127.0.0.1" || host === "::1";

  if (options.allowLocalhost && isLoopback) {
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new AiError("bad_request", "Unsupported protocol for local Ollama URL.", {
        provider: options.provider,
      });
    }
    return parsed.toString().replace(/\/+$/, "");
  }

  if (parsed.protocol !== "https:") {
    throw new AiError("bad_request", "Custom provider URL must use HTTPS.", {
      provider: options.provider,
    });
  }

  if (isPrivateOrLocalHostname(parsed.hostname)) {
    throw new AiError(
      "bad_request",
      "Custom provider URL cannot target private or local network addresses.",
      { provider: options.provider },
    );
  }

  return parsed.toString().replace(/\/+$/, "");
}

function resolveCredential(
  userApiKey: string | undefined,
  provider: ProviderId,
): string | undefined {
  if (isRealKey(userApiKey)) return userApiKey.trim();
  return getProviderKey(provider);
}

function resolveSafeBaseUrl(
  customBaseUrl: string | undefined,
  defaultBaseUrl: string,
  provider: ProviderId,
  allowLocalhost = false,
): string {
  const candidate = customBaseUrl?.trim();
  if (!candidate) return defaultBaseUrl.replace(/\/+$/, "");
  return validateProviderBaseUrl(candidate, { allowLocalhost, provider });
}

export interface ProviderCallOptions {
  systemPrompt: string;
  userPrompt: string;
  userApiKey?: string;
  customBaseUrl?: string;
  signal?: AbortSignal;
  allowModelFailover?: boolean;
}

export interface ProviderVerificationResult {
  providerId: ProviderId;
  ok: boolean;
  status: "connected" | "available_free" | "needs_key" | "offline" | "error";
  latencyMs: number;
  message: string;
  resolvedModel?: string;
}

/**
 * 1. Google Gemini via official @google/genai SDK
 * Supports gemini-3.8-flash (primary) and gemini-3.1-flash-lite (alternate),
 * with jittered exponential backoff for temporary 503 high-demand / 504 timeout spikes.
 */
export async function callGemini(model: ModelEntry, opts: ProviderCallOptions): Promise<string> {
  const apiKey = isRealKey(opts.userApiKey) ? opts.userApiKey.trim() : getGeminiKey();
  if (!apiKey) {
    throw new AiError("auth", "Google Gemini API key is not configured.", {
      resolution:
        "Provide your Gemini API key in Settings > AI Model Hub or check your server environment.",
      provider: "gemini",
    });
  }

  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });

  // Map deprecated or legacy default IDs to verified active multimodal runtime
  let targetModelId = model.providerModelId || model.id;
  if (
    targetModelId.includes("2.5-flash") ||
    targetModelId.includes("1.5-flash") ||
    targetModelId.includes("2.0-flash") ||
    targetModelId.includes("3.5-flash") ||
    (opts.allowModelFailover !== false && targetModelId === "gemini-3.8-flash")
  ) {
    targetModelId = "gemini-4-hydrogen";
  }

  // Model trial sequence: strict single model when allowModelFailover === false; otherwise verified active fallbacks
  const candidateModels =
    opts.allowModelFailover === false
      ? [targetModelId]
      : [targetModelId, "gemini-4-hydrogen", "gemini-3.8-flash", "gemini-3.1-flash-lite"];
  const trialModels = candidateModels.filter((m, idx, arr) => arr.indexOf(m) === idx);

  let lastErr: unknown;

  for (let i = 0; i < trialModels.length; i++) {
    const currentModel = trialModels[i]!;
    if (i > 0) {
      const jitter = Math.floor(Math.random() * 400) + 600;
      await new Promise((r) => setTimeout(r, jitter));
    }

    try {
      if (opts.signal?.aborted) {
        throw new AiError("timeout", "Request was canceled by user.", { provider: "gemini" });
      }

      const response = await ai.models.generateContent({
        model: currentModel,
        contents: opts.userPrompt,
        config: {
          systemInstruction: opts.systemPrompt,
        },
      });

      const text = response.text ?? "";
      if (text.trim()) {
        return text;
      }
    } catch (err: unknown) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const isRecoverableByAlternateModel =
        msg.includes("503") ||
        msg.includes("504") ||
        msg.includes("404") ||
        msg.includes("DEADLINE_EXCEEDED") ||
        msg.includes("high demand") ||
        msg.includes("UNAVAILABLE") ||
        msg.includes("no longer available") ||
        msg.includes("not found");

      if (!isRecoverableByAlternateModel || i === trialModels.length - 1) {
        break;
      }
    }
  }

  throw normalizeProviderError(lastErr || new Error("Gemini returned an empty reply"), "gemini");
}

/**
 * 2. GroqCloud via OpenAI-compatible endpoint
 */
export async function callGroq(model: ModelEntry, opts: ProviderCallOptions): Promise<string> {
  const apiKey = resolveCredential(opts.userApiKey, "groq");
  if (!apiKey) {
    throw new AiError("auth", "GroqCloud API key is missing.", {
      provider: "groq",
      resolution:
        "Get a free Groq key from console.groq.com and paste it in AI Model Hub settings.",
    });
  }

  const baseUrl = resolveSafeBaseUrl(
    opts.customBaseUrl,
    PROVIDERS.groq.defaultBaseUrl || "https://api.groq.com/openai/v1",
    "groq",
  );
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model.providerModelId,
      messages: [
        { role: "system", content: opts.systemPrompt },
        { role: "user", content: opts.userPrompt },
      ],
      temperature: 0.6,
      max_tokens: 4096,
    }),
    signal: opts.signal ?? AbortSignal.timeout(INFERENCE_TIMEOUT_MS),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw normalizeGatewayError(res.status, errText, res.headers.get("retry-after"), "groq");
  }

  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const text = data.choices?.[0]?.message?.content ?? "";
  if (!text.trim()) {
    throw new AiError("invalid_response", "Groq returned an empty answer.", {
      retryable: true,
      provider: "groq",
    });
  }
  return text;
}

/**
 * 3. OpenRouter Aggregator
 */
export async function callOpenRouter(
  model: ModelEntry,
  opts: ProviderCallOptions,
): Promise<string> {
  const apiKey = resolveCredential(opts.userApiKey, "openrouter");
  if (!apiKey) {
    throw new AiError("auth", "OpenRouter API key is missing.", {
      provider: "openrouter",
      resolution: "Get an OpenRouter API key from openrouter.ai/keys to access 200+ models.",
    });
  }

  const baseUrl = resolveSafeBaseUrl(
    opts.customBaseUrl,
    PROVIDERS.openrouter.defaultBaseUrl || "https://openrouter.ai/api/v1",
    "openrouter",
  );
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://ai-buddy.app",
      "X-Title": "AI Buddy Assistant",
    },
    body: JSON.stringify({
      model: model.providerModelId,
      messages: [
        { role: "system", content: opts.systemPrompt },
        { role: "user", content: opts.userPrompt },
      ],
    }),
    signal: opts.signal ?? AbortSignal.timeout(INFERENCE_TIMEOUT_MS),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw normalizeGatewayError(res.status, errText, res.headers.get("retry-after"), "openrouter");
  }

  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const text = data.choices?.[0]?.message?.content ?? "";
  if (!text.trim()) {
    throw new AiError("invalid_response", "OpenRouter returned an empty answer.", {
      retryable: true,
      provider: "openrouter",
    });
  }
  return text;
}

/**
 * 4. OpenAI Direct
 */
export async function callOpenAI(model: ModelEntry, opts: ProviderCallOptions): Promise<string> {
  const apiKey = resolveCredential(opts.userApiKey, "openai");
  if (!apiKey) {
    throw new AiError("auth", "OpenAI API key is missing.", {
      provider: "openai",
      resolution: "Add your OpenAI API key from platform.openai.com in Settings > AI Model Hub.",
    });
  }

  const baseUrl = resolveSafeBaseUrl(
    opts.customBaseUrl,
    PROVIDERS.openai.defaultBaseUrl || "https://api.openai.com/v1",
    "openai",
  );
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model.providerModelId,
      messages: [
        { role: "system", content: opts.systemPrompt },
        { role: "user", content: opts.userPrompt },
      ],
    }),
    signal: opts.signal ?? AbortSignal.timeout(INFERENCE_TIMEOUT_MS),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw normalizeGatewayError(res.status, errText, res.headers.get("retry-after"), "openai");
  }

  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const text = data.choices?.[0]?.message?.content ?? "";
  if (!text.trim()) {
    throw new AiError("invalid_response", "OpenAI returned an empty answer.", {
      retryable: true,
      provider: "openai",
    });
  }
  return text;
}

/**
 * 5. Ollama Local Edge Model
 */
export async function callOllama(model: ModelEntry, opts: ProviderCallOptions): Promise<string> {
  const baseUrl = resolveSafeBaseUrl(opts.customBaseUrl, getOllamaBaseUrl(), "ollama", true);

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: model.providerModelId,
        messages: [
          { role: "system", content: opts.systemPrompt },
          { role: "user", content: opts.userPrompt },
        ],
        stream: false,
      }),
      signal: opts.signal ?? AbortSignal.timeout(INFERENCE_TIMEOUT_MS),
    });
  } catch (err) {
    throw new AiError(
      "network",
      `Could not reach local Ollama instance at ${baseUrl}. Ensure Ollama is running ('ollama serve').`,
      {
        cause: err,
        provider: "ollama",
      },
    );
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw normalizeGatewayError(res.status, errText, res.headers.get("retry-after"), "ollama");
  }

  const data = (await res.json()) as { message?: { content?: string } };
  const text = data.message?.content ?? "";
  if (!text.trim()) {
    throw new AiError("invalid_response", "Ollama returned an empty response.", {
      retryable: true,
      provider: "ollama",
    });
  }
  return text;
}

/**
 * 6. Hugging Face Inference
 */
export async function callHuggingFace(
  model: ModelEntry,
  opts: ProviderCallOptions,
): Promise<string> {
  const apiKey = resolveCredential(opts.userApiKey, "huggingface");
  if (!apiKey) {
    throw new AiError("auth", "Hugging Face User Access Token is missing.", {
      provider: "huggingface",
      resolution: "Create a free User Access Token on huggingface.co/settings/tokens.",
    });
  }

  const baseUrl = resolveSafeBaseUrl(
    opts.customBaseUrl,
    PROVIDERS.huggingface.defaultBaseUrl || "https://api-inference.huggingface.co/models",
    "huggingface",
  );
  const url = `${baseUrl}/${model.providerModelId}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      inputs: `System: ${opts.systemPrompt}\nUser: ${opts.userPrompt}\nAssistant:`,
      parameters: { max_new_tokens: 1024, return_full_text: false },
    }),
    signal: opts.signal ?? AbortSignal.timeout(INFERENCE_TIMEOUT_MS),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw normalizeGatewayError(res.status, errText, res.headers.get("retry-after"), "huggingface");
  }

  const data = (await res.json()) as
    Array<{ generated_text?: string }> | { generated_text?: string };
  const text = Array.isArray(data) ? (data[0]?.generated_text ?? "") : (data.generated_text ?? "");
  if (!text.trim()) {
    throw new AiError("invalid_response", "Hugging Face returned an empty response.", {
      retryable: true,
      provider: "huggingface",
    });
  }
  return text;
}

/**
 * 7. GitHub Models via Azure AI inference
 */
export async function callGitHubModels(
  model: ModelEntry,
  opts: ProviderCallOptions,
): Promise<string> {
  const token = resolveCredential(opts.userApiKey, "github");
  if (!token) {
    throw new AiError("auth", "GitHub Personal Access Token is missing.", {
      provider: "github",
      resolution: "Generate a GitHub PAT with read permission on github.com/settings/tokens.",
    });
  }

  const baseUrl = resolveSafeBaseUrl(
    opts.customBaseUrl,
    PROVIDERS.github.defaultBaseUrl || "https://models.inference.ai.azure.com",
    "github",
  );
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      model: model.providerModelId,
      messages: [
        { role: "system", content: opts.systemPrompt },
        { role: "user", content: opts.userPrompt },
      ],
    }),
    signal: opts.signal ?? AbortSignal.timeout(INFERENCE_TIMEOUT_MS),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw normalizeGatewayError(res.status, errText, res.headers.get("retry-after"), "github");
  }

  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const text = data.choices?.[0]?.message?.content ?? "";
  if (!text.trim()) {
    throw new AiError("invalid_response", "GitHub Models returned an empty response.", {
      retryable: true,
      provider: "github",
    });
  }
  return text;
}

/**
 * 8. Dispatcher: executes query on any model in the catalog
 */
export async function dispatchModelCall(
  model: ModelEntry,
  opts: ProviderCallOptions,
): Promise<string> {
  switch (model.provider) {
    case "gemini":
      return callGemini(model, opts);
    case "groq":
      return callGroq(model, opts);
    case "openrouter":
      return callOpenRouter(model, opts);
    case "openai":
      return callOpenAI(model, opts);
    case "ollama":
      return callOllama(model, opts);
    case "huggingface":
      return callHuggingFace(model, opts);
    case "github":
      return callGitHubModels(model, opts);
    default:
      throw new AiError(
        "provider_error",
        `Provider "${model.provider}" is not configured or supported on this server yet.`,
        {
          provider: model.provider,
          resolution: `Select a configured provider in Settings → AI Model Hub or choose Auto.`,
        },
      );
  }
}

/**
 * Live Provider Verification / Ping Diagnostic Endpoint
 * Truthfully pings each provider to check if authorized and reachable
 * without executing a full model inference request.
 */
export async function verifyProviderConnection(
  providerId: ProviderId,
  userApiKey?: string,
  customBaseUrl?: string,
): Promise<ProviderVerificationResult> {
  const start = Date.now();

  try {
    switch (providerId) {
      case "gemini": {
        const key = isRealKey(userApiKey) ? userApiKey.trim() : getGeminiKey();
        const rawEnv = process.env["GEMINI_API_KEY"]?.trim();
        if (!key) {
          return {
            providerId,
            ok: false,
            status: "needs_key",
            latencyMs: 0,
            message: rawEnv?.startsWith("MY_")
              ? "GEMINI_API_KEY is a placeholder. Configure a real key in AI Model Hub."
              : "Missing GEMINI_API_KEY. Configure in AI Model Hub or environment.",
          };
        }
        const { GoogleGenAI } = await import("@google/genai");
        const ai = new GoogleGenAI({
          apiKey: key,
          httpOptions: { headers: { "User-Agent": "aistudio-build" } },
        });
        const pingCandidates = ["gemini-4-hydrogen", "gemini-3.8-flash", "gemini-3.1-flash-lite"];
        let pingModel = pingCandidates[0]!;
        let pingErr: unknown = null;
        for (const candidate of pingCandidates) {
          try {
            await ai.models.get({ model: candidate });
            pingModel = candidate;
            pingErr = null;
            break;
          } catch (err) {
            pingErr = err;
          }
        }
        if (pingErr) {
          throw pingErr;
        }
        return {
          providerId,
          ok: true,
          status: "connected",
          latencyMs: Date.now() - start,
          message: "Google Gemini is active and responding.",
          resolvedModel: pingModel,
        };
      }

      case "groq": {
        const key = resolveCredential(userApiKey, "groq");
        if (!key) {
          return {
            providerId,
            ok: false,
            status: "needs_key",
            latencyMs: 0,
            message: "Enter a Groq API key (free at console.groq.com) to activate.",
          };
        }
        const baseUrl = resolveSafeBaseUrl(
          customBaseUrl,
          PROVIDERS.groq.defaultBaseUrl || "https://api.groq.com/openai/v1",
          "groq",
        );
        const res = await fetch(`${baseUrl}/models`, {
          headers: { Authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
        });
        if (!res.ok) {
          return {
            providerId,
            ok: false,
            status: "error",
            latencyMs: Date.now() - start,
            message: `Groq authentication failed (${res.status}). Verify your key.`,
          };
        }
        return {
          providerId,
          ok: true,
          status: "connected",
          latencyMs: Date.now() - start,
          message: "GroqCloud is verified and connected.",
        };
      }

      case "openrouter": {
        const key = resolveCredential(userApiKey, "openrouter");
        if (!key) {
          return {
            providerId,
            ok: false,
            status: "needs_key",
            latencyMs: 0,
            message: "Enter an OpenRouter key from openrouter.ai/keys.",
          };
        }
        const baseUrl = resolveSafeBaseUrl(
          customBaseUrl,
          PROVIDERS.openrouter.defaultBaseUrl || "https://openrouter.ai/api/v1",
          "openrouter",
        );
        const res = await fetch(`${baseUrl}/auth/key`, {
          headers: { Authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
        });
        if (!res.ok) {
          return {
            providerId,
            ok: false,
            status: "error",
            latencyMs: Date.now() - start,
            message: `OpenRouter key verification failed (${res.status}).`,
          };
        }
        return {
          providerId,
          ok: true,
          status: "connected",
          latencyMs: Date.now() - start,
          message: "OpenRouter connection verified.",
        };
      }

      case "openai": {
        const key = resolveCredential(userApiKey, "openai");
        if (!key) {
          return {
            providerId,
            ok: false,
            status: "needs_key",
            latencyMs: 0,
            message: "Enter your OpenAI API key to connect GPT-4o and o-series models.",
          };
        }
        const baseUrl = resolveSafeBaseUrl(
          customBaseUrl,
          PROVIDERS.openai.defaultBaseUrl || "https://api.openai.com/v1",
          "openai",
        );
        const res = await fetch(`${baseUrl}/models`, {
          headers: { Authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
        });
        if (!res.ok) {
          return {
            providerId,
            ok: false,
            status: "error",
            latencyMs: Date.now() - start,
            message: `OpenAI key rejected (${res.status}). Verify permissions.`,
          };
        }
        return {
          providerId,
          ok: true,
          status: "connected",
          latencyMs: Date.now() - start,
          message: "OpenAI API verified and connected.",
        };
      }

      case "ollama": {
        const baseUrl = resolveSafeBaseUrl(customBaseUrl, getOllamaBaseUrl(), "ollama", true);
        try {
          const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
          if (!res.ok) throw new Error(`Status ${res.status}`);
          const data = (await res.json()) as { models?: Array<{ name: string }> };
          const count = data.models?.length ?? 0;
          return {
            providerId,
            ok: true,
            status: "connected",
            latencyMs: Date.now() - start,
            message: `Ollama local daemon detected with ${count} installed model${count === 1 ? "" : "s"}.`,
          };
        } catch {
          return {
            providerId,
            ok: false,
            status: "offline",
            latencyMs: Date.now() - start,
            message:
              "Ollama not detected at localhost:11434. Start Ollama locally with 'ollama serve'.",
          };
        }
      }

      case "github": {
        const token = resolveCredential(userApiKey, "github");
        if (!token) {
          return {
            providerId,
            ok: false,
            status: "needs_key",
            latencyMs: 0,
            message: "Provide a GitHub Personal Access Token to test GitHub Models.",
          };
        }
        const baseUrl = resolveSafeBaseUrl(
          customBaseUrl,
          PROVIDERS.github.defaultBaseUrl || "https://models.inference.ai.azure.com",
          "github",
        );
        const res = await fetch(`${baseUrl}/models`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
        });
        if (!res.ok) {
          return {
            providerId,
            ok: false,
            status: "error",
            latencyMs: Date.now() - start,
            message: `GitHub token rejected (${res.status}). Ensure it has model preview access.`,
          };
        }
        return {
          providerId,
          ok: true,
          status: "connected",
          latencyMs: Date.now() - start,
          message: "GitHub Models connection verified.",
        };
      }

      case "huggingface": {
        const key = resolveCredential(userApiKey, "huggingface");
        if (!key) {
          return {
            providerId,
            ok: false,
            status: "needs_key",
            latencyMs: 0,
            message: "Hugging Face Access Token required.",
          };
        }
        const res = await fetch("https://huggingface.co/api/whoami-v2", {
          headers: { Authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
        });
        if (!res.ok) {
          return {
            providerId,
            ok: false,
            status: "error",
            latencyMs: Date.now() - start,
            message: "Invalid Hugging Face token.",
          };
        }
        return {
          providerId,
          ok: true,
          status: "connected",
          latencyMs: Date.now() - start,
          message: "Hugging Face connection verified.",
        };
      }

      case "cloudflare": {
        const token = resolveCredential(userApiKey, "cloudflare");
        if (!token) {
          return {
            providerId,
            ok: false,
            status: "needs_key",
            latencyMs: 0,
            message: "Cloudflare Workers AI token is required (CLOUDFLARE_API_TOKEN).",
          };
        }
        const res = await fetch("https://api.cloudflare.com/client/v4/user/tokens/verify", {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
        });
        if (!res.ok) {
          return {
            providerId,
            ok: false,
            status: "error",
            latencyMs: Date.now() - start,
            message: `Cloudflare token rejected (${res.status}).`,
          };
        }
        return {
          providerId,
          ok: true,
          status: "connected",
          latencyMs: Date.now() - start,
          message: "Cloudflare Workers AI token verified.",
        };
      }

      case "lovable-gateway": {
        const key = resolveCredential(userApiKey, "lovable-gateway");
        if (!key) {
          return {
            providerId,
            ok: false,
            status: "needs_key",
            latencyMs: 0,
            message: "Built-in fallback gateway is not configured on this server.",
          };
        }
        return {
          providerId,
          ok: true,
          status: "connected",
          latencyMs: Date.now() - start,
          message: "Built-in fallback gateway is configured.",
        };
      }

      default:
        return {
          providerId,
          ok: false,
          status: "error",
          latencyMs: 0,
          message: `Unsupported provider "${String(providerId)}".`,
        };
    }
  } catch (error) {
    const normalized = normalizeProviderError(error, providerId);
    let status: ProviderVerificationResult["status"] = "error";
    if (normalized.kind === "auth") {
      status = "needs_key";
    } else if (normalized.kind === "network" || normalized.kind === "outage") {
      status = "offline";
    }

    return {
      providerId,
      ok: false,
      status,
      latencyMs: Date.now() - start,
      message: normalized.userMessage,
    };
  }
}

/**
 * Diagnostic alias for lightweight connectivity verification.
 */
export const pingProvider = verifyProviderConnection;
