import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { BuddyAvatar } from "@/components/buddy-avatar";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

/** Public landing spot for social sign-in; waits for the session, then moves on. */
export const Route = createFileRoute("/auth/callback")({
  ssr: false,
  component: Callback,
});

function Callback() {
  const navigate = useNavigate();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      const stored = window.sessionStorage.getItem("ai-buddy-next");
      window.sessionStorage.removeItem("ai-buddy-next");
      const next = stored && stored.startsWith("/") && !stored.startsWith("//") ? stored : "/dashboard";
      navigate({ to: next, replace: true });
    };

    supabase.auth.getSession().then(({ data }) => {
      if (data.session) finish();
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) finish();
    });
    const timer = window.setTimeout(() => {
      if (!done) setFailed(true);
    }, 8000);

    return () => {
      sub.subscription.unsubscribe();
      window.clearTimeout(timer);
    };
  }, [navigate]);

  return (
    <div className="hero-surface flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
      <BuddyAvatar emotion={failed ? "concerned" : "thinking"} size={88} />
      {failed ? (
        <>
          <p className="text-sm text-muted-foreground">
            Sign-in did not complete. Please try again.
          </p>
          <Button onClick={() => navigate({ to: "/auth", replace: true })}>Back to sign in</Button>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">Finishing sign-in…</p>
      )}
    </div>
  );
}
