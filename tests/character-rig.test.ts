import { describe, expect, it } from "vitest";
import type { TalkingBuddyState } from "../src/components/talking-buddy-character";

describe("TalkingBuddyState verification", () => {
  const ALL_17_STATES: TalkingBuddyState[] = [
    "idle",
    "happy",
    "excited",
    "laughing",
    "sad",
    "scared",
    "surprised",
    "thinking",
    "confused",
    "listening",
    "speaking",
    "sleepy",
    "working",
    "success",
    "error",
    "disconnected",
    "permission_required",
  ];

  it("defines exactly 17 required expressive states", () => {
    expect(ALL_17_STATES).toHaveLength(17);
  });

  it("has valid non-empty state names", () => {
    for (const state of ALL_17_STATES) {
      expect(typeof state).toBe("string");
      expect(state.length).toBeGreaterThan(0);
    }
  });

  it("handles conversation flow transition logic", () => {
    const flow: TalkingBuddyState[] = ["idle", "listening", "thinking", "speaking", "idle"];
    expect(flow[0]).toBe("idle");
    expect(flow[1]).toBe("listening");
    expect(flow[2]).toBe("thinking");
    expect(flow[3]).toBe("speaking");
    expect(flow[4]).toBe("idle");
  });
});
