/**
 * Extension & Web Self-Healing API Endpoint.
 * Exposes sanitized diagnostics, Knowledge Base telemetry, granular approval workflow,
 * controlled code repair/verification/rollback, and GitHub PR workflow.
 */

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import {
  extensionJsonResponse,
  handleExtensionOptions,
} from "@/lib/extension-cors.server";
import { getProviderKey } from "@/lib/ai/provider-keys.server";
import {
  applyRepairAndTest,
  diagnoseRepairSession,
  getRepairSession,
  listRepairSessions,
  prepareRepairPatch,
  reportAndTriageError,
  rollbackRepair,
  showAffectedCode,
} from "@/lib/self-healing/code-repair.server";
import {
  compareBranches,
  createFixBranchAndPr,
  getLocalGitStatus,
  inspectGitHubRepo,
  listRecentCommits,
} from "@/lib/self-healing/github-workflow.server";
import { getSelfHealingStore } from "@/lib/self-healing/store.server";

const monitoredComponents = [
  "background_sw",
  "side_panel",
  "content_script",
  "browser_automation",
  "agent_execution",
  "api_communication",
  "ai_provider",
  "task_orchestration",
  "form_filling",
  "dom_interaction",
  "file_operations",
  "downloads",
  "runtime_exception",
  "unhandled_rejection",
  "build_and_test",
] as const;

const approvalActions = [
  "diagnose_only",
  "show_affected_code",
  "prepare_repair",
  "apply_repair_and_test",
  "create_github_pr",
  "cancel",
] as const;

const postSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("report_error"),
    errorMessage: z.string().min(1).max(3000),
    errorType: z.string().max(120).optional(),
    stackTrace: z.string().max(8000).optional(),
    file: z.string().max(300).optional(),
    line: z.number().int().optional(),
    column: z.number().int().optional(),
    relatedFunction: z.string().max(160).optional(),
    component: z.enum(monitoredComponents).default("runtime_exception"),
    agentId: z.string().max(60).optional(),
    taskId: z.string().max(120).optional(),
    currentOperation: z.string().max(240).optional(),
    recentHistory: z.array(z.string().max(500)).max(15).optional(),
    relevantLogs: z.array(z.string().max(500)).max(25).optional(),
    extensionVersion: z.string().max(40).optional(),
    reproductionSteps: z.array(z.string().max(300)).max(15).optional(),
    pageUrl: z.string().max(2000).optional(),
    capabilityId: z.string().max(100).optional(),
    httpStatus: z.number().int().optional(),
  }),
  z.object({
    action: z.literal("diagnose"),
    repairId: z.string().min(1).max(120),
    approvedAction: z.enum(approvalActions).default("diagnose_only"),
    preferredProvider: z.string().max(40).optional(),
    preferredModel: z.string().max(100).optional(),
    userApiKey: z.string().max(240).optional(),
    customBaseUrl: z.string().max(300).optional(),
    strictSelection: z.boolean().optional(),
    forceAi: z.boolean().optional(),
  }),
  z.object({
    action: z.literal("show_code"),
    repairId: z.string().min(1).max(120),
    approvedAction: z.enum(approvalActions),
    files: z.array(z.string().max(300)).max(10).optional(),
  }),
  z.object({
    action: z.literal("prepare_repair"),
    repairId: z.string().min(1).max(120),
    approvedAction: z.enum(approvalActions),
    patchEdits: z
      .array(
        z.object({
          file: z.string().min(1).max(300),
          searchBlock: z.string().min(1).max(8000),
          replaceBlock: z.string().max(8000),
          rationale: z.string().max(400).default("Targeted fix"),
        }),
      )
      .max(8)
      .optional(),
  }),
  z.object({
    action: z.literal("apply_repair_and_test"),
    repairId: z.string().min(1).max(120),
    approvedAction: z.enum(approvalActions),
    includeBuild: z.boolean().optional(),
  }),
  z.object({
    action: z.literal("rollback"),
    repairId: z.string().min(1).max(120),
  }),
  z.object({
    action: z.literal("create_github_pr"),
    repairId: z.string().min(1).max(120),
    approvedAction: z.enum(approvalActions),
    owner: z.string().max(100).optional(),
    repo: z.string().max(100).optional(),
    baseBranch: z.string().max(120).optional(),
    branchName: z.string().max(120).optional(),
    title: z.string().max(200).optional(),
    body: z.string().max(4000).optional(),
  }),
  z.object({
    action: z.literal("github_status"),
    owner: z.string().max(100).optional(),
    repo: z.string().max(100).optional(),
    branch: z.string().max(120).optional(),
    compareHead: z.string().max(120).optional(),
  }),
  z.object({
    action: z.literal("cancel"),
    repairId: z.string().min(1).max(120),
  }),
]);

