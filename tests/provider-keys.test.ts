import { afterEach, describe, expect, it, vi } from "vitest";
import { getGeminiKey, isProviderConfigured } from "../src/lib/ai/provider-keys.server";

afterEach(() => vi.unstubAllEnvs());

describe("provider keys", () => {
  it("reads GOOGLE_API_KEY when GEMINI_API_KEY is absent", () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("GOOGLE_API_KEY", "real-google-key");
    expect(getGeminiKey()).toBe("real-google-key");
  });
  it("treats placeholder keys as not configured", () => {
    vi.stubEnv("GEMINI_API_KEY", "MY_GEMINI_KEY");
    vi.stubEnv("GOOGLE_API_KEY", "");
    expect(isProviderConfigured("gemini")).toBe(false);
  });
  it("excludes providers without a server key", () => {
    vi.stubEnv("GROQ_API_KEY", "");
    expect(isProviderConfigured("groq")).toBe(false);
    expect(isProviderConfigured("groq", "groq")).toBe(true);
  });
});
