/**
 * ENGINE 1: NAVIGATION ENGINE
 *
 * Responsibilities:
 * - Scroll the main webpage (up, down, top, bottom, by percentage, by selector)
 * - Identify and scroll nested containers (tables, modal dialogs, overflow divs)
 * - In-page search for text, headings, labels, and elements
 * - Pagination discovery and next/previous page navigation
 * - Infinite scroll detection and position preservation
 */

import {
  type PageSnapshot,
  type ScrollableContainerInfo,
  type PaginationInfo,
} from "@/shared/page-snapshot";

export interface NavigationScrollOptions {
  direction?: "down" | "up" | "top" | "bottom";
  amount?: number;
  containerSelector?: string;
  smooth?: boolean;
}

export interface NavigationSearchResult {
  query: string;
  matched: boolean;
  count: number;
  bestMatchSelector?: string;
  matchContext?: string;
  containerSelector?: string;
  requiresScroll: boolean;
}

export interface PaginationAction {
  canGoNext: boolean;
  canGoPrev: boolean;
  nextSelector?: string;
  prevSelector?: string;
  currentPage?: number | string;
  totalPages?: number | string;
}

/**
 * Identifies nested scrollable regions in a page snapshot or DOM
 */
export function identifyScrollContainers(snapshot: PageSnapshot): ScrollableContainerInfo[] {
  return snapshot.scrollableContainers ?? [];
}

/**
 * Searches page snapshot for text or element, returning location details
 */
export function searchContent(snapshot: PageSnapshot, query: string): NavigationSearchResult {
  const q = query.trim().toLowerCase();
  if (!q) {
    return { query, matched: false, count: 0, requiresScroll: false };
  }

  // Check controls and headings
  const allElements = [
    ...snapshot.headings,
    ...snapshot.forms,
    ...snapshot.controls,
    ...snapshot.alerts,
  ];

  const matchedElements = allElements.filter(
    (el) =>
      el.name.toLowerCase().includes(q) ||
      (el.placeholder && el.placeholder.toLowerCase().includes(q)) ||
      (el.value && el.value.toLowerCase().includes(q)),
  );

  if (matchedElements.length > 0) {
    const best = matchedElements[0]!;
    const isOffscreen = best.rect ? best.rect.top < 0 || best.rect.top > 800 : true;

    return {
      query,
      matched: true,
      count: matchedElements.length,
      bestMatchSelector: best.selector,
      matchContext: `${best.role} "${best.name}"`,
      requiresScroll: isOffscreen,
    };
  }

  // Check visible text
  const textIndex = snapshot.text.toLowerCase().indexOf(q);
  if (textIndex !== -1) {
    const start = Math.max(0, textIndex - 30);
    const end = Math.min(snapshot.text.length, textIndex + q.length + 30);
    const snippet = snapshot.text.slice(start, end);

    return {
      query,
      matched: true,
      count: 1,
      matchContext: `...${snippet.trim()}...`,
      requiresScroll: true,
    };
  }

  return {
    query,
    matched: false,
    count: 0,
    requiresScroll: false,
  };
}

/**
 * Evaluates pagination metadata and identifies navigation selectors
 */
export function evaluatePagination(snapshot: PageSnapshot): PaginationAction {
  const pag = snapshot.pagination;
  const nextControl = snapshot.controls.find(
    (c) =>
      c.name.toLowerCase().includes("next") ||
      c.selector.includes(".next") ||
      c.selector.includes('[rel="next"]'),
  );

  const prevControl = snapshot.controls.find(
    (c) =>
      c.name.toLowerCase().includes("prev") ||
      c.selector.includes(".prev") ||
      c.selector.includes('[rel="prev"]'),
  );

  return {
    canGoNext: Boolean(pag?.hasNextPage || nextControl),
    canGoPrev: Boolean(pag?.hasPrevPage || prevControl),
    nextSelector: nextControl?.selector,
    prevSelector: prevControl?.selector,
    currentPage: pag?.currentPage,
    totalPages: pag?.totalPages,
  };
}

/**
 * Determines whether a page appears to use infinite scrolling
 */
export function detectInfiniteScroll(snapshot: PageSnapshot): boolean {
  if (snapshot.pageCompleteness) {
    const pc = snapshot.pageCompleteness;
    const isVeryTall = pc.scrollHeight > pc.clientHeight * 3;
    const hasMore = pc.hasMoreBelow;
    const lacksPagination = !snapshot.pagination?.hasNextPage;
    return isVeryTall && hasMore && lacksPagination;
  }
  return false;
}

export interface SmartScrollPlan {
  strategy: "scroll_to_element" | "scroll_until_text" | "scroll_container" | "scroll_window";
  containerSelector: string | null;
  direction: "up" | "down" | "left" | "right" | "top" | "bottom";
  amountPx: number;
  targetSelector?: string;
  targetText?: string;
  maxIterations: number;
  avoidWindowScroll: boolean;
}

