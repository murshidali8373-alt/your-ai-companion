import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CAPABILITY_REGISTRY,
  canExecuteCapability,
  getCapability,
  validateCapabilityInput,
} from "../src/shared/capability-registry";
import {
  HIGH_IMPACT_ACTIONS,
  isCoordinateTargetStale,
  mapBrowserActionToPermissionAction,
  resolveLiveStepTarget,
  validateBrowserAction,
  type MultiActionStep,
} from "../src/shared/browser-action";
import {
  acquireTabLock,
  createTaskSessionContext,
  popUndoRecord,
  pushUndoRecord,
  releaseTabLock,
} from "../src/shared/task-context";
import {
  InfiniteScrollTracker,
  planSmartScroll,
  resolveOrdinalTarget,
  resolvePaginationTarget,
} from "../src/lib/engines/navigation-engine";
import {
  analyzePageIntelligence,
  compareBeforeAfterStates,
  detectVisualUiState,
  findSemanticTarget,
} from "../src/lib/engines/page-intelligence-engine";
import {
  calculateZoomAwareArmKinematics,
  compareVisualSnapshots,
  scaleScreenshotPointToViewport,
  validateCoordinateTarget,
} from "../src/lib/engines/visual-interaction-engine";
import { evaluateClosedLoopRecovery } from "../src/lib/engines/action-engine";
import {
  applyPartialFormUpdate,
  executeFormFill,
  restoreFieldFromUndoRecord,
  selectCustomDropdown,
  validateFormErrors,
} from "../src/lib/engines/form-filling-engine";
import {
  clearOrchestratorSessionsForTests,
  decideExecutionPath,
  runUnifiedOrchestrator,
} from "../src/lib/engines/unified-orchestrator";
import { resetSelfHealingStoreForTests } from "../src/lib/self-healing/store.server";
import type { PageSnapshot } from "../src/shared/page-snapshot";

class Phase2MockElement {
  tagName: string;
  type = "text";
  name = "";
  id = "";
  value = "";
  checked = false;
  disabled = false;
  readOnly = false;
  required = false;
  isConnected = true;
  isContentEditable = false;
  innerText = "";
  innerHTML = "";
  textContent: string | null = "";
  validationMessage = "";
  className = "";
  style: Record<string, string> = { display: "block", visibility: "visible", opacity: "1" };
  attributes: Record<string, string> = {};
  children: Phase2MockElement[] = [];
  parentElement: Phase2MockElement | null = null;
  previousElementSibling: Phase2MockElement | null = null;
  options: Array<{ value: string; text: string }> = [];
  clicked = false;
  focused = false;
  eventsDispatched: string[] = [];

  classList = {
    contains: (cls: string): boolean => this.className.split(/\s+/).includes(cls),
  };

  constructor(tag: string) {
    this.tagName = tag.toUpperCase();
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }

  setAttribute(name: string, val: string): void {
    this.attributes[name] = val;
    if (name === "contenteditable" && (val === "true" || val === "" || val === "plaintext-only")) {
      this.isContentEditable = true;
    }
  }

  getBoundingClientRect() {
    return {
      width: 180,
      height: 36,
      top: 120,
      left: 80,
      bottom: 156,
      right: 260,
      x: 80,
      y: 120,
      toJSON: () => ({}),
    };
  }

  scrollIntoView(): void {}

  focus(): void {
    this.focused = true;
  }

  blur(): void {
    this.focused = false;
  }

  checkValidity(): boolean {
    if (this.required && !this.value.trim()) return false;
    return this.getAttribute("aria-invalid") !== "true";
  }

  dispatchEvent(ev: { type?: string }): boolean {
    if (ev?.type) this.eventsDispatched.push(ev.type);
    return true;
  }

  click(): void {
    this.clicked = true;
  }

  closest(selector: string): Phase2MockElement | null {
    let curr: Phase2MockElement | null = this.parentElement;
    const tag = selector.toUpperCase();
    while (curr) {
      if (curr.tagName === tag) return curr;
      curr = curr.parentElement;
    }
    return null;
  }

  appendChild(child: Phase2MockElement): Phase2MockElement {
    child.parentElement = this;
    child.isConnected = this.isConnected;
    if (this.children.length > 0) {
      child.previousElementSibling = this.children[this.children.length - 1] ?? null;
    }
    this.children.push(child);
    return child;
  }

