/**
 * COMMUNICATION AGENT SERVICE (AI Buddy 2.0 — Phase 4)
 *
 * Responsibilities:
 * - Draft emails and replies in English / Hindi / Hinglish
 * - Summarize and categorize incoming messages
 * - Extract concrete action items and follow-up reminders
 * - Strictly enforce explicit user approval before external sending
 */

import { maskSensitiveContextText } from "@/shared/task-context";

export type MessageCategory =
  | "urgent_action"
  | "customer_support"
  | "order_supplier"
  | "billing_tax"
  | "scheduling"
  | "informational"
  | "promotional";

export interface IncomingMessageInput {
  id?: string;
  sender: string;
  subject: string;
  body: string;
  receivedAt?: string;
}

export interface EmailDraft {
  draftId: string;
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  tone: "professional" | "friendly" | "concise" | "escalation";
  language: "english" | "hinglish" | "hindi";
  status: "awaiting_approval" | "approved" | "sent" | "cancelled";
  requiresApproval: true;
  createdAt: string;
  sourceConnector?: string;
}

export interface MessageTriageSummary {
  messageId: string;
  sender: string;
  subject: string;
  category: MessageCategory;
  urgency: "high" | "medium" | "low";
  summary: string;
  actionItems: Array<{
    description: string;
    dueHint?: string;
    owner: "user" | "recipient" | "unknown";
  }>;
  followUpReminder?: {
    suggestedAt: string;
    reason: string;
  };
}

const DRAFT_STORE_KEY = "__aiBuddyEmailDraftsV1";

function getDraftStore(): Map<string, EmailDraft> {
  const g = globalThis as Record<string, unknown>;
  if (!g[DRAFT_STORE_KEY]) {
    g[DRAFT_STORE_KEY] = new Map<string, EmailDraft>();
  }
  return g[DRAFT_STORE_KEY] as Map<string, EmailDraft>;
}

export function listSavedDrafts(): EmailDraft[] {
  return Array.from(getDraftStore().values());
}

export function getSavedDraft(draftId: string): EmailDraft | undefined {
  return getDraftStore().get(draftId);
}

