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
  resolution?: string;
  userMessage: string;

  constructor(
    kind: AiErrorKind,
    userMessage: string,
    options: {
      retryable?: boolean;
      retryAfterSeconds?: number;
      resolution?: string;
      cause?: unknown;
    } = {},
  ) {
    super(`${kind}: ${userMessage}`);
    this.name = "AiError";
    this.kind = kind;
    this.userMessage = userMessage;
    this.retryable = options.retryable ?? false;
    if (options.resolution !== undefined) this.resolution = options.resolution;
    if (options.retryAfterSeconds !== undefined) {
      this.retryAfterSeconds = options.retryAfterSeconds;
    }
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

/** Map an AI gateway HTTP status onto a class we can act on. */
export function normalizeGatewayError(
  status: number,
  body: string,
  retryAfterHeader?: string | null,
): AiError {
  const retryAfter = retryAfterHeader ? Number(retryAfterHeader) : undefined;
  switch (status) {
    case 400:
      return new AiError("bad_request", "I could not process that request. Try rephrasing it.", {
        cause: body,
      });
    case 401:
      return new AiError("auth", "The AI service is not configured correctly on our side.", {
        cause: body,
      });
    case 402:
      return new AiError(
        "credits",
        "The AI allowance for this workspace is used up. Add credits to keep using Buddy.",
        { cause: body },
      );
    case 403:
      return new AiError("blocked", "AI access is currently blocked for this workspace.", {
        cause: body,
      });
    case 429:
      return new AiError("rate_limit", "Too many requests right now. I will slow down.", {
        retryable: true,
        ...(Number.isFinite(retryAfter) ? { retryAfterSeconds: retryAfter as number } : {}),
        cause: body,
      });
    default:
      if (status >= 500) {
        return new AiError("outage", "The AI service had a temporary problem.", {
          retryable: true,
          cause: body,
        });
      }
      return new AiError("invalid_response", "I got an unexpected reply from the AI service.", {
        cause: body,
      });
  }
}

/** Only these are worth trying another provider or another attempt for. */
export function isFallbackWorthy(error: AiError): boolean {
  return [
    "rate_limit",
    "outage",
    "timeout",
    "network",
    "invalid_response",
    "provider_error",
  ].includes(error.kind);
}
