import { Mic, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { BuddyAvatar, type BuddyEmotion } from "@/components/buddy-avatar";
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

type Status = "idle" | "listening" | "thinking" | "speaking";
type Turn = { role: "user" | "buddy"; text: string };

/** Click Buddy → it listens, sends your words to the AI, and speaks the reply. */
export function VoiceDemo() {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [transcript, setTranscript] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef("");
  const speaker = useRef<SingleSpeaker | null>(null);
  const turnsRef = useRef<Turn[]>([]);
  const reqId = useRef(0);

  useEffect(() => {
    setSupported(Boolean(getRecognition()));
    speaker.current = new SingleSpeaker("speechSynthesis" in window ? window.speechSynthesis : null);
    return () => {
      rec.current?.abort?.();
      speaker.current?.cancel();
    };
  }, []);

  const send = async (text: string) => {
    const id = ++reqId.current;
    setStatus("thinking");
    const history = turnsRef.current.slice(-6);
    turnsRef.current = [...turnsRef.current, { role: "user", text }];
    setTurns(turnsRef.current);
    try {
      const res = await quickTalk({ data: { text, history } });
      if (id !== reqId.current) return;
      turnsRef.current = [...turnsRef.current, { role: "buddy", text: res.reply }];
      setTurns(turnsRef.current);
      if (!res.ok) setError(res.reply);
      setStatus("speaking");
      const spoke = speaker.current?.speak(res.reply, /[\u0900-\u097F]/.test(res.reply) ? "hi-IN" : "en-IN", () => {
        if (id === reqId.current) setStatus("idle");
      });
      if (!spoke) setStatus("idle");
    } catch {
      if (id !== reqId.current) return;
      setError("I could not reach the AI right now. Try again.");
      setStatus("idle");
    }
  };

  const finish = () => {
    if (timer.current) clearTimeout(timer.current);
    rec.current?.stop();
    const said = latest.current.trim();
    latest.current = "";
    setTranscript("");
    if (said && !isFillerOnly(said)) void send(said);
    else setStatus("idle");
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
      setStatus("idle");
    };
    r.onend = () => setStatus((s) => (s === "listening" ? "idle" : s));
    rec.current = r;
    r.start();
    setStatus("listening");
  };

  const stopAll = () => {
    reqId.current++;
    if (timer.current) clearTimeout(timer.current);
    rec.current?.abort?.();
    speaker.current?.cancel();
    setStatus("idle");
  };

  const onBuddyClick = () => {
    if (status === "listening") finish();
    else if (status === "idle") start();
    else stopAll();
  };

  const emotion: BuddyEmotion =
    status === "listening" ? "listening" : status === "thinking" ? "thinking" : status === "speaking" ? "speaking" : "neutral";
  const label =
    status === "listening" ? "Listening… tap to finish" : status === "thinking" ? "Thinking…" : status === "speaking" ? "Speaking… tap to stop" : "Tap Buddy and speak";

  return (
    <div className="panel flex flex-col gap-5 p-6 sm:flex-row sm:items-start">
      <div className="flex flex-col items-center gap-3">
        <button
          type="button"
          onClick={onBuddyClick}
          disabled={supported === false}
          aria-label={label}
          className={`rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${status === "listening" ? "animate-buddy-pulse ring-2 ring-primary" : ""}`}
        >
          <BuddyAvatar emotion={emotion} size={120} />
        </button>
        <p className="text-sm font-medium">{label}</p>
        {status !== "idle" && (
          <Button size="sm" variant="secondary" onClick={stopAll}>
            <Square className="mr-2 size-3" /> Stop
          </Button>
        )}
        {status === "idle" && supported !== false && (
          <Button size="sm" onClick={start}>
            <Mic className="mr-2 size-4" /> Talk
          </Button>
        )}
      </div>
      <div className="flex-1 space-y-2 text-sm">
        <div className="max-h-64 space-y-2 overflow-y-auto">
          {turns.length === 0 && !transcript && (
            <p className="text-muted-foreground">Say anything — “Hi Buddy, aaj kya seekhein?”</p>
          )}
          {turns.map((t, i) => (
            <p
              key={i}
              className={t.role === "user" ? "ml-auto w-fit max-w-[85%] rounded-lg bg-primary px-3 py-2 text-primary-foreground" : "max-w-[85%] text-foreground"}
            >
              {t.text}
            </p>
          ))}
          {transcript && <p className="ml-auto w-fit max-w-[85%] rounded-lg bg-muted px-3 py-2 text-muted-foreground">{transcript}</p>}
        </div>
        {error && <p className="text-destructive">{error}</p>}
        {supported === false && (
          <p className="text-destructive">Speech is not available in this browser. Use Chrome or Edge.</p>
        )}
        <p className="text-xs text-muted-foreground">Testing mode: Buddy only listens and replies. It does not act on pages.</p>
      </div>
    </div>
  );
}
