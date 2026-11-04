/**
 * Server-only provider credential lookup. Never import from client code.
 * Gemini accepts either GEMINI_API_KEY or GOOGLE_API_KEY (Google AI Studio default name).
 */
const ENV_KEYS: Record<string, string[]> = {
  gemini: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
  groq: ["GROQ_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  "lovable-gateway": ["LOVABLE_API_KEY"],
};

export function isRealKey(key?: string | null): key is string {
  return Boolean(key && !key.startsWith("MY_") && !key.includes("your-key"));
}

export function getProviderKey(provider: string): string | undefined {
  for (const name of ENV_KEYS[provider] ?? []) {
    const v = process.env[name];
    if (isRealKey(v)) return v;
  }
  return undefined;
}

export function getGeminiKey(): string | undefined {
  return getProviderKey("gemini");
}

/** Providers without a known env mapping (e.g. local/custom) are treated as configured. */
export function isProviderConfigured(provider: string, userKeyProvider?: string): boolean {
  if (userKeyProvider && userKeyProvider === provider) return true;
  if (!(provider in ENV_KEYS)) return true;
  return Boolean(getProviderKey(provider));
}
