# Test plan

Run: `bunx vitest run`

## Automated (Vitest)

| Suite | Covers |
| --- | --- |
| `tests/snapshot.test.ts` | page snapshot: roles, labels, required flags, error text, sensitive-value redaction, ref stability |
| `tests/context.test.ts` | context manager: token budget, prioritising forms/errors over body text, truncation |
| `tests/orchestrator.test.ts` | provider routing, ordered fallback, retry cap, timeout/watchdog, error normalisation, no infinite retry |
| `tests/memory.test.ts` | sensitive-value detection for passwords, OTP, CVV, private keys, API keys |
| `tests/permissions.test.ts` | permission ladder: what each level may do, high-impact confirmation |
| `tests/restricted-url.test.ts` | `chrome://`, web store, extension pages and blocked domains are refused with a reason |

## Manual browser scenarios (`extension/test-pages/`)

1. `form.html` — labelled inputs, required fields, dropdown, radio, checkbox, a
   sensitive password field, and an inline validation error.
2. `slow.html` — content injected after 3 s; the snapshot must be taken after
   readiness, not on an empty DOM.
3. `error.html` — page-level error banner; the buddy must surface it.

Checklist per scenario: panel opens · Read page returns a snapshot · ask answers ·
highlight lands on the right field · stop cancels speech · a failed request shows a
readable message · task appears in `/tasks`.

## Regression checklist (run before every release)

Sign up · sign in · sign out · password reset mail · trial shows correct days ·
select buddy persists · create custom buddy · change permission level to `observe` and
confirm asks are refused · save + delete a memory · sensitive memory rejected ·
extension handshake · ask on all three test pages · diagnostics page all green.
