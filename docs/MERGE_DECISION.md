# MERGE DECISION MATRIX
## Unified AI Buddy Platform Architecture

**Status**: DECISION DOCUMENT - No code changes yet  
**Date**: October 7, 2026  
**Scope**: Consolidate AI Buddy + Ai-buddy-extension + future AI Trainer into ONE repo  
**Master Repo**: `murshidali8373-alt/your-ai-companion`  

---

## EXECUTIVE SUMMARY

### Current State
- **Main Repo** (`your-ai-companion`): 90.6% TypeScript - Web app + backend WORKING
- **Extension Repo** (`Ai-buddy-extension`): EMPTY/REFERENCED ONLY
- **AI Trainer**: NOT IN EITHER REPO

### Decision
- **DO NOT** create new repos
- **DO NOT** duplicate code
- **USE** `your-ai-companion` as MASTER
- **BUILD** Chrome Extension in `your-ai-companion/extension/`
- **PLAN** AI Trainer as module, build later
- **MERGE** anything useful from `Ai-buddy-extension` (if exists)

---

## SECTION 1: MASTER DECISION MATRIX

| Component | Location | Exists? | Working? | Belongs To | Decision | P | Reason |
|-----------|----------|---------|----------|-----------|----------|---|--------|
| **AI BUDDY CORE** | | | | | | | |
| Authentication | src/integrations/supabase/ | ✅ YES | ✅ YES | AI Buddy | **KEEP** | P0 | Production-ready |
| User Profiles | src/integrations/supabase/types | ✅ YES | ✅ YES | AI Buddy | **KEEP** | P0 | Foundation layer |
| Dashboard | src/routes/_authenticated/dashboard.tsx | ✅ YES | ✅ YES | AI Buddy | **KEEP** | P0 | Main product UI |
| Buddy Gallery | src/routes/_authenticated/buddies.tsx | ✅ YES | ✅ YES | AI Buddy | **KEEP** | P0 | Core feature |
| Buddy System (15 preset) | src/lib/buddy-service.server.ts | ✅ YES | ✅ YES | AI Buddy | **KEEP** | P0 | Differentiation |
| Custom Buddy Creator | src/routes/_authenticated/buddies.new.tsx | ✅ YES | ✅ YES | AI Buddy | **KEEP** | P0 | User feature |
| Voice STT/TTS | src/components/voice-bar.tsx | ✅ YES | ✅ YES | AI Buddy | **KEEP** | P0 | Core UX |
| Voice State Machine | src/shared/voice-turn.ts | ✅ YES | ✅ YES | Shared | **KEEP** | P0 | Reusable logic |
| **AI ORCHESTRATION** | | | | | | | |
| AI Orchestrator | src/lib/ai/orchestrator.server.ts | ✅ YES | ✅ YES | Shared | **KEEP** | P0 | Provider routing |
| Model Registry | src/lib/ai/registry.ts | ✅ YES | ✅ YES | Shared | **KEEP** | P0 | Model selection |
| Prompt Builder | src/lib/ai/prompt.ts | ✅ YES | ✅ YES | Shared | **KEEP** | P0 | System prompts |
| Error Handling | src/lib/ai/errors.ts | ✅ YES | ✅ YES | Shared | **KEEP** | P0 | Resilience |
| **PAGE UNDERSTANDING** | | | | | | | |
| Page Snapshot Contract | src/shared/page-snapshot.ts | ✅ YES | ✅ YES | AI Buddy | **KEEP** | P0 | Extension dependency |
| Context Manager | src/shared/page-snapshot.ts | ✅ YES | ✅ YES | AI Buddy | **KEEP** | P0 | Token budgeting |
| Restricted URL Logic | src/shared/restricted-url.ts | ✅ YES | ✅ YES | AI Buddy | **KEEP** | P0 | Security |
| **SECURITY & PERMISSIONS** | | | | | | | |
| Permission Ladder | src/shared/permissions.ts | ✅ YES | ✅ YES | AI Buddy | **KEEP** | P0 | Authorization |
| Sensitive Data Blocker | src/shared/sensitive.ts | ✅ YES | ✅ YES | AI Buddy | **KEEP** | P0 | Privacy |
| RLS Database Rules | supabase/migrations/ | ✅ YES | ✅ YES | AI Buddy | **KEEP** | P0 | Data isolation |
| Bearer Token Verification | src/lib/supabase-bearer.server.ts | ✅ YES | ✅ YES | AI Buddy | **KEEP** | P0 | API security |
| **MEMORY & STATE** | | | | | | | |
| Memory Store Logic | src/lib/buddy-service.server.ts | ✅ YES | ✅ YES | AI Buddy | **KEEP** | P0 | User feature |
| Task Logging | src/lib/buddy-service.server.ts | ✅ YES | ✅ YES | AI Buddy | **KEEP** | P1 | Observability |
| Audit Log | supabase/migrations/ | ✅ YES | ✅ YES | AI Buddy | **KEEP** | P1 | Compliance |
| **USER EXPERIENCE** | | | | | | | |
| Settings Page | src/routes/_authenticated/settings.tsx | ✅ YES | ✅ YES | AI Buddy | **KEEP** | P0 | Customization |
| 3D Avatar (Three.js) | src/components/buddy-3d.tsx | ✅ YES | ✅ YES | AI Buddy | **KEEP** | P0 | Visual appeal |
| 2D Animations | src/components/buddy-avatar.tsx | ✅ YES | ✅ YES | AI Buddy | **KEEP** | P0 | Fallback |
| UI Components | src/components/ui/ | ✅ YES | ✅ YES | Shared | **KEEP** | P0 | Design system |
| **BACKEND APIs** | | | | | | | |
| /api/public/extension/ask | src/routes/api/public/extension/ask.ts | ✅ YES | ✅ YES | Shared | **KEEP** | P0 | Extension endpoint |
| /api/public/extension/health | src/routes/api/public/extension/health.ts | ✅ YES | ✅ YES | Shared | **KEEP** | P1 | Diagnostics |
| Server Functions | src/lib/app.functions.ts | ✅ YES | ✅ YES | Shared | **KEEP** | P0 | Web ↔ Backend |
| Session Handshake | src/routes/_authenticated/connect.tsx | ✅ YES | ✅ YES | Shared | **KEEP** | P0 | Extension auth |
| **CHROME EXTENSION** | | | | | | | |
| manifest.json | ❌ MISSING | ❌ NO | ❌ NO | Extension | **BUILD NEW** | P0 | Required MV3 |
| service-worker.js | ❌ MISSING | ❌ NO | ❌ NO | Extension | **BUILD NEW** | P0 | Session mgmt |
| content-script.js | ❌ MISSING | ❌ NO | ❌ NO | Extension | **BUILD NEW** | P0 | Page reading |
| side-panel.html | ❌ MISSING | ❌ NO | ❌ NO | Extension | **BUILD NEW** | P0 | UI/UX |
| Extension build pipeline | ❌ MISSING | ❌ NO | ❌ NO | Build | **BUILD NEW** | P0 | Bundling |
| **BROWSER AUTOMATION** | | | | | | | |
| Click automation | ❌ MISSING | ❌ NO | ❌ NO | Extension | **DEFER** | P1 | Phase 4+ |
| Type automation | ❌ MISSING | ❌ NO | ❌ NO | Extension | **DEFER** | P1 | Phase 4+ |
| Form filling | ❌ MISSING | ❌ NO | ❌ NO | Extension | **DEFER** | P1 | Phase 4+ |
| Select handling | ❌ MISSING | ❌ NO | ❌ NO | Extension | **DEFER** | P1 | Phase 4+ |
| **AI TRAINER** | | | | | | | |
| Exercise library | ❌ MISSING | ❌ NO | ❌ NO | AI Trainer | **DEFER** | P2 | Future module |
| Pose detection | ❌ MISSING | ❌ NO | ❌ NO | AI Trainer | **DEFER** | P2 | Future module |
| Camera access | ❌ MISSING | ❌ NO | ❌ NO | AI Trainer | **DEFER** | P2 | Future module |
| Workout engine | ❌ MISSING | ❌ NO | ❌ NO | AI Trainer | **DEFER** | P2 | Future module |
| Rep counting | ❌ MISSING | ❌ NO | ❌ NO | AI Trainer | **DEFER** | P2 | Future module |
| **DOCUMENTATION** | | | | | | | |
| COMPLETE_TECHNICAL_AUDIT.md | docs/ | ✅ YES | ✅ YES | Reference | **KEEP** | P0 | Critical info |
| PROJECT_ARCHITECTURE.md | docs/ | ✅ YES | ✅ YES | Reference | **KEEP** | P0 | Design doc |
| FEATURE_REGISTRY.md | docs/ | ✅ YES | ✅ YES | Reference | **KEEP** | P0 | Feature tracker |
| BUG_REGISTRY.md | docs/ | ✅ YES | ✅ YES | Reference | **KEEP** | P0 | Bug history |
| SECURITY.md | docs/ | ✅ YES | ✅ YES | Reference | **KEEP** | P0 | Security model |
| TEST_PLAN.md | docs/ | ✅ YES | ✅ YES | Reference | **KEEP** | P0 | QA guide |
| **BUILD & CONFIG** | | | | | | | |
| package.json | ✅ YES | ✅ YES | Build | **KEEP** | P0 | Dependencies |
| vite.config.ts | ✅ YES | ✅ YES | Build | **KEEP** | P0 | Build config |
| tsconfig.json | ✅ YES | ✅ YES | Build | **KEEP** | P0 | TS config |
| Database migrations | supabase/ | ✅ YES | ✅ YES | Data | **KEEP** | P0 | Schema |
| .env.example | ✅ YES | ✅ YES | Config | **KEEP** | P0 | Env template |
| **AI-BUDDY-EXTENSION REPO** | Ai-buddy-extension/ | ❌ EMPTY | ❌ NO | N/A | **ARCHIVE** | P2 | No content |

