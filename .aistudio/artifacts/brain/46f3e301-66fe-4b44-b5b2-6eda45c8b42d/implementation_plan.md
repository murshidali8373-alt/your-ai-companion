# AI BUDDY — ADAPTIVE OBSERVE-ACT-VERIFY (OAV) ARCHITECTURE PLAN

**Author:** Chief AI Architect, Product Strategist & Senior Engineering Auditor  
**Status:** Ready for Implementation Approval  
**Target:** AI Buddy Chrome Extension & Web Platform (`/app/applet`)

---

## 1. Executive Summary & Verification of Codebase Reality

Our independent audit of the repository verified the following baseline:

- **22 Vitest Test Suites (184 Tests)**: 100% passing.
- **Production Build & Lint**: 0 compilation errors, 0 ESLint errors.
- **Mascot Emotion & Keyframe Rig**: 10 CSS keyframe animations, 15 specialist costumes, live Emotion Lab on Dashboard, quick emotion test strip on landing page and extension side panel.
- **Extension Artifact**: MV3 compatible, packaged cleanly at `public/ai-buddy-extension.zip`.

### The Core Architectural Problem:

Currently, multi-step browser execution is formulated at $T_0$ from the initial prompt or snapshot. When Step 1 navigates to a new URL or triggers an AJAX tab filter, subsequent steps attempt to click or type into elements using pre-baked selectors that either no longer exist or belong to a superseded DOM tree.

**The Solution:** The **Adaptive Observe–Act–Verify (OAV) Execution Loop** transforms AI Buddy from a static command dispatcher into an autonomous browser agent that dynamically re-observes the live tab, re-grounds element references against the fresh accessibility tree, dispatches synthetic framework-compatible actions, awaits genuine page settling, semantically verifies the outcome, and passes cross-step data context down the workflow.

---

## 2. The 9-Stage OAV Architecture

```
┌─────────────────┐       ┌────────────────────┐       ┌───────────────────┐
│   1. OBSERVE    │ ────> │   2. UNDERSTAND    │ ────> │     3. PLAN       │
│ Fresh DOM Tree  │       │ Central AI Brain   │       │ Adaptive Graph    │
└─────────────────┘       └────────────────────┘       └─────────┬─────────┘
         ▲                                                       │
         │                                                       ▼
┌────────┴────────┐       ┌────────────────────┐       ┌───────────────────┐
│    9. ADAPT     │ <──── │   8. RE-OBSERVE    │ <──── │ 4. RESOLVE TARGET │
│ Next Step / Mod │       │ Post-Action Delta  │       │ Live Semantic DOM │
└─────────────────┘       └────────────────────┘       └─────────┬─────────┘
                                     ▲                           │
                                     │                           ▼
                          ┌──────────┴─────────┐       ┌───────────────────┐
                          │    7. VERIFY       │ <──── │      5. ACT       │
                          │ Semantic Assertion │       │ Framework Events  │
                          └────────────────────┘       └─────────┬─────────┘
                                     ▲                           │
                                     │         6. WAIT           │
                                     └───────────────────────────┘
                                           Triple-Signal Settle
```

### Stage Details:

1. **Observe (Fresh DOM Snapshot)**:
   - Dispatches `GET_SNAPSHOT` to `snapshot.js` immediately before each step.
   - Extracts URL, `document.readyState`, headings, interactive controls, form inputs, modal dialogs, and alert boxes.
   - Redacts all passwords, PINs, OTPs, CVVs, card tokens, and secret parameters.

2. **Understand (Central Brain Context)**:
   - Uses `src/lib/engines/ai-buddy-brain.ts` as the single intelligence engine.
   - Synthesizes user goal, active URL, persona expertise, and in-flight Cross-Step Task Context.

3. **Plan (Adaptive Dependency Graph)**:
   - Maintains completed steps as immutable verified checkpoints.
   - Determines the immediate executable action while keeping future steps declarative.

4. **Resolve Target (Live Semantic Re-Grounding)**:
   - Does not depend on fragile static selectors.
   - Hierarchy: Exact Unique ID $\to$ ARIA Role + Accessible Name $\to$ Visible Text Substring $\to$ Proximity to Labeled Header $\to$ Shadow DOM deep query.

5. **Act (Framework-Compatible Synthetic Event Pipeline)**:
   - **Click**: Dispatches `pointerdown` $\to$ `mousedown` $\to$ `focus` $\to$ `pointerup` $\to$ `mouseup` $\to$ `click`.
   - **Input**: Uses `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set` followed by `beforeinput` $\to$ `input` (bubbles + composed) $\to$ `change` to avoid React/Vue state overwrite bugs.
   - **Scroll**: Centers target via `scrollIntoView({ behavior: 'smooth', block: 'center' })` or auto-detects scrollable nested containers.

6. **Wait (Triple-Signal Settle Detector — Zero Fixed Sleep)**:
   - **Signal A**: Network quiescence (0 active fetch/XHR requests for 350ms).
   - **Signal B**: DOM mutation stability via `MutationObserver` (0 additions/removals for 300ms).
   - **Signal C**: Framework reconciliation finish via `requestAnimationFrame` + `requestIdleCallback`.
   - Safety ceiling: 8,000ms max timeout.

