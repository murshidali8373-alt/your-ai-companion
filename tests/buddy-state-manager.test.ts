import { describe, expect, it } from "vitest";
import {
  normalizeEmotion,
  BUDDY_EMOTION_STATES,
  BUDDY_CHARACTERS,
  useBuddyStateManager,
  BuddyStateManager,
  useBuddyState,
  BuddyStateProvider,
} from "../src/hooks/use-buddy-state-manager";

describe("BuddyStateManager & normalizeEmotion", () => {
  it("normalizes standard uppercase and lowercase states", () => {
    expect(normalizeEmotion("IDLE")).toBe("idle");
    expect(normalizeEmotion("SPEAKING")).toBe("speaking");
    expect(normalizeEmotion("THINKING")).toBe("thinking");
    expect(normalizeEmotion("LISTENING")).toBe("listening");
    expect(normalizeEmotion("HAPPY")).toBe("happy");
    expect(normalizeEmotion("EXCITED")).toBe("excited");
    expect(normalizeEmotion("LAUGHING")).toBe("laughing");
    expect(normalizeEmotion("SAD")).toBe("sad");
    expect(normalizeEmotion("SCARED")).toBe("scared");
    expect(normalizeEmotion("SURPRISED")).toBe("surprised");
    expect(normalizeEmotion("CONFUSED")).toBe("confused");
    expect(normalizeEmotion("SLEEPY")).toBe("sleepy");
    expect(normalizeEmotion("WORKING")).toBe("working");
    expect(normalizeEmotion("SUCCESS")).toBe("success");
    expect(normalizeEmotion("ERROR")).toBe("error");
    expect(normalizeEmotion("DISCONNECTED")).toBe("disconnected");
    expect(normalizeEmotion("PERMISSION_REQUIRED")).toBe("permission_required");
  });

  it("handles aliases and common variations gracefully", () => {
    expect(normalizeEmotion("neutral")).toBe("idle");
    expect(normalizeEmotion("curious")).toBe("confused");
    expect(normalizeEmotion("celebrate")).toBe("success");
    expect(normalizeEmotion("concerned")).toBe("error");
    expect(normalizeEmotion("task")).toBe("working");
    expect(normalizeEmotion("confirm")).toBe("permission_required");
    expect(normalizeEmotion("giggle")).toBe("laughing");
  });

  it("fallbacks to idle for unknown inputs", () => {
    expect(normalizeEmotion("")).toBe("idle");
    expect(normalizeEmotion("unknown_state")).toBe("idle");
  });

  it("exposes all canonical state constants in BUDDY_EMOTION_STATES", () => {
    expect(BUDDY_EMOTION_STATES.IDLE).toBe("idle");
    expect(BUDDY_EMOTION_STATES.THINKING).toBe("thinking");
    expect(BUDDY_EMOTION_STATES.SPEAKING).toBe("speaking");
    expect(BUDDY_EMOTION_STATES.LISTENING).toBe("listening");
    expect(BUDDY_EMOTION_STATES.WORKING).toBe("working");
    expect(BUDDY_EMOTION_STATES.SUCCESS).toBe("success");
    expect(BUDDY_EMOTION_STATES.ERROR).toBe("error");
    expect(BUDDY_EMOTION_STATES.HAPPY).toBe("happy");
    expect(BUDDY_EMOTION_STATES.EXCITED).toBe("excited");
    expect(BUDDY_EMOTION_STATES.CONFUSED).toBe("confused");
    expect(BUDDY_EMOTION_STATES.SLEEPY).toBe("sleepy");
    expect(BUDDY_EMOTION_STATES.SAD).toBe("sad");
    expect(BUDDY_EMOTION_STATES.SCARED).toBe("scared");
    expect(BUDDY_EMOTION_STATES.SURPRISED).toBe("surprised");
    expect(BUDDY_EMOTION_STATES.LAUGHING).toBe("laughing");
    expect(BUDDY_EMOTION_STATES.DISCONNECTED).toBe("disconnected");
    expect(BUDDY_EMOTION_STATES.PERMISSION_REQUIRED).toBe("permission_required");
  });

  it("exports BuddyStateManager hook matching user specification", () => {
    expect(typeof BuddyStateManager).toBe("function");
    expect(typeof useBuddyStateManager).toBe("function");
    expect(typeof useBuddyState).toBe("function");
    expect(typeof BuddyStateProvider).toBe("function");
  });

  it("synchronizes all 16 active characters (15 specialists + 1 Custom Buddy)", () => {
    expect(BUDDY_CHARACTERS).toBeDefined();
    expect(BUDDY_CHARACTERS.length).toBe(16);

    const slugs = BUDDY_CHARACTERS.map((b) => b.slug);
    // 15 canonical specialists
    expect(slugs).toContain("friendly");
    expect(slugs).toContain("developer");
    expect(slugs).toContain("ca");
    expect(slugs).toContain("legal");
    expect(slugs).toContain("ecommerce");
    expect(slugs).toContain("business");
    expect(slugs).toContain("marketing");
    expect(slugs).toContain("research");
    expect(slugs).toContain("data");
    expect(slugs).toContain("content");
    expect(slugs).toContain("design");
    expect(slugs).toContain("operations");
    expect(slugs).toContain("professor");
    expect(slugs).toContain("dadaji");
    expect(slugs).toContain("detective");
    // 1 Custom Buddy
    expect(slugs).toContain("custom:user_custom_buddy_1");

    // Check custom buddy structure
    const custom = BUDDY_CHARACTERS.find((b) => b.isCustom);
    expect(custom).toBeDefined();
    expect(custom?.isCustom).toBe(true);
    expect(custom?.name).toBe("My Custom Buddy");
    expect(custom?.id).toBe("user_custom_buddy_1");
  });

  it("guarantees every character contains required visuals and metadata", () => {
    BUDDY_CHARACTERS.forEach((char) => {
      expect(char.slug).toBeTruthy();
      expect(char.name).toBeTruthy();
      expect(char.tagline).toBeTruthy();
      expect(Array.isArray(char.expertise)).toBe(true);
      expect(char.expertise.length).toBeGreaterThan(0);
      expect(char.outfit).toBeTruthy();
      expect(char.outfitColors.length).toBe(2);
      expect(char.image).toBeTruthy();
      expect(typeof char.isCustom).toBe("boolean");
    });
  });

  it("safely resolves characters by slug or id and handles fallbacks without ReferenceError", () => {
    const list = BUDDY_CHARACTERS;
    const fallback = list[0];

    // Slug match
    const developer = list.find((b) => b.slug === "developer" || b.id === "developer");
    expect(developer).toBeDefined();
    expect(developer?.name).toBe("Developer Buddy");

    // Custom id match
    const custom = list.find(
      (b) => b.slug === "user_custom_buddy_1" || b.id === "user_custom_buddy_1",
    );
    expect(custom).toBeDefined();
    expect(custom?.name).toBe("My Custom Buddy");

    // Non-existent slug returns undefined, falling back cleanly
    const nonExistent = list.find((b) => b.slug === "non-existent" || b.id === "non-existent");
    expect(nonExistent).toBeUndefined();
    const resolved = nonExistent || list[0] || fallback;
    expect(resolved).toBe(fallback);
  });
});
