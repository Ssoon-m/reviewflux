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
import { fileURLToPath } from "node:url";
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
  html_url?: string;
  user?: { login?: string };
};

type PullReviewComment = {
  id: number;
  body?: string;
  pull_request_url: string;
  html_url?: string;
  user?: { login?: string };
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

type StructuredReviewComment = {
  path?: unknown;
  line?: unknown;
  severity?: unknown;
  body?: unknown;
};

type StructuredReviewOutput = {
  body?: unknown;
  findings?: unknown;
};

type ParsedStructuredReview = {
  body: string | null;
  inlineComments: InlineReviewComment[];
};

type FindingSeverity = "Small" | "Medium" | "High";

const FORCE_COMMAND = "@reviewflux";
const MAX_DIFF_CHARS = 18000;
const MAX_GLOBAL_AGENTS_CHARS = 6000;
const MAX_BASE_POLICY_CHARS = 6000;
const BASE_POLICY_FILE = "REVIEWFLUX-AGENTS.md";

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

function loadBasePolicyGuidance(): string {
  const moduleDir = fileURLToPath(new URL(".", import.meta.url));
  const candidates = [
    join(process.cwd(), "src", "commands", "setup", BASE_POLICY_FILE),
    join(process.cwd(), BASE_POLICY_FILE),
    join(moduleDir, "..", "setup", BASE_POLICY_FILE),
    join(
      moduleDir,
      "..",
      "..",
      "..",
      "src",
      "commands",
      "setup",
      BASE_POLICY_FILE,
    ),
    join(moduleDir, "..", "..", BASE_POLICY_FILE),
  ];

  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      const content = readFileSync(path, "utf8").trim();
      if (content) return content.slice(0, MAX_BASE_POLICY_CHARS);
    } catch {
      continue;
    }
  }

  return "";
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
  if (!Number.isFinite(requestedLine) || requestedLine <= 0) return null;

  const lines = lineIndex.get(path);
  if (!lines || lines.length === 0) return null;
  if (lines.includes(requestedLine)) return requestedLine;
  return null;
}

function extractJsonPayload(raw: string): string | null {
  const fencedJson = raw.match(/```json\s*([\s\S]*?)```/i)?.[1]?.trim();
  if (fencedJson) return fencedJson;

  const fencedAny = raw.match(/```\s*([\s\S]*?)```/)?.[1]?.trim();
  if (fencedAny && (fencedAny.startsWith("{") || fencedAny.startsWith("[")))
    return fencedAny;

  const trimmed = raw.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return trimmed;

  const firstBracket = raw.indexOf("[");
  const lastBracket = raw.lastIndexOf("]");
  if (firstBracket >= 0 && lastBracket > firstBracket) {
    return raw.slice(firstBracket, lastBracket + 1).trim();
  }

  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return raw.slice(firstBrace, lastBrace + 1).trim();
  }

  return null;
}

function normalizeStructuredReviewComments(
  parsedObject: StructuredReviewOutput,
): StructuredReviewComment[] {
  if (Array.isArray(parsedObject.findings)) {
    return parsedObject.findings as StructuredReviewComment[];
  }
  return [];
}

function normalizeFindingSeverity(value: unknown): FindingSeverity | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "small") return "Small";
  if (normalized === "medium") return "Medium";
  if (normalized === "high") return "High";
  return null;
}

