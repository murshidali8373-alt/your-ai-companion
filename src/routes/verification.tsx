import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

import { SiteFooter, SiteHeader } from "@/components/site-chrome";
import { VerificationDashboard } from "@/components/verification-dashboard";

export const Route = createFileRoute("/verification")({
  head: () => ({
    meta: [
      { title: "Verification Dashboard — AI Buddy" },
      {
        name: "description",
        content:
          "Track real-world Desktop Chrome verification results, checklist steps, and bug notes across all 6 AI Buddy test suites.",
      },
    ],
  }),
  component: VerificationPage,
});

function VerificationPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteHeader />
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link
              to="/download"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="size-3.5" />
              Back to Extension Install Guide
            </Link>
            <h1 className="mt-2 font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight">
              Verification Dashboard
            </h1>
          </div>
        </div>

        <VerificationDashboard />
      </main>
      <SiteFooter />
    </div>
  );
}
