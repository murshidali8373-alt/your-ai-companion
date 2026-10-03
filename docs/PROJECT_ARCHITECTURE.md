# AI Buddy — Architecture

## Stack (verified against the repo)

| Layer     | Technology                                                                                    |
| --------- | --------------------------------------------------------------------------------------------- |
| Web app   | TanStack Start v1 (React 19, Vite), file routes in `src/routes`                               |
| Styling   | Tailwind CSS v4 semantic tokens in `src/styles.css`, shadcn primitives in `src/components/ui` |
| Backend   | Lovable Cloud (Postgres + Auth + RLS), accessed via `createServerFn` and server routes        |
| AI        | Lovable AI Gateway behind a provider-agnostic orchestrator (`src/lib/ai/`)                    |
| Extension | Chrome Manifest V3 in `extension/`, packaged to `public/ai-buddy-extension.zip`               |
| Tests     | Vitest (`tests/`)                                                                             |

## Components

```text
Chrome (user's tab)
 ├─ content script  observe: structured page snapshot (roles, labels, forms, errors)
 │                  act:     highlight / scroll to an element ref
 ├─ side panel      voice in (Web Speech), voice out (speechSynthesis), text, status, stop
 └─ service worker  session store, permission gate, API calls, watchdog + retry cap

Web app (this repo)
 ├─ /                     marketing site
 ├─ /auth                 email+password and Google sign-in
 ├─ /_authenticated/*     dashboard, buddies, custom buddy, settings, tasks
 ├─ /extension/connect    hands the signed-in session to the extension (window.postMessage → content script)
 └─ /api/public/extension/* raw HTTP endpoints for the extension (bearer-token verified server-side)

Lovable Cloud
 └─ profiles, user_roles, subscriptions, buddies, custom_buddies,
    permission_settings, memories, tasks, task_events, audit_log, usage_counters
```

## Agent loop

`OBSERVE → UNDERSTAND → PLAN → ASK → ACT → VERIFY → RECOVER → EXPLAIN`

Phases 0–3 implement OBSERVE / UNDERSTAND / EXPLAIN plus a non-mutating ACT
(highlight, scroll). Mutating actions (click, type, select, submit) land in phase 4
behind the permission level and the confirm-high-impact policy. Each phase writes a
`task_events` row, so a failure is always attributable.

## AI orchestrator

`src/lib/ai/registry.ts` defines `AIProvider` (id, models, capabilities, cost, call).
`src/lib/ai/orchestrator.server.ts` routes a request by intent, vision need, latency
budget and context size, then walks an ordered fallback chain. Every call has a
timeout, a retry cap and a watchdog; errors are normalised
(`rate_limit | outage | auth | invalid_response | blocked | timeout`) so the UI never
shows a raw provider error. Adding a provider is a registry entry — no core change.

`LOVABLE_API_KEY` is read inside handlers only and never reaches the browser or the
extension.

## Element addressing

Elements are addressed by a generated `ref` (`el-12`) that maps to a snapshot entry
carrying role, accessible name, tag, and a best-effort selector. Coordinates are
never used for targeting. Before acting, the content script re-resolves the ref
against the live DOM; if the element moved or vanished, it reports
`stale_element` instead of clicking the wrong thing.

## Boundaries we do not cross

`chrome://*`, the Chrome Web Store, other extensions' pages, cross-origin iframes we
have no permission for, CAPTCHA, authentication challenges, and payment
confirmations. These are reported to the user as blocked with the reason.
