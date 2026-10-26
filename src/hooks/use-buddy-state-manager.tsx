import * as React from "react";
import type { TalkingBuddyState } from "@/components/talking-buddy-character";

export const BUDDY_EMOTION_STATES = {
  IDLE: "idle",
  LISTENING: "listening",
  THINKING: "thinking",
  SPEAKING: "speaking",
  HAPPY: "happy",
  EXCITED: "excited",
  LAUGHING: "laughing",
  SAD: "sad",
  SCARED: "scared",
  SURPRISED: "surprised",
  CONFUSED: "confused",
  SLEEPY: "sleepy",
  WORKING: "working",
  SUCCESS: "success",
  ERROR: "error",
  DISCONNECTED: "disconnected",
  PERMISSION_REQUIRED: "permission_required",
} as const;

export type BuddyEmotionState = TalkingBuddyState;

export type BuddyEmotionInput = BuddyEmotionState | keyof typeof BUDDY_EMOTION_STATES | string;

export interface SetEmotionOptions {
  /** Automatically revert to a baseline state after duration in milliseconds */
  durationMs?: number;
  /** State to revert back to after durationMs (defaults to 'idle') */
  revertTo?: BuddyEmotionInput;
  /** Optional status description or contextual note */
  reason?: string;
  /** Priority flag to prevent low-priority animations from overriding task progress */
  priority?: "low" | "normal" | "high";
}

export interface StateHistoryEntry {
  emotion: BuddyEmotionState;
  timestamp: number;
  reason?: string;
}

export interface BuddyStateManagerValue {
  /** Current canonical emotion state (lowercase, e.g. "idle", "speaking", "thinking") */
  emotion: BuddyEmotionState;
  /** Alias for emotion */
  state: BuddyEmotionState;
  /** Alias for emotion */
  currentEmotion: BuddyEmotionState;
  /** Current canonical emotion state in UPPERCASE (e.g. "IDLE", "SPEAKING", "THINKING") */
  emotionUpper: string;
  /** Descriptive status message corresponding to current emotion */
  statusMessage: string;
  /** Set emotion with optional auto-reset duration and context */
  setEmotion: (emotion: BuddyEmotionInput, options?: SetEmotionOptions) => void;
  /** Reset emotion back to idle */
  resetEmotion: (reason?: string) => void;

  // Convenient Conversation and Task Helpers
  startListening: (reason?: string) => void;
  startThinking: (reason?: string) => void;
  startSpeaking: (reason?: string) => void;
  stopSpeaking: (reason?: string) => void;
  returnToIdle: () => void;
  setSuccess: (durationMs?: number, reason?: string) => void;
  setError: (reason?: string, durationMs?: number) => void;
  setWorking: (taskName?: string) => void;
  requirePermission: (reason?: string) => void;
  poke: () => void;

  /**
   * Automatically manage emotion lifecycle around an async conversation turn or background task.
   * Sets state to "working" (or "thinking"), then "success" upon resolution, or "error" on failure.
   */
  runTask: <T>(
    task: () => Promise<T>,
    options?: {
      taskName?: string;
      workingEmotion?: BuddyEmotionInput;
      successEmotion?: BuddyEmotionInput;
      successDurationMs?: number;
      errorDurationMs?: number;
    },
  ) => Promise<T>;

  // Booleans for quick conditional rendering
  isIdle: boolean;
  isListening: boolean;
  isThinking: boolean;
  isSpeaking: boolean;
  isWorking: boolean;
  isError: boolean;
  isSuccess: boolean;
  isHappy: boolean;

  /** History of recent emotion changes */
  history: StateHistoryEntry[];
  /** Clear history */
  clearHistory: () => void;
}

/**
 * Normalizes input string/constant to a valid canonical BuddyEmotionState.
 */
