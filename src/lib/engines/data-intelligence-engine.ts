/**
 * ENGINE 5: DATA INTELLIGENCE & SPREADSHEET ENGINE
 *
 * Responsibilities:
 * - Table and list record extraction across accessible pages
 * - Exact classification of status records (e.g. paused vs active vs pending QC)
 * - Deterministic arithmetic (counts, sums, subtotals, averages)
 * - Deduplication of multi-page records
 * - Truthful reporting of coverage and inaccessible items
 * - Spreadsheet understanding, anomaly detection, price calculation
 * - Non-destructive cell-level editing with internal audit change summary
 * - Structured report generation (CSV, JSON, Markdown)
 */

export interface DataRecord {
  id?: string | undefined;
  title?: string | undefined;
  status?: string | undefined;
  amount?: number | undefined;
  category?: string | undefined;
  date?: string | undefined;
  sourcePage?: number | undefined;
  raw: Record<string, unknown>;
}

export interface DataAggregationResult {
  totalRecords: number;
  uniqueRecords: number;
  duplicateCount: number;
  statusCounts: Record<string, number>;
  numericalSummaries: Record<string, { sum: number; avg: number; min: number; max: number }>;
  coverageReport: {
    pagesInspected: number;
    isComplete: boolean;
    missingNotice?: string | undefined;
  };
}

export type ColumnType = "string" | "numeric" | "currency" | "date" | "status" | "id" | "formula";

export interface SpreadsheetColumnInfo {
  name: string;
  inferredType: ColumnType;
  nullCount: number;
  uniqueCount: number;
  sampleValues: unknown[];
  numericSummary?: { sum: number; min: number; max: number; avg: number } | undefined;
}

export interface DataAnomaly {
  rowIndex: number;
  recordIdentifier: string;
  column: string;
  issue: string;
  currentValue: unknown;
  suggestedValue?: unknown | undefined;
}

export interface SpreadsheetAnalysisResult {
  rowCount: number;
  columnCount: number;
  columns: SpreadsheetColumnInfo[];
  anomalies: DataAnomaly[];
  summary: string;
}

export interface NonDestructiveEditResult {
  modifiedRowCount: number;
  totalRowCount: number;
  auditTrail: Array<{
    recordIdentifier: string;
    column: string;
    previousValue: unknown;
    updatedValue: unknown;
  }>;
  updatedRows: Array<Record<string, unknown>>;
  changeSummary: string;
}

/**
 * Normalizes status strings to canonical categories
 */
export function normalizeRecordStatus(rawStatus?: string): string {
  if (!rawStatus) return "unknown";
  const s = rawStatus.trim().toLowerCase();

  if (s.includes("complete") || s.includes("delivered") || s.includes("approved")) {
    return "completed";
  }
  if (s.includes("pending qc") || s.includes("qc pending") || s.includes("under review")) {
    return "pending_qc";
  }
  if (s.includes("pause") || s.includes("inactive") || s.includes("disabled")) {
    return "paused";
  }
  if (
    s.includes("active") ||
    /\blive\b/.test(s) ||
    s.includes("enabled") ||
    s.includes("running")
  ) {
    return "active";
  }
  if (s.includes("cancel") || s.includes("rejected") || s.includes("failed")) {
    return "cancelled";
  }
  return s.replace(/\s+/g, "_");
}

/**
 * Aggregates extracted records with deterministic math and deduplication
 */
