import { useState, useCallback, useRef, useEffect } from "react";

/**
 * Buddy character emotional states.
 * Supports standard uppercase conventions (IDLE, SPEAKING, THINKING, HAPPY, SAD, etc.)
 * as well as lowercase strings for maximum interoperability across the Buddy system.
 */
export type Emotion =
  | "IDLE"
  | "SPEAKING"
  | "THINKING"
  | "HAPPY"
  | "SAD"
  | "LISTENING"
  | "EXCITED"
  | "LAUGHING"
  | "SCARED"
  | "SURPRISED"
  | "CONFUSED"
  | "SLEEPY"
  | "WORKING"
  | "SUCCESS"
  | "ERROR"
  | "DISCONNECTED"
  | "PERMISSION_REQUIRED"
  | "idle"
  | "speaking"
  | "thinking"
  | "happy"
  | "sad"
  | "listening"
  | "excited"
  | "laughing"
  | "scared"
  | "surprised"
  | "confused"
  | "sleepy"
  | "working"
  | "success"
  | "error"
  | "disconnected"
  | "permission_required";

export const EMOTIONS = {
  IDLE: "IDLE",
  SPEAKING: "SPEAKING",
  THINKING: "THINKING",
  HAPPY: "HAPPY",
  SAD: "SAD",
  LISTENING: "LISTENING",
  EXCITED: "EXCITED",
  LAUGHING: "LAUGHING",
  SCARED: "SCARED",
  SURPRISED: "SURPRISED",
  CONFUSED: "CONFUSED",
  SLEEPY: "SLEEPY",
  WORKING: "WORKING",
  SUCCESS: "SUCCESS",
  ERROR: "ERROR",
  DISCONNECTED: "DISCONNECTED",
  PERMISSION_REQUIRED: "PERMISSION_REQUIRED",
} as const;

export interface SetEmotionOptions {
  /** Automatically revert to a baseline state after duration in milliseconds */
  durationMs?: number;
  /** State to revert back to after durationMs (defaults to 'IDLE') */
  revertTo?: Emotion;
  /** Optional contextual note or reason */
  reason?: string;
}

export interface UseBuddyStateReturn {
  /** Current emotion state */
  emotion: Emotion;
  /** Alias for emotion */
  currentEmotion: Emotion;
  /** Normalized lowercase string for Buddy component props */
  state: string;
  /** Set emotion with optional auto-revert duration and context */
  setEmotion: (nextEmotion: Emotion, options?: SetEmotionOptions) => void;
  /** Reset emotion back to IDLE */
  resetEmotion: (reason?: string) => void;

  // Convenience boolean helpers
  isIdle: boolean;
  isSpeaking: boolean;
  isThinking: boolean;
  isHappy: boolean;
  isSad: boolean;
  isListening: boolean;
  isWorking: boolean;
  isError: boolean;

  /** Optional status description */
  statusMessage: string;
}

/**
 * Hook to manage the Buddy character's emotional state using React useState.
 * Exposes the current emotion and a setEmotion function for Buddy components to react to.
 *
 * @param initialEmotion - Initial emotional state (defaults to 'IDLE')
 */
export function useBuddyState(initialEmotion: Emotion = "IDLE"): UseBuddyStateReturn {
  const [emotion, setEmotionState] = useState<Emotion>(initialEmotion);
  const [statusMessage, setStatusMessage] = useState<string>("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clean up any active timers on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  const setEmotion = useCallback((nextEmotion: Emotion, options?: SetEmotionOptions) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    setEmotionState(nextEmotion);

    if (options?.reason) {
      setStatusMessage(options.reason);
    }

    if (options?.durationMs && options.durationMs > 0) {
      const revertTo = options.revertTo ?? "IDLE";
      timerRef.current = setTimeout(() => {
        setEmotionState(revertTo);
        if (options.reason) {
          setStatusMessage("");
        }
      }, options.durationMs);
    }
  }, []);

  const resetEmotion = useCallback(
    (reason?: string) => {
      setEmotion("IDLE", { reason });
    },
    [setEmotion],
  );

  const canonicalUpper = String(emotion || "IDLE").toUpperCase();
  const canonicalLower = String(emotion || "idle").toLowerCase();

  return {
    emotion,
    currentEmotion: emotion,
    state: canonicalLower,
    setEmotion,
    resetEmotion,
    isIdle: canonicalUpper === "IDLE",
    isSpeaking: canonicalUpper === "SPEAKING",
    isThinking: canonicalUpper === "THINKING",
    isHappy: canonicalUpper === "HAPPY",
    isSad: canonicalUpper === "SAD",
    isListening: canonicalUpper === "LISTENING",
    isWorking: canonicalUpper === "WORKING",
    isError: canonicalUpper === "ERROR",
    statusMessage,
  };
}

export default useBuddyState;
