# Changelog

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
