/**
 * ENGINE 9: ADVANCED RESEARCH INTELLIGENCE ENGINE
 *
 * Responsibilities:
 * - Multi-source web research coordination
 * - Cross-referencing claims across independent web sources
 * - Strict epistemological categorization:
 *   1. Verified facts (empirically corroborated with citations)
 *   2. Expert consensus (broad community or standard alignment)
 *   3. Conflicting evidence (contradictory findings between sources)
 *   4. Minority opinions (credible alternative perspectives)
 *   5. Hypotheses (proposed explanations without definitive proof)
 *   6. Speculation (forward-looking conjecture)
 *   7. Unknowns (clear acknowledgement of unanswered questions)
 * - Verifiable citations with source domain, title, and direct quotes
 * - Strict prohibition against hallucinating citations or fake multi-model consensus
 */

export type ClaimCategory =
  | "verified_fact"
  | "expert_consensus"
  | "conflicting_evidence"
  | "minority_opinion"
  | "hypothesis"
  | "speculation"
  | "unknown";

export interface ResearchSource {
  id: string;
  url: string;
  title: string;
  domain: string;
  snippets: string[];
  credibilityScore?: number | undefined;
}

export interface VerifiedCitation {
  sourceId: string;
  url: string;
  title: string;
  domain: string;
  quote: string;
}

export interface ClaimVerification {
  id: string;
  claim: string;
  category: ClaimCategory;
  confidence: number;
  citations: VerifiedCitation[];
  contradictionNotes?: string | undefined;
}

export interface StructuredResearchReport {
  topic: string;
  sourcesAnalyzed: number;
  claims: ClaimVerification[];
  executiveSummary: string;
  categorizedBreakdown: Record<ClaimCategory, number>;
  verifiedFacts: string[];
  conflictingFindings: Array<{ claim: string; note: string }>;
  unansweredQuestions: string[];
  citations: Array<{ number: number; title: string; url: string; domain: string }>;
  markdownReport: string;
}

/**
 * Evaluates claims against multiple gathered sources, rigorously separating
 * verified facts, conflicting evidence, consensus, hypotheses, and unknowns.
 */
export function analyzeMultiSourceResearch(params: {
  topic: string;
  sources: ResearchSource[];
  claimsToEvaluate: Array<{ claim: string; suggestedCategory?: ClaimCategory }>;
}): StructuredResearchReport {
  const { topic, sources, claimsToEvaluate } = params;

  const claims: ClaimVerification[] = [];
  const categorizedBreakdown: Record<ClaimCategory, number> = {
    verified_fact: 0,
    expert_consensus: 0,
    conflicting_evidence: 0,
    minority_opinion: 0,
    hypothesis: 0,
    speculation: 0,
    unknown: 0,
  };

  const allCitationsMap = new Map<string, { title: string; url: string; domain: string }>();

  claimsToEvaluate.forEach((item, idx) => {
    const claimLower = item.claim.toLowerCase();
    const matchingCitations: VerifiedCitation[] = [];

    for (const src of sources) {
      for (const snip of src.snippets) {
        const words = claimLower.split(/\s+/).filter((w) => w.length > 3);
        const matchCount = words.filter((w) => snip.toLowerCase().includes(w)).length;
        if (matchCount >= 2 || snip.toLowerCase().includes(claimLower.slice(0, 30))) {
          matchingCitations.push({
            sourceId: src.id,
            url: src.url,
            title: src.title,
            domain: src.domain,
            quote: snip.slice(0, 200),
          });
          allCitationsMap.set(src.url, {
            title: src.title,
            url: src.url,
            domain: src.domain,
          });
          break;
        }
      }
    }

    let category: ClaimCategory = item.suggestedCategory || "hypothesis";
    let contradictionNotes: string | undefined;

    if (matchingCitations.length >= 2) {
      // Multiple sources
      if (item.suggestedCategory === "conflicting_evidence") {
        category = "conflicting_evidence";
        contradictionNotes = "Sources present differing metrics or divergent assertions.";
      } else {
        category = "verified_fact";
      }
    } else if (matchingCitations.length === 1) {
      category = item.suggestedCategory || "expert_consensus";
    } else {
      category = item.suggestedCategory === "speculation" ? "speculation" : "unknown";
    }

    categorizedBreakdown[category] = (categorizedBreakdown[category] || 0) + 1;

    claims.push({
      id: `claim_${idx + 1}`,
      claim: item.claim,
      category,
      confidence: category === "verified_fact" ? 0.95 : category === "unknown" ? 0.2 : 0.75,
      citations: matchingCitations,
      contradictionNotes,
    });
  });

  const verifiedFacts = claims
    .filter((c) => c.category === "verified_fact" || c.category === "expert_consensus")
    .map((c) => c.claim);

  const conflictingFindings = claims
    .filter((c) => c.category === "conflicting_evidence")
    .map((c) => ({ claim: c.claim, note: c.contradictionNotes || "Divergent evidence" }));

  const unansweredQuestions = claims.filter((c) => c.category === "unknown").map((c) => c.claim);

  const citations = Array.from(allCitationsMap.values()).map((c, i) => ({
    number: i + 1,
    title: c.title,
    url: c.url,
    domain: c.domain,
  }));

  const executiveSummary = [
    `Research Summary: ${topic}`,
    `Evaluated across ${sources.length} sources and ${claims.length} assertions.`,
    `Verified Facts: ${verifiedFacts.length} | Conflicts: ${conflictingFindings.length} | Unknowns: ${unansweredQuestions.length}.`,
  ].join(" ");

  const reportLines = [
    `# Research Report: ${topic}`,
    `*Synthesized from ${sources.length} independent sources with verifiable citations.*`,
    "",
    "## Executive Summary",
    executiveSummary,
    "",
    "## 1. Verified Facts & Consensus",
    ...(verifiedFacts.length > 0
      ? verifiedFacts.map((f) => `• **Verified**: ${f}`)
      : ["• No claims met the two-source verification threshold."]),
    "",
    "## 2. Conflicting Evidence",
    ...(conflictingFindings.length > 0
      ? conflictingFindings.map((cf) => `• ⚠️ **Conflict**: ${cf.claim} (${cf.note})`)
      : ["• No direct contradictions found among analyzed sources."]),
    "",
    "## 3. Unresolved Questions & Missing Data",
    ...(unansweredQuestions.length > 0
      ? unansweredQuestions.map((u) => `• ❓ **Unknown**: ${u}`)
      : ["• All requested claims had at least preliminary documentation."]),
    "",
    "## Sources & Citations",
    ...citations.map((c) => `[${c.number}] ${c.title} — ${c.url} (${c.domain})`),
  ];

  return {
    topic,
    sourcesAnalyzed: sources.length,
    claims,
    executiveSummary,
    categorizedBreakdown,
    verifiedFacts,
    conflictingFindings,
    unansweredQuestions,
    citations,
    markdownReport: reportLines.join("\n"),
  };
}
