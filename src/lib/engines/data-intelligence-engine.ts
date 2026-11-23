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

export type ValueProvenance = "extracted" | "calculated" | "estimated" | "unknown";

export interface ProvenanceTaggedValue<T = unknown> {
  value: T;
  provenance: ValueProvenance;
  source?: string;
}

export function tagWithProvenance<T>(
  value: T,
  provenance: ValueProvenance,
  source?: string,
): ProvenanceTaggedValue<T> {
  return { value, provenance, source };
}

export interface MissingValuesReport {
  totalRows: number;
  columnsWithMissing: Array<{
    column: string;
    missingCount: number;
    missingRatio: number;
    sampleMissingRowIndices: number[];
  }>;
}

export function detectMissingValuesReport(
  rows: Array<Record<string, unknown>>,
): MissingValuesReport {
  if (!rows.length) return { totalRows: 0, columnsWithMissing: [] };
  const keys = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  const columnsWithMissing: MissingValuesReport["columnsWithMissing"] = [];

  for (const col of keys) {
    const missingIndices: number[] = [];
    rows.forEach((row, idx) => {
      const v = row[col];
      if (v === null || v === undefined || (typeof v === "string" && v.trim() === "")) {
        missingIndices.push(idx);
      }
    });
    if (missingIndices.length > 0) {
      columnsWithMissing.push({
        column: col,
        missingCount: missingIndices.length,
        missingRatio: Number((missingIndices.length / rows.length).toFixed(4)),
        sampleMissingRowIndices: missingIndices.slice(0, 10),
      });
    }
  }
  return { totalRows: rows.length, columnsWithMissing };
}

export interface StatisticalOutlier {
  rowIndex: number;
  recordId: string;
  column: string;
  value: number;
  method: "iqr" | "zscore";
  bounds: { lower: number; upper: number };
  provenance: "calculated";
}

export function detectStatisticalOutliers(
  rows: Array<Record<string, unknown>>,
  numericColumn: string,
  options?: { idKey?: string; zThreshold?: number },
): StatisticalOutlier[] {
  const idKey = options?.idKey || "id";
  const zThreshold = options?.zThreshold ?? 2.0;
  const pts: Array<{ rowIndex: number; recordId: string; value: number }> = [];

  rows.forEach((row, idx) => {
    const raw = row[numericColumn];
    const num =
      typeof raw === "number"
        ? raw
        : typeof raw === "string" && raw.trim() !== ""
          ? Number(raw.replace(/[₹$,]/g, ""))
          : NaN;
    if (!Number.isNaN(num) && Number.isFinite(num)) {
      pts.push({
        rowIndex: idx,
        recordId: String(row[idKey] ?? row["sku"] ?? `row_${idx + 1}`),
        value: num,
      });
    }
  });

  if (pts.length < 4) return [];

  const sorted = [...pts].map((p) => p.value).sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)]!;
  const q3 = sorted[Math.floor(sorted.length * 0.75)]!;
  const iqr = q3 - q1;

  const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  const variance = sorted.reduce((acc, v) => acc + (v - mean) ** 2, 0) / sorted.length;
  const stdDev = Math.sqrt(variance);

  const outliers: StatisticalOutlier[] = [];
  if (iqr > 0) {
    const lower = Number((q1 - 1.5 * iqr).toFixed(2));
    const upper = Number((q3 + 1.5 * iqr).toFixed(2));
    for (const p of pts) {
      if (p.value < lower || p.value > upper) {
        outliers.push({
          rowIndex: p.rowIndex,
          recordId: p.recordId,
          column: numericColumn,
          value: p.value,
          method: "iqr",
          bounds: { lower, upper },
          provenance: "calculated",
        });
      }
    }
  } else if (stdDev > 0) {
    const lower = Number((mean - zThreshold * stdDev).toFixed(2));
    const upper = Number((mean + zThreshold * stdDev).toFixed(2));
    for (const p of pts) {
      const z = Math.abs((p.value - mean) / stdDev);
      if (z >= zThreshold) {
        outliers.push({
          rowIndex: p.rowIndex,
          recordId: p.recordId,
          column: numericColumn,
          value: p.value,
          method: "zscore",
          bounds: { lower, upper },
          provenance: "calculated",
        });
      }
    }
  }
  return outliers;
}

