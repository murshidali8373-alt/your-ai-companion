# Changelog

## Unreleased — real-Chrome reliability, verification, and Hindi/Hinglish controls

### Added

- `extension/background.js`: `NAVIGATE_HISTORY` handler (`back`, `forward`, `reload`) and named scrollable container lookup (`opts.containerText`, e.g. `"Notices ko neeche scroll karo"`).
- `extension/sidepanel.js`: Local session activity log (`sessionActionLog` / `"ab tak kya kiya"`), instant local page inventory (`"is page par kya kya hai"` without requiring an AI call), `HISTORY_NAV` (`back` / `forward` / `refresh`), standalone `"Submit karo"` consequential action intent, explicit in-page search (`"<query> search karo is page par"`), `resolveOrdinalChoiceIndex` for disambiguation replies (`"pehla"`, `"doosra wala"`, `"teesra"`), and texting-shortcut normalization (`kr`, `pr`, `yha`, `msg`) that preserves typed field values verbatim.
- `tests/extension-edge-cases.test.ts`: Regression unit tests covering MV3 `sanitizeScriptArg`, PIN code vs secret PIN distinction, Hinglish/shortcut parsing, ordinal choice resolution, and headless Chromium DOM execution verification.

### Changed

- Sensitive-field detection (`src/shared/sensitive.ts`, `src/lib/buddy-animation-engine.ts`, `extension/snapshot.js`, `extension/background.js`, `extension/sidepanel.js`): Postal `"Pin Code"` / `"pin_code"` / `"pincode"` / `"postal pin"` fields are allowed while secret `"pin"` / `"atm_pin"` / `"pin number"` remain protected.
- Form filling (`smartFillFrameFunc` & `executeAction("type" | "fill_field")`): Checks `maxLength` before filling and refuses overflowing values instead of silently truncating; records `results.filled` only when readback passes `verified === true`, and returns `ok: false` when fields reject/clear input or dropdown options do not match.
- Ambiguity & target freshness (`click`, `open_link`, `findContentOnPage`): Returns deduplicated candidates with section context and prompts for ordinal selection instead of clicking blindly; detects stale selectors and prioritizes real editable inputs for `"search box/bar/input/field"`.
- Post-click page feedback: Captures visible alert/status/error banners after clicks and reports them in chat (with `concerned` avatar expression on errors).

### Fixed

- `runTabScript` in `extension/background.js`: Sanitizes `executeScript` args (`undefined` → `null`, strips `undefined` keys) to prevent Chrome MV3 `TypeError: Value is unserializable`.
- `navigateTab` in `extension/background.js`: Stops returning `ok: true` on listener timeouts or `chrome-error:` / `about:neterror:` pages.
- `scroll` (`to_element`) in `extension/background.js`: Verifies viewport intersection/scroll movement before claiming success.
- `parseActionIntent` in `extension/sidepanel.js`: Strips leading temporal fillers (`"ab"`, `"now"`, `"phir"`, `"fir"`) so `"ab click karo"` and `"ab search button click karo"` no longer search for `"ab"`.

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
