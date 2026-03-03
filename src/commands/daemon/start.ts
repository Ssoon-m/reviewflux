import { execFile } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { loadConfig, type ReviewFluxConfig } from "../../cli/config.js";
import { normalizeRepoKey } from "../../llm/model-routing.js";
import { buildProjectContextText } from "../../llm/project-context.js";

type PullRequestSummary = {
  number: number;
  head: { sha: string };
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
  prHeads: Record<string, string>;
  seenForceCommentIds: string[];
};

type DaemonState = {
  projects: Record<string, ProjectPollState>;
};

type ProjectConfig = {
  repo: string;
  workspaceDir: string;
  modelAlias?: string;
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

const FORCE_COMMAND = "@reviewflux";
const POLL_INTERVAL_MS = Number(process.env.REVIEWFLUX_POLL_INTERVAL_MS ?? "30000");

function daemonStatePath(home: string = homedir()): string {
  return join(home, ".reviewflux", "daemon-state.json");
}

function loadDaemonState(home: string = homedir()): DaemonState {
  const path = daemonStatePath(home);
  if (!existsSync(path)) {
    return { projects: {} };
  }

  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<DaemonState>;
    return {
      projects: parsed.projects ?? {},
    };
  } catch {
    return { projects: {} };
  }
}

function saveDaemonState(state: DaemonState, home: string = homedir()): void {
  writeFileSync(daemonStatePath(home), `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
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
    execFile("gh", args, { encoding: "utf8" }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr.trim() || error.message));
        return;
      }
      resolve(stdout);
    });
  });
}

async function ghApiJson<T>(path: string): Promise<T> {
  const output = await ghExec(["api", path]);
  return JSON.parse(output) as T;
}

function containsForceCommand(body?: string): boolean {
  if (!body) return false;
  return /(^|\s)@reviewflux\b/i.test(body);
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
  if (existing) return existing;

  const created: ProjectPollState = {
    prHeads: {},
    seenForceCommentIds: [],
  };
  state.projects[key] = created;
  return created;
}

function trackSeenCommentId(projectState: ProjectPollState, id: string): void {
  if (projectState.seenForceCommentIds.includes(id)) return;
  projectState.seenForceCommentIds.push(id);
  if (projectState.seenForceCommentIds.length > 500) {
    projectState.seenForceCommentIds = projectState.seenForceCommentIds.slice(-500);
  }
}

function shouldReviewOnPrAction(project: ProjectConfig, action: string): boolean {
  if (project.pr.mode === "opened_once") {
    return action === "opened";
  }
  return action === "opened" || action === "synchronize";
}

function buildReviewSystemPrompt(params: {
  repo: string;
  prNumber: number;
  reason: ReviewTriggerReason;
  projectContext: string;
}): string {
  return [
    "You are ReviewFlux, a pull request review assistant.",
    `Repository: ${params.repo}`,
    `Pull Request: #${params.prNumber}`,
    `Trigger reason: ${params.reason}`,
    ...(params.projectContext
      ? ["", "Project markdown context:", params.projectContext]
      : []),
  ].join("\n");
}

function emitReviewTrigger(params: {
  repo: string;
  prNumber: number;
  reason: ReviewTriggerReason;
  projectContext: string;
}): void {
  const systemPrompt = buildReviewSystemPrompt({
    repo: params.repo,
    prNumber: params.prNumber,
    reason: params.reason,
    projectContext: params.projectContext,
  });

  console.log(`[reviewflux] review trigger: ${params.repo}#${params.prNumber} reason=${params.reason}`);
  console.log(`[reviewflux] system prompt prepared (${systemPrompt.length} chars)`);
}

