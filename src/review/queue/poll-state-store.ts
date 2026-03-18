import type { ReviewQueueDatabase } from "./database";
import type {
  ProjectPollSnapshot,
  ProjectPullRequestPollState,
} from "./types";

function nowIso(): string {
  return new Date().toISOString();
}

export class ReviewPollStateStore {
  constructor(readonly database: ReviewQueueDatabase) {}

  loadProject(repoKey: string): ProjectPollSnapshot {
    const row = this.database.connection
      .prepare(
        `
          SELECT
            initialized,
            last_seen_issue_comment_id,
            last_seen_review_comment_id,
            last_manual_backstop_at,
            next_manual_backstop_at
          FROM project_poll_state
          WHERE repo_key = ?
        `,
      )
      .get(repoKey) as
      | {
          initialized: number;
          last_seen_issue_comment_id: number | null;
          last_seen_review_comment_id: number | null;
          last_manual_backstop_at: string | null;
          next_manual_backstop_at: string | null;
        }
      | undefined;

    const prRows = this.database.connection
      .prepare(
        `
          SELECT
            pr_number,
            head_sha,
            last_seen_updated_at,
            last_seen_issue_comment_id,
            last_seen_review_comment_id,
            last_targeted_refresh_at,
            next_targeted_refresh_at
          FROM project_pr_heads
          WHERE repo_key = ?
        `,
      )
      .all(repoKey) as Array<{
      pr_number: number;
      head_sha: string;
      last_seen_updated_at: string | null;
      last_seen_issue_comment_id: number | null;
      last_seen_review_comment_id: number | null;
      last_targeted_refresh_at: string | null;
      next_targeted_refresh_at: string | null;
    }>;

    const prStates = Object.fromEntries(
      prRows.map((prRow) => [
        String(prRow.pr_number),
        {
          headSha: prRow.head_sha,
          lastSeenUpdatedAt: prRow.last_seen_updated_at,
          lastSeenIssueCommentId: prRow.last_seen_issue_comment_id,
          lastSeenReviewCommentId: prRow.last_seen_review_comment_id,
          lastTargetedRefreshAt: prRow.last_targeted_refresh_at,
          nextTargetedRefreshAt: prRow.next_targeted_refresh_at,
        } satisfies ProjectPullRequestPollState,
      ]),
    );

    return {
      repoKey,
      initialized: row?.initialized === 1,
      lastSeenIssueCommentId: row?.last_seen_issue_comment_id ?? null,
      lastSeenReviewCommentId: row?.last_seen_review_comment_id ?? null,
      lastManualBackstopAt: row?.last_manual_backstop_at ?? null,
      nextManualBackstopAt: row?.next_manual_backstop_at ?? null,
      prStates,
    };
  }

  saveProject(snapshot: ProjectPollSnapshot): void {
    const updatedAt = nowIso();
    this.database.connection
      .prepare(
        `
          INSERT INTO project_poll_state (
            repo_key,
            initialized,
            last_seen_issue_comment_id,
            last_seen_review_comment_id,
            last_manual_backstop_at,
            next_manual_backstop_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(repo_key) DO UPDATE SET
            initialized=excluded.initialized,
            last_seen_issue_comment_id=excluded.last_seen_issue_comment_id,
            last_seen_review_comment_id=excluded.last_seen_review_comment_id,
            last_manual_backstop_at=excluded.last_manual_backstop_at,
            next_manual_backstop_at=excluded.next_manual_backstop_at,
            updated_at=excluded.updated_at
        `,
      )
      .run(
        snapshot.repoKey,
        snapshot.initialized ? 1 : 0,
        snapshot.lastSeenIssueCommentId,
        snapshot.lastSeenReviewCommentId,
        snapshot.lastManualBackstopAt,
        snapshot.nextManualBackstopAt,
        updatedAt,
      );

    const existingRows = this.database.connection
      .prepare(
        `
          SELECT pr_number
          FROM project_pr_heads
          WHERE repo_key = ?
        `,
      )
      .all(snapshot.repoKey) as Array<{ pr_number: number }>;
    const nextPrNumbers = new Set(
      Object.keys(snapshot.prStates).map((prNumber) => Number(prNumber)),
    );
    const deletePrState = this.database.connection.prepare(
      `
        DELETE FROM project_pr_heads
        WHERE repo_key = ? AND pr_number = ?
      `,
    );
    for (const row of existingRows) {
      if (nextPrNumbers.has(row.pr_number)) continue;
      deletePrState.run(snapshot.repoKey, row.pr_number);
    }

    const upsertPrState = this.database.connection.prepare(
      `
        INSERT INTO project_pr_heads (
          repo_key,
          pr_number,
          head_sha,
          last_seen_updated_at,
          last_seen_issue_comment_id,
          last_seen_review_comment_id,
          last_targeted_refresh_at,
          next_targeted_refresh_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(repo_key, pr_number) DO UPDATE SET
          head_sha=excluded.head_sha,
          last_seen_updated_at=excluded.last_seen_updated_at,
          last_seen_issue_comment_id=excluded.last_seen_issue_comment_id,
          last_seen_review_comment_id=excluded.last_seen_review_comment_id,
          last_targeted_refresh_at=excluded.last_targeted_refresh_at,
          next_targeted_refresh_at=excluded.next_targeted_refresh_at,
          updated_at=excluded.updated_at
      `,
    );
    for (const [prNumber, prState] of Object.entries(snapshot.prStates)) {
      upsertPrState.run(
        snapshot.repoKey,
        Number(prNumber),
        prState.headSha,
        prState.lastSeenUpdatedAt,
        prState.lastSeenIssueCommentId,
        prState.lastSeenReviewCommentId,
        prState.lastTargetedRefreshAt,
        prState.nextTargetedRefreshAt,
        updatedAt,
      );
    }
  }
}