function normalizeInlineFindingBody(params: {
  path: string;
  line: number;
  severity: FindingSeverity | null;
  baseBody: string;
}): string {
  const sanitized = params.baseBody
    .replace(/(^|\n)\s*-?\s*(line reference|라인 참조)\s*:[^\n]*/gi, "")
    .replace(/(^|\n)\s*-?\s*(severity|심각도)\s*:[^\n]*/gi, "")
    .trim();

  const compact = sanitized.replace(/\s+/g, " ").trim();
  const summary = compact
    ? compact.length > 180
      ? `${compact.slice(0, 177)}...`
      : compact
    : "Line-level issue detected in the referenced diff.";

  const hasEvidence = /(^|\n)\s*-\s*Evidence\s*:/i.test(sanitized);
  const hasRisk = /(^|\n)\s*-\s*Risk\s*:/i.test(sanitized);
  const hasRecommendation =
    /(^|\n)\s*-\s*Recommendation\s*:/i.test(sanitized);
  const structuredDetails =
    hasEvidence && hasRisk && hasRecommendation
      ? sanitized
      : [
          `- Evidence: ${compact || "Potential issue identified in the referenced line."}`,
          "- Risk: The current implementation can introduce incorrect behavior or maintenance risk.",
          "- Recommendation: Revisit this line-level logic and apply a targeted fix.",
        ].join("\n");

  return [
    "🧠 ReviewFlux Review",
    "",
    "### Summary",
    summary,
    "",
    "### Findings (ordered by severity)",
    "",
    `- Severity: [${params.severity ?? "Medium"}]`,
    structuredDetails,
    "",
    "### Verification Notes",
    "- Verified: Static review of the referenced diff line.",
    "- Not Verified: Runtime execution and full integration behavior were not validated in this inline context.",
  ].join("\n");
}

