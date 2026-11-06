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
    // Re-check live presence on click
    const isInstalled =
      extensionPresent ||
      (extWin !== undefined &&
        (Boolean(extWin.__AI_BUDDY_EXTENSION__) ||
          Boolean(extWin.aiBuddyExtension) ||
          Boolean(extWin.chrome?.runtime?.id)));

    if (!isInstalled) {
      setInstallModalOpen(true);
      return;
    }

    // If present, open the side panel via window.chrome.sidePanel.open() if supported
    const chromeObj = extWin?.chrome;
    let opened = false;
    if (chromeObj?.sidePanel?.open && typeof chromeObj.sidePanel.open === "function") {
      try {
        void chromeObj.sidePanel.open();
        opened = true;
      } catch {
        // Some browser contexts restrict direct invocation from web frames
      }
    }

    // Try messaging the bridge to open the side panel
    if (typeof window !== "undefined") {
      window.postMessage({ type: "AI_BUDDY_OPEN_PANEL" }, window.location.origin);
    }

    // If not automatically opened via API, provide manual opening instruction
    if (!opened) {
      setManualModalOpen(true);
    }
  };

  return (
    <>
      <Button
        onClick={handleOpen}
        variant="outline"
        size="sm"
        className="gap-1.5 border-teal-500/40 text-teal-600 dark:text-teal-400 hover:bg-teal-500/10 hover:border-teal-500"
      >
        <Sparkles className="size-3.5 text-teal-500" />
        <span>Side Panel</span>
      </Button>

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
          <Link to="/auth" className="hover:text-foreground">
            Sign in
          </Link>
        </div>
      </div>
    </footer>
  );
}
