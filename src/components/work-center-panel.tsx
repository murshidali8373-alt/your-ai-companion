/**
 * AI BUDDY 2.0 — UNIFIED WORK CENTER (Phase 3 + Phase 4)
 *
 * Connects the authenticated web dashboard to:
 * 1. Autonomous Multi-Agent Objective Runner & Live Parallel DAG Monitor (15 Agents, Pause/Resume/Cancel/Retry/Approve)
 * 2. Real File Workspace (Upload CSV/TSV/TXT/JSON/XLSX/DOCX/PDF, inspect rows/provenance, generate & download verified XLSX/DOCX/PDF reports)
 * 3. Connected Apps Health & OAuth/Credential Verification
 * 4. Persistent Workflows & Croner Natural Language Builder
 * 5. Proactive Intelligence Suggestions & Approval-Gated Drafts
 * 6. 8-Category Long-Term Memory Conflict & Staleness Inspector
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  Bot,
  CalendarClock,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileText,
  Lightbulb,
  Link2,
  Pause,
  Play,
  RefreshCw,
  ShieldAlert,
  SkipForward,
  Square,
  Trash2,
  Upload,
} from "lucide-react";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  approveWebDraft,
  compileOrSaveWebWorkflow,
  controlWebDagRun,
  deleteWebWorkspaceFile,
  generateWebReportArtifact,
  getPhase4WorkCenterOverview,
  runWebMultiAgentObjective,
  testWebConnector,
  uploadAndAnalyzeWorkspaceFile,
} from "@/lib/app.functions";

function triggerBase64Download(fileName: string, base64: string, mimeType: string) {
  const byteChars = atob(base64);
  const bytes = new Uint8Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) {
    bytes[i] = byteChars.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function WorkCenterPanel() {
  const queryClient = useQueryClient();
  const fetchOverview = useServerFn(getPhase4WorkCenterOverview);
  const execObjective = useServerFn(runWebMultiAgentObjective);
  const ctrlDag = useServerFn(controlWebDagRun);
  const uploadFileFn = useServerFn(uploadAndAnalyzeWorkspaceFile);
  const deleteFileFn = useServerFn(deleteWebWorkspaceFile);
  const genReportFn = useServerFn(generateWebReportArtifact);
  const workflowFn = useServerFn(compileOrSaveWebWorkflow);
  const testConnFn = useServerFn(testWebConnector);
  const approveDraftFn = useServerFn(approveWebDraft);

  const overview = useQuery({
    queryKey: ["phase4-work-center"],
    queryFn: () => fetchOverview(),
    refetchInterval: (q) =>
      q.state.data?.dagRuns.some((r) => r.status === "running") ? 800 : false,
  });

  const [objective, setObjective] = useState("");
  const [outputFormat, setOutputFormat] = useState<"none" | "xlsx" | "docx" | "pdf">("xlsx");
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  const [workspaceFeedback, setWorkspaceFeedback] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);
  const [pendingDeleteFileName, setPendingDeleteFileName] = useState<string | null>(null);
  const [deletingFileName, setDeletingFileName] = useState<string | null>(null);
  const [parsedDoc, setParsedDoc] = useState<{
    fileName: string;
    format: string;
    rowCount: number;
    rows?: Array<Record<string, unknown>>;
    warnings: string[];
    summaryText?: string;
  } | null>(null);

  const [nlWorkflowInput, setNlWorkflowInput] = useState("");
  const [pendingDeleteWorkflowId, setPendingDeleteWorkflowId] = useState<string | null>(null);
  const [busyWorkflowId, setBusyWorkflowId] = useState<string | null>(null);
  const [testingConnectorId, setTestingConnectorId] = useState<string | null>(null);
  const [approvingDraftId, setApprovingDraftId] = useState<string | null>(null);
  const [compiledPreview, setCompiledPreview] = useState<{
    name: string;
    description: string;
    triggerType: "cron" | "interval" | "one_time" | "event" | "manual";
    cronExpression?: string;
    steps: unknown[];
    missingParameters: string[];
    previewSummary: string;
  } | null>(null);

  const runDag = useMutation({
    mutationFn: () =>
      execObjective({
        data: {
          objective: objective.trim(),
          fileName: parsedDoc?.fileName,
          rows: parsedDoc?.rows,
          outputFormats: outputFormat === "none" ? undefined : [outputFormat],
          asyncMode: true,
        },
      }),
    onSuccess: (run) => {
      setObjective("");
      toast.success(`Multi-agent run ${run.status}: ${run.subtasks.length} subtask(s).`);
      queryClient.invalidateQueries({ queryKey: ["phase4-work-center"] });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Could not run multi-agent objective.");
    },
  });

  const controlDag = useMutation({
    mutationFn: (vars: {
      runId: string;
      action: "pause" | "resume" | "cancel" | "retry_failed" | "approve_step" | "skip_step";
      subtaskId?: string;
    }) => ctrlDag({ data: vars }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["phase4-work-center"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "DAG control failed."),
  });

  const handleFileUpload = async (file: File | undefined) => {
    if (!file || isUploadingFile) return;
    setIsUploadingFile(true);
    setWorkspaceFeedback(null);
    const reader = new FileReader();
    reader.onerror = () => {
      setIsUploadingFile(false);
      setWorkspaceFeedback({ kind: "error", text: `Could not read "${file.name}".` });
      toast.error(`Could not read "${file.name}".`);
    };
    reader.onload = async () => {
      try {
        const resultStr = typeof reader.result === "string" ? reader.result : "";
        const res = await uploadFileFn({
          data: {
            fileName: file.name,
            mimeType: file.type || "application/octet-stream",
            base64Data: resultStr,
          },
        });
        setParsedDoc({
          fileName: res.fileName,
          format: res.format,
          rowCount: res.rows?.length ?? 0,
          rows: res.rows,
          warnings: res.warnings,
          summaryText: res.spreadsheetAnalysis?.summary || res.textContent?.slice(0, 400),
        });
        setWorkspaceFeedback({
          kind: "success",
          text: `Uploaded and parsed ${res.fileName} (${res.format.toUpperCase()}).`,
        });
        toast.success(`Parsed ${res.fileName} (${res.format.toUpperCase()}).`);
        queryClient.invalidateQueries({ queryKey: ["phase4-work-center"] });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to parse uploaded file.";
        setWorkspaceFeedback({ kind: "error", text: message });
        toast.error(message);
      } finally {
        setIsUploadingFile(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const generateReport = useMutation({
    mutationFn: (format: "xlsx" | "docx" | "pdf") =>
      genReportFn({
        data: {
          format,
          title: parsedDoc ? `Workspace Audit: ${parsedDoc.fileName}` : "AI Buddy Workspace Report",
          summary: parsedDoc?.summaryText || "Generated directly from AI Buddy File Workspace.",
          rows: parsedDoc?.rows,
          sections: [
            {
              heading: "Source Summary",
              bullets: [
                parsedDoc
                  ? `File: ${parsedDoc.fileName} (${parsedDoc.rowCount} rows)`
                  : "Report compiled from active Work Center session.",
              ],
            },
          ],
        },
      }),
    onSuccess: (res) => {
      triggerBase64Download(res.fileName, res.base64Output, res.mimeType);
      toast.success(
        res.verified
          ? `Downloaded & verified ${res.fileName}`
          : `Downloaded ${res.fileName} (check verification note)`,
      );
      queryClient.invalidateQueries({ queryKey: ["phase4-work-center"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Report generation failed."),
  });

  const compileWorkflow = useMutation({
    mutationFn: () =>
      workflowFn({ data: { mode: "compile", instruction: nlWorkflowInput.trim() } }),
    onSuccess: (res) => {
      if (res.mode === "compile") {
        setCompiledPreview({
          name: res.compiled.draftRecipe.name,
          description: res.compiled.draftRecipe.description,
          triggerType: res.compiled.triggerType,
          cronExpression: res.compiled.cronExpression,
          steps: res.compiled.draftRecipe.steps,
          missingParameters: res.compiled.missingParameters,
          previewSummary: res.compiled.previewSummary,
        });
      }
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Could not compile workflow."),
  });

  const saveWorkflow = useMutation({
    mutationFn: () => {
      if (!compiledPreview) throw new Error("Compile a workflow first.");
      return workflowFn({
        data: {
          mode: "save",
          name: compiledPreview.name,
          description: compiledPreview.description,
          triggerType: compiledPreview.triggerType,
          cronExpression: compiledPreview.cronExpression,
          steps: compiledPreview.steps,
          approvedByUser: true,
        },
      });
    },
    onSuccess: () => {
      setCompiledPreview(null);
      setNlWorkflowInput("");
      toast.success("Workflow confirmed, saved, and scheduled.");
      queryClient.invalidateQueries({ queryKey: ["phase4-work-center"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not save workflow."),
  });

  const data = overview.data;

  return (
    <div className="space-y-6">
      {overview.isError && (
        <div
          role="alert"
          className="panel p-4 border-destructive/40 bg-destructive/10 flex flex-wrap items-center justify-between gap-2 text-xs"
        >
          <span className="text-foreground">
            Could not load Work Center data. Check your session or network connection.
          </span>
          <Button size="sm" variant="outline" onClick={() => overview.refetch()}>
            Retry
          </Button>
        </div>
      )}

      {/* Row 1: Autonomous Multi-Agent Objective & Live Parallel DAG Monitor */}
      <section className="panel p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold flex items-center gap-2">
              <Bot className="size-4 text-primary" />
              Autonomous Multi-Agent Orchestrator
            </h2>
            <p className="text-xs text-muted-foreground">
              Automatically selects among {data?.agents.length ?? 15} specialized agents and runs
              independent subtasks in parallel.
            </p>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => overview.refetch()}
            disabled={overview.isFetching}
          >
            <RefreshCw className="mr-1.5 size-3.5" />
            Refresh
          </Button>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Textarea
            rows={2}
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            placeholder="Describe a complete objective (e.g., Audit uploaded pricing sheet, detect outliers, and generate a verified XLSX report)"
            className="flex-1 text-sm"
          />
          <div className="flex flex-col gap-2 sm:w-44">
            <select
              aria-label="Deliverable export format"
              value={outputFormat}
              onChange={(e) => setOutputFormat(e.target.value as typeof outputFormat)}
              className="h-9 rounded-md border border-border bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="xlsx">Export XLSX</option>
              <option value="docx">Export DOCX</option>
              <option value="pdf">Export PDF</option>
              <option value="none">Report Only</option>
            </select>
            <Button
              onClick={() => runDag.mutate()}
              disabled={runDag.isPending || objective.trim().length < 2}
              size="sm"
            >
              {runDag.isPending ? "Executing DAG…" : "Run Objective"}
            </Button>
          </div>
        </div>

        {/* Live DAG Runs */}
        <div className="space-y-3">
          {!data || data.dagRuns.length === 0 ? (
            <p className="text-xs text-muted-foreground border border-dashed border-border rounded-md p-3">
              No multi-agent DAG runs recorded yet. Submit an objective above to see live subtasks,
              checkpoints, and verification checks.
            </p>
          ) : (
            data.dagRuns.slice(0, 3).map((run) => {
              const completedCount = run.subtasks.filter((s) => s.status === "completed").length;
              const skippedCount = run.subtasks.filter((s) => s.status === "skipped").length;
              const hasFailed = run.subtasks.some((s) => s.status === "failed");
              return (
                <div key={run.runId} className="rounded-md border border-border p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{run.objective}</p>
                      <p className="text-[11px] text-muted-foreground font-mono tabular-nums">
                        Agents: {run.selectedAgents.join(", ")} · Progress: {completedCount}/
                        {run.subtasks.length} done
                        {skippedCount > 0 ? ` (${skippedCount} skipped)` : ""} · Checkpoints:{" "}
                        {run.checkpoints.length}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Badge
                        variant={
                          run.status === "failed"
                            ? "destructive"
                            : run.status === "completed"
                              ? "secondary"
                              : "outline"
                        }
                        className="uppercase text-[10px]"
                      >
                        {run.status}
                      </Badge>
                      {run.status === "running" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs"
                          disabled={controlDag.isPending}
                          onClick={() => controlDag.mutate({ runId: run.runId, action: "pause" })}
                        >
                          <Pause className="size-3 mr-1" />
                          Pause
                        </Button>
                      )}
                      {run.status === "paused" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs"
                          disabled={controlDag.isPending}
                          onClick={() => controlDag.mutate({ runId: run.runId, action: "resume" })}
                        >
                          <Play className="size-3 mr-1" />
                          Resume
                        </Button>
                      )}
                      {hasFailed && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs"
                          disabled={controlDag.isPending}
                          onClick={() =>
                            controlDag.mutate({ runId: run.runId, action: "retry_failed" })
                          }
                        >
                          <RefreshCw className="size-3 mr-1" />
                          Retry Failed
                        </Button>
                      )}
                      {run.status !== "completed" && run.status !== "cancelled" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs"
                          disabled={controlDag.isPending}
                          onClick={() => controlDag.mutate({ runId: run.runId, action: "cancel" })}
                        >
                          <Square className="size-3 mr-1" />
                          Cancel
                        </Button>
                      )}
                    </div>
                  </div>

                  {run.unconfirmedStopNote && (
                    <p className="rounded border border-warning/40 bg-warning/10 px-2.5 py-1.5 text-[11px] text-foreground">
                      {run.unconfirmedStopNote}
                    </p>
                  )}

                  <ul className="grid gap-1.5 sm:grid-cols-2">
                    {run.subtasks.map((st) => {
                      const canSkip =
                        st.status === "pending" ||
                        st.status === "ready" ||
                        st.status === "paused" ||
                        st.status === "awaiting_approval" ||
                        st.status === "failed";
                      return (
                        <li
                          key={st.id}
                          className="flex items-center justify-between gap-2 rounded border border-border/70 px-2.5 py-1.5 text-xs"
                        >
                          <span className="truncate">
                            <span className="font-mono text-[10px] text-muted-foreground mr-1.5">
                              [{st.agentId}]
                            </span>
                            {st.title}
                          </span>
                          <span className="shrink-0 flex items-center gap-1.5">
                            {st.status === "awaiting_approval" && (
                              <Button
                                size="sm"
                                variant="secondary"
                                className="h-6 px-2 text-[10px]"
                                disabled={controlDag.isPending}
                                onClick={() =>
                                  controlDag.mutate({
                                    runId: run.runId,
                                    action: "approve_step",
                                    subtaskId: st.id,
                                  })
                                }
                              >
                                Approve
                              </Button>
                            )}
                            {canSkip &&
                              run.status !== "completed" &&
                              run.status !== "cancelled" && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 px-1.5 text-[10px]"
                                  disabled={controlDag.isPending}
                                  title="Skip subtask (blocked if downstream steps depend on it)"
                                  onClick={() =>
                                    controlDag.mutate({
                                      runId: run.runId,
                                      action: "skip_step",
                                      subtaskId: st.id,
                                    })
                                  }
                                >
                                  <SkipForward className="size-3 mr-0.5" />
                                  Skip
                                </Button>
                              )}
                            <Badge variant="outline" className="text-[10px]">
                              {st.status}
                            </Badge>
                          </span>
                        </li>
                      );
                    })}
                  </ul>

                  {run.artifacts.length > 0 && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {run.artifacts.map((art) => (
                        <span
                          key={art.id}
                          className="inline-flex items-center gap-1.5 rounded border border-border px-2.5 py-1 text-xs"
                        >
                          <CheckCircle2 className="size-3.5 text-primary" />
                          {art.fileName || art.title}
                          {art.verified && (
                            <span className="text-[10px] text-muted-foreground">(verified)</span>
                          )}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* Row 2: Real File Workspace + Persistent Workflows */}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="panel p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <FileSpreadsheet className="size-4 text-primary" />
              Real File Workspace (CSV, XLSX, DOCX, PDF, JSON)
            </h2>
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {(data?.files ?? []).length} file(s)
            </span>
          </div>
          <label
            className={`flex items-center justify-center gap-2 rounded-md border border-dashed border-border p-4 text-xs text-muted-foreground transition-colors ${
              isUploadingFile
                ? "cursor-wait opacity-70"
                : "cursor-pointer hover:border-foreground/40"
            }`}
          >
            <Upload className="size-4" />
            <span>
              {isUploadingFile
                ? "Uploading and analyzing file…"
                : "Upload CSV, TSV, TXT, JSON, XLSX, DOCX, or PDF to parse & analyze"}
            </span>
            <input
              type="file"
              aria-label="Upload workspace file"
              accept=".csv,.tsv,.txt,.json,.xlsx,.docx,.pdf"
              className="hidden"
              disabled={isUploadingFile}
              onChange={(e) => {
                handleFileUpload(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>

          {workspaceFeedback && (
            <p
              role="status"
              aria-live="polite"
              className={`rounded border px-2.5 py-1.5 text-xs ${
                workspaceFeedback.kind === "error"
                  ? "border-destructive/40 bg-destructive/10 text-destructive"
                  : "border-border bg-secondary/40 text-foreground"
              }`}
            >
              {workspaceFeedback.text}
            </p>
          )}

          {parsedDoc && (
            <div className="rounded border border-border p-3 text-xs space-y-1">
              <div className="flex flex-wrap items-center justify-between gap-2 font-medium">
                <span className="break-all">{parsedDoc.fileName}</span>
                <span className="font-mono uppercase text-muted-foreground">
                  {parsedDoc.format} · {parsedDoc.rowCount} row(s)
                </span>
              </div>
              {parsedDoc.summaryText && (
                <p className="text-muted-foreground whitespace-pre-wrap">{parsedDoc.summaryText}</p>
              )}
              {parsedDoc.warnings.map((w, i) => (
                <p key={i} className="text-destructive">
                  {w}
                </p>
              ))}
            </div>
          )}

          <div className="space-y-1.5">
            {overview.isLoading ? (
              <div className="space-y-1.5">
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-full" />
              </div>
            ) : (data?.files ?? []).length === 0 ? (
              <p className="rounded border border-dashed border-border p-2.5 text-xs text-muted-foreground">
                No workspace files stored yet. Upload a CSV, XLSX, DOCX, or PDF above.
              </p>
            ) : (
              <ul className="space-y-1.5 max-h-44 overflow-y-auto">
                {(data?.files ?? []).map((f) => {
                  const isConfirming = pendingDeleteFileName === f.fileName;
                  const isDeleting = deletingFileName === f.fileName;
                  return (
                    <li
                      key={f.fileName}
                      className="flex flex-wrap items-center justify-between gap-2 rounded border border-border/70 px-2.5 py-1.5 text-xs"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-medium truncate">{f.fileName}</p>
                        <p className="text-[11px] text-muted-foreground tabular-nums">
                          {Math.max(1, Math.round(f.sizeBytes / 1024))} KB
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {isConfirming ? (
                          <>
                            <Button
                              size="sm"
                              variant="destructive"
                              className="h-6 px-2 text-[11px]"
                              disabled={isDeleting}
                              onClick={async () => {
                                setDeletingFileName(f.fileName);
                                try {
                                  const res = await deleteFileFn({
                                    data: { fileName: f.fileName },
                                  });
                                  setPendingDeleteFileName(null);
                                  if (res.ok) {
                                    if (parsedDoc?.fileName === f.fileName) setParsedDoc(null);
                                    setWorkspaceFeedback({
                                      kind: "success",
                                      text: `Deleted workspace file "${f.fileName}".`,
                                    });
                                    toast.success(`Deleted "${f.fileName}".`);
                                  } else {
                                    setWorkspaceFeedback({
                                      kind: "error",
                                      text: `"${f.fileName}" was not found or already removed.`,
                                    });
                                  }
                                  queryClient.invalidateQueries({
                                    queryKey: ["phase4-work-center"],
                                  });
                                } catch (err) {
                                  const msg =
                                    err instanceof Error ? err.message : "Could not delete file.";
                                  setWorkspaceFeedback({ kind: "error", text: msg });
                                  toast.error(msg);
                                } finally {
                                  setDeletingFileName(null);
                                }
                              }}
                            >
                              {isDeleting ? "Deleting…" : "Confirm"}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 px-2 text-[11px]"
                              disabled={isDeleting}
                              onClick={() => setPendingDeleteFileName(null)}
                            >
                              Cancel
                            </Button>
                          </>
                        ) : (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-7"
                            aria-label={`Delete ${f.fileName}`}
                            onClick={() => setPendingDeleteFileName(f.fileName)}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={generateReport.isPending}
              onClick={() => generateReport.mutate("xlsx")}
            >
              <Download className="mr-1.5 size-3.5" />
              {generateReport.isPending ? "Generating…" : "Export XLSX"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={generateReport.isPending}
              onClick={() => generateReport.mutate("docx")}
            >
              <FileText className="mr-1.5 size-3.5" />
              Export DOCX
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={generateReport.isPending}
              onClick={() => generateReport.mutate("pdf")}
            >
              <Download className="mr-1.5 size-3.5" />
              Export PDF
            </Button>
          </div>
        </section>

        <section className="panel p-5 space-y-3">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <CalendarClock className="size-4 text-primary" />
            Persistent Workflow Builder (Croner)
          </h2>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              aria-label="Workflow instruction"
              value={nlWorkflowInput}
              onChange={(e) => setNlWorkflowInput(e.target.value)}
              placeholder="e.g. Every day at 9 AM check Meesho pending orders and export XLSX report"
              className="text-xs"
            />
            <Button
              size="sm"
              variant="secondary"
              disabled={compileWorkflow.isPending || nlWorkflowInput.trim().length < 4}
              onClick={() => compileWorkflow.mutate()}
            >
              {compileWorkflow.isPending ? "Compiling…" : "Compile"}
            </Button>
          </div>

          {compiledPreview && (
            <div className="rounded border border-border p-3 text-xs space-y-2">
              <pre className="whitespace-pre-wrap font-sans text-foreground">
                {compiledPreview.previewSummary}
              </pre>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={saveWorkflow.isPending}
                  onClick={() => saveWorkflow.mutate()}
                >
                  {saveWorkflow.isPending ? "Saving…" : "Confirm & Activate"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setCompiledPreview(null)}>
                  Discard
                </Button>
              </div>
            </div>
          )}

          {data?.environmentNotice && (
            <p className="text-[11px] text-muted-foreground">{data.environmentNotice}</p>
          )}

          {overview.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : (data?.workflows || []).length === 0 ? (
            <p className="rounded border border-dashed border-border p-2.5 text-xs text-muted-foreground">
              No saved workflows yet. Describe a schedule above and compile it first.
            </p>
          ) : (
            <ul className="space-y-2">
              {(data?.workflows || []).slice(0, 4).map((wf) => {
                const isConfirmingDel = pendingDeleteWorkflowId === wf.id;
                const isBusy = busyWorkflowId === wf.id;
                return (
                  <li
                    key={wf.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded border border-border/70 p-2.5 text-xs"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate">{wf.name}</p>
                      <p className="text-[11px] text-muted-foreground font-mono tabular-nums">
                        {wf.triggerType}
                        {wf.cronExpression ? ` · ${wf.cronExpression}` : ""} · Runs: {wf.runCount}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                      {isConfirmingDel ? (
                        <>
                          <Button
                            size="sm"
                            variant="destructive"
                            className="h-7 px-2 text-[11px]"
                            disabled={isBusy}
                            onClick={async () => {
                              setBusyWorkflowId(wf.id);
                              try {
                                await workflowFn({ data: { mode: "delete", workflowId: wf.id } });
                                setPendingDeleteWorkflowId(null);
                                toast.success(`Deleted workflow "${wf.name}".`);
                                queryClient.invalidateQueries({
                                  queryKey: ["phase4-work-center"],
                                });
                              } catch {
                                toast.error(`Could not delete "${wf.name}".`);
                              } finally {
                                setBusyWorkflowId(null);
                              }
                            }}
                          >
                            {isBusy ? "Deleting…" : "Confirm"}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-[11px]"
                            disabled={isBusy}
                            onClick={() => setPendingDeleteWorkflowId(null)}
                          >
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-[11px]"
                            disabled={isBusy}
                            onClick={async () => {
                              setBusyWorkflowId(wf.id);
                              try {
                                await workflowFn({ data: { mode: "run", workflowId: wf.id } });
                                queryClient.invalidateQueries({
                                  queryKey: ["phase4-work-center"],
                                });
                                toast.success(`Executed "${wf.name}"`);
                              } catch {
                                toast.error(`Failed to execute "${wf.name}".`);
                              } finally {
                                setBusyWorkflowId(null);
                              }
                            }}
                          >
                            {isBusy ? "Running…" : "Run Now"}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-[11px]"
                            disabled={isBusy}
                            onClick={async () => {
                              setBusyWorkflowId(wf.id);
                              try {
                                await workflowFn({
                                  data: {
                                    mode: "toggle",
                                    workflowId: wf.id,
                                    nextStatus: wf.status === "active" ? "paused" : "active",
                                  },
                                });
                                queryClient.invalidateQueries({
                                  queryKey: ["phase4-work-center"],
                                });
                              } catch {
                                toast.error(`Could not update "${wf.name}".`);
                              } finally {
                                setBusyWorkflowId(null);
                              }
                            }}
                          >
                            {wf.status === "active" ? "Pause" : "Resume"}
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-7"
                            aria-label={`Delete workflow ${wf.name}`}
                            disabled={isBusy}
                            onClick={() => setPendingDeleteWorkflowId(wf.id)}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {/* Row 3: Modular Connected Apps + Proactive Suggestions & Pending Draft Approvals + Memory Health */}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="panel p-5 space-y-3">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Link2 className="size-4 text-primary" />
            Connected Apps (Truthful Health)
          </h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {(data?.connectors || []).map((c) => {
              const isTesting = testingConnectorId === c.id;
              return (
                <div key={c.id} className="rounded border border-border p-2.5 text-xs space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium truncate">{c.name}</span>
                    <Badge
                      variant={c.operational ? "secondary" : "outline"}
                      className="text-[10px]"
                    >
                      {c.status}
                    </Badge>
                  </div>
                  {c.missingRequirements[0] && (
                    <p className="text-[11px] text-muted-foreground">{c.missingRequirements[0]}</p>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-[10px]"
                    disabled={isTesting}
                    onClick={async () => {
                      setTestingConnectorId(c.id);
                      try {
                        const res = await testConnFn({ data: { connectorId: c.id as never } });
                        toast[res.operational ? "success" : "info"](
                          res.operational
                            ? `${res.name} verified operational.`
                            : res.missingRequirements[0] || `${res.name}: not connected.`,
                        );
                        queryClient.invalidateQueries({ queryKey: ["phase4-work-center"] });
                      } catch {
                        toast.error(`Could not test ${c.name} right now.`);
                      } finally {
                        setTestingConnectorId(null);
                      }
                    }}
                  >
                    {isTesting ? "Checking…" : "Test Health"}
                  </Button>
                </div>
              );
            })}
          </div>
        </section>

        <section className="panel p-5 space-y-3">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Lightbulb className="size-4 text-primary" />
            Proactive Intelligence, Draft Approvals & Memory Health
          </h2>

          <div className="flex items-center gap-3 text-xs text-muted-foreground tabular-nums">
            <span>Long-term memories: {data?.memoriesV2.length ?? 0}</span>
            <span>Conflicts: {data?.memoryConflicts.length ?? 0}</span>
            <span>Stale: {data?.staleMemoryCount ?? 0}</span>
          </div>

          {(data?.suggestions || []).map((s) => (
            <div key={s.id} className="rounded border border-border p-2.5 text-xs space-y-1">
              <p className="font-medium flex items-center gap-1.5">
                <Activity className="size-3.5 text-primary" />
                {s.title}
              </p>
              <p className="text-muted-foreground">{s.reason}</p>
            </div>
          ))}

          {(data?.drafts || [])
            .filter((d) => d.status === "awaiting_approval")
            .map((d) => {
              const isApproving = approvingDraftId === d.id;
              return (
                <div
                  key={d.id}
                  className="rounded border border-warning/40 bg-warning/5 p-2.5 text-xs space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium flex items-center gap-1.5">
                      <ShieldAlert className="size-3.5 text-warning" />
                      Approval needed: {d.channel} → {d.recipient}
                    </span>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="h-6 px-2 text-[10px]"
                      disabled={isApproving}
                      onClick={async () => {
                        if (approvingDraftId) return;
                        setApprovingDraftId(d.id);
                        try {
                          const res = await approveDraftFn({
                            data: { draftId: d.id, confirmedByUser: true },
                          });
                          toast[res.ok ? "success" : "error"](res.detail);
                          queryClient.invalidateQueries({ queryKey: ["phase4-work-center"] });
                        } catch (err) {
                          toast.error(
                            err instanceof Error
                              ? err.message
                              : "Could not approve and send draft.",
                          );
                        } finally {
                          setApprovingDraftId(null);
                        }
                      }}
                    >
                      {isApproving ? "Sending…" : "Approve & Send"}
                    </Button>
                  </div>
                  <p className="text-muted-foreground whitespace-pre-wrap">{d.body}</p>
                </div>
              );
            })}

          {(!data ||
            (data.suggestions.length === 0 &&
              data.drafts.filter((d) => d.status === "awaiting_approval").length === 0)) && (
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <AlertTriangle className="size-3.5" />
              No pending proactive alerts or unapproved drafts.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