---

## SECTION 2: PROTECTED EXISTING SYSTEMS

### Rule: IF WORKING → KEEP IT

Everything listed below MUST NOT be deleted, renamed, or substantially rewritten during merge:

#### **AI Buddy Core (Mission-Critical)**
- ✅ `src/integrations/supabase/*` - Authentication is production-ready
- ✅ `src/lib/buddy-service.server.ts` - Core ask/answer logic
- ✅ `src/lib/ai/` - Orchestrator, routing, error handling
- ✅ `src/routes/_authenticated/*` - Dashboard, buddies, settings
- ✅ `src/components/voice-*.tsx` - Voice UI and state machine
- ✅ `src/shared/permissions.ts` - Permission system
- ✅ `supabase/migrations/*` - Database schema

**Why Protected**: These are the foundation of a working product. Rewriting them wastes time and introduces bugs.

#### **Shared Infrastructure (Used by Extension)**
- ✅ `src/shared/page-snapshot.ts` - Extension needs this contract
- ✅ `src/shared/voice-turn.ts` - Both apps use voice logic
- ✅ `src/lib/ai/prompt.ts` - System prompt builder
- ✅ `src/routes/api/public/extension/*` - Backend for extension
- ✅ `src/lib/supabase-bearer.server.ts` - Extension authentication

