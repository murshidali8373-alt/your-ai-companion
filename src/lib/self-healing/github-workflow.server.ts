/**
 * GITHUB REPOSITORY INSPECTION & CONTROLLED PR WORKFLOW
 * (AI Buddy 2.0 — Part B GitHub Integration)
 *
 * Designed for environments with or without local `.git`:
 * - Primary integration uses GitHub REST API v3 (`https://api.github.com`) via `fetch`.
 * - Strictly rejects pushing/committing to `main` or `master`.
 * - Strictly requires `create_github_pr` user approval before branch creation or PR opening.
 * - Never fabricates success: returns `requiresUserAction: true` + prepared patch if
 *   GITHUB_TOKEN or owner/repo is absent or API returns 401/403/404.
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { getProviderKey } from "@/lib/ai/provider-keys.server";
import {
  redactSensitiveText,
  verifySelfHealApproval,
  type ApprovalActionType,
} from "@/shared/self-healing";
import { resolveSafeRepoPath } from "./code-repair.server";
import { getSelfHealingStore, type GitHubPrResult } from "./store.server";

const execFileAsync = promisify(execFile);

const GITHUB_API_BASE = "https://api.github.com";
const SLUG_RE = /^[A-Za-z0-9_.-]{1,100}$/;
const BRANCH_RE = /^[A-Za-z0-9_./-]{1,120}$/;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export function isProtectedBranch(branch: string): boolean {
  const norm = branch
    .trim()
    .toLowerCase()
    .replace(/^refs\/heads\//, "");
  return norm === "main" || norm === "master" || norm === "production" || norm === "prod";
}

function validateRepoOwnerName(owner: string, repo: string): string | null {
  if (!SLUG_RE.test(owner) || !SLUG_RE.test(repo)) {
    return "Invalid GitHub repository owner or name.";
  }
  return null;
}

function buildPreparedPatch(repairId?: string): string {
  if (!repairId) return "";
  const session = getSelfHealingStore().sessions.get(repairId);
  if (!session?.diffPreviews?.length) return "";
  return session.diffPreviews.map((d) => d.unifiedDiff).join("\n\n");
}

function resolveGitHubToken(explicitToken?: string | null): string | undefined {
  const trimmed = explicitToken?.trim();
  if (trimmed && !trimmed.startsWith("MY_")) return trimmed;
  return getProviderKey("github");
}

async function githubFetch(
  apiPath: string,
  token: string,
  init: RequestInit = {},
  fetchFn: FetchLike = fetch,
): Promise<Response> {
  if (!apiPath.startsWith("/")) {
    throw new Error("GitHub API path must be relative.");
  }
  return fetchFn(`${GITHUB_API_BASE}${apiPath}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "AI-Buddy-Self-Healing/2.0",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {}),
    },
  });
}

export async function getLocalGitStatus(rootDir: string = process.cwd()): Promise<{
  hasLocalGit: boolean;
  branch?: string;
  dirtyFiles?: string[];
}> {
  const gitDir = path.join(path.resolve(rootDir), ".git");
  if (!fs.existsSync(gitDir)) {
    return { hasLocalGit: false };
  }
  try {
    const [branchOut, statusOut] = await Promise.all([
      execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: rootDir, timeout: 5000 }),
      execFileAsync("git", ["status", "--short"], { cwd: rootDir, timeout: 5000 }),
    ]);
    const dirtyFiles = statusOut.stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    return {
      hasLocalGit: true,
      branch: branchOut.stdout.trim(),
      dirtyFiles,
    };
  } catch {
    return { hasLocalGit: false };
  }
}

export async function inspectGitHubRepo(opts: {
  owner: string;
  repo: string;
  token?: string | null;
  fetchFn?: FetchLike;
}): Promise<{
  ok: boolean;
  requiresUserAction?: boolean;
  defaultBranch?: string;
  privateRepo?: boolean;
  htmlUrl?: string;
  message: string;
}> {
  const invalid = validateRepoOwnerName(opts.owner, opts.repo);
  if (invalid) return { ok: false, message: invalid };

  const token = resolveGitHubToken(opts.token);
  if (!token) {
    return {
      ok: false,
      requiresUserAction: true,
      message:
        "GITHUB_TOKEN is not configured on the server. Add GITHUB_TOKEN in Secrets or supply a personal access token with repo scope.",
    };
  }

  const res = await githubFetch(
    `/repos/${opts.owner}/${opts.repo}`,
    token,
    { method: "GET" },
    opts.fetchFn,
  );
  if (!res.ok) {
    return {
      ok: false,
      requiresUserAction: res.status === 401 || res.status === 403 || res.status === 404,
      message: `GitHub API returned HTTP ${res.status} while inspecting ${opts.owner}/${opts.repo}.`,
    };
  }
  const data = (await res.json()) as {
    default_branch?: string;
    private?: boolean;
    html_url?: string;
  };
  return {
    ok: true,
    defaultBranch: data.default_branch || "main",
    privateRepo: Boolean(data.private),
    htmlUrl: data.html_url,
    message: `Connected to ${opts.owner}/${opts.repo} (default branch: ${data.default_branch || "main"}).`,
  };
}

export async function listRecentCommits(opts: {
  owner: string;
  repo: string;
  branch?: string;
  limit?: number;
  token?: string | null;
  fetchFn?: FetchLike;
}): Promise<{
  ok: boolean;
  commits?: Array<{ sha: string; message: string; author: string; date: string }>;
  message: string;
}> {
  const invalid = validateRepoOwnerName(opts.owner, opts.repo);
  if (invalid) return { ok: false, message: invalid };
  const token = resolveGitHubToken(opts.token);
  if (!token) {
    return { ok: false, message: "GITHUB_TOKEN is not configured." };
  }
  const branch = opts.branch && BRANCH_RE.test(opts.branch) ? opts.branch : "main";
  const limit = Math.min(20, Math.max(1, opts.limit ?? 5));
  const res = await githubFetch(
    `/repos/${opts.owner}/${opts.repo}/commits?sha=${encodeURIComponent(branch)}&per_page=${limit}`,
    token,
    { method: "GET" },
    opts.fetchFn,
  );
  if (!res.ok) {
    return { ok: false, message: `GitHub commits lookup failed (HTTP ${res.status}).` };
  }
  const raw = (await res.json()) as Array<{
    sha: string;
    commit: { message: string; author?: { name?: string; date?: string } };
  }>;
  return {
    ok: true,
    commits: raw.map((c) => ({
      sha: c.sha,
      message: redactSensitiveText(c.commit.message).text.split("\n")[0] || "",
      author: c.commit.author?.name || "unknown",
      date: c.commit.author?.date || "",
    })),
    message: `Loaded ${raw.length} recent commit(s).`,
  };
}

export async function readRemoteFile(opts: {
  owner: string;
  repo: string;
  filePath: string;
  ref?: string;
  token?: string | null;
  fetchFn?: FetchLike;
}): Promise<{ ok: boolean; content?: string; sha?: string; message: string }> {
  const invalid = validateRepoOwnerName(opts.owner, opts.repo);
  if (invalid) return { ok: false, message: invalid };
  const safePath = resolveSafeRepoPath(opts.filePath);
  if (!safePath.ok) return { ok: false, message: safePath.reason };
  const token = resolveGitHubToken(opts.token);
  if (!token) return { ok: false, message: "GITHUB_TOKEN is not configured." };

  const refQuery =
    opts.ref && BRANCH_RE.test(opts.ref) ? `?ref=${encodeURIComponent(opts.ref)}` : "";
  const res = await githubFetch(
    `/repos/${opts.owner}/${opts.repo}/contents/${safePath.normalizedRel}${refQuery}`,
    token,
    { method: "GET" },
    opts.fetchFn,
  );
  if (!res.ok) {
    return { ok: false, message: `Failed reading remote file (HTTP ${res.status}).` };
  }
  const data = (await res.json()) as { content?: string; encoding?: string; sha?: string };
  const decoded =
    data.content && data.encoding === "base64"
      ? Buffer.from(data.content.replace(/\n/g, ""), "base64").toString("utf8")
      : "";
  return {
    ok: true,
    content: redactSensitiveText(decoded).text,
    sha: data.sha,
    message: `Fetched ${safePath.normalizedRel} from ${opts.owner}/${opts.repo}.`,
  };
}

export async function compareBranches(opts: {
  owner: string;
  repo: string;
  base: string;
  head: string;
  token?: string | null;
  fetchFn?: FetchLike;
}): Promise<{
  ok: boolean;
  aheadBy?: number;
  behindBy?: number;
  status?: string;
  files?: Array<{ filename: string; status: string; additions: number; deletions: number }>;
  message: string;
}> {
  const invalid = validateRepoOwnerName(opts.owner, opts.repo);
  if (invalid) return { ok: false, message: invalid };
  if (!BRANCH_RE.test(opts.base) || !BRANCH_RE.test(opts.head)) {
    return { ok: false, message: "Invalid base or head branch reference." };
  }
  const token = resolveGitHubToken(opts.token);
  if (!token) return { ok: false, message: "GITHUB_TOKEN is not configured." };

  const res = await githubFetch(
    `/repos/${opts.owner}/${opts.repo}/compare/${encodeURIComponent(opts.base)}...${encodeURIComponent(opts.head)}`,
    token,
    { method: "GET" },
    opts.fetchFn,
  );
  if (!res.ok) {
    return { ok: false, message: `GitHub compare failed (HTTP ${res.status}).` };
  }
  const data = (await res.json()) as {
    ahead_by?: number;
    behind_by?: number;
    status?: string;
    files?: Array<{ filename: string; status: string; additions: number; deletions: number }>;
  };
  return {
    ok: true,
    aheadBy: data.ahead_by,
    behindBy: data.behind_by,
    status: data.status,
    files: data.files || [],
    message: `Branch comparison status: ${data.status || "unknown"}.`,
  };
}

/**
 * Creates an isolated `ai-buddy/fix-...` branch, commits verified repaired files,
 * and opens a Pull Request via GitHub REST API. Never pushes directly to main/master.
 */