export interface FilterRule {
  column: string;
  operator: "eq" | "neq" | "contains" | "gt" | "gte" | "lt" | "lte";
  value: unknown;
}

export function filterSortGroupRecords(
  rows: Array<Record<string, unknown>>,
  params: {
    filters?: FilterRule[];
    sortBy?: { column: string; direction?: "asc" | "desc" };
    groupBy?: string;
    numericSumColumn?: string;
  },
): {
  filteredRows: Array<Record<string, unknown>>;
  groups: Array<{
    groupKey: string;
    count: number;
    sum?: number;
    avg?: number;
    provenance: "calculated";
  }>;
  provenance: "calculated";
} {
  let current = [...rows];

  if (params.filters && params.filters.length > 0) {
    current = current.filter((row) =>
      params.filters!.every((f) => {
        const cell = row[f.column];
        if (f.operator === "eq")
          return String(cell ?? "").toLowerCase() === String(f.value ?? "").toLowerCase();
        if (f.operator === "neq")
          return String(cell ?? "").toLowerCase() !== String(f.value ?? "").toLowerCase();
        if (f.operator === "contains") {
          return String(cell ?? "")
            .toLowerCase()
            .includes(String(f.value ?? "").toLowerCase());
        }
        const nCell = Number(cell);
        const nVal = Number(f.value);
        if (Number.isNaN(nCell) || Number.isNaN(nVal)) return false;
        if (f.operator === "gt") return nCell > nVal;
        if (f.operator === "gte") return nCell >= nVal;
        if (f.operator === "lt") return nCell < nVal;
        if (f.operator === "lte") return nCell <= nVal;
        return true;
      }),
    );
  }

  if (params.sortBy) {
    const { column, direction = "asc" } = params.sortBy;
    const factor = direction === "desc" ? -1 : 1;
    current.sort((a, b) => {
      const av = a[column];
      const bv = b[column];
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * factor;
      return String(av ?? "").localeCompare(String(bv ?? "")) * factor;
    });
  }

  const groups: Array<{
    groupKey: string;
    count: number;
    sum?: number;
    avg?: number;
    provenance: "calculated";
  }> = [];

  if (params.groupBy) {
    const map = new Map<string, Array<Record<string, unknown>>>();
    for (const r of current) {
      const k = String(r[params.groupBy] ?? "unknown");
      const list = map.get(k) ?? [];
      list.push(r);
      map.set(k, list);
    }
    for (const [groupKey, items] of map.entries()) {
      let sum: number | undefined;
      let avg: number | undefined;
      if (params.numericSumColumn) {
        const nums = items
          .map((x) => Number(x[params.numericSumColumn!]))
          .filter((n) => !Number.isNaN(n));
        if (nums.length > 0) {
          sum = Number(nums.reduce((a, b) => a + b, 0).toFixed(2));
          avg = Number((sum / nums.length).toFixed(2));
        }
      }
      groups.push({ groupKey, count: items.length, sum, avg, provenance: "calculated" });
    }
  }

  return { filteredRows: current, groups, provenance: "calculated" };
}

export interface BusinessMetricValue {
  value: number;
  formula: string;
  sourceColumns: string[];
  provenance: "calculated";
}

