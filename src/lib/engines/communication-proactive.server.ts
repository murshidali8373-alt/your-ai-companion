/**
 * COMMUNICATION AGENT & PROACTIVE INTELLIGENCE ENGINE (.server.ts)
 *
 * Communication Agent:
 * - Summarizes email/message threads
 * - Categorizes urgency & topic
 * - Extracts actionable tasks & owners/deadlines
 * - Drafts follow-ups & replies cleanly
 * - Strictly requires user confirmation before sending via external connectors
 *
 * Proactive Intelligence Engine:
 * - Generates reason-backed next-step suggestions from active projects,
 *   stale/conflicting memories, reconciliation discrepancies, and failed workflows
 * - Honors user notification opt-out & mute controls
 */

import { getGeminiKey } from "@/lib/ai/provider-keys.server";
import { readScopedCollection, updateScopedCollection } from "@/lib/persistence/store.server";
import { executeConnectorWriteWithGate, type ConnectorId } from "@/lib/integrations/connectors";
import {
  detectMemoryConflicts,
  detectStaleMemories,
  type Phase4MemoryEntry,
} from "@/lib/engines/memory-engine";

export type ThreadCategory =
  "urgent_action" | "customer_support" | "vendor_update" | "financial" | "informational";

export interface CommunicationAnalysisResult {
  category: ThreadCategory;
  summary: string;
  actionItems: Array<{ task: string; owner?: string | undefined; urgency: "high" | "normal" }>;
  draftReply: {
    id: string;
    channel: ConnectorId;
    recipient?: string | undefined;
    subject?: string | undefined;
    body: string;
    requiresApproval: true;
    approvedToSend: false;
  };
  usedAi: boolean;
}

export interface PersistedDraftMessage {
  id: string;
  userId: string;
  channel: ConnectorId;
  recipient: string;
  subject: string;
  body: string;
  status: "awaiting_approval" | "approved_and_sent" | "discarded";
  createdAt: string;
  sentAt?: string | undefined;
}

export interface ProactiveSuggestion {
  id: string;
  category:
    "memory_maintenance" | "workflow_follow_up" | "data_reconciliation" | "communication_follow_up";
  title: string;
  reason: string;
  recommendedAction: string;
  confidence: number;
  createdAt: string;
}

