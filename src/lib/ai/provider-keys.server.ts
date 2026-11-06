/**
 * Server-only provider credential lookup. Never import from client code.
 * Gemini accepts either GEMINI_API_KEY or GOOGLE_API_KEY (Google AI Studio default name).
 */

const ENV_KEYS: Record<string, string[]> = {
  gemini: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
  groq: ["GROQ_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  github: ["GITHUB_TOKEN"],
  cloudflare: ["CLOUDFLARE_API_TOKEN"],
  huggingface: ["HUGGINGFACE_API_KEY"],
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

/** Providers with env mappings must have valid keys; ollama requires explicit host env. */
export function isProviderConfigured(provider: string, userKeyProvider?: string): boolean {
  if (userKeyProvider && userKeyProvider === provider) return true;
  if (provider === "ollama") {
    return Boolean(process.env["OLLAMA_BASE_URL"] || process.env["OLLAMA_ENABLED"] === "true");
  }
  if (!(provider in ENV_KEYS)) return false;
  return Boolean(getProviderKey(provider));
}
