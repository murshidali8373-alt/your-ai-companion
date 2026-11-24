import {
  Mic,
  Square,
  Sparkles,
  Send,
  Volume2,
  VolumeX,
  Trash2,
  Cpu,
  RotateCcw,
  ArrowDown,
} from "lucide-react";
import { useEffect, useRef, useState, useCallback } from "react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BuddyAvatar, type BuddyEmotion } from "@/components/buddy-avatar";
import { ChatMarkdown } from "@/components/chat-markdown";
import {
  TalkingBuddyCharacter,
  type TalkingBuddyState,
} from "@/components/talking-buddy-character";
import { useBuddyStateManager, BUDDY_EMOTION_STATES } from "@/hooks/use-buddy-state-manager";
import { useSmartAutoScroll } from "@/hooks/use-smart-auto-scroll";
import { quickTalk } from "@/lib/talk.functions";
import { endpointDelayMs, isFillerOnly, SingleSpeaker } from "@/shared/voice-turn";
import { BUDDY_PRESETS, getBuddyPreset } from "@/lib/ai/buddy-personas";

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
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => Recognition;
    webkitSpeechRecognition?: new () => Recognition;
  };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

export type ChatTurn = {
  role: "user" | "buddy";
  text: string;
  buddyName?: string;
  model?: string;
  timestamp?: number;
};

