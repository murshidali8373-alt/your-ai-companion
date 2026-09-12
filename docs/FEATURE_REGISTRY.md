# Feature registry

| Feature | Category | Status | Version | Depends on | Tests | Known bugs | Perf impact | Security impact |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Marketing site | web | complete | 0.1.0 | — | manual | — | low | none |
| Email + Google auth | auth | complete | 0.1.0 | Cloud auth | manual | — | low | high (session) |
| Trial + plan status | billing | complete | 0.1.0 | subscriptions | manual | — | low | low |
| Dashboard | web | complete | 0.1.0 | auth, tasks | manual | — | low | low |
| Buddy gallery + selection | buddy | complete | 0.1.0 | buddies table | manual | — | low | none |
| Custom buddy creator | buddy | complete | 0.1.0 | custom_buddies | manual | — | low | low |
| Permission settings | security | complete | 0.1.0 | permission_settings | `tests/permissions.test.ts` | — | low | high |
| Memory store + sensitive blocklist | memory | complete | 0.1.0 | memories + DB trigger | `tests/memory.test.ts` | — | low | high |
| AI orchestrator + fallback + watchdog | ai | complete | 0.1.0 | LOVABLE_API_KEY | `tests/orchestrator.test.ts` | — | medium | high |
| Context manager (budgeted page context) | ai | complete | 0.1.0 | snapshot | `tests/context.test.ts` | — | low | medium |
| MV3 extension shell + packaging | extension | complete | 0.1.0 | — | manual | — | low | medium |
| Extension session handshake | extension | complete | 0.1.0 | auth | manual | — | low | high |
| Page snapshot (screen understanding) | agent | complete | 0.1.0 | content script | `tests/snapshot.test.ts` | — | medium | medium |
| Element highlight | agent | complete | 0.1.0 | snapshot refs | manual | — | low | low |
| Voice in (push-to-talk) / out (TTS) | voice | complete | 0.1.0 | Web Speech API | manual | Chrome-only STT | low | medium |
| Task + phase trace logging | observability | complete | 0.1.0 | tasks, task_events | manual | — | low | low |
| Diagnostics ("diagnose yourself") | observability | complete | 0.1.0 | health endpoint | manual | — | low | low |
| Animated buddy + emotion states | ui | scaffolded | 0.1.0 | — | — | 2D only, not 3D | low | none |
| Wake word "Hey Buddy" | voice | planned | — | continuous listening | — | browser limitation | high | high |
| Click / type / select automation | agent | planned | — | phase 4 | — | — | medium | high |
| Multi-step workflows, teach & replay | agent | planned | — | phase 5, 7 | — | — | medium | high |
| Skill packs (e-com / CA / legal / dev) | skills | planned | — | phase 6 | — | — | low | medium |
| Multi-model cross-check | ai | planned | — | phase 10 | — | — | high (cost) | low |
| Daily feature discovery | ops | planned | — | phase 10 | — | — | low | medium |
