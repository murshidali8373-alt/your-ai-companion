/**
 * SAFE ADAPTIVE PATTERN LEARNING ENGINE (Phase 6)
 *
 * - Learns reusable task patterns strictly from verified, successful executions.
 * - Blocks failed executions, unverified results, and any credential/PII/OTP payloads.
 * - Tracks extension/engine version provenance and flags cross-version patterns for revalidation.
 */

import { containsSensitive } from "@/shared/sensitive";

export interface VerifiedExecutionPattern {
  patternId: string;
  normalizedIntent: string;
  domainOrigin: string;
  actionSequence: string[];
  summary: string;
  extensionVersion: string;
  verifiedAt: string;
  successCount: number;
  invalidated: boolean;
  invalidatedReason?: string;
  requiresRevalidation: boolean;
}

const PATTERN_STORE_KEY = "__aiBuddyVerifiedPatternStoreV1";

function getPatternStore(): Map<string, VerifiedExecutionPattern> {
  const g = globalThis as Record<string, unknown>;
  if (!g[PATTERN_STORE_KEY]) {
    g[PATTERN_STORE_KEY] = new Map<string, VerifiedExecutionPattern>();
  }
  return g[PATTERN_STORE_KEY] as Map<string, VerifiedExecutionPattern>;
}

function normalizePatternKey(intent: string, domainOrigin: string): string {
  const cleanIntent = intent
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  const cleanOrigin = (domainOrigin || "*").toLowerCase().trim();
  return `${cleanOrigin}::${cleanIntent}`;
}

export function recordVerifiedExecutionPattern(candidate: {
  intent: string;
  domainOrigin?: string;
  actionSequence: string[];
  summary: string;
  extensionVersion?: string;
  ok: boolean;
  verified: boolean;
}): { stored: boolean; reason?: string; pattern?: VerifiedExecutionPattern } {
  if (!candidate.ok || !candidate.verified) {
    return {
      stored: false,
      reason: "Learning blocked: only verified successful executions may become reusable patterns.",
    };
  }
  if (!candidate.intent.trim() || candidate.actionSequence.length === 0) {
    return {
      stored: false,
      reason: "Learning blocked: intent and non-empty actionSequence are required.",
    };
  }

  const combinedText = `${candidate.intent} ${candidate.summary} ${candidate.actionSequence.join(" ")}`;
  if (containsSensitive("pattern", combinedText)) {
    return {
      stored: false,
      reason: "Learning blocked: pattern contains sensitive credentials, OTP, or payment data.",
    };
  }

  const store = getPatternStore();
  const origin = candidate.domainOrigin?.trim() || "*";
  const key = normalizePatternKey(candidate.intent, origin);
  const version = candidate.extensionVersion?.trim() || "2.0.0";
  const existing = store.get(key);

  if (existing && !existing.invalidated) {
    existing.successCount += 1;
    existing.verifiedAt = new Date().toISOString();
    existing.extensionVersion = version;
    existing.requiresRevalidation = false;
    return { stored: true, pattern: { ...existing } };
  }

  const pattern: VerifiedExecutionPattern = {
    patternId: `pat_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    normalizedIntent: candidate.intent.trim(),
    domainOrigin: origin,
    actionSequence: candidate.actionSequence.slice(0, 12),
    summary: candidate.summary.slice(0, 240),
    extensionVersion: version,
    verifiedAt: new Date().toISOString(),
    successCount: 1,
    invalidated: false,
    requiresRevalidation: false,
  };
  store.set(key, pattern);
  return { stored: true, pattern: { ...pattern } };
}

export function findReusablePatterns(
  intent: string,
  domainOrigin = "*",
  currentExtensionVersion = "2.0.0",
): VerifiedExecutionPattern[] {
  const qWords = intent
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);

  if (qWords.length === 0) return [];
  const matches: VerifiedExecutionPattern[] = [];

  for (const pat of getPatternStore().values()) {
    if (pat.invalidated) continue;
    if (domainOrigin !== "*" && pat.domainOrigin !== "*" && pat.domainOrigin !== domainOrigin) {
      continue;
    }
    const pLower = pat.normalizedIntent.toLowerCase();
    const hits = qWords.filter((w) => pLower.includes(w)).length;
    if (hits >= Math.min(2, qWords.length)) {
      matches.push({
        ...pat,
        requiresRevalidation: pat.extensionVersion !== currentExtensionVersion,
      });
    }
  }

  return matches.sort((a, b) => b.successCount - a.successCount);
}

export function invalidatePattern(patternId: string, reason = "User or verifier invalidated pattern"): boolean {
  for (const pat of getPatternStore().values()) {
    if (pat.patternId === patternId) {
      pat.invalidated = true;
      pat.invalidatedReason = reason;
      return true;
    }
  }
  return false;
}

export function resetAdaptiveLearningForTests(): void {
  getPatternStore().clear();
}
