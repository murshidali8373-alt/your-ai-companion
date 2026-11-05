/**
 * Server-only provider credential lookup. Never import from client code.
 * Gemini accepts either GEMINI_API_KEY or GOOGLE_API_KEY (Google AI Studio default name).
 */
import fs from "node:fs";

let envLoaded = false;
function loadServerEnvOnce() {
  if (envLoaded || process.env.VITEST) return;
  envLoaded = true;
  try {
    if (fs.existsSync(".env")) {
      const content = fs.readFileSync(".env", "utf-8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const idx = trimmed.indexOf("=");
        if (idx === -1) continue;
        const key = trimmed.slice(0, idx).trim();
        let val = trimmed.slice(idx + 1).trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        if (!isRealKey(process.env[key]) && isRealKey(val)) {
          process.env[key] = val;
        }
      }
    }
  } catch {
    // Ignore if not readable
  }
}

loadServerEnvOnce();

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
  loadServerEnvOnce();
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
