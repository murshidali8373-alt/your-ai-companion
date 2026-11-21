import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { SiteFooter, SiteHeader } from "@/components/site-chrome";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/download")({
  head: () => ({
    meta: [
      { title: "Download the AI Buddy extension" },
      {
        name: "description",
        content:
          "Install the AI Buddy Chrome extension: download the package, load it unpacked, and connect it to your account.",
      },
      { property: "og:title", content: "Download the AI Buddy extension" },
      {
        property: "og:description",
        content: "Load the MV3 extension unpacked in Chrome or Edge and sign in to connect it.",
      },
    ],
  }),
  component: Download,
});

const STEPS = [
  "Download the package below and unzip it.",
  "Open chrome://extensions in Chrome or Edge.",
  "Turn on Developer mode, top right.",
  "Click “Load unpacked” and choose the unzipped folder.",
  "Open any page, click the AI Buddy icon, then connect your account.",
];

function Download() {
  const [busy, setBusy] = useState(false);
  const [activeBackendUrl, setActiveBackendUrl] = useState(
    "https://ais-dev-5t53lwemhepi2nbkqb2reo-152127168827.asia-east1.run.app",
  );

  useEffect(() => {
    if (typeof window !== "undefined" && window.location.origin) {
      setActiveBackendUrl(window.location.origin);
    }
  }, []);

  const download = async () => {
    setBusy(true);
    try {
      const res = await fetch("/ai-buddy-extension.zip");
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "ai-buddy-extension.zip";
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      toast.error("The download failed. Please refresh and try once more.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteHeader />
      <main className="mx-auto max-w-3xl space-y-8 px-4 py-16">
        <header>
          <h1 className="text-3xl font-semibold tracking-tight">Install the extension</h1>
          <p className="mt-2 text-muted-foreground">
            AI Buddy is not in the Chrome Web Store yet, so you load it yourself. It takes about a
            minute, and it works the same way.
          </p>
        </header>

        <div className="panel space-y-4 p-6">
          <Button onClick={download} disabled={busy} size="lg">
            {busy ? "Preparing…" : "Download extension (.zip)"}
          </Button>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
            {STEPS.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <p className="text-xs text-muted-foreground">
            Works in Chrome, Edge, Brave and other Chromium browsers on desktop.
          </p>
        </div>

        <div className="panel space-y-3 p-6">
          <h2 className="font-semibold">What it asks for, and why</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            <li>
              <strong>Side panel</strong> — to show your Buddy beside the page.
            </li>
            <li>
              <strong>Active tab & scripting</strong> — to read the page you are asking about, only
              when you ask.
            </li>
            <li>
              <strong>Storage</strong> — to keep your connection and preferences on your machine.
            </li>
            <li>
              <strong>Microphone</strong> — only while you hold the talk button.
            </li>
          </ul>
          <p className="text-sm text-muted-foreground">
            Chrome's own pages (chrome://, the Web Store, other extensions) cannot be read by any
            extension. Buddy tells you instead of guessing.
          </p>
        </div>

        <div className="panel space-y-3 p-6">
          <h2 className="font-semibold">Connect your account &amp; extension</h2>
          <p className="text-sm text-muted-foreground">
            After loading the extension in Chrome, click below to synchronize your account in 1
            click.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild className="bg-teal-600 hover:bg-teal-500 text-white font-medium">
              <Link to="/connect">Connect Extension (/connect)</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/verification">Verification Dashboard</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/auth">Sign in with Email</Link>
            </Button>
          </div>
          <div className="mt-3 rounded border border-border/80 bg-muted/40 p-2 text-xs text-muted-foreground">
            Active Backend URL:{" "}
            <code className="font-mono text-foreground font-semibold">{activeBackendUrl}</code>
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
