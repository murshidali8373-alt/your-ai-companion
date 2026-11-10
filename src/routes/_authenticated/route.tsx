import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    // Let /connect handle both guest / 1-click pairing and authenticated session sync
    if (location.pathname === "/connect" || location.pathname.startsWith("/connect/")) {
      return {};
    }
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) {
      const next = location.pathname + (location.searchStr ? location.searchStr : "");
      throw redirect({ to: "/auth", search: { next: next || "/dashboard" } });
    }
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      const next = location.pathname + (location.searchStr ? location.searchStr : "");
      throw redirect({ to: "/auth", search: { next: next || "/dashboard" } });
    }
    return { user: data.user };
  },
  component: () => <Outlet />,
});
