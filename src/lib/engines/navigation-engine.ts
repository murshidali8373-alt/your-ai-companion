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
