/**
 * ENGINE 2: PAGE INTELLIGENCE & SEMANTIC DOM ENGINE
 *
 * Responsibilities:
 * - Structured page representation
 * - DOM inspection and accessible text parsing
 * - Evidence tracking & completeness verification
 * - Distinguish current-page data from all-page data
 * - Maintain element references for post-check verification
 * - Semantic element discovery using intent description and contextual clues
 * - Dynamic mutation detection (before vs after action DOM diffing)
 */

import {
  type PageSnapshot,
  type SnapshotElement,
  type ElementRole,
  type PageCompleteness,
  type PaginationInfo,
  type ScrollableContainerInfo,
} from "@/shared/page-snapshot";
import { parseDelimitedText } from "@/shared/document-extractor";

export type PageInspectionCoverage =
  | "visible_only"
  | "current_page_complete"
  | "multi_page_inspected"
  | "all_accessible_verified"
  | "partially_inaccessible";

export interface StructuredPageRepresentation {
  metadata: {
    url: string;
    origin: string;
    title: string;
    capturedAt: string;
  };
  coverage: PageInspectionCoverage;
  sections: Array<{
    title: string;
    level: number;
    selector: string;
    itemCount: number;
  }>;
  scrollContainers: ScrollableContainerInfo[];
  pagination?: PaginationInfo | undefined;
  completeness: PageCompleteness;
  tableCount: number;
  formInputCount: number;
  interactiveControlCount: number;
  statusCounts: Record<string, number>;
  elementIndex: Map<string, SnapshotElement>;
  isTruncated: boolean;
  warnings: string[];
}

export interface SemanticMatchResult {
  element: SnapshotElement;
  confidence: number;
  matchReason: string;
}

export interface DynamicMutationSummary {
  mutated: boolean;
  formsAdded: number;
  controlsAdded: number;
  alertsAdded: number;
  urlChanged: boolean;
  summary: string;
}

/**
 * Analyzes raw page snapshot and constructs a verified structured representation
 */
export function analyzePageIntelligence(snapshot: PageSnapshot): StructuredPageRepresentation {
  const elementIndex = new Map<string, SnapshotElement>();
  const warnings: string[] = [];

  const allElements = [
    ...snapshot.alerts,
    ...snapshot.forms,
    ...snapshot.controls,
    ...snapshot.headings,
  ];

  for (const el of allElements) {
    elementIndex.set(el.ref, el);
    if (el.selector) {
      elementIndex.set(el.selector, el);
    }
  }

  // Determine coverage
  let coverage: PageInspectionCoverage = "current_page_complete";

  if (snapshot.pageCompleteness?.hasMoreBelow) {
    coverage = "visible_only";
    warnings.push(
      "More content exists below the visible viewport fold. Scroll down to inspect remaining rows.",
    );
  }

  if (snapshot.truncated) {
    coverage = "partially_inaccessible";
    warnings.push("Visible text was trimmed due to document length limits.");
  }

  if (snapshot.pagination?.hasNextPage) {
    warnings.push(
      "Additional pages exist. Multi-page navigation may be required for full account totals.",
    );
  }

  // Count tables
  const tableCount = allElements.filter((el) => el.role === "table" || el.tag === "table").length;

  // Build section outline
  const sections = snapshot.headings.map((h) => ({
    title: h.name,
    level: h.level ?? 2,
    selector: h.selector,
    itemCount: allElements.filter((el) => el.rect && h.rect && el.rect.top > h.rect.top).length,
  }));

  const completeness: PageCompleteness = snapshot.pageCompleteness ?? {
    scrollPercent: 100,
    scrollTop: 0,
    scrollHeight: 1000,
    clientHeight: 1000,
    hasMoreBelow: false,
    hasMoreAbove: false,
  };

  return {
    metadata: {
      url: snapshot.url,
      origin: snapshot.origin,
      title: snapshot.title,
      capturedAt: snapshot.capturedAt,
    },
    coverage,
    sections,
    scrollContainers: snapshot.scrollableContainers ?? [],
    pagination: snapshot.pagination,
    completeness,
    tableCount,
    formInputCount: snapshot.forms.length,
    interactiveControlCount: snapshot.controls.length,
    statusCounts: snapshot.statusCounts ?? {},
    elementIndex,
    isTruncated: snapshot.truncated,
    warnings,
  };
}

