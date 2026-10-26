import { describe, expect, it } from "vitest";
import {
  BUDDY_VISUALS,
  avatarVariant,
  buddyVisualId,
  avatarMotionEnabled,
} from "../src/lib/buddy-visuals";

describe("professional avatar registry", () => {
  for (const id of [
    "ca",
    "legal",
    "ecommerce",
    "developer",
    "business",
    "marketing",
    "research",
    "data",
    "content",
    "design",
  ] as const) {
    it(`preserves the ${id} professional identity`, () => {
      expect(buddyVisualId(id)).toBe(id);
      expect(BUDDY_VISUALS[id].image).toContain(`buddy-${id}-3d.webp`);
      expect(BUDDY_VISUALS[id].cue).not.toBe("none");
    });
  }
  it("uses the same base family for unknown and custom Buddies", () => {
    expect(buddyVisualId("unknown-custom-id")).toBe("general");
    expect(buddyVisualId("friendly")).toBe("general");
  });
  it("automatically falls back after a failed 3D image", () => {
    expect(avatarVariant("3d", true)).toBe("2d");
    expect(avatarVariant("auto", false)).toBe("3d");
  });
  it("uses the clean fallback in low graphics mode", () => {
    expect(avatarVariant("2d", false)).toBe("2d");
  });
  it("never animates for reduced-motion users", () => {
    expect(avatarMotionEnabled(true, true)).toBe(false);
    expect(avatarMotionEnabled(true, false)).toBe(true);
    expect(avatarMotionEnabled(false, false)).toBe(false);
  });
});
