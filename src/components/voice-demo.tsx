import { Mic, MicOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { BuddyAvatar, type BuddyEmotion } from "@/components/buddy-avatar";

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};

function getRecognition(): SpeechRecognitionLike | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

const INTENTS: Array<{ match: RegExp; label: string }> = [
  { match: /\b(explain|samjh|what is this|batao)\b/i, label: "Explain this page" },
  { match: /\b(open|kholo|navigate|go to)\b/i, label: "Open a site or page" },
  { match: /\b(fill|bharo|form)\b/i, label: "Fill a form (with your approval)" },
  { match: /\b(click|dabao|press)\b/i, label: "Click an element" },
  { match: /\b(remember|yaad rakho)\b/i, label: "Save to memory" },
  { match: /\b(repeat|dobara|again)\b/i, label: "Repeat a saved workflow" },
  { match: /\b(error|fix|theek)\b/i, label: "Diagnose an error" },
];

/**
 * A real, local push-to-talk demo: speech is transcribed by the browser and the
 * command is classified on-device. No answer is faked — answering needs a signed-in
 * Buddy, which we say plainly.
 */
export function VoiceDemo() {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    setSupported(Boolean(getRecognition()));
    return () => recognitionRef.current?.stop();
  }, []);

  const start = () => {
    setError(null);
    const recognition = getRecognition();
    if (!recognition) {
      setError("This browser cannot transcribe speech. Chrome or Edge on desktop works best.");
      return;
    }
    recognitionRef.current = recognition;
    recognition.lang = "en-IN";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      const chunks: string[] = [];
      for (let i = 0; i < event.results.length; i += 1) {
        const alt = event.results[i]?.[0];
        if (alt) chunks.push(alt.transcript);
      }
      setTranscript(chunks.join(" ").trim());
    };
    recognition.onerror = (event) => {
      setError(
        event.error === "not-allowed"
          ? "Microphone permission was blocked, so I cannot hear you."
          : `Speech recognition stopped: ${event.error}.`,
      );
      setListening(false);
    };
    recognition.onend = () => setListening(false);
    recognition.start();
    setListening(true);
  };

  const stop = () => {
    recognitionRef.current?.stop();
    setListening(false);
  };

  const intent = INTENTS.find((i) => i.match.test(transcript));
  const emotion: BuddyEmotion = listening ? "listening" : transcript ? "curious" : "neutral";

  return (
    <div className="panel flex flex-col gap-5 p-6 sm:flex-row sm:items-center">
      <div className="flex flex-col items-center gap-3">
        <BuddyAvatar emotion={emotion} size={104} />
        <Button
          type="button"
          onClick={listening ? stop : start}
          variant={listening ? "secondary" : "default"}
          disabled={supported === false}
        >
          {listening ? <MicOff className="mr-2 size-4" /> : <Mic className="mr-2 size-4" />}
          {listening ? "Stop" : "Hold a mic test"}
        </Button>
      </div>
      <div className="flex-1 space-y-2 text-sm">
        <p className="font-medium text-foreground">Say something like “Hey Buddy, explain this page”.</p>
        <p className="min-h-10 rounded-md border border-border bg-muted/40 p-3 text-muted-foreground">
          {transcript || (listening ? "Listening…" : "Your words will appear here.")}
        </p>
        {intent && (
          <p className="text-foreground">
            Understood as: <span className="font-medium">{intent.label}</span>
          </p>
        )}
        {error && <p className="text-destructive">{error}</p>}
        {supported === false && (
          <p className="text-destructive">
            Speech recognition is not available in this browser, so the mic test is disabled.
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          This demo only transcribes and classifies on your device. Real answers and actions need a
          signed-in Buddy, and always ask before acting.
        </p>
      </div>
    </div>
  );
}
