/** Normalised AI failure classes. The UI never sees a raw provider error. */

export type AiErrorKind =
  | "bad_request"
  | "auth"
  | "credits"
  | "blocked"
  | "rate_limit"
  | "outage"
  | "timeout"
  | "invalid_response"
  | "network"
  | "provider_error";

export class AiError extends Error {
  kind: AiErrorKind;
  retryable: boolean;
  retryAfterSeconds?: number;
  userMessage: string;
  provider?: string;
  resolution?: string;

  constructor(
    kind: AiErrorKind,
    userMessage: string,
    options: {
      retryable?: boolean;
      retryAfterSeconds?: number;
      cause?: unknown;
      provider?: string;
      resolution?: string;
    } = {},
  ) {
    super(`${kind}: ${userMessage}`);
    this.name = "AiError";
    this.kind = kind;
    this.userMessage = userMessage;
    this.retryable = options.retryable ?? false;
    if (options.retryAfterSeconds !== undefined) {
      this.retryAfterSeconds = options.retryAfterSeconds;
    }
    if (options.provider !== undefined) {
      this.provider = options.provider;
    }
    if (options.resolution !== undefined) {
      this.resolution = options.resolution;
    }
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

/** Map an AI gateway HTTP status onto a class we can act on. */
export function normalizeGatewayError(
  status: number,
  body: string,
  retryAfterHeader?: string | null,
  provider = "gateway",
): AiError {
  const retryAfter = retryAfterHeader ? Number(retryAfterHeader) : undefined;
  switch (status) {
    case 400:
      return new AiError("bad_request", "I could not process that request. Try rephrasing it.", {
        cause: body,
        provider,
      });
    case 401:
      return new AiError("auth", "The AI service is not configured correctly on our side.", {
        cause: body,
        provider,
        resolution: "Check your provider API key or connection configuration in Settings.",
      });
    case 402:
      return new AiError(
        "credits",
        "The AI allowance for this workspace is used up. Add credits to keep using Buddy.",
        { cause: body, provider },
      );
    case 403:
      return new AiError("blocked", "AI access is currently blocked for this workspace.", {
        cause: body,
        provider,
      });
    case 429:
      return new AiError("rate_limit", "Too many requests right now. I will slow down.", {
        retryable: true,
        ...(Number.isFinite(retryAfter) ? { retryAfterSeconds: retryAfter as number } : {}),
        cause: body,
        provider,
      });
    default:
      if (status >= 500) {
        return new AiError("outage", "The AI service had a temporary problem.", {
          retryable: true,
          cause: body,
          provider,
        });
      }
      return new AiError("invalid_response", "I got an unexpected reply from the AI service.", {
        cause: body,
        provider,
      });
  }
}

/**
 * Normalise any caught exception (from Google GenAI SDK, fetch, or custom client)
 * into a typed AiError while preserving the original cause and provider identity.
 */
export function normalizeProviderError(error: unknown, provider?: string): AiError {
  if (error instanceof AiError) {
    if (provider && !error.provider) error.provider = provider;
    return error;
  }

  const msg = error instanceof Error ? error.message : String(error);
  const lower = msg.toLowerCase();

  // Authentication & Invalid Key Detection (Google GenAI API_KEY_INVALID, 401 Unauthorized, Forbidden)
  if (
    lower.includes("api key not valid") ||
    lower.includes("api_key_invalid") ||
    lower.includes("unauthorized") ||
    lower.includes("invalid api key") ||
    lower.includes("permission_denied") ||
    lower.includes("status 401") ||
    lower.includes("code 401")
  ) {
    return new AiError(
      "auth",
      `${provider ? `Provider "${provider}"` : "The AI service"} authentication failed. Check your API key.`,
      {
        cause: error,
        provider,
        resolution: "Provide a valid API key in Settings > AI Model Hub or server environment.",
      },
    );
  }

  // Rate Limits & Quota Exhaustion
  if (
    lower.includes("resource_exhausted") ||
    lower.includes("rate limit") ||
    lower.includes("quota exceeded") ||
    lower.includes("status 429") ||
    lower.includes("code 429")
  ) {
    return new AiError(
      "rate_limit",
      `${provider ? `Provider "${provider}"` : "The AI service"} rate limit reached.`,
      {
        retryable: true,
        cause: error,
        provider,
      },
    );
  }

  // Timeouts
  if (lower.includes("timeout") || lower.includes("timed out") || lower.includes("etimedout")) {
    return new AiError(
      "timeout",
      `${provider ? `Provider "${provider}"` : "The AI service"} timed out waiting for a response.`,
      {
        retryable: true,
        cause: error,
        provider,
      },
    );
  }

  // Network connection failures & DNS / local daemon offline
  if (
    lower.includes("econnrefused") ||
    lower.includes("failed to fetch") ||
    lower.includes("fetch failed") ||
    lower.includes("network")
  ) {
    return new AiError(
      "network",
      `Could not reach ${provider ? `provider "${provider}"` : "the AI service"}.`,
      {
        retryable: true,
        cause: error,
        provider,
        resolution:
          provider === "ollama"
            ? "Ensure local Ollama service is running on http://localhost:11434."
            : "Check your internet connection or network firewall.",
      },
    );
  }

  // Outage / Server 5xx
  if (
    lower.includes("500") ||
    lower.includes("502") ||
    lower.includes("503") ||
    lower.includes("504")
  ) {
    return new AiError(
      "outage",
      `${provider ? `Provider "${provider}"` : "The AI service"} is temporarily unavailable.`,
      {
        retryable: true,
        cause: error,
        provider,
      },
    );
  }

  return new AiError("network", `Unexpected error from ${provider || "AI service"}: ${msg}`, {
    retryable: true,
    cause: error,
    provider,
  });
}

/**
 * Determine if an error warrants attempting an alternative model or provider in the fallback chain.
 * Auth and credit failures ARE fallback-worthy across providers because a secondary provider
 * may have valid credentials or an active balance.
 */
export function isFallbackWorthy(error: AiError): boolean {
  return [
    "auth",
    "credits",
    "rate_limit",
    "outage",
    "timeout",
    "network",
    "invalid_response",
    "provider_error",
  ].includes(error.kind);
}
