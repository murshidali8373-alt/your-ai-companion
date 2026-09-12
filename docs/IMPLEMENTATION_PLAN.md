# Implementation plan

Status legend: `planned` · `scaffolded` (real code, not user-complete) · `complete`
(UI + logic + error handling + permissions + tests + docs).

| Phase | Scope | Status |
| --- | --- | --- |
| 0 | Project inspection, docs, registries | complete |
| 1 | Design system, database, auth, dashboard, buddy gallery, custom buddy | complete |
| 2 | MV3 extension foundation: manifest, service worker, side panel, content script, packaging, session handshake | complete |
| 3 | Voice (push-to-talk STT, TTS with interrupt), screen understanding, explain + highlight, task logging | complete |
| 4 | Browser agent: click / type / select / scroll with verify + recover | planned |
| 5 | Universal form engine, workflow engine, multi-step task state | planned |
| 6 | Skill registry + specialist packs (e-commerce, CA, legal, developer) | planned |
| 7 | Memory promotion from conversation, teach & replay | planned |
| 8 | Self-debug engine, expanded automated test engine, bug autopilot | planned |
| 9 | 3D buddy + emotion engine (currently a lightweight 2D animated buddy) | scaffolded |
| 10 | Multi-model cross-check, daily discovery, analytics dashboards | planned |

## Vertical slice delivered

Sign up → trial starts → pick a buddy → download and load the extension → sign the
extension in from the web app → ask "what is on this page?" / "where do I enter
GSTIN?" → the buddy reads the real page structure, answers in the buddy's voice and
language, speaks it, and highlights the element it means → the request is stored as a
task with its phase trace.

## Definition of done (applied per feature)

1. UI exists and is reachable.
2. Real backend/logic exists — no mocked responses.
3. Failure paths return a user-readable message.
4. Permission level is checked before anything touches a page.
5. Tests cover the pure logic; a manual script exists for browser-only paths.
6. `FEATURE_REGISTRY.md`, `BUG_REGISTRY.md` and `CHANGELOG.md` updated.
