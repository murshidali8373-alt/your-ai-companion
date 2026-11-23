/**
 * PROACTIVE INTELLIGENCE ENGINE (AI Buddy 2.0 — Phase 4)
 *
 * Responsibilities:
 * - Surface grounded, useful, non-intrusive suggestions from real runtime evidence
 * - Respect quiet mode, user notification preferences, cooldowns, and confidence threshold
 * - Never generate speculative noise or auto-execute unapproved side effects
 */

import type { TaskCheckpoint } from "@/shared/task-checkpoint";
import type { SpreadsheetAnalysisResult } from "./data-intelligence-engine";
import type { CrossFileComparisonResult } from "./file-workspace-engine";
import type { FailureNotification } from "./workflow-automation.server";
import { detectRepeatedWorkflowPattern, type TaskLogEntry } from "./workflow-recipe-engine";

export type ProactiveCategory =
  | "incomplete_task"
  | "repeated_workflow"
  | "failed_run"
  | "data_inconsistency"
  | "monitored_condition"
  | "next_project_step";

export interface ProactivePreferences {
  enabled: boolean;
  quietMode: boolean;
  minConfidence: number;
  cooldownMinutes: number;
  allowedCategories?: ProactiveCategory[] | undefined;
}

export const DEFAULT_PROACTIVE_PREFERENCES: ProactivePreferences = {
  enabled: true,
  quietMode: false,
  minConfidence: 0.72,
  cooldownMinutes: 30,
};

export interface ProactiveSuggestion {
  id: string;
  category: ProactiveCategory;
  title: string;
  message: string;
  confidence: number;
  evidence: string;
  suggestedActionPrompt: string;
  requiresApproval: boolean;
}

export interface ProactiveInput {
  preferences?: Partial<ProactivePreferences> | undefined;
  checkpoints?: TaskCheckpoint[] | undefined;
  recentTasks?: TaskLogEntry[] | undefined;
  failureNotifications?: FailureNotification[] | undefined;
  spreadsheetAnalysis?: SpreadsheetAnalysisResult | undefined;
  crossFileResult?: CrossFileComparisonResult | undefined;
  monitoredConditions?:
    Array<{ label: string; triggered: boolean; evidence: string; prompt: string }> | undefined;
  activeProjects?: Array<{ key: string; value: string }> | undefined;
  lastSuggestionAtIso?: string | undefined;
}

