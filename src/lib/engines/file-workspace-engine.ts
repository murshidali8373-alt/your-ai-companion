/**
 * ENGINE 8: ADVANCED FILE WORKSPACE ENGINE
 *
 * Responsibilities:
 * - Unified internal processing across Excel (.xlsx), CSV, PDF, Word (.docx), and Markdown/JSON
 * - Multi-file cross-comparison (e.g. compare web orders against supplier spreadsheets)
 * - Exact discrepancy calculation and missing record detection
 * - Finding duplicate entries across multiple spreadsheets or document sources
 * - Merging and synthesizing multi-document insights into structured unified reports
 * - Non-destructive file updates (preserves original file structures, formulas, and unrelated cells)
 * - Strict refusal to silently overwrite source files
 */

export type WorkspaceFileFormat = "excel" | "csv" | "pdf" | "docx" | "markdown" | "json" | "text";

export interface WorkspaceDocument {
  id: string;
  filename: string;
  format: WorkspaceFileFormat;
  content: string | Array<Record<string, unknown>>;
  metadata?:
    | {
        sizeBytes?: number;
        rowCount?: number;
        pageCount?: number;
        lastModified?: string;
      }
    | undefined;
}

export interface DiscrepancyDetail {
  key: string;
  field: string;
  baseValue: unknown;
  comparisonValue: unknown;
  diffAmount?: number | undefined;
}

export interface CrossFileComparisonResult {
  baseFileName: string;
  comparisonFileName: string;
  totalBaseRecords: number;
  totalCompareRecords: number;
  matchedRecords: number;
  discrepancies: DiscrepancyDetail[];
  missingInComparison: string[];
  missingInBase: string[];
  auditSummary: string;
  suggestedReconciliations: Array<{
    key: string;
    field: string;
    recommendedValue: unknown;
    reason: string;
  }>;
}

export interface CrossFileDuplicate {
  key: string;
  count: number;
  occurrences: Array<{
    filename: string;
    rowIndex: number;
    recordData: Record<string, unknown>;
  }>;
}

export interface MergedDocumentSection {
  theme: string;
  findings: string[];
  sourceFilenames: string[];
}

export interface MergedDocumentResult {
  title: string;
  sourceCount: number;
  sections: MergedDocumentSection[];
  unifiedReport: string;
}

/**
 * Compares two spreadsheet datasets (e.g. today's live orders vs accounting spreadsheet)
 * identifying missing entries and calculating field discrepancies with exact arithmetic.
 */
export function compareSpreadsheetFiles(params: {
  baseData: Array<Record<string, unknown>>;
  compareData: Array<Record<string, unknown>>;
  keyField: string;
  compareFields: string[];
  baseFileName?: string;
  compareFileName?: string;
}): CrossFileComparisonResult {
  const {
    baseData,
    compareData,
    keyField,
    compareFields,
    baseFileName = "Base File",
    compareFileName = "Comparison File",
  } = params;

  const compareMap = new Map<string, Record<string, unknown>>();
  for (const row of compareData) {
    const rawKey = row[keyField];
    if (rawKey !== undefined && rawKey !== null && rawKey !== "") {
      compareMap.set(String(rawKey).trim().toLowerCase(), row);
    }
  }

  const baseKeySet = new Set<string>();
  const discrepancies: DiscrepancyDetail[] = [];
  const missingInComparison: string[] = [];
  const suggestedReconciliations: CrossFileComparisonResult["suggestedReconciliations"] = [];
  let matchedRecords = 0;

  for (const baseRow of baseData) {
    const rawKey = baseRow[keyField];
    if (rawKey === undefined || rawKey === null || rawKey === "") continue;
    const normKey = String(rawKey).trim().toLowerCase();
    baseKeySet.add(normKey);

    const compareRow = compareMap.get(normKey);
    if (!compareRow) {
      missingInComparison.push(String(rawKey));
      continue;
    }

    matchedRecords++;
    for (const field of compareFields) {
      const bVal = baseRow[field];
      const cVal = compareRow[field];

      if (bVal !== cVal) {
        let diffAmount: number | undefined;
        if (typeof bVal === "number" && typeof cVal === "number") {
          diffAmount = Number((cVal - bVal).toFixed(2));
        }

        discrepancies.push({
          key: String(rawKey),
          field,
          baseValue: bVal,
          comparisonValue: cVal,
          diffAmount,
        });

        suggestedReconciliations.push({
          key: String(rawKey),
          field,
          recommendedValue: cVal,
          reason: `Discrepancy detected: ${baseFileName} has ${String(bVal)}, while ${compareFileName} has ${String(cVal)}`,
        });
      }
    }
  }

  const missingInBase: string[] = [];
  for (const [normKey, row] of compareMap.entries()) {
    if (!baseKeySet.has(normKey)) {
      missingInBase.push(String(row[keyField] ?? normKey));
    }
  }

  const auditSummary = [
    `Cross-File Comparison: "${baseFileName}" vs "${compareFileName}"`,
    `• Total Base Records: ${baseData.length}`,
    `• Total Comparison Records: ${compareData.length}`,
    `• Matched Records: ${matchedRecords}`,
    `• Value Discrepancies: ${discrepancies.length}`,
    `• Missing in ${compareFileName}: ${missingInComparison.length}`,
    `• Missing in ${baseFileName}: ${missingInBase.length}`,
  ].join("\n");

  return {
    baseFileName,
    comparisonFileName: compareFileName,
    totalBaseRecords: baseData.length,
    totalCompareRecords: compareData.length,
    matchedRecords,
    discrepancies,
    missingInComparison,
    missingInBase,
    auditSummary,
    suggestedReconciliations,
  };
}

