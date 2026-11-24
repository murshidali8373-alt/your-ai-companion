import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { Buddy3D } from "@/components/buddy-3d";
import { BuddyAvatar } from "@/components/buddy-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { deleteCustomBuddy, getDashboard, listBuddies, selectBuddy } from "@/lib/app.functions";

export const Route = createFileRoute("/_authenticated/buddies")({
  component: BuddiesLayout,
});

function BuddiesLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return pathname === "/buddies" ? <Gallery /> : <Outlet />;
}

function Gallery() {
  const queryClient = useQueryClient();
  const fetchBuddies = useServerFn(listBuddies);
  const fetchDashboard = useServerFn(getDashboard);
  const choose = useServerFn(selectBuddy);
  const remove = useServerFn(deleteCustomBuddy);
  const buddies = useQuery({ queryKey: ["buddies"], queryFn: () => fetchBuddies() });
  const dashboard = useQuery({ queryKey: ["dashboard"], queryFn: () => fetchDashboard() });
  const [preview, setPreview] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const pick = useMutation({
    mutationFn: (v: { slug: string | null; customId: string | null }) => choose({ data: v }),
    onSuccess: () => {
      toast.success("Buddy switched.");
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: () => toast.error("Could not switch Buddy."),
  });

  const profile = dashboard.data?.profile;
  const current = profile?.selected_custom_buddy_id ?? profile?.selected_buddy_slug ?? "friendly";
  const customLook = dashboard.data?.customBuddies.find(
    (b: { id: string; accent_color?: string | null }) => b.id === profile?.selected_custom_buddy_id,
  )?.accent_color;
  const shown = preview ?? customLook ?? profile?.selected_buddy_slug ?? "friendly";
  const graphics = (profile?.graphics_mode as "low" | "balanced" | "high") ?? "balanced";

  return (
    <AppShell
      title="Choose your Buddy"
      description="Same core intelligence. Different expertise, personality and voice."
    >
      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <div className="panel flex flex-col items-center p-4 lg:sticky lg:top-6 lg:self-start">
          <Buddy3D slug={shown} size={240} graphics={graphics} emotion="happy" />
          <p className="mt-2 text-sm text-muted-foreground">Hover a Buddy to preview it.</p>
        </div>
        <div className="space-y-6">
          {buddies.data?.error && <p className="text-sm text-destructive">{buddies.data.error}</p>}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {buddies.isLoading &&
              Array.from({ length: 6 }).map((_, idx) => (
                <Skeleton key={idx} className="h-36 w-full rounded-xl" />
              ))}
            {(buddies.data?.buddies ?? []).map((b) => (
              <div
                key={b.slug}
                className="panel flex flex-col p-4"
                onMouseEnter={() => setPreview(b.slug)}
              >
                <div className="flex items-center gap-3">
                  <BuddyAvatar buddyId={b.slug} size={40} />
                  <div>
                    <h3 className="font-semibold">{b.name}</h3>
                    <p className="text-xs text-muted-foreground">{b.tagline}</p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-1">
                  {(b.expertise ?? []).slice(0, 3).map((e) => (
                    <Badge key={e} variant="outline" className="text-[11px]">
                      {e}
                    </Badge>
                  ))}
                </div>
                <Button
                  className="mt-4"
                  size="sm"
                  variant={current === b.slug ? "secondary" : "default"}
                  disabled={current === b.slug || pick.isPending}
                  onClick={() => pick.mutate({ slug: b.slug, customId: null })}
                >
                  {current === b.slug ? "Current Buddy" : "Use this Buddy"}
                </Button>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Your custom Buddies</h2>
            <Button asChild size="sm">
              <Link to="/buddies/new">Create a Buddy</Link>
            </Button>
          </div>
          {(dashboard.data?.customBuddies ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">None yet.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {(dashboard.data?.customBuddies ?? []).map(
                (c: {
                  id: string;
                  name: string;
                  tagline?: string | null;
                  personality?: string | null;
                }) => {
                  const isConfirming = pendingDeleteId === c.id;
                  const isDeleting = deletingId === c.id;
                  return (
                    <div
                      key={c.id}
                      className="panel flex flex-wrap items-center justify-between gap-3 p-4"
                    >
                      <div className="min-w-0 flex-1">
                        <h3 className="font-semibold truncate">{c.name}</h3>
                        <p className="text-xs text-muted-foreground break-words">
                          {c.tagline || c.personality}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {isConfirming ? (
                          <>
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={isDeleting}
                              onClick={async () => {
                                setDeletingId(c.id);
                                try {
                                  await remove({ data: { id: c.id } });
                                  setPendingDeleteId(null);
                                  toast.success(`Deleted "${c.name}".`);
                                  queryClient.invalidateQueries({ queryKey: ["dashboard"] });
                                } catch {
                                  toast.error("Could not delete that Buddy.");
                                } finally {
                                  setDeletingId(null);
                                }
                              }}
                            >
                              {isDeleting ? "Deleting…" : "Confirm"}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={isDeleting}
                              onClick={() => setPendingDeleteId(null)}
                            >
                              Cancel
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              size="sm"
                              disabled={current === c.id}
                              onClick={() => pick.mutate({ slug: null, customId: c.id })}
                            >
                              {current === c.id ? "Current" : "Use"}
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label={`Delete ${c.name}`}
                              onClick={() => setPendingDeleteId(c.id)}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                },
              )}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
