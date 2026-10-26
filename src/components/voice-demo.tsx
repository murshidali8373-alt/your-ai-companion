import { Mic, Square, Sparkles, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { BuddyAvatar, type BuddyEmotion } from "@/components/buddy-avatar";
import {
  TalkingBuddyCharacter,
  type TalkingBuddyState,
} from "@/components/talking-buddy-character";
import { useBuddyStateManager, BUDDY_EMOTION_STATES } from "@/hooks/use-buddy-state-manager";
import { quickTalk } from "@/lib/talk.functions";
import { endpointDelayMs, isFillerOnly, SingleSpeaker } from "@/shared/voice-turn";

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort?: () => void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};

function getRecognition(): Recognition | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => Recognition;
    webkitSpeechRecognition?: new () => Recognition;
  };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

type Turn = { role: "user" | "buddy"; text: string };

/** Click Buddy → it listens, sends your words to the AI, and speaks the reply. */
export function VoiceDemo() {
  const [supported, setSupported] = useState<boolean | null>(null);
  const buddy = useBuddyStateManager("idle");
  const [characterMode, setCharacterMode] = useState<"living" | "avatar">("living");
  const [transcript, setTranscript] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [typedInput, setTypedInput] = useState("");
  const rec = useRef<Recognition | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef("");
  const speaker = useRef<SingleSpeaker | null>(null);
  const turnsRef = useRef<Turn[]>([]);
  const reqId = useRef(0);

  useEffect(() => {
    setSupported(Boolean(getRecognition()));
    speaker.current = new SingleSpeaker(
      "speechSynthesis" in window ? window.speechSynthesis : null,
    );
    return () => {
      rec.current?.abort?.();
      speaker.current?.cancel();
    };
  }, []);

  const send = async (text: string) => {
    const id = ++reqId.current;
    buddy.setEmotion(BUDDY_EMOTION_STATES.THINKING, { reason: "Thinking of a reply…" });
    const history = turnsRef.current.slice(-6);
    turnsRef.current = [...turnsRef.current, { role: "user", text }];
    setTurns(turnsRef.current);
    try {
      const res = await quickTalk({ data: { text, history } });
      if (id !== reqId.current) return;
      turnsRef.current = [...turnsRef.current, { role: "buddy", text: res.reply }];
      setTurns(turnsRef.current);
      if (!res.ok) {
        setError(res.reply);
        buddy.setEmotion(BUDDY_EMOTION_STATES.ERROR, { durationMs: 2500, reason: res.reply });
      }
      buddy.setEmotion(BUDDY_EMOTION_STATES.SPEAKING, { reason: "Speaking reply" });
      const spoke = speaker.current?.speak(
        res.reply,
        /[\u0900-\u097F]/.test(res.reply) ? "hi-IN" : "en-IN",
        () => {
          if (id === reqId.current) {
            buddy.setEmotion(BUDDY_EMOTION_STATES.HAPPY, {
              durationMs: 1800,
              revertTo: BUDDY_EMOTION_STATES.IDLE,
              reason: "Finished speaking",
            });
          }
        },
      );
      if (!spoke) {
        buddy.setEmotion(BUDDY_EMOTION_STATES.IDLE);
      }
    } catch {
      if (id !== reqId.current) return;
      setError("I could not reach the AI right now. Try again.");
      buddy.setEmotion(BUDDY_EMOTION_STATES.ERROR, {
        durationMs: 2500,
        revertTo: BUDDY_EMOTION_STATES.IDLE,
        reason: "Network connection error",
      });
    }
  };

  const finish = () => {
    if (timer.current) clearTimeout(timer.current);
    rec.current?.stop();
    const said = latest.current.trim();
    latest.current = "";
    setTranscript("");
    if (said && !isFillerOnly(said)) void send(said);
    else {
      buddy.setEmotion(BUDDY_EMOTION_STATES.IDLE);
    }
  };

  const start = () => {
    setError(null);
    reqId.current++;
    speaker.current?.cancel();
    const r = getRecognition();
    if (!r) {
      setError("This browser cannot hear speech. Use Chrome or Edge on desktop.");
      return;
    }
    r.lang = "en-IN";
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e) => {
      const said = Array.from(e.results)
        .map((x) => x[0]?.transcript ?? "")
        .join(" ");
      latest.current = said;
      setTranscript(said);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(finish, endpointDelayMs(said));
    };
    r.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      setError(
        e.error === "not-allowed"
          ? "Microphone permission was blocked. Allow it in the browser and try again."
          : "I could not hear that clearly. Try again.",
      );
      buddy.setEmotion(BUDDY_EMOTION_STATES.CONFUSED, {
        durationMs: 2500,
        revertTo: BUDDY_EMOTION_STATES.IDLE,
        reason: "Speech recognition error",
      });
    };
    r.onend = () => {
      if (buddy.isListening) {
        buddy.setEmotion(BUDDY_EMOTION_STATES.IDLE);
      }
    };
    rec.current = r;
    r.start();
    buddy.setEmotion(BUDDY_EMOTION_STATES.LISTENING, { reason: "Listening to user speech" });
  };

  const stopAll = () => {
    reqId.current++;
    if (timer.current) clearTimeout(timer.current);
    rec.current?.abort?.();
    speaker.current?.cancel();
    buddy.setEmotion(BUDDY_EMOTION_STATES.IDLE, { reason: "Conversation stopped" });
  };

  const onBuddyClick = () => {
    if (buddy.isListening) finish();
    else if (buddy.isIdle) start();
    else stopAll();
  };

  const emotion: BuddyEmotion = buddy.isListening
    ? "listening"
    : buddy.isThinking
      ? "thinking"
      : buddy.isSpeaking
        ? "speaking"
        : "neutral";

  const label = buddy.isListening
    ? "Listening… tap to finish"
    : buddy.isThinking
      ? "Thinking…"
      : buddy.isSpeaking
        ? "Speaking… tap to stop"
        : "Tap Buddy and speak";

  return (
    <div className="panel flex flex-col gap-6 p-6 sm:p-8">
      {/* Top mode switch */}
      <div className="flex items-center justify-between border-b border-border/60 pb-3 text-xs">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-primary" />
          <span className="font-semibold">Interactive Voice & Character Engine</span>
        </div>
        <div className="flex rounded-lg border border-border p-0.5">
          <button
            type="button"
            onClick={() => setCharacterMode("living")}
            className={`rounded-md px-2.5 py-1 transition-colors ${characterMode === "living" ? "bg-primary text-primary-foreground font-semibold" : "text-muted-foreground hover:text-foreground"}`}
          >
            Living Buddy Rig
          </button>
          <button
            type="button"
            onClick={() => setCharacterMode("avatar")}
            className={`rounded-md px-2.5 py-1 transition-colors ${characterMode === "avatar" ? "bg-primary text-primary-foreground font-semibold" : "text-muted-foreground hover:text-foreground"}`}
          >
            Avatar Badge
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
        <div className="flex flex-col items-center gap-3 sm:w-64 shrink-0">
          <div
            onClick={onBuddyClick}
            className={`relative rounded-3xl transition-transform hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${buddy.isListening ? "ring-4 ring-primary/40 rounded-full" : ""}`}
            role="button"
            tabIndex={0}
            aria-label={label}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onBuddyClick();
              }
            }}
          >
            {characterMode === "living" ? (
              <TalkingBuddyCharacter
                state={buddy.emotion}
                size={160}
                onTap={() => {
                  if (buddy.isIdle) start();
                }}
              />
            ) : (
              <div className="p-4">
                <BuddyAvatar emotion={emotion} size={130} />
              </div>
            )}
          </div>

          <p className="text-sm font-medium text-center">{label}</p>

          <div className="flex flex-wrap justify-center gap-2">
            {!buddy.isIdle ? (
              <Button size="sm" variant="secondary" onClick={stopAll}>
                <Square className="mr-1.5 size-3.5" /> Stop
              </Button>
            ) : (
              supported !== false && (
                <Button size="sm" onClick={start}>
                  <Mic className="mr-1.5 size-4" /> Push to Talk
                </Button>
              )
            )}
          </div>

          {/* Expressions playground */}
          {characterMode === "living" && (
            <div className="mt-1 flex flex-wrap justify-center gap-1">
              {(
                [
                  "happy",
                  "excited",
                  "laughing",
                  "surprised",
                  "confused",
                  "sleepy",
                  "success",
                ] as const
              ).map((exp) => (
                <button
                  key={exp}
                  type="button"
                  onClick={() => {
                    buddy.setEmotion(exp, {
                      durationMs: 1600,
                      revertTo: BUDDY_EMOTION_STATES.IDLE,
                    });
                  }}
                  className="rounded-full border border-border/60 bg-muted/30 px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  {exp}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1 space-y-4 text-sm">
          <div className="max-h-64 min-h-[140px] space-y-2.5 overflow-y-auto rounded-2xl bg-muted/20 p-4 border border-border/50">
            {turns.length === 0 && !transcript && (
              <div className="text-muted-foreground space-y-1">
                <p className="font-medium text-foreground">Speak or type a question:</p>
                <p>• “Explain this page to me in simple terms”</p>
                <p>• “Where do I fill the GST registration form?”</p>
                <p>• “Kya tum mujhe Hindi mein samjha sakte ho?”</p>
              </div>
            )}
            {turns.map((t, i) => (
              <div
                key={i}
                className={
                  t.role === "user"
                    ? "ml-auto w-fit max-w-[85%] rounded-xl bg-primary px-3.5 py-2 text-primary-foreground font-medium text-xs sm:text-sm"
                    : "max-w-[90%] rounded-xl bg-card border border-border/70 p-3 text-foreground shadow-sm text-xs sm:text-sm leading-relaxed"
                }
              >
                {t.text}
              </div>
            ))}
            {transcript && (
              <p className="ml-auto w-fit max-w-[85%] rounded-xl bg-muted px-3.5 py-2 text-muted-foreground text-xs italic">
                Hearing: {transcript}…
              </p>
            )}
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}
          {supported === false && (
            <p className="text-xs text-destructive">
              Speech recognition is not available in this browser. Use Chrome or Edge.
            </p>
          )}

          {/* Text fallback input */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (typedInput.trim()) {
                const text = typedInput.trim();
                setTypedInput("");
                send(text);
              }
            }}
            className="flex gap-2"
          >
            <input
              type="text"
              value={typedInput}
              onChange={(e) => setTypedInput(e.target.value)}
              placeholder="Or type a question for Buddy here…"
              className="flex-1 rounded-xl border border-input bg-background/90 px-3.5 py-2 text-xs sm:text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <Button
              type="submit"
              size="sm"
              disabled={!typedInput.trim() || status === "thinking"}
              className="rounded-xl px-4"
            >
              <Send className="size-4" />
            </Button>
          </form>

          <p className="text-[11px] text-muted-foreground">
            Voice-first & permission-first. Tap the character to interact or push the Talk button.
          </p>
        </div>
      </div>
    </div>
  );
}