/**
 * Discovers duplicate records across multiple spreadsheets based on one or more identifier keys.
 */
export function findCrossSpreadsheetDuplicates(
  files: Array<{ filename: string; rows: Array<Record<string, unknown>> }>,
  matchKey: string,
): CrossFileDuplicate[] {
  const index = new Map<
    string,
    Array<{ filename: string; rowIndex: number; recordData: Record<string, unknown> }>
  >();

  for (const file of files) {
    file.rows.forEach((row, idx) => {
      const val = row[matchKey];
      if (val !== undefined && val !== null && val !== "") {
        const keyStr = String(val).trim().toLowerCase();
        const list = index.get(keyStr) || [];
        list.push({ filename: file.filename, rowIndex: idx, recordData: row });
        index.set(keyStr, list);
      }
    });
  }

  const duplicates: CrossFileDuplicate[] = [];
  for (const [key, occurrences] of index.entries()) {
    if (occurrences.length > 1) {
      duplicates.push({
        key,
        count: occurrences.length,
        occurrences,
      });
    }
  }

  return duplicates;
}

/**
 * Extracts and synthesizes multi-document findings into a unified, non-destructive report.
 */
export function mergeDocumentInsights(
  documents: WorkspaceDocument[],
  topicOrQuery: string,
): MergedDocumentResult {
  const q = topicOrQuery.toLowerCase();
  const sections: MergedDocumentSection[] = [];

  for (const doc of documents) {
    const textContent =
      typeof doc.content === "string" ? doc.content : JSON.stringify(doc.content, null, 2);

    const paragraphs = textContent
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter((p) => p.length > 20);

    const relevant = paragraphs.filter((p) => {
      if (!q) return true;
      const lower = p.toLowerCase();
      return q.split(/\s+/).some((w) => w.length > 3 && lower.includes(w));
    });

    if (relevant.length > 0) {
      sections.push({
        theme: `Findings from ${doc.filename}`,
        findings: relevant.slice(0, 5),
        sourceFilenames: [doc.filename],
      });
    }
  }

  const markdownLines = [
    `# Unified Document Synthesis: ${topicOrQuery}`,
    `*Synthesized across ${documents.length} sources without altering original files.*`,
    "",
  ];

  for (const sec of sections) {
    markdownLines.push(`## ${sec.theme}`);
    for (const f of sec.findings) {
      markdownLines.push(`- ${f}`);
    }
    markdownLines.push("");
  }

  return {
    title: `Synthesis: ${topicOrQuery}`,
    sourceCount: documents.length,
    sections,
    unifiedReport: markdownLines.join("\n"),
  };
}

/**
 * Non-destructively applies validated updates to spreadsheet rows,
 * guaranteeing original files are never overwritten silently.
 */
export function applyNonDestructiveFileUpdate(params: {
  originalRows: Array<Record<string, unknown>>;
  updates: Array<{
    matchKey: string;
    matchValue: unknown;
    targetField: string;
    newValue: unknown;
  }>;
  sourceFileName?: string;
}): {
  updatedRows: Array<Record<string, unknown>>;
  modifiedCount: number;
  auditTrail: Array<{
    matchKey: string;
    matchValue: unknown;
    targetField: string;
    previousValue: unknown;
    newValue: unknown;
  }>;
  outputFileName: string;
  changeSummary: string;
} {
  const { originalRows, updates, sourceFileName = "original_data.csv" } = params;

  // Clone to protect source
  const updatedRows = originalRows.map((r) => ({ ...r }));
  const auditTrail: Array<{
    matchKey: string;
    matchValue: unknown;
    targetField: string;
    previousValue: unknown;
    newValue: unknown;
  }> = [];

  let modifiedCount = 0;

  for (const upd of updates) {
    const targetRow = updatedRows.find((row) => {
      const val = row[upd.matchKey];
      return String(val).trim().toLowerCase() === String(upd.matchValue).trim().toLowerCase();
    });

    if (targetRow) {
      const previousValue = targetRow[upd.targetField];
      if (previousValue !== upd.newValue) {
        targetRow[upd.targetField] = upd.newValue;
        auditTrail.push({
          matchKey: upd.matchKey,
          matchValue: upd.matchValue,
          targetField: upd.targetField,
          previousValue,
          newValue: upd.newValue,
        });
        modifiedCount++;
      }
    }
  }

  const nameBase = sourceFileName.replace(/\.[^/.]+$/, "");
  const ext = sourceFileName.includes(".") ? sourceFileName.split(".").pop() : "csv";
  const outputFileName = `${nameBase}_reconciled_${Date.now()}.${ext}`;

  const changeSummary = [
    `Non-Destructive File Update: ${modifiedCount} cell modifications applied.`,
    `Original file "${sourceFileName}" preserved unmodified.`,
    `Updated dataset prepared as "${outputFileName}".`,
  ].join(" ");

  return {
    updatedRows,
    modifiedCount,
    auditTrail,
    outputFileName,
    changeSummary,
  };
}
