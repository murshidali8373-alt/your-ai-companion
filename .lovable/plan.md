# AI Buddy — Phase 0 to 3 build plan

The project is currently an empty starter: no pages, no accounts, no database, no extension. Rather than generating hundreds of shallow files, this plan builds one **real working slice** end to end, then extends it phase by phase.

## What you'll be able to do after this build

1. Visit a polished AI Buddy site, create an account, and start a free trial.
2. See a dashboard with your chosen Buddy, plan/trial status, recent tasks, and permission level.
3. Browse a Buddy gallery (CA, Legal, E-commerce, Developer, Professor, Dadaji, Detective, Friendly and more) and pick one; create a custom Buddy with name, personality, humour, language, voice and allowed permissions.
4. Download a real Chrome extension (Manifest V3) from the site, load it in Chrome, sign in, and open a side panel Buddy.
5. Press-to-talk or type: "What is on this page?", "Explain this", "Where do I enter GSTIN?" — the Buddy reads the page's real structure (text, headings, forms, buttons, errors), answers in English/Hindi/Hinglish, speaks the answer aloud, and highlights the element it is talking about on the real page.
6. Every request is logged as a task with its status, so nothing silently fails.

## What is deliberately NOT in this slice

Clicking/typing automation, multi-step workflows, teach & replay, e-commerce/CA/legal skill packs, 3D animation, multi-model cross-check, and daily discovery are documented and scaffolded in the registries but **not claimed as complete**. They arrive in later phases, each with real logic and tests — no fake buttons.

Chrome limits that will be stated plainly in the product: no access to `chrome://` pages, other extensions' pages, or the Chrome Web Store; no bypassing CAPTCHA, logins, or payment confirmations; wake-word ("Hey Buddy") is not reliable in a browser, so push-to-talk is the primary input with optional continuous listening while the panel is open.

## Technical plan

**Docs first** — `/docs/PROJECT_ARCHITECTURE.md`, `IMPLEMENTATION_PLAN.md`, `FEATURE_REGISTRY.md`, `BUG_REGISTRY.md`, `SECURITY.md`, `TEST_PLAN.md`, `ROADMAP.md`, plus root `CHANGELOG.md`. Feature status values: `planned | scaffolded | complete` (complete requires UI + logic + errors + tests + docs).

**Backend (Lovable Cloud)** — enable Cloud; email/password auth with reset. Tables with RLS + grants: `profiles`, `user_roles` (separate table + `has_role`), `plans`/`subscriptions` (trial with expiry), `buddies` (seeded presets, public read) and `custom_buddies`, `buddy_selection`, `tasks` (+ `task_events` for observe/plan/act/verify trace), `memories` (typed, with a sensitive-value blocklist enforced server-side), `permission_settings` (observe → explain → suggest → assist → execute), `audit_log`, `usage_counters`.

**AI orchestrator** — `src/lib/ai/` provider registry with a single `AIProvider` interface, routing by task type / vision need / latency / cost, ordered fallback, timeout + retry cap + watchdog, and normalised error classes (rate limit, outage, auth, invalid response). Default route: Lovable AI Gateway (`openai/gpt-6-astra` via the Responses API, streaming); the registry accepts additional providers by config, no hard-coding to one vendor. Exposed as authenticated server functions only — keys never leave the server. Context manager trims page context to a token budget instead of dumping the DOM.

**Chrome extension** (`extension/`, zipped to `public/ai-buddy-extension.zip`): MV3 service worker, side panel UI, content script. Minimal permissions: `sidePanel`, `storage`, `activeTab`, `scripting`, `tabs`. Content script builds a structured page snapshot from the accessibility-oriented DOM (role, label, placeholder, required, validation errors, headings, landmarks) with stable element refs — never coordinates — and can highlight a ref. Service worker holds the session token, calls the web app's `/api/public/extension/*` endpoints (token-verified server side), and enforces the permission level before any page-touching action. Voice: Web Speech API for speech-to-text and speech synthesis with interrupt/stop, `en-IN`/`hi-IN` and Hinglish handling, push-to-talk plus a visible listening/observing indicator.

**Web app** — Tailwind v4 semantic token design system (dark/light/system), landing page with the specified sections and honest capability copy, auth pages, dashboard, buddy gallery, custom buddy creator, memory and permission controls, task history, pricing, FAQ, privacy. Per-route `head()` metadata.

**Tests** — Vitest for the snapshot builder, context trimmer, provider fallback/watchdog, memory sensitive-field blocking, and permission gating; Playwright for signup → trial → buddy select → dashboard, and an extension-endpoint contract test against fixture pages (form-heavy, slow, error-state). Tests run after each group of changes; failures are fixed or reverted, then logged in `BUG_REGISTRY.md` and `CHANGELOG.md`.

## Phase order after this slice

4) browser agent (click/type/select with observe→verify→recover) · 5) forms + workflow engine · 6) skills & specialist packs (e-commerce, CA, legal, developer) · 7) memory + teach & replay · 8) self-debug + expanded test engine · 9) animation + emotion · 10) hardening, observability, discovery.