export function aggregateRecords(
  records: DataRecord[],
  options?: {
    pagesInspected?: number;
    hasMorePages?: boolean;
    numericFields?: string[];
  },
): DataAggregationResult {
  const seenIds = new Set<string>();
  const uniqueList: DataRecord[] = [];
  let duplicates = 0;

  for (const r of records) {
    const key = r.id || `${r.title}_${r.date}_${r.amount}`;
    if (seenIds.has(key)) {
      duplicates++;
    } else {
      seenIds.add(key);
      uniqueList.push(r);
    }
  }

  // Count by status
  const statusCounts: Record<string, number> = {};
  for (const r of uniqueList) {
    const st = normalizeRecordStatus(r.status);
    statusCounts[st] = (statusCounts[st] || 0) + 1;
  }

  // Calculate numeric fields
  const numFields = options?.numericFields ?? ["amount"];
  const numericalSummaries: Record<string, { sum: number; avg: number; min: number; max: number }> =
    {};

  for (const field of numFields) {
    const values = uniqueList
      .map((r) => (r as unknown as Record<string, unknown>)[field] ?? r.raw[field])
      .filter((v): v is number => typeof v === "number" && !isNaN(v));

    if (values.length > 0) {
      const sum = values.reduce((a, b) => a + b, 0);
      numericalSummaries[field] = {
        sum: Math.round(sum * 100) / 100,
        avg: Math.round((sum / values.length) * 100) / 100,
        min: Math.min(...values),
        max: Math.max(...values),
      };
    }
  }

  const pagesInspected = options?.pagesInspected ?? 1;
  const isComplete = !options?.hasMorePages;

  return {
    totalRecords: records.length,
    uniqueRecords: uniqueList.length,
    duplicateCount: duplicates,
    statusCounts,
    numericalSummaries,
    coverageReport: {
      pagesInspected,
      isComplete,
      missingNotice: isComplete
        ? undefined
        : `Only ${pagesInspected} page(s) inspected. Additional records may exist on subsequent pages.`,
    },
  };
}

/**
 * Analyzes tabular data or spreadsheets, infers column schemas, and detects pricing anomalies
 */
export function analyzeSpreadsheetData(
  rows: Array<Record<string, unknown>>,
  options?: { idKey?: string; priceKeys?: string[] },
): SpreadsheetAnalysisResult {
  if (!rows || rows.length === 0) {
    return {
      rowCount: 0,
      columnCount: 0,
      columns: [],
      anomalies: [],
      summary: "Empty dataset provided.",
    };
  }

  const idCol = options?.idKey || "id";
  const priceColNames = options?.priceKeys || ["price", "amount", "mrp", "cost", "total"];
  const allKeys = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  const columns: SpreadsheetColumnInfo[] = [];
  const anomalies: DataAnomaly[] = [];

  for (const key of allKeys) {
    const values = rows.map((r) => r[key]);
    const nonNullValues = values.filter((v) => v !== null && v !== undefined && v !== "");
    const nullCount = values.length - nonNullValues.length;
    const uniqueCount = new Set(nonNullValues).size;
    const sampleValues = nonNullValues.slice(0, 3);

    let inferredType: ColumnType = "string";
    const numericValues: number[] = [];

    for (const v of nonNullValues) {
      if (typeof v === "number") {
        numericValues.push(v);
      } else if (typeof v === "string" && !isNaN(Number(v.replace(/[₹$,]/g, "")))) {
        numericValues.push(Number(v.replace(/[₹$,]/g, "")));
      }
    }

    if (numericValues.length > nonNullValues.length * 0.8) {
      inferredType = priceColNames.some((p) => key.toLowerCase().includes(p))
        ? "currency"
        : "numeric";
    } else if (key.toLowerCase().includes("status")) {
      inferredType = "status";
    } else if (key.toLowerCase().includes("date") || key.toLowerCase().includes("time")) {
      inferredType = "date";
    } else if (key.toLowerCase().includes("id") || key.toLowerCase().includes("sku")) {
      inferredType = "id";
    }

    let numericSummary;
    if (numericValues.length > 0) {
      const sum = numericValues.reduce((a, b) => a + b, 0);
      numericSummary = {
        sum: Math.round(sum * 100) / 100,
        min: Math.min(...numericValues),
        max: Math.max(...numericValues),
        avg: Math.round((sum / numericValues.length) * 100) / 100,
      };
    }

    columns.push({
      name: key,
      inferredType,
      nullCount,
      uniqueCount,
      sampleValues,
      numericSummary,
    });
  }

  // Scan for anomalies (e.g. negative prices, zero prices on active items)
  rows.forEach((row, idx) => {
    const rowId = String(row[idCol] || row["sku"] || row["title"] || `row_${idx + 1}`);

    for (const col of columns) {
      if (col.inferredType === "currency" || col.inferredType === "numeric") {
        const rawVal = row[col.name];
        const numVal =
          typeof rawVal === "number" ? rawVal : Number(String(rawVal || "").replace(/[₹$,]/g, ""));

        if (priceColNames.some((p) => col.name.toLowerCase().includes(p))) {
          if (!isNaN(numVal) && numVal <= 0) {
            anomalies.push({
              rowIndex: idx,
              recordIdentifier: rowId,
              column: col.name,
              issue: "Zero or negative price detected on commercial item",
              currentValue: rawVal,
            });
          }
        }
      }
    }
  });

  const summary = `Analyzed ${rows.length} rows across ${columns.length} columns. Detected ${anomalies.length} anomaly item(s).`;

  return {
    rowCount: rows.length,
    columnCount: columns.length,
    columns,
    anomalies,
    summary,
  };
}

