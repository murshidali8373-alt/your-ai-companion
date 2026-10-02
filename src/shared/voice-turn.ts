/**
 * Voice turn-taking rules from the master spec (§4, §5), as pure logic so the web
 * app, extension side panel and future Android client share one implementation.
 *
 * - Commit an utterance only after ~1.5 s of silence (adaptive for long speech).
 * - Filler-only utterances ("hmm", "haan", "uh") never trigger a response.
 * - Exactly one TTS item may be active; user speech cancels it (barge-in).
 * - Deterministic conversation state machine.
 */

export const DEFAULT_ENDPOINT_MS = 1500;
export const LONG_UTTERANCE_ENDPOINT_MS = 2000;

const FILLERS = new Set([
  "hmm", "hm", "hmmm", "umm", "um", "uh", "uhh", "aaa", "aa", "ah", "haan", "haa", "han",
  "ok", "okay", "yes", "yeah", "right", "acha", "achha", "oh", "huh",
]);

export function normalizeUtterance(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

/** True when the utterance is empty or made only of filler sounds. */
export function isFillerOnly(text: string): boolean {
  const words = normalizeUtterance(text).split(" ").filter(Boolean);
  if (words.length === 0) return true;
  return words.every((w) => FILLERS.has(w) || /^(h+m+|u+m+|a+h*|u+h+)$/.test(w));
}

/** Silence needed before committing: longer utterances get a little more patience. */
export function endpointDelayMs(transcript: string): number {
  const words = normalizeUtterance(transcript).split(" ").filter(Boolean).length;
  return words >= 12 ? LONG_UTTERANCE_ENDPOINT_MS : DEFAULT_ENDPOINT_MS;
}

/** Decide whether a pause should commit the turn. */
export function shouldCommit(transcript: string, silenceMs: number, isFinal: boolean): boolean {
  if (isFillerOnly(transcript)) return false;
  if (!isFinal && silenceMs < endpointDelayMs(transcript) + 500) return false;
  return silenceMs >= endpointDelayMs(transcript);
}

export type ConversationState =
  | "IDLE" | "LISTENING" | "PROCESSING" | "THINKING" | "PLANNING" | "ASKING_CONFIRMATION"
  | "EXECUTING" | "VERIFYING" | "SPEAKING" | "ERROR" | "PAUSED" | "DISCONNECTED";

export type ConversationEvent =
  | "START_LISTENING" | "USER_SPEECH" | "COMMIT" | "FILLER" | "MODEL_START" | "NEEDS_CONFIRMATION"
  | "CONFIRMED" | "DECLINED" | "EXECUTE" | "VERIFY" | "REPLY" | "TTS_END" | "STOP" | "FAIL"
  | "PAUSE" | "RESUME" | "OFFLINE" | "ONLINE";

const TRANSITIONS: Partial<Record<ConversationState, Partial<Record<ConversationEvent, ConversationState>>>> = {
  IDLE: { START_LISTENING: "LISTENING", USER_SPEECH: "LISTENING", PAUSE: "PAUSED" },
  LISTENING: { COMMIT: "PROCESSING", FILLER: "LISTENING", USER_SPEECH: "LISTENING" },
  PROCESSING: { MODEL_START: "THINKING", FAIL: "ERROR" },
  THINKING: { NEEDS_CONFIRMATION: "ASKING_CONFIRMATION", EXECUTE: "EXECUTING", REPLY: "SPEAKING", FAIL: "ERROR", USER_SPEECH: "LISTENING" },
  PLANNING: { EXECUTE: "EXECUTING", NEEDS_CONFIRMATION: "ASKING_CONFIRMATION", FAIL: "ERROR" },
  ASKING_CONFIRMATION: { CONFIRMED: "EXECUTING", DECLINED: "SPEAKING", USER_SPEECH: "LISTENING" },
  EXECUTING: { VERIFY: "VERIFYING", NEEDS_CONFIRMATION: "ASKING_CONFIRMATION", FAIL: "ERROR" },
  VERIFYING: { REPLY: "SPEAKING", FAIL: "ERROR" },
  // Barge-in: user speech during SPEAKING cancels TTS and returns to listening.
  SPEAKING: { TTS_END: "IDLE", USER_SPEECH: "LISTENING" },
  ERROR: { START_LISTENING: "LISTENING", USER_SPEECH: "LISTENING", REPLY: "SPEAKING" },
  PAUSED: { RESUME: "IDLE" },
  DISCONNECTED: { ONLINE: "IDLE" },
};

/** Deterministic transition. Unknown events leave the state unchanged. */
export function transition(state: ConversationState, event: ConversationEvent): ConversationState {
  if (event === "STOP") return "IDLE";
  if (event === "OFFLINE") return "DISCONNECTED";
  return TRANSITIONS[state]?.[event] ?? state;
}

/** Strip spoken filler from a reply before TTS (spec: never speak "hmm", "got it", …). */
export function stripSpokenFiller(reply: string): string {
  return reply
    .replace(/^(\s*(hmm+|umm+|uh+|aaa+|haan|okay okay|yes yes|right right|got it|i see)[,.!\s]*)+/i, "")
    .trim();
}

/** A single-slot speech queue: speaking anything new cancels whatever is playing. */
export class SingleSpeaker {
  private active: SpeechSynthesisUtterance | null = null;
  constructor(private synth: Pick<SpeechSynthesis, "speak" | "cancel"> | null) {}

  speak(text: string, lang = "en-IN", onEnd?: () => void): boolean {
    const clean = stripSpokenFiller(text);
    if (!this.synth || !clean) return false;
    this.cancel();
    const u = new SpeechSynthesisUtterance(clean);
    u.lang = lang;
    u.onend = () => {
      if (this.active === u) this.active = null;
      onEnd?.();
    };
    this.active = u;
    this.synth.speak(u);
    return true;
  }

  cancel(): void {
    this.synth?.cancel();
    this.active = null;
  }

  get speaking(): boolean {
    return this.active !== null;
  }
}
