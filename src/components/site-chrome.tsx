import { Link, useRouter } from "@tanstack/react-router";
import {
  Download,
  ExternalLink,
  LogIn,
  Monitor,
  Moon,
  PanelRight,
  Sparkles,
  Sun,
} from "lucide-react";
import { useEffect, useState } from "react";

import { BuddyLogo } from "@/components/buddy-logo";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useTheme } from "@/components/theme-provider";
import { supabase } from "@/integrations/supabase/client";

interface WindowWithExtension {
  __AI_BUDDY_EXTENSION__?: boolean;
  aiBuddyExtension?: { version?: string; installed?: boolean };
  chrome?: {
    runtime?: { id?: string };
    sidePanel?: { open?: () => Promise<void> | void };
  };
}

function getExtensionWindow(): WindowWithExtension | undefined {
  if (typeof window === "undefined") return undefined;
  return window as unknown as WindowWithExtension;
}

function SidePanelButton({ signedIn }: { signedIn: boolean | null }) {
  const [extensionPresent, setExtensionPresent] = useState(false);
  const [installModalOpen, setInstallModalOpen] = useState(false);
  const [manualModalOpen, setManualModalOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // In-page side panel chat state
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [emotion, setEmotion] = useState<string>("idle");
  const [statusText, setStatusText] = useState("Ready to help you on this page.");
  const [messages, setMessages] = useState<Array<{ role: "user" | "buddy"; text: string }>>([
    {
      role: "buddy",
      text: "Namaste! Main hoon aapka AI Buddy. Main is page ko dekh aur samajh sakta hoon. Kahiye, kya madad chahiye?",
    },
  ]);
  const [lastHighlight, setLastHighlight] = useState<string | null>(null);

  useEffect(() => {
    const extWin = getExtensionWindow();
    if (!extWin) return;

    // 1. Check window properties
    if (
      Boolean(extWin.__AI_BUDDY_EXTENSION__) ||
      Boolean(extWin.aiBuddyExtension) ||
      Boolean(extWin.chrome?.runtime?.id)
    ) {
      setExtensionPresent(true);
    }

    // 2. Listen for custom presence event dispatched by extension
    const handleExtensionReady = () => setExtensionPresent(true);
    window.addEventListener("AI_BUDDY_EXTENSION_READY", handleExtensionReady);

    // 3. Ping probe to extension content script
    const handleMessage = (e: MessageEvent) => {
      if (e.source !== window || e.origin !== window.location.origin) return;
      if (e.data?.type === "AI_BUDDY_PONG" || e.data?.type === "AI_BUDDY_EXT_ACK") {
        setExtensionPresent(true);
      }
    };
    window.addEventListener("message", handleMessage);
    window.postMessage({ type: "AI_BUDDY_PING" }, window.location.origin);

    return () => {
      window.removeEventListener("AI_BUDDY_EXTENSION_READY", handleExtensionReady);
      window.removeEventListener("message", handleMessage);
    };
  }, []);

  const handleOpen = () => {
    const extWin = getExtensionWindow();
    const isInstalled =
      extensionPresent ||
      (extWin !== undefined &&
        (Boolean(extWin.__AI_BUDDY_EXTENSION__) ||
          Boolean(extWin.aiBuddyExtension) ||
          Boolean(extWin.chrome?.runtime?.id)));

    // Open the interactive in-page Side Panel drawer immediately
    setDrawerOpen(true);

    if (isInstalled) {
      // If extension is present, also trigger Chrome extension side panel
      const chromeObj = extWin?.chrome;
      if (chromeObj?.sidePanel?.open && typeof chromeObj.sidePanel.open === "function") {
        try {
          void chromeObj.sidePanel.open();
        } catch {
          // Handled gracefully
        }
      }

      if (typeof window !== "undefined") {
        window.postMessage({ type: "AI_BUDDY_OPEN_PANEL" }, window.location.origin);
      }
    }
  };

  const handleHighlight = (selector: string) => {
    if (typeof document === "undefined") return;
    const el = document.querySelector(selector);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    const originalBorder = (el as HTMLElement).style.outline;
    (el as HTMLElement).style.outline = "3px solid #14b8a6";
    (el as HTMLElement).style.outlineOffset = "4px";
    setTimeout(() => {
      (el as HTMLElement).style.outline = originalBorder;
    }, 4000);
  };

  const speak = (text: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = /[\u0900-\u097F]/.test(text) ? "hi-IN" : "en-IN";
    utterance.onstart = () => setEmotion("speaking");
    utterance.onend = () => setEmotion("idle");
    utterance.onerror = () => setEmotion("idle");
    window.speechSynthesis.speak(utterance);
  };

  const askInPage = async (text: string) => {
    if (!text.trim() || busy) return;
    const q = text.trim();
    setQuery("");
    setBusy(true);
    setEmotion("thinking");
    setStatusText("Analyzing current page & generating reply…");
    setMessages((prev) => [...prev, { role: "user", text: q }]);

    // Extract light page snapshot
    let pageTitle = "";
    let pageHeadings: string[] = [];
    if (typeof document !== "undefined") {
      pageTitle = document.title;
      pageHeadings = Array.from(document.querySelectorAll("h1, h2, h3"))
        .map((h) => h.textContent?.trim() || "")
        .filter(Boolean)
        .slice(0, 10);
    }

    try {
      const res = await fetch("/api/public/extension/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          question: q,
          intent: "answer",
          snapshot: {
            url: typeof window !== "undefined" ? window.location.href : "",
            title: pageTitle,
            headings: pageHeadings.map((h, i) => ({
              ref: `h_${i}`,
              role: "heading",
              name: h,
              tag: "h2",
              selector: `h1, h2, h3`,
            })),
          },
        }),
      });

      const data = (await res.json()) as {
        reply?: { answer?: string; emotion?: string };
        highlightSelector?: string;
        message?: string;
      };

      const replyText =
        data.reply?.answer || data.message || "Buddy has analyzed your request on this page.";
      const backendEmotion = data.reply?.emotion || "idle";

      setMessages((prev) => [...prev, { role: "buddy", text: replyText }]);
      setEmotion(data.highlightSelector ? "pointing" : backendEmotion);
      setStatusText(data.highlightSelector ? "Highlighting element on page" : "Answered.");

      if (data.highlightSelector) {
        setLastHighlight(data.highlightSelector);
        handleHighlight(data.highlightSelector);
      }

      speak(replyText);
    } catch {
      const fallback =
        "AI Buddy is ready. You are currently browsing AI Buddy's voice-first companion platform.";
      setMessages((prev) => [...prev, { role: "buddy", text: fallback }]);
      setEmotion("idle");
      setStatusText("Ready.");
    } finally {
      setBusy(false);
    }
  };

  const startVoice = () => {
    if (typeof window === "undefined") return;
    interface SpeechEvent {
      results?: Array<Array<{ transcript?: string }>>;
    }
    interface SpeechInstance {
      lang: string;
      onstart: (() => void) | null;
      onresult: ((event: SpeechEvent) => void) | null;
      onerror: (() => void) | null;
      onend: (() => void) | null;
      start: () => void;
    }
    type SpeechConstructor = new () => SpeechInstance;

    const SpeechRec =
      (window as unknown as { SpeechRecognition?: SpeechConstructor }).SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: SpeechConstructor })
        .webkitSpeechRecognition;

    if (!SpeechRec) {
      alert("Speech recognition is not supported in this browser.");
      return;
    }

    try {
      const recognition = new SpeechRec();
      recognition.lang = "en-IN";
      recognition.onstart = () => {
        setEmotion("listening");
        setStatusText("Listening to your voice…");
      };
      recognition.onresult = (event: SpeechEvent) => {
        const transcript = event.results?.[0]?.[0]?.transcript || "";
        if (transcript) void askInPage(transcript);
      };
      recognition.onerror = () => {
        setEmotion("idle");
        setStatusText("Voice input ended.");
      };
      recognition.onend = () => {
        setEmotion("idle");
      };
      recognition.start();
    } catch {
      setStatusText("Could not start microphone.");
    }
  };

  return (
    <>
      <Button
        onClick={handleOpen}
        variant="outline"
        size="sm"
        className="gap-1.5 border-teal-500/40 text-teal-600 dark:text-teal-400 hover:bg-teal-500/10 hover:border-teal-500 shadow-sm transition-all"
      >
        <Sparkles className="size-3.5 text-teal-500 animate-pulse" />
        <span className="font-medium">Side Panel</span>
        <span
          className={`size-2 rounded-full ${
            extensionPresent ? "bg-emerald-500 ring-2 ring-emerald-500/30" : "bg-teal-400"
          }`}
          title={extensionPresent ? "Extension connected" : "Web Side Panel Ready"}
        />
      </Button>

      {/* Interactive In-Page AI Buddy Side Panel Drawer */}
      {drawerOpen && (
        <aside
          role="complementary"
          aria-label="AI Buddy Side Panel"
          className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-border bg-background/95 backdrop-blur-xl shadow-2xl sm:w-[410px] animate-in slide-in-from-right duration-300"
        >
          {/* Drawer Header */}
          <div className="flex items-center justify-between border-b border-border/80 p-3.5 bg-card/60">
            <div className="flex items-center gap-2.5">
              <BuddyLogo size={36} />
              <div>
                <div className="flex items-center gap-1.5">
                  <h2 className="font-semibold text-sm leading-none">AI Buddy</h2>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                      emotion === "speaking"
                        ? "bg-amber-500/20 text-amber-500"
                        : emotion === "thinking"
                          ? "bg-blue-500/20 text-blue-500"
                          : emotion === "pointing"
                            ? "bg-purple-500/20 text-purple-500"
                            : "bg-teal-500/20 text-teal-500"
                    }`}
                  >
                    {emotion}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5 truncate max-w-[210px]">
                  {statusText}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-muted-foreground hover:text-foreground"
                onClick={() =>
                  extensionPresent ? setManualModalOpen(true) : setInstallModalOpen(true)
                }
                title="Extension Shortcut & Info"
              >
                <PanelRight className="size-4 text-teal-500" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-muted-foreground hover:text-foreground"
                onClick={() => setDrawerOpen(false)}
                title="Close Side Panel"
              >
                <span className="text-base font-bold leading-none">✕</span>
              </Button>
            </div>
          </div>

          {/* Quick Action Chips */}
          <div className="flex items-center gap-1.5 overflow-x-auto p-2 border-b border-border/60 bg-muted/20 text-xs no-scrollbar">
            <button
              onClick={() => askInPage("Explain this page simply in Hinglish.")}
              className="shrink-0 rounded-full border border-teal-500/30 bg-teal-500/10 px-2.5 py-1 text-[11px] font-medium text-teal-600 dark:text-teal-400 hover:bg-teal-500/20 transition-colors"
            >
              ⚡ Explain page
            </button>
            <button
              onClick={() => askInPage("Where do I sign in or create an account?")}
              className="shrink-0 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              🔑 Sign in help
            </button>
            <button
              onClick={() => askInPage("Highlight the main buttons or actions on this screen.")}
              className="shrink-0 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              👉 Highlight actions
            </button>
          </div>

          {/* Message Thread */}
          <div className="flex-1 overflow-y-auto p-3.5 space-y-3">
            {messages.map((m, idx) => (
              <div
                key={idx}
                className={`flex flex-col ${
                  m.role === "user" ? "items-end" : "items-start"
                } space-y-1`}
              >
                <div
                  className={`rounded-2xl px-3.5 py-2.5 text-xs max-w-[85%] leading-relaxed ${
                    m.role === "user"
                      ? "bg-teal-600 text-white rounded-br-xs shadow-sm"
                      : "bg-muted/80 text-foreground border border-border/70 rounded-bl-xs"
                  }`}
                >
                  {m.text}
                </div>
                {m.role === "buddy" && (
                  <button
                    onClick={() => speak(m.text)}
                    className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-teal-500 pl-1"
                  >
                    <span>🔊 Listen</span>
                  </button>
                )}
              </div>
            ))}
            {busy && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground p-2 rounded-lg bg-muted/30">
                <span className="size-2 rounded-full bg-teal-500 animate-ping" />
                <span>Buddy is reading page &amp; thinking…</span>
              </div>
            )}
            {lastHighlight && (
              <div className="p-2 rounded-lg border border-teal-500/30 bg-teal-500/10 text-xs flex items-center justify-between">
                <span className="text-teal-600 dark:text-teal-400 font-medium truncate max-w-[200px]">
                  Pointing at: {lastHighlight}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 text-[10px] px-2 border-teal-500/40 text-teal-600 dark:text-teal-400"
                  onClick={() => handleHighlight(lastHighlight)}
                >
                  Show again
                </Button>
              </div>
            )}
          </div>

          {/* Input Footer */}
          <div className="p-3 border-t border-border/80 bg-card/60 space-y-2">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                askInPage(query);
              }}
              className="flex items-center gap-1.5"
            >
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Ask Buddy anything about this page…"
                className="flex-1 rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-teal-500"
                disabled={busy}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={startVoice}
                disabled={busy}
                className="size-8.5 rounded-xl border-border text-muted-foreground hover:text-foreground shrink-0"
                title="Speak voice query"
              >
                <span className="text-xs">🎤</span>
              </Button>
              <Button
                type="submit"
                size="icon"
                disabled={busy || !query.trim()}
                className="size-8.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white shrink-0"
                title="Send query"
              >
                <span className="text-xs font-bold">➔</span>
              </Button>
            </form>

            <div className="flex items-center justify-between text-[11px] text-muted-foreground px-1">
              <span className="flex items-center gap-1.5">
                <span
                  className={`size-1.5 rounded-full ${
                    extensionPresent ? "bg-emerald-500" : "bg-amber-500"
                  }`}
                />
                {extensionPresent ? "Chrome Extension Synced" : "Web Side Panel Mode"}
              </span>

              <button
                type="button"
                onClick={() =>
                  extensionPresent ? setManualModalOpen(true) : setInstallModalOpen(true)
                }
                className="text-teal-600 dark:text-teal-400 hover:underline"
              >
                {extensionPresent ? "Shortcuts (Ctrl+Shift+P)" : "Get Chrome Extension"}
              </button>
            </div>
          </div>
        </aside>
      )}

      {/* Modal 1: Extension Absent — Install Guide & Link to /download */}
      <Dialog open={installModalOpen} onOpenChange={setInstallModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <BuddyLogo size={32} />
              <div>
                <DialogTitle className="text-lg">Install AI Buddy Extension</DialogTitle>
                <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                  Extension Not Detected
                </p>
              </div>
            </div>
            <DialogDescription className="pt-2 text-left text-sm">
              To use AI Buddy as your browser sidekick, install the Chrome MV3 extension.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 pt-2 text-xs">
            <div className="rounded-lg border border-border/80 bg-muted/40 p-3 space-y-2">
              <span className="font-semibold text-foreground">Quick 3-Step Setup:</span>
              <ol className="list-decimal pl-4 space-y-1 text-muted-foreground">
                <li>
                  Download and unzip{" "}
                  <strong className="text-foreground">ai-buddy-extension.zip</strong>.
                </li>
                <li>
                  Open{" "}
                  <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-foreground">
                    chrome://extensions
                  </code>{" "}
                  in your browser.
                </li>
                <li>
                  Turn on <strong className="text-foreground">Developer mode</strong> (top right)
                  and click <strong className="text-foreground">Load unpacked</strong>.
                </li>
              </ol>
            </div>

            <div className="pt-1 flex flex-col gap-2">
              <a
                href="/ai-buddy-extension.zip"
                download="ai-buddy-extension.zip"
                className="w-full"
              >
                <Button className="w-full gap-2 bg-teal-600 hover:bg-teal-500 text-white font-medium">
                  <Download className="size-4" />
                  Download Extension ZIP
                </Button>
              </a>

              <Button asChild variant="outline" className="w-full gap-2">
                <Link to="/download" onClick={() => setInstallModalOpen(false)}>
                  <ExternalLink className="size-3.5" />
                  View Complete Install Guide (/download)
                </Link>
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal 2: Extension Present — Instructions for Manual Opening */}
      <Dialog open={manualModalOpen} onOpenChange={setManualModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <BuddyLogo size={32} />
              <div>
                <DialogTitle className="text-lg">AI Buddy Side Panel Ready</DialogTitle>
                <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                  Extension Detected &amp; Connected
                </p>
              </div>
            </div>
            <DialogDescription className="pt-2 text-left text-sm">
              The AI Buddy extension is loaded in your browser. Open it anywhere with your keyboard
              or toolbar.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 pt-2 text-xs">
            <div className="rounded-lg border border-teal-500/30 bg-teal-500/10 p-3 space-y-2">
              <div className="font-semibold text-foreground flex items-center gap-1.5">
                <PanelRight className="size-3.5 text-teal-500" />
                <span>How to open the side panel:</span>
              </div>
              <p className="text-muted-foreground leading-relaxed">
                Press{" "}
                <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] font-semibold text-foreground">
                  Ctrl+Shift+P
                </kbd>{" "}
                (or{" "}
                <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] font-semibold text-foreground">
                  Cmd+Shift+P
                </kbd>{" "}
                on Mac), or click the <strong className="text-foreground">AI Buddy icon</strong> in
                your browser extensions toolbar.
              </p>
            </div>

            <div className="rounded-lg border border-border/80 bg-card p-3 space-y-2">
              <span className="font-semibold text-foreground">Sync account session:</span>
              <p className="text-muted-foreground">
                {signedIn
                  ? "Your web session is ready. Connect the extension to sync your memories and custom buddies."
                  : "Sign in to sync your custom buddies and persistent memory."}
              </p>
              {signedIn ? (
                <Button asChild size="sm" variant="secondary" className="w-full gap-2 text-xs">
                  <Link to="/connect" onClick={() => setManualModalOpen(false)}>
                    Sync Extension Session (/connect)
                    <ExternalLink className="size-3" />
                  </Link>
                </Button>
              ) : (
                <Button asChild size="sm" variant="secondary" className="w-full gap-2 text-xs">
                  <Link
                    to="/auth"
                    search={{ next: "/connect" }}
                    onClick={() => setManualModalOpen(false)}
                  >
                    <LogIn className="size-3" />
                    Sign in &amp; Connect Extension
                  </Link>
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ThemeSwitch() {
  const { theme, setTheme } = useTheme();
  const options = [
    { value: "light" as const, icon: Sun, label: "Light" },
    { value: "dark" as const, icon: Moon, label: "Dark" },
    { value: "system" as const, icon: Monitor, label: "System" },
  ];
  return (
    <div className="flex items-center gap-0.5 rounded-full border border-border bg-card p-0.5">
      {options.map(({ value, icon: Icon, label }) => (
        <button
          key={value}
          type="button"
          aria-label={`${label} theme`}
          aria-pressed={theme === value}
          onClick={() => setTheme(value)}
          className={`rounded-full p-1.5 transition-colors ${
            theme === value
              ? "bg-secondary text-secondary-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Icon className="size-3.5" />
        </button>
      ))}
    </div>
  );
}