/**
 * Validates element presence by ref or CSS selector
 */
export function lookupElement(
  page: StructuredPageRepresentation,
  identifier: string,
): SnapshotElement | undefined {
  return page.elementIndex.get(identifier);
}

/**
 * Discovers target elements using semantic context, adjacent labels, role, and text
 */
export function findSemanticTarget(
  page: StructuredPageRepresentation,
  query: string,
): SemanticMatchResult | null {
  const q = query.toLowerCase().trim();
  if (!q) return null;

  const elements = Array.from(page.elementIndex.values());
  let bestMatch: SemanticMatchResult | null = null;

  for (const el of elements) {
    let score = 0;
    const nameLower = (el.name || "").toLowerCase();
    const roleLower = (el.role || "").toLowerCase();
    const placeholderLower = (el.placeholder || "").toLowerCase();
    const selectorLower = (el.selector || "").toLowerCase();

    // Exact matches
    if (nameLower === q) score += 50;
    else if (nameLower.includes(q)) score += 30;

    if (placeholderLower && placeholderLower.includes(q)) score += 25;
    if (selectorLower.includes(q.replace(/\s+/g, "-"))) score += 15;

    // Token overlap
    const tokens = q.split(/\s+/).filter((t) => t.length > 2);
    for (const token of tokens) {
      if (nameLower.includes(token)) score += 10;
      if (placeholderLower.includes(token)) score += 8;
      if (roleLower.includes(token)) score += 5;
    }

    if (score > (bestMatch?.confidence ?? 0)) {
      bestMatch = {
        element: el,
        confidence: score,
        matchReason: `Matched on ${nameLower ? `name "${el.name}"` : `role "${el.role}"`}`,
      };
    }
  }

  return bestMatch && bestMatch.confidence >= 15 ? bestMatch : null;
}

/**
 * Compares before and after structured representations to detect dynamic mutations
 */
export function detectDynamicMutations(
  before: StructuredPageRepresentation,
  after: StructuredPageRepresentation,
): DynamicMutationSummary {
  const formsDiff = Math.max(0, after.formInputCount - before.formInputCount);
  const controlsDiff = Math.max(0, after.interactiveControlCount - before.interactiveControlCount);
  const urlChanged = before.metadata.url !== after.metadata.url;

  const beforeAlerts = Array.from(before.elementIndex.values()).filter(
    (e) => e.role === "alert",
  ).length;
  const afterAlerts = Array.from(after.elementIndex.values()).filter(
    (e) => e.role === "alert",
  ).length;
  const alertsAdded = Math.max(0, afterAlerts - beforeAlerts);

  const mutated = formsDiff > 0 || controlsDiff > 0 || alertsAdded > 0 || urlChanged;

  const summary = mutated
    ? `Page mutated: ${urlChanged ? "URL navigated, " : ""}${formsDiff > 0 ? `${formsDiff} new form inputs, ` : ""}${controlsDiff > 0 ? `${controlsDiff} controls added, ` : ""}${alertsAdded > 0 ? `${alertsAdded} new alerts detected` : ""}`
    : "No major DOM mutation detected.";

  return {
    mutated,
    formsAdded: formsDiff,
    controlsAdded: controlsDiff,
    alertsAdded,
    urlChanged,
    summary,
  };
}

export interface ModalDialogInfo {
  hasModal: boolean;
  modalTitle?: string | undefined;
  dismissSelector?: string | undefined;
  confirmSelector?: string | undefined;
  isBlocking: boolean;
}

export interface ComplexTableExtraction {
  hasTable: boolean;
  headers: string[];
  rows: Array<Record<string, string>>;
  rowCount: number;
  paginationDetected: boolean;
}

export interface InfiniteScrollDetection {
  infiniteScrolled: boolean;
  newItemsCount: number;
  previousItemsCount: number;
}

/**
 * Detects whether an active modal, dialog, or popup overlay is currently displayed and blocking interaction.
 */
