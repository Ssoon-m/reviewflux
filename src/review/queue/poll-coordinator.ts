import { normalizeRepoKey } from "../../project/input.js";
import {
  buildAutomaticReviewEventKey,
  buildManualReviewEventKey,
} from "./event-key.js";
import type { ReviewJobStore } from "./job-store.js";
import type { ReviewPollStateStore } from "./poll-state-store.js";
import type { EnqueueReviewJobInput, ProjectPollSnapshot } from "./types.js";
import {
  fetchIssueInfo,
  ghApiPaginatedJson,
  listOpenPullRequests,
  parseOwnerRepo,
} from "../github.js";
import type {
  IssueComment,
  ProjectConfig,
  PullReviewComment,
  ReviewTriggerReason,
} from "../types.js";

type AutomaticReviewReason = Exclude<ReviewTriggerReason, "manual_force">;

const FORCE_COMMAND = "@reviewflux";

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
  if (comments.length === 0) return null;
  return comments.reduce(
    (max, comment) => Math.max(max, comment.id),
    comments[0]!.id,
  );
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

    if (!snapshot.initialized) {
      await this.primeProject(project, snapshot);
      console.log(`[reviewflux] baseline primed (no backfill): ${repoKey}`);
      return;
    }

    const nextSnapshot = await this.buildNextSnapshot(
      project,
      snapshot,
      forceCommand,
    );
    this.persistSnapshot(nextSnapshot);
  }

  private async primeProject(
    project: ProjectConfig,
    snapshot: ProjectPollSnapshot,
  ): Promise<void> {
    const { owner, name } = parseOwnerRepo(project.repo);
    const pulls = await listOpenPullRequests(project.repo);
    const issueComments = await ghApiPaginatedJson<IssueComment>(
      `repos/${owner}/${name}/issues/comments`,
    );
    const reviewComments = await ghApiPaginatedJson<PullReviewComment>(
      `repos/${owner}/${name}/pulls/comments`,
    );

    const nextSnapshot: ProjectPollSnapshot = {
      repoKey: snapshot.repoKey,
      initialized: true,
      lastSeenIssueCommentId: maxCommentId(issueComments),
      lastSeenReviewCommentId: maxCommentId(reviewComments),
      prHeads: Object.fromEntries(
        pulls.map((pr) => [String(pr.number), pr.head.sha]),
      ),
    };
    this.persistSnapshot(nextSnapshot);
  }

  private async buildNextSnapshot(
    project: ProjectConfig,
    snapshot: ProjectPollSnapshot,
    forceCommand: string,
  ): Promise<{ snapshot: ProjectPollSnapshot; jobs: EnqueueReviewJobInput[] }> {
    const jobs: EnqueueReviewJobInput[] = [];
    const pulls = await listOpenPullRequests(project.repo);
    const nextPrHeads: Record<string, string> = {};

    for (const pr of pulls) {
      const prKey = String(pr.number);
      const prevSha = snapshot.prHeads[prKey];
      nextPrHeads[prKey] = pr.head.sha;

      if (!prevSha) {
        if (shouldReviewOnPrAction(project, "opened")) {
          const reason = resolveReasonForPrAction(project, "opened");
          jobs.push({
            repoKey: snapshot.repoKey,
            prNumber: pr.number,
            reason,
            eventName: "pull_request",
            eventKey: buildAutomaticReviewEventKey({
              repo: project.repo,
              prNumber: pr.number,
              reason,
              prHeadSha: pr.head.sha,
            }),
            payload: {
              repo: snapshot.repoKey,
              prNumber: pr.number,
              reason,
            },
          });
        }
        continue;
      }

      if (
        prevSha !== pr.head.sha &&
        shouldReviewOnPrAction(project, "synchronize")
      ) {
        const reason = resolveReasonForPrAction(project, "synchronize");
        jobs.push({
          repoKey: snapshot.repoKey,
          prNumber: pr.number,
          reason,
          eventName: "pull_request",
          eventKey: buildAutomaticReviewEventKey({
            repo: project.repo,
            prNumber: pr.number,
            reason,
            prHeadSha: pr.head.sha,
          }),
          payload: {
            repo: snapshot.repoKey,
            prNumber: pr.number,
            reason,
          },
        });
      }
    }

    const { owner, name } = parseOwnerRepo(project.repo);
    const issueComments = await ghApiPaginatedJson<IssueComment>(
      `repos/${owner}/${name}/issues/comments`,
    );
    const reviewComments = await ghApiPaginatedJson<PullReviewComment>(
      `repos/${owner}/${name}/pulls/comments`,
    );

    const sortedIssueComments = [...issueComments].sort((a, b) => a.id - b.id);
    for (const comment of sortedIssueComments) {
      if (
        snapshot.lastSeenIssueCommentId !== null &&
        comment.id <= snapshot.lastSeenIssueCommentId
      ) {
        continue;
      }
      if (!containsForceCommand(comment.body, forceCommand)) continue;

      const issueNumber = parseIssueNumberFromIssueUrl(comment.issue_url);
      if (!issueNumber) continue;
      const issue = await fetchIssueInfo(project.repo, issueNumber);
      if (!issue.pull_request) continue;

      const manualTrigger = {
        eventName: "issue_comment" as const,
        commentId: String(comment.id),
        commentUrl: comment.html_url,
        senderLogin: comment.user?.login,
      };
      jobs.push({
        repoKey: snapshot.repoKey,
        prNumber: issue.number,
        reason: "manual_force",
        eventName: manualTrigger.eventName,
        eventKey: buildManualReviewEventKey(manualTrigger),
        payload: {
          repo: snapshot.repoKey,
          prNumber: issue.number,
          reason: "manual_force",
          manualTrigger,
        },
      });
    }

    const sortedReviewComments = [...reviewComments].sort(
      (a, b) => a.id - b.id,
    );
    for (const comment of sortedReviewComments) {
      if (
        snapshot.lastSeenReviewCommentId !== null &&
        comment.id <= snapshot.lastSeenReviewCommentId
      ) {
        continue;
      }
      if (!containsForceCommand(comment.body, forceCommand)) continue;

      const prNumber = parsePrNumberFromPullUrl(comment.pull_request_url);
      if (!prNumber) continue;

      const manualTrigger = {
        eventName: "pull_request_review_comment" as const,
        commentId: String(comment.id),
        commentUrl: comment.html_url,
        senderLogin: comment.user?.login,
        reviewReplyToCommentId: String(comment.in_reply_to_id ?? comment.id),
      };
      jobs.push({
        repoKey: snapshot.repoKey,
        prNumber,
        reason: "manual_force",
        eventName: manualTrigger.eventName,
        eventKey: buildManualReviewEventKey(manualTrigger),
        payload: {
          repo: snapshot.repoKey,
          prNumber,
          reason: "manual_force",
          manualTrigger,
        },
      });
    }

    return {
      snapshot: {
        repoKey: snapshot.repoKey,
        initialized: true,
        lastSeenIssueCommentId:
          maxCommentId(issueComments) ?? snapshot.lastSeenIssueCommentId,
        lastSeenReviewCommentId:
          maxCommentId(reviewComments) ?? snapshot.lastSeenReviewCommentId,
        prHeads: nextPrHeads,
      },
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