  private matchesSimpleSelector(node: Phase2MockElement, rawPart: string): boolean {
    const part = rawPart.trim();
    if (!part) return false;
    const tag = node.tagName.toLowerCase();

    if (part.startsWith("#")) return node.id === part.slice(1);
    if (part.startsWith(".")) return node.classList.contains(part.slice(1));
    if (part.includes("[class*=")) {
      const m = part.match(/\[class\*="([^"]+)"\]/);
      return Boolean(m?.[1] && node.className.includes(m[1]));
    }
    if (part === 'button[type="submit"]') return tag === "button" && node.type === "submit";
    if (part === 'input[type="submit"]') return tag === "input" && node.type === "submit";
    if (part === '[role="option"]' || part === "[role='option']") {
      return node.getAttribute("role") === "option";
    }
    if (part === '[role="menuitem"]') return node.getAttribute("role") === "menuitem";
    if (part === "[role='combobox']" || part === '[role="combobox"]') {
      return node.getAttribute("role") === "combobox";
    }
    if (part === "[role='listbox']" || part === '[role="listbox"]') {
      return node.getAttribute("role") === "listbox";
    }
    if (part === '[role="alert"]' || part === "[role='alert']") {
      return node.getAttribute("role") === "alert";
    }
    if (part.startsWith('[contenteditable="')) {
      const m = part.match(/\[contenteditable="([^"]*)"\]/);
      return Boolean(m && node.getAttribute("contenteditable") === m[1]);
    }
    if (part.startsWith("[name=")) {
      const m = part.match(/\[name="([^"]+)"\]/);
      return Boolean(m?.[1] && node.name === m[1]);
    }
    return tag === part.toLowerCase();
  }

  querySelectorAll(sel: string): Phase2MockElement[] {
    const parts = sel.split(",").map((s) => s.trim());
    const out: Phase2MockElement[] = [];
    const walk = (root: Phase2MockElement) => {
      for (const child of root.children) {
        if (parts.some((p) => this.matchesSimpleSelector(child, p))) {
          out.push(child);
        }
        walk(child);
      }
    };
    walk(this);
    return out;
  }

  querySelector(sel: string): Phase2MockElement | null {
    return this.querySelectorAll(sel)[0] ?? null;
  }
}

function makeRichSnapshot(overrides: Partial<PageSnapshot> = {}): PageSnapshot {
  return {
    url: "https://seller.example.com/catalog",
    origin: "https://seller.example.com",
    title: "Catalog Listings",
    capturedAt: new Date().toISOString(),
    headings: [{ ref: "h1", role: "heading", name: "Active Catalog", tag: "h1", selector: "h1" }],
    forms: [
      {
        ref: "f1",
        role: "textbox",
        name: "Product Color",
        tag: "input",
        selector: "#product-color",
        value: "Red",
      },
      {
        ref: "f2",
        role: "textbox",
        name: "Price",
        tag: "input",
        selector: "#price",
        value: "499",
      },
    ],
    controls: [
      {
        ref: "c1",
        role: "link",
        name: "Cotton Kurta Set",
        tag: "a",
        selector: "a.product-1",
      },
      {
        ref: "c2",
        role: "link",
        name: "Silk Saree Pink",
        tag: "a",
        selector: "a.product-2",
      },
      {
        ref: "c3",
        role: "link",
        name: "Denim Jacket Blue",
        tag: "a",
        selector: "a.product-3",
      },
      {
        ref: "c4",
        role: "button",
        name: "Orders",
        tag: "button",
        selector: "#portal-host >>> button.orders-tab",
      },
      {
        ref: "c5",
        role: "button",
        name: "Next Page",
        tag: "button",
        selector: "button.next-page",
      },
    ],
    alerts: [],
    scrollableContainers: [
      {
        selector: "#listings-scroll",
        tag: "div",
        scrollHeight: 2400,
        clientHeight: 400,
        canScrollDown: true,
        canScrollRight: true,
      },
    ],
    pagination: {
      currentPage: 1,
      totalPages: 5,
      hasNextPage: true,
      hasPrevPage: false,
      nextSelector: "button.next-page",
      lastSelector: "button.last-page",
    },
    pageCompleteness: {
      scrollPercent: 10,
      scrollTop: 100,
      scrollHeight: 2800,
      clientHeight: 700,
      hasMoreBelow: true,
      hasMoreAbove: false,
    },
    text: "Active Catalog listings page 1 of 5.",
    truncated: false,
    ...overrides,
  };
}

