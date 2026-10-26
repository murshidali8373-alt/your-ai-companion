import { describe, expect, it } from "vitest";
import {
  normalizeEmotion,
  BUDDY_EMOTION_STATES,
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
});
