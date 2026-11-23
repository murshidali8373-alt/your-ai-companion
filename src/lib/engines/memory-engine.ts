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
  | "temporary_state"
  | "user_preference"
  | "communication_preference"
  | "business_context"
  | "frequent_workflow"
  | "completed_task"
  | "reusable_instruction"
  | "automation_preference";

export type MemoryScope = "short_term" | "long_term";

export interface MemoryRecord {
  id: string;
  kind: MemoryKind;
  key: string;
  value: string;
  updatedAt: string;
  scope?: MemoryScope | undefined;
  userId?: string | undefined;
  source?: string | undefined;
  projectId?: string | undefined;
  outdated?: boolean | undefined;
  supersededById?: string | undefined;
  doNotRemember?: boolean | undefined;
  expiresAt?: string | undefined;
  confidence?: number | undefined;
}

export interface MemoryRetrievalResult {
  relevantMemories: MemoryRecord[];
  formattedContext: string;
  suppressedByPrivacyMode: boolean;
  categorizedCounts: Record<string, number>;
}

const TIER_WEIGHTS: Record<MemoryKind, number> = {
  preference: 3,
  user_preference: 4,
  communication_preference: 4,
  long_term_fact: 3,
  business_context: 4,
  active_project: 4,
  decision: 3,
  workflow: 2,
  frequent_workflow: 3,
  completed_task: 2,
  reusable_instruction: 4,
  automation_preference: 3,
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

export function detectDoNotRememberCommand(instruction: string): boolean {
  return /\b(?:do not remember|don't remember|dont remember|never save|mat yaad rakhna|yaad mat rakhna|forget this|don't store|do not store|off the record)\b/i.test(
    instruction,
  );
}

/**
 * Contextually retrieves memories matching a task or question with tier-weighted ranking,
 * user isolation, and short-term vs long-term scope filtering.
 */
export function retrieveContextualMemories(
  memories: MemoryRecord[],
  query: string,
  options?: {
    privacyMode?: boolean;
    maxCount?: number;
    activeProjectId?: string;
    userId?: string | null;
    scope?: MemoryScope | "all";
    includeOutdated?: boolean;
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

  const nowMs = Date.now();
  const scopedMemories = memories.filter((m) => {
    if (m.doNotRemember) return false;
    if (!options?.includeOutdated && m.outdated) return false;
    if (m.expiresAt) {
      const expMs = Date.parse(m.expiresAt);
      if (!Number.isNaN(expMs) && expMs <= nowMs) return false;
    }
    if (options?.userId !== undefined && m.userId !== undefined && m.userId !== options.userId) {
      return false;
    }
    if (options?.scope && options.scope !== "all" && (m.scope ?? "long_term") !== options.scope) {
      return false;
    }
    return true;
  });

  for (const m of scopedMemories) {
    categorizedCounts[m.kind] = (categorizedCounts[m.kind] || 0) + 1;
  }

  // Score relevance with gentle recency decay
  const scored = scopedMemories.map((m) => {
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

    // Subtle recency weighting (fresh <=7d gets +0.5, >60d gets -0.5)
    const updatedMs = Date.parse(m.updatedAt);
    if (!Number.isNaN(updatedMs)) {
      const ageDays = Math.max(0, (nowMs - updatedMs) / (1000 * 60 * 60 * 24));
      if (ageDays <= 7) score += 0.5;
      else if (ageDays > 60) score -= 0.5;
    }

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

export function detectDuplicateOrOutdatedMemory(
  existing: MemoryRecord[],
  candidate: { key: string; value: string; kind: MemoryKind; userId?: string },
): {
  status: "new" | "exact_duplicate" | "outdated_conflict";
  existingMatch?: MemoryRecord;
} {
  const normKey = candidate.key.trim().toLowerCase();
  const normVal = candidate.value.trim().toLowerCase();
  for (const item of existing) {
    if (item.outdated) continue;
    if (
      candidate.userId !== undefined &&
      item.userId !== undefined &&
      item.userId !== candidate.userId
    ) {
      continue;
    }
    if (item.key.trim().toLowerCase() === normKey) {
      if (item.value.trim().toLowerCase() === normVal) {
        return { status: "exact_duplicate", existingMatch: item };
      }
      return { status: "outdated_conflict", existingMatch: item };
    }
  }
  return { status: "new" };
}

export function upsertMemorySafely(
  existing: MemoryRecord[],
  candidate: {
    id?: string;
    key: string;
    value: string;
    kind: MemoryKind;
    scope?: MemoryScope;
    userId?: string;
    source?: string;
    instructionContext?: string;
  },
): {
  ok: boolean;
  action:
    | "created"
    | "updated_outdated"
    | "skipped_duplicate"
    | "rejected_sensitive"
    | "rejected_opt_out";
  reason?: string;
  records: MemoryRecord[];
  saved?: MemoryRecord;
} {
  if (candidate.instructionContext && detectDoNotRememberCommand(candidate.instructionContext)) {
    return {
      ok: false,
      action: "rejected_opt_out",
      reason: "User instructed not to remember this information.",
      records: existing,
    };
  }
  const valid = validateMemoryEntry(candidate.key, candidate.value);
  if (!valid.valid) {
    return {
      ok: false,
      action: "rejected_sensitive",
      reason: valid.reason,
      records: existing,
    };
  }

  const check = detectDuplicateOrOutdatedMemory(existing, candidate);
  if (check.status === "exact_duplicate") {
    return {
      ok: true,
      action: "skipped_duplicate",
      records: existing,
      saved: check.existingMatch,
    };
  }

  const newId =
    candidate.id || `mem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const newRecord: MemoryRecord = {
    id: newId,
    kind: candidate.kind,
    key: candidate.key.trim(),
    value: candidate.value.trim(),
    scope: candidate.scope ?? "long_term",
    userId: candidate.userId,
    source: candidate.source ?? "assistant",
    updatedAt: new Date().toISOString(),
  };

  if (check.status === "outdated_conflict" && check.existingMatch) {
    const updatedList = existing.map((m) =>
      m.id === check.existingMatch!.id ? { ...m, outdated: true, supersededById: newId } : m,
    );
    return {
      ok: true,
      action: "updated_outdated",
      records: [newRecord, ...updatedList],
      saved: newRecord,
    };
  }

  return {
    ok: true,
    action: "created",
    records: [newRecord, ...existing],
    saved: newRecord,
  };
}

export interface MemoryContradictionAlert {
  key: string;
  conflictingValues: string[];
  recordIds: string[];
  resolutionHint: string;
}

/**
 * Surfaces active, non-expired, non-outdated memory entries sharing the same key
 * with conflicting values so reasoning never silently chooses an arbitrary stale preference.
 */
export function detectMemoryContradictions(
  memories: MemoryRecord[],
  nowMs = Date.now(),
): MemoryContradictionAlert[] {
  const byKey = new Map<string, MemoryRecord[]>();
  for (const m of memories) {
    if (m.outdated || m.doNotRemember) continue;
    if (m.expiresAt) {
      const exp = Date.parse(m.expiresAt);
      if (!Number.isNaN(exp) && exp <= nowMs) continue;
    }
    const normKey = m.key.trim().toLowerCase();
    if (!normKey) continue;
    const arr = byKey.get(normKey) ?? [];
    arr.push(m);
    byKey.set(normKey, arr);
  }

  const alerts: MemoryContradictionAlert[] = [];
  for (const [, group] of byKey.entries()) {
    const distinctVals = Array.from(new Set(group.map((g) => g.value.trim())));
    if (distinctVals.length > 1) {
      alerts.push({
        key: group[0]!.key,
        conflictingValues: distinctVals,
        recordIds: group.map((g) => g.id),
        resolutionHint: `Multiple active values stored for "${group[0]!.key}" (${distinctVals.join(" vs ")}). Confirm which preference should remain active.`,
      });
    }
  }
  return alerts;
}

export const PHASE4_MEMORY_CATEGORIES = [
  "user_preference",
  "communication_preference",
  "business_context",
  "active_project",
  "frequent_workflow",
  "completed_task",
  "reusable_instruction",
  "automation_preference",
] as const;

export type Phase4MemoryCategory = (typeof PHASE4_MEMORY_CATEGORIES)[number];

export interface Phase4MemoryEntry {
  id: string;
  key: string;
  value: string;
  category?: string | undefined;
  kind?: MemoryKind | undefined;
  scope?: string | undefined;
  updatedAt: string;
  outdated?: boolean | undefined;
  doNotRemember?: boolean | undefined;
}

export function validatePhase4MemoryWrite(params: {
  key: string;
  value: string;
  category?: string | undefined;
  privacyMode?: boolean | undefined;
  rawInstruction?: string | undefined;
}): { allowed: boolean; reason?: string | undefined } {
  if (params.privacyMode) {
    return { allowed: false, reason: "Privacy mode is active — memory persistence suppressed." };
  }
  if (
    detectDoNotRememberCommand(params.rawInstruction || "") ||
    detectDoNotRememberCommand(params.value)
  ) {
    return { allowed: false, reason: "User requested not to remember this information." };
  }
  const check = validateMemoryEntry(params.key, params.value);
  if (!check.valid) {
    return { allowed: false, reason: check.reason };
  }
  return { allowed: true };
}

export function detectMemoryConflicts(
  entries: Array<{ id: string; key: string; value: string; updatedAt: string; outdated?: boolean }>,
): Array<{ key: string; values: string[]; reason: string }> {
  const byKey = new Map<string, { displayKey: string; values: Set<string> }>();
  for (const item of entries) {
    if (item.outdated) continue;
    const normKey = item.key.trim().toLowerCase();
    const val = item.value.trim();
    if (!normKey || !val) continue;
    const bucket = byKey.get(normKey) ?? { displayKey: item.key.trim(), values: new Set() };
    bucket.values.add(val);
    byKey.set(normKey, bucket);
  }

  const conflicts: Array<{ key: string; values: string[]; reason: string }> = [];
  for (const bucket of byKey.values()) {
    if (bucket.values.size > 1) {
      const vals = Array.from(bucket.values);
      conflicts.push({
        key: bucket.displayKey,
        values: vals,
        reason: `Conflicting values stored for "${bucket.displayKey}": ${vals.join(" vs ")}.`,
      });
    }
  }
  return conflicts;
}

export function detectStaleMemories<
  T extends { id: string; key: string; value: string; updatedAt: string },
>(entries: T[], maxAgeDays = 30, nowMs = Date.now()): Array<T & { ageDays: number }> {
  const thresholdMs = maxAgeDays * 86_400_000;
  const stale: Array<T & { ageDays: number }> = [];
  for (const item of entries) {
    const ts = Date.parse(item.updatedAt);
    if (Number.isNaN(ts)) continue;
    const ageMs = nowMs - ts;
    if (ageMs >= thresholdMs) {
      stale.push({
        ...item,
        ageDays: Math.floor(ageMs / 86_400_000),
      });
    }
  }
  return stale;
}

export function mergeDuplicateMemories<
  T extends { id: string; key: string; value: string; updatedAt: string },
>(entries: T[]): { merged: T[]; mergedCount: number } {
  const bestByPair = new Map<string, T>();
  let mergedCount = 0;

  for (const item of entries) {
    const sig = `${item.key.trim().toLowerCase()}::${item.value.trim().toLowerCase()}`;
    const existing = bestByPair.get(sig);
    if (!existing) {
      bestByPair.set(sig, item);
    } else {
      mergedCount++;
      const existingTs = Date.parse(existing.updatedAt) || 0;
      const itemTs = Date.parse(item.updatedAt) || 0;
      if (itemTs > existingTs) {
        bestByPair.set(sig, item);
      }
    }
  }

  return { merged: Array.from(bestByPair.values()), mergedCount };
}
