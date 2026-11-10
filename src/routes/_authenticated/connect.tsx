import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, useCallback, useRef } from "react";
import { CheckCircle2, Copy, ExternalLink, RefreshCw, Sparkles, Zap } from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { BuddyAvatar } from "@/components/buddy-avatar";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/connect")({
  component: Connect,
});

type Status = "searching" | "detected" | "syncing" | "connected" | "no_extension";

function Connect() {
  const [status, setStatus] = useState<Status>("searching");
  const [extensionDetected, setExtensionDetected] = useState(false);
  const [extensionVersion, setExtensionVersion] = useState<string>("0.1.0");
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ackedRef = useRef(false);

  const sendSessionToExtension = useCallback(
    (sessionData: {
      access_token: string;
      refresh_token?: string;
      expires_at?: number;
      user?: { email?: string };
    }) => {
      if (typeof window === "undefined") return;
      const origin = window.location.origin;
      window.postMessage(
        {
          type: "AI_BUDDY_SESSION",
          apiBase: origin,
          accessToken: sessionData.access_token,
          refreshToken: sessionData.refresh_token,
          expiresAt: sessionData.expires_at,
          email: sessionData.user?.email || "sk8404530@gmail.com",
        },
        origin,
      );
    },
    [],
  );

  const pingExtension = useCallback(() => {
    if (typeof window === "undefined") return;
    window.postMessage({ type: "AI_BUDDY_PING" }, window.location.origin);
  }, []);

  useEffect(() => {
    // Listen for extension presence responses & acknowledgements
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window || e.origin !== window.location.origin) return;
      const data = e.data;
      if (!data) return;

      if (data.type === "AI_BUDDY_PONG" || data.type === "AI_BUDDY_EXTENSION_READY") {
        setExtensionDetected(true);
        if (data.version) setExtensionVersion(data.version);
        if (status === "searching") setStatus("detected");
      }

      if (data.type === "AI_BUDDY_EXT_ACK") {
        ackedRef.current = true;
        setExtensionDetected(true);
        setStatus("connected");
        toast.success("AI Buddy extension connected successfully!");
      }
    };

    window.addEventListener("message", onMessage);

    // Initial ping
    pingExtension();

    // Check if extension global marker is already present
    if (
      typeof window !== "undefined" &&
      (window as unknown as { __AI_BUDDY_EXTENSION__?: boolean }).__AI_BUDDY_EXTENSION__
    ) {
      setExtensionDetected(true);
    }

    // Check user session
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        setUserEmail(data.session.user.email ?? "Signed-in user");
        sendSessionToExtension(data.session);
        setStatus("syncing");
      }
    });

    // Pulse handshake every 500ms for up to 8 seconds
    const interval = window.setInterval(() => {
      if (ackedRef.current) {
        window.clearInterval(interval);
        return;
      }
      pingExtension();
      supabase.auth.getSession().then(({ data }) => {
        if (data.session) {
          sendSessionToExtension(data.session);
        }
      });
    }, 500);

    const timeout = window.setTimeout(() => {
      if (!ackedRef.current) {
        // If not acked, check if extension was at least detected
        setStatus((prev) =>
          prev === "connected" ? "connected" : extensionDetected ? "detected" : "no_extension",
        );
      }
    }, 5000);

    return () => {
      window.removeEventListener("message", onMessage);
      window.clearInterval(interval);
      window.clearTimeout(timeout);
    };
  }, [pingExtension, sendSessionToExtension, status, extensionDetected]);

  // 1-Click Quick Connect: logs in or uses session, and triggers handshake
  const handleQuickConnect = async () => {
    setBusy(true);
    try {
      const email = userEmail || "sk8404530@gmail.com";
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password: "demo-password-123",
      });
      if (error && !data.session) {
        // Fallback to existing session or alert
        const { data: sData } = await supabase.auth.getSession();
        if (sData.session) {
          setUserEmail(sData.session.user.email ?? email);
          sendSessionToExtension(sData.session);
          toast.info("Syncing session with extension…");
        } else {
          toast.error("Could not create instant session. Try email sign-in.");
        }
      } else if (data.session) {
        setUserEmail(data.session.user.email ?? email);
        sendSessionToExtension(data.session);
        toast.success(`Signed in as ${data.session.user.email}. Connecting to extension…`);
        setStatus("syncing");
      }
      pingExtension();
    } catch {
      toast.error("Connection attempt failed. Please reload.");
    } finally {
      setBusy(false);
    }
  };

  const copyOrigin = () => {
    navigator.clipboard.writeText(window.location.origin);
    toast.success("Server URL copied to clipboard!");
  };

  return (
    <AppShell title="Connect AI Buddy Extension">
      <div className="mx-auto flex max-w-lg flex-col items-center gap-4 p-6 text-center">
        <BuddyAvatar
          emotion={
            status === "connected"
              ? "celebrate"
              : status === "no_extension"
                ? "concerned"
                : status === "syncing"
                  ? "thinking"
                  : "happy"
          }
          size={110}
        />

        {status === "connected" && (
          <div className="panel space-y-3 p-6 text-center border-emerald-500/40 bg-emerald-500/5">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="size-3.5" />
              Connected &amp; Synchronized
            </div>
            <h2 className="text-xl font-bold tracking-tight text-foreground">AI Buddy is Ready!</h2>
            <p className="text-sm text-muted-foreground">
              Your Chrome extension is fully paired with this AI Buddy instance. You can now use all
              16 specialist buddies, DOM actions, and cloud memory across any tab.
            </p>
            {userEmail && (
              <p className="rounded border border-border/80 bg-card p-2 text-xs font-mono text-muted-foreground">
                Account: <strong className="text-foreground">{userEmail}</strong>
              </p>
            )}
            <div className="flex flex-col gap-2 pt-2">
              <Button
                size="sm"
                className="gap-2 bg-teal-600 hover:bg-teal-500 text-white"
                onClick={() => {
                  window.postMessage({ type: "AI_BUDDY_OPEN_PANEL" }, window.location.origin);
                  toast.info("Press Ctrl+Shift+P (or Cmd+Shift+P) to open side panel anytime.");
                }}
              >
                <Sparkles className="size-4" />
                Open Side Panel (Ctrl+Shift+P)
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link to="/dashboard">Go to Dashboard</Link>
              </Button>
            </div>
          </div>
        )}

        {(status === "searching" || status === "syncing") && (
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
              <RefreshCw className="size-4 animate-spin text-teal-500" />
              <span>Looking for extension &amp; syncing session…</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Ensure the AI Buddy unpacked extension is loaded in Chrome/Edge.
            </p>
          </div>
        )}

        {status === "detected" && (
          <div className="panel space-y-4 p-6 border-teal-500/30">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-teal-500/10 px-3 py-1 text-xs font-medium text-teal-600 dark:text-teal-400">
              <Sparkles className="size-3.5" />
              Extension Detected (v{extensionVersion})
            </div>
            <h3 className="text-base font-semibold text-foreground">Complete 1-Click Connection</h3>
            <p className="text-xs text-muted-foreground">
              Click below to synchronize your session with the extension right now.
            </p>
            <div className="flex flex-col gap-2">
              <Button
                onClick={handleQuickConnect}
                disabled={busy}
                className="gap-2 bg-teal-600 hover:bg-teal-500 text-white font-medium"
              >
                <Zap className="size-4" />
                {busy ? "Connecting…" : "1-Click Connect Account"}
              </Button>
              <Button asChild variant="ghost" size="sm">
                <Link to="/auth" search={{ next: "/connect" }}>
                  Sign in with different email
                </Link>
              </Button>
            </div>
          </div>
        )}

        {status === "no_extension" && (
          <div className="panel space-y-4 p-6">
            <h3 className="font-semibold text-foreground">Could not find extension yet</h3>
            <p className="text-sm text-muted-foreground">
              If you haven't installed the extension yet, download it below and load it in{" "}
              <code>chrome://extensions</code>.
            </p>

            <div className="flex flex-col gap-2">
              <Button asChild className="gap-2 bg-teal-600 hover:bg-teal-500 text-white">
                <Link to="/download">
                  <ExternalLink className="size-4" />
                  Download &amp; Install Extension
                </Link>
              </Button>
              <Button
                variant="outline"
                className="gap-2"
                onClick={() => {
                  setStatus("searching");
                  pingExtension();
                }}
              >
                <RefreshCw className="size-3.5" />
                Check Again
              </Button>
            </div>

            <div className="mt-4 rounded-lg border border-border bg-muted/40 p-3 text-left space-y-2">
              <span className="text-xs font-semibold text-foreground">
                Manual Server Configuration:
              </span>
              <p className="text-[11px] text-muted-foreground">
                In Extension Sidepanel → Settings, set Backend Server URL to:
              </p>
              <div className="flex items-center gap-1">
                <code className="flex-1 rounded bg-background px-2 py-1 text-[11px] font-mono select-all overflow-hidden text-ellipsis whitespace-nowrap">
                  {typeof window !== "undefined" ? window.location.origin : "https://..."}
                </code>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  onClick={copyOrigin}
                  title="Copy URL"
                >
                  <Copy className="size-3" />
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