**Why Protected**: Extension code depends on these. Changing them breaks extension.

#### **Build & Configuration**
- ✅ `package.json` - Dependency list
- ✅ `vite.config.ts` - Build pipeline
- ✅ `tsconfig.json` - TypeScript setup

**Why Protected**: Changing build config can break the entire app.

#### **Documentation**
- ✅ `docs/COMPLETE_TECHNICAL_AUDIT.md` - Decisions basis
- ✅ `docs/PROJECT_ARCHITECTURE.md` - Design reference
- ✅ `docs/FEATURE_REGISTRY.md` - Feature tracking

**Why Protected**: Remove these and nobody knows what was decided.

---

## SECTION 3: WHAT CAN BE REMOVED LATER

**Do NOT delete now. Mark as REMOVE LATER after migration completes.**

| Item | Evidence | Priority |
|------|----------|----------|
| Placeholder landing page | `src/routes/index.tsx` - Just a blank placeholder | P2 |
| Extension reference docs | Docs mentioning extension that didn't exist | P2 |
| Unused test pages | `extension/test-pages/` - referenced but not in repo | P3 |
| Temporary 2D animations | `src/components/buddy-avatar.tsx` - 2D is fallback, 3D is real | P3 |
| Demo voice page | `src/components/voice-demo.tsx` - Not in main flow | P2 |

**Why not delete now?**: Someone might be using them. Delete only after confirming nobody depends on them.

---

## SECTION 4: WHAT MUST BE BUILT (PRIORITY ORDER)

### P0 — BUILD FIRST (Required for MVP)

Must build to have a working product outside web app:

#### 1. Chrome Extension Foundation

**Location**: `your-ai-companion/extension/`