export async function analyzeCommunicationThread(params: {
  userId: string;
  messages: Array<{ sender: string; timestamp?: string; text: string }>;
  channel?: ConnectorId | undefined;
  recipient?: string | undefined;
  subject?: string | undefined;
  tone?: "professional" | "concise" | "friendly" | undefined;
}): Promise<CommunicationAnalysisResult> {
  const joined = params.messages
    .map((m, i) => `[${i + 1}] ${m.sender}${m.timestamp ? ` (${m.timestamp})` : ""}: ${m.text}`)
    .join("\n");
  const lower = joined.toLowerCase();

  let category: ThreadCategory = "informational";
  if (/\b(?:urgent|asap|immediately|blocked|deadline|overdue|failed|escalat)\b/i.test(lower)) {
    category = "urgent_action";
  } else if (/\b(?:invoice|payment|gst|refund|payout|settlement|price|amount)\b/i.test(lower)) {
    category = "financial";
  } else if (/\b(?:vendor|supplier|dispatch|shipment|order|sku|catalog)\b/i.test(lower)) {
    category = "vendor_update";
  } else if (/\b(?:ticket|customer|complaint|return|issue|support)\b/i.test(lower)) {
    category = "customer_support";
  }

  // Deterministic action-item extraction
  const actionItems: CommunicationAnalysisResult["actionItems"] = [];
  for (const m of params.messages) {
    const sentences = m.text
      .split(/[.!?\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const s of sentences) {
      if (
        /\b(?:please|kindly|need to|must|send|confirm|share|update|verify|check|reconcile)\b/i.test(
          s,
        )
      ) {
        actionItems.push({
          task: s.slice(0, 160),
          owner: m.sender,
          urgency: category === "urgent_action" ? "high" : "normal",
        });
      }
    }
  }

  const lastSender = params.messages[params.messages.length - 1]?.sender || "Team";
  let summary = `Thread across ${params.messages.length} message(s) classified as ${category.replace("_", " ")}. Latest note from ${lastSender}.`;
  let draftBody = [
    `Hi ${params.recipient || lastSender},`,
    "",
    `Thanks for the update. I reviewed the thread (${actionItems.length} action item(s) noted).`,
    actionItems[0]
      ? `Next step: ${actionItems[0].task}`
      : "I will follow up with the updated status shortly.",
    "",
    "Best regards",
  ].join("\n");
  let usedAi = false;

  const geminiKey = getGeminiKey();
  if (geminiKey) {
    try {
      const { GoogleGenAI } = await import("@google/genai");
      const ai = new GoogleGenAI({
        apiKey: geminiKey,
        httpOptions: { headers: { "User-Agent": "aistudio-build" } },
      });
      const res = await ai.models.generateContent({
        model: "gemini-3.1-flash-lite",
        contents: `Summarize this thread concisely in 2 sentences and write a ${params.tone || "professional"} reply draft grounded strictly in the messages (do not invent numbers or facts):\n\n${joined.slice(0, 8000)}`,
        config: {
          systemInstruction:
            'Return strict JSON: {"summary":"...","draftReply":"..."}. Never fabricate commitments or facts.',
          responseMimeType: "application/json",
        },
      });
      const parsed = JSON.parse((res.text || "{}").trim()) as {
        summary?: string;
        draftReply?: string;
      };
      if (parsed.summary) summary = parsed.summary;
      if (parsed.draftReply) draftBody = parsed.draftReply;
      usedAi = true;
    } catch {
      // Deterministic draft fallback already prepared
    }
  }

  const draftId = `draft_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const channel = params.channel || "gmail";
  const persisted: PersistedDraftMessage = {
    id: draftId,
    userId: params.userId,
    channel,
    recipient: params.recipient || lastSender,
    subject: params.subject || "Follow-up",
    body: draftBody,
    status: "awaiting_approval",
    createdAt: new Date().toISOString(),
  };

  await updateScopedCollection<PersistedDraftMessage[]>(
    params.userId,
    "pending_drafts",
    [],
    (list) => [persisted, ...list.slice(0, 49)],
  );

  return {
    category,
    summary,
    actionItems: actionItems.slice(0, 8),
    draftReply: {
      id: draftId,
      channel,
      recipient: persisted.recipient,
      subject: persisted.subject,
      body: persisted.body,
      requiresApproval: true,
      approvedToSend: false,
    },
    usedAi,
  };
}

export async function sendApprovedDraft(params: {
  userId: string;
  draftId: string;
  confirmedByUser: boolean;
  userToken?: string | null | undefined;
}): Promise<{ ok: boolean; requiresConfirmation?: boolean; detail: string }> {
  const drafts = await readScopedCollection<PersistedDraftMessage[]>(
    params.userId,
    "pending_drafts",
    [],
  );
  const draft = drafts.find((d) => d.id === params.draftId);
  if (!draft) {
    return { ok: false, detail: `Draft "${params.draftId}" not found.` };
  }

  const gate = await executeConnectorWriteWithGate({
    userId: params.userId,
    connectorId: draft.channel,
    action: "send_draft_message",
    targetSummary: `${draft.channel} -> ${draft.recipient} (${draft.subject})`,
    confirmedByUser: params.confirmedByUser,
    userToken: params.userToken,
  });

  if (gate.ok) {
    await updateScopedCollection<PersistedDraftMessage[]>(
      params.userId,
      "pending_drafts",
      [],
      (list) =>
        list.map((d) =>
          d.id === draft.id
            ? { ...d, status: "approved_and_sent", sentAt: new Date().toISOString() }
            : d,
        ),
    );
  }
  return gate;
}

export interface ProactivePreferences {
  enabled: boolean;
  mutedCategories: string[];
}

export async function generateProactiveSuggestions(params: {
  userId: string;
  prefs?: ProactivePreferences | undefined;
  discrepancyCount?: number | undefined;
  pendingDraftCount?: number | undefined;
}): Promise<{ suggestions: ProactiveSuggestion[]; suppressed: boolean }> {
  const prefs =
    params.prefs ??
    (await readScopedCollection<ProactivePreferences>(params.userId, "proactive_prefs", {
      enabled: true,
      mutedCategories: [],
    }));

  if (!prefs.enabled) {
    return { suggestions: [], suppressed: true };
  }

  const muted = new Set(prefs.mutedCategories);
  const suggestions: ProactiveSuggestion[] = [];
  const now = new Date().toISOString();

  const [memories, drafts] = await Promise.all([
    readScopedCollection<Phase4MemoryEntry[]>(params.userId, "memories_v2", []),
    readScopedCollection<PersistedDraftMessage[]>(params.userId, "pending_drafts", []),
  ]);

  if (!muted.has("memory_maintenance")) {
    const conflicts = detectMemoryConflicts(memories);
    if (conflicts.length > 0) {
      suggestions.push({
        id: `sug_mem_conflict_${conflicts[0]!.key}`,
        category: "memory_maintenance",
        title: `Resolve ${conflicts.length} conflicting memory record(s)`,
        reason: conflicts[0]!.reason,
        recommendedAction: "Open Memory Manager and keep the authoritative value.",
        confidence: 0.94,
        createdAt: now,
      });
    }
    const stale = detectStaleMemories(memories, 30);
    if (stale.length > 0) {
      suggestions.push({
        id: `sug_mem_stale_${stale.length}`,
        category: "memory_maintenance",
        title: `Review ${stale.length} stale memory item(s)`,
        reason: `"${stale[0]!.key}" was last updated ${stale[0]!.ageDays} days ago.`,
        recommendedAction: "Confirm, pin, or delete outdated context.",
        confidence: 0.85,
        createdAt: now,
      });
    }
  }

  const awaitingDrafts =
    params.pendingDraftCount ?? drafts.filter((d) => d.status === "awaiting_approval").length;
  if (!muted.has("communication_follow_up") && awaitingDrafts > 0) {
    suggestions.push({
      id: `sug_drafts_${awaitingDrafts}`,
      category: "communication_follow_up",
      title: `${awaitingDrafts} message draft(s) awaiting approval`,
      reason: "External messages are held safely behind your confirmation gate until reviewed.",
      recommendedAction: "Inspect and approve or discard pending communication drafts.",
      confidence: 0.97,
      createdAt: now,
    });
  }

  if (!muted.has("data_reconciliation") && (params.discrepancyCount ?? 0) > 0) {
    suggestions.push({
      id: `sug_reconcile_${params.discrepancyCount}`,
      category: "data_reconciliation",
      title: `Export reconciliation audit for ${params.discrepancyCount} discrepancy item(s)`,
      reason: "Cross-file comparison found mismatched values between datasets.",
      recommendedAction: "Generate verified XLSX or DOCX discrepancy report in File Workspace.",
      confidence: 0.92,
      createdAt: now,
    });
  }

  return { suggestions, suppressed: false };
}
