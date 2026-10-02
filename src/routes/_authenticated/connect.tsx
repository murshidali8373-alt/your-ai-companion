import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { AppShell } from "@/components/app-shell";
import { BuddyAvatar } from "@/components/buddy-avatar";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/connect")({
  component: Connect,
});

type Status = "waiting" | "sent" | "connected" | "no_extension";

/**
 * Hands the signed-in session to the extension. The extension's content script runs
 * only on this origin+path, listens for this exact message type from window itself,
 * and replies with an ack. Nothing is sent to any other origin.
 */
function Connect() {
  const [status, setStatus] = useState<Status>("waiting");

  useEffect(() => {
    let acked = false;
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window || e.origin !== window.location.origin) return;
      if (e.data?.type === "AI_BUDDY_EXT_ACK") {
        acked = true;
        setStatus("connected");
      }
    };
    window.addEventListener("message", onMessage);

    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) return;
      window.postMessage(
        {
          type: "AI_BUDDY_SESSION",
          apiBase: window.location.origin,
          accessToken: data.session.access_token,
          refreshToken: data.session.refresh_token,
          expiresAt: data.session.expires_at,
          email: data.session.user.email,
        },
        window.location.origin,
      );
      setStatus("sent");
    });
    const t = window.setTimeout(() => !acked && setStatus("no_extension"), 4000);
    return () => {
      window.removeEventListener("message", onMessage);
      window.clearTimeout(t);
    };
  }, []);

  return (
    <AppShell title="Connect the extension">
      <div className="panel flex max-w-lg flex-col items-center gap-3 p-8 text-center">
        <BuddyAvatar emotion={status === "connected" ? "celebrate" : status === "no_extension" ? "concerned" : "thinking"} size={96} />
        {status === "connected" && <p>The extension is connected. Open any page and click the AI Buddy icon.</p>}
        {(status === "waiting" || status === "sent") && <p className="text-muted-foreground">Looking for the extension…</p>}
        {status === "no_extension" && (
          <>
            <p>I could not find the extension in this browser.</p>
            <p className="text-sm text-muted-foreground">Install and load it first, then reload this page.</p>
            <div className="flex gap-2">
              <Button asChild><Link to="/download">Install extension</Link></Button>
              <Button variant="outline" onClick={() => window.location.reload()}>Try again</Button>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