export function detectModalDialog(snapshot: PageSnapshot): ModalDialogInfo {
  const allControls = [...snapshot.controls, ...snapshot.alerts];
  const modalControls = allControls.filter(
    (c) =>
      c.selector.includes("modal") ||
      c.selector.includes("dialog") ||
      c.selector.includes("overlay") ||
      c.selector.includes("popup"),
  );

  if (modalControls.length === 0) {
    return { hasModal: false, isBlocking: false };
  }

  const dismissBtn = modalControls.find(
    (c) => c.role === "button" && /close|cancel|dismiss|x|skip/i.test(c.name || c.selector),
  );

  const confirmBtn = modalControls.find(
    (c) =>
      c.role === "button" &&
      /confirm|ok|accept|save|submit|proceed|continue/i.test(c.name || c.selector),
  );

  const modalHeading = snapshot.headings.find(
    (h) =>
      h.selector.includes("modal") || h.selector.includes("dialog") || h.selector.includes("popup"),
  );

  return {
    hasModal: true,
    modalTitle: modalHeading?.name || "Active Dialog",
    dismissSelector: dismissBtn?.selector,
    confirmSelector: confirmBtn?.selector,
    isBlocking: true,
  };
}

/**
 * Extracts structured rows and column headers from tabular representations in the snapshot text and controls.
 */
export function extractComplexTable(snapshot: PageSnapshot): ComplexTableExtraction {
  const rawText = String(snapshot.text || "");
  const textLines = rawText
    .replace(/\r\n/g, "\n")
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  // Look for header indicators or tabular data lines
  const tableLines = textLines.filter(
    (l) =>
      l.includes("\t") ||
      l.includes(" | ") ||
      l.includes(",") ||
      /\b(order|id|sku|price|status|name|date|amount)\b/i.test(l),
  );

  if (tableLines.length < 2) {
    return {
      hasTable: false,
      headers: [],
      rows: [],
      rowCount: 0,
      paginationDetected: !!snapshot.pagination?.hasNextPage,
    };
  }

  const firstLine = tableLines[0]!;
  // Use full RFC-4180 state-machine parsing for TSV (\t) or CSV (,) so quoted commas/newlines stay intact
  if (!firstLine.includes(" | ") && (firstLine.includes("\t") || firstLine.includes(","))) {
    const forcedDelim = firstLine.includes("\t") ? "\t" : ",";
    const parsedCsv = parseDelimitedText(rawText, forcedDelim);
    if (parsedCsv && parsedCsv.rows.length > 0) {
      return {
        hasTable: true,
        headers: parsedCsv.headers,
        rows: parsedCsv.rows,
        rowCount: parsedCsv.rowCount,
        paginationDetected: !!snapshot.pagination?.hasNextPage,
      };
    }
  }

  const delimiter = firstLine.includes(" | ") ? " | " : firstLine.includes("\t") ? "\t" : /\s{2,}/;

  const rawHeaders = firstLine.split(delimiter).map((h) => h.trim().replace(/^\||\|$/g, ""));
  const headers = rawHeaders.filter((h) => h.length > 0);

  const rows: Array<Record<string, string>> = [];
  for (let i = 1; i < tableLines.length; i++) {
    const cells = tableLines[i]!.split(delimiter).map((c) => c.trim().replace(/^\||\|$/g, ""));
    if (cells.length >= Math.min(2, headers.length)) {
      const rowObj: Record<string, string> = {};
      headers.forEach((h, idx) => {
        rowObj[h] = cells[idx] || "";
      });
      rows.push(rowObj);
    }
  }

  return {
    hasTable: rows.length > 0,
    headers,
    rows,
    rowCount: rows.length,
    paginationDetected: !!snapshot.pagination?.hasNextPage,
  };
}

/**
 * Detects if scrolling down loaded new content dynamically without a traditional pagination button.
 */
export function detectDynamicInfiniteScroll(
  beforeSnapshot: PageSnapshot,
  afterSnapshot: PageSnapshot,
): InfiniteScrollDetection {
  const beforeCount = beforeSnapshot.controls.length + beforeSnapshot.forms.length;
  const afterCount = afterSnapshot.controls.length + afterSnapshot.forms.length;
  const newItemsCount = Math.max(0, afterCount - beforeCount);

  const scrolledDown =
    (afterSnapshot.pageCompleteness?.scrollTop ?? 0) >
    (beforeSnapshot.pageCompleteness?.scrollTop ?? 0);

  const infiniteScrolled = scrolledDown && newItemsCount > 0;

  return {
    infiniteScrolled,
    newItemsCount,
    previousItemsCount: beforeCount,
  };
}