export interface BusinessMetricsReport {
  rowCount: number;
  metrics: {
    revenue?: BusinessMetricValue | undefined;
    cost?: BusinessMetricValue | undefined;
    grossProfit?: BusinessMetricValue | undefined;
    netProfit?: BusinessMetricValue | undefined;
    marginPercent?: BusinessMetricValue | undefined;
    returnRatePercent?: BusinessMetricValue | undefined;
    totalUnits?: BusinessMetricValue | undefined;
    inventoryTurnover?: BusinessMetricValue | undefined;
  };
  lowStockSkus: Array<{ sku: string; stock: number; threshold: number }>;
  columnProvenance: Record<string, { role: string; rowMatches: number }>;
  missingMetrics: Array<{ metric: string; reason: string }>;
  missingColumns: string[];
  summary: string;
}

function parseNumericCell(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const cleaned = v.replace(/[₹$,%\s,]/g, "").trim();
    if (!cleaned) return null;
    const n = Number(cleaned);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function findMatchingColumn(keys: string[], candidates: string[]): string | undefined {
  const lowerMap = new Map(keys.map((k) => [k.toLowerCase().trim(), k]));
  for (const c of candidates) {
    const exact = lowerMap.get(c);
    if (exact) return exact;
  }
  for (const k of keys) {
    const kl = k.toLowerCase();
    if (candidates.some((c) => kl.includes(c))) return k;
  }
  return undefined;
}

/**
 * Deterministic Business Intelligence KPI calculator.
 * Never invents or estimates COGS/cost/tax columns when absent; reports missingColumns honestly.
 */
export function computeBusinessMetrics(
  rows: Array<Record<string, unknown>>,
  options?: {
    revenueColumn?: string | undefined;
    costColumn?: string | undefined;
    expenseColumn?: string | undefined;
    quantityColumn?: string | undefined;
    stockColumn?: string | undefined;
    statusColumn?: string | undefined;
    skuColumn?: string | undefined;
    lowStockThreshold?: number | undefined;
  },
): BusinessMetricsReport {
  if (!rows || rows.length === 0) {
    return {
      rowCount: 0,
      metrics: {},
      lowStockSkus: [],
      columnProvenance: {},
      missingMetrics: [{ metric: "all", reason: "No rows provided for business KPI analysis." }],
      missingColumns: ["revenue", "cost", "quantity", "stock", "status"],
      summary: "No rows supplied for business KPI computation.",
    };
  }

  const allKeys = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  const revCol =
    options?.revenueColumn ??
    findMatchingColumn(allKeys, [
      "revenue",
      "sales",
      "total_amount",
      "amount",
      "price",
      "gross_sales",
    ]);
  const costCol =
    options?.costColumn ?? findMatchingColumn(allKeys, ["cogs", "cost_price", "unit_cost", "cost"]);
  const expCol =
    options?.expenseColumn ??
    findMatchingColumn(allKeys, ["expense", "operating_expense", "fee", "shipping_cost"]);
  const qtyCol =
    options?.quantityColumn ??
    findMatchingColumn(allKeys, ["quantity", "qty", "units", "units_sold"]);
  const stockCol =
    options?.stockColumn ??
    findMatchingColumn(allKeys, ["stock", "inventory", "on_hand", "stock_qty"]);
  const statusCol =
    options?.statusColumn ?? findMatchingColumn(allKeys, ["status", "order_status", "state"]);
  const skuCol =
    options?.skuColumn ?? findMatchingColumn(allKeys, ["sku", "product_id", "item_id", "id"]);
  const threshold = options?.lowStockThreshold ?? 10;

  const columnProvenance: Record<string, { role: string; rowMatches: number }> = {};
  const missingColumns: string[] = [];
  const missingMetrics: Array<{ metric: string; reason: string }> = [];
  const metrics: BusinessMetricsReport["metrics"] = {};

  const sumCol = (col: string, role: string): { total: number; matches: number } => {
    let total = 0;
    let matches = 0;
    for (const r of rows) {
      const n = parseNumericCell(r[col]);
      if (n !== null) {
        total += n;
        matches++;
      }
    }
    columnProvenance[col] = { role, rowMatches: matches };
    return { total: Number(total.toFixed(2)), matches };
  };

  let revTotal: number | null = null;
  if (revCol) {
    const res = sumCol(revCol, "revenue");
    if (res.matches > 0) {
      revTotal = res.total;
      metrics.revenue = {
        value: revTotal,
        formula: `SUM(${revCol})`,
        sourceColumns: [revCol],
        provenance: "calculated",
      };
    }
  } else {
    missingColumns.push("revenue");
    missingMetrics.push({ metric: "revenue", reason: "No revenue/sales/amount column found." });
  }

  let costTotal: number | null = null;
  if (costCol) {
    const res = sumCol(costCol, "cost");
    if (res.matches > 0) {
      costTotal = res.total;
      metrics.cost = {
        value: costTotal,
        formula: `SUM(${costCol})`,
        sourceColumns: [costCol],
        provenance: "calculated",
      };
    }
  } else {
    missingColumns.push("cost");
    missingMetrics.push({
      metric: "cost",
      reason: "No cost/COGS column found; refusing to estimate cost.",
    });
  }

  let expTotal = 0;
  if (expCol && expCol !== costCol) {
    const res = sumCol(expCol, "expense");
    expTotal = res.total;
  }

  if (revTotal !== null && costTotal !== null) {
    const grossProfit = Number((revTotal - costTotal).toFixed(2));
    metrics.grossProfit = {
      value: grossProfit,
      formula: `SUM(${revCol}) - SUM(${costCol})`,
      sourceColumns: [revCol!, costCol!],
      provenance: "calculated",
    };

    const netProfit = Number((grossProfit - expTotal).toFixed(2));
    metrics.netProfit = {
      value: netProfit,
      formula:
        expCol && expCol !== costCol
          ? `SUM(${revCol}) - SUM(${costCol}) - SUM(${expCol})`
          : `SUM(${revCol}) - SUM(${costCol})`,
      sourceColumns:
        expCol && expCol !== costCol ? [revCol!, costCol!, expCol] : [revCol!, costCol!],
      provenance: "calculated",
    };

    if (revTotal !== 0) {
      metrics.marginPercent = {
        value: Number(((grossProfit / revTotal) * 100).toFixed(2)),
        formula: `(grossProfit / revenue) * 100`,
        sourceColumns: [revCol!, costCol!],
        provenance: "calculated",
      };
    } else {
      missingMetrics.push({ metric: "marginPercent", reason: "Total revenue is 0." });
    }
  } else {
    if (revTotal === null || costTotal === null) {
      missingMetrics.push({
        metric: "grossProfit",
        reason: "Requires both revenue and cost/COGS columns.",
      });
      missingMetrics.push({
        metric: "marginPercent",
        reason: "Requires both revenue and cost/COGS columns.",
      });
    }
  }

  let unitsTotal: number | null = null;
  if (qtyCol) {
    const res = sumCol(qtyCol, "quantity");
    if (res.matches > 0) {
      unitsTotal = res.total;
      metrics.totalUnits = {
        value: unitsTotal,
        formula: `SUM(${qtyCol})`,
        sourceColumns: [qtyCol],
        provenance: "calculated",
      };
    }
  } else {
    missingColumns.push("quantity");
  }

  if (statusCol) {
    let returned = 0;
    let totalStatus = 0;
    for (const r of rows) {
      const rawSt = r[statusCol];
      if (rawSt !== undefined && rawSt !== null && String(rawSt).trim() !== "") {
        totalStatus++;
        if (/\b(?:return|returned|rto|refund|refunded)\b/i.test(String(rawSt))) {
          returned++;
        }
      }
    }
    columnProvenance[statusCol] = { role: "status", rowMatches: totalStatus };
    if (totalStatus > 0) {
      metrics.returnRatePercent = {
        value: Number(((returned / totalStatus) * 100).toFixed(2)),
        formula: `(COUNT(status IN [return,rto,refund]) / COUNT(status)) * 100`,
        sourceColumns: [statusCol],
        provenance: "calculated",
      };
    }
  } else {
    missingColumns.push("status");
    missingMetrics.push({ metric: "returnRatePercent", reason: "No status column found." });
  }

  const lowStockSkus: Array<{ sku: string; stock: number; threshold: number }> = [];
  if (stockCol) {
    const res = sumCol(stockCol, "stock");
    rows.forEach((r, idx) => {
      const stk = parseNumericCell(r[stockCol]);
      if (stk !== null && stk <= threshold) {
        const skuVal = skuCol ? String(r[skuCol] ?? `row_${idx + 1}`) : `row_${idx + 1}`;
        lowStockSkus.push({ sku: skuVal, stock: stk, threshold });
      }
    });
    const avgInv = res.matches > 0 ? res.total / res.matches : 0;
    const turnoverNumerator = costTotal ?? unitsTotal;
    if (turnoverNumerator !== null && avgInv > 0) {
      metrics.inventoryTurnover = {
        value: Number((turnoverNumerator / avgInv).toFixed(2)),
        formula: `${costTotal !== null ? `SUM(${costCol})` : `SUM(${qtyCol})`} / AVG(${stockCol})`,
        sourceColumns: [costTotal !== null ? costCol! : qtyCol!, stockCol],
        provenance: "calculated",
      };
    } else {
      missingMetrics.push({
        metric: "inventoryTurnover",
        reason: "Requires positive average stock plus cost or units sold.",
      });
    }
  } else {
    missingColumns.push("stock");
    missingMetrics.push({
      metric: "inventoryTurnover",
      reason: "No stock/inventory column found.",
    });
  }

  const computedNames = Object.keys(metrics);
  const summary =
    `Computed ${computedNames.length} KPI(s) across ${rows.length} row(s)` +
    (lowStockSkus.length > 0 ? `; ${lowStockSkus.length} low-stock SKU(s)` : "") +
    (missingColumns.length > 0 ? `; missing columns: ${missingColumns.join(", ")}` : "") +
    ".";

  return {
    rowCount: rows.length,
    metrics,
    lowStockSkus,
    columnProvenance,
    missingMetrics,
    missingColumns,
    summary,
  };
}

export interface PeriodComparisonDelta {
  metric: string;
  previous: number;
  current: number;
  delta: number;
  percentChange: number | null;
  provenance: "calculated";
}

export function compareBusinessPeriods(
  currentRows: Array<Record<string, unknown>>,
  previousRows: Array<Record<string, unknown>>,
  options?: Parameters<typeof computeBusinessMetrics>[1],
): {
  current: BusinessMetricsReport;
  previous: BusinessMetricsReport;
  deltas: PeriodComparisonDelta[];
  uncomparableMetrics: string[];
  summary: string;
} {
  const current = computeBusinessMetrics(currentRows, options);
  const previous = computeBusinessMetrics(previousRows, options);
  const keys = [
    "revenue",
    "cost",
    "grossProfit",
    "netProfit",
    "marginPercent",
    "returnRatePercent",
    "totalUnits",
    "inventoryTurnover",
  ] as const;

  const deltas: PeriodComparisonDelta[] = [];
  const uncomparableMetrics: string[] = [];

  for (const k of keys) {
    const curVal = current.metrics[k]?.value;
    const prevVal = previous.metrics[k]?.value;
    if (typeof curVal === "number" && typeof prevVal === "number") {
      const delta = Number((curVal - prevVal).toFixed(2));
      const percentChange =
        prevVal !== 0 ? Number((((curVal - prevVal) / Math.abs(prevVal)) * 100).toFixed(2)) : null;
      deltas.push({
        metric: k,
        previous: prevVal,
        current: curVal,
        delta,
        percentChange,
        provenance: "calculated",
      });
    } else {
      uncomparableMetrics.push(k);
    }
  }

  return {
    current,
    previous,
    deltas,
    uncomparableMetrics,
    summary: `Compared ${deltas.length} metric(s) between previous (${previous.rowCount} rows) and current (${current.rowCount} rows) periods.`,
  };
}