export function createEmailDraft(params: {
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  tone?: EmailDraft["tone"];
  language?: EmailDraft["language"];
  sourceConnector?: string;
}): EmailDraft {
  const cleanBody = maskSensitiveContextText(params.body.trim());
  const draft: EmailDraft = {
    draftId: `draft_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    to: params.to.map((e) => e.trim()).filter(Boolean),
    cc: params.cc?.map((e) => e.trim()).filter(Boolean),
    subject: maskSensitiveContextText(params.subject.trim()) || "(No subject)",
    body: cleanBody,
    tone: params.tone ?? "professional",
    language: params.language ?? "english",
    status: "awaiting_approval",
    requiresApproval: true,
    createdAt: new Date().toISOString(),
    sourceConnector: params.sourceConnector,
  };
  getDraftStore().set(draft.draftId, draft);
  return draft;
}

export function draftReplyToMessage(params: {
  original: IncomingMessageInput;
  replyPoints: string[];
  tone?: EmailDraft["tone"];
  language?: EmailDraft["language"];
}): EmailDraft {
  const subject = params.original.subject.toLowerCase().startsWith("re:")
    ? params.original.subject
    : `Re: ${params.original.subject}`;

  const greeting =
    params.language === "hinglish"
      ? `Hi ${params.original.sender.split(/[@<\s]/)[0] || "Team"},`
      : `Hello ${params.original.sender.split(/[@<\s]/)[0] || "Team"},`;

  const bodyLines = [
    greeting,
    "",
    ...params.replyPoints.map((p) => p.trim()).filter(Boolean),
    "",
    params.tone === "concise" ? "Thanks," : "Best regards,",
  ];

  return createEmailDraft({
    to: [params.original.sender],
    subject,
    body: bodyLines.join("\n"),
    tone: params.tone ?? "professional",
    language: params.language ?? "english",
  });
}

export function summarizeAndCategorizeMessages(
  messages: IncomingMessageInput[],
): MessageTriageSummary[] {
  return messages.map((msg, idx) => {
    const combined = `${msg.subject} ${msg.body}`.toLowerCase();

    let category: MessageCategory = "informational";
    if (/\b(?:gst|invoice|tax|payment|refund|settlement|payout)\b/i.test(combined)) {
      category = "billing_tax";
    } else if (
      /\b(?:order|dispatch|sku|meesho|flipkart|amazon|shipment|supplier)\b/i.test(combined)
    ) {
      category = "order_supplier";
    } else if (/\b(?:urgent|asap|immediately|failed|down|deadline|escalat)\b/i.test(combined)) {
      category = "urgent_action";
    } else if (
      /\b(?:meeting|calendar|schedule|call|reschedule|tomorrow|monday)\b/i.test(combined)
    ) {
      category = "scheduling";
    } else if (/\b(?:ticket|complaint|support|issue|help)\b/i.test(combined)) {
      category = "customer_support";
    } else if (/\b(?:unsubscribe|sale|discount|offer|newsletter)\b/i.test(combined)) {
      category = "promotional";
    }

    const urgency: MessageTriageSummary["urgency"] =
      category === "urgent_action" || /\b(?:urgent|asap|today|deadline|overdue)\b/i.test(combined)
        ? "high"
        : category === "order_supplier" || category === "billing_tax" || category === "scheduling"
          ? "medium"
          : "low";

    // Extract action items deterministically from imperative / deadline lines
    const lines = maskSensitiveContextText(msg.body)
      .split(/\r?\n|(?<=[.!?])\s+/)
      .map((l) => l.trim())
      .filter((l) => l.length > 8);

    const actionItems: MessageTriageSummary["actionItems"] = [];
    for (const line of lines) {
      if (
        /\b(?:please|kindly|need to|action required|confirm|send|share|review|approve|submit|pay|update|reply)\b/i.test(
          line,
        )
      ) {
        const dueMatch = line.match(/\b(?:by|before|on)\s+([A-Za-z0-9 ,:-]{3,25})/i);
        actionItems.push({
          description: line.slice(0, 180),
          dueHint: dueMatch?.[1]?.trim(),
          owner: /\b(?:you|please|kindly)\b/i.test(line) ? "user" : "unknown",
        });
      }
    }

    const firstSentence = lines[0] || maskSensitiveContextText(msg.body).slice(0, 140);
    const followUpReminder =
      urgency === "high" || actionItems.length > 0
        ? {
            suggestedAt: new Date(
              Date.now() + (urgency === "high" ? 2 : 24) * 3600_000,
            ).toISOString(),
            reason: `Follow up on "${msg.subject}" (${actionItems.length} action item(s))`,
          }
        : undefined;

    return {
      messageId: msg.id || `msg_${idx + 1}`,
      sender: msg.sender,
      subject: maskSensitiveContextText(msg.subject),
      category,
      urgency,
      summary: firstSentence,
      actionItems: actionItems.slice(0, 5),
      followUpReminder,
    };
  });
}

/**
 * Mandatory Approval Gate before sending any external communication.
 * Returns blocked status unless explicit approval is provided AND an operational connector is active.
 */
export function prepareSendWithApprovalGate(params: {
  draftId: string;
  approvalGranted: boolean;
  connectorOperational: boolean;
  connectorName?: string;
}): {
  allowed: boolean;
  status: "sent_ready" | "awaiting_approval" | "connector_unavailable" | "not_found";
  message: string;
  draft?: EmailDraft;
} {
  const draft = getSavedDraft(params.draftId);
  if (!draft) {
    return {
      allowed: false,
      status: "not_found",
      message: `Draft "${params.draftId}" was not found.`,
    };
  }
  if (!params.approvalGranted) {
    draft.status = "awaiting_approval";
    return {
      allowed: false,
      status: "awaiting_approval",
      message: `Approval required before sending email "${draft.subject}" to ${draft.to.join(", ")}.`,
      draft,
    };
  }
  if (!params.connectorOperational) {
    draft.status = "approved";
    return {
      allowed: false,
      status: "connector_unavailable",
      message: `${params.connectorName || "Email connector"} is not authorized yet. Draft "${draft.subject}" is approved and preserved locally so nothing was silently lost or faked.`,
      draft,
    };
  }
  draft.status = "approved";
  return {
    allowed: true,
    status: "sent_ready",
    message: `Draft "${draft.subject}" approved for dispatch via ${params.connectorName || "connector"}.`,
    draft,
  };
}