**Files to Create**:
```
extension/
├── manifest.json          (MV3 configuration)
├── service-worker.js      (Background service)
├── content-script.js      (Page reading)
├── side-panel.html        (UI shell)
├── side-panel.js          (UI logic)
├── public/
│   ├── icon-16.png
│   ├── icon-48.png
│   └── icon-128.png
└── styles/
    └── side-panel.css
```

**Why P0**: Without extension, users can only use web app. Extension is the differentiator.

**Estimated Time**: 2-3 weeks

#### 2. Extension Build Pipeline

**Location**: `vite.config.ts` + new `extension.vite.config.ts`

**What's Needed**:
- Separate Vite config for extension
- Bundle service worker
- Bundle content script
- Copy manifest + assets
- ZIP extension for download
- Place in `public/ai-buddy-extension.zip`

**Why P0**: Cannot distribute extension without this.

**Estimated Time**: 1 week

#### 3. Extension ↔ Web App Connection

**Already exists**:
- Session handshake page (`src/routes/_authenticated/connect.tsx`)
- Backend endpoints (`src/routes/api/public/extension/*`)

**What's Needed**:
- Implement `window.postMessage` in extension
- Listen for `AI_BUDDY_SESSION` message
- Store token in `chrome.storage.local`
- Call backend endpoint with bearer token

**Why P0**: Without this, extension can't authenticate.

**Estimated Time**: 3-5 days

---

### P1 — BUILD NEXT (Important features)

#### 4. Page Context Extraction (Content Script)

**Location**: `extension/content-script.js`

**Reuse From**: `src/shared/page-snapshot.ts` (contract already defined)

**What's Needed**:
- DOM inspection to extract headings, forms, controls, alerts
- Build PageSnapshot object matching contract
- Send to service worker
- Handle DOM mutations

**Why P1**: Without this, extension can't understand pages.

**Estimated Time**: 1 week

#### 5. Element Highlighting

**Location**: `extension/content-script.js`

**What's Needed**:
- Receive element ref from backend
- Find element by ref
- Highlight visually
- Scroll into view

**Why P1**: Users need visual feedback of what buddy is pointing at.

**Estimated Time**: 3-5 days

#### 6. Side Panel UI

**Location**: `extension/side-panel.html` + `extension/side-panel.js`

**Reuse**: `src/components/voice-bar.tsx` logic (port to vanilla JS)

**What's Needed**:
- Buddy avatar display
- Voice input button
- Text input fallback
- Buddy response display
- Highlight/scroll results
- TTS playback

**Why P1**: Main user interface.

**Estimated Time**: 1 week

---

### P2 — FUTURE (After MVP)

#### 7. Browser Automation (Phase 4)

**Location**: `extension/content-script.js` + new backend

**What's Needed**:
- Click detection and execution
- Type automation
- Form filling
- Navigation
- Error recovery

**Why P2**: Documented for Phase 4, not needed for MVP.

**Estimated Time**: 2-3 weeks (future)

#### 8. AI Trainer Integration

**Location**: New module `src/trainer/`

**What's Needed**:
- Exercise database schema
- Camera access + pose detection
- Workout engine
- Coach system

**Why P2**: Separate product layer, can be added later.

**Estimated Time**: 4-6 weeks (future)

---

### P3 — OPTIONAL (Nice-to-have)

- Screenshot capture for better context
- OCR support
- Multi-model cross-check
- Wake word detection
- Advanced analytics

---

## SECTION 5: TARGET ARCHITECTURE (UNIFIED)