/**
 * Plans smart scroll strategy: prefers nested scroll container when target lives inside
 * or containerSelector is specified so we don't scroll the outer document needlessly.
 */
export function planSmartScroll(
  snapshot: PageSnapshot | null,
  opts: {
    targetSelector?: string;
    targetText?: string;
    containerSelector?: string;
    direction?: "up" | "down" | "left" | "right" | "top" | "bottom";
    amountPx?: number;
    maxIterations?: number;
  },
): SmartScrollPlan {
  const direction = opts.direction ?? "down";
  const amountPx =
    opts.amountPx ?? Math.round((snapshot?.pageCompleteness?.clientHeight ?? 700) * 0.8);
  const maxIterations = Math.min(25, Math.max(1, opts.maxIterations ?? 8));

  const containers = snapshot?.scrollableContainers ?? [];
  let chosenContainer = opts.containerSelector || null;

  if (!chosenContainer && opts.targetSelector && containers.length > 0) {
    const insideContainer = containers.find((c) => opts.targetSelector!.startsWith(c.selector));
    if (insideContainer) chosenContainer = insideContainer.selector;
  }

  if (opts.targetSelector) {
    return {
      strategy: "scroll_to_element",
      containerSelector: chosenContainer,
      direction,
      amountPx,
      targetSelector: opts.targetSelector,
      maxIterations,
      avoidWindowScroll: Boolean(chosenContainer),
    };
  }

  if (opts.targetText) {
    return {
      strategy: "scroll_until_text",
      containerSelector: chosenContainer,
      direction,
      amountPx,
      targetText: opts.targetText,
      maxIterations,
      avoidWindowScroll: Boolean(chosenContainer),
    };
  }

  if (chosenContainer) {
    return {
      strategy: "scroll_container",
      containerSelector: chosenContainer,
      direction,
      amountPx,
      maxIterations,
      avoidWindowScroll: true,
    };
  }

  return {
    strategy: "scroll_window",
    containerSelector: null,
    direction,
    amountPx,
    maxIterations,
    avoidWindowScroll: false,
  };
}

export interface InfiniteScrollProgress {
  iterations: number;
  collectedCount: number;
  newInLastStep: number;
  endOfFeed: boolean;
  shouldContinue: boolean;
  stopReason?: "max_iterations" | "max_time" | "target_reached" | "end_of_feed" | "requested_count";
}

/**
 * Bounded infinite scroll tracker that deduplicates items across scroll steps,
 * detects end-of-feed plateaus, and enforces iteration/time/item caps.
 */
export class InfiniteScrollTracker {
  private readonly seenKeys = new Set<string>();
  private readonly items: Array<Record<string, unknown> | string> = [];
  private iterations = 0;
  private stalledIterations = 0;
  private lastScrollHeight = 0;
  private readonly startedAtMs: number;
  private readonly maxIterations: number;
  private readonly maxDurationMs: number;
  private readonly maxItems?: number;
  private readonly targetTextLower?: string;

  constructor(opts?: {
    maxIterations?: number;
    maxDurationMs?: number;
    maxItems?: number;
    targetText?: string;
    startedAtMs?: number;
  }) {
    this.maxIterations = Math.min(25, Math.max(1, opts?.maxIterations ?? 8));
    this.maxDurationMs = opts?.maxDurationMs ?? 15000;
    this.maxItems = opts?.maxItems;
    this.targetTextLower = opts?.targetText?.trim().toLowerCase();
    this.startedAtMs = opts?.startedAtMs ?? Date.now();
  }

  recordStep(
    stepItems: Array<Record<string, unknown> | string>,
    scrollHeight: number,
    nowMs = Date.now(),
  ): InfiniteScrollProgress {
    this.iterations += 1;
    let added = 0;
    let targetHit = false;

    for (const item of stepItems) {
      const key =
        typeof item === "string" ? item.trim().toLowerCase() : JSON.stringify(item).toLowerCase();
      if (!key) continue;
      if (!this.seenKeys.has(key)) {
        this.seenKeys.add(key);
        this.items.push(item);
        added += 1;
      }
      if (this.targetTextLower && key.includes(this.targetTextLower)) {
        targetHit = true;
      }
    }

    const heightGrew = scrollHeight > this.lastScrollHeight + 8;
    this.lastScrollHeight = Math.max(this.lastScrollHeight, scrollHeight);

    if (added === 0 && !heightGrew) {
      this.stalledIterations += 1;
    } else {
      this.stalledIterations = 0;
    }

    const endOfFeed = this.stalledIterations >= 2;
    const elapsedMs = nowMs - this.startedAtMs;

    if (targetHit) {
      return {
        iterations: this.iterations,
        collectedCount: this.items.length,
        newInLastStep: added,
        endOfFeed,
        shouldContinue: false,
        stopReason: "target_reached",
      };
    }
    if (this.maxItems && this.items.length >= this.maxItems) {
      return {
        iterations: this.iterations,
        collectedCount: this.items.length,
        newInLastStep: added,
        endOfFeed,
        shouldContinue: false,
        stopReason: "requested_count",
      };
    }
    if (endOfFeed) {
      return {
        iterations: this.iterations,
        collectedCount: this.items.length,
        newInLastStep: added,
        endOfFeed: true,
        shouldContinue: false,
        stopReason: "end_of_feed",
      };
    }
    if (elapsedMs >= this.maxDurationMs) {
      return {
        iterations: this.iterations,
        collectedCount: this.items.length,
        newInLastStep: added,
        endOfFeed,
        shouldContinue: false,
        stopReason: "max_time",
      };
    }
    if (this.iterations >= this.maxIterations) {
      return {
        iterations: this.iterations,
        collectedCount: this.items.length,
        newInLastStep: added,
        endOfFeed,
        shouldContinue: false,
        stopReason: "max_iterations",
      };
    }

    return {
      iterations: this.iterations,
      collectedCount: this.items.length,
      newInLastStep: added,
      endOfFeed: false,
      shouldContinue: true,
    };
  }

