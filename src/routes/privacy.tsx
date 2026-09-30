import { createFileRoute } from "@tanstack/react-router";

import { SiteFooter, SiteHeader } from "@/components/site-chrome";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy & data handling — AI Buddy" },
      {
        name: "description",
        content:
          "What AI Buddy reads, what it never captures, what it remembers, and how to delete everything.",
      },
      { property: "og:title", content: "Privacy & data handling — AI Buddy" },
      {
        property: "og:description",
        content: "Sensitive fields are never captured. Memory is yours to view, edit and delete.",
      },
    ],
  }),
  component: Privacy,
});

function Privacy() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteHeader />
      <main className="mx-auto max-w-3xl space-y-8 px-4 py-16">
        <header>
          <h1 className="text-3xl font-semibold tracking-tight">Privacy & data handling</h1>
          <p className="mt-2 text-muted-foreground">
            Plain language, no small print. If something here is not true of the product, it is a bug
            — report it.
          </p>
        </header>

        <section className="panel space-y-3 p-6">
          <h2 className="font-semibold">What Buddy reads</h2>
          <p className="text-sm text-muted-foreground">
            When you ask a question from the side panel, the extension takes a structured snapshot of
            the active tab: the page title and address, headings, form fields and their labels,
            buttons and links, visible error or warning messages, and a trimmed amount of visible
            text. That snapshot is sent to our backend with your question so a model can answer.
          </p>
        </section>

        <section className="panel space-y-3 p-6">
          <h2 className="font-semibold">What Buddy never captures</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            <li>Password, OTP, PIN, CVV, card, secret, token and private-key fields — detected and redacted before anything leaves the page.</li>
            <li>Values of any field marked as a password or autocomplete secret.</li>
            <li>Screenshots, unless you explicitly allow them in settings.</li>
            <li>Pages on domains you have blocked, and Chrome's own pages, which the browser puts out of reach.</li>
          </ul>
        </section>

        <section className="panel space-y-3 p-6">
          <h2 className="font-semibold">What Buddy remembers</h2>
          <p className="text-sm text-muted-foreground">
            Only preferences, work context, templates and workflows — and only what you approve. The
            database itself rejects anything that looks like a credential. You can view, search,
            edit, forget and clear memory from your dashboard at any time, and privacy mode switches
            memory off entirely.
          </p>
        </section>

        <section className="panel space-y-3 p-6">
          <h2 className="font-semibold">Deleting your data</h2>
          <p className="text-sm text-muted-foreground">
            Clearing memory removes it immediately. Deleting a task removes its trace. To delete your
            whole account and everything attached to it, ask from Settings — the request is honoured,
            not queued indefinitely.
          </p>
        </section>

        <section className="panel space-y-3 p-6">
          <h2 className="font-semibold">Limits we will not pretend away</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            <li>Buddy is not a licensed chartered accountant, lawyer or doctor.</li>
            <li>Browsers cannot reliably listen for a wake word, so push-to-talk is the primary control.</li>
            <li>CAPTCHAs and payment confirmations are never completed for you.</li>
            <li>Chrome internal pages and the Web Store cannot be read by any extension.</li>
          </ul>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
