# Bug registry

History is append-only. Never delete an entry.

Severity: P0 critical · P1 high · P2 medium · P3 low.

| ID | Sev | Class | Reproduction | Expected | Actual | Root cause | Fix | Test | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| BUG-001 | P1 | security | Save a memory whose key is "password" | Rejected | Would be stored | No server-side sensitive filter | DB trigger `block_sensitive_memory` + client pre-check | `tests/memory.test.ts` | fixed |
| BUG-002 | P1 | ai | Provider returns 429 | Fall back / clear message | Raw error to user | No normalised error class | `normalizeGatewayError` + bounded fallback | `tests/orchestrator.test.ts` | fixed |
| BUG-003 | P1 | ai | Ask on a very long page | Request succeeds | Oversized prompt | Whole DOM sent | `buildPageContext` token budget | `tests/context.test.ts` | fixed |
| BUG-004 | P2 | agent | Highlight an element after the page re-renders | Reports stale element | Highlights the wrong node | Ref cached without re-resolution | Re-resolve ref before acting | manual | fixed |
| BUG-005 | P1 | security | Ask with permission level `observe` | Refused | Would answer/act | No gate on the endpoint | `assertPermission` in `/api/public/extension/ask` | `tests/permissions.test.ts` | fixed |
| BUG-006 | P2 | performance | Rapid repeated asks | Rate limited politely | Unbounded AI spend | No per-user throttle | Daily usage counter + in-request throttle | manual | fixed |
| BUG-007 | P2 | extension | Open the panel on `chrome://settings` | Explains it is blocked | Silent failure | No restricted-URL check | `isRestrictedUrl` guard in the service worker | `tests/restricted-url.test.ts` | fixed |

## Open

| ID | Sev | Class | Note |
| --- | --- | --- | --- |
| BUG-008 | P3 | voice | Speech-to-text depends on the browser's `webkitSpeechRecognition`; unavailable in Firefox and some Chromium builds. Typed input is offered as the fallback. |
| BUG-009 | P3 | ui | Buddy animation is 2D SVG, not the planned 3D avatar (phase 9). |