  getCollectedItems(): Array<Record<string, unknown> | string> {
    return [...this.items];
  }
}

/**
 * Resolves pagination control selectors for next, prev, last, or specific page numbers.
 */
export function resolvePaginationTarget(
  snapshot: PageSnapshot,
  targetPage: "next" | "prev" | "last" | number,
): { found: boolean; selector?: string; label?: string } {
  const pag = snapshot.pagination;
  if (targetPage === "next") {
    const evalRes = evaluatePagination(snapshot);
    const sel = pag?.nextSelector || evalRes.nextSelector;
    return sel ? { found: true, selector: sel, label: "Next" } : { found: false };
  }
  if (targetPage === "prev") {
    const evalRes = evaluatePagination(snapshot);
    const sel = pag?.prevSelector || evalRes.prevSelector;
    return sel ? { found: true, selector: sel, label: "Previous" } : { found: false };
  }
  if (targetPage === "last") {
    if (pag?.lastSelector) {
      return { found: true, selector: pag.lastSelector, label: "Last page" };
    }
    const lastBtn = snapshot.controls.find((c) =>
      /\b(last|end|final)\b/i.test(c.name || c.ariaLabel || ""),
    );
    if (lastBtn) return { found: true, selector: lastBtn.selector, label: lastBtn.name };
    // Try highest numbered pagination button
    const numbered = snapshot.controls
      .filter((c) => /^\d+$/.test((c.name || "").trim()))
      .sort((a, b) => Number(b.name.trim()) - Number(a.name.trim()));
    if (numbered[0]) {
      return { found: true, selector: numbered[0].selector, label: numbered[0].name };
    }
    return { found: false };
  }

  const pageStr = String(targetPage);
  const pageBtn = snapshot.controls.find(
    (c) =>
      (c.name || "").trim() === pageStr || (c.ariaLabel || "").toLowerCase() === `page ${pageStr}`,
  );
  return pageBtn
    ? { found: true, selector: pageBtn.selector, label: pageBtn.name }
    : { found: false };
}

/**
 * Resolves ordinal item references ("third listing", "second product", "pehla", "doosra", "teesra").
 */
export function resolveOrdinalTarget(
  snapshot: PageSnapshot,
  instruction: string,
): { selector: string; name: string; index: number } | null {
  const lower = instruction.toLowerCase();
  const ordinalMap: Array<[RegExp, number]> = [
    [/\b(1st|first|pehl[aei]|pahl[aei])\b/i, 0],
    [/\b(2nd|second|doosr[aei]|dusr[aei])\b/i, 1],
    [/\b(3rd|third|teesr[aei]|tisr[aei])\b/i, 2],
    [/\b(4th|fourth|chauth[aei])\b/i, 3],
    [/\b(5th|fifth|panchw[aei]|paanchw[aei])\b/i, 4],
    [/\b(last|aakhri|akhri)\b/i, -1],
  ];

  let idx: number | null = null;
  for (const [pat, val] of ordinalMap) {
    if (pat.test(lower)) {
      idx = val;
      break;
    }
  }
  if (idx === null) return null;

  const isField = /\b(field|input|box|textbox)\b/i.test(lower);
  const pool = isField
    ? snapshot.forms
    : snapshot.controls.filter((c) => c.role === "link" || c.role === "button");

  if (!pool || pool.length === 0) return null;
  const targetIdx = idx === -1 ? pool.length - 1 : idx;
  const chosen = pool[targetIdx];
  if (!chosen) return null;
  return {
    selector: chosen.selector,
    name: chosen.name || chosen.placeholder || chosen.role,
    index: targetIdx,
  };
}
