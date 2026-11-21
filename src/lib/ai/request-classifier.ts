/**
 * Smart Intent Classifier for AI Buddy.
 * Separates independent general chatbot questions from active-page analysis and browser automation commands,
 * while supporting seamless chat-to-action transitions within the same conversation.
 */

export type RequestCategory =
  "general_chat" | "page_analysis" | "browser_action" | "mixed_reason_and_action";

export interface ClassifyRequestContext {
  snapshot?: { url?: string; title?: string } | null;
  history?: Array<{ role: string; content: string }> | null;
  intentHint?: string | null;
  detachPage?: boolean;
  hasPendingSlot?: boolean;
  hasPendingDisambiguation?: boolean;
  hasActiveFormSession?: boolean;
}

export interface RequestClassification {
  category: RequestCategory;
  includePageContext: boolean;
  reason: string;
}

const EXPLICIT_ACTION_RE =
  /(?:\b(?:click|press|tap|dabao|daba\s*do|open|kholo|khol\s*do|find|locate|where\s+is|kahan\s+hai|kaha\s+hai|kidhar|point\s+(?:to|at|karo)|highlight|fill|bharo|bhar\s*do|daalo|daal\s*do|dalo|type\s+(?:karo|kro|in|into|here)|likho|likh\s*do|scroll|neeche\s+jao|upar\s+jao|download|select|choose|tick|check|uncheck|submit|navigate|go\s+to|search\s+(?:on|par|pe|for)|dhundo|dhoondho|next\s+field|agla\s+field|doosre\s+wale|dusre\s+wale|alternate\s+method|doosre\s+method|dusre\s+method)\b)/i;

const EXPLICIT_PAGE_REF_RE =
  /(?:\b(?:this\s+page|current\s+page|active\s+page|this\s+webpage|webpage|website\s+par|is\s+page|ye\s+page|yeh\s+page|page\s+(?:par|pe|pr|mein|me|kya|explain|summary|summarize|overview|errors?|issues?|alerts?|headings?|links?|buttons?|forms?|tables?)|on\s+this\s+screen|screen\s+(?:par|pe)|visible\s+(?:here|on\s+page)|is\s+form|ye\s+form|this\s+form|these\s+products?|this\s+product|ye\s+product|in\s+dono|compare\s+these|these\s+items|is\s+table|this\s+table|duplicate\s+entries|rto\s+orders?|orders?\s+tab|is\s+button|this\s+button|is\s+field|ismein|isme|isko|yahan|yaha|here\s+on|ord-\d+)\b)/i;

const GENERAL_KNOWLEDGE_RE =
  /^(?:hi+|hello+|hey+|namaste|pranam|hola|what\s+is|who\s+(?:is|was|are|were)|explain|define|tell\s+me\s+about|write\s+(?:a|an|me)?|draft\s+(?:a|an)?|give\s+me|suggest|compare\s+(?!these\b|this\b)|difference\s+between|how\s+(?:does|do|to|can\s+i)|why\s+(?:is|do|does|are)|translate|summarize\s+(?!this\s+page|the\s+page)|matlab\s+kya|kya\s+hota\s+hai|kya\s+hai\b)/i;

export function classifyUserRequest(
  rawQuestion: string,
  ctx: ClassifyRequestContext = {},
): RequestClassification {
  const question = String(rawQuestion || "").trim();
  const qLower = question.toLowerCase();

  if (ctx.detachPage || ctx.intentHint === "general") {
    return {
      category: "general_chat",
      includePageContext: false,
      reason: ctx.detachPage ? "page_vision_off" : "explicit_general_intent",
    };
  }

  if (ctx.hasPendingSlot || ctx.hasPendingDisambiguation || ctx.hasActiveFormSession) {
    return {
      category: "browser_action",
      includePageContext: true,
      reason: "active_conversational_task_state",
    };
  }

  if (
    ctx.intentHint === "interpret_command" ||
    ctx.intentHint === "browser_action" ||
    ctx.intentHint === "plan" ||
    ctx.intentHint === "locate_element"
  ) {
    return {
      category: "browser_action",
      includePageContext: true,
      reason: `intent_hint_${ctx.intentHint}`,
    };
  }

  if (ctx.intentHint === "explain_page" || ctx.intentHint === "visual_inspect") {
    return {
      category: "page_analysis",
      includePageContext: true,
      reason: `intent_hint_${ctx.intentHint}`,
    };
  }

  const hasExplicitAction = EXPLICIT_ACTION_RE.test(qLower);
  const hasExplicitPageRef = EXPLICIT_PAGE_REF_RE.test(qLower);

  // Mixed queries: e.g., "Compare these two products and pick the better one" or "Explain this error and fix the field"
  if (
    hasExplicitPageRef &&
    (/\b(?:compare|better|recommend|suggest|difference|why|explain|advice|best)\b/i.test(qLower) ||
      hasExplicitAction)
  ) {
    return {
      category: hasExplicitAction ? "mixed_reason_and_action" : "page_analysis",
      includePageContext: true,
      reason: hasExplicitAction ? "page_ref_plus_action" : "page_ref_plus_reasoning",
    };
  }

  if (hasExplicitAction) {
    // Distinguish general writing ("write an email", "explain GST", "write a python script") from browser actions
    const isCreativeWritingOnly =
      /\b(?:write|draft|compose)\s+(?:a|an|me)?\s*(?:professional\s+)?(?:email|letter|essay|poem|story|post|caption|code|script|sql|function|message|reply|bio)\b/i.test(
        qLower,
      ) && !hasExplicitPageRef;
    if (!isCreativeWritingOnly) {
      return {
        category: "browser_action",
        includePageContext: true,
        reason: "explicit_browser_action_verb",
      };
    }
  }

  if (hasExplicitPageRef) {
    return {
      category: "page_analysis",
      includePageContext: true,
      reason: "explicit_page_reference",
    };
  }

  // Short deictic follow-ups when previous assistant turn was clearly about the page/action
  const lastAssistant = Array.isArray(ctx.history)
    ? [...ctx.history].reverse().find((h) => h.role === "assistant")?.content || ""
    : "";
  const isFollowUpDeictic =
    /^(?:and\s+)?(?:ab|now|then|uske\s+baad|next|what\s+about\s+that|why\s+is\s+it|how\s+to\s+fix\s+it|is\s+that\s+good)\b/i.test(
      qLower,
    );
  const prevWasPageGrounded =
    Boolean(lastAssistant) &&
    /\b(?:highlighted|clicked|filled|orders?\s+tab|active\s+page|form\s+field|selector|element)\b/i.test(
      lastAssistant,
    );

  if (isFollowUpDeictic && prevWasPageGrounded) {
    return {
      category: "mixed_reason_and_action",
      includePageContext: true,
      reason: "page_grounded_followup",
    };
  }

  if (GENERAL_KNOWLEDGE_RE.test(qLower) || !hasExplicitPageRef) {
    return {
      category: "general_chat",
      includePageContext: false,
      reason: "independent_general_question",
    };
  }

  return {
    category: "general_chat",
    includePageContext: false,
    reason: "default_general_chat",
  };
}
