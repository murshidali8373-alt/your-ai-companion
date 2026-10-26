import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { getDashboard, updatePermissions, updateProfile } from "@/lib/app.functions";
import {
  PERMISSION_DESCRIPTIONS,
  PERMISSION_LEVELS,
  type PermissionLevel,
} from "@/shared/permissions";

export const Route = createFileRoute("/_authenticated/settings")({
  component: Settings,
});

function Settings() {
  const qc = useQueryClient();
  const load = useServerFn(getDashboard);
  const savePerms = useServerFn(updatePermissions);
  const saveProfile = useServerFn(updateProfile);
  const { data } = useQuery({ queryKey: ["dashboard"], queryFn: () => load() });

  const [name, setName] = useState("");
  const [language, setLanguage] = useState<"english" | "hindi" | "hinglish">("hinglish");
  const [graphics, setGraphics] = useState<"low" | "balanced" | "high">("balanced");
  const [blocked, setBlocked] = useState("");

  useEffect(() => {
    if (!data) return;
    setName(data.profile?.display_name ?? "");
    setLanguage((data.profile?.language as typeof language) ?? "hinglish");
    setGraphics((data.profile?.graphics_mode as typeof graphics) ?? "balanced");
    setBlocked((data.permissions?.blocked_domains ?? []).join(", "));
  }, [data]);

  const perms = data?.permissions;
  const patch = async (p: {
    level?: PermissionLevel;
    confirm_high_impact?: boolean;
    allow_screenshots?: boolean;
    privacy_mode?: boolean;
    allow_memory?: boolean;
    blocked_domains?: string[];
  }) => {
    try {
      await savePerms({ data: p });
      toast.success("Saved.");
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    } catch {
      toast.error("Could not save that setting.");
    }
  };

  return (
    <AppShell
      title="Settings"
      description="Permissions, privacy and how your Buddy looks and talks."
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="panel space-y-4 p-6">
          <h2 className="font-semibold">Permission level</h2>
          <div className="space-y-2">
            {PERMISSION_LEVELS.map((level) => (
              <label
                key={level}
                className={`flex cursor-pointer gap-3 rounded-md border p-3 ${perms?.level === level ? "border-ring bg-secondary/50" : "border-border"}`}
              >
                <input
                  type="radio"
                  name="level"
                  checked={perms?.level === level}
                  onChange={() => patch({ level: level as PermissionLevel })}
                />
                <span>
                  <span className="font-medium capitalize">{level}</span>
                  <span className="block text-xs text-muted-foreground">
                    {PERMISSION_DESCRIPTIONS[level]}
                  </span>
                </span>
              </label>
            ))}
          </div>
          <Row
            label="Always confirm high-impact actions"
            checked={perms?.confirm_high_impact ?? true}
            onChange={(v) => patch({ confirm_high_impact: v })}
          />
        </section>

        <section className="panel space-y-4 p-6">
          <h2 className="font-semibold">Privacy</h2>
          <Row
            label="Privacy mode (no memory, minimal page capture)"
            checked={perms?.privacy_mode ?? false}
            onChange={(v) => patch({ privacy_mode: v })}
          />
          <Row
            label="Use my approved memory"
            checked={perms?.allow_memory ?? true}
            onChange={(v) => patch({ allow_memory: v })}
          />
          <Row
            label="Allow screenshots when I ask"
            checked={perms?.allow_screenshots ?? false}
            onChange={(v) => patch({ allow_screenshots: v })}
          />
          <div className="space-y-1.5">
            <Label htmlFor="b">Never read these sites (comma separated)</Label>
            <Input
              id="b"
              value={blocked}
              onChange={(e) => setBlocked(e.target.value)}
              placeholder="mybank.com, mail.google.com"
            />
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                patch({
                  blocked_domains: blocked
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
            >
              Save blocked sites
            </Button>
          </div>
        </section>

        <section className="panel space-y-4 p-6 lg:col-span-2">
          <h2 className="font-semibold">Profile & experience</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="dn">Name</Label>
              <Input
                id="dn"
                value={name}
                maxLength={80}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Language</Label>
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={language}
                onChange={(e) => setLanguage(e.target.value as typeof language)}
              >
                <option value="hinglish">Hinglish</option>
                <option value="english">English</option>
                <option value="hindi">Hindi</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>3D graphics</Label>
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={graphics}
                onChange={(e) => setGraphics(e.target.value as typeof graphics)}
              >
                <option value="low">Low (2D, fastest)</option>
                <option value="balanced">Balanced</option>
                <option value="high">High</option>
              </select>
            </div>
          </div>
          <Button
            onClick={async () => {
              try {
                await saveProfile({
                  data: { display_name: name, language, graphics_mode: graphics },
                });
                toast.success("Profile saved.");
                qc.invalidateQueries({ queryKey: ["dashboard"] });
              } catch {
                toast.error("Could not save your profile.");
              }
            }}
          >
            Save profile
          </Button>
        </section>
      </div>
    </AppShell>
  );
}

function Row({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </div>
  );
}
