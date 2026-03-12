import { execFile } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildProjectContextText, pickContextFilePaths, resolveContextPatterns, type ContextFile } from "../llm/project-context.js";
import { normalizeRepoKey } from "../project/input.js";
import { type InlineReviewComment } from "../gateway/review-publisher.js";
import type {
  IssueComment,
  IssueInfo,
  ProjectConfig,
  PullRequestDetail,
  PullRequestFile,
  PullRequestSummary,
  PullReviewComment,
} from "./types.js";

type GitTreeEntry = {
  path: string;
  type: "blob" | "tree" | string;
};

type GitTreeResponse = {
  tree?: GitTreeEntry[];
};

type GitHubContentsFile = {
  type: "file";
  encoding?: string;
  content?: string;
};

export type GitHubCommentBody = {
  body?: string;
};

export function parseOwnerRepo(repo: string): { owner: string; name: string } {
  const normalized = normalizeRepoKey(repo);
  const [owner, name] = normalized.split("/");
  if (!owner || !name) {
    throw new Error(`repo_format_invalid:${repo}`);
  }
  return { owner, name };
}

export function ghExec(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "gh",
      args,
      { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.trim() || error.message));
          return;
        }
        resolve(stdout);
      },
    );
  });
}

function encodeGitHubApiPath(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export async function ghApiJson<T>(path: string): Promise<T> {
  const output = await ghExec(["api", path]);
  return JSON.parse(output) as T;
}

export async function ghApiJsonWithInput<T>(
  path: string,
  method: "POST",
  payload: unknown,
): Promise<T> {
  const tempDir = mkdtempSync(join(tmpdir(), "reviewflux-ghapi-"));
  const payloadPath = join(tempDir, "payload.json");
  writeFileSync(payloadPath, `${JSON.stringify(payload)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  try {
    const output = await ghExec([
      "api",
      path,
      "--method",
      method,
      "--input",
      payloadPath,
    ]);
    const trimmed = output.trim();
    return (trimmed ? JSON.parse(trimmed) : {}) as T;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

export async function ghApiPaginatedJson<T>(path: string): Promise<T[]> {
  const entries: T[] = [];
  let page = 1;

  while (true) {
    const separator = path.includes("?") ? "&" : "?";
    const pageEntries = await ghApiJson<T[]>(
      `${path}${separator}per_page=100&page=${page}`,
    );
    entries.push(...pageEntries);
    if (pageEntries.length < 100) break;
    page += 1;
  }

  return entries;
}

export async function listRepoMarkdownPaths(
  repo: string,
  ref: string,
): Promise<string[]> {
  const { owner, name } = parseOwnerRepo(repo);
  const tree = await ghApiJson<GitTreeResponse>(
    `repos/${owner}/${name}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
  );
  const markdownPaths = (tree.tree ?? [])
    .filter(
      (entry) =>
        entry.type === "blob" && entry.path.toLowerCase().endsWith(".md"),
    )
    .map((entry) => entry.path);
  return markdownPaths.sort((a, b) => a.localeCompare(b));
}

export async function fetchRepoFileContent(
  repo: string,
  filePath: string,
  ref: string,
): Promise<string | null> {
  const { owner, name } = parseOwnerRepo(repo);
  const encodedPath = encodeGitHubApiPath(filePath);
  const response = await ghApiJson<GitHubContentsFile | GitHubContentsFile[]>(
    `repos/${owner}/${name}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`,
  );
  if (Array.isArray(response) || response.type !== "file") return null;
  if (response.encoding !== "base64" || !response.content) return null;
  return Buffer.from(response.content.replaceAll("\n", ""), "base64").toString(
    "utf8",
  );
}

export async function buildRemoteProjectContextText(
  project: ProjectConfig,
  ref: string,
): Promise<string> {
  const markdownPaths = await listRepoMarkdownPaths(project.repo, ref);
  const configuredPatterns = resolveContextPatterns(project.context);
  const patterns = Array.from(
    new Set(["AGENTS.md", "**/AGENTS.md", ...configuredPatterns]),
  );
  const selectedPaths = pickContextFilePaths({
    filePaths: markdownPaths,
    patterns,
  });
  const files: ContextFile[] = [];

  for (const filePath of selectedPaths) {
    const content = await fetchRepoFileContent(project.repo, filePath, ref);
    if (!content) continue;
    files.push({ path: filePath, content });
  }

  return buildProjectContextText({
    context: {
      mode: "custom",
      include: patterns,
    },
    files,
  });
}

export async function fetchPullRequestDetail(
  repo: string,
  prNumber: number,
): Promise<PullRequestDetail> {
  const { owner, name } = parseOwnerRepo(repo);
  const pr = await ghApiJson<PullRequestDetail>(
    `repos/${owner}/${name}/pulls/${prNumber}`,
  );
  if (pr.number !== prNumber) {
    throw new Error(`pr_mismatch:${repo}#${prNumber}`);
  }
  return pr;
}

export async function postPullRequestComment(params: {
  repo: string;
  prNumber: number;
  body: string;
}): Promise<void> {
  const { owner, name } = parseOwnerRepo(params.repo);
  await ghApiJsonWithInput(
    `repos/${owner}/${name}/issues/${params.prNumber}/comments`,
    "POST",
    { body: params.body },
  );
}

export async function listPullRequestFiles(
  repo: string,
  prNumber: number,
): Promise<PullRequestFile[]> {
  const { owner, name } = parseOwnerRepo(repo);
  return ghApiPaginatedJson<PullRequestFile>(
    `repos/${owner}/${name}/pulls/${prNumber}/files`,
  );
}

export async function postInlineReviewComment(params: {
  repo: string;
  prNumber: number;
  prHeadSha: string;
  comment: InlineReviewComment;
}): Promise<void> {
  const { owner, name } = parseOwnerRepo(params.repo);
  await ghApiJsonWithInput(
    `repos/${owner}/${name}/pulls/${params.prNumber}/comments`,
    "POST",
    {
      body: params.comment.body,
      path: params.comment.path,
      line: params.comment.line,
      side: "RIGHT",
      commit_id: params.prHeadSha,
    },
  );
}

export async function postPullRequestReviewReply(params: {
  repo: string;
  prNumber: number;
  replyToCommentId: string;
  body: string;
}): Promise<void> {
  const { owner, name } = parseOwnerRepo(params.repo);
  await ghApiJsonWithInput(
    `repos/${owner}/${name}/pulls/${params.prNumber}/comments/${params.replyToCommentId}/replies`,
    "POST",
    { body: params.body },
  );
}

export async function listPullRequestIssueComments(
  repo: string,
  prNumber: number,
): Promise<IssueComment[]> {
  const { owner, name } = parseOwnerRepo(repo);
  return ghApiPaginatedJson<IssueComment>(
    `repos/${owner}/${name}/issues/${prNumber}/comments`,
  );
}

export async function listPullRequestReviewComments(
  repo: string,
  prNumber: number,
): Promise<PullReviewComment[]> {
  const { owner, name } = parseOwnerRepo(repo);
  return ghApiPaginatedJson<PullReviewComment>(
    `repos/${owner}/${name}/pulls/${prNumber}/comments`,
  );
}

export async function listOpenPullRequests(
  repo: string,
): Promise<PullRequestSummary[]> {
  const { owner, name } = parseOwnerRepo(repo);
  return ghApiPaginatedJson<PullRequestSummary>(
    `repos/${owner}/${name}/pulls?state=open`,
  );
}

export async function fetchIssueInfo(
  repo: string,
  issueNumber: number,
): Promise<IssueInfo> {
  const { owner, name } = parseOwnerRepo(repo);
  return ghApiJson<IssueInfo>(`repos/${owner}/${name}/issues/${issueNumber}`);
}

export async function assertGhReady(): Promise<void> {
  await ghExec(["--version"]);
  await ghExec(["auth", "status"]);
}

export function loadLocalFileTrimmed(path: string, maxChars: number): string {
  try {
    return readFileSync(path, "utf8").slice(0, maxChars).trim();
  } catch {
    return "";
  }
}