```
┌─────────────────────────────────────────────────────────────┐
│                    YOUR AI COMPANION                         │
│                     MASTER REPOSITORY                        │
│              murshidali8373-alt/your-ai-companion            │
└────────────────────────┬────────────────────────────────────┘
                         │
        ┌────────────────┼────────────────┐
        │                │                │
    ┌───▼────┐      ┌───▼────┐      ┌───▼────┐
    │   WEB  │      │EXTENSION│      │ TRAINER│
    │   APP  │      │         │      │ (LATER)│
    └───┬────┘      └───┬────┘      └───┬────┘
        │                │                │
    ┌───▼────────────────▼────────────────▼────┐
    │                                          │
    │        SHARED CORE INFRASTRUCTURE        │
    │                                          │
    │  ┌──────────────────────────────────┐  │
    │  │ AI ORCHESTRATION                 │  │
    │  │ - Model routing                  │  │
    │  │ - Fallback chains                │  │
    │  │ - Error handling                 │  │
    │  └──────────────────────────────────┘  │
    │                                          │
    │  ┌──────────────────────────────────┐  │
    │  │ VOICE SYSTEM                     │  │
    │  │ - STT/TTS                        │  │
    │  │ - State machine                  │  │
    │  │ - Barge-in                       │  │
    │  └──────────────────────────────────┘  │
    │                                          │
    │  ┌──────────────────────────────────┐  │
    │  │ AUTHENTICATION & SECURITY        │  │
    │  │ - Supabase auth                  │  │
    │  │ - RLS policies                   │  │
    │  │ - Permission ladder              │  │
    │  │ - Sensitive data blocker         │  │
    │  └──────────────────────────────────┘  │
    │                                          │
    │  ┌──────────────────────────────────┐  │
    │  │ USER DATA & STATE                │  │
    │  │ - Profiles                       │  │
    │  │ - Memory store                   │  │
    │  │ - Task logging                   │  │
    │  │ - Preferences                    │  │
    │  └──────────────────────────────────┘  │
    │                                          │
    │  ┌──────────────────────────────────┐  │
    │  │ BUDDY SYSTEM                     │  │
    │  │ - 15 preset buddies              │  │
    │  │ - Custom buddy creator           │  │
    │  │ - Personas & prompts             │  │
    │  └──────────────────────────────────┘  │
    │                                          │
    │  ┌──────────────────────────────────┐  │
    │  │ PAGE UNDERSTANDING               │  │
    │  │ - Snapshot contract              │  │
    │  │ - Context manager                │  │
    │  │ - URL restrictions               │  │
    │  └──────────────────────────────────┘  │
    │                                          │
    └──────────────────────────────────────────┘
```

### Architecture Rationale

1. **Single Repository**: All code in `your-ai-companion` = single source of truth
2. **Shared Foundation**: AI, voice, auth, data layers are reused by all UIs
3. **Modular UIs**: Web app, extension, trainer are separate frontends
4. **Scalable**: Easy to add new Buddy skills or modules later
5. **Secure**: RLS + permission ladder protect data across all frontends

---

## SECTION 6: IMPLEMENTATION ROADMAP

### PHASE 0: Repository Consolidation
**Duration**: 1-2 days  
**Status**: IN PROGRESS

**What**:
- ✅ Complete technical audit
- ✅ Create decision matrix (this doc)
- ❌ Archive `Ai-buddy-extension` repo (reference only, no deletion)
- ❌ Update README with new architecture
- ❌ Document "main" as source of truth

**Owner**: Architecture team  
**Risk**: Low  
**Next**: PHASE 1

---

### PHASE 1: Chrome Extension MVP Foundation
**Duration**: 2-3 weeks  
**Status**: PLANNED

**What**:
- Create `extension/` directory structure
- Write MV3 manifest.json
- Implement service-worker.js (token storage, message handling)
- Implement content-script.js (page reading, highlight)
- Create side-panel.html (UI shell)
- Set up extension build pipeline (separate Vite config)
- Test locally in Chrome Developer Mode

**Dependencies**: None  
**Owner**: Extension team  
**Risk**: Medium (Chrome API learning curve)  
**Deliverable**: Extension loads in Chrome, connects to web app, reads pages

**Next**: PHASE 2

---

### PHASE 2: Extension ↔ AI Buddy Connection
**Duration**: 1 week  
**Status**: AFTER PHASE 1

**What**:
- Implement window.postMessage in extension
- Listen for AI_BUDDY_SESSION message
- Store token in chrome.storage.local
- Call `/api/public/extension/ask` endpoint
- Implement error handling
- Test full roundtrip: extension → ask → response

**Dependencies**: PHASE 1 complete  
**Owner**: Extension + Backend team  
**Risk**: Low (backend already exists)  
**Deliverable**: Extension can ask AI and get answers

**Next**: PHASE 3

---

### PHASE 3: Page Context & Element Highlighting
**Duration**: 1 week  
**Status**: AFTER PHASE 2

**What**:
- Implement DOM inspection (reuse snapshot contract)
- Extract headings, forms, controls, alerts
- Send PageSnapshot to backend
- Implement element highlighting
- Implement scroll-to-element
- Test on real pages

**Dependencies**: PHASE 2 complete  
**Owner**: Extension team  
**Risk**: Medium (DOM fragility)  
**Deliverable**: Extension highlights elements on page

**Next**: PHASE 4

---

### PHASE 4: Browser Automation (Phase 4 from Roadmap)
**Duration**: 2-3 weeks  
**Status**: AFTER PHASE 3