function parseStrictPositiveLine(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isInteger(value) && value > 0 ? value : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) return null;
    const parsed = Number.parseInt(trimmed, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

function parseStructuredReviewOutput(
  raw: string,
): ParsedStructuredReview | null {
  const payload = extractJsonPayload(raw);
  if (!payload) return null;

  let parsedValue: unknown;
  try {
    parsedValue = JSON.parse(payload);
  } catch {
    return null;
  }

  const parsedObject: StructuredReviewOutput =
    parsedValue && typeof parsedValue === "object" && !Array.isArray(parsedValue)
      ? (parsedValue as StructuredReviewOutput)
      : {};

  const bodyFromModel =
    typeof parsedObject.body === "string" ? parsedObject.body.trim() : "";

  const commentsRaw = normalizeStructuredReviewComments(parsedObject);
  const inlineComments: InlineReviewComment[] = [];
  for (const finding of commentsRaw) {
    const pathRaw = typeof finding.path === "string" ? finding.path.trim() : "";
    const line = parseStrictPositiveLine(finding.line);
    const body = typeof finding.body === "string" ? finding.body.trim() : "";
    if (!body) continue;

    const severity = normalizeFindingSeverity(finding.severity);
    const hasLocation = pathRaw.length > 0 && line !== null;

    if (!hasLocation || line === null) continue;
    const normalizedBody = normalizeInlineFindingBody({
      path: pathRaw,
      line,
      severity,
      baseBody: body,
    });
    inlineComments.push({
      path: pathRaw,
      line,
      body: normalizedBody,
    });
  }

  if (!bodyFromModel && inlineComments.length === 0) return null;

  return { body: bodyFromModel || null, inlineComments };
}

function buildBodyFromInlineComments(
  inlineComments: InlineReviewComment[],
): string {
  const top = inlineComments.slice(0, 3).map((item) => {
    const compact = item.body.replace(/\s+/g, " ").trim();
    const short = compact.length > 180 ? `${compact.slice(0, 177)}...` : compact;
    return `- ${item.path}:${item.line} ${short}`;
  });

  const summary =
    top.length > 0
      ? [
          "Potential issues were detected from structured findings.",
          ...top,
        ].join("\n")
      : "Potential issues were detected from structured findings.";

  return [
    "🧠 ReviewFlux Review",
    "",
    "### Summary",
    summary,
    "",
    "### Verification Notes",
    "- Verified: Parsed structured findings (path/line/body) from model output.",
    "- Not Verified: Model-provided top-level body format.",
  ].join("\n");
}

function isStrictReviewBody(body: string): boolean {
  const trimmed = body.trim();
  if (!trimmed.startsWith("🧠 ReviewFlux Review\n\n### Summary")) return false;

  const summaryIndex = trimmed.indexOf("\n### Summary");
  const findingsIndex = trimmed.indexOf("\n### Findings");
  const verificationIndex = trimmed.indexOf("\n### Verification Notes");
  if (summaryIndex < 0 || verificationIndex < 0) return false;
  if (findingsIndex >= 0) {
    return summaryIndex < findingsIndex && findingsIndex < verificationIndex;
  }
  return summaryIndex < verificationIndex;
}

function sanitizeModelOutputForFallback(raw: string): string {
  const source = extractJsonPayload(raw) ?? raw;
  return source
    .replace(/```json/gi, " ")
    .replace(/```/g, " ")
    .replace(/[{}\[\]"]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildBestEffortFallbackBody(params: {
  raw: string;
  reason: string;
}): string {
  const sanitized = sanitizeModelOutputForFallback(params.raw);
  const summary =
    sanitized.length > 0
      ? sanitized.length > 360
        ? `${sanitized.slice(0, 357)}...`
        : sanitized
      : "Review generation completed, but model output did not contain parsable analysis text.";

  return [
    "🧠 ReviewFlux Review",
    "",
    "### Summary",
    summary,
    "",
    "### Verification Notes",
    "- Verified: Best-effort rendering from model output text.",
    `- Not Verified: ${params.reason}`,
  ].join("\n");
}

function buildReviewSystemPrompt(params: {
  repo: string;
  prNumber: number;
  reason: ReviewTriggerReason;
  basePolicyGuidance: string;
}): string {
  return [
    "You are the ReviewFlux PR review assistant.",
    "Write concise, actionable review comments focused on correctness, risk, and maintainability.",
    "Output must be exactly one JSON object. Do not output markdown, explanations, or code fences.",
    "Return valid JSON only, with no prefix/suffix text before or after the object.",
    "Follow the output contract (JSON schema) as the highest priority.",
    "If project guidance (AGENTS.md/context) is provided, apply it while preserving the output contract.",
    ...(params.basePolicyGuidance
      ? [
          "Base review role/principles (from REVIEWFLUX-AGENTS.md):",
          params.basePolicyGuidance,
        ]
      : []),
    "Do not default line numbers to 1. Use exact changed-line numbers from the provided diff.",
    "Do not output placeholder/meta text like [Pasted ...], ..., TBD, N/A, or <...>.",
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
          "User global guidance (~/.reviewflux/AGENTS.md):",
          params.globalAgentsGuidance,
          "",
        ]
      : []),
    ...(params.projectContext
      ? ["Registered project AGENTS/context markdown:", params.projectContext, ""]
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
    "Use the role/core principles from REVIEWFLUX-AGENTS.md provided in system prompt.",
    "Prioritize findings JSON extraction over markdown body formatting.",
    "## Review Output Contract",
    "- The first line must match this exact string:",
    "  - 🧠 ReviewFlux Review",
    "- Add one blank line after the first line, then follow this section order:",
    "  1. ### Summary",
    "  2. ### Findings (ordered by severity) (only when issues exist)",
    "  3. ### Verification Notes",
    "- If there are no issues, omit the `### Findings` section.",
    "- Severity must be one of `[Small]`, `[Medium]`, `[High]`.",
    "- For line-specific findings, `path` must match an actual changed file in the PR diff.",
    "- For line-specific findings, `line` must be an exact commentable right-side line from the PR diff hunk.",
    "- Never use placeholder/default line numbers (for example `1`) unless the real issue is actually at that line.",
    "- If exact location cannot be verified from the diff, do not fabricate location data; keep it as a non-inline/general comment.",
    "- Do not output placeholder/meta text such as `[Pasted ...]`, `...`, `TBD`, `N/A`, `<...>`.",
    "- If information is unavailable, write `Not Verified: <reason>` with a concrete reason.",
    "",
    "Strict body template:",
    "🧠 ReviewFlux Review",
    "",
    "### Summary",
    "",
    "Write the overall judgment in 2-4 lines.",
    "",
    "### Findings (ordered by severity) <- only when issues exist",
    "",
    "- Severity: [Small]/[Medium]/[High]",
    "- Evidence: <specific file/function evidence>",
    "- Risk: <concrete impact if not fixed>",
    "- Recommendation: <specific fix direction>",
    "",
    "### Verification Notes",
    "",
    "- Verified: items actually validated from tests/types/build/static review",
    "- Not Verified: items not validated and why",
    "",
    "Use path and line only when you can confidently anchor to a changed line in the diff.",
    "If a finding is not tied to a specific line, use empty path and empty line for that finding.",
    "Return only JSON with this schema (minimum required keys are path/line/body):",
    "{",
    '  "body": "string (optional)",',
    '  "findings": [',
    '    { "path": "src/file.ts", "line": 128, "body": "- Evidence: ...\\n- Risk: ...\\n- Recommendation: ...", "severity": "Small|Medium|High (optional)" },',
    '    { "path": "", "line": "", "body": "General finding without a line anchor", "severity": "Small|Medium|High (optional)" }',
    "  ]",
    "}",
    "If there is no issue, return findings as an empty array.",
    "Do not wrap JSON in code fences.",
  ].join("\n");
}

async function createReviewComment(params: {
  config: ReviewFluxConfig;
  project: ProjectConfig;
  repo: string;
  pr: PullRequestDetail;
  reason: ReviewTriggerReason;
  basePolicyGuidance: string;
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
        basePolicyGuidance: params.basePolicyGuidance,
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

async function postReviewOutput(params: {
  repo: string;
  prNumber: number;
  prHeadSha: string;
  body: string;
  diff: string;
  inlineComments?: InlineReviewComment[];
}): Promise<void> {
  const lineIndex = parseCommentableRightSideLinesFromDiff(params.diff);

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
      await postInlineReviewComment({
        repo,
        prNumber,
        prHeadSha: params.prHeadSha,
        comment: resolvedComment,
      });
    },
    postSummaryComment: async ({ repo, prNumber }, body) =>
      postReviewComment(repo, prNumber, body),
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
  triggerComment?: {
    url?: string;
    author?: string;
  };
}): Promise<void> {
  const basePolicyGuidance = loadBasePolicyGuidance();
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
    basePolicyGuidance,
    globalAgentsGuidance,
    projectContext,
  });

  const structured = parseStructuredReviewOutput(review.raw);
  let parsedBody = structured?.inlineComments?.length
    ? buildBodyFromInlineComments(structured.inlineComments)
    : buildBestEffortFallbackBody({
        raw: structured?.body ?? review.raw,
        reason: structured
          ? "structured findings were empty"
          : "invalid model output format (expected structured JSON)",
      });

  if (params.reason === "manual_force" && params.triggerComment?.url) {
    const triggerAuthor = params.triggerComment.author?.trim();
    const triggerPrefix = triggerAuthor
      ? `Requested by @${triggerAuthor}: ${params.triggerComment.url}`
      : `Requested via trigger comment: ${params.triggerComment.url}`;
    parsedBody = parsedBody.replace(
      "### Summary\n",
      `### Summary\n${triggerPrefix}\n\n`,
    );
  }

  await postReviewOutput({
    repo: params.repo,
    prNumber: params.prNumber,
    prHeadSha: pr.head.sha,
    body: parsedBody,
    diff: review.diff,
    inlineComments: structured?.inlineComments,
  });
  console.log(
    `[reviewflux] review posted: ${params.repo}#${params.prNumber} reason=${params.reason}`,
  );
}

export async function runQueuedReviewJob(params: {
  repo: string;
  prNumber: number;
  reason: ReviewTriggerReason;
}): Promise<void> {
  const config = loadConfig();
  const project = config.projects?.[normalizeRepoKey(params.repo)] as
    | ProjectConfig
    | undefined;
  if (!project) {
    throw new Error(`project_not_configured:${params.repo}`);
  }

  await triggerReview({
    config,
    project,
    repo: params.repo,
    prNumber: params.prNumber,
    reason: params.reason,
  });
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
      triggerComment: {
        url: comment.html_url,
        author: comment.user?.login,
      },
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
      triggerComment: {
        url: comment.html_url,
        author: comment.user?.login,
      },
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
