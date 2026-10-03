import { Keyboard, Mic, Send, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { endpointDelayMs, isFillerOnly } from "@/shared/voice-turn";

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

function createRecognition(): Recognition | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => Recognition;
    webkitSpeechRecognition?: new () => Recognition;
  };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

/**
 * Voice-first input (spec §29.7). Push-to-talk with ~1.5 s silence endpointing;
 * filler-only speech is ignored; typing is the fallback.
 */
export function VoiceBar({
  busy,
  lang,
  onSubmit,
  onStop,
  onListeningChange,
}: {
  busy: boolean;
  lang: string;
  onSubmit: (text: string) => void;
  onStop: () => void;
  onListeningChange?: (listening: boolean) => void;
}) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [typing, setTyping] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef("");

  useEffect(() => {
    setSupported(Boolean(createRecognition()));
    return () => {
      rec.current?.stop();
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  useEffect(() => onListeningChange?.(listening), [listening, onListeningChange]);

  const finish = () => {
    if (timer.current) clearTimeout(timer.current);
    rec.current?.stop();
    const said = latest.current.trim();
    latest.current = "";
    setTranscript("");
    if (said && !isFillerOnly(said)) onSubmit(said);
  };

  const start = () => {
    setError(null);
    onStop(); // barge-in: silence any reply before listening
    const r = createRecognition();
    if (!r) {
      setTyping(true);
      return;
    }
    r.lang = lang;
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e) => {
      const said = Array.from(e.results)
        .map((res) => res[0]?.transcript ?? "")
        .join(" ");
      latest.current = said;
      setTranscript(said);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(finish, endpointDelayMs(said));
    };
    r.onerror = (e) => {
      if (e.error !== "no-speech" && e.error !== "aborted") {
        setError(
          e.error === "not-allowed"
            ? "Microphone access was blocked. Allow it in the browser, or type instead."
            : "I could not hear that clearly. Try again or type instead.",
        );
      }
    };
    r.onend = () => setListening(false);
    rec.current = r;
    r.start();
    setListening(true);
  };

  return (
    <div className="glass mx-auto w-full max-w-xl p-3">
      {typing || !supported ? (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) {
              onSubmit(text.trim());
              setText("");
            }
          }}
        >
          {supported && (
            <Button type="button" size="icon" variant="ghost" onClick={() => setTyping(false)} aria-label="Use voice">
              <Mic className="size-4" />
            </Button>
          )}
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type to your Buddy…"
            maxLength={2000}
            className="border-0 bg-transparent focus-visible:ring-0"
          />
          {busy ? (
            <Button type="button" size="icon" variant="secondary" onClick={onStop} aria-label="Stop">
              <Square className="size-4" />
            </Button>
          ) : (
            <Button type="submit" size="icon" disabled={!text.trim()} aria-label="Send">
              <Send className="size-4" />
            </Button>
          )}
        </form>
      ) : (
        <div className="flex items-center gap-3">
          <Button
            size="icon"
            className={`size-12 rounded-full ${listening ? "animate-buddy-pulse" : ""}`}
            onClick={listening ? finish : start}
            aria-label={listening ? "Finish speaking" : "Talk to AI Buddy"}
          >
            {listening ? <Square className="size-5" /> : <Mic className="size-5" />}
          </Button>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">
              {listening ? "Listening…" : busy ? "Buddy is working…" : "Talk to AI Buddy"}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {transcript || (listening ? "Take your time — I wait for you to finish." : "“What can I do for you?”")}
            </p>
          </div>
          {busy && (
            <Button size="sm" variant="secondary" onClick={onStop}>
              Stop
            </Button>
          )}
          <Button size="icon" variant="ghost" onClick={() => setTyping(true)} aria-label="Type instead">
            <Keyboard className="size-4" />
          </Button>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  );
}
