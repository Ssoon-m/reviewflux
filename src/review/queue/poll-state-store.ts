import type { ReviewQueueDatabase } from "./database.js";
import type { ProjectPollSnapshot } from "./types.js";

function nowIso(): string {
  return new Date().toISOString();
}

export class ReviewPollStateStore {
  constructor(readonly database: ReviewQueueDatabase) {}

  loadProject(repoKey: string): ProjectPollSnapshot {
    const row = this.database.connection
      .prepare(
        `
          SELECT initialized, last_seen_issue_comment_id, last_seen_review_comment_id
          FROM project_poll_state
          WHERE repo_key = ?
        `,
      )
      .get(repoKey) as
      | {
          initialized: number;
          last_seen_issue_comment_id: number | null;
          last_seen_review_comment_id: number | null;
        }
      | undefined;

    const heads = this.database.connection
      .prepare(
        `
          SELECT pr_number, head_sha
          FROM project_pr_heads
          WHERE repo_key = ?
        `,
      )
      .all(repoKey) as Array<{ pr_number: number; head_sha: string }>;

    return {
      repoKey,
      initialized: row?.initialized === 1,
      lastSeenIssueCommentId: row?.last_seen_issue_comment_id ?? null,
      lastSeenReviewCommentId: row?.last_seen_review_comment_id ?? null,
      prHeads: Object.fromEntries(
        heads.map((head) => [String(head.pr_number), head.head_sha]),
      ),
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
            updated_at
          ) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(repo_key) DO UPDATE SET
            initialized=excluded.initialized,
            last_seen_issue_comment_id=excluded.last_seen_issue_comment_id,
            last_seen_review_comment_id=excluded.last_seen_review_comment_id,
            updated_at=excluded.updated_at
        `,
      )
      .run(
        snapshot.repoKey,
        snapshot.initialized ? 1 : 0,
        snapshot.lastSeenIssueCommentId,
        snapshot.lastSeenReviewCommentId,
        updatedAt,
      );

    this.database.connection
      .prepare(`DELETE FROM project_pr_heads WHERE repo_key = ?`)
      .run(snapshot.repoKey);

    const insertHead = this.database.connection.prepare(
      `
        INSERT INTO project_pr_heads (repo_key, pr_number, head_sha, updated_at)
        VALUES (?, ?, ?, ?)
      `,
    );
    for (const [prNumber, headSha] of Object.entries(snapshot.prHeads)) {
      insertHead.run(snapshot.repoKey, Number(prNumber), headSha, updatedAt);
    }
  }
}
