import { describe, expect, it } from "vitest";
import { useBuddyState, EMOTIONS, type Emotion } from "../src/hooks/useBuddyState";
import { normalizeBuddyEmotion } from "../src/components/buddy-avatar";

describe("useBuddyState hook and Emotion types", () => {
  it("defines all primary Emotion types and constants", () => {
    expect(EMOTIONS.IDLE).toBe("IDLE");
    expect(EMOTIONS.SPEAKING).toBe("SPEAKING");
    expect(EMOTIONS.THINKING).toBe("THINKING");
    expect(EMOTIONS.HAPPY).toBe("HAPPY");
    expect(EMOTIONS.SAD).toBe("SAD");
    expect(EMOTIONS.LISTENING).toBe("LISTENING");
    expect(EMOTIONS.WORKING).toBe("WORKING");
    expect(EMOTIONS.SUCCESS).toBe("SUCCESS");
    expect(EMOTIONS.ERROR).toBe("ERROR");
  });

  it("exports useBuddyState function", () => {
    expect(typeof useBuddyState).toBe("function");
  });

  it("normalizes Emotion values correctly for BuddyAvatar", () => {
    expect(normalizeBuddyEmotion("IDLE")).toBe("neutral");
    expect(normalizeBuddyEmotion("SPEAKING")).toBe("speaking");
    expect(normalizeBuddyEmotion("THINKING")).toBe("thinking");
    expect(normalizeBuddyEmotion("HAPPY")).toBe("happy");
    expect(normalizeBuddyEmotion("SAD")).toBe("concerned");
    expect(normalizeBuddyEmotion("ERROR")).toBe("concerned");
    expect(normalizeBuddyEmotion("SUCCESS")).toBe("celebrate");
  });

  it("allows setting typed emotions", () => {
    const emotion: Emotion = "SPEAKING";
    expect(emotion).toBe("SPEAKING");
    const thinkingEmotion: Emotion = "THINKING";
    expect(thinkingEmotion).toBe("THINKING");
  });
});