7. **Verify (Semantic Mutation Proof)**:
   - Asserts true outcome: URL changed, field value matches expected text, or table rows updated.
   - Rejects superficial execution if the page state did not mutate.

8. **Re-Observe (Post-Action Delta)**:
   - Captures snapshot $S_{t+1}$.
   - Detects newly opened modals, validation error messages, or auth challenges.

9. **Adapt (In-Flight Task Adjustment)**:
   - Automatically handles transient obstacles (e.g. dismissing promotional popups).
   - Halts before consequential actions (`click_submit`, `pay`, `delete`) and displays the Yellow Approval Card.
   - Passes extracted data (e.g. order IDs) into the Cross-Step Context for subsequent steps.

---

## 3. Execution State & Cross-Step Context Model

To ensure workflows survive page reloads, tab navigation, and Chrome Manifest V3 service-worker termination, state is structured as follows:

```typescript
export interface CrossStepTaskContext {
  taskId: string;
  title: string;
  instruction: string;
  activeTabId: number;
  currentUrl: string;
  status: "planning" | "running" | "paused" | "awaiting_approval" | "completed" | "failed";

  // Data transferred across steps
  stepDataStore: Record<string, unknown>; // e.g. { extractedOrderIds: ["ORD-991", "ORD-992"], totalCount: 2 }

  // Adaptive Steps
  steps: MultiActionStep[];
  currentStepIndex: number;
  totalSteps: number;

  // Reliability & Action Deduplication
  executedActionHashes: string[];
  retryHistory: Record<string, number>;

  // Safety
  pendingApprovalStepId?: string;
  approvalPrompt?: string;

  createdAt: string;
  updatedAt: string;
}
```

_Persistence_: Synced to `chrome.storage.local` under `"ai_buddy_active_task"` on every step transition.

---

## 4. Failure Recovery Matrix

| Condition                 | Immediate Action                             | Automated Recovery                                                   | Max Retries    |
| ------------------------- | -------------------------------------------- | -------------------------------------------------------------------- | -------------- |
| **Element Not Found**     | Halt step; log failure                       | Re-run semantic resolution against fresh snapshot with broader query | 2 retries      |
| **Stale Reference**       | Catch DOM disconnection                      | Re-query live DOM using tag + accessible text                        | 2 retries      |
| **Navigation Timeout**    | Check tab state                              | Poll active URL; if URL changed, trigger Triple-Signal settle        | 1 retry        |
| **Form Validation Error** | Detect `.invalid-feedback` or `aria-invalid` | Read error message, query user profile for corrected format          | 2 retries      |
| **Consequential Action**  | Pre-action classifier halts                  | Present yellow approval card; await explicit user button click       | 0 (Human gate) |
| **Duplicate Action Risk** | Check hash in `executedActionHashes`         | Skip re-execution and resume from next pending step                  | Immediate stop |

---

## 5. Implementation Phases & Proposed Changes

### Phase 1: Dynamic In-Flight Semantic Re-Grounding

- **Files**: `src/shared/browser-action.ts`, `src/lib/engines/action-engine.ts`
- **Scope**: Add `resolveLiveElementTarget()` and enhance `MultiActionStep` with dynamic target descriptors.
- **Verification**: Vitest tests verifying element resolution across shifting DOM class names and dynamic IDs.

### Phase 2: Triple-Signal Settle & Navigation Watchdog

- **Files**: `extension/background.js`, `extension/snapshot.js`
- **Scope**: Implement `waitForPageSettle()` combining network idle, `MutationObserver`, and `requestAnimationFrame`.
- **Verification**: Tests verifying waiting for asynchronous DOM mutations without hardcoded sleep timers.

### Phase 3: Adaptive OAV Execution Loop & Cross-Step Context in Sidepanel

- **Files**: `extension/sidepanel.js`, `src/shared/task-lifecycle.ts`
- **Scope**: Upgrade `runPlanLoop()` to execute the 9-stage cycle, persist state to `chrome.storage.local`, and pass extracted data across steps.
- **Verification**: End-to-end multi-step workflow simulation test (Navigate $\to$ Filter $\to$ Extract $\to$ Complete).

### Phase 4: Full System Verification & Extension Repackaging

- **Files**: `public/ai-buddy-extension.zip` via `scripts/pack.py`
- **Scope**: Run full Vitest suite (184+ tests), verify 0 TypeScript and 0 ESLint errors, and package production extension ZIP.

---

## 6. Measurable Acceptance Criteria

1. **Autonomous Re-Grounding**: Step 2 succeeds after Step 1 changes the active page URL or mutates the table container.
2. **Cross-Step Data Flow**: Order IDs extracted in Step $N$ are accessible to Step $N+1$ via `stepDataStore`.
3. **No Flaky Delays**: Settle times adapt dynamically to page responsiveness via mutation observers.
4. **Safety Enforcement**: Consequential actions halt for explicit user authorization 100% of the time.
5. **Clean Verification**: All existing 22 test suites continue to pass with 0 regressions.
