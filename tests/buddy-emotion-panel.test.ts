import { describe, expect, it } from "vitest";
import { normalizeBuddyEmotion, type BuddyEmotion } from "@/components/buddy-avatar";
import { ALL_EMOTIONS } from "@/components/buddy-emotion-control-panel";

describe("Buddy Emotion Control Panel & CSS Animation Rig", () => {
  it("normalizes and supports all required emotion states", () => {
    expect(normalizeBuddyEmotion("curious")).toBe("curious");
    expect(normalizeBuddyEmotion("confused")).toBe("curious");
    expect(normalizeBuddyEmotion("concerned")).toBe("concerned");
    expect(normalizeBuddyEmotion("sad")).toBe("concerned");
    expect(normalizeBuddyEmotion("error")).toBe("concerned");
    expect(normalizeBuddyEmotion("happy")).toBe("happy");
    expect(normalizeBuddyEmotion("thinking")).toBe("thinking");
    expect(normalizeBuddyEmotion("speaking")).toBe("speaking");
    expect(normalizeBuddyEmotion("listening")).toBe("listening");
    expect(normalizeBuddyEmotion("celebrate")).toBe("celebrate");
    expect(normalizeBuddyEmotion("sleepy")).toBe("sleepy");
    expect(normalizeBuddyEmotion("surprised")).toBe("surprised");
    expect(normalizeBuddyEmotion("idle")).toBe("neutral");
    expect(normalizeBuddyEmotion(undefined)).toBe("neutral");
  });

  it("contains complete metadata definitions for all 10 emotion states", () => {
    expect(ALL_EMOTIONS.length).toBe(10);
    const ids = ALL_EMOTIONS.map((e) => e.id);
    expect(ids).toContain("curious");
    expect(ids).toContain("concerned");
    expect(ids).toContain("happy");
    expect(ids).toContain("thinking");
    expect(ids).toContain("speaking");
    expect(ids).toContain("listening");
    expect(ids).toContain("celebrate");
    expect(ids).toContain("surprised");
    expect(ids).toContain("sleepy");
    expect(ids).toContain("neutral");
  });

  it("provides valid CSS keyframe references for each emotion", () => {
    const curious = ALL_EMOTIONS.find((e) => e.id === "curious");
    expect(curious).toBeDefined();
    expect(curious?.cssKeyframe).toContain("buddy-curious");
    expect(curious?.defaultDuration).toBe("1.6s");

    const concerned = ALL_EMOTIONS.find((e) => e.id === "concerned");
    expect(concerned).toBeDefined();
    expect(concerned?.cssKeyframe).toContain("buddy-concerned");
    expect(concerned?.defaultDuration).toBe("2.0s");

    const happy = ALL_EMOTIONS.find((e) => e.id === "happy");
    expect(happy).toBeDefined();
    expect(happy?.cssKeyframe).toContain("buddy-celebrate");
  });
});
