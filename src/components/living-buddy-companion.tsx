import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Mic,
  Square,
  Volume2,
  VolumeX,
  Sparkles,
  Send,
  Minimize2,
  Maximize2,
  Settings2,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  TalkingBuddyCharacter,
  type TalkingBuddyState,
} from "@/components/talking-buddy-character";
import { useBuddyStateManager, BUDDY_EMOTION_STATES } from "@/hooks/use-buddy-state-manager";
import { SingleSpeaker } from "@/shared/voice-turn";
import { quickTalk } from "@/lib/talk.functions";

export interface LivingBuddyCompanionProps {
  initialBuddySlug?: string;
  className?: string;
  compact?: boolean;
  onActionRequest?: (action: { type: string; target: string; details?: string }) => void;
}

interface SpeechRecInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort?: () => void;
  onstart: (() => void) | null;
  onresult: ((e: { results?: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}

export function LivingBuddyCompanion({
  initialBuddySlug = "friendly",
  className,
  compact = false,
  onActionRequest,
}: LivingBuddyCompanionProps) {
  const buddy = useBuddyStateManager("idle");
  const state = buddy.emotion;
  const setState = buddy.setEmotion;
  const [muted, setMuted] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [lowGraphics, setLowGraphics] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(true);
  const statusMessage = buddy.statusMessage;
  const setStatusMessage = (msg: string) => buddy.setEmotion(buddy.emotion, { reason: msg });
  const [inputText, setInputText] = useState("");
  const [history, setHistory] = useState<Array<{ role: "user" | "buddy"; text: string }>>([
    {
      role: "buddy",
      text: "Hey! I am your AI Buddy. Ask me anything, or let me guide you through this page!",
    },
  ]);
  const [pendingConfirmation, setPendingConfirmation] = useState<{
    action: string;
    description: string;
    impact: "low" | "medium" | "high";
  } | null>(null);

  const speaker = useRef<SingleSpeaker | null>(null);
  const recognitionRef = useRef<SpeechRecInstance | null>(null);
  const reqId = useRef(0);

  // Initialize SpeechSynthesis
  useEffect(() => {
    speaker.current = new SingleSpeaker(
      typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : null,
    );

    const w =
      typeof window !== "undefined"
        ? (window as unknown as {
            SpeechRecognition?: new () => SpeechRecInstance;
            webkitSpeechRecognition?: new () => SpeechRecInstance;
          })
        : {};
    const SpeechRec = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    setSpeechSupported(Boolean(SpeechRec));

    return () => {
      speaker.current?.cancel();
      recognitionRef.current?.abort?.();
    };
  }, []);

  // Speak response out loud and sync character state
  const speakText = useCallback(
    (text: string, onDone?: () => void) => {
      if (muted || !speaker.current) {
        onDone?.();
        return;
      }

      setState("speaking");
      const isHindi = /[\u0900-\u097F]/.test(text);
      const spoke = speaker.current.speak(text, isHindi ? "hi-IN" : "en-IN", () => {
        setState("idle");
        onDone?.();
      });

      if (!spoke) {
        setState("idle");
        onDone?.();
      }
    },
    [muted, setState],
  );

  // Send query to AI
  const handleSend = async (queryText: string) => {
    const text = queryText.trim();
    if (!text) return;

    setInputText("");
    const id = ++reqId.current;
    setState("thinking");
    setStatusMessage("Thinking and observing…");

    const updated = [...history, { role: "user" as const, text }];
    setHistory(updated);

    try {
      const res = await quickTalk({
        data: {
          text,
          history: updated.slice(-6),
        },
      });

      if (id !== reqId.current) return;

      if (res.ok) {
        const replyText = res.reply;
        setHistory((prev) => [...prev, { role: "buddy", text: replyText }]);
        setStatusMessage("Buddy is replying");

        // Inspect intent for simulated browser action demonstration
        if (
          text.toLowerCase().includes("submit") ||
          text.toLowerCase().includes("pay") ||
          text.toLowerCase().includes("buy") ||
          text.toLowerCase().includes("delete")
        ) {
          setState("permission_required");
          setPendingConfirmation({
            action: "Consequential Page Action",
            description: `Buddy identified a high-impact operation based on "${text}". Please confirm approval.`,
            impact: "high",
          });
        } else {
          speakText(replyText, () => {
            if (id === reqId.current) {
              setState("happy");
              setTimeout(() => setState("idle"), 2000);
            }
          });
        }
      } else {
        setState("error");
        setHistory((prev) => [...prev, { role: "buddy", text: res.reply }]);
        setStatusMessage("Could not complete request. Try again.");
        setTimeout(() => setState("idle"), 3000);
      }
    } catch (err) {
      if (id !== reqId.current) return;
      setState("error");
      setStatusMessage("Network issue. Reconnecting…");
      setTimeout(() => setState("idle"), 3000);
    }
  };

  // Microphone speech input
  const startListening = () => {
    const w =
      typeof window !== "undefined"
        ? (window as unknown as {
            SpeechRecognition?: new () => SpeechRecInstance;
            webkitSpeechRecognition?: new () => SpeechRecInstance;
          })
        : {};
    const SpeechRec = w.SpeechRecognition ?? w.webkitSpeechRecognition;

    if (!SpeechRec) {
      setStatusMessage("Voice recognition is not supported in this browser.");
      return;
    }

    speaker.current?.cancel();
    const rec = new SpeechRec();
    rec.continuous = false;
    rec.interimResults = false;
    rec.lang = "en-IN";

    rec.onstart = () => {
      setState("listening");
      setStatusMessage("Listening… speak clearly into your mic");
    };

    rec.onresult = (e: { results?: ArrayLike<ArrayLike<{ transcript: string }>> }) => {
      const transcript = e.results?.[0]?.[0]?.transcript || "";
      if (transcript.trim()) {
        handleSend(transcript);
      } else {
        setState("idle");
        setStatusMessage("Didn't catch that. Tap mic to try again.");
      }
    };

    rec.onerror = (e: { error: string }) => {
      if (e.error !== "no-speech") {
        setState("confused");
        setStatusMessage(`Microphone: ${e.error || "error"}`);
        setTimeout(() => setState("idle"), 2500);
      } else {
        setState("idle");
        setStatusMessage("No speech heard. Try again.");
      }
    };

    rec.onend = () => {
      if (state === "listening") {
        setState("idle");
      }
    };

    recognitionRef.current = rec;
    rec.start();
  };

  const stopAll = () => {
    reqId.current++;
    recognitionRef.current?.abort?.();
    speaker.current?.cancel();
    setState("idle");
    setStatusMessage("Idle");
  };

  const confirmAction = () => {
    if (pendingConfirmation) {
      onActionRequest?.({
        type: pendingConfirmation.action,
        target: "active-tab",
        details: pendingConfirmation.description,
      });
      setPendingConfirmation(null);
      setState("success");
      setStatusMessage("Action confirmed and executed safely.");
      setTimeout(() => setState("idle"), 2500);
    }
  };

  const cancelAction = () => {
    setPendingConfirmation(null);
    setState("idle");
    setStatusMessage("Action cancelled per user choice.");
  };

  return (
    <div
      className={cn(
        "living-buddy-container flex flex-col rounded-3xl border border-border/80 bg-card/90 shadow-2xl backdrop-blur-xl transition-all duration-300",
        minimized ? "p-3 max-w-xs" : "p-6 max-w-xl w-full",
        className,
      )}
    >
      {/* Header bar */}
      <div className="flex items-center justify-between border-b border-border/60 pb-3">
        <div className="flex items-center gap-2">
          <Badge
            variant={
              state === "listening"
                ? "default"
                : state === "speaking"
                  ? "secondary"
                  : state === "error"
                    ? "destructive"
                    : "outline"
            }
            className="capitalize text-xs font-semibold px-2.5 py-0.5"
          >
            {state.replace("_", " ")}
          </Badge>
          <span className="text-xs text-muted-foreground truncate max-w-[200px]">
            {statusMessage}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            onClick={() => setMuted(!muted)}
            title={muted ? "Unmute Buddy voice" : "Mute Buddy voice"}
          >
            {muted ? (
              <VolumeX className="size-4 text-destructive" />
            ) : (
              <Volume2 className="size-4" />
            )}
          </Button>

          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            onClick={() => setLowGraphics(!lowGraphics)}
            title={lowGraphics ? "Switch to High Graphics" : "Switch to Low Graphics"}
          >
            <Zap
              className={cn("size-4", lowGraphics ? "text-amber-500" : "text-muted-foreground")}
            />
          </Button>

          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            onClick={() => setMinimized(!minimized)}
            title={minimized ? "Expand Buddy" : "Minimize Buddy"}
          >
            {minimized ? <Maximize2 className="size-4" /> : <Minimize2 className="size-4" />}
          </Button>
        </div>
      </div>

      {/* Main Character Stage */}
      <div className="flex flex-col items-center justify-center py-4 relative">
        <TalkingBuddyCharacter
          state={state}
          slug={initialBuddySlug}
          size={minimized ? 120 : 220}
          lowGraphics={lowGraphics}
          onTap={() => {
            if (state === "idle") {
              setState("happy");
              setTimeout(() => setState("idle"), 1200);
            }
          }}
        />

        {/* Emotion quick testing palette (when expanded) */}
        {!minimized && (
          <div className="mt-3 flex flex-wrap justify-center gap-1 max-w-md">
            {[
              "idle",
              "happy",
              "excited",
              "laughing",
              "thinking",
              "confused",
              "listening",
              "speaking",
              "sleepy",
              "working",
              "success",
              "error",
              "permission_required",
            ].map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setState(st as TalkingBuddyState)}
                className={cn(
                  "px-2 py-0.5 text-[10px] rounded-full border transition-colors",
                  state === st
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-muted/40 text-muted-foreground border-border/60 hover:bg-muted",
                )}
              >
                {st}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Confirmation Card if high-impact action needs approval */}
      {pendingConfirmation && (
        <div className="mb-4 rounded-xl border border-warning/50 bg-warning/10 p-4 animate-in fade-in zoom-in-95">
          <div className="flex items-start gap-3">
            <AlertTriangle className="size-5 text-warning shrink-0 mt-0.5" />
            <div className="flex-1 text-sm">
              <h4 className="font-semibold text-warning-foreground">
                Approval Required: {pendingConfirmation.action}
              </h4>
              <p className="mt-1 text-xs text-muted-foreground">
                {pendingConfirmation.description}
              </p>
              <div className="mt-3 flex gap-2">
                <Button size="sm" onClick={confirmAction} className="bg-primary">
                  Approve & Proceed
                </Button>
                <Button size="sm" variant="outline" onClick={cancelAction}>
                  Cancel Action
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Chat History & Dialog */}
      {!minimized && (
        <div className="mb-4 max-h-48 overflow-y-auto space-y-2 rounded-2xl bg-muted/30 p-3 text-sm border border-border/40">
          {history.slice(-5).map((turn, i) => (
            <div
              key={i}
              className={cn(
                "rounded-xl px-3 py-2 max-w-[85%] text-xs",
                turn.role === "user"
                  ? "ml-auto bg-primary text-primary-foreground font-medium"
                  : "bg-card border border-border/70 text-foreground shadow-sm",
              )}
            >
              <span className="font-semibold block text-[10px] opacity-75 mb-0.5">
                {turn.role === "user" ? "You" : "Buddy"}
              </span>
              {turn.text}
            </div>
          ))}
        </div>
      )}

      {/* Interactive Controls */}
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size={minimized ? "sm" : "default"}
          variant={state === "listening" ? "destructive" : "default"}
          onClick={state === "listening" ? stopAll : startListening}
          className={cn(
            "rounded-xl shrink-0 transition-all",
            state === "listening" && "animate-pulse ring-2 ring-destructive",
          )}
          title="Push to speak"
        >
          {state === "listening" ? (
            <>
              <Square className="size-4 mr-1.5" /> Stop
            </>
          ) : (
            <>
              <Mic className="size-4 mr-1.5" /> Talk
            </>
          )}
        </Button>

        {!minimized && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend(inputText);
            }}
            className="flex-1 flex gap-2"
          >
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Ask Buddy… e.g. What is this form for?"
              className="flex-1 rounded-xl border border-input bg-background/80 px-3 py-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <Button
              type="submit"
              size="sm"
              disabled={!inputText.trim() || state === "thinking"}
              className="rounded-xl px-3"
            >
              <Send className="size-3.5" />
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
