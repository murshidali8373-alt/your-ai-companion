import {
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Copy,
  Download,
  RotateCcw,
  Search,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  buildVerificationMarkdownReport,
  CHROME_VERIFICATION_CASES,
  createDefaultVerificationStore,
  loadVerificationStore,
  saveVerificationStore,
  summarizeVerificationStore,
  type TestResultStatus,
  type VerificationStore,
} from "@/lib/verification-cases";

type FilterTab = "all" | TestResultStatus;

function formatUpdatedTime(iso: string | null): string {
  if (!iso) return "Not tested yet";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Saved";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function VerificationDashboard() {
  const [store, setStore] = useState<VerificationStore>(() => createDefaultVerificationStore());
  const [hydrated, setHydrated] = useState(false);
  const [filter, setFilter] = useState<FilterTab>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const [copiedCommand, setCopiedCommand] = useState<string | null>(null);

  useEffect(() => {
    setStore(loadVerificationStore());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    saveVerificationStore(store);
  }, [store, hydrated]);

  const summary = useMemo(() => summarizeVerificationStore(store), [store]);

  const filteredCases = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return CHROME_VERIFICATION_CASES.filter((tc) => {
      const entry = store.entries[tc.id];
      const status = entry?.result ?? "pending";
      if (filter !== "all" && status !== filter) return false;
      if (!q) return true;
      const haystack = [
        tc.number,
        tc.title,
        tc.category,
        tc.summary,
        tc.expectedResult,
        ...tc.commands,
        ...tc.steps.map((s) => s.label),
        entry?.notes ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [filter, searchQuery, store.entries]);

  const updateEnvironment = (environment: string) => {
    setStore((prev) => ({
      ...prev,
      environment,
    }));
  };

  const updateResult = (caseId: string, result: TestResultStatus) => {
    setStore((prev) => {
      const current = prev.entries[caseId];
      if (!current) return prev;
      return {
        ...prev,
        entries: {
          ...prev.entries,
          [caseId]: {
            ...current,
            result,
            updatedAt: new Date().toISOString(),
          },
        },
      };
    });
  };

  const toggleStep = (caseId: string, stepId: string, checked: boolean) => {
    setStore((prev) => {
      const current = prev.entries[caseId];
      if (!current) return prev;
      return {
        ...prev,
        entries: {
          ...prev.entries,
          [caseId]: {
            ...current,
            checks: {
              ...current.checks,
              [stepId]: checked,
            },
            updatedAt: new Date().toISOString(),
          },
        },
      };
    });
  };

  const updateNotes = (caseId: string, notes: string) => {
    setStore((prev) => {
      const current = prev.entries[caseId];
      if (!current) return prev;
      return {
        ...prev,
        entries: {
          ...prev.entries,
          [caseId]: {
            ...current,
            notes,
            updatedAt: new Date().toISOString(),
          },
        },
      };
    });
  };

  const handleCopyReport = async () => {
    const report = buildVerificationMarkdownReport(store);
    try {
      await navigator.clipboard.writeText(report);
      toast.success("Verification report copied to clipboard.");
    } catch {
      toast.error("Could not copy automatically. Use Export JSON instead.");
    }
  };

  const handleExportJson = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      summary,
      ...store,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `ai-buddy-chrome-verification-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success("Verification log exported.");
  };

  const handleCopyCommand = async (cmd: string) => {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopiedCommand(cmd);
      setTimeout(() => {
        setCopiedCommand((prev) => (prev === cmd ? null : prev));
      }, 1500);
    } catch {
      toast.error("Could not copy command.");
    }
  };

  const handleResetAll = () => {
    const fresh = createDefaultVerificationStore();
    setStore(fresh);
    setConfirmReset(false);
    toast.success("All 6 test cases reset to pending.");
  };

  const stepCompletionPct =
    summary.totalSteps > 0 ? Math.round((summary.completedSteps / summary.totalSteps) * 100) : 0;

  return (
    <section aria-label="Chrome Verification Dashboard" className="space-y-6">
      {/* Top Toolbar & Summary Surface */}
      <div className="rounded-xl border border-border bg-card p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl space-y-1.5">
            <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold tracking-tight text-foreground">
              Desktop Chrome Verification Dashboard
            </h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Track real-browser execution across all 6 Chrome test suites. Check off verified
              behaviors, mark Pass or Fail, and record reproducible bug notes locally in your
              browser.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleCopyReport}
              className="whitespace-nowrap shrink-0 gap-1.5"
            >
              <Copy className="size-3.5" />
              Copy Report
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleExportJson}
              className="whitespace-nowrap shrink-0 gap-1.5"
            >
              <Download className="size-3.5" />
              Export JSON
            </Button>
            {confirmReset ? (
              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={handleResetAll}
                  className="whitespace-nowrap shrink-0"
                >
                  Confirm Reset
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmReset(false)}
                  className="whitespace-nowrap shrink-0"
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setConfirmReset(true)}
                className="whitespace-nowrap shrink-0 gap-1.5 text-muted-foreground hover:text-foreground"
              >
                <RotateCcw className="size-3.5" />
                Reset
              </Button>
            )}
          </div>
        </div>

        {/* Summary Metrics Grid — Single elevation, tabular numerals */}
        <div className="mt-6 grid grid-cols-2 gap-4 border-t border-border pt-5 sm:grid-cols-4">
          <div>
            <p className="text-xs text-muted-foreground">Passed Cases</p>
            <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-success">
              {summary.passed}
              <span className="text-sm font-normal text-muted-foreground">
                {" "}
                / {summary.totalCases}
              </span>
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Failed Cases</p>
            <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-destructive">
              {summary.failed}
              <span className="text-sm font-normal text-muted-foreground">
                {" "}
                / {summary.totalCases}
              </span>
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Pending Review</p>
            <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-foreground">
              {summary.pending}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Checklist Steps</p>
            <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-foreground">
              {summary.completedSteps}
              <span className="text-sm font-normal text-muted-foreground">
                {" "}
                / {summary.totalSteps} ({stepCompletionPct}%)
              </span>
            </p>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="mt-4">
          <div
            className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={stepCompletionPct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Verification checklist completion percentage"
          >
            <div
              className="h-full bg-primary transition-transform duration-200 origin-left"
              style={{ width: `${stepCompletionPct}%` }}
            />
          </div>
        </div>

        {/* Controls Bar: Environment + Filter Tabs + Search */}
        <div className="mt-5 flex flex-col gap-3 border-t border-border pt-5 md:flex-row md:items-center md:justify-between">
          <div
            className="flex flex-wrap items-center gap-1 rounded-lg bg-muted/60 p-1"
            role="group"
            aria-label="Filter test cases by status"
          >
            {(
              [
                { id: "all", label: `All (${summary.totalCases})` },
                { id: "pending", label: `Pending (${summary.pending})` },
                { id: "pass", label: `Passed (${summary.passed})` },
                { id: "fail", label: `Failed (${summary.failed})` },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilter(tab.id)}
                aria-pressed={filter === tab.id}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 tabular-nums ${
                  filter === tab.id
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="w-full sm:w-56">
              <label htmlFor="verification-env-input" className="sr-only">
                Browser and OS build notes
              </label>
              <Input
                id="verification-env-input"
                value={store.environment}
                onChange={(e) => updateEnvironment(e.target.value)}
                placeholder="Chrome version / OS (e.g. Chrome 134 · Win 11)"
                className="h-9 text-xs"
              />
            </div>
            <div className="relative w-full sm:w-56">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <label htmlFor="verification-search-input" className="sr-only">
                Search test cases or bug notes
              </label>
              <Input
                id="verification-search-input"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search tests or notes…"
                className="h-9 pl-8 text-xs"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Empty Search / Filter State */}
      {filteredCases.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-10 text-center">
          <ClipboardCheck className="mx-auto size-8 text-muted-foreground" />
          <h3 className="mt-3 text-base font-semibold text-foreground">
            No test cases match this filter
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Clear your search query or switch back to All to inspect all 6 Chrome verification
            suites.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => {
              setFilter("all");
              setSearchQuery("");
            }}
          >
            Show All Test Cases
          </Button>
        </div>
      ) : (
        /* 6 Test Case Cards — Single-elevation, hairline dividers, zero pill clutter */
        <div className="space-y-4">
          {filteredCases.map((tc) => {
            const entry = store.entries[tc.id] ?? {
              result: "pending" as TestResultStatus,
              checks: {},
              notes: "",
              updatedAt: null,
            };
            const checkedCount = tc.steps.filter((s) => entry.checks[s.id]).length;
            const notesId = `notes-${tc.id}`;

            return (
              <article
                key={tc.id}
                aria-labelledby={`heading-${tc.id}`}
                className="rounded-xl border border-border bg-card p-6"
              >
                {/* Header Row */}
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-mono font-medium tabular-nums text-foreground">
                        {tc.number}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{tc.category}</span>
                      <span aria-hidden="true">·</span>
                      <span className="tabular-nums">
                        {checkedCount}/{tc.steps.length} steps checked
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="tabular-nums">{formatUpdatedTime(entry.updatedAt)}</span>
                    </div>

                    <h3
                      id={`heading-${tc.id}`}
                      className="font-[family-name:var(--font-display)] text-lg font-semibold text-foreground"
                    >
                      {tc.title}
                    </h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">{tc.summary}</p>
                  </div>

                  {/* Pass / Fail / Pending Result Segmented Selector */}
                  <div className="shrink-0">
                    <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
                      Test Result
                    </span>
                    <div
                      role="group"
                      aria-label={`Result for ${tc.title}`}
                      className="inline-flex items-center gap-1 rounded-lg border border-border bg-muted/50 p-1"
                    >
                      <button
                        type="button"
                        aria-pressed={entry.result === "pending"}
                        onClick={() => updateResult(tc.id, "pending")}
                        className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                          entry.result === "pending"
                            ? "bg-card text-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        <Clock className="size-3.5" />
                        Pending
                      </button>
                      <button
                        type="button"
                        aria-pressed={entry.result === "pass"}
                        onClick={() => updateResult(tc.id, "pass")}
                        className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                          entry.result === "pass"
                            ? "bg-success text-success-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        <CheckCircle2 className="size-3.5" />
                        Pass
                      </button>
                      <button
                        type="button"
                        aria-pressed={entry.result === "fail"}
                        onClick={() => updateResult(tc.id, "fail")}
                        className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                          entry.result === "fail"
                            ? "bg-destructive text-destructive-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        <XCircle className="size-3.5" />
                        Fail
                      </button>
                    </div>
                  </div>
                </div>

                {/* Test Commands & Expected Behavior */}
                <div className="mt-5 grid gap-5 border-t border-border pt-5 lg:grid-cols-2">
                  <div className="space-y-4">
                    <div>
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Commands to Execute in Chrome
                      </h4>
                      <ul className="mt-2.5 divide-y divide-border rounded-lg border border-border bg-muted/25">
                        {tc.commands.map((cmd) => (
                          <li
                            key={cmd}
                            className="flex items-center justify-between gap-2 px-3 py-2 text-xs"
                          >
                            <code className="font-mono text-foreground break-words">{cmd}</code>
                            <button
                              type="button"
                              onClick={() => handleCopyCommand(cmd)}
                              aria-label={`Copy command: ${cmd}`}
                              className="shrink-0 rounded px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors whitespace-nowrap"
                            >
                              {copiedCommand === cmd ? "Copied" : "Copy"}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div>
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Expected Result
                      </h4>
                      <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
                        {tc.expectedResult}
                      </p>
                    </div>
                  </div>

                  {/* Verification Checklist + Bug / Observation Notes */}
                  <div className="space-y-4">
                    <div>
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Verification Checklist
                      </h4>
                      <ul className="mt-2.5 space-y-2.5">
                        {tc.steps.map((step) => {
                          const checkboxId = `${tc.id}-${step.id}`;
                          const isChecked = Boolean(entry.checks[step.id]);
                          return (
                            <li key={step.id} className="flex items-start gap-2.5">
                              <Checkbox
                                id={checkboxId}
                                checked={isChecked}
                                onCheckedChange={(val) => toggleStep(tc.id, step.id, val === true)}
                                className="mt-0.5"
                              />
                              <label
                                htmlFor={checkboxId}
                                className={`cursor-pointer text-sm leading-snug select-none ${
                                  isChecked
                                    ? "text-foreground"
                                    : "text-muted-foreground hover:text-foreground"
                                }`}
                              >
                                {step.label}
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                    </div>

                    <div>
                      <div className="flex items-center justify-between">
                        <label
                          htmlFor={notesId}
                          className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                        >
                          Notes &amp; Bugs Observed
                        </label>
                        {entry.notes.trim().length > 0 && (
                          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                            {entry.notes.length} chars
                          </span>
                        )}
                      </div>
                      <Textarea
                        id={notesId}
                        value={entry.notes}
                        onChange={(e) => updateNotes(tc.id, e.target.value)}
                        placeholder="Record exact response, DOM behavior, DevTools console errors, or failure steps..."
                        className="mt-2 min-h-[96px] bg-background text-sm"
                      />
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