**What**:
- Implement click automation
- Implement type automation
- Implement form filling
- Implement error recovery
- Add confirmation dialogs
- Implement page verification

**Dependencies**: PHASE 3 complete  
**Owner**: Automation team  
**Risk**: High (complex automation)  
**Deliverable**: Extension can click, type, submit

**Note**: This is Phase 4 from original roadmap. Do NOT include in initial extension MVP.

**Next**: PHASE 5

---

### PHASE 5: Multi-Step Workflows
**Duration**: 2 weeks  
**Status**: AFTER PHASE 4

**What**:
- Implement workflow state machine
- Add multi-step task execution
- Implement rollback capability
- Add workflow history

**Dependencies**: PHASE 4 complete  
**Owner**: Automation team  
**Risk**: Medium  
**Deliverable**: Extension can execute multi-step tasks

**Next**: PHASE 6

---

### PHASE 6: AI Trainer Integration
**Duration**: 4-6 weeks  
**Status**: PLANNED (FUTURE)

**What**:
- Create exercise database schema
- Implement camera access
- Integrate pose detection library
- Build workout engine
- Implement coach system
- Add trainer UI to dashboard

**Dependencies**: PHASE 0 complete  
**Owner**: AI Trainer team  
**Risk**: High (pose detection complexity)  
**Deliverable**: AI Trainer module working with AI Buddy core

**Note**: This is NOT part of initial release. Plan separately.

**Next**: Release v1.0

---

### PHASE 7: Testing & Security
**Duration**: 1 week  
**Status**: AFTER PHASE 4

**What**:
- Unit tests for extension messaging
- Integration tests for extension ↔ backend
- Security audit of token handling
- Content script security review
- Permissions audit

**Dependencies**: PHASE 3 complete  
**Owner**: QA + Security team  
**Risk**: Low  
**Deliverable**: Security certification + test coverage > 80%

**Next**: Production release

---

### PHASE 8: Chrome Web Store Submission
**Duration**: Varies by review  
**Status**: AFTER PHASE 7

**What**:
- Create Chrome Web Store account
- Write store listing
- Upload extension to store
- Pass store review
- Publish

**Dependencies**: PHASE 7 complete  
**Owner**: Product team  
**Risk**: Medium (store review timing)  
**Deliverable**: Extension available in Chrome Web Store

---

## SECTION 7: AI TRAINER INTEGRATION PLAN

**Status**: DEFERRED (Not part of initial MVP)

### What AI Trainer Will Need

**Shared from AI Buddy Core**:
- ✅ Authentication (Supabase)
- ✅ User profiles
- ✅ AI orchestrator
- ✅ Voice system (for voice coaching)
- ✅ Memory store (for workout history)
- ✅ Task logging
- ✅ Permissions system
- ✅ Dashboard (extend with trainer section)

**AI Trainer-Specific**:
- ❌ Exercise database (new)
- ❌ Pose detection (new)
- ❌ Workout engine (new)
- ❌ Coach system (new)
- ❌ Rep counting (new)
- ❌ Form analysis (new)
- ❌ Camera integration (new)

### Integration Strategy

1. **Phase 6**: Create `src/trainer/` module
2. **Phase 6**: Add trainer routes (`src/routes/_authenticated/trainer.*`)
3. **Phase 6**: Extend dashboard with trainer tab
4. **Phase 6**: Use shared voice for voice coaching
5. **Phase 6**: Store workout data in shared memory/tasks
6. **Phase 7**: Integrate trainer UI with main dashboard

### Database Changes Needed

```sql
-- New tables
CREATE TABLE trainer_exercises (
  id UUID PRIMARY KEY,
  name TEXT,
  description TEXT,
  video_url TEXT,
  proper_form TEXT,
  muscles_targeted TEXT[]
);

CREATE TABLE trainer_workouts (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES auth.users,
  name TEXT,
  exercises UUID[] REFERENCES trainer_exercises,
  created_at TIMESTAMP
);

CREATE TABLE trainer_sessions (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES auth.users,
  workout_id UUID REFERENCES trainer_workouts,
  duration_minutes INT,
  reps_completed INT,
  form_score INT,
  created_at TIMESTAMP
);

-- RLS policy: user_id = auth.uid()
ALTER TABLE trainer_exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE trainer_workouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE trainer_sessions ENABLE ROW LEVEL SECURITY;
```

---

