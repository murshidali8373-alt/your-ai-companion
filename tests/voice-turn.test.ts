import { describe, expect, it } from "vitest";

import {
  endpointDelayMs,
  isFillerOnly,
  shouldCommit,
  stripSpokenFiller,
  transition,
} from "../src/shared/voice-turn";

describe("filler detection", () => {
  it("ignores filler-only utterances", () => {
    for (const t of ["hmm", "Haan?", "uh umm", "aaa", "", "okay"]) expect(isFillerOnly(t)).toBe(true);
  });
  it("keeps real requests", () => {
    expect(isFillerOnly("hmm explain this page")).toBe(false);
    expect(isFillerOnly("GSTIN kahan dalna hai")).toBe(false);
  });
});

describe("endpointing", () => {
  it("waits ~1.5s", () => {
    expect(endpointDelayMs("open youtube")).toBe(1500);
    expect(shouldCommit("open youtube", 800, true)).toBe(false);
    expect(shouldCommit("open youtube", 1600, true)).toBe(true);
  });
  it("never commits filler", () => {
    expect(shouldCommit("hmm", 5000, true)).toBe(false);
  });
  it("is more patient with long speech", () => {
    const long = "please explain what this form wants from me and where the gst number goes";
    expect(endpointDelayMs(long)).toBe(2000);
    expect(shouldCommit(long, 1600, true)).toBe(false);
  });
});

describe("state machine", () => {
  it("follows the happy path", () => {
    let s = transition("IDLE", "START_LISTENING");
    s = transition(s, "COMMIT");
    s = transition(s, "MODEL_START");
    s = transition(s, "REPLY");
    expect(s).toBe("SPEAKING");
    expect(transition(s, "TTS_END")).toBe("IDLE");
  });
  it("barges in on speech while speaking", () => {
    expect(transition("SPEAKING", "USER_SPEECH")).toBe("LISTENING");
  });
  it("stop always returns to idle", () => {
    expect(transition("EXECUTING", "STOP")).toBe("IDLE");
  });
  it("ignores invalid events", () => {
    expect(transition("IDLE", "CONFIRMED")).toBe("IDLE");
  });
});

it("strips spoken filler", () => {
  expect(stripSpokenFiller("Hmm, okay okay. The GSTIN box is on the right.")).toBe(
    "The GSTIN box is on the right.",
  );
  expect(stripSpokenFiller("Got it. Click Save.")).toBe("Click Save.");
});