async function pollProject(config: ReviewFluxConfig, state: DaemonState, repo: string): Promise<void> {
  const project = config.projects?.[normalizeRepoKey(repo)];
  if (!project) return;

  const projectContext = buildProjectContextText({
    workspaceDir: project.workspaceDir,
    context: project.context,
  });

  const { owner, name } = parseOwnerRepo(repo);
  const projectState = buildProjectState(state, repo);

  const pulls = await ghApiJson<PullRequestSummary[]>(`repos/${owner}/${name}/pulls?state=open&per_page=100`);
  const activeNumbers = new Set<string>();

  for (const pr of pulls) {
    const prNum = String(pr.number);
    const prevSha = projectState.prHeads[prNum];
    activeNumbers.add(prNum);

    if (!prevSha) {
      if (shouldReviewOnPrAction(project, "opened")) {
        emitReviewTrigger({ repo, prNumber: pr.number, reason: "opened_once", projectContext });
      }
      projectState.prHeads[prNum] = pr.head.sha;
      continue;
    }

    if (prevSha !== pr.head.sha) {
      if (shouldReviewOnPrAction(project, "synchronize")) {
        emitReviewTrigger({ repo, prNumber: pr.number, reason: "on_push", projectContext });
      }
      projectState.prHeads[prNum] = pr.head.sha;
    }
  }

  for (const number of Object.keys(projectState.prHeads)) {
    if (!activeNumbers.has(number)) {
      delete projectState.prHeads[number];
    }
  }

  const issueComments = await ghApiJson<IssueComment[]>(`repos/${owner}/${name}/issues/comments?per_page=100`);
  for (const comment of issueComments) {
    if (!containsForceCommand(comment.body)) continue;
    const seenId = `issue:${comment.id}`;
    if (projectState.seenForceCommentIds.includes(seenId)) continue;

    const issueNumber = parseIssueNumberFromIssueUrl(comment.issue_url);
    if (!issueNumber) continue;

    const issue = await ghApiJson<IssueInfo>(`repos/${owner}/${name}/issues/${issueNumber}`);
    if (!issue.pull_request) continue;

    emitReviewTrigger({ repo, prNumber: issue.number, reason: "manual_force", projectContext });
    trackSeenCommentId(projectState, seenId);
  }

  const reviewComments = await ghApiJson<PullReviewComment[]>(`repos/${owner}/${name}/pulls/comments?per_page=100`);
  for (const comment of reviewComments) {
    if (!containsForceCommand(comment.body)) continue;
    const seenId = `review:${comment.id}`;
    if (projectState.seenForceCommentIds.includes(seenId)) continue;

    const prNumber = parsePrNumberFromPullUrl(comment.pull_request_url);
    if (!prNumber) continue;

    emitReviewTrigger({ repo, prNumber, reason: "manual_force", projectContext });
    trackSeenCommentId(projectState, seenId);
  }
}

async function assertGhReady(): Promise<void> {
  await ghExec(["--version"]);
  await ghExec(["auth", "status"]);
}

export async function runDaemonStartCommand(): Promise<void> {
  const config = loadConfig();
  const projects = Object.values(config.projects ?? {}).sort((a, b) => a.repo.localeCompare(b.repo));

  console.log("[reviewflux] daemon start");

  if (projects.length === 0) {
    console.log("[reviewflux] no projects configured. run: reviewflux project add");
    return;
  }

  await assertGhReady();

  console.log(`[reviewflux] gh polling mode enabled (${POLL_INTERVAL_MS}ms)`);
  console.log(`[reviewflux] tracking ${projects.length} project(s)`);
  for (const project of projects) {
    const modelAlias = project.modelAlias ?? "<default>";
    const contextInfo =
      project.context?.mode === "custom"
        ? `custom:${(project.context.include ?? []).join(",")}`
        : "default:AGENTS.md";
    console.log(`- ${project.repo} | mode=${project.pr.mode} | model=${modelAlias} | context=${contextInfo}`);
  }
  console.log(`[reviewflux] force command is always enabled: ${FORCE_COMMAND}`);

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
        await pollProject(config, state, project.repo);
      } catch (error) {
        console.error(`[reviewflux] polling failed for ${project.repo}`);
        console.error(error instanceof Error ? error.message : String(error));
      }
    }

    saveDaemonState(state);

    try {
      await wait(POLL_INTERVAL_MS, undefined, { signal: abortController.signal });
    } catch {
      break;
    }
  }
}