export function SiteHeader() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active) setSignedIn(Boolean(data.session));
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        setSignedIn(Boolean(session));
      }
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur">
      <nav className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
        <Link to="/" className="flex items-center gap-2 font-semibold">
          <BuddyLogo size={32} />
          <span className="font-[family-name:var(--font-display)] text-lg">AI Buddy</span>
        </Link>
        <div className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
          <a href="/#how" className="transition-colors hover:text-foreground">
            How it works
          </a>
          <a href="/#buddies" className="transition-colors hover:text-foreground">
            Buddies
          </a>
          <a href="/#security" className="transition-colors hover:text-foreground">
            Security
          </a>
          <a href="/#pricing" className="transition-colors hover:text-foreground">
            Pricing
          </a>
        </div>
        <div className="flex items-center gap-2">
          <ThemeSwitch />
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
            <Link to="/download">Extension</Link>
          </Button>
          <SidePanelButton signedIn={signedIn} />
          {signedIn ? (
            <Button asChild size="sm">
              <Link to="/dashboard">Dashboard</Link>
            </Button>
          ) : (
            <Button asChild size="sm">
              <Link to="/auth">Login</Link>
            </Button>
          )}
        </div>
      </nav>
    </header>
  );
}

export function SiteFooter() {
  const router = useRouter();
  void router;
  return (
    <footer className="border-t border-border/70 py-10">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
        <p>
          AI Buddy — a voice-first companion for your browser. Not a licensed professional advisor.
        </p>
        <div className="flex gap-5">
          <Link to="/privacy" className="hover:text-foreground">
            Privacy
          </Link>
          <Link to="/download" className="hover:text-foreground">
            Download
          </Link>
          <Link to="/verification" className="hover:text-foreground">
            Verification
          </Link>
          <Link to="/auth" className="hover:text-foreground">
            Sign in
          </Link>
        </div>
      </div>
    </footer>
  );
}
