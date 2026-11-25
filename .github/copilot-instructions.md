# Copilot Repository Instructions

## Repository change workflow
- Read and follow `AGENTS.md` before edits. In particular, keep the shared Buddy visual configuration separate from business records, honor reduced-motion preferences, and only resolve server AI credentials through `src/lib/ai/provider-keys.server.ts`.
- Work only on the user-authorized working branch. Do not merge, deploy, publish, or rewrite existing history.
- Preserve the existing Unified Orchestrator, Browser Executor, extension IPC, DAG, providers, permissions, and persistence architecture. Extend those systems rather than creating replacements.
- Make small, focused changes. Add regression tests for behavior fixes; do not weaken existing assertions.
- Never report simulated or unavailable workflow, connector, model, browser, or scheduler behavior as successfully executed.

## Verification
- Run focused Vitest tests for each change, then `npm test` (or the package manager's equivalent), `npm run lint`, `npm run build`, and `npm run package:extension` when appropriate.
- Clearly separate automated test results from live Chrome/provider/integration validation. Never claim live validation without actually performing it.
- Do not expose secrets in code, fixtures, output, or logs.