## SECTION 8: DO NOT REBUILD THESE

### Golden Rule
If it's working and in production → preserve it.

| System | Why Not Rebuild |
|--------|-----------------|
| Supabase auth | Battle-tested, handles 2FA, OAuth, sessions |
| RLS policies | Security-critical, already audited |
| Voice system | Complex state machine, extensively tested |
| AI orchestrator | Supports multiple models, fallback logic |
| Permission system | Security model depends on it |
| Buddy system | 15 buddies with prompts, personas carefully crafted |
| Dashboard | Users depend on it, breaking it loses them |
| Page snapshot contract | Extension architecture depends on it |

**Exception**: Only rebuild if core logic is broken AND no one is using it. Evidence required.

---

## SECTION 9: WHAT CAN BE CLEANED UP LATER

| Item | Why Wait |
|------|----------|
| Landing page placeholder | Update after initial extension launch |
| 2D buddy animation | Keep as fallback until 3D is solid |
| Demo voice component | Remove after official launch |
| Broken extension docs | Clean up after actual extension ships |
| Unused test pages | Confirm nobody uses them first |

**Timeline**: Clean up after v1.0 release, not during active development.

---

## SECTION 10: BUILD DEPENDENCIES & RISKS

### Blockers (Must Fix First)

| Issue | Status | Impact | Fix |
|-------|--------|--------|-----|
| No extension code | ❌ BLOCKING | Cannot ship product | Build PHASE 1 |
| No extension build pipeline | ❌ BLOCKING | Cannot package/distribute | Build PHASE 1 |
| Lovable API key missing | ⚠️ PARTIAL | Cannot test AI | Set in `.env` |

### Risks (Monitor Closely)

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Chrome API changes | Low | Extension breaks | Pin MV3 version |
| Content script fragility | Medium | DOM changes break script | Robust selectors |
| Token expiration | Medium | Extension auth fails | Refresh logic |
| Rate limiting | Low | AI calls fail | Already implemented |
| Pose detection library issues | High (later phase) | Trainer won't work | Research early |

---

## SECTION 11: SUCCESS CRITERIA

### MVP (End of PHASE 3)

- ✅ Chrome extension loads in Chrome
- ✅ Extension can connect to web app (session handshake works)
- ✅ Extension can read page (snapshot extraction works)
- ✅ Extension can ask AI (endpoint call works)
- ✅ Extension displays response (UI works)
- ✅ Extension highlights elements (visual feedback works)
- ✅ All tests pass
- ✅ No breaking changes to web app

### V1.0 (End of PHASE 4)

- ✅ Extension can automate browser actions (click, type, select)
- ✅ Extension has confirmation dialogs for sensitive actions
- ✅ Security audit passed
- ✅ Chrome Web Store submission ready
- ✅ >80% test coverage
- ✅ Documentation complete

---

## SECTION 12: FINAL EXECUTIVE DECISION

### Q1: What is the current product?

**A**: AI Buddy — a web-based AI assistant that reads web pages, answers questions, and remembers user context. Lives in the browser, works through a web app. No desktop/extension presence yet.

### Q2: What is actually working?

**A**:
- ✅ Web app (React + TanStack Start)
- ✅ Authentication (Supabase)
- ✅ AI orchestration (multi-model routing)
- ✅ Voice (STT/TTS)
- ✅ Memory system
- ✅ Permission system
- ✅ 15 pre-built buddies
- ✅ Dashboard
- ✅ Backend APIs

### Q3: What is missing?

**A**:
- ❌ Chrome Extension (0% implemented)
- ❌ Browser automation (0% implemented)
- ❌ AI Trainer module (0% implemented)

### Q4: What should NEVER be rebuilt?

**A**:
- Supabase authentication
- RLS database policies
- Voice state machine
- AI orchestrator
- Permission system
- Buddy system (15 buddies)
- Dashboard

These are production-ready. Rebuilding them wastes weeks and introduces bugs.

### Q5: What should be merged?

**A**:
- Everything from `Ai-buddy-extension` repo that exists (currently nothing to merge)
- All AI Trainer code if/when it exists elsewhere (not in this repo)

**Strategy**: Use `your-ai-companion` as MASTER. Do NOT create duplicate repos.

### Q6: What should be removed later?

**A**:
- Landing page placeholder (after marketing site ready)
- 2D buddy animation (after 3D is stable)
- Demo voice component (after official launch)
- Extension reference docs (after actual extension ships)

