import { execFile } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { getModel } from "@mariozechner/pi-ai";
import { dirname, join } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { apiKeyFromPiOAuth, refreshWithPiOAuth } from "../../auth/pi-oauth.js";
import {
  getActiveAuthProfile,
  loadConfig,
  saveConfig,
  type ReviewFluxConfig,
} from "../../cli/config.js";
import { createLlmProvider } from "../../llm/factory.js";
import { normalizeRepoKey } from "../../llm/model-routing.js";
import {
  buildProjectContextText,
  pickContextFilePaths,
  resolveContextPatterns,
  type ContextFile,
} from "../../llm/project-context.js";
import { resolveCodexEffort } from "../../llm/reasoning-effort.js";
import {
  publishReviewWithInlineComments,
  type InlineReviewComment,
  type PublishReviewContext,
  type ReviewPublisherAdapter,
} from "../../gateway/review-publisher.js";

type PullRequestSummary = {
  number: number;
  title: string;
  body?: string;
  head: { sha: string };
};

type PullRequestDetail = {
  number: number;
  title: string;
  body?: string;
  html_url: string;
  head: { sha: string };
  base: { sha: string };
};

type IssueComment = {
  id: number;
  body?: string;
  issue_url: string;
};

type PullReviewComment = {
  id: number;
  body?: string;
  pull_request_url: string;
};

type IssueInfo = {
  number: number;
  pull_request?: unknown;
};

type ProjectPollState = {
  initialized: boolean;
  prHeads: Record<string, string>;
  seenForceCommentIds: string[];
};

type DaemonState = {
  projects: Record<string, ProjectPollState>;
};

type ProjectConfig = {
  repo: string;
  workspaceDir?: string;
  modelAlias?: string;
  model?: { provider: string; model: string };
  pr: {
    mode: "opened_once" | "on_push";
    forceCommand: "@reviewflux";
  };
  context?: {
    mode: "default" | "custom";
    include?: string[];
  };
};

type ReviewTriggerReason = "opened_once" | "on_push" | "manual_force";

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

type PullRequestFile = {
  filename: string;
};

type DiffLineIndex = Map<string, number[]>;

type StructuredReviewFinding = {
  path?: unknown;
  line?: unknown;
  severity?: unknown;
  body?: unknown;
};

type StructuredReviewOutput = {
  summary?: unknown;
  verificationNotes?: {
    verified?: unknown;
    notVerified?: unknown;
  };
  findings?: unknown;
};

const FORCE_COMMAND = "@reviewflux";
const MAX_DIFF_CHARS = 18000;
const MAX_GLOBAL_AGENTS_CHARS = 6000;

function resolvePollIntervalMs(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 30_000;
  return Math.max(parsed, 5_000);
}

const POLL_INTERVAL_MS = resolvePollIntervalMs(
  process.env.REVIEWFLUX_POLL_INTERVAL_MS,
);

function daemonStatePath(home: string = homedir()): string {
  return join(home, ".reviewflux", "daemon-state.json");
}

function globalAgentsPath(home: string = homedir()): string {
  return join(home, ".reviewflux", "AGENTS.md");
}

function loadGlobalAgentsGuidance(home: string = homedir()): string {
  const path = globalAgentsPath(home);
  if (!existsSync(path)) return "";
  try {
    return readFileSync(path, "utf8").slice(0, MAX_GLOBAL_AGENTS_CHARS).trim();
  } catch {
    return "";
  }
}

function loadDaemonState(home: string = homedir()): DaemonState {
  const path = daemonStatePath(home);
  if (!existsSync(path)) {
    return { projects: {} };
  }

  try {
    const parsed = JSON.parse(
      readFileSync(path, "utf8"),
    ) as Partial<DaemonState>;
    return {
      projects: parsed.projects ?? {},
    };
  } catch {
    return { projects: {} };
  }
}