export async function createFixBranchAndPr(opts: {
  repairId: string;
  owner?: string;
  repo?: string;
  baseBranch?: string;
  branchName?: string;
  title?: string;
  body?: string;
  approvedAction?: ApprovalActionType | null;
  rootDir?: string;
  token?: string | null;
  fetchFn?: FetchLike;
}): Promise<GitHubPrResult> {
  const approval = verifySelfHealApproval("create_github_pr", opts.approvedAction);
  if (!approval.allowed) {
    return {
      ok: false,
      requiresUserAction: true,
      message: approval.reason || "Explicit 'create_github_pr' approval is required.",
    };
  }

  const session = getSelfHealingStore().sessions.get(opts.repairId);
  if (!session) {
    return {
      ok: false,
      message: `Repair session "${opts.repairId}" not found.`,
    };
  }

  const preparedPatch = buildPreparedPatch(opts.repairId);
  if (!session.diffPreviews?.length) {
    return {
      ok: false,
      message: "No prepared or verified repair diff exists in this session to push.",
    };
  }

  const baseBranch = (opts.baseBranch || "main").trim();
  if (!BRANCH_RE.test(baseBranch)) {
    return { ok: false, message: "Invalid base branch name." };
  }

  const branchName = (opts.branchName || `ai-buddy/fix-${opts.repairId}`).trim();
  if (isProtectedBranch(branchName)) {
    return {
      ok: false,
      preparedPatch,
      message: `Direct commits or pushes to protected branch "${branchName}" are strictly prohibited. Use an isolated ai-buddy/fix-* branch.`,
    };
  }
  if (!BRANCH_RE.test(branchName) || !branchName.startsWith("ai-buddy/fix-")) {
    return {
      ok: false,
      preparedPatch,
      message: `Fix branch name must match "ai-buddy/fix-<id>" (got "${branchName}").`,
    };
  }

  const owner = opts.owner?.trim() || process.env["GITHUB_REPO_OWNER"]?.trim() || "";
  const repo = opts.repo?.trim() || process.env["GITHUB_REPO_NAME"]?.trim() || "";
  const token = resolveGitHubToken(opts.token);

  if (!owner || !repo || !token) {
    const missing: string[] = [];
    if (!token) missing.push("GITHUB_TOKEN");
    if (!owner || !repo) missing.push("GitHub owner/repo");
    return {
      ok: false,
      requiresUserAction: true,
      branchName,
      baseBranch,
      preparedPatch,
      message: `Cannot push to GitHub automatically because ${missing.join(" and ")} is missing. Apply the prepared unified patch locally or configure GITHUB_TOKEN and repository owner/repo.`,
    };
  }

  const invalid = validateRepoOwnerName(owner, repo);
  if (invalid) {
    return { ok: false, requiresUserAction: true, preparedPatch, message: invalid };
  }

  const rootDir = opts.rootDir ?? process.cwd();
  const fetchFn = opts.fetchFn;

  try {
    // 1. Resolve base branch commit SHA
    const refRes = await githubFetch(
      `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(baseBranch)}`,
      token,
      { method: "GET" },
      fetchFn,
    );
    if (!refRes.ok) {
      return {
        ok: false,
        requiresUserAction: refRes.status === 401 || refRes.status === 403 || refRes.status === 404,
        branchName,
        baseBranch,
        preparedPatch,
        message: `GitHub API returned HTTP ${refRes.status} resolving base branch "${baseBranch}". Prepared patch is preserved locally.`,
      };
    }
    const refData = (await refRes.json()) as { object?: { sha?: string } };
    const baseSha = refData.object?.sha;
    if (!baseSha) {
      return { ok: false, preparedPatch, message: "Missing base commit SHA from GitHub ref." };
    }

    // 2. Get base commit's tree SHA
    const commitRes = await githubFetch(
      `/repos/${owner}/${repo}/git/commits/${baseSha}`,
      token,
      { method: "GET" },
      fetchFn,
    );
    if (!commitRes.ok) {
      return {
        ok: false,
        requiresUserAction: commitRes.status === 401 || commitRes.status === 403,
        preparedPatch,
        message: `Failed reading base commit tree (HTTP ${commitRes.status}).`,
      };
    }
    const commitData = (await commitRes.json()) as { tree?: { sha?: string } };
    const baseTreeSha = commitData.tree?.sha;
    if (!baseTreeSha) {
      return { ok: false, preparedPatch, message: "Missing base tree SHA from GitHub commit." };
    }

    // 3. Create blobs for each repaired file
    const treeEntries: Array<{ path: string; mode: string; type: string; sha: string }> = [];
    for (const diff of session.diffPreviews) {
      const safe = resolveSafeRepoPath(diff.file, rootDir);
      if (!safe.ok || !fs.existsSync(safe.absolutePath)) {
        return {
          ok: false,
          preparedPatch,
          message: `Cannot stage file "${diff.file}" for GitHub upload.`,
        };
      }
      const content = fs.readFileSync(safe.absolutePath, "utf8");
      const blobRes = await githubFetch(
        `/repos/${owner}/${repo}/git/blobs`,
        token,
        {
          method: "POST",
          body: JSON.stringify({ content, encoding: "utf-8" }),
        },
        fetchFn,
      );
      if (!blobRes.ok) {
        return {
          ok: false,
          requiresUserAction: blobRes.status === 401 || blobRes.status === 403,
          preparedPatch,
          message: `Failed creating GitHub blob for ${safe.normalizedRel} (HTTP ${blobRes.status}).`,
        };
      }
      const blobData = (await blobRes.json()) as { sha: string };
      treeEntries.push({
        path: safe.normalizedRel,
        mode: "100644",
        type: "blob",
        sha: blobData.sha,
      });
    }

    // 4. Create new tree
    const treeRes = await githubFetch(
      `/repos/${owner}/${repo}/git/trees`,
      token,
      {
        method: "POST",
        body: JSON.stringify({ base_tree: baseTreeSha, tree: treeEntries }),
      },
      fetchFn,
    );
    if (!treeRes.ok) {
      return {
        ok: false,
        preparedPatch,
        message: `Failed creating GitHub git tree (HTTP ${treeRes.status}).`,
      };
    }
    const treeData = (await treeRes.json()) as { sha: string };

    // 5. Create commit
    const prTitle = redactSensitiveText(
      opts.title ||
        `[AI Buddy Self-Heal] Fix ${session.report.component}: ${session.report.errorMessage.slice(0, 72)}`,
    ).text;
    const newCommitRes = await githubFetch(
      `/repos/${owner}/${repo}/git/commits`,
      token,
      {
        method: "POST",
        body: JSON.stringify({
          message: prTitle,
          tree: treeData.sha,
          parents: [baseSha],
        }),
      },
      fetchFn,
    );
    if (!newCommitRes.ok) {
      return {
        ok: false,
        preparedPatch,
        message: `Failed creating GitHub commit (HTTP ${newCommitRes.status}).`,
      };
    }
    const newCommitData = (await newCommitRes.json()) as { sha: string };

    // 6. Create isolated fix branch ref
    const createRefRes = await githubFetch(
      `/repos/${owner}/${repo}/git/refs`,
      token,
      {
        method: "POST",
        body: JSON.stringify({
          ref: `refs/heads/${branchName}`,
          sha: newCommitData.sha,
        }),
      },
      fetchFn,
    );
    if (!createRefRes.ok) {
      return {
        ok: false,
        requiresUserAction: createRefRes.status === 401 || createRefRes.status === 403,
        preparedPatch,
        message: `Failed creating fix branch "${branchName}" (HTTP ${createRefRes.status}).`,
      };
    }

    // 7. Open Pull Request targeting baseBranch (never auto-merged)
    const verificationSummary = (session.verificationResults || [])
      .map((v) => `- ${v.name}: ${v.passed ? "PASS" : "FAIL"} (${v.summary})`)
      .join("\n");
    const prBody = redactSensitiveText(
      opts.body ||
        `## AI Buddy Self-Healing Repair\n\n- **Repair ID**: \`${session.repairId}\`\n- **Attribution**: \`${session.report.attribution}\`\n- **Root Cause**: ${session.diagnosis?.rootCause || session.report.errorMessage}\n\n### Verification\n${verificationSummary || "- Verified locally prior to PR"}\n\n> Created on isolated branch \`${branchName}\` with explicit user approval. Never pushed directly to \`${baseBranch}\`.`,
    ).text;

    const prRes = await githubFetch(
      `/repos/${owner}/${repo}/pulls`,
      token,
      {
        method: "POST",
        body: JSON.stringify({
          title: prTitle,
          head: branchName,
          base: baseBranch,
          body: prBody,
        }),
      },
      fetchFn,
    );
    if (!prRes.ok) {
      return {
        ok: false,
        requiresUserAction: prRes.status === 401 || prRes.status === 403,
        branchName,
        baseBranch,
        commitSha: newCommitData.sha,
        preparedPatch,
        message: `Branch "${branchName}" created, but opening PR failed (HTTP ${prRes.status}).`,
      };
    }
    const prData = (await prRes.json()) as { number?: number; html_url?: string };

    const result: GitHubPrResult = {
      ok: true,
      branchName,
      baseBranch,
      commitSha: newCommitData.sha,
      prNumber: prData.number,
      prUrl: prData.html_url,
      message: `Created branch "${branchName}" and opened PR #${prData.number ?? "?"} targeting "${baseBranch}".`,
    };
    session.status = "pr_created";
    session.githubResult = result;
    session.updatedAt = new Date().toISOString();
    return result;
  } catch (err) {
    return {
      ok: false,
      requiresUserAction: true,
      branchName,
      baseBranch,
      preparedPatch,
      message: `GitHub integration error: ${err instanceof Error ? err.message : "Network error"}. Prepared patch preserved locally.`,
    };
  }
}
