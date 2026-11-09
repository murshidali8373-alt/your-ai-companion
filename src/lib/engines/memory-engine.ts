/**
 * ENGINE 7: CONTEXT-AWARE MULTI-TIER MEMORY ENGINE
 *
 * Responsibilities:
 * - Multi-tier memory organization:
 *   1. User preferences (language, style, defaults)
 *   2. Long-term facts (seller IDs, store names, addresses)
 *   3. Active projects (current product launches, audits)
 *   4. Workflow recipes (frequently repeated patterns)
 *   5. Important decisions (confirmed thresholds, rules)
 *   6. Temporary task states (resumption checkpoints)
 * - Strict sensitive information blocker (passwords, pins, OTPs, secret keys)
 * - Privacy mode enforcement (suppresses storage & retrieval when enabled)
 * - Context-aware semantic ranking (injects only top-relevant memories)
 */

import { containsSensitive } from "@/shared/sensitive";

export type MemoryKind =
  | "preference"
  | "context"
  | "template"
  | "workflow"
  | "long_term_fact"
  | "active_project"
  | "decision"
  | "temporary_state";

export interface MemoryRecord {
  id: string;
  kind: MemoryKind;
  key: string;
  value: string;
  updatedAt: string;
  source?: string | undefined;
  projectId?: string | undefined;
}

export interface MemoryRetrievalResult {
  relevantMemories: MemoryRecord[];
  formattedContext: string;
  suppressedByPrivacyMode: boolean;
  categorizedCounts: Record<string, number>;
}

const TIER_WEIGHTS: Record<MemoryKind, number> = {
  preference: 3,
  long_term_fact: 3,
  active_project: 4,
  decision: 3,
  workflow: 2,
  template: 2,
  context: 1,
  temporary_state: 1,
};

/**
 * Validates a memory entry before saving
 */
export function validateMemoryEntry(
  key: string,
  value: string,
): { valid: boolean; reason?: string } {
  if (!key.trim() || !value.trim()) {
    return { valid: false, reason: "Key and value must not be empty." };
  }

  if (containsSensitive(key, value)) {
    return {
      valid: false,
      reason: "Memory rejected: looks like a password, OTP, payment card, or secret token.",
    };
  }

  return { valid: true };
}

/**
 * Contextually retrieves memories matching a task or question with tier-weighted ranking
 */
export function retrieveContextualMemories(
  memories: MemoryRecord[],
  query: string,
  options?: {
    privacyMode?: boolean;
    maxCount?: number;
    activeProjectId?: string;
  },
): MemoryRetrievalResult {
  if (options?.privacyMode) {
    return {
      relevantMemories: [],
      formattedContext: "",
      suppressedByPrivacyMode: true,
      categorizedCounts: {},
    };
  }

  const q = query.toLowerCase();
  const max = options?.maxCount ?? 5;
  const categorizedCounts: Record<string, number> = {};

  for (const m of memories) {
    categorizedCounts[m.kind] = (categorizedCounts[m.kind] || 0) + 1;
  }

  // Score relevance
  const scored = memories.map((m) => {
    let score = 0;
    const keyLower = m.key.toLowerCase();
    const valLower = m.value.toLowerCase();

    if (q.includes(keyLower) || keyLower.includes(q)) score += 6;
    if (q.includes(valLower) || valLower.includes(q)) score += 4;

    // Word match
    const words = q.split(/\s+/).filter((w) => w.length > 3);
    for (const w of words) {
      if (keyLower.includes(w)) score += 2;
      if (valLower.includes(w)) score += 1;
    }

    // Tier priority weight
    score += TIER_WEIGHTS[m.kind] || 1;

    // Project affinity boost
    if (options?.activeProjectId && m.projectId === options.activeProjectId) {
      score += 5;
    }

    return { memory: m, score };
  });

  const relevant = scored
    .filter((s) => s.score > 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((s) => s.memory);

  const formattedContext =
    relevant.length > 0
      ? `RELEVANT CONTEXTUAL MEMORIES:\n${relevant.map((m) => `• [${m.kind.toUpperCase()}] ${m.key}: ${m.value}`).join("\n")}`
      : "";

  return {
    relevantMemories: relevant,
    formattedContext,
    suppressedByPrivacyMode: false,
    categorizedCounts,
  };
}
