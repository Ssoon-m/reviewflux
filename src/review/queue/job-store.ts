import type { ReviewQueueDatabase } from "./database.js";
import type {
  EnqueueReviewJobInput,
  ReviewJobRecord,
  ReviewJobStatus,
} from "./types.js";

function nowIso(): string {
  return new Date().toISOString();
}

function parseJobRow(row: {
  id: number;
  repo_key: string;
  pr_number: number;
  reason: string;
  event_name: string;
  event_key: string;
  payload_json: string;
  status: ReviewJobStatus;
  attempts: number;
  available_at: string;
  claimed_at: string | null;
  completed_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}): ReviewJobRecord {
  return {
    id: row.id,
    repoKey: row.repo_key,
    prNumber: row.pr_number,
    reason: row.reason as ReviewJobRecord["reason"],
    eventName: row.event_name,
    eventKey: row.event_key,
    payload: JSON.parse(row.payload_json) as ReviewJobRecord["payload"],
    status: row.status,
    attempts: row.attempts,
    availableAt: row.available_at,
    claimedAt: row.claimed_at,
    completedAt: row.completed_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class ReviewJobStore {
  constructor(readonly database: ReviewQueueDatabase) {}

  enqueue(job: EnqueueReviewJobInput): boolean {
    const timestamp = job.availableAt ?? nowIso();
    const result = this.database.connection
      .prepare(
        `
          INSERT OR IGNORE INTO review_jobs (
            repo_key,
            pr_number,
            reason,
            event_name,
            event_key,
            payload_json,
            status,
            attempts,
            available_at,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)
        `,
      )
      .run(
        job.repoKey,
        job.prNumber,
        job.reason,
        job.eventName,
        job.eventKey,
        JSON.stringify(job.payload),
        timestamp,
        timestamp,
        timestamp,
      );

    return result.changes > 0;
  }

  claimNextRunnableJob(now: string = nowIso()): ReviewJobRecord | null {
    return this.database.transaction(() => {
      const row = this.database.connection
        .prepare(
          `
            SELECT *
            FROM review_jobs
            WHERE status = 'pending' AND available_at <= ?
            ORDER BY available_at ASC, id ASC
            LIMIT 1
          `,
        )
        .get(now) as
        | {
            id: number;
            repo_key: string;
            pr_number: number;
            reason: string;
            event_name: string;
            event_key: string;
            payload_json: string;
            status: ReviewJobStatus;
            attempts: number;
            available_at: string;
            claimed_at: string | null;
            completed_at: string | null;
            last_error: string | null;
            created_at: string;
            updated_at: string;
          }
        | undefined;

      if (!row) return null;

      const update = this.database.connection
        .prepare(
          `
            UPDATE review_jobs
            SET status = 'running',
                attempts = attempts + 1,
                claimed_at = ?,
                updated_at = ?
            WHERE id = ? AND status = 'pending'
          `,
        )
        .run(now, now, row.id);
      if (update.changes === 0) return null;

      return parseJobRow({
        ...row,
        status: "running",
        attempts: row.attempts + 1,
        claimed_at: now,
        updated_at: now,
      });
    });
  }

  markDone(jobId: number, completedAt: string = nowIso()): void {
    this.database.connection
      .prepare(
        `
          UPDATE review_jobs
          SET status = 'done',
              completed_at = ?,
              last_error = NULL,
              updated_at = ?
          WHERE id = ?
        `,
      )
      .run(completedAt, completedAt, jobId);
  }

  retry(jobId: number, params: { error: string; availableAt: string }): void {
    this.database.connection
      .prepare(
        `
          UPDATE review_jobs
          SET status = 'pending',
              available_at = ?,
              last_error = ?,
              claimed_at = NULL,
              updated_at = ?
          WHERE id = ?
        `,
      )
      .run(params.availableAt, params.error, params.availableAt, jobId);
  }

  markFailed(jobId: number, error: string, failedAt: string = nowIso()): void {
    this.database.connection
      .prepare(
        `
          UPDATE review_jobs
          SET status = 'failed',
              last_error = ?,
              updated_at = ?
          WHERE id = ?
        `,
      )
      .run(error, failedAt, jobId);
  }

  recoverStaleRunningJobs(staleBefore: string, resetAt: string = nowIso()): number {
    const result = this.database.connection
      .prepare(
        `
          UPDATE review_jobs
          SET status = 'pending',
              claimed_at = NULL,
              updated_at = ?
          WHERE status = 'running'
            AND claimed_at IS NOT NULL
            AND claimed_at <= ?
        `,
      )
      .run(resetAt, staleBefore);

    return Number(result.changes);
  }
}
