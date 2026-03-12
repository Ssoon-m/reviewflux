import { setTimeout as wait } from "node:timers/promises";
import { loadConfig, type ReviewFluxConfig } from "../../cli/config.js";
import { normalizeRepoKey } from "../../project/input.js";
import {
  assertGhReady,
  fetchIssueInfo,
  ghApiPaginatedJson,
  listOpenPullRequests,
  parseOwnerRepo,
} from "../../review/github.js";
import { runReviewJob } from "../../review/runtime.js";
import {
  buildProjectReviewState,
  loadReviewState,
  saveReviewState,
  trackSeenCommentId,
  type ProjectReviewState,
  type ReviewState,
} from "../../review/state-store.js";
import type {
  IssueComment,
  ProjectConfig,
  PullReviewComment,
  ReviewTriggerReason,
} from "../../review/types.js";

export { resolveReviewOutputFromModel } from "../../llm/review-output.js";

const FORCE_COMMAND = "@reviewflux";

function resolvePollIntervalMs(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 30_000;
  return Math.max(parsed, 5_000);
}

const POLL_INTERVAL_MS = resolvePollIntervalMs(
  process.env.REVIEWFLUX_POLL_INTERVAL_MS,
);

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

function parsePrNumberFromPullUrl(pullUrl: string): number | null {
  const match = pullUrl.match(/\/pulls\/(\d+)$/);
  if (!match) return null;
  return Number(match[1]);
}

function buildSeenCommentId(kind: "issue" | "review", id: number): string {
  return `${kind}:${id}`;
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
  if (action === "opened" && project.pr.mode === "opened_once") {
    return "opened_once";
  }
  return "on_push";
}

function parseIssueNumberFromIssueUrl(issueUrl: string): number | null {
  const match = issueUrl.match(/\/issues\/(\d+)$/);
  if (!match) return null;
  return Number(match[1]);
}

async function primeProjectState(params: {
  projectState: ProjectReviewState;
  repo: string;
  forceCommand: string;
}): Promise<void> {
  const { projectState, repo, forceCommand } = params;
  const { owner, name } = parseOwnerRepo(repo);

  const pulls = await listOpenPullRequests(repo);
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

async function pollProject(params: {
  config: ReviewFluxConfig;
  state: ReviewState;
  repo: string;
}): Promise<void> {
  const { config, state, repo } = params;
  const project = config.projects?.[normalizeRepoKey(repo)] as
    | ProjectConfig
    | undefined;
  if (!project) return;

  const { owner, name } = parseOwnerRepo(repo);
  const projectState = buildProjectReviewState(state, repo);
  const forceCommand = project.pr.forceCommand?.trim() || FORCE_COMMAND;

  if (!projectState.initialized) {
    await primeProjectState({
      projectState,
      repo,
      forceCommand,
    });
    console.log(`[reviewflux] baseline primed (no backfill): ${repo}`);
    return;
  }

  const pulls = await listOpenPullRequests(repo);
  const activeNumbers = new Set<string>();

  for (const pr of pulls) {
    const prNum = String(pr.number);
    const prevSha = projectState.prHeads[prNum];
    activeNumbers.add(prNum);

    if (!prevSha) {
      if (shouldReviewOnPrAction(project, "opened")) {
        await runReviewJob({
          config,
          project,
          repo,
          prNumber: pr.number,
          reason: resolveReasonForPrAction(project, "opened"),
          state,
        });
      }
      projectState.prHeads[prNum] = pr.head.sha;
      continue;
    }

    if (prevSha !== pr.head.sha) {
      if (shouldReviewOnPrAction(project, "synchronize")) {
        await runReviewJob({
          config,
          project,
          repo,
          prNumber: pr.number,
          reason: resolveReasonForPrAction(project, "synchronize"),
          state,
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

    const issue = await fetchIssueInfo(repo, issueNumber);
    if (!issue.pull_request) continue;

    await runReviewJob({
      config,
      project,
      repo,
      prNumber: issue.number,
      reason: "manual_force",
      state,
      manualTrigger: {
        eventName: "issue_comment",
        commentId: String(comment.id),
        commentUrl: comment.html_url,
        senderLogin: comment.user?.login,
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

    await runReviewJob({
      config,
      project,
      repo,
      prNumber,
      reason: "manual_force",
      state,
      manualTrigger: {
        eventName: "pull_request_review_comment",
        commentId: String(comment.id),
        commentUrl: comment.html_url,
        senderLogin: comment.user?.login,
        reviewReplyToCommentId: String(comment.in_reply_to_id ?? comment.id),
      },
    });
    trackSeenCommentId(projectState, seenId);
  }
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

  const state = loadReviewState();
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

    saveReviewState(state);

    try {
      await wait(POLL_INTERVAL_MS, undefined, {
        signal: abortController.signal,
      });
    } catch {
      break;
    }
  }
}
