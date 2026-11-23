/**
 * CONTEXT WINDOW MANAGER & STALE SNAPSHOT GUARD (Phase 6)
 *
 * - Enforces token budgets across instruction, memories, webpage snapshot,
 *   uploaded document summaries, and conversation history.
 * - Detects stale DOM snapshots (age threshold or active URL drift).
 * - Surfaces untrusted-content injection signals prior to model dispatch.
 */

import { estimateTokens, type PageSnapshot } from "@/shared/page-snapshot";

export interface ContextBudgetInput {
  instruction: string;
  memoriesText?: string;
  snapshotText?: string;
  documentSummaryText?: string;
  history?: Array<{ role: string; content: string }>;
  maxBudgetTokens?: number;
}

export interface BudgetedContextResult {
  contextText: string;
  estimatedTokens: number;
  maxBudgetTokens: number;
  truncatedSections: string[];
  includedHistoryCount: number;
  trimmedHistoryCount: number;
  untrustedSignals: string[];
}

const CONTEXT_INJECTION_PATTERNS: Array<{ id: string; re: RegExp }> = [
  {
    id: "override_system_prompt",
    re: /\b(?:ignore|disregard|forget|bypass)\s+(?:all\s+)?(?:previous|prior|system|above|security)\s+(?:instructions?|rules?|prompts?|policies?)\b/i,
  },
  {
    id: "exfiltrate_secrets",
    re: /\b(?:send|export|post|leak|reveal|print|dump|upload)\s+(?:all\s+)?(?:api\s*keys?|tokens?|passwords?|secrets?|cookies?|session|otp|credentials?)\b/i,
  },
  {
    id: "role_hijack",
    re: /(?:^|\n)\s*(?:SYSTEM|DEVELOPER|ASSISTANT)\s*:\s*(?:override|you are now|must execute)/i,
  },
];

export function inspectUntrustedContextSignals(text: string): string[] {
  const found: string[] = [];
  for (const pat of CONTEXT_INJECTION_PATTERNS) {
    if (pat.re.test(text)) found.push(pat.id);
  }
  return found;
}

function truncateToTokenBudget(text: string, maxTokens: number): { text: string; truncated: boolean } {
  if (!text) return { text: "", truncated: false };
  const currentTokens = estimateTokens(text);
  if (currentTokens <= maxTokens) return { text, truncated: false };
  const maxChars = Math.max(80, maxTokens * 4);
  return {
    text: `${text.slice(0, maxChars).trimEnd()}\n[...trimmed to fit context budget]`,
    truncated: true,
  };
}

export function buildBudgetedTaskContext(input: ContextBudgetInput): BudgetedContextResult {
  const maxBudgetTokens = Math.max(400, input.maxBudgetTokens ?? 6000);
  const truncatedSections: string[] = [];
  const untrustedSignals = new Set<string>();

  for (const sig of inspectUntrustedContextSignals(input.snapshotText || "")) {
    untrustedSignals.add(sig);
  }
  for (const sig of inspectUntrustedContextSignals(input.documentSummaryText || "")) {
    untrustedSignals.add(sig);
  }

  // Reserve 20% minimum for user instruction + task framing
  const instrTrimmed = truncateToTokenBudget(input.instruction, Math.floor(maxBudgetTokens * 0.25));
  if (instrTrimmed.truncated) truncatedSections.push("instruction");
  let remaining = maxBudgetTokens - estimateTokens(instrTrimmed.text);

  const blocks: string[] = [];

  // 1. Memories (up to 15% of budget)
  if (input.memoriesText && remaining > 60) {
    const memCap = Math.min(remaining, Math.max(80, Math.floor(maxBudgetTokens * 0.15)));
    const memFit = truncateToTokenBudget(input.memoriesText, memCap);
    if (memFit.truncated) truncatedSections.push("memories");
    if (memFit.text) {
      blocks.push(memFit.text);
      remaining -= estimateTokens(memFit.text);
    }
  }

  // 2. Active webpage snapshot (up to 40% of remaining)
  if (input.snapshotText && remaining > 80) {
    const snapCap = Math.min(remaining, Math.max(100, Math.floor(maxBudgetTokens * 0.4)));
    const snapFit = truncateToTokenBudget(input.snapshotText, snapCap);
    if (snapFit.truncated) truncatedSections.push("snapshot");
    if (snapFit.text) {
      blocks.push(snapFit.text);
      remaining -= estimateTokens(snapFit.text);
    }
  }

  // 3. Document summary (up to 20% of budget)
  if (input.documentSummaryText && remaining > 60) {
    const docCap = Math.min(remaining, Math.max(80, Math.floor(maxBudgetTokens * 0.2)));
    const docFit = truncateToTokenBudget(input.documentSummaryText, docCap);
    if (docFit.truncated) truncatedSections.push("document");
    if (docFit.text) {
      blocks.push(docFit.text);
      remaining -= estimateTokens(docFit.text);
    }
  }

  // 4. Recent history (newest turns kept first; oldest trimmed if over remaining budget)
  const history = input.history ?? [];
  const keptTurns: string[] = [];
  for (let i = history.length - 1; i >= 0; i--) {
    const turn = history[i]!;
    const line = `${turn.role === "user" ? "USER" : "ASSISTANT"}: ${turn.content}`;
    const lineTokens = estimateTokens(line);
    if (remaining - lineTokens < 20) break;
    keptTurns.unshift(line);
    remaining -= lineTokens;
  }
  const trimmedHistoryCount = Math.max(0, history.length - keptTurns.length);
  if (trimmedHistoryCount > 0) truncatedSections.push("history");
  if (keptTurns.length > 0) {
    blocks.push(`RECENT CONVERSATION:\n${keptTurns.join("\n")}`);
  }

  blocks.push(`INSTRUCTION: ${instrTrimmed.text}`);
  const contextText = blocks.join("\n\n");

  return {
    contextText,
    estimatedTokens: estimateTokens(contextText),
    maxBudgetTokens,
    truncatedSections,
    includedHistoryCount: keptTurns.length,
    trimmedHistoryCount,
    untrustedSignals: Array.from(untrustedSignals),
  };
}

export function isSnapshotStale(
  snapshot: PageSnapshot | null | undefined,
  options?: { currentUrl?: string | null; maxAgeMs?: number; nowMs?: number },
): { stale: boolean; reason?: string; ageMs: number } {
  if (!snapshot) {
    return { stale: true, reason: "No active snapshot available.", ageMs: Infinity };
  }
  if (options?.currentUrl && snapshot.url && options.currentUrl !== snapshot.url) {
    return {
      stale: true,
      reason: `Snapshot URL ("${snapshot.url}") no longer matches active tab URL ("${options.currentUrl}").`,
      ageMs: 0,
    };
  }
  const capturedMs = snapshot.capturedAt ? Date.parse(snapshot.capturedAt) : NaN;
  const nowMs = options?.nowMs ?? Date.now();
  const maxAgeMs = options?.maxAgeMs ?? 5 * 60_000;
  if (!Number.isNaN(capturedMs)) {
    const ageMs = Math.max(0, nowMs - capturedMs);
    if (ageMs > maxAgeMs) {
      return {
        stale: true,
        reason: `Snapshot is ${Math.round(ageMs / 1000)}s old (exceeds ${Math.round(maxAgeMs / 1000)}s freshness limit).`,
        ageMs,
      };
    }
    return { stale: false, ageMs };
  }
  return { stale: false, ageMs: 0 };
}
