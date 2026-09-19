import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Accessibility,
  BookOpenCheck,
  Bot,
  Check,
  Code2,
  Eye,
  FileText,
  Gauge,
  Languages,
  Lock,
  MessageSquare,
  MousePointerClick,
  Scale,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Workflow,
} from "lucide-react";

import { BuddyAvatar } from "@/components/buddy-avatar";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";
import { VoiceDemo } from "@/components/voice-demo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { listBuddies } from "@/lib/app.functions";

export const Route = createFileRoute("/")({
  loader: () => listBuddies(),
  head: () => ({
    meta: [
      { title: "AI Buddy — Meet your voice-first AI companion" },
      {
        name: "description",
        content:
          "AI Buddy reads the page you are on, explains it in English, Hindi or Hinglish, and shows you the exact next step. 15 specialist Buddies, voice-first, permission-first.",
      },
      { property: "og:title", content: "AI Buddy — Meet your voice-first AI companion" },
      {
        property: "og:description",
        content:
          "One friendly Buddy, a very serious engine underneath: screen understanding, guided actions, memory you control.",
      },
    ],
  }),
  component: Landing,
});

const PIPELINE = [
  { icon: Eye, title: "Observe", body: "Reads the page structure, forms, errors and visible text — never your passwords." },
  { icon: Sparkles, title: "Understand", body: "Works out what the page is for and what you are trying to finish." },
  { icon: Workflow, title: "Plan", body: "Breaks your goal into small, checkable steps." },
  { icon: MessageSquare, title: "Ask", body: "Asks whenever a detail is yours to give. It never invents your data." },
  { icon: MousePointerClick, title: "Act", body: "Acts only at the permission level you set, and only after you approve." },
  { icon: Check, title: "Verify", body: "Checks the page actually changed the way it should have." },
  { icon: Accessibility, title: "Recover", body: "If a step fails, it diagnoses, retries within limits, then asks you." },
  { icon: BookOpenCheck, title: "Explain", body: "Tells you in plain language what it did and why." },
];

const FEATURES = [
  { icon: Eye, title: "Real screen understanding", body: "Buttons, inputs, dropdowns, tables, warnings and errors are identified from the DOM and accessibility tree — not guessed from pixels." },
  { icon: Languages, title: "English, Hindi, Hinglish", body: "Ask however you speak. Buddy answers in the same language and can read replies aloud." },
  { icon: ShieldCheck, title: "Permission ladder", body: "Observe, Explain, Suggest, Assist, Execute. You choose, and high-impact steps always ask first." },
  { icon: Lock, title: "Secrets stay secret", body: "Password, OTP, card and key fields are detected and redacted before anything leaves your browser." },
  { icon: Gauge, title: "Built for slow laptops", body: "Budgeted page context, throttled observation, lightweight avatar, low graphics mode." },
  { icon: Bot, title: "Many models, one Buddy", body: "The engine routes each request to the right model and falls back on failure. You just see your Buddy." },
];

const SPECIALISTS = [
  { icon: ShoppingBag, title: "E-commerce Buddy", body: "Product research, listing drafts, SEO titles, catalogue checks, pricing and ad reviews.", status: "Live for explain & draft" },
  { icon: FileText, title: "CA Buddy", body: "GST and invoice concepts, reconciliation walk-throughs, report structure, form guidance from authoritative sources.", status: "Live for explain & guide" },
  { icon: Scale, title: "Legal Buddy", body: "Plain-language terminology, clause explanations and drafting help — never fabricated citations.", status: "Live for explain & draft" },
  { icon: Code2, title: "Developer Buddy", body: "Inspect, reproduce, diagnose, patch, test, regression, review — a disciplined debugging loop.", status: "Explain & diagnose today" },
];

const FAQS = [
  { q: "Does Buddy click things on its own?", a: "No. Actions happen at the permission level you choose, and anything high-impact — submitting, paying, deleting — asks you first. Payments and CAPTCHAs are never completed for you." },
  { q: "What can the extension not see?", a: "Chrome's own pages (chrome://, the Web Store, other extensions' pages) are off limits by browser design. Buddy tells you instead of pretending." },
  { q: "Is wake-word listening always on?", a: "No. Browsers do not allow reliable always-on wake words, so push-to-talk is the primary way to speak. We say this plainly rather than faking it." },
  { q: "What does Buddy remember?", a: "Only preferences, work context, templates and workflows you approve. Passwords, OTPs, PINs, CVVs and keys are blocked at the database level." },
  { q: "Which AI model is used?", a: "Whichever fits the request best. The engine routes by task type, speed and cost, and falls back to another model if one fails." },
];

