# Bug registry

History is append-only. Never delete an entry.

Severity: P0 critical · P1 high · P2 medium · P3 low.

| ID      | Sev | Class       | Reproduction                                   | Expected                  | Actual                    | Root cause                       | Fix                                                    | Test                           | Status |
| ------- | --- | ----------- | ---------------------------------------------- | ------------------------- | ------------------------- | -------------------------------- | ------------------------------------------------------ | ------------------------------ | ------ |
| BUG-001 | P1  | security    | Save a memory whose key is "password"          | Rejected                  | Would be stored           | No server-side sensitive filter  | DB trigger `block_sensitive_memory` + client pre-check | `tests/memory.test.ts`         | fixed  |
| BUG-002 | P1  | ai          | Provider returns 429                           | Fall back / clear message | Raw error to user         | No normalised error class        | `normalizeGatewayError` + bounded fallback             | `tests/orchestrator.test.ts`   | fixed  |
| BUG-003 | P1  | ai          | Ask on a very long page                        | Request succeeds          | Oversized prompt          | Whole DOM sent                   | `buildPageContext` token budget                        | `tests/context.test.ts`        | fixed  |
| BUG-004 | P2  | agent       | Highlight an element after the page re-renders | Reports stale element     | Highlights the wrong node | Ref cached without re-resolution | Re-resolve ref before acting                           | manual                         | fixed  |
| BUG-005 | P1  | security    | Ask with permission level `observe`            | Refused                   | Would answer/act          | No gate on the endpoint          | `assertPermission` in `/api/public/extension/ask`      | `tests/permissions.test.ts`    | fixed  |
| BUG-006 | P2  | performance | Rapid repeated asks                            | Rate limited politely     | Unbounded AI spend        | No per-user throttle             | Daily usage counter + in-request throttle              | manual                         | fixed  |
| BUG-007 | P2  | extension   | Open the panel on `chrome://settings`          | Explains it is blocked    | Silent failure            | No restricted-URL check          | `isRestrictedUrl` guard in the service worker          | `tests/restricted-url.test.ts` | fixed  |

## Open

| ID      | Sev | Class | Note                                                                                                                                                        |
| ------- | --- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BUG-008 | P3  | voice | Speech-to-text depends on the browser's `webkitSpeechRecognition`; unavailable in Firefox and some Chromium builds. Typed input is offered as the fallback. |
| BUG-009 | P3  | ui    | Buddy animation is 2D SVG, not the planned 3D avatar (phase 9).                                                                                             |
| BUG-010 | P0  | ai    | General chat questions (`"What is Apple?"`, `"Explain GST"`) force active webpage context and fall back to `"Page Overview"` (`sidepanel.js`, `background.js`, `buddy-service.server.ts`). |
| BUG-011 | P0  | ai    | Explicit non-`"auto"` model/provider selections silently fail over to Gemini or drop selection across reloads (`orchestrator.server.ts`, `provider-adapters.server.ts`, `sidepanel.html:1606` invalid `anthropic-claude-3-5-sonnet`). |
| BUG-012 | P0  | agent | Value-first Hinglish fill commands (`"1234 FILL KR DO"`, `"9560798373 YE FILL KR DO"`), comma-containing values (`"hello, world type kar do"`), and `"fill kar do <val>"` fail extraction or dump into page summary/snapshot search (`sidepanel.js:2640-2861`, `background.js:1350-1406`). |
| BUG-013 | P0  | agent | `executeAction("click")` lacks obstruction (`elementFromPoint`) checks, multi-method click fallback, and alternate-method retry state (`background.js:4688-4714`, `5351-5477`). |
| BUG-014 | P0  | agent | Extension lacks `"downloads"` permission in `manifest.json` and has zero `chrome.downloads` lifecycle tracking (`DOWNLOAD_FILE`, direct URL vs page trigger vs Blob/interrupted handling). |
| BUG-015 | P0  | agent | `parseActionIntent:3346` blocks `"dashboard"` from `OPEN_WEBSITE`, and `KNOWN_PORTALS` lacks Flipkart Seller, Amazon Seller, Google Sheets/Docs/Drive, and ambiguity/anti-lookalike checks. |
| BUG-016 | P0  | agent | AI planner (`prompt.ts:170`, `background.js:916`) drops `navigate`/`download`/`verify_page`/`wait_for` steps, and `runPlanLoop` (`sidepanel.js:6333`) lacks AI-driven observe/verify/recover replanning or OTP/CAPTCHA portal pauses. |
| BUG-017 | P1  | ext   | `background.js` lacks `GET_HEALTH` status breakdown, `popup.{html,js}` hides Guest vs Signed-In / provider warnings, and local memories/tasks/profile are not isolated across sign-out/account switches. |
