import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/app-shell";
import { Buddy3D } from "@/components/buddy-3d";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { createCustomBuddy } from "@/lib/app.functions";
import { PERMISSION_LEVELS, type PermissionLevel } from "@/shared/permissions";

export const Route = createFileRoute("/_authenticated/buddies/new")({
  component: NewBuddy,
});

const LOOKS = [
  { slug: "general", label: "Classic" },
  { slug: "ecommerce", label: "Seller" },
  { slug: "ca", label: "Accountant" },
  { slug: "legal", label: "Counsel" },
  { slug: "research", label: "Researcher" },
  { slug: "professor", label: "Teacher" },
  { slug: "developer", label: "Techie" },
  { slug: "friendly", label: "Friend" },
  { slug: "operations", label: "Traveller" },
  { slug: "content", label: "Creator" },
  { slug: "business", label: "Business" },
  { slug: "marketing", label: "Marketing" },
  { slug: "data", label: "Data" },
  { slug: "design", label: "Design" },
];
const TOOLS = ["read_page", "highlight", "summarize", "draft_text", "fill_form", "click", "navigate"];

function NewBuddy() {
  const navigate = useNavigate();
  const create = useServerFn(createCustomBuddy);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: "",
    tagline: "",
    personality: "",
    expertise: "",
    teaching_style: "practical",
    humor_level: 3,
    seriousness: 3,
    language: "hinglish" as "english" | "hindi" | "hinglish",
    look: "general",
    permission_level: "explain" as PermissionLevel,
    allowed_tools: ["read_page", "highlight", "summarize"],
    memory_enabled: true,
  });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await create({
        data: {
          name: form.name.trim(),
          tagline: form.tagline,
          personality: form.personality,
          expertise: form.expertise.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 12),
          teaching_style: form.teaching_style,
          humor_level: form.humor_level,
          seriousness: form.seriousness,
          language: form.language,
          voice: "default",
          accent_color: form.look,
          allowed_tools: form.allowed_tools,
          permission_level: form.permission_level,
          memory_enabled: form.memory_enabled,
        },
      });
      toast.success(`${form.name} is ready and selected.`);
      navigate({ to: "/buddies" });
    } catch {
      toast.error("Could not create that Buddy. Check the name and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell title="Create a Buddy" description="Pick the basics — the full configuration is generated for you.">
      <form onSubmit={submit} className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <div className="panel space-y-5 p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="n">Name</Label>
              <Input id="n" required maxLength={60} value={form.name} onChange={(e) => set("name", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="t">Tagline</Label>
              <Input id="t" maxLength={120} value={form.tagline} onChange={(e) => set("tagline", e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p">Personality</Label>
            <Textarea id="p" maxLength={400} value={form.personality} onChange={(e) => set("personality", e.target.value)} placeholder="Calm, patient, a bit witty" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="x">Expertise (comma separated)</Label>
            <Input id="x" value={form.expertise} onChange={(e) => set("expertise", e.target.value)} placeholder="Shopify, GST, Excel" />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Language</Label>
              <select className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm" value={form.language} onChange={(e) => set("language", e.target.value as typeof form.language)}>
                <option value="hinglish">Hinglish</option><option value="english">English</option><option value="hindi">Hindi</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Teaching style</Label>
              <select className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm" value={form.teaching_style} onChange={(e) => set("teaching_style", e.target.value)}>
                {["practical", "step-by-step", "socratic", "storytelling", "concise"].map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Permission level</Label>
              <select className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm" value={form.permission_level} onChange={(e) => set("permission_level", e.target.value as PermissionLevel)}>
                {PERMISSION_LEVELS.map((l) => <option key={l}>{l}</option>)}
              </select>
            </div>
          </div>
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="space-y-2"><Label>Humour: {form.humor_level}/5</Label><Slider min={1} max={5} step={1} value={[form.humor_level]} onValueChange={([v]) => set("humor_level", v ?? 3)} /></div>
            <div className="space-y-2"><Label>Seriousness: {form.seriousness}/5</Label><Slider min={1} max={5} step={1} value={[form.seriousness]} onValueChange={([v]) => set("seriousness", v ?? 3)} /></div>
          </div>
          <div className="space-y-2">
            <Label>Allowed tools</Label>
            <div className="flex flex-wrap gap-2">
              {TOOLS.map((tool) => {
                const on = form.allowed_tools.includes(tool);
                return (
                  <button type="button" key={tool} aria-pressed={on}
                    onClick={() => set("allowed_tools", on ? form.allowed_tools.filter((x) => x !== tool) : [...form.allowed_tools, tool])}
                    className={`rounded-full border px-3 py-1 text-xs ${on ? "border-ring bg-secondary text-secondary-foreground" : "border-border text-muted-foreground"}`}>
                    {tool}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">Acting tools still obey your permission level and always confirm high-impact steps.</p>
          </div>
          <div className="flex items-center gap-3">
            <Switch checked={form.memory_enabled} onCheckedChange={(v) => set("memory_enabled", v)} id="m" />
            <Label htmlFor="m">Let this Buddy use my approved memory</Label>
          </div>
          <Button type="submit" disabled={busy || !form.name.trim()}>{busy ? "Creating…" : "Create Buddy"}</Button>
        </div>
        <div className="panel p-4 lg:self-start">
          <Buddy3D slug={form.look} size={240} emotion="curious" />
          <div className="mt-3 grid grid-cols-2 gap-1.5">
            {LOOKS.map((l) => (
              <button type="button" key={l.slug} onClick={() => set("look", l.slug)}
                className={`rounded-md border px-2 py-1 text-xs ${form.look === l.slug ? "border-ring bg-secondary" : "border-border text-muted-foreground"}`}>
                {l.label}
              </button>
            ))}
          </div>
        </div>
      </form>
    </AppShell>
  );
}