/**
 * Non-destructively modifies only targeted cells in a dataset, preserving all unrelated rows & columns
 */
export function editSpreadsheetNonDestructively(
  rows: Array<Record<string, unknown>>,
  edits: Array<{
    matchKey: string;
    matchValue: unknown;
    targetColumn: string;
    newValue: unknown;
  }>,
): NonDestructiveEditResult {
  const auditTrail: NonDestructiveEditResult["auditTrail"] = [];
  const updatedRows = rows.map((originalRow) => {
    // Clone shallow to maintain unchanged fields
    const clonedRow = { ...originalRow };

    for (const edit of edits) {
      if (String(clonedRow[edit.matchKey]) === String(edit.matchValue)) {
        const prev = clonedRow[edit.targetColumn];
        if (prev !== edit.newValue) {
          clonedRow[edit.targetColumn] = edit.newValue;
          auditTrail.push({
            recordIdentifier: String(clonedRow[edit.matchKey]),
            column: edit.targetColumn,
            previousValue: prev,
            updatedValue: edit.newValue,
          });
        }
      }
    }
    return clonedRow;
  });

  const modifiedRowCount = new Set(auditTrail.map((a) => a.recordIdentifier)).size;
  const changeSummary = `Successfully updated ${auditTrail.length} cell(s) across ${modifiedRowCount} record(s). All other columns and rows preserved unchanged.`;

  return {
    modifiedRowCount,
    totalRowCount: rows.length,
    auditTrail,
    updatedRows,
    changeSummary,
  };
}

/**
 * Formats data records into standard CSV, JSON or Markdown report
 */
export function generateStructuredReport(
  records: DataRecord[],
  format: "csv" | "json" | "markdown" = "csv",
): string {
  if (!records || records.length === 0) return "";

  if (format === "json") {
    return JSON.stringify(records, null, 2);
  }

  const sample = records[0]!;
  const keys = Object.keys(sample.raw || sample).filter((k) => k !== "raw");

  if (format === "csv") {
    const header = keys.map((k) => `"${k}"`).join(",");
    const rows = records.map((r) => {
      const rowObj = (r.raw || r) as Record<string, unknown>;
      return keys.map((k) => `"${String(rowObj[k] ?? "").replace(/"/g, '""')}"`).join(",");
    });
    return [header, ...rows].join("\n");
  }

  // Markdown format
  const header = `| ${keys.join(" | ")} |`;
  const sep = `| ${keys.map(() => "---").join(" | ")} |`;
  const rows = records.map((r) => {
    const rowObj = (r.raw || r) as Record<string, unknown>;
    return `| ${keys.map((k) => String(rowObj[k] ?? "")).join(" | ")} |`;
  });
  return [header, sep, ...rows].join("\n");
}