export function normalizeEmotion(input: BuddyEmotionInput): BuddyEmotionState {
  if (!input) return "idle";
  const clean = String(input).trim().toLowerCase();

  switch (clean) {
    case "idle":
    case "neutral":
      return "idle";
    case "listening":
    case "listen":
      return "listening";
    case "thinking":
    case "think":
      return "thinking";
    case "speaking":
    case "speak":
    case "talking":
      return "speaking";
    case "happy":
      return "happy";
    case "excited":
      return "excited";
    case "laughing":
    case "laugh":
    case "giggle":
      return "laughing";
    case "sad":
      return "sad";
    case "scared":
    case "fear":
      return "scared";
    case "surprised":
    case "surprise":
      return "surprised";
    case "confused":
    case "curious":
      return "confused";
    case "sleepy":
    case "sleeping":
      return "sleepy";
    case "working":
    case "executing":
    case "task":
      return "working";
    case "success":
    case "celebrate":
    case "done":
      return "success";
    case "error":
    case "concerned":
    case "failed":
      return "error";
    case "disconnected":
    case "offline":
      return "disconnected";
    case "permission_required":
    case "permission":
    case "confirm":
      return "permission_required";
    default:
      return "idle";
  }
}

function getDefaultStatus(state: BuddyEmotionState): string {
  switch (state) {
    case "listening":
      return "Listening to your voice…";
    case "thinking":
      return "Thinking and observing…";
    case "speaking":
      return "Speaking…";
    case "happy":
      return "Happy to help!";
    case "excited":
      return "Ready to go!";
    case "laughing":
      return "Hehe!";
    case "working":
      return "Working on your page task…";
    case "success":
      return "Task completed successfully!";
    case "error":
      return "Something went wrong.";
    case "permission_required":
      return "Approval required before proceeding.";
    case "disconnected":
      return "Disconnected from backend.";
    case "sleepy":
      return "Taking a quick rest…";
    case "confused":
      return "Not quite sure about that.";
    case "idle":
    default:
      return "Ready and listening.";
  }
}

/**
 * Hook that manages the character's emotional states (IDLE, SPEAKING, THINKING, etc.)
 * and exposes a setEmotion function and conversation lifecycle triggers.
 */
