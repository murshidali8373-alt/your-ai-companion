/**
 * Lightweight, non-intrusive specialist mode recommendation helper.
 * Suggests a better-suited Buddy when a query clearly belongs to a specialist domain,
 * without ever auto-switching the user's selected personality.
 */

export interface BuddyModeRecommendation {
  slug: string;
  name: string;
  reason: string;
  suggestionText: string;
}

interface DomainRule {
  slug: string;
  name: string;
  reasonHinglish: string;
  reasonEnglish: string;
  pattern: RegExp;
}

const DOMAIN_RULES: DomainRule[] = [
  {
    slug: "ecommerce",
    name: "E-commerce Buddy",
    reasonHinglish: "e-commerce analysis, listing aur pricing",
    reasonEnglish: "e-commerce listings, catalog, and marketplace pricing",
    pattern:
      /\b(?:meesho|amazon|flipkart|shopify|listing|catalog|sku|marketplace|pricing|seller\s*panel|return\s*rate|product\s*title)\b/i,
  },
  {
    slug: "ca",
    name: "CA Buddy",
    reasonHinglish: "GST, tax aur invoice compliance",
    reasonEnglish: "GST, tax rules, and invoice compliance",
    pattern:
      /\b(?:gst|gstr|tds|itr|income\s*tax|hsn|sac|reconcil|balance\s*sheet|tax\s*filing|accounting|invoice\s*audit)\b/i,
  },
  {
    slug: "developer",
    name: "Developer Buddy",
    reasonHinglish: "code debugging aur technical troubleshooting",
    reasonEnglish: "code debugging and technical troubleshooting",
    pattern:
      /\b(?:debug|stack\s*trace|typescript|javascript|python|react|api\s*error|console\s*error|regex|sql|refactor|exception|syntax\s*error)\b/i,
  },
  {
    slug: "legal",
    name: "Legal Buddy",
    reasonHinglish: "contract clauses aur legal review",
    reasonEnglish: "contract clauses and legal document review",
    pattern:
      /\b(?:contract|nda|legal\s*clause|agreement|indemnity|liability|arbitration|terms\s*(?:of|and)\s*conditions)\b/i,
  },
  {
    slug: "data",
    name: "Data Buddy",
    reasonHinglish: "spreadsheets, formulas aur data patterns",
    reasonEnglish: "spreadsheets, formulas, and dataset analysis",
    pattern:
      /\b(?:spreadsheet|excel|csv|pivot\s*table|vlookup|xlookup|duplicate\s*rows|dataset\s*analysis)\b/i,
  },
  {
    slug: "marketing",
    name: "Marketing Buddy",
    reasonHinglish: "ad campaigns, copywriting aur SEO growth",
    reasonEnglish: "ad campaigns, copywriting, and SEO growth",
    pattern:
      /\b(?:ad\s*copy|roas|ctr|meta\s*ads|google\s*ads|campaign\s*strategy|funnel|seo\s*keywords|marketing\s*copy)\b/i,
  },
  {
    slug: "design",
    name: "Design Buddy",
    reasonHinglish: "UI layout, typography aur visual polish",
    reasonEnglish: "UI layout, typography, and visual hierarchy",
    pattern:
      /\b(?:ui\s*\/?\s*ux|typography|color\s*contrast|wireframe|visual\s*hierarchy|spacing\s*polish)\b/i,
  },
  {
    slug: "research",
    name: "Research Buddy",
    reasonHinglish: "multi-source comparison aur verified research",
    reasonEnglish: "multi-source comparison and verified research",
    pattern:
      /\b(?:compare\s*sources|deep\s*research|fact\s*check|literature\s*review|citations)\b/i,
  },
];

const SIMPLE_ACTION_OR_GREETING_RE =
  /^(?:hi+|hello+|hey+|namaste|pranam|scroll\s+(?:up|down)|neeche\s+scroll|upar\s+scroll|page\s+ko\s+(?:neeche|upar)|click\s+|point\s+)/i;

export function recommendSpecialistBuddy(params: {
  question: string;
  activeSlug?: string | null;
  language?: string | null;
}): BuddyModeRecommendation | null {
  const q = (params.question || "").trim();
  if (q.length < 12 || SIMPLE_ACTION_OR_GREETING_RE.test(q)) {
    return null;
  }

  const normalizedActive = (params.activeSlug || "friendly").toLowerCase().replace(/^custom:/, "");
  const aliasResolvedActive =
    normalizedActive === "dev" || normalizedActive === "coder"
      ? "developer"
      : normalizedActive === "tax"
        ? "ca"
        : normalizedActive;

  for (const rule of DOMAIN_RULES) {
    if (!rule.pattern.test(q)) continue;
    if (aliasResolvedActive === rule.slug) return null;

    const isEnglish = params.language === "english";
    const reason = isEnglish ? rule.reasonEnglish : rule.reasonHinglish;
    const suggestionText = isEnglish
      ? `I can help with this, though ${rule.name} is specialized for ${reason}. Would you like to select it?`
      : `Main ye kaam kar sakta hoon. Lekin detailed ${reason} ke liye ${rule.name} better rahega. Kya aap use select karna chahenge?`;

    return {
      slug: rule.slug,
      name: rule.name,
      reason,
      suggestionText,
    };
  }

  return null;
}