export const Route = createFileRoute("/api/public/extension/self-heal")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => handleExtensionOptions(request),
      GET: async ({ request }) => {
        const store = getSelfHealingStore();
        const url = new URL(request.url);
        const query = url.searchParams.get("q") || "";
        const localGit = await getLocalGitStatus();
        return extensionJsonResponse(request, {
          ok: true,
          usage: store.kbBudget.getUsageSnapshot(),
          kbCount: store.kbBudget.listKnowledgeBase().length,
          kbEntries: query
            ? store.kbBudget.searchKnowledgeBase(query)
            : store.kbBudget.listKnowledgeBase().slice(0, 20),
          recentReports: store.reports.slice(0, 20),
          sessions: listRepairSessions().slice(0, 15).map((s) => ({
            repairId: s.repairId,
            status: s.status,
            attribution: s.report.attribution,
            component: s.report.component,
            errorMessage: s.report.errorMessage,
            occurrenceCount: s.occurrenceCount,
            rollbackPerformed: Boolean(s.rollbackPerformed),
            updatedAt: s.updatedAt,
          })),
          githubConfigured: Boolean(getProviderKey("github")),
          localGit,
        });
      },
      POST: async ({ request }) => {
        let parsed: z.infer<typeof postSchema>;
        try {
          parsed = postSchema.parse(await request.json());
        } catch {
          return extensionJsonResponse(
            request,
            { ok: false, error: "bad_request", message: "Invalid self-heal request payload." },
            400,
          );
        }

        try {
          switch (parsed.action) {
            case "report_error": {
              const session = reportAndTriageError(parsed, {
                extensionVersion: parsed.extensionVersion,
              });
              return extensionJsonResponse(request, {
                ok: true,
                session,
                usage: getSelfHealingStore().kbBudget.getUsageSnapshot(),
              });
            }
            case "diagnose": {
              const res = await diagnoseRepairSession(parsed);
              return extensionJsonResponse(request, res, res.ok ? 200 : 400);
            }
            case "show_code": {
              const res = showAffectedCode(parsed);
              return extensionJsonResponse(request, res, res.ok ? 200 : 403);
            }
            case "prepare_repair": {
              const res = prepareRepairPatch(parsed);
              return extensionJsonResponse(request, res, res.ok ? 200 : 400);
            }
            case "apply_repair_and_test": {
              const res = await applyRepairAndTest(parsed);
              return extensionJsonResponse(request, res, res.ok ? 200 : 400);
            }
            case "rollback": {
              const res = rollbackRepair({ repairId: parsed.repairId });
              return extensionJsonResponse(request, res, res.ok ? 200 : 400);
            }
            case "create_github_pr": {
              const res = await createFixBranchAndPr(parsed);
              return extensionJsonResponse(request, res, res.ok ? 200 : res.requiresUserAction ? 200 : 400);
            }
            case "github_status": {
              const localGit = await getLocalGitStatus();
              const owner = parsed.owner || process.env["GITHUB_REPO_OWNER"] || "";
              const repo = parsed.repo || process.env["GITHUB_REPO_NAME"] || "";
              if (!owner || !repo) {
                return extensionJsonResponse(request, {
                  ok: true,
                  githubConfigured: Boolean(getProviderKey("github")),
                  localGit,
                  message: "Supply owner & repo to inspect remote GitHub branches and commits.",
                });
              }
              const inspection = await inspectGitHubRepo({ owner, repo });
              const commits = inspection.ok
                ? await listRecentCommits({ owner, repo, branch: parsed.branch })
                : undefined;
              const comparison =
                inspection.ok && parsed.compareHead
                  ? await compareBranches({
                      owner,
                      repo,
                      base: inspection.defaultBranch || "main",
                      head: parsed.compareHead,
                    })
                  : undefined;
              return extensionJsonResponse(request, {
                ok: inspection.ok,
                localGit,
                inspection,
                commits,
                comparison,
              });
            }
            case "cancel": {
              const session = getRepairSession(parsed.repairId);
              if (!session) {
                return extensionJsonResponse(
                  request,
                  { ok: false, message: "Repair session not found." },
                  404,
                );
              }
              session.status = "cancelled";
              session.updatedAt = new Date().toISOString();
              return extensionJsonResponse(request, {
                ok: true,
                session,
                message: "Self-healing repair session cancelled.",
              });
            }
          }
        } catch (err) {
          return extensionJsonResponse(
            request,
            {
              ok: false,
              error: "server_error",
              message: err instanceof Error ? err.message : "Self-healing endpoint error.",
            },
            500,
          );
        }
      },
    },
  },
});
