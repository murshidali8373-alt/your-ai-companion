# Roadmap (live task list)

- [ ] Replace generic Buddy artwork and logo with one professional avatar family; verify fallback, motion and unchanged layouts.

- [ ] Finish web app pages: buddies gallery, custom buddy creator, settings, tasks, extension connect
- [x] Extension MV3 files + packaged zip (ask, page reading, highlight; voice in popup pending)
- [ ] Fold in uploaded Master Build Specification (voice endpointing ~1.5s silence, filler ignore, no overlapping TTS, one speaking Buddy)
- [ ] Use uploaded 3D starter pack (.glb models) as real-time 3D avatar, lazy-loaded, 2D fallback on low mode
- [ ] Tests (Vitest) for shared logic
- [ ] Docs/changelog update

- [x] Obsidian Glass premium look (dark-first) + 3-zone dashboard (dock / 3D stage + voice bar / activity)

- [ ] Repair existing Chrome side panel: Buddy roster/selection, character rendering, fresh page context, grounded targeting, safe form fill, Gemini request path, and verified tests.
- [x] Fix preview compile errors (extension Buddy list route)
- [x] Panel: 15 specialists + custom Buddy, character images, arm fingertip lands exactly on target
- [ ] Critical P0 — Full AI Chatbot + Browser Agent + Strict Model Control:
  - [ ] General AI conversation works independently without injecting active webpage snapshots or falling back to Page Overview
  - [ ] Unified smart intent router (`general_chat`, `page_analysis`, `browser_action`, `mixed_reason_and_action`) with seamless chat-to-action transitions
  - [ ] Strict selected provider/model execution across sessions (no silent provider/model switching on explicit choice; `"auto"` preserves resilient failover; honest error reporting when selected model/provider is unavailable)
- [ ] Batch 3 — Conversational Action Engine: one-chat actions, automatic microphone activation on incomplete form/search commands, incremental `activeFormSession` state & value verification
- [ ] Core Execution Engine Upgrade (P0/P1):
  - [ ] P0 — AI Planner + Buddy Executor + Observe/Verify/Recover loop (`navigate`, `download`, `verify_page`, `wait_for`, `fill_field`, `select`, `check`, `click`, `point`, `extract`; portal OTP/CAPTCHA pause; no arbitrary JS)
  - [ ] P0 — Reliable Clicking: accessible role/name/Shadow DOM/allFrames + scroll + `elementFromPoint` obstruction guard + multi-method click sequence + alternate-method retry
  - [ ] P0 — Reliable Form Filling: value-first Hinglish & comma-safe extraction (`"1234 FILL KR DO"`, `"9560798373 YE FILL KR DO"`), disambiguation, post-fill/blur validation detection, zero accidental submit/data invention
  - [ ] P0 — Website Navigation Registry & Verification: curated official URLs (UIDAI/myAadhaar, GST, Meesho, Flipkart Seller, Amazon Seller, Google Workspace), `"dashboard"` fix, ambiguity & anti-lookalike checks, verified load
  - [ ] P0 — Reliable File Downloads: `downloads` permission + `chrome.downloads` lifecycle (`in_progress` → `complete`/`interrupted`), direct URL + page-triggered/Blob downloads, chat/plan `download` intent
- [ ] Batch 4 — Popup/SidePanel health sync (`GET_HEALTH`), Guest vs Signed-In account isolation, and Custom Buddy persistence across reloads/sign-out