const PLANS = [
  { name: "Free trial", price: "₹0", note: "14 days, no card", items: ["All 15 Buddies", "Explain & guide", "Voice in 3 languages", "300 requests/day"] },
  { name: "Pro", price: "Coming soon", note: "Assisted actions", items: ["Guided form filling", "Saved workflows", "Longer memory", "Priority models"], highlight: true },
  { name: "Team", price: "Coming soon", note: "For small businesses", items: ["Shared templates", "Custom Buddies", "Audit log export", "Admin permissions"] },
];

function Section({
  id,
  eyebrow,
  title,
  children,
}: {
  id?: string;
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {eyebrow}
      </p>
      <h2 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h2>
      <div className="mt-8">{children}</div>
    </section>
  );
}

function Landing() {
  const { buddies, error } = Route.useLoaderData();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteHeader />

      <section className="hero-surface border-b border-border/60">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-20 md:grid-cols-[1.15fr_1fr]">
          <div>
            <Badge variant="secondary" className="mb-5">Voice-first · permission-first</Badge>
            <h1 className="text-4xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
              Meet Your <span className="text-gradient">AI Buddy.</span>
            </h1>
            <p className="mt-5 max-w-xl text-lg text-muted-foreground">
              It sees the page you are stuck on, explains it in your own language, points at exactly
              what to press next — and asks before it ever does anything for you.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link to="/auth" search={{ mode: "signup" }}>Try free</Link>
              </Button>
              <Button asChild size="lg" variant="secondary">
                <Link to="/auth">Login</Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link to="/download">Download extension</Link>
              </Button>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">
              14-day trial. No card. Works in Chrome and Edge on desktop.
            </p>
          </div>
          <div className="flex justify-center">
            <div className="panel flex w-full max-w-sm flex-col items-center gap-4 p-8 text-center">
              <BuddyAvatar emotion="happy" size={140} />
              <p className="font-[family-name:var(--font-display)] text-lg">“Hey Buddy.”</p>
              <p className="text-sm text-muted-foreground">
                One Buddy in front of you. A careful engine behind it: observe, understand, plan,
                ask, act, verify, recover, explain.
              </p>
            </div>
          </div>
        </div>
      </section>

      <Section id="how" eyebrow="How it works" title="Eight steps, every single time.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PIPELINE.map(({ icon: Icon, title, body }) => (
            <div key={title} className="panel p-5">
              <Icon className="size-5 text-accent-foreground" />
              <h3 className="mt-3 font-semibold">{title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section id="features" eyebrow="Features" title="Simple on the surface. Serious underneath.">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <div key={title} className="panel p-6">
              <Icon className="size-5 text-accent-foreground" />
              <h3 className="mt-3 font-semibold">{title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section id="buddies" eyebrow="Specialist Buddies" title="Fifteen Buddies. One shared brain.">
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {buddies.map((buddy) => (
              <div key={buddy.slug} className="panel p-5">
                <div className="flex items-center gap-3">
                  <BuddyAvatar size={40} animated={false} />
                  <div>
                    <h3 className="font-semibold">{buddy.name}</h3>
                    <p className="text-xs text-muted-foreground">{buddy.tagline}</p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {(buddy.expertise ?? []).slice(0, 3).map((item) => (
                    <Badge key={item} variant="outline" className="text-[11px]">{item}</Badge>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="mt-6 text-sm text-muted-foreground">
          Same intelligence in each one — different expertise, personality, voice, humour and
          teaching style. You can also build your own.
        </p>
      </Section>

      <Section id="voice" eyebrow="Voice demo" title="Talk to it. Really.">
        <VoiceDemo />
      </Section>

      <Section id="automation" eyebrow="Browser automation" title="It never blindly clicks pixels.">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="panel p-6">
            <h3 className="font-semibold">Elements, not coordinates</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Every element gets a stable reference from the DOM and accessibility tree, and is
              re-checked right before any step runs.
            </p>
          </div>
          <div className="panel p-6">
            <h3 className="font-semibold">Approval before submit</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Multi-step tasks keep their state visible and stop before anything is submitted, paid
              for or deleted.
            </p>
          </div>
          <div className="panel p-6">
            <h3 className="font-semibold">Honest limits</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Chrome's own pages, CAPTCHAs and payment confirmations are out of bounds. Buddy says
              so instead of guessing.
            </p>
          </div>
        </div>
      </Section>

      <Section eyebrow="Specialists" title="Depth where you need it.">
        <div className="grid gap-4 md:grid-cols-2">
          {SPECIALISTS.map(({ icon: Icon, title, body, status }) => (
            <div key={title} className="panel p-6">
              <Icon className="size-5 text-accent-foreground" />
              <h3 className="mt-3 font-semibold">{title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{body}</p>
              <Badge variant="secondary" className="mt-3 text-[11px]">{status}</Badge>
            </div>
          ))}
        </div>
        <p className="mt-6 text-sm text-muted-foreground">
          Buddy is not a licensed chartered accountant, lawyer or doctor, and says so. It explains,
          drafts and guides — you decide.
        </p>
      </Section>

      <Section eyebrow="Custom Buddy" title="Build the companion you actually want.">
        <div className="panel flex flex-col gap-6 p-8 md:flex-row md:items-center">
          <div className="flex-1">
            <p className="text-muted-foreground">
              Pick a name, a look, a voice, a language, how funny or serious it is, how it teaches,
              what it may touch and what it may remember. The configuration is generated for you.
            </p>
            <Button asChild className="mt-5">
              <Link to="/buddies/new">Create a Buddy</Link>
            </Button>
          </div>
          <div className="grid flex-1 grid-cols-2 gap-2 text-sm">
            {["Name & avatar", "Voice & language", "Personality & humour", "Teaching style", "Allowed tools", "Memory rules"].map((item) => (
              <div key={item} className="rounded-md border border-border bg-muted/40 px-3 py-2">{item}</div>
            ))}
          </div>
        </div>
      </Section>

      <Section id="security" eyebrow="Security & privacy" title="Least privilege, always visible.">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[
            { title: "Sensitive-field detection", body: "Password, OTP, CVV, PIN and key fields are never captured or stored." },
            { title: "Privacy mode", body: "Turn off memory and page capture entirely, any time." },
            { title: "Visible observing", body: "You always see when Buddy is watching or acting." },
            { title: "Audit trail", body: "Every task, permission change and action is logged for you to review." },
          ].map((item) => (
            <div key={item.title} className="panel p-6">
              <ShieldCheck className="size-5 text-accent-foreground" />
              <h3 className="mt-3 font-semibold">{item.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{item.body}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section id="pricing" eyebrow="Pricing" title="Start free. Upgrade only if it earns it.">
        <div className="grid gap-4 md:grid-cols-3">
          {PLANS.map((plan) => (
            <div
              key={plan.name}
              className={`panel p-6 ${plan.highlight ? "ring-2 ring-ring" : ""}`}
            >
              <h3 className="font-semibold">{plan.name}</h3>
              <p className="mt-2 text-3xl font-semibold tracking-tight">{plan.price}</p>
              <p className="text-sm text-muted-foreground">{plan.note}</p>
              <ul className="mt-4 space-y-2 text-sm">
                {plan.items.map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-accent-foreground" />
                    <span className="text-muted-foreground">{item}</span>
                  </li>
                ))}
              </ul>
              <Button asChild className="mt-6 w-full" variant={plan.highlight ? "default" : "outline"} disabled={plan.price === "Coming soon"}>
                {plan.price === "Coming soon" ? (
                  <span>Not available yet</span>
                ) : (
                  <Link to="/auth" search={{ mode: "signup" }}>Start free</Link>
                )}
              </Button>
            </div>
          ))}
        </div>
        <p className="mt-4 text-sm text-muted-foreground">
          Paid plans are not purchasable yet — no checkout is shown until it genuinely works.
        </p>
      </Section>

      <Section id="faq" eyebrow="FAQ" title="Straight answers.">
        <Accordion type="single" collapsible className="panel px-5">
          {FAQS.map((faq) => (
            <AccordionItem key={faq.q} value={faq.q}>
              <AccordionTrigger className="text-left">{faq.q}</AccordionTrigger>
              <AccordionContent className="text-muted-foreground">{faq.a}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </Section>

      <SiteFooter />
    </div>
  );
}
