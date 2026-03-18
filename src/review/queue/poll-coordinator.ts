import { logging } from "../../infra/logging/index";
import { normalizeRepoKey } from "../../lib/repo/input";
import {
  fetchIssueInfo,
  ghApiPaginatedJson,
  listOpenPullRequests,
  listPullRequestIssueComments,
  listPullRequestReviewComments,
  parseOwnerRepo,
} from "../github";
import type {
  IssueComment,
  ProjectConfig,
  PullRequestSummary,
  PullReviewComment,
  ReviewTriggerReason,
} from "../types";
import {
  buildAutomaticReviewEventKey,
  buildManualReviewEventKey,
} from "./event-key";
import type { ReviewJobStore } from "./job-store";
import type { ReviewPollStateStore } from "./poll-state-store";
import type {
  EnqueueReviewJobInput,
  ProjectPollSnapshot,
  ProjectPullRequestPollState,
} from "./types";

type AutomaticReviewReason = Exclude<ReviewTriggerReason, "manual_force">;

const FORCE_COMMAND = "@reviewflux";
const DEFAULT_POLL_INTERVAL_MS = Math.max(
  resolvePositiveInt(process.env.REVIEWFLUX_POLL_INTERVAL_MS, 30_000),
  5_000,
);
const TARGETED_REFRESH_INTERVAL_MS = Math.max(
  resolvePositiveInt(
    process.env.REVIEWFLUX_POLL_TARGETED_REFRESH_INTERVAL_MS,
    DEFAULT_POLL_INTERVAL_MS,
  ),
  5_000,
);
const MANUAL_BACKSTOP_INTERVAL_MS = Math.max(
  resolvePositiveInt(
    process.env.REVIEWFLUX_POLL_MANUAL_SWEEP_INTERVAL_MS,
    10 * 60_000,
  ),
  DEFAULT_POLL_INTERVAL_MS,
);

function resolvePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function nowIso(): string {
  return new Date().toISOString();
}

function addMilliseconds(iso: string, milliseconds: number): string {
  return new Date(Date.parse(iso) + milliseconds).toISOString();
}

function isDeadlineDue(deadline: string | null, now: string): boolean {
  return deadline !== null && deadline <= now;
}