export function VoiceDemo() {
  const [supported, setSupported] = useState<boolean | null>(null);
  const buddy = useBuddyStateManager("idle");
  const [characterMode, setCharacterMode] = useState<"living" | "avatar">("living");

  // Selected Buddy Persona (default: friendly for SSR consistency)
  const [selectedSlug, setSelectedSlug] = useState<string>("friendly");

  const activePreset = getBuddyPreset(selectedSlug);

  // Conversation history (default for SSR consistency)
  const [turns, setTurns] = useState<ChatTurn[]>([
    {
      role: "buddy",
      text: "Hey! I am Friendly Buddy. Your everyday browser companion. Ask me anything or let me guide you!",
      buddyName: "Friendly Buddy",
    },
  ]);

  // Read persisted selection and history after hydration so server and client markup match
  useEffect(() => {
    try {
      const savedSlug = localStorage.getItem("buddy_selected_slug");
      if (savedSlug && savedSlug !== "friendly") {
        setSelectedSlug(savedSlug);
      }
      const activeSlug = savedSlug || "friendly";
      const savedTurns = localStorage.getItem(`buddy_turns_${activeSlug}`);
      if (savedTurns) {
        setTurns(JSON.parse(savedTurns));
      } else if (savedSlug && savedSlug !== "friendly") {
        const preset = getBuddyPreset(savedSlug);
        setTurns([
          {
            role: "buddy",
            text: `Hey! I am ${preset.name}. ${preset.tagline}. Ask me anything or let me guide you!`,
            buddyName: preset.name,
          },
        ]);
      }
    } catch {
      // Non-fatal
    }
  }, []);

  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [typedInput, setTypedInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [muted, setMuted] = useState(false);

  const rec = useRef<Recognition | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef("");
  const speaker = useRef<SingleSpeaker | null>(null);
  const turnsRef = useRef<ChatTurn[]>(turns);
  turnsRef.current = turns;
  const reqId = useRef(0);
  const smartScroll = useSmartAutoScroll({
    depKey: `${turns.length}:${transcript}:${isSubmitting}:${selectedSlug}`,
  });

  // Initialize speech recognition & synthesis
  useEffect(() => {
    setSupported(Boolean(getRecognition()));
    speaker.current = new SingleSpeaker(
      typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : null,
    );
    return () => {
      rec.current?.abort?.();
      speaker.current?.cancel();
    };
  }, []);

  // Sync turns to localStorage
  useEffect(() => {
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(`buddy_turns_${selectedSlug}`, JSON.stringify(turns));
      } catch {
        // storage quota
      }
    }
  }, [turns, selectedSlug]);

  // Switch Buddy persona
  const handleSelectBuddy = useCallback(
    (slug: string) => {
      if (slug === selectedSlug) return;
      setSelectedSlug(slug);
      if (typeof window !== "undefined") {
        localStorage.setItem("buddy_selected_slug", slug);
      }

      const newPreset = getBuddyPreset(slug);
      let existingTurns: ChatTurn[] = [];
      if (typeof window !== "undefined") {
        try {
          const saved = localStorage.getItem(`buddy_turns_${slug}`);
          if (saved) existingTurns = JSON.parse(saved);
        } catch {
          // fallback
        }
      }

      if (existingTurns.length === 0) {
        existingTurns = [
          {
            role: "buddy",
            text: `Switched to ${newPreset.name}! ${newPreset.tagline}. How can I help you today?`,
            buddyName: newPreset.name,
          },
        ];
      }

      smartScroll.notifyUserMessageSent();
      setTurns(existingTurns);
      buddy.setEmotion(BUDDY_EMOTION_STATES.HAPPY, {
        durationMs: 2000,
        revertTo: BUDDY_EMOTION_STATES.IDLE,
        reason: `Switched to ${newPreset.name}`,
      });
    },
    [selectedSlug, buddy, smartScroll],
  );

  // Listen for global Buddy selection events
  useEffect(() => {
    const handleCustomSelect = (e: Event) => {
      const slug = (e as CustomEvent<string>).detail;
      if (slug) handleSelectBuddy(slug);
    };
    window.addEventListener("buddy:selected", handleCustomSelect);
    return () => window.removeEventListener("buddy:selected", handleCustomSelect);
  }, [handleSelectBuddy]);

  // Send message to Gemini backend
  const send = async (text: string) => {
    const cleanText = text.trim();
    if (!cleanText || isSubmitting) return;

    setIsSubmitting(true);
    setError(null);
    const id = ++reqId.current;

    buddy.setEmotion(BUDDY_EMOTION_STATES.THINKING, {
      reason: `${activePreset.name} is thinking…`,
    });

    smartScroll.notifyUserMessageSent();
    const userTurn: ChatTurn = { role: "user", text: cleanText, timestamp: Date.now() };
    const updatedTurns = [...turnsRef.current, userTurn];
    setTurns(updatedTurns);

    try {
      const historyContext = updatedTurns.slice(-8).map((t) => ({
        role: t.role,
        text: t.text,
      }));

      const res = await quickTalk({
        data: {
          text: cleanText,
          buddySlug: selectedSlug,
          history: historyContext,
        },
      });

      if (id !== reqId.current) return;

      if (res.ok) {
        const replyText = res.reply;
        const buddyTurn: ChatTurn = {
          role: "buddy",
          text: replyText,
          buddyName: res.buddyName || activePreset.name,
          model: res.model,
          timestamp: Date.now(),
        };

        setTurns((prev) => [...prev, buddyTurn]);
        buddy.setEmotion(BUDDY_EMOTION_STATES.SPEAKING, {
          reason: `${activePreset.name} is replying`,
        });

        if (!muted && speaker.current) {
          const isHindi = /[\u0900-\u097F]/.test(replyText);
          const lang = isHindi
            ? "hi-IN"
            : activePreset.default_language === "english"
              ? "en-IN"
              : "hi-IN";

          const spoke = speaker.current.speak(replyText, lang, () => {
            if (id === reqId.current) {
              buddy.setEmotion(BUDDY_EMOTION_STATES.HAPPY, {
                durationMs: 2000,
                revertTo: BUDDY_EMOTION_STATES.IDLE,
                reason: "Finished reply",
              });
            }
          });

          if (!spoke) {
            buddy.setEmotion(BUDDY_EMOTION_STATES.HAPPY, {
              durationMs: 1800,
              revertTo: BUDDY_EMOTION_STATES.IDLE,
            });
          }
        } else {
          buddy.setEmotion(BUDDY_EMOTION_STATES.HAPPY, {
            durationMs: 2000,
            revertTo: BUDDY_EMOTION_STATES.IDLE,
          });
        }
      } else {
        setError(res.reply);
        setTurns((prev) => [
          ...prev,
          {
            role: "buddy",
            text: res.reply,
            buddyName: activePreset.name,
          },
        ]);
        buddy.setEmotion(BUDDY_EMOTION_STATES.ERROR, {
          durationMs: 3000,
          revertTo: BUDDY_EMOTION_STATES.IDLE,
          reason: res.reply,
        });
      }
    } catch (err) {
      if (id !== reqId.current) return;
      const errorMsg = "Could not reach the AI service right now. Please try again.";
      setError(errorMsg);
      buddy.setEmotion(BUDDY_EMOTION_STATES.ERROR, {
        durationMs: 3000,
        revertTo: BUDDY_EMOTION_STATES.IDLE,
        reason: "Network connection error",
      });
    } finally {
      if (id === reqId.current) {
        setIsSubmitting(false);
      }
    }
  };

  const finishSpeech = () => {
    if (timer.current) clearTimeout(timer.current);
    rec.current?.stop();
    const said = latest.current.trim();
    latest.current = "";
    setTranscript("");
    if (said && !isFillerOnly(said)) {
      void send(said);
    } else {
      buddy.setEmotion(BUDDY_EMOTION_STATES.IDLE);
    }
  };

  const startListening = () => {
    setError(null);
    reqId.current++;
    speaker.current?.cancel();
    const r = getRecognition();
    if (!r) {
      setError("Speech recognition is not supported in this browser. Please type below.");
      return;
    }
    r.lang = activePreset.default_language === "english" ? "en-IN" : "hi-IN";
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e) => {
      const said = Array.from(e.results)
        .map((x) => x[0]?.transcript ?? "")
        .join(" ");
      latest.current = said;
      setTranscript(said);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(finishSpeech, endpointDelayMs(said));
    };
    r.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      setError(
        e.error === "not-allowed"
          ? "Microphone access blocked. Allow permissions in your browser or type below."
          : `Speech error: ${e.error}. Try speaking again.`,
      );
      buddy.setEmotion(BUDDY_EMOTION_STATES.CONFUSED, {
        durationMs: 2500,
        revertTo: BUDDY_EMOTION_STATES.IDLE,
        reason: "Microphone error",
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
    setIsSubmitting(false);
    buddy.setEmotion(BUDDY_EMOTION_STATES.IDLE, { reason: "Canceled" });
  };

  const clearChat = () => {
    stopAll();
    smartScroll.notifyUserMessageSent();
    const welcomeTurn: ChatTurn = {
      role: "buddy",
      text: `Chat reset. I am ${activePreset.name}. How can I assist you?`,
      buddyName: activePreset.name,
    };
    setTurns([welcomeTurn]);
    if (typeof window !== "undefined") {
      localStorage.removeItem(`buddy_turns_${selectedSlug}`);
    }
  };

  const onBuddyClick = () => {
    if (buddy.isListening) finishSpeech();
    else if (buddy.isIdle) startListening();
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
    ? "Listening… tap to send"
    : buddy.isThinking
      ? "Thinking with Gemini…"
      : buddy.isSpeaking
        ? "Speaking… tap to stop"
        : `Tap ${activePreset.name} to speak`;

  return (
    <div className="panel flex flex-col gap-6 p-6 sm:p-8">
      {/* 1. TOP BUDDY SELECTOR: Choose Any of the 15 Specialist Buddies */}
      <div className="border-b border-border/70 pb-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            <span className="font-semibold text-sm">Select Your AI Buddy</span>
            <Badge variant="outline" className="text-[11px] font-mono">
              {activePreset.name}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMuted(!muted)}
              className="flex items-center gap-1.5 rounded-lg border border-border/80 px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              title={muted ? "Unmute Voice" : "Mute Voice"}
            >
              {muted ? (
                <VolumeX className="size-3.5" />
              ) : (
                <Volume2 className="size-3.5 text-primary" />
              )}
              <span>{muted ? "Muted" : "Voice On"}</span>
            </button>
            <div className="flex rounded-lg border border-border p-0.5">
              <button
                type="button"
                onClick={() => setCharacterMode("living")}
                className={`rounded-md px-2 py-0.5 text-xs transition-colors ${
                  characterMode === "living"
                    ? "bg-primary text-primary-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                3D Rig
              </button>
              <button
                type="button"
                onClick={() => setCharacterMode("avatar")}
                className={`rounded-md px-2 py-0.5 text-xs transition-colors ${
                  characterMode === "avatar"
                    ? "bg-primary text-primary-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                2D Badge
              </button>
            </div>
          </div>
        </div>

        {/* Horizontal scrollable Buddy switcher bar */}
        <div className="flex gap-2 overflow-x-auto pb-1.5 scrollbar-thin scrollbar-thumb-muted-foreground/20">
          {BUDDY_PRESETS.map((preset) => {
            const isSelected = preset.slug === selectedSlug;
            return (
              <button
                key={preset.slug}
                type="button"
                onClick={() => handleSelectBuddy(preset.slug)}
                className={`flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs shrink-0 transition-all ${
                  isSelected
                    ? "bg-primary text-primary-foreground font-semibold shadow-sm scale-102"
                    : "bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <BuddyAvatar buddyId={preset.slug} size={22} variant="2d" animated={false} />
                <span>{preset.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 2. MAIN CHAT STAGE & BUDDY CHARACTER */}
      <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
        {/* Left Column: Interactive Character & Emotion Controls */}
        <div className="flex flex-col items-center gap-3 sm:w-64 shrink-0">
          <div
            onClick={onBuddyClick}
            className={`relative rounded-3xl transition-transform hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer ${
              buddy.isListening ? "ring-4 ring-primary/40 rounded-full" : ""
            }`}
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
                slug={selectedSlug}
                buddyId={selectedSlug}
                size={170}
                onTap={() => {
                  if (buddy.isIdle) startListening();
                }}
              />
            ) : (
              <div className="p-4">
                <BuddyAvatar buddyId={selectedSlug} emotion={emotion} size={135} />
              </div>
            )}
          </div>

          <div className="text-center">
            <p className="text-sm font-semibold">{activePreset.name}</p>
            <p className="text-xs text-muted-foreground line-clamp-1">{activePreset.tagline}</p>
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap justify-center gap-2">
            {!buddy.isIdle || isSubmitting ? (
              <Button size="sm" variant="secondary" onClick={stopAll}>
                <Square className="mr-1.5 size-3.5" /> Stop
              </Button>
            ) : (
              supported !== false && (
                <Button size="sm" onClick={startListening} className="rounded-xl">
                  <Mic className="mr-1.5 size-4" /> Push to Talk
                </Button>
              )
            )}
            <Button size="sm" variant="ghost" onClick={clearChat} title="Clear conversation">
              <RotateCcw className="size-3.5" />
            </Button>
          </div>

          {/* Active Model Indicator */}
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mt-1">
            <Cpu className="size-3 text-primary" />
            <span>Backend: Google Gemini (Active)</span>
          </div>
        </div>

        {/* Right Column: Chat History and Text Input */}
        <div className="flex-1 space-y-4 text-sm min-w-0">
          {/* Scrollable conversation history with smart sticky auto-scroll */}
          <div className="relative">
            <div
              ref={smartScroll.containerRef}
              onScroll={smartScroll.handleScroll}
              className="max-h-80 min-h-[190px] space-y-3 overflow-y-auto rounded-2xl bg-muted/20 p-4 border border-border/60"
            >
              {turns.length === 0 && !transcript && (
                <div className="text-muted-foreground space-y-1">
                  <p className="font-medium text-foreground">Ask {activePreset.name} anything:</p>
                  <p>• “Explain this page to me in simple terms”</p>
                  <p>• “What should I check before submitting?”</p>
                  <p>• “Help me draft a plan for this task”</p>
                </div>
              )}
              {turns.map((t, i) => (
                <div
                  key={i}
                  className={
                    t.role === "user"
                      ? "ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-4 py-2.5 text-primary-foreground text-xs sm:text-sm min-w-0 break-words"
                      : "mr-auto max-w-[92%] rounded-2xl rounded-bl-sm bg-card border border-border/80 px-4 py-3 text-card-foreground text-xs sm:text-sm min-w-0 break-words"
                  }
                >
                  {t.role === "buddy" && (
                    <div className="flex items-center justify-between gap-2 text-[11px] font-semibold text-primary mb-1.5 pb-1 border-b border-border/40">
                      <span className="truncate">{t.buddyName || activePreset.name}</span>
                      {t.model && (
                        <span className="font-mono text-[10px] font-normal text-muted-foreground shrink-0">
                          {t.model}
                        </span>
                      )}
                    </div>
                  )}
                  <ChatMarkdown
                    content={t.text}
                    variant={t.role === "user" ? "user" : "assistant"}
                  />
                </div>
              ))}

              {/* Hearing live transcription */}
              {transcript && (
                <p className="ml-auto w-fit max-w-[85%] rounded-xl bg-muted px-3.5 py-2 text-muted-foreground text-xs italic break-words">
                  Hearing: {transcript}…
                </p>
              )}

              {/* In-flight loading indicator */}
              {isSubmitting && (
                <div className="mr-auto max-w-[80%] rounded-2xl rounded-bl-sm bg-card border border-border/80 px-3.5 py-2.5 text-muted-foreground text-xs flex items-center gap-2">
                  <span className="size-2 rounded-full bg-primary/70" aria-hidden="true" />
                  <span>{activePreset.name} is consulting Gemini…</span>
                </div>
              )}
            </div>

            {!smartScroll.isAtBottom && (
              <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={smartScroll.jumpToLatest}
                  className="pointer-events-auto h-7 rounded-lg border border-border bg-card/95 px-3 text-xs font-medium text-foreground shadow-sm hover:bg-muted"
                >
                  <ArrowDown className="mr-1.5 size-3.5 text-primary" />
                  {smartScroll.hasUnread ? "New messages" : "Jump to latest"}
                </Button>
              </div>
            )}
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          {/* Text Input & Send Button Form */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (typedInput.trim() && !isSubmitting) {
                const text = typedInput.trim();
                setTypedInput("");
                void send(text);
              }
            }}
            className="flex gap-2"
          >
            <input
              type="text"
              value={typedInput}
              disabled={isSubmitting}
              onChange={(e) => setTypedInput(e.target.value)}
              placeholder={`Message ${activePreset.name}… (Press Enter to send)`}
              className="flex-1 rounded-xl border border-input bg-background/90 px-3.5 py-2.5 text-xs sm:text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            />
            <Button
              type="submit"
              size="default"
              disabled={!typedInput.trim() || isSubmitting}
              className="rounded-xl px-4"
              aria-label="Send message"
            >
              <Send className="size-4" />
            </Button>
          </form>

          {/* Specialist expertise tags */}
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <span className="text-[11px] text-muted-foreground">Specialist skills:</span>
            {activePreset.expertise.map((tag) => (
              <Badge key={tag} variant="outline" className="text-[10px] px-2 py-0">
                {tag}
              </Badge>
            ))}
          </div>

          {/* Manual CSS Emotion Testing Row */}
          <div className="pt-3 border-t border-border/50 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold text-muted-foreground mr-1">
              Test CSS Emotion:
            </span>
            {(
              [
                { id: "curious", label: "Curious", emoji: "🧐" },
                { id: "concerned", label: "Concerned", emoji: "😟" },
                { id: "happy", label: "Happy", emoji: "😄" },
                { id: "thinking", label: "Thinking", emoji: "🤔" },
                { id: "speaking", label: "Speaking", emoji: "🗣️" },
                { id: "listening", label: "Listening", emoji: "👂" },
                { id: "celebrate", label: "Celebrate", emoji: "🎉" },
                { id: "surprised", label: "Surprised", emoji: "😲" },
              ] as const
            ).map((emo) => (
              <button
                key={emo.id}
                type="button"
                onClick={() => {
                  buddy.setEmotion(emo.id as unknown as TalkingBuddyState, {
                    reason: `Manual test: ${emo.label}`,
                    durationMs: 3000,
                  });
                }}
                className="px-2 py-1 text-xs rounded-lg border border-border bg-background/80 hover:bg-muted text-foreground transition-all flex items-center gap-1 font-medium hover:border-primary/50"
              >
                <span>{emo.emoji}</span>
                <span>{emo.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