export function useBuddyStateManager(
  initialState: BuddyEmotionInput = "idle",
): BuddyStateManagerValue {
  const [emotion, setRawEmotion] = React.useState<BuddyEmotionState>(() =>
    normalizeEmotion(initialState),
  );
  const [statusMessage, setStatusMessage] = React.useState<string>(() =>
    getDefaultStatus(normalizeEmotion(initialState)),
  );
  const [history, setHistory] = React.useState<StateHistoryEntry[]>(() => [
    { emotion: normalizeEmotion(initialState), timestamp: Date.now() },
  ]);

  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear timer on unmount
  React.useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const setEmotion = React.useCallback(
    (nextInput: BuddyEmotionInput, options?: SetEmotionOptions) => {
      const canonical = normalizeEmotion(nextInput);

      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }

      setRawEmotion(canonical);
      setStatusMessage(options?.reason || getDefaultStatus(canonical));

      setHistory((prev) => [
        ...prev.slice(-25),
        { emotion: canonical, timestamp: Date.now(), reason: options?.reason },
      ]);

      // Handle auto-revert timeout
      if (options?.durationMs && options.durationMs > 0) {
        const revertState = normalizeEmotion(options.revertTo || "idle");
        timerRef.current = setTimeout(() => {
          setRawEmotion(revertState);
          setStatusMessage(getDefaultStatus(revertState));
          setHistory((prev) => [
            ...prev.slice(-25),
            {
              emotion: revertState,
              timestamp: Date.now(),
              reason: "Auto-revert to baseline",
            },
          ]);
        }, options.durationMs);
      }
    },
    [],
  );

  // Conversation & Task Lifecycle Triggers
  const startListening = React.useCallback(
    (reason?: string) => setEmotion("listening", { reason }),
    [setEmotion],
  );

  const startThinking = React.useCallback(
    (reason?: string) => setEmotion("thinking", { reason }),
    [setEmotion],
  );

  const startSpeaking = React.useCallback(
    (reason?: string) => setEmotion("speaking", { reason }),
    [setEmotion],
  );

  const stopSpeaking = React.useCallback(
    (reason?: string) => setEmotion("idle", { reason }),
    [setEmotion],
  );

  const returnToIdle = React.useCallback(() => setEmotion("idle"), [setEmotion]);

  const setSuccess = React.useCallback(
    (durationMs = 2500, reason?: string) =>
      setEmotion("success", { durationMs, revertTo: "idle", reason }),
    [setEmotion],
  );

  const setError = React.useCallback(
    (reason?: string, durationMs = 3500) =>
      setEmotion("error", { durationMs, revertTo: "idle", reason }),
    [setEmotion],
  );

  const setWorking = React.useCallback(
    (taskName?: string) =>
      setEmotion("working", { reason: taskName ? `Working on: ${taskName}` : undefined }),
    [setEmotion],
  );

  const requirePermission = React.useCallback(
    (reason?: string) => setEmotion("permission_required", { reason }),
    [setEmotion],
  );

  const resetEmotion = React.useCallback(
    (reason?: string) => setEmotion("idle", { reason: reason || "Returned to idle" }),
    [setEmotion],
  );

  const runTask = React.useCallback(
    async <T,>(
      task: () => Promise<T>,
      options?: {
        taskName?: string;
        workingEmotion?: BuddyEmotionInput;
        successEmotion?: BuddyEmotionInput;
        successDurationMs?: number;
        errorDurationMs?: number;
      },
    ): Promise<T> => {
      const working = options?.workingEmotion || "working";
      const success = options?.successEmotion || "success";
      const taskName = options?.taskName || "Task execution";
      setEmotion(working, { reason: `Working on: ${taskName}` });

      try {
        const result = await task();
        setEmotion(success, {
          durationMs: options?.successDurationMs ?? 2500,
          revertTo: "idle",
          reason: `${taskName} completed successfully`,
        });
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setEmotion("error", {
          durationMs: options?.errorDurationMs ?? 3500,
          revertTo: "idle",
          reason: `Error in ${taskName}: ${message}`,
        });
        throw err;
      }
    },
    [setEmotion],
  );

  const poke = React.useCallback(() => {
    setEmotion("laughing", { durationMs: 1200, revertTo: "idle", reason: "Giggle!" });
  }, [setEmotion]);

  const clearHistory = React.useCallback(() => {
    setHistory([{ emotion, timestamp: Date.now(), reason: "History cleared" }]);
  }, [emotion]);

  return {
    emotion,
    state: emotion,
    currentEmotion: emotion,
    emotionUpper: emotion.toUpperCase(),
    statusMessage,
    setEmotion,
    resetEmotion,

    startListening,
    startThinking,
    startSpeaking,
    stopSpeaking,
    returnToIdle,
    setSuccess,
    setError,
    setWorking,
    requirePermission,
    poke,
    runTask,

    isIdle: emotion === "idle",
    isListening: emotion === "listening",
    isThinking: emotion === "thinking",
    isSpeaking: emotion === "speaking",
    isWorking: emotion === "working",
    isError: emotion === "error",
    isSuccess: emotion === "success",
    isHappy: emotion === "happy" || emotion === "excited" || emotion === "laughing",

    history,
    clearHistory,
  };
}

// Global Context for sharing character emotion across application components
const BuddyStateContext = React.createContext<BuddyStateManagerValue | null>(null);

export interface BuddyStateProviderProps {
  initialState?: BuddyEmotionInput;
  children: React.ReactNode;
}

export function BuddyStateProvider({ initialState = "idle", children }: BuddyStateProviderProps) {
  const manager = useBuddyStateManager(initialState);
  return <BuddyStateContext.Provider value={manager}>{children}</BuddyStateContext.Provider>;
}

/**
 * Hook to consume the shared BuddyStateManager context, or falls back to an independent state manager.
 */
export function useBuddyState(defaultState?: BuddyEmotionInput): BuddyStateManagerValue {
  const context = React.useContext(BuddyStateContext);
  const localManager = useBuddyStateManager(defaultState || "idle");
  return context ?? localManager;
}

/**
 * BuddyStateManager hook (matches exact user naming).
 * Manages character emotional states (IDLE, SPEAKING, THINKING, etc.) and exposes setEmotion.
 */
export function BuddyStateManager(initialState: BuddyEmotionInput = "idle") {
  return useBuddyStateManager(initialState);
}

export default useBuddyStateManager;