**Timeline**: After v1.0 release, not during active development.

### Q7: What should be built next?

**A**:
**Immediate (Next 4 weeks)**:

1. **PHASE 1**: Chrome Extension MVP (manifest, service worker, content script, side panel)
   - Duration: 2-3 weeks
   - Team: Frontend
   - Output: Extension loads in Chrome

2. **PHASE 2**: Extension ↔ AI Buddy connection
   - Duration: 1 week
   - Team: Frontend + Backend
   - Output: Extension can ask and get answers

3. **PHASE 3**: Page reading + highlighting
   - Duration: 1 week
   - Team: Frontend
   - Output: Extension highlights page elements

---

### Q8: Should the Chrome Extension be built now?

**A**: **YES. Immediately. P0 priority.**

**Evidence**:
- Web app is working but not useful without extension
- Backend APIs are ready and waiting
- No architecture conflicts
- User feedback likely: "How do I use this on real websites?"

**Timeline**: Start PHASE 1 this week.

**Critical**: Do NOT start Phase 4 (browser automation) yet. Foundation first.

---

### Q9: Should AI Trainer be merged now or later?

**A**: **LATER. Not until PHASE 6 (in 8-12 weeks).**

**Why**:
- AI Trainer code does NOT exist in this repo
- AI Trainer has separate infrastructure needs (pose detection, exercise DB)
- Merging now = merging empty plans (waste of time)
- Buddy core is stable → extend it later without risking it

**When to start AI Trainer planning**: After extension v1.0 ships (end of PHASE 4).

**Strategy**:
- PHASE 6 (future): Create `src/trainer/` module
- Reuse: auth, voice, memory, dashboard
- Separate: exercise DB, pose detection, coach engine

---

### Q10: What is the safest path to unified AI Buddy platform?

**A**:

```
CURRENT STATE:
└── your-ai-companion (web app only)

↓ (PHASE 1-3, 4 weeks)

MVP RELEASE:
├── your-ai-companion (web app)
└── Chrome Extension (extension/directory)
    └── Uses shared AI, voice, auth, memory

↓ (PHASE 4-5, 3 weeks)

AUTOMATION READY:
├── your-ai-companion (web app)
└── Chrome Extension
    └── With click/type/select

↓ (PHASE 6, 6 weeks, FUTURE)

UNIFIED PLATFORM:
├── your-ai-companion (web app)
├── Chrome Extension
└── AI Trainer Module
    └── Reuses: auth, voice, AI, memory
    └── New: exercise DB, pose detection, coach

```

### Recommended Execution Path

**Week 1-2**: PHASE 1 (extension foundation)
- Create manifest.json, service-worker.js, content-script.js
- Build pipeline (Vite config)
- Test locally

**Week 3**: PHASE 2 (connection)
- Session handshake
- Backend endpoint integration
- Token management

**Week 4**: PHASE 3 (page reading)
- DOM inspection
- Element highlighting
- Scroll integration

**Week 5-6**: PHASE 4 (automation)
- Click automation
- Type automation
- Form filling

**Week 7**: PHASE 7 (testing)
- Unit tests
- Integration tests
- Security audit

**Week 8+**: Chrome Web Store submission + AI Trainer planning

---

## FINAL RECOMMENDATION

### Master Repository Decision: APPROVED

| Decision | Status |
|----------|--------|
| Use `your-ai-companion` as master repo | ✅ APPROVED |
| Archive `Ai-buddy-extension` (no deletion) | ✅ APPROVED |
| Build Chrome Extension in `extension/` | ✅ APPROVED |
| Build Extension in phases (1-3 MVP, 4-5 automation) | ✅ APPROVED |
| Defer AI Trainer to PHASE 6 | ✅ APPROVED |
| Preserve all working AI Buddy systems | ✅ APPROVED |
| Start PHASE 1 immediately | ✅ APPROVED |

### Next Action

**Begin PHASE 1 (Chrome Extension MVP Foundation)**

- Duration: 2-3 weeks
- Team: Frontend developer(s)
- Deliverable: Extension loads in Chrome, authenticates with web app
- No changes to existing web app code
- Measurable success: Extension side panel displays, connects to AI Buddy backend

**DO NOT START until this document is reviewed and approved.**

---

**Document Status**: FINAL - Ready for implementation  
**Author**: Architecture Review  
**Date**: October 7, 2026  
**Next Review**: After PHASE 1 completion