export function generateProactiveSuggestions(input: ProactiveInput): ProactiveSuggestion[] {
  const prefs: ProactivePreferences = {
    ...DEFAULT_PROACTIVE_PREFERENCES,
    ...(input.preferences ?? {}),
  };

  if (!prefs.enabled || prefs.quietMode) {
    return [];
  }

  if (input.lastSuggestionAtIso && prefs.cooldownMinutes > 0) {
    const elapsedMs = Date.now() - new Date(input.lastSuggestionAtIso).getTime();
    if (
      !Number.isNaN(elapsedMs) &&
      elapsedMs >= 0 &&
      elapsedMs < prefs.cooldownMinutes * 60 * 1000
    ) {
      return [];
    }
  }

  const candidates: ProactiveSuggestion[] = [];
  const allowCategory = (cat: ProactiveCategory) =>
    !prefs.allowedCategories || prefs.allowedCategories.includes(cat);

  // 1. Failed scheduled workflow runs
  if (allowCategory("failed_run") && input.failureNotifications?.length) {
    const latest = input.failureNotifications.find((n) => !n.acknowledged);
    if (latest) {
      candidates.push({
        id: `pro_fail_${latest.workflowId}`,
        category: "failed_run",
        title: `Workflow Run Failed: ${latest.workflowName}`,
        message: `Scheduled run failed (${latest.error}). Want me to inspect diagnostics or retry?`,
        confidence: 0.96,
        evidence: `failureNotification:${latest.id}`,
        suggestedActionPrompt: `Diagnose failed workflow "${latest.workflowName}" and show recovery steps`,
        requiresApproval: true,
      });
    }
  }

  // 2. Incomplete / paused task checkpoints
  if (allowCategory("incomplete_task") && input.checkpoints?.length) {
    const paused = input.checkpoints.find((c) => c.status === "paused" || c.status === "running");
    if (paused && paused.completedStepIds.length < paused.totalSteps) {
      candidates.push({
        id: `pro_ckpt_${paused.taskId}`,
        category: "incomplete_task",
        title: `Resume Incomplete Task: ${paused.title}`,
        message: `${paused.completedStepIds.length}/${paused.totalSteps} steps finished. Resume when ready?`,
        confidence: 0.9,
        evidence: `checkpoint:${paused.taskId}`,
        suggestedActionPrompt: `Resume task "${paused.title}"`,
        requiresApproval: true,
      });
    }
  }

  // 3. Repeated manual workflows
  if (allowCategory("repeated_workflow") && input.recentTasks && input.recentTasks.length >= 2) {
    const repeated = detectRepeatedWorkflowPattern(input.recentTasks, 2);
    if (repeated) {
      candidates.push({
        id: `pro_repeat_${repeated.id}`,
        category: "repeated_workflow",
        title: `Turn Repeated Task Into Workflow: ${repeated.name}`,
        message: `You ran "${repeated.name}" multiple times recently. Save it as an approved workflow?`,
        confidence: repeated.confidence,
        evidence: `recentTasks:${repeated.executionCount} runs`,
        suggestedActionPrompt: `Create workflow for "${repeated.name}"`,
        requiresApproval: true,
      });
    }
  }

  // 4. Data / cross-file inconsistencies
  if (allowCategory("data_inconsistency")) {
    if (
      input.crossFileResult &&
      (input.crossFileResult.discrepancies.length > 0 ||
        input.crossFileResult.missingInComparison.length > 0)
    ) {
      candidates.push({
        id: "pro_reconcile_diff",
        category: "data_inconsistency",
        title: "Dataset Discrepancies Detected",
        message: `Found ${input.crossFileResult.discrepancies.length} value mismatch(es) and ${input.crossFileResult.missingInComparison.length} missing row(s). Export reconciliation report?`,
        confidence: 0.94,
        evidence: `crossFile:${input.crossFileResult.baseFileName}`,
        suggestedActionPrompt: "Generate reconciled XLSX discrepancy report",
        requiresApproval: true,
      });
    } else if (input.spreadsheetAnalysis && input.spreadsheetAnalysis.anomalies.length > 0) {
      candidates.push({
        id: "pro_sheet_anomaly",
        category: "data_inconsistency",
        title: "Spreadsheet Outliers or Missing Values",
        message: `${input.spreadsheetAnalysis.anomalies.length} anomaly note(s) detected in spreadsheet audit.`,
        confidence: 0.85,
        evidence: `spreadsheetRows:${input.spreadsheetAnalysis.rowCount}`,
        suggestedActionPrompt: "Highlight anomalies and generate clean summary sheet",
        requiresApproval: true,
      });
    }
  }

  // 5. Monitored conditions
  if (allowCategory("monitored_condition") && input.monitoredConditions?.length) {
    for (const cond of input.monitoredConditions) {
      if (cond.triggered) {
        candidates.push({
          id: `pro_cond_${cond.label.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
          category: "monitored_condition",
          title: `Condition Triggered: ${cond.label}`,
          message: cond.evidence,
          confidence: 0.92,
          evidence: cond.evidence,
          suggestedActionPrompt: cond.prompt,
          requiresApproval: true,
        });
      }
    }
  }

  // 6. Active project next step
  if (allowCategory("next_project_step") && input.activeProjects?.length) {
    const proj = input.activeProjects[0]!;
    candidates.push({
      id: `pro_proj_${proj.key.slice(0, 16)}`,
      category: "next_project_step",
      title: `Active Project: ${proj.key}`,
      message: `Tracked context: ${proj.value.slice(0, 120)}`,
      confidence: 0.78,
      evidence: `memory:${proj.key}`,
      suggestedActionPrompt: `Review next steps for ${proj.key}`,
      requiresApproval: true,
    });
  }

  return candidates.filter((c) => c.confidence >= prefs.minConfidence).slice(0, 3);
}