function saveDaemonState(state: DaemonState, home: string = homedir()): void {
  const path = daemonStatePath(home);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

function parseOwnerRepo(repo: string): { owner: string; name: string } {
  const normalized = normalizeRepoKey(repo);
  const [owner, name] = normalized.split("/");
  if (!owner || !name) {
    throw new Error(`repo_format_invalid:${repo}`);
  }
  return { owner, name };
}

function ghExec(args: string[]): Promise<string> {
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

async function ghApiJson<T>(path: string): Promise<T> {
  const output = await ghExec(["api", path]);
  return JSON.parse(output) as T;
}

async function ghApiJsonWithInput<T>(
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

async function ghApiPaginatedJson<T>(path: string): Promise<T[]> {
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

async function listRepoMarkdownPaths(
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

async function fetchRepoFileContent(
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

async function buildRemoteProjectContextText(
  project: ProjectConfig,
  ref: string,
): Promise<string> {
  const markdownPaths = await listRepoMarkdownPaths(project.repo, ref);
  const patterns = resolveContextPatterns(project.context);
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
    context: project.context,
    files,
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsForceCommand(
  body: string | undefined,
  forceCommand: string = FORCE_COMMAND,
): boolean {
  if (!body) return false;
  const pattern = new RegExp(`(^|\\s)${escapeRegExp(forceCommand)}\\b`, "i");
  return pattern.test(body);
}

function parseIssueNumberFromIssueUrl(issueUrl: string): number | null {
  const match = issueUrl.match(/\/issues\/(\d+)$/);
  if (!match) return null;
  return Number(match[1]);
}

function parsePrNumberFromPullUrl(pullUrl: string): number | null {
  const match = pullUrl.match(/\/pulls\/(\d+)$/);
  if (!match) return null;
  return Number(match[1]);
}

function buildProjectState(state: DaemonState, repo: string): ProjectPollState {
  const key = normalizeRepoKey(repo);
  const existing = state.projects[key];
  if (existing) {
    existing.initialized = existing.initialized ?? false;
    existing.prHeads = existing.prHeads ?? {};
    existing.seenForceCommentIds = existing.seenForceCommentIds ?? [];
    return existing;
  }

  const created: ProjectPollState = {
    initialized: false,
    prHeads: {},
    seenForceCommentIds: [],
  };
  state.projects[key] = created;
  return created;
}

function buildSeenCommentId(kind: "issue" | "review", id: number): string {
  return `${kind}:${id}`;
}

async function primeProjectState(params: {
  projectState: ProjectPollState;
  owner: string;
  name: string;
  forceCommand: string;
}): Promise<void> {
  const { projectState, owner, name, forceCommand } = params;

  const pulls = await ghApiPaginatedJson<PullRequestSummary>(
    `repos/${owner}/${name}/pulls?state=open`,
  );
  projectState.prHeads = {};
  for (const pr of pulls) {
    projectState.prHeads[String(pr.number)] = pr.head.sha;
  }

  const issueComments = await ghApiPaginatedJson<IssueComment>(
    `repos/${owner}/${name}/issues/comments`,
  );
  for (const comment of issueComments) {
    if (!containsForceCommand(comment.body, forceCommand)) continue;
    trackSeenCommentId(projectState, buildSeenCommentId("issue", comment.id));
  }

  const reviewComments = await ghApiPaginatedJson<PullReviewComment>(
    `repos/${owner}/${name}/pulls/comments`,
  );
  for (const comment of reviewComments) {
    if (!containsForceCommand(comment.body, forceCommand)) continue;
    trackSeenCommentId(projectState, buildSeenCommentId("review", comment.id));
  }

  projectState.initialized = true;
}

function trackSeenCommentId(projectState: ProjectPollState, id: string): void {
  if (projectState.seenForceCommentIds.includes(id)) return;
  projectState.seenForceCommentIds.push(id);
  if (projectState.seenForceCommentIds.length > 500) {
    projectState.seenForceCommentIds =
      projectState.seenForceCommentIds.slice(-500);
  }
}

function shouldReviewOnPrAction(
  project: ProjectConfig,
  action: string,
): boolean {
  if (project.pr.mode === "opened_once") {
    return action === "opened";
  }
  return action === "opened" || action === "synchronize";
}

function resolveReasonForPrAction(
  project: ProjectConfig,
  action: "opened" | "synchronize",
): ReviewTriggerReason {
  if (action === "opened" && project.pr.mode === "opened_once")
    return "opened_once";
  return "on_push";
}

function resolveProjectModel(
  config: ReviewFluxConfig,
  project: ProjectConfig,
): { provider: string; model: string } {
  if (project.model?.provider && project.model.model) {
    return {
      provider: project.model.provider,
      model: project.model.model,
    };
  }

  const alias = project.modelAlias;
  if (alias && !config.modelAliases?.[alias]) {
    throw new Error(`project_model_alias_not_found:${project.repo}:${alias}`);
  }
  if (alias && config.modelAliases?.[alias]) {
    return {
      provider: config.modelAliases[alias].provider,
      model: config.modelAliases[alias].model,
    };
  }

  const selectedModel = config.model || config.models?.[0];
  if (!selectedModel) throw new Error("model_not_configured");

  if (selectedModel.includes("/")) {
    const [provider, ...rest] = selectedModel.split("/");
    if (provider && rest.length > 0) {
      return { provider, model: rest.join("/") };
    }
  }

  return { provider: config.llm, model: selectedModel };
}

async function resolveApiKeyForProvider(
  config: ReviewFluxConfig,
  provider: string,
): Promise<string> {
  const profile = getActiveAuthProfile(config, provider);

  if (profile?.mode === "apikey") {
    const key = profile.apiKey.key.trim();
    if (!key) throw new Error(`api_key_missing_for_provider:${provider}`);
    return key;
  }

  if (profile?.mode === "oauth") {
    const oauth = profile.oauth;
    if (
      oauth.expiresAtEpochMs &&
      oauth.refreshToken &&
      Date.now() >= oauth.expiresAtEpochMs - 10_000
    ) {
      const refreshed = await refreshWithPiOAuth(provider, oauth);
      Object.assign(oauth, refreshed);
      saveConfig(config);
    }
    return apiKeyFromPiOAuth(provider, oauth);
  }

  if (provider === config.llm) {
    if (config.authMode === "apikey" && config.apiKey?.key?.trim()) {
      return config.apiKey.key.trim();
    }
    if (config.authMode === "oauth" && config.oauth?.accessToken) {
      if (
        config.oauth.expiresAtEpochMs &&
        config.oauth.refreshToken &&
        Date.now() >= config.oauth.expiresAtEpochMs - 10_000
      ) {
        const refreshed = await refreshWithPiOAuth(provider, config.oauth);
        Object.assign(config.oauth, refreshed);
        saveConfig(config);
      }
      return apiKeyFromPiOAuth(provider, config.oauth);
    }
  }

  throw new Error(`credentials_not_found_for_provider:${provider}`);
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n...[truncated]`;
}

function parseCommentableRightSideLinesFromDiff(diff: string): DiffLineIndex {
  const lines = diff.split(/\r?\n/);
  const index: DiffLineIndex = new Map();

  let currentPath = "";
  let inHunk = false;
  let newLine = 0;

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      currentPath = "";
      inHunk = false;
      continue;
    }

    if (line.startsWith("+++ b/")) {
      currentPath = line.slice("+++ b/".length).trim();
      if (!index.has(currentPath)) index.set(currentPath, []);
      continue;
    }

    const hunkHeader = line.match(
      /^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/,
    );
    if (hunkHeader) {
      newLine = Number.parseInt(hunkHeader[1] ?? "0", 10);
      inHunk = true;
      continue;
    }

    if (!inHunk || !currentPath) continue;
    if (line.startsWith("\\ No newline at end of file")) continue;

    const marker = line[0] ?? "";
    if (marker === " " || marker === "+") {
      const entry = index.get(currentPath);
      if (entry) entry.push(newLine);
      newLine += 1;
      continue;
    }

    if (marker === "-") {
      continue;
    }

    inHunk = false;
  }

  return index;
}

function resolveClosestCommentableLine(
  lineIndex: DiffLineIndex,
  path: string,
  requestedLine: number,
): number | null {
  const lines = lineIndex.get(path);
  if (!lines || lines.length === 0) return null;
  if (lines.includes(requestedLine)) return requestedLine;

  let best = lines[0] ?? null;
  let bestDistance =
    best === null ? Number.POSITIVE_INFINITY : Math.abs(best - requestedLine);
  for (const line of lines) {
    const distance = Math.abs(line - requestedLine);
    if (distance < bestDistance) {
      best = line;
      bestDistance = distance;
    }
  }

  return best;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
}

function extractJsonPayload(raw: string): string | null {
  const fencedJson = raw.match(/```json\s*([\s\S]*?)```/i)?.[1]?.trim();
  if (fencedJson) return fencedJson;

  const fencedAny = raw.match(/```\s*([\s\S]*?)```/)?.[1]?.trim();
  if (fencedAny && (fencedAny.startsWith("{") || fencedAny.startsWith("[")))
    return fencedAny;

  const trimmed = raw.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return trimmed;

  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return raw.slice(firstBrace, lastBrace + 1).trim();
  }

  return null;
}

function buildSummaryBodyFromStructured(
  parsed: StructuredReviewOutput,
): string {
  const summaryText =
    typeof parsed.summary === "string" && parsed.summary.trim()
      ? parsed.summary.trim()
      : "중대한 수정 필요 없음";
  const verified = normalizeStringArray(parsed.verificationNotes?.verified);
  const notVerified = normalizeStringArray(
    parsed.verificationNotes?.notVerified,
  );

  return [
    "🧠 ReviewFlux Review",
    "",
    "### 요약",
    `- ${summaryText}`,
    "",
    "### 검증 메모",
    `- Verified: ${verified.length > 0 ? verified.join("; ") : "없음"}`,
    `- Not Verified: ${notVerified.length > 0 ? notVerified.join("; ") : "없음"}`,
  ].join("\n");
}

function parseStructuredReviewOutput(
  raw: string,
): { body: string; inlineComments: InlineReviewComment[] } | null {
  const payload = extractJsonPayload(raw);
  if (!payload) return null;

  let parsedValue: unknown;
  try {
    parsedValue = JSON.parse(payload);
  } catch {
    return null;
  }

  if (!parsedValue || typeof parsedValue !== "object") return null;
  const parsed = parsedValue as StructuredReviewOutput;
  const findingsRaw = Array.isArray(parsed.findings)
    ? (parsed.findings as StructuredReviewFinding[])
    : [];

  const inlineComments: InlineReviewComment[] = [];
  for (const finding of findingsRaw) {
    const path = typeof finding.path === "string" ? finding.path.trim() : "";
    const line =
      typeof finding.line === "number"
        ? finding.line
        : Number.parseInt(String(finding.line ?? ""), 10);
    const baseBody =
      typeof finding.body === "string" ? finding.body.trim() : "";
    const severity =
      typeof finding.severity === "string" ? finding.severity.trim() : "";
    if (!path || !Number.isFinite(line) || line <= 0 || !baseBody) continue;

    const hasSeverityLabel = /(^|\n)\s*-?\s*(severity|심각도)\s*:/i.test(
      baseBody,
    );
    const normalizedBody =
      severity && !hasSeverityLabel
        ? `- Severity: [${severity}]\n${baseBody}`
        : baseBody;
    inlineComments.push({
      path,
      line,
      body: normalizedBody,
    });
  }

  const body = buildSummaryBodyFromStructured(parsed);
  return { body, inlineComments };
}

function buildReviewSystemPrompt(params: {
  repo: string;
  prNumber: number;
  reason: ReviewTriggerReason;
}): string {
  return [
    "You are the ReviewFlux PR review assistant.",
    "Write concise, actionable review comments focused on correctness, risk, and maintainability.",
    "Output must be exactly one JSON object. Do not output markdown, explanations, or code fences.",
    "Follow the output contract (JSON schema) as the highest priority.",
    "If project guidance (AGENTS.md/context) is provided, apply it while preserving the output contract.",
    "The findings.body field must follow the provided review guidance format rules.",
    "Use only Small/Medium/High for findings.severity.",
    `Repository: ${params.repo}`,
    `Pull Request: #${params.prNumber}`,
    `Trigger reason: ${params.reason}`,
  ].join("\n");
}

function buildReviewUserPrompt(params: {
  pr: PullRequestDetail;
  diff: string;
  globalAgentsGuidance: string;
  projectContext: string;
}): string {
  return [
    ...(params.globalAgentsGuidance
      ? [
          "Global review guidance (~/.reviewflux/AGENTS.md):",
          params.globalAgentsGuidance,
          "",
        ]
      : []),
    ...(params.projectContext
      ? ["Project markdown context:", params.projectContext, ""]
      : []),
    `PR title: ${params.pr.title}`,
    `PR URL: ${params.pr.html_url}`,
    "",
    "PR description:",
    params.pr.body?.trim() || "(empty)",
    "",
    "Unified diff:",
    truncate(params.diff, MAX_DIFF_CHARS),
    "",
    "Return only JSON with this schema:",
    "{",
    '  "summary": "string",',
    '  "verificationNotes": { "verified": ["string"], "notVerified": ["string"] },',
    '  "findings": [',
    '    { "path": "string", "line": 1, "severity": "Small|Medium|High", "body": "string" }',
    "  ]",
    "}",
    "If there is no issue, return findings as an empty array.",
  ].join("\n");
}

async function createReviewComment(params: {
  config: ReviewFluxConfig;
  project: ProjectConfig;
  repo: string;
  pr: PullRequestDetail;
  reason: ReviewTriggerReason;
  globalAgentsGuidance: string;
  projectContext: string;
}): Promise<{ raw: string; diff: string }> {
  const { provider, model } = resolveProjectModel(
    params.config,
    params.project,
  );
  const apiKey = await resolveApiKeyForProvider(params.config, provider);
  const diff = await ghExec([
    "pr",
    "diff",
    String(params.pr.number),
    "-R",
    params.repo,
  ]);

  const fallbackModel = getModel(provider as never, model as never);
  const baseUrl =
    provider === params.config.llm
      ? params.config.llmApiBaseUrl.replace(/\/$/, "")
      : (fallbackModel?.baseUrl ??
        params.config.llmApiBaseUrl.replace(/\/$/, ""));
  const reasoningEffort =
    provider === "openai" || provider === "openai-codex"
      ? resolveCodexEffort({
          authMode: provider === "openai-codex" ? "oauth" : "apikey",
          model,
          requested: params.config.effort,
        })
      : undefined;
  const client = createLlmProvider({
    authMode: "apikey",
    provider: provider as never,
    baseUrl,
    model,
    apiKey,
    reasoningEffort,
  });

  const raw = await client.generateReply([
    {
      role: "system",
      content: buildReviewSystemPrompt({
        repo: params.repo,
        prNumber: params.pr.number,
        reason: params.reason,
      }),
    },
    {
      role: "user",
      content: buildReviewUserPrompt({
        pr: params.pr,
        diff,
        globalAgentsGuidance: params.globalAgentsGuidance,
        projectContext: params.projectContext,
      }),
    },
  ]);

  return { raw, diff };
}

async function fetchPullRequestDetail(
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

async function postReviewComment(
  repo: string,
  prNumber: number,
  body: string,
): Promise<void> {
  await ghExec(["pr", "comment", String(prNumber), "-R", repo, "--body", body]);
}

async function listPullRequestFiles(
  repo: string,
  prNumber: number,
): Promise<PullRequestFile[]> {
  const { owner, name } = parseOwnerRepo(repo);
  return ghApiPaginatedJson<PullRequestFile>(
    `repos/${owner}/${name}/pulls/${prNumber}/files`,
  );
}

async function postInlineReviewComment(params: {
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

async function postPullRequestReview(params: {
  repo: string;
  prNumber: number;
  body: string;
  comments: InlineReviewComment[];
}): Promise<void> {
  const { owner, name } = parseOwnerRepo(params.repo);
  await ghApiJsonWithInput(
    `repos/${owner}/${name}/pulls/${params.prNumber}/reviews`,
    "POST",
    {
      event: "COMMENT",
      body: params.body,
      comments: params.comments.map((comment) => ({
        path: comment.path,
        line: comment.line,
        side: "RIGHT",
        body: comment.body,
      })),
    },
  );
}

async function postReviewOutput(params: {
  repo: string;
  prNumber: number;
  prHeadSha: string;
  body: string;
  diff: string;
  inlineComments?: InlineReviewComment[];
}): Promise<void> {
  const lineIndex = parseCommentableRightSideLinesFromDiff(params.diff);
  const combineIntoSingleReviewThread = true;
  const bufferedInlineComments: InlineReviewComment[] = [];

  const context: PublishReviewContext = {
    repo: params.repo,
    prNumber: params.prNumber,
    body: params.body,
    inlineComments: params.inlineComments,
  };

  const adapter: ReviewPublisherAdapter = {
    listChangedPaths: async ({ repo, prNumber }) => {
      const files = await listPullRequestFiles(repo, prNumber);
      return files.map((file) => file.filename);
    },
    postInlineComment: async (
      { repo, prNumber },
      comment: InlineReviewComment,
    ) => {
      const line = resolveClosestCommentableLine(
        lineIndex,
        comment.path,
        comment.line,
      );
      if (!line) {
        throw new Error(
          `no_commentable_line_in_diff:${comment.path}:${comment.line}`,
        );
      }

      const resolvedComment: InlineReviewComment = {
        ...comment,
        line,
      };

      if (combineIntoSingleReviewThread) {
        bufferedInlineComments.push(resolvedComment);
        return;
      }

      await postInlineReviewComment({
        repo,
        prNumber,
        prHeadSha: params.prHeadSha,
        comment: resolvedComment,
      });
    },
    postSummaryComment: async ({ repo, prNumber }, body) => {
      if (combineIntoSingleReviewThread && bufferedInlineComments.length > 0) {
        await postPullRequestReview({
          repo,
          prNumber,
          body,
          comments: bufferedInlineComments,
        });
        return;
      }

      await postReviewComment(repo, prNumber, body);
    },
  };

  await publishReviewWithInlineComments({
    context,
    adapter,
    maxInlineComments: 20,
    postSummaryWhenInlinePosted: false,
    onInlineCommentError: (comment, error) => {
      console.error(
        `[reviewflux] failed to post inline comment: ${comment.path}:${comment.line}`,
      );
      console.error(error instanceof Error ? error.message : String(error));
    },
  });
}

async function triggerReview(params: {
  config: ReviewFluxConfig;
  project: ProjectConfig;
  repo: string;
  prNumber: number;
  reason: ReviewTriggerReason;
}): Promise<void> {
  const globalAgentsGuidance = loadGlobalAgentsGuidance();
  const pr = await fetchPullRequestDetail(params.repo, params.prNumber);
  let projectContext = "";
  try {
    projectContext = await buildRemoteProjectContextText(
      params.project,
      pr.base.sha,
    );
  } catch (error) {
    console.error(
      `[reviewflux] failed to load context for ${params.repo}@${pr.base.sha}`,
    );
    console.error(error instanceof Error ? error.message : String(error));
  }

  const review = await createReviewComment({
    config: params.config,
    project: params.project,
    repo: params.repo,
    pr,
    reason: params.reason,
    globalAgentsGuidance,
    projectContext,
  });

  const structured = parseStructuredReviewOutput(review.raw);

  await postReviewOutput({
    repo: params.repo,
    prNumber: params.prNumber,
    prHeadSha: pr.head.sha,
    body: structured?.body ?? review.raw,
    diff: review.diff,
    inlineComments: structured?.inlineComments,
  });
  console.log(
    `[reviewflux] review posted: ${params.repo}#${params.prNumber} reason=${params.reason}`,
  );
}

async function pollProject(params: {
  config: ReviewFluxConfig;
  state: DaemonState;
  repo: string;
}): Promise<void> {
  const { config, state, repo } = params;
  const project = config.projects?.[normalizeRepoKey(repo)] as
    | ProjectConfig
    | undefined;
  if (!project) return;

  const { owner, name } = parseOwnerRepo(repo);
  const projectState = buildProjectState(state, repo);
  const forceCommand = project.pr.forceCommand?.trim() || FORCE_COMMAND;

  if (!projectState.initialized) {
    await primeProjectState({
      projectState,
      owner,
      name,
      forceCommand,
    });
    console.log(`[reviewflux] baseline primed (no backfill): ${repo}`);
    return;
  }

  const pulls = await ghApiPaginatedJson<PullRequestSummary>(
    `repos/${owner}/${name}/pulls?state=open`,
  );
  const activeNumbers = new Set<string>();

  for (const pr of pulls) {
    const prNum = String(pr.number);
    const prevSha = projectState.prHeads[prNum];
    activeNumbers.add(prNum);

    if (!prevSha) {
      if (shouldReviewOnPrAction(project, "opened")) {
        await triggerReview({
          config,
          project,
          repo,
          prNumber: pr.number,
          reason: resolveReasonForPrAction(project, "opened"),
        });
      }
      projectState.prHeads[prNum] = pr.head.sha;
      continue;
    }

    if (prevSha !== pr.head.sha) {
      if (shouldReviewOnPrAction(project, "synchronize")) {
        await triggerReview({
          config,
          project,
          repo,
          prNumber: pr.number,
          reason: resolveReasonForPrAction(project, "synchronize"),
        });
      }
      projectState.prHeads[prNum] = pr.head.sha;
    }
  }

  for (const number of Object.keys(projectState.prHeads)) {
    if (!activeNumbers.has(number)) {
      delete projectState.prHeads[number];
    }
  }

  const issueComments = await ghApiPaginatedJson<IssueComment>(
    `repos/${owner}/${name}/issues/comments`,
  );
  for (const comment of issueComments) {
    if (!containsForceCommand(comment.body, forceCommand)) continue;
    const seenId = buildSeenCommentId("issue", comment.id);
    if (projectState.seenForceCommentIds.includes(seenId)) continue;

    const issueNumber = parseIssueNumberFromIssueUrl(comment.issue_url);
    if (!issueNumber) continue;

    const issue = await ghApiJson<IssueInfo>(
      `repos/${owner}/${name}/issues/${issueNumber}`,
    );
    if (!issue.pull_request) continue;

    await triggerReview({
      config,
      project,
      repo,
      prNumber: issue.number,
      reason: "manual_force",
    });
    trackSeenCommentId(projectState, seenId);
  }

  const reviewComments = await ghApiPaginatedJson<PullReviewComment>(
    `repos/${owner}/${name}/pulls/comments`,
  );
  for (const comment of reviewComments) {
    if (!containsForceCommand(comment.body, forceCommand)) continue;
    const seenId = buildSeenCommentId("review", comment.id);
    if (projectState.seenForceCommentIds.includes(seenId)) continue;

    const prNumber = parsePrNumberFromPullUrl(comment.pull_request_url);
    if (!prNumber) continue;

    await triggerReview({
      config,
      project,
      repo,
      prNumber,
      reason: "manual_force",
    });
    trackSeenCommentId(projectState, seenId);
  }
}

async function assertGhReady(): Promise<void> {
  await ghExec(["--version"]);
  await ghExec(["auth", "status"]);
}

export async function runDaemonStartCommand(): Promise<void> {
  const config = loadConfig();
  const projects = Object.values(config.projects ?? {}).sort((a, b) =>
    a.repo.localeCompare(b.repo),
  );

  console.log("[reviewflux] daemon start");

  if (projects.length === 0) {
    console.log(
      "[reviewflux] no projects configured. run: reviewflux project add",
    );
    return;
  }

  await assertGhReady();

  console.log(`[reviewflux] gh polling mode enabled (${POLL_INTERVAL_MS}ms)`);
  console.log(`[reviewflux] tracking ${projects.length} project(s)`);
  for (const project of projects) {
    const modelValue = project.model
      ? `${project.model.provider}/${project.model.model}`
      : (project.modelAlias ?? "<default>");
    const contextInfo =
      project.context?.mode === "custom"
        ? `custom:${(project.context.include ?? []).join(",")}`
        : "default:AGENTS.md";
    console.log(
      `- ${project.repo} | mode=${project.pr.mode} | model=${modelValue} | context=${contextInfo}`,
    );
  }
  console.log(
    `[reviewflux] force command is enabled for mode=on_push projects: ${FORCE_COMMAND}`,
  );

  const state = loadDaemonState();
  const abortController = new AbortController();

  const shutdown = () => {
    abortController.abort();
    console.log("\n[reviewflux] daemon stopped");
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  while (!abortController.signal.aborted) {
    for (const project of projects) {
      try {
        await pollProject({
          config,
          state,
          repo: project.repo,
        });
      } catch (error) {
        console.error(`[reviewflux] polling failed for ${project.repo}`);
        console.error(error instanceof Error ? error.message : String(error));
      }
    }

    saveDaemonState(state);

    try {
      await wait(POLL_INTERVAL_MS, undefined, {
        signal: abortController.signal,
      });
    } catch {
      break;
    }
  }
}
