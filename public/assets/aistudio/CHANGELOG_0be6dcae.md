# Changelog

## Unreleased — conversational, one-action-at-a-time browser control

### Added

- `extension/buddy-core.js`: shared pure logic (side panel, service worker, tests) that turns ordinary
  Hindi / Hinglish / English (incl. Devanagari speech output) into ONE intent, resolves references
  ("isko", "ab click karo", "ab Mumbai kar do"), reads answers to Buddy's questions ("doosra wala"),
  and picks the genuine official website out of search results (or reports that it is ambiguous).
- Task context in the side panel: last element, last filled field, last search, values the user told
  Buddy, pending question and queued steps. Targets are re-validated before every action.
- `WEB_SEARCH` / `GET_TAB_STATE` messages: search, choose the official site, open it, verify the real URL.
- Fill-vs-search distinction: "search box mein X likho" fills only; "X search karo" fills and searches;
  "search button par click karo" is a click.
- Tests: `tests/buddy-core.test.ts`, and real-browser suites in `tests/real/` (`npm run test:real`).

- MVP skills: several fields in one sentence, dropdown selection ("State mein Delhi select karo"), submit with an
  always-on confirmation scoped to the form being filled, named scroll areas ("Notices ko neeche scroll karo"),
  back / forward / refresh, "page par kya kya hai" (works without the AI server), and "ab tak kya kiya" activity log.
- Hindi/Hinglish field words ("naam", "pata", "rajya"...) resolve to the English labels on real pages.
- After a click Buddy reports what the page itself said (error / success banners, status lines).
- Texting shortcuts in commands ("kr", "pr", "yha", "msg") are understood; text to be typed is never altered.
- "X search karo is page par" searches inside the current page; Buddy no longer leaves the page for Google unless asked ("Google par search karo X").
- `public/demo/index.html`: offline demo portal; `tests/real/demo-journey.mjs`: 16-step end-to-end journey.

### Changed

- Click / open-link / fill no longer guess. Several equally good matches -> Buddy lists them and asks;
  the user's answer picks exactly that candidate. A stale remembered target is reported, not clicked.
- Success is verified, not assumed: clicks observe URL/dialog/DOM changes, fills read the value back
  (exact, or equal after page formatting), navigation checks the final URL / error page / redirects.
  `ok` is no longer `true` when the field rejected or wiped the value.
- `findContentOnPage` / "search box" only matches real search inputs and reports ambiguity instead of
  highlighting the first match.
- Multi-step requests (typed chains and LLM plans) execute only the first step; the rest are queued and
  run one at a time on "ab next step karo".
- Sensitive values (Aadhaar / card / PAN shaped, or in sensitive fields) are masked in the chat log and
  never echoed in action results.
- "PIN code" is no longer treated as a secret PIN. Fields with `maxlength` shorter than the value are
  refused with an explanation instead of silently truncating.

### Fixed

- Real Chrome rejects `undefined` in `chrome.scripting.executeScript` args ("Value is unserializable");
  `runTabScript` now sends `null`, which fixes text-targeted click/fill/open when no selector exists.
- `navigateTab` returned `ok: true` for timeouts and Chrome error pages.
- "ab click karo" previously searched for an element literally named "ab".
- Scroll-to-element reported success without checking that the element became visible.

## 0.1.0 — first working slice

### Added

- Marketing site, pricing and FAQ, dark/light/system theme.
- Email + password and Google sign-in, password reset, 14-day trial on signup.
- Dashboard: current buddy, plan/trial, recent tasks, usage, permission level.
- Buddy gallery with 15 specialist buddies, plus a custom buddy creator.
- Settings: permission ladder, privacy mode, memory list with add/delete.
- Provider-agnostic AI orchestrator with routing, ordered fallback, timeout,
  retry cap and normalised errors.
- Chrome MV3 extension: side panel, service worker, content script, page snapshot,
  element highlight, push-to-talk voice in, spoken answers with stop.
- Extension sign-in handshake from the web app; token-verified extension endpoints.
- Task and phase-trace logging, diagnostics endpoint, audit log.
- Docs: architecture, implementation plan, feature and bug registries, security,
  test plan, roadmap.

### Security

- RLS + grants on every table; roles in a separate table behind `has_role`.
- Sensitive-value blocklist in the database and in the snapshot builder.
- Permission gate and daily usage cap on the extension ask endpoint.
- Restricted-URL guard for `chrome://`, the web store and extension pages.

### Performance

- Page context trimmed to a token budget; snapshot capped in size and depth.
- No polling, no background screenshots, no continuous DOM observation.

### Known limitations

- Speech-to-text needs a Chromium browser; typing is the fallback.
- Buddy avatar is 2D animated SVG, not 3D yet.
- Clicking, typing and multi-step automation are not enabled yet (phase 4+).