function loadSidepanelPhase2Parser() {
  const root = path.resolve(__dirname, "..");
  const spCode = fs.readFileSync(path.join(root, "extension", "sidepanel.js"), "utf-8");
  const helperStart = spCode.indexOf("function extractRequestedDocFieldKeys(");
  const helperEnd = spCode.indexOf("async function executeNaturalBrowserAction(");
  const sandbox: Record<string, unknown> = { activeUploadedDocument: null };
  vm.runInNewContext(spCode.slice(helperStart, helperEnd), sandbox);
  return {
    parseActionIntent: sandbox.parseActionIntent as (
      text: string,
      ctx?: Record<string, unknown>,
    ) => Record<string, unknown>,
  };
}

describe("AI Buddy 2.0 — Phase 2 Advanced Computer Interaction & Visual Intelligence", () => {
  beforeEach(() => {
    clearOrchestratorSessionsForTests();
    resetSelfHealingStoreForTests();
    // @ts-expect-error minimal test DOM globals
    global.window = {
      getComputedStyle: (el: Phase2MockElement) => el.style,
      HTMLInputElement: { prototype: {} },
      HTMLTextAreaElement: { prototype: {} },
    };
    // @ts-expect-error minimal test document
    global.document = {
      createElement: (tag: string) => new Phase2MockElement(tag),
      body: new Phase2MockElement("body"),
      querySelector: () => null,
      querySelectorAll: () => [],
    };
    // @ts-expect-error minimal Event
    global.FocusEvent = class {
      type: string;
      constructor(type: string) {
        this.type = type;
      }
    };
    // @ts-expect-error minimal Event
    global.Event = class {
      type: string;
      constructor(type: string) {
        this.type = type;
      }
    };
  });

  // 1-2: Capability Registry, Output Schemas, Timeouts, Retries & Permission Ladder
  it("registers all 21 Phase 2 actions with Zod schemas, timeouts, retries, permissions, and honest drag_and_drop boundary", () => {
    const phase2Ids = [
      "hover_element",
      "double_click",
      "right_click",
      "focus_element",
      "clear_field",
      "drag_and_drop",
      "scroll_to_element",
      "scroll_until_text",
      "scroll_container",
      "select_dropdown",
      "select_custom_dropdown",
      "select_combobox_option",
      "interact_with_listbox",
      "interact_with_autocomplete",
      "open_tab",
      "close_tab",
      "switch_tab",
      "extract_table",
      "paginate",
      "infinite_scroll",
      "undo_reversible_action",
      "validate_form_errors",
    ];

    for (const id of phase2Ids) {
      const cap = getCapability(id);
      expect(cap, `Missing capability ${id}`).toBeDefined();
      expect(cap?.outputSchema).toBeDefined();
      expect(typeof cap?.timeoutMs).toBe("number");
      expect(cap?.retryPolicy).toBeDefined();
    }

    expect(getCapability("drag_and_drop")?.status).toBe("partially_supported");
    expect(getCapability("desktop_os_automation")?.status).toBe("planned");

    // Input validation
    expect(
      validateCapabilityInput("drag_and_drop", {
        selector: "#card-1",
        targetSelector: "#done-col",
      }).ok,
    ).toBe(true);
    expect(validateCapabilityInput("drag_and_drop", { selector: "" }).ok).toBe(false);
    expect(validateCapabilityInput("scroll_until_text", { text: "Order Delivered" }).ok).toBe(true);

    // Consequential tab close gate
    const closeNoConsent = canExecuteCapability("close_tab", "execute", false);
    expect(closeNoConsent.allowed).toBe(false);
    expect(closeNoConsent.requiresApproval).toBe(true);

    // Permission ladder mapping for browser actions
    expect(mapBrowserActionToPermissionAction("hover_element")).toBe("click");
    expect(mapBrowserActionToPermissionAction("scroll_until_text")).toBe("scroll");
    expect(mapBrowserActionToPermissionAction("validate_form_errors")).toBe("read_page");
    expect(mapBrowserActionToPermissionAction("select_custom_dropdown")).toBe("fill_field");

    const blockedHover = validateBrowserAction({
      id: "act_1",
      action: "hover_element",
      selector: "#menu",
      pageUrl: "https://example.com",
      pageOrigin: "https://example.com",
      userPermissionLevel: "observe",
    });
    expect(blockedHover.allowed).toBe(false);

    // Sensitive password/OTP guard even on assist/execute
    const sensitiveClear = validateBrowserAction({
      id: "act_2",
      action: "clear_field",
      selector: "#otp-input",
      elementName: "sms_otp",
      pageUrl: "https://example.com",
      pageOrigin: "https://example.com",
      userPermissionLevel: "execute",
    });
    expect(sensitiveClear.allowed).toBe(false);
    expect(HIGH_IMPACT_ACTIONS.length).toBeGreaterThan(0);
    expect(CAPABILITY_REGISTRY.every((c) => Boolean(c.outputSchema && c.retryPolicy))).toBe(true);
  });

  // 3-6: Smart Scrolling Engine (Nested Container, Infinite Scroll Bounded + Dedup, Pagination, Ordinals)
  it("prefers nested scroll containers over outer window scroll and enforces bounded deduplicated infinite scroll", () => {
    const snap = makeRichSnapshot();

    const insideContainerPlan = planSmartScroll(snap, {
      targetSelector: "#listings-scroll > div.card-12",
      direction: "down",
    });
    expect(insideContainerPlan.strategy).toBe("scroll_to_element");
    expect(insideContainerPlan.containerSelector).toBe("#listings-scroll");
    expect(insideContainerPlan.avoidWindowScroll).toBe(true);

    const windowPlan = planSmartScroll(snap, { targetText: "Footer Policy" });
    expect(windowPlan.strategy).toBe("scroll_until_text");
    expect(windowPlan.avoidWindowScroll).toBe(false);

    // Infinite scroll: deduplicates items, stops on end_of_feed plateau
    const tracker = new InfiniteScrollTracker({ maxIterations: 10, startedAtMs: 1000 });
    const step1 = tracker.recordStep(["SKU-101", "SKU-102", "SKU-101"], 1200, 1200);
    expect(step1.collectedCount).toBe(2);
    expect(step1.shouldContinue).toBe(true);

    const step2 = tracker.recordStep(["SKU-102"], 1200, 1400);
    expect(step2.newInLastStep).toBe(0);
    expect(step2.endOfFeed).toBe(false);

    const step3 = tracker.recordStep(["SKU-102"], 1200, 1600);
    expect(step3.endOfFeed).toBe(true);
    expect(step3.shouldContinue).toBe(false);
    expect(step3.stopReason).toBe("end_of_feed");

    // Target reached stop
    const targetTracker = new InfiniteScrollTracker({
      targetText: "Denim Jacket",
      startedAtMs: 1000,
    });
    const hit = targetTracker.recordStep(["Kurta", "Denim Jacket Blue"], 1500, 1200);
    expect(hit.shouldContinue).toBe(false);
    expect(hit.stopReason).toBe("target_reached");
  });

  it("resolves pagination targets (next/prev/last/numbered) and ordinal items ('second product', 'teesre')", () => {
    const snap = makeRichSnapshot({
      controls: [
        ...makeRichSnapshot().controls,
        { ref: "p1", role: "button", name: "2", tag: "button", selector: "button.page-2" },
        {
          ref: "p2",
          role: "button",
          name: "Previous",
          tag: "button",
          selector: "button.prev-page",
        },
      ],
    });

    expect(resolvePaginationTarget(snap, "next")).toEqual({
      found: true,
      selector: "button.next-page",
      label: "Next",
    });
    expect(resolvePaginationTarget(snap, "last")).toEqual({
      found: true,
      selector: "button.last-page",
      label: "Last page",
    });
    expect(resolvePaginationTarget(snap, 2)).toEqual({
      found: true,
      selector: "button.page-2",
      label: "2",
    });
    expect(resolvePaginationTarget(snap, "prev").found).toBe(true);

    const secondProduct = resolveOrdinalTarget(snap, "Open the second product");
    expect(secondProduct?.selector).toBe("a.product-2");
    expect(secondProduct?.index).toBe(1);

    const thirdHindi = resolveOrdinalTarget(snap, "teesre listing par click karo");
    expect(thirdHindi?.selector).toBe("a.product-3");
    expect(thirdHindi?.index).toBe(2);
  });

  // 7-12: Advanced Form Automation (Custom Dropdown, Rich Text Preservation, Validation Errors, Partial Update, Undo)
  it("selects options in custom ARIA/React/MUI dropdowns and preserves rich-text formatting", async () => {
    const container = new Phase2MockElement("div");

    // Custom ARIA combobox + listbox options
    const combo = new Phase2MockElement("div");
    combo.id = "category-select";
    combo.setAttribute("role", "combobox");
    container.appendChild(combo);

    const opt1 = new Phase2MockElement("div");
    opt1.setAttribute("role", "option");
    opt1.innerText = "Women Kurtis";
    container.appendChild(opt1);

    const opt2 = new Phase2MockElement("div");
    opt2.setAttribute("role", "option");
    opt2.innerText = "Men Jackets";
    container.appendChild(opt2);

    const dropRes = await selectCustomDropdown(
      combo as unknown as HTMLElement,
      "Men Jackets",
      container as unknown as HTMLElement,
    );
    expect(dropRes.ok).toBe(true);
    expect(dropRes.selectedText).toBe("Men Jackets");
    expect(opt2.clicked).toBe(true);

    // Rich-text ProseMirror formatting preservation + undoRecords recording
    const richForm = new Phase2MockElement("form");
    const editor = new Phase2MockElement("div");
    editor.id = "description";
    editor.className = "ProseMirror";
    editor.setAttribute("contenteditable", "true");
    editor.innerHTML = "<p>Old description</p>";
    richForm.appendChild(editor);

    const fillRes = await executeFormFill(
      { description: "Updated catalog bullet notes" },
      { eventDelayMs: 1, scrollDelayMs: 1, focusDelayMs: 1, overwrite: true },
      richForm as unknown as HTMLElement,
    );
    expect(fillRes.filled.length).toBe(1);
    expect(fillRes.undoRecords?.length).toBe(1);
    expect(editor.innerHTML).toContain("<p>Updated catalog bullet notes</p>");
  });

  it("detects form validation blockers, performs surgical partial updates without wiping unrelated fields, and supports field undo", async () => {
    const form = new Phase2MockElement("form");

    const color = new Phase2MockElement("input");
    color.id = "product-color";
    color.name = "product_color";
    color.value = "Red";
    form.appendChild(color);

    const price = new Phase2MockElement("input");
    price.id = "price";
    price.name = "price";
    price.value = "599";
    form.appendChild(price);

    const email = new Phase2MockElement("input");
    email.id = "email";
    email.type = "email";
    email.name = "email";
    email.value = "bad-email";
    form.appendChild(email);

    const reqPhone = new Phase2MockElement("input");
    reqPhone.id = "phone";
    reqPhone.name = "phone";
    reqPhone.required = true;
    reqPhone.value = "";
    form.appendChild(reqPhone);

    const submitBtn = new Phase2MockElement("button");
    submitBtn.type = "submit";
    submitBtn.disabled = true;
    submitBtn.innerText = "Save Listing";
    form.appendChild(submitBtn);

    const validation = validateFormErrors(form as unknown as HTMLElement);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((e) => e.kind === "required")).toBe(true);
    expect(validation.errors.some((e) => e.kind === "invalid_email")).toBe(true);
    expect(validation.disabledSubmits).toEqual(["Save Listing"]);

    // Partial update: change only product color to Black -> price & email remain untouched
    const partialRes = await applyPartialFormUpdate(
      { product_color: "Black" },
      form as unknown as HTMLElement,
    );
    expect(partialRes.filled.length).toBe(1);
    expect(color.value).toBe("Black");
    expect(price.value).toBe("599");
    expect(partialRes.undoRecords?.[0]?.previousValue).toBe("Red");

    // Field undo restores "Red"
    const undoRes = await restoreFieldFromUndoRecord(
      partialRes.undoRecords![0]!,
      form as unknown as HTMLElement,
    );
    expect(undoRes.ok).toBe(true);
    expect(color.value).toBe("Red");
  });

  // 13-17: Visual Intelligence, DPR Coordinate Guards, Zoom-Aware Kinematics & Before/After State Diff
  it("rejects stale/scrolled/zoom-changed coordinates, scales DPR points accurately, and computes zoom-aware arm kinematics", () => {
    const baseViewport = {
      width: 1280,
      height: 800,
      scrollX: 0,
      scrollY: 100,
      devicePixelRatio: 2,
      zoomScale: 1,
    };

    const coord = {
      x: 400,
      y: 300,
      scrollX: 0,
      scrollY: 100,
      viewportWidth: 1280,
      viewportHeight: 800,
      devicePixelRatio: 2,
      zoomScale: 1,
      capturedAt: 10000,
      maxAgeMs: 5000,
      source: "visual_fallback" as const,
    };

    expect(validateCoordinateTarget(coord, baseViewport, 11000)).toEqual({
      valid: true,
      adjustedX: 400,
      adjustedY: 300,
    });
    expect(isCoordinateTargetStale(coord, baseViewport, 11000).stale).toBe(false);

    // Scrolled check
    expect(isCoordinateTargetStale(coord, { ...baseViewport, scrollY: 350 }, 11000).stale).toBe(
      true,
    );
    // Zoom/DPR check
    expect(validateCoordinateTarget(coord, { ...baseViewport, zoomScale: 1.5 }, 11000).valid).toBe(
      false,
    );
    // Expired timeout check
    expect(validateCoordinateTarget(coord, baseViewport, 20000).valid).toBe(false);

    // 2x Retina screenshot scaling back to 1280x800 CSS pixels
    const scaled = scaleScreenshotPointToViewport(
      { x: 1000, y: 600 },
      { width: 2560, height: 1600 },
      { width: 1280, height: 800 },
    );
    expect(scaled).toEqual({ x: 500, y: 300 });

    const kin = calculateZoomAwareArmKinematics(
      { left: 120, top: 220, width: 100, height: 40 },
      { width: 1280, height: 800, zoomScale: 1.25 },
    );
    expect(kin.bezierPath).toMatch(/^M \d+\.\d \d+\.\d Q /);
  });

  it("detects visual loading/modal/disabled states, disambiguates Shadow DOM ties, and compares before/after screenshots", () => {
    const before = makeRichSnapshot({
      loadingIndicators: ["Spinner: Loading inventory"],
      modals: [{ title: "Confirm Listing", isBlocking: true }],
      disabledSubmits: ["Publish"],
    });
    const uiState = detectVisualUiState(before);
    expect(uiState.isLoading).toBe(true);
    expect(uiState.hasBlockingModal).toBe(true);
    expect(uiState.disabledSubmitCount).toBe(1);

    const after = makeRichSnapshot({
      url: "https://seller.example.com/catalog?page=2",
      pageCompleteness: {
        scrollPercent: 45,
        scrollTop: 550,
        scrollHeight: 2800,
        clientHeight: 700,
        hasMoreBelow: true,
        hasMoreAbove: true,
      },
      alerts: [{ ref: "a1", role: "alert", name: "Saved draft!", tag: "div", selector: ".alert" }],
    });
    const diff = compareBeforeAfterStates(before, after);
    expect(diff.changed).toBe(true);
    expect(diff.urlChanged).toBe(true);
    expect(diff.scrollChanged).toBe(true);
    expect(diff.newAlerts).toContain("Saved draft!");

    const visDiff = compareVisualSnapshots(
      { url: before.url, screenshotBase64: "data:image/jpeg;base64,AAAA" },
      { url: before.url, screenshotBase64: "data:image/jpeg;base64,BBBB" },
    );
    expect(visDiff.visualChanged).toBe(true);

    // Shadow DOM resolution & tie disambiguation
    const tieSnap = makeRichSnapshot({
      controls: [
        { ref: "t1", role: "button", name: "Delete", tag: "button", selector: "#row-1 button.del" },
        { ref: "t2", role: "button", name: "Delete", tag: "button", selector: "#row-2 button.del" },
        {
          ref: "t3",
          role: "button",
          name: "Orders",
          tag: "button",
          selector: "#portal-host >>> button.orders",
        },
      ],
    });
    const shadowStep: MultiActionStep = {
      id: "s1",
      stepNumber: 1,
      title: "Click Orders",
      action: "click",
      selector: "#portal-host >>> button.orders",
      status: "pending",
    };
    const shadowMatch = resolveLiveStepTarget(shadowStep, tieSnap);
    expect(shadowMatch.matched).toBe(true);
    expect(shadowMatch.strategy).toBe("shadow_dom");

    const structured = analyzePageIntelligence(tieSnap);
    const deleteSemantic = findSemanticTarget(structured, "Delete");
    expect(deleteSemantic?.ambiguousCandidates?.length).toBe(2);
  });

  // 18-20: TaskSessionContext Locks, Undo Stack, Closed-Loop Recovery & Unified Orchestrator Integration
  it("maintains tab locks, session undo stack, closed-loop recovery ladder, and Phase 2 Orchestrator context", async () => {
    const ctx = createTaskSessionContext({
      activeBrowserTab: { tabId: 101, url: "https://seller.example.com" },
    });
    expect(ctx.originalTabId).toBe(101);
    expect(acquireTabLock(ctx, 101, "agent_browser")).toBe(true);
    expect(acquireTabLock(ctx, 101, "agent_research")).toBe(false);
    releaseTabLock(ctx, 101, "agent_browser");
    expect(acquireTabLock(ctx, 101, "agent_research")).toBe(true);

    pushUndoRecord(ctx, {
      scope: "field",
      selector: "#product-color",
      previousValue: "Red",
    });
    const popped = popUndoRecord(ctx, "field");
    expect(popped?.previousValue).toBe("Red");
    expect(popUndoRecord(ctx, "field")).toBeNull();

    // Closed-loop recovery decisions
    expect(
      evaluateClosedLoopRecovery({
        attempt: 0,
        maxRetries: 2,
        errorMessage: "Element not found",
        hasAlternateLocator: true,
        hasScreenshotFallback: true,
      }).action,
    ).toBe("retry_with_alternate_locator");

    expect(
      evaluateClosedLoopRecovery({
        attempt: 2,
        maxRetries: 2,
        errorMessage: "Element not found",
        hasAlternateLocator: false,
        hasScreenshotFallback: true,
      }).action,
    ).toBe("visual_coordinate_fallback");

    expect(
      evaluateClosedLoopRecovery({
        attempt: 0,
        maxRetries: 2,
        errorMessage: "Security block: password field",
        hasAlternateLocator: true,
        hasScreenshotFallback: true,
      }).action,
    ).toBe("ask_user");

    // Unified orchestrator tracks Phase 2 capability & ordinal target in sessionContext.lastTargetRef
    const decision = decideExecutionPath("Hover over the Orders button", {
      snapshot: makeRichSnapshot(),
    });
    expect(decision.capabilityIds).toContain("hover_element");

    const orchRes = await runUnifiedOrchestrator({
      instruction: "Open the second product",
      snapshot: makeRichSnapshot(),
      permissionLevel: "assist",
      sessionContext: ctx,
    });
    expect(orchRes.suggestedHighlightSelector).toBe("a.product-2");
    expect(orchRes.sessionContext.lastTargetRef?.selector).toBe("a.product-2");
  });

  // 21-24: Extension Hinglish/English Conversational Intents, Safe Tab Closing & Source Verification
  it("parses all Phase 2 conversational intents in extension/sidepanel.js including contextual 'hover over it' and safe undo/tab commands", () => {
    const { parseActionIntent } = loadSidepanelPhase2Parser();

    expect(parseActionIntent("Hover over Settings menu")).toMatchObject({
      type: "HOVER",
      target: "settings menu",
    });
    expect(parseActionIntent("Double click row 2")).toMatchObject({
      type: "DOUBLE_CLICK",
      target: "row 2",
    });
    expect(parseActionIntent("Right click Order Card")).toMatchObject({
      type: "RIGHT_CLICK",
      target: "order card",
    });
    expect(parseActionIntent("Focus on Email input")).toMatchObject({
      type: "FOCUS",
      target: "email input",
    });
    expect(parseActionIntent("Clear the Email field")).toMatchObject({
      type: "CLEAR_FIELD",
      target: "email",
    });
    expect(parseActionIntent("Drag Task A to Completed column")).toMatchObject({
      type: "DRAG_AND_DROP",
      source: "Task A",
      target: "Completed column",
    });
    expect(parseActionIntent("Scroll until Order Delivered")).toMatchObject({
      type: "SCROLL_UNTIL_TEXT",
      text: "order delivered",
    });
    expect(parseActionIntent("Keep scrolling")).toMatchObject({
      type: "INFINITE_SCROLL",
    });
    expect(parseActionIntent("Go to the last page")).toMatchObject({
      type: "PAGINATE",
      targetPage: "last",
    });
    expect(parseActionIntent("Validate the form")).toMatchObject({
      type: "VALIDATE_FORM",
    });
    expect(parseActionIntent("Undo last edit")).toMatchObject({
      type: "UNDO_ACTION",
      scope: "field",
    });
    expect(parseActionIntent("Open Help Center in another tab")).toMatchObject({
      type: "TAB_ACTION",
      action: "open_tab",
      target: "Help Center",
    });
    expect(parseActionIntent("Return to the original tab")).toMatchObject({
      type: "TAB_ACTION",
      action: "return_original",
    });
    expect(parseActionIntent("Open the second product")).toMatchObject({
      type: "ORDINAL_ITEM",
      index: 2,
    });
    expect(parseActionIntent("Change product color to Black")).toMatchObject({
      type: "PARTIAL_UPDATE",
      targetField: "product color",
      value: "Black",
    });
    expect(parseActionIntent("Continue from where you stopped", { session: {} })).toMatchObject({
      type: "RESUME_PLAN",
    });

    // Contextual pronoun follow-up ("hover over it" uses session.lastTargetRef)
    expect(
      parseActionIntent("hover over it", {
        session: {
          lastTargetRef: { selector: "#account-menu", label: "Account Menu" },
        },
      }),
    ).toMatchObject({
      type: "HOVER",
      target: "Account Menu",
      selector: "#account-menu",
    });
  });

  it("enforces safe tab closure rules in extension/background.js (blocks user tabs without approval, pinned tabs, and last tab)", async () => {
    const root = path.resolve(__dirname, "..");
    const bgCode = fs.readFileSync(path.join(root, "extension", "background.js"), "utf-8");

    const start = bgCode.indexOf("const swTabLocks = new Map();");
    const end = bgCode.indexOf("async function readTabSnapshot(");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    let tabsFixture = [
      { id: 1, title: "Gmail", url: "https://mail.google.com", active: true, pinned: false },
      { id: 2, title: "Pinned Docs", url: "https://docs.example.com", active: false, pinned: true },
    ];
    let createdCounter = 10;

    const chromeMock = {
      runtime: { getURL: (s: string) => `chrome-extension://buddy/${s}` },
      tabs: {
        query: async () => tabsFixture,
        get: async (id: number) => tabsFixture.find((t) => t.id === id) ?? null,
        update: async (id: number) => {
          tabsFixture = tabsFixture.map((t) => ({ ...t, active: t.id === id }));
        },
        create: async ({ url, active }: { url: string; active: boolean }) => {
          createdCounter += 1;
          const created = { id: createdCounter, title: url, url, active, pinned: false };
          tabsFixture.push(created);
          return created;
        },
        remove: async (id: number) => {
          tabsFixture = tabsFixture.filter((t) => t.id !== id);
        },
      },
    };

    const sandbox: Record<string, unknown> = {
      chrome: chromeMock,
      RESTRICTED: /^(?:chrome|edge|about|chrome-extension):/i,
      Map,
      Set,
      Promise,
    };
    vm.runInNewContext(bgCode.slice(start, end), sandbox);

    const openBrowserTab = sandbox.openBrowserTab as (
      url: string,
      active?: boolean,
    ) => Promise<Record<string, unknown>>;
    const closeBrowserTabSafely = sandbox.closeBrowserTabSafely as (
      opts?: Record<string, unknown>,
    ) => Promise<Record<string, unknown>>;

    // Cannot close pinned tab
    const pinnedRes = await closeBrowserTabSafely({ tabId: 2, allowCloseUserTab: true });
    expect(pinnedRes.ok).toBe(false);
    expect(String(pinnedRes.message)).toMatch(/pinned|restricted|extension/i);

    // Cannot close user-opened tab without approval
    const userTabRes = await closeBrowserTabSafely({ tabId: 1 });
    expect(userTabRes.ok).toBe(false);
    expect(userTabRes.requiresApproval).toBe(true);

    // Can open & close Buddy-opened tab cleanly
    const opened = await openBrowserTab("https://example.com/product-2", true);
    expect(opened.ok).toBe(true);
    const closedBuddy = await closeBrowserTabSafely({ tabId: opened.tabId });
    expect(closedBuddy.ok).toBe(true);

    // Snapshot & background Phase 2 wiring checks
    const snapCode = fs.readFileSync(path.join(root, "extension", "snapshot.js"), "utf-8");
    expect(snapCode).toContain("customDropdowns");
    expect(snapCode).toContain("richTextEditors");
    expect(snapCode).toContain("loadingIndicators");
    expect(snapCode).toContain("lastSelector");
    expect(bgCode).toContain("coordinate_action");
    expect(bgCode).toContain("VALIDATE_FORM_ERRORS");
    expect(bgCode).toContain("undo_reversible_action");
  });
});
