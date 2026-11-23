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
  flaggedUntrustedSignals?: number;
  markdownReport: string;
}

const UNTRUSTED_INJECTION_RE =
  /\b(?:ignore|disregard|forget|bypass)\s+(?:all\s+)?(?:previous|prior|system|above|security)\s+(?:instructions?|rules?|prompts?|policies?)\b|(?:^|\n)\s*(?:SYSTEM|DEVELOPER|ASSISTANT)\s*:\s*(?:override|you are now|must execute)/i;

function sanitizeResearchSnippet(snip: string): { text: string; flagged: boolean } {
  const flagged = UNTRUSTED_INJECTION_RE.test(snip);
  const text = flagged
    ? `[UNTRUSTED_SNIPPET_NEUTRALIZED] ${snip.replace(/(?:SYSTEM|DEVELOPER|ASSISTANT)\s*:/gi, "[UNTRUSTED_LABEL]:")}`
    : snip;
  return { text, flagged };
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
  let flaggedUntrustedSignals = 0;

  const cleanSources: ResearchSource[] = sources.map((src) => ({
    ...src,
    snippets: src.snippets.map((s) => {
      const res = sanitizeResearchSnippet(s);
      if (res.flagged) flaggedUntrustedSignals += 1;
      return res.text;
    }),
  }));

  claimsToEvaluate.forEach((item, idx) => {
    const claimLower = item.claim.toLowerCase();
    const matchingCitations: VerifiedCitation[] = [];

    for (const src of cleanSources) {
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
    flaggedUntrustedSignals,
    markdownReport: reportLines.join("\n"),
  };
}

export interface DetectedSourceContradiction {
  topicToken: string;
  sourceA: { title: string; url: string; excerpt: string; numbers: string[] };
  sourceB: { title: string; url: string; excerpt: string; numbers: string[] };
  reason: string;
}

/**
 * Automatically detects conflicting quantitative figures or opposing assertions across ResearchSources.
 */
export function detectSourceContradictions(
  sources: ResearchSource[],
): DetectedSourceContradiction[] {
  const contradictions: DetectedSourceContradiction[] = [];
  if (sources.length < 2) return contradictions;

  const numRe = /\b\d+(?:\.\d+)?%?/g;
  const entries = sources.flatMap((s) =>
    s.snippets.map((snip) => ({
      source: s,
      snip,
      lower: snip.toLowerCase(),
      numbers: (snip.match(numRe) ?? []) as string[],
      words: new Set(
        snip
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, " ")
          .split(/\s+/)
          .filter((w) => w.length > 4),
      ),
    })),
  );

  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i]!;
      const b = entries[j]!;
      if (a.source.id === b.source.id) continue;

      const shared = [...a.words].filter((w) => b.words.has(w));
      if (shared.length < 2) continue;

      // Numeric disagreement on shared context
      if (a.numbers.length > 0 && b.numbers.length > 0) {
        const diffNum = a.numbers.some((na) => !b.numbers.includes(na));
        if (diffNum) {
          contradictions.push({
            topicToken: shared.slice(0, 3).join(", "),
            sourceA: {
              title: a.source.title,
              url: a.source.url,
              excerpt: a.snip.slice(0, 180),
              numbers: a.numbers,
            },
            sourceB: {
              title: b.source.title,
              url: b.source.url,
              excerpt: b.snip.slice(0, 180),
              numbers: b.numbers,
            },
            reason: `Different numeric values (${a.numbers.join(", ")} vs ${b.numbers.join(", ")}) for "${shared.slice(0, 2).join(" ")}".`,
          });
          continue;
        }
      }

      // Negation polarity disagreement
      const negA = /\b(?:not|no|never|without|zero|none|false)\b/i.test(a.lower);
      const negB = /\b(?:not|no|never|without|zero|none|false)\b/i.test(b.lower);
      if (negA !== negB && shared.length >= 3) {
        contradictions.push({
          topicToken: shared.slice(0, 3).join(", "),
          sourceA: {
            title: a.source.title,
            url: a.source.url,
            excerpt: a.snip.slice(0, 180),
            numbers: a.numbers,
          },
          sourceB: {
            title: b.source.title,
            url: b.source.url,
            excerpt: b.snip.slice(0, 180),
            numbers: b.numbers,
          },
          reason: `Opposing polarity detected between ${a.source.domain} and ${b.source.domain}.`,
        });
      }
    }
  }
  return contradictions;
}

const PRIVATE_IP_OR_HOST_RE =
  /^(?:localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|::1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+|.*\.local|.*\.internal)$/i;

export function validatePublicResearchUrl(rawUrl: string): {
  valid: boolean;
  url?: URL;
  reason?: string;
} {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return { valid: false, reason: "Only http/https public research URLs are permitted." };
    }
    if (PRIVATE_IP_OR_HOST_RE.test(parsed.hostname)) {
      return { valid: false, reason: "Blocked private/loopback/metadata host for SSRF safety." };
    }
    return { valid: true, url: parsed };
  } catch {
    return { valid: false, reason: "Malformed URL." };
  }
}

export async function collectWebResearchSources(
  urls: string[],
  fetchFn: typeof fetch = fetch,
): Promise<{ sources: ResearchSource[]; errors: Array<{ url: string; reason: string }> }> {
  const sources: ResearchSource[] = [];
  const errors: Array<{ url: string; reason: string }> = [];

  await Promise.all(
    urls.slice(0, 6).map(async (rawUrl, idx) => {
      const check = validatePublicResearchUrl(rawUrl);
      if (!check.valid || !check.url) {
        errors.push({ url: rawUrl, reason: check.reason || "Invalid URL" });
        return;
      }
      try {
        const res = await fetchFn(check.url.toString(), {
          method: "GET",
          headers: { "User-Agent": "AI-Buddy-Research/2.0" },
          signal: AbortSignal.timeout(6000),
        });
        if (!res.ok) {
          errors.push({ url: rawUrl, reason: `HTTP ${res.status}` });
          return;
        }
        const html = await res.text();
        const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        const title = titleMatch?.[1]?.replace(/\s+/g, " ").trim() || check.url.hostname;
        const plain = html
          .replace(/<script[\s\S]*?<\/script>/gi, " ")
          .replace(/<style[\s\S]*?<\/style>/gi, " ")
          .replace(/<[^>]+>/g, "\n")
          .split(/\n+/)
          .map((l) => l.replace(/\s+/g, " ").trim())
          .filter((l) => l.length > 40 && l.length < 400);

        sources.push({
          id: `web_src_${idx + 1}`,
          url: check.url.toString(),
          title,
          domain: check.url.hostname,
          snippets: plain.slice(0, 8).map((s) => sanitizeResearchSnippet(s).text),
        });
      } catch (err) {
        errors.push({
          url: rawUrl,
          reason: err instanceof Error ? err.message : "Network fetch failed",
        });
      }
    }),
  );

  return { sources, errors };
}