function isManualBackstopDue(deadline: string | null, now: string): boolean {
  return deadline === null || deadline <= now;
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

function shouldReviewOnPrAction(
  project: ProjectConfig,
  action: "opened" | "synchronize",
): boolean {
  if (project.pr.mode === "opened_once") {
    return action === "opened";
  }
  return action === "opened" || action === "synchronize";
}

function resolveReasonForPrAction(
  project: ProjectConfig,
  action: "opened" | "synchronize",
): AutomaticReviewReason {
  if (action === "opened" && project.pr.mode === "opened_once") {
    return "opened_once";
  }
  return "on_push";
}

function maxCommentId<T extends { id: number }>(comments: T[]): number | null {
  const [firstComment, ...restComments] = comments;
  if (!firstComment) return null;
  return restComments.reduce(
    (max, comment) => Math.max(max, comment.id),
    firstComment.id,
  );
}

function sortByCommentId<T extends { id: number }>(comments: T[]): T[] {
  return [...comments].sort((left, right) => left.id - right.id);
}

function buildInitialPrPollState(
  pullRequest: PullRequestSummary,
): ProjectPullRequestPollState {
  return {
    headSha: pullRequest.head.sha,
    lastSeenUpdatedAt: pullRequest.updated_at ?? null,
    lastSeenIssueCommentId: null,
    lastSeenReviewCommentId: null,
    lastTargetedRefreshAt: null,
    nextTargetedRefreshAt: null,
  };
}

function buildAutomaticReviewJob(params: {
  repo: string;
  repoKey: string;
  prNumber: number;
  reason: AutomaticReviewReason;
  prHeadSha: string;
}): EnqueueReviewJobInput {
  return {
    repoKey: params.repoKey,
    prNumber: params.prNumber,
    reason: params.reason,
    eventName: "pull_request",
    eventKey: buildAutomaticReviewEventKey({
      repo: params.repo,
      prNumber: params.prNumber,
      reason: params.reason,
      prHeadSha: params.prHeadSha,
    }),
    payload: {
      repo: params.repoKey,
      prNumber: params.prNumber,
      reason: params.reason,
    },
  };
}

function buildIssueCommentManualJob(params: {
  repoKey: string;
  prNumber: number;
  comment: IssueComment;
}): EnqueueReviewJobInput {
  const manualTrigger = {
    eventName: "issue_comment" as const,
    commentId: String(params.comment.id),
    commentUrl: params.comment.html_url,
    senderLogin: params.comment.user?.login,
  };
  return {
    repoKey: params.repoKey,
    prNumber: params.prNumber,
    reason: "manual_force",
    eventName: manualTrigger.eventName,
    eventKey: buildManualReviewEventKey(manualTrigger),
    payload: {
      repo: params.repoKey,
      prNumber: params.prNumber,
      reason: "manual_force",
      manualTrigger,
    },
  };
}

function buildReviewCommentManualJob(params: {
  repoKey: string;
  prNumber: number;
  comment: PullReviewComment;
}): EnqueueReviewJobInput {
  const manualTrigger = {
    eventName: "pull_request_review_comment" as const,
    commentId: String(params.comment.id),
    commentUrl: params.comment.html_url,
    senderLogin: params.comment.user?.login,
    reviewReplyToCommentId: String(
      params.comment.in_reply_to_id ?? params.comment.id,
    ),
  };
  return {
    repoKey: params.repoKey,
    prNumber: params.prNumber,
    reason: "manual_force",
    eventName: manualTrigger.eventName,
    eventKey: buildManualReviewEventKey(manualTrigger),
    payload: {
      repo: params.repoKey,
      prNumber: params.prNumber,
      reason: "manual_force",
      manualTrigger,
    },
  };
}

function logPollBaselinePrimed(repoKey: string): void {
  logging({
    surface: "queue-poller",
    type: "queue",
    level: "info",
    event: "poll_baseline_primed",
    message: "Poll baseline primed",
    context: {
      repo: repoKey,
    },
  });
}

function logPollJobsEnqueued(
  repoKey: string,
  jobs: EnqueueReviewJobInput[],
): void {
  let automaticCount = 0;
  let manualCount = 0;

  for (const job of jobs) {
    if (job.reason === "manual_force") {
      manualCount += 1;
      continue;
    }

    automaticCount += 1;
  }

  logging({
    surface: "queue-poller",
    type: "queue",
    level: "info",
    event: "poll_jobs_enqueued",
    message: "Poll jobs enqueued",
    context: {
      repo: repoKey,
      automaticCount,
      manualCount,
    },
  });
}

export class ReviewPollCoordinator {
  constructor(
    private readonly pollStateStore: ReviewPollStateStore,
    private readonly jobStore: ReviewJobStore,
  ) {}

  async pollProject(project: ProjectConfig): Promise<void> {
    const repoKey = normalizeRepoKey(project.repo);
    const forceCommand = project.pr.forceCommand?.trim() || FORCE_COMMAND;
    const snapshot = this.pollStateStore.loadProject(repoKey);
    const now = nowIso();

    if (!snapshot.initialized) {
      await this.primeProject(project, snapshot, now);
      logPollBaselinePrimed(repoKey);
      return;
    }

    const nextSnapshot = await this.buildNextSnapshot(
      project,
      snapshot,
      forceCommand,
      now,
    );
    this.persistSnapshot(nextSnapshot);
    if (nextSnapshot.jobs.length > 0) {
      logPollJobsEnqueued(snapshot.repoKey, nextSnapshot.jobs);
    }
  }

  private async primeProject(
    project: ProjectConfig,
    snapshot: ProjectPollSnapshot,
    now: string,
  ): Promise<void> {
    const { owner, name } = parseOwnerRepo(project.repo);
    const [pulls, issueComments, reviewComments] = await Promise.all([
      listOpenPullRequests(project.repo),
      ghApiPaginatedJson<IssueComment>(`repos/${owner}/${name}/issues/comments`),
      ghApiPaginatedJson<PullReviewComment>(
        `repos/${owner}/${name}/pulls/comments`,
      ),
    ]);

    const nextSnapshot: ProjectPollSnapshot = {
      repoKey: snapshot.repoKey,
      initialized: true,
      lastSeenIssueCommentId: maxCommentId(issueComments),
      lastSeenReviewCommentId: maxCommentId(reviewComments),
      lastManualBackstopAt: now,
      nextManualBackstopAt: addMilliseconds(now, MANUAL_BACKSTOP_INTERVAL_MS),
      prStates: Object.fromEntries(
        pulls.map((pullRequest) => [
          String(pullRequest.number),
          buildInitialPrPollState(pullRequest),
        ]),
      ),
    };
    this.persistSnapshot(nextSnapshot);
  }

  private async buildNextSnapshot(
    project: ProjectConfig,
    snapshot: ProjectPollSnapshot,
    forceCommand: string,
    now: string,
  ): Promise<{ snapshot: ProjectPollSnapshot; jobs: EnqueueReviewJobInput[] }> {
    const jobs: EnqueueReviewJobInput[] = [];
    const pulls = await listOpenPullRequests(project.repo);
    const nextPrStates: Record<string, ProjectPullRequestPollState> = {};
    const targetedRefreshes: Array<{
      pullRequest: PullRequestSummary;
      scheduleFollowUp: boolean;
    }> = [];

    for (const pullRequest of pulls) {
      const prKey = String(pullRequest.number);
      const previousState = snapshot.prStates[prKey] ?? null;
      const remoteUpdatedAt = pullRequest.updated_at ?? null;

      if (!previousState) {
        nextPrStates[prKey] = buildInitialPrPollState(pullRequest);
        if (shouldReviewOnPrAction(project, "opened")) {
          const reason = resolveReasonForPrAction(project, "opened");
          jobs.push(
            buildAutomaticReviewJob({
              repo: project.repo,
              repoKey: snapshot.repoKey,
              prNumber: pullRequest.number,
              reason,
              prHeadSha: pullRequest.head.sha,
            }),
          );
        }
        targetedRefreshes.push({ pullRequest, scheduleFollowUp: true });
        continue;
      }

      const headChanged = previousState.headSha !== pullRequest.head.sha;
      const updatedAtChanged = previousState.lastSeenUpdatedAt !== remoteUpdatedAt;
      const targetedRefreshDue = isDeadlineDue(
        previousState.nextTargetedRefreshAt,
        now,
      );

      nextPrStates[prKey] = {
        ...previousState,
        headSha: pullRequest.head.sha,
        lastSeenUpdatedAt: remoteUpdatedAt,
      };

      if (headChanged && shouldReviewOnPrAction(project, "synchronize")) {
        const reason = resolveReasonForPrAction(project, "synchronize");
        jobs.push(
          buildAutomaticReviewJob({
            repo: project.repo,
            repoKey: snapshot.repoKey,
            prNumber: pullRequest.number,
            reason,
            prHeadSha: pullRequest.head.sha,
          }),
        );
      }

      if (headChanged || updatedAtChanged || targetedRefreshDue) {
        targetedRefreshes.push({
          pullRequest,
          scheduleFollowUp: headChanged || updatedAtChanged,
        });
      }
    }

    for (const targetedRefresh of targetedRefreshes) {
      const prKey = String(targetedRefresh.pullRequest.number);
      const currentState = nextPrStates[prKey];
      const refreshed = await this.refreshPullRequest({
        project,
        repoSnapshot: snapshot,
        prNumber: targetedRefresh.pullRequest.number,
        prState: currentState,
        forceCommand,
        now,
        scheduleFollowUp: targetedRefresh.scheduleFollowUp,
      });
      nextPrStates[prKey] = refreshed.prState;
      jobs.push(...refreshed.jobs);
    }

    let lastSeenIssueCommentId = snapshot.lastSeenIssueCommentId;
    let lastSeenReviewCommentId = snapshot.lastSeenReviewCommentId;
    let lastManualBackstopAt = snapshot.lastManualBackstopAt;
    let nextManualBackstopAt = snapshot.nextManualBackstopAt;

    if (isManualBackstopDue(snapshot.nextManualBackstopAt, now)) {
      const manualBackstop = await this.runManualBackstop({
        project,
        repoSnapshot: snapshot,
        forceCommand,
        now,
      });
      lastSeenIssueCommentId = manualBackstop.lastSeenIssueCommentId;
      lastSeenReviewCommentId = manualBackstop.lastSeenReviewCommentId;
      lastManualBackstopAt = manualBackstop.lastManualBackstopAt;
      nextManualBackstopAt = manualBackstop.nextManualBackstopAt;
      jobs.push(...manualBackstop.jobs);
    }

    return {
      snapshot: {
        repoKey: snapshot.repoKey,
        initialized: true,
        lastSeenIssueCommentId,
        lastSeenReviewCommentId,
        lastManualBackstopAt,
        nextManualBackstopAt,
        prStates: nextPrStates,
      },
      jobs,
    };
  }

  private async refreshPullRequest(params: {
    project: ProjectConfig;
    repoSnapshot: ProjectPollSnapshot;
    prNumber: number;
    prState: ProjectPullRequestPollState;
    forceCommand: string;
    now: string;
    scheduleFollowUp: boolean;
  }): Promise<{
    prState: ProjectPullRequestPollState;
    jobs: EnqueueReviewJobInput[];
  }> {
    const [issueComments, reviewComments] = await Promise.all([
      listPullRequestIssueComments(params.project.repo, params.prNumber),
      listPullRequestReviewComments(params.project.repo, params.prNumber),
    ]);
    const jobs: EnqueueReviewJobInput[] = [];
    const issueCursor =
      params.prState.lastSeenIssueCommentId ??
      params.repoSnapshot.lastSeenIssueCommentId;
    const reviewCursor =
      params.prState.lastSeenReviewCommentId ??
      params.repoSnapshot.lastSeenReviewCommentId;

    for (const comment of sortByCommentId(issueComments)) {
      if (issueCursor !== null && comment.id <= issueCursor) {
        continue;
      }
      if (!containsForceCommand(comment.body, params.forceCommand)) continue;
      jobs.push(
        buildIssueCommentManualJob({
          repoKey: params.repoSnapshot.repoKey,
          prNumber: params.prNumber,
          comment,
        }),
      );
    }

    for (const comment of sortByCommentId(reviewComments)) {
      if (reviewCursor !== null && comment.id <= reviewCursor) {
        continue;
      }
      if (!containsForceCommand(comment.body, params.forceCommand)) continue;
      jobs.push(
        buildReviewCommentManualJob({
          repoKey: params.repoSnapshot.repoKey,
          prNumber: params.prNumber,
          comment,
        }),
      );
    }

    const shouldFollowUp = params.scheduleFollowUp || jobs.length > 0;

    return {
      prState: {
        ...params.prState,
        lastSeenIssueCommentId: maxCommentId(issueComments) ?? issueCursor,
        lastSeenReviewCommentId: maxCommentId(reviewComments) ?? reviewCursor,
        lastTargetedRefreshAt: params.now,
        nextTargetedRefreshAt: shouldFollowUp
          ? addMilliseconds(params.now, TARGETED_REFRESH_INTERVAL_MS)
          : null,
      },
      jobs,
    };
  }

  private async runManualBackstop(params: {
    project: ProjectConfig;
    repoSnapshot: ProjectPollSnapshot;
    forceCommand: string;
    now: string;
  }): Promise<{
    lastSeenIssueCommentId: number | null;
    lastSeenReviewCommentId: number | null;
    lastManualBackstopAt: string;
    nextManualBackstopAt: string;
    jobs: EnqueueReviewJobInput[];
  }> {
    const { owner, name } = parseOwnerRepo(params.project.repo);
    const [issueComments, reviewComments] = await Promise.all([
      ghApiPaginatedJson<IssueComment>(`repos/${owner}/${name}/issues/comments`),
      ghApiPaginatedJson<PullReviewComment>(
        `repos/${owner}/${name}/pulls/comments`,
      ),
    ]);
    const jobs: EnqueueReviewJobInput[] = [];

    for (const comment of sortByCommentId(issueComments)) {
      if (
        params.repoSnapshot.lastSeenIssueCommentId !== null &&
        comment.id <= params.repoSnapshot.lastSeenIssueCommentId
      ) {
        continue;
      }
      if (!containsForceCommand(comment.body, params.forceCommand)) continue;

      const issueNumber = parseIssueNumberFromIssueUrl(comment.issue_url);
      if (!issueNumber) continue;
      const issue = await fetchIssueInfo(params.project.repo, issueNumber);
      if (!issue.pull_request) continue;

      jobs.push(
        buildIssueCommentManualJob({
          repoKey: params.repoSnapshot.repoKey,
          prNumber: issue.number,
          comment,
        }),
      );
    }

    for (const comment of sortByCommentId(reviewComments)) {
      if (
        params.repoSnapshot.lastSeenReviewCommentId !== null &&
        comment.id <= params.repoSnapshot.lastSeenReviewCommentId
      ) {
        continue;
      }
      if (!containsForceCommand(comment.body, params.forceCommand)) continue;

      const prNumber = parsePrNumberFromPullUrl(comment.pull_request_url);
      if (!prNumber) continue;

      jobs.push(
        buildReviewCommentManualJob({
          repoKey: params.repoSnapshot.repoKey,
          prNumber,
          comment,
        }),
      );
    }

    return {
      lastSeenIssueCommentId:
        maxCommentId(issueComments) ?? params.repoSnapshot.lastSeenIssueCommentId,
      lastSeenReviewCommentId:
        maxCommentId(reviewComments) ??
        params.repoSnapshot.lastSeenReviewCommentId,
      lastManualBackstopAt: params.now,
      nextManualBackstopAt: addMilliseconds(
        params.now,
        MANUAL_BACKSTOP_INTERVAL_MS,
      ),
      jobs,
    };
  }

  private persistSnapshot(params: {
    snapshot: ProjectPollSnapshot;
    jobs: EnqueueReviewJobInput[];
  }): void;
  private persistSnapshot(snapshot: ProjectPollSnapshot): void;
  private persistSnapshot(
    input:
      | ProjectPollSnapshot
      | { snapshot: ProjectPollSnapshot; jobs: EnqueueReviewJobInput[] },
  ): void {
    if ("repoKey" in input) {
      this.pollStateStore.saveProject(input);
      return;
    }

    const { snapshot, jobs } = input;
    this.jobStore.database.transaction(() => {
      for (const job of jobs) {
        this.jobStore.enqueue(job);
      }
      this.pollStateStore.saveProject(snapshot);
    });
  }
}
