import type { ReviewQueueDatabase } from "./database";
import type {
  EnqueueReviewJobInput,
  ReviewJobRecord,
  ReviewJobStatus,
} from "./types";

function nowIso(): string {
  return new Date().toISOString();
}

type ReviewJobRow = {
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
  worker_id: string | null;
  heartbeat_at: string | null;
  completed_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

function parseJobRow(row: ReviewJobRow): ReviewJobRecord {
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
    workerId: row.worker_id,
    heartbeatAt: row.heartbeat_at,
    completedAt: row.completed_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class ReviewJobStore {
  constructor(readonly database: ReviewQueueDatabase) {}

  getStatusSnapshot(params: { staleBefore: string }): {
    counts: Record<ReviewJobStatus, number>;
    staleRunningCount: number;
    oldestPendingAvailableAt: string | null;
    oldestRunningClaimedAt: string | null;
  } {
    const countsRow = this.database.connection
      .prepare(
        `
          SELECT
            SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
            SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running,
            SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
          FROM review_jobs
        `,
      )
      .get() as {
      pending: number | null;
      running: number | null;
      done: number | null;
      failed: number | null;
    };
    const oldestPendingRow = this.database.connection
      .prepare(
        `
          SELECT available_at
          FROM review_jobs
          WHERE status = 'pending'
          ORDER BY available_at ASC, id ASC
          LIMIT 1
        `,
      )
      .get() as { available_at: string } | undefined;
    const oldestRunningRow = this.database.connection
      .prepare(
        `
          SELECT claimed_at
          FROM review_jobs
          WHERE status = 'running' AND claimed_at IS NOT NULL
          ORDER BY claimed_at ASC, id ASC
          LIMIT 1
        `,
      )
      .get() as { claimed_at: string } | undefined;
    const staleRunningRow = this.database.connection
      .prepare(
        `
          SELECT COUNT(*) AS count
          FROM review_jobs
          WHERE status = 'running'
            AND COALESCE(heartbeat_at, claimed_at) IS NOT NULL
            AND COALESCE(heartbeat_at, claimed_at) <= ?
        `,
      )
      .get(params.staleBefore) as { count: number | bigint };

    return {
      counts: {
        pending: countsRow.pending ?? 0,
        running: countsRow.running ?? 0,
        done: countsRow.done ?? 0,
        failed: countsRow.failed ?? 0,
      },
      staleRunningCount: Number(staleRunningRow.count),
      oldestPendingAvailableAt: oldestPendingRow?.available_at ?? null,
      oldestRunningClaimedAt: oldestRunningRow?.claimed_at ?? null,
    };
  }

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

  claimNextRunnableJob(params: {
    workerId: string;
    now?: string;
  }): ReviewJobRecord | null {
    const now = params.now ?? nowIso();
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
            worker_id: string | null;
            heartbeat_at: string | null;
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
                worker_id = ?,
                heartbeat_at = ?,
                updated_at = ?
            WHERE id = ? AND status = 'pending'
          `,
        )
        .run(now, params.workerId, now, now, row.id);
      if (update.changes === 0) return null;

      return parseJobRow({
        ...row,
        status: "running",
        attempts: row.attempts + 1,
        claimed_at: now,
        worker_id: params.workerId,
        heartbeat_at: now,
        updated_at: now,
      });
    });
  }

  refreshRunningJobHeartbeat(params: {
    jobId: number;
    workerId: string;
    heartbeatAt?: string;
  }): boolean {
    const heartbeatAt = params.heartbeatAt ?? nowIso();
    const result = this.database.connection
      .prepare(
        `
          UPDATE review_jobs
          SET heartbeat_at = ?,
              updated_at = ?
          WHERE id = ?
            AND status = 'running'
            AND worker_id = ?
        `,
      )
      .run(heartbeatAt, heartbeatAt, params.jobId, params.workerId);

    return result.changes > 0;
  }

  markDone(params: {
    jobId: number;
    workerId: string;
    completedAt?: string;
  }): boolean {
    const completedAt = params.completedAt ?? nowIso();
    const result = this.database.connection
      .prepare(
        `
          UPDATE review_jobs
          SET status = 'done',
              completed_at = ?,
              last_error = NULL,
              worker_id = NULL,
              heartbeat_at = NULL,
              updated_at = ?
          WHERE id = ?
            AND status = 'running'
            AND worker_id = ?
        `,
      )
      .run(completedAt, completedAt, params.jobId, params.workerId);

    return result.changes > 0;
  }

  retry(params: {
    jobId: number;
    workerId: string;
    error: string;
    availableAt: string;
  }): boolean {
    const result = this.database.connection
      .prepare(
        `
          UPDATE review_jobs
          SET status = 'pending',
              available_at = ?,
              last_error = ?,
              claimed_at = NULL,
              worker_id = NULL,
              heartbeat_at = NULL,
              updated_at = ?
          WHERE id = ?
            AND status = 'running'
            AND worker_id = ?
        `,
      )
      .run(
        params.availableAt,
        params.error,
        params.availableAt,
        params.jobId,
        params.workerId,
      );

    return result.changes > 0;
  }

  markFailed(params: {
    jobId: number;
    workerId: string;
    error: string;
    failedAt?: string;
  }): boolean {
    const failedAt = params.failedAt ?? nowIso();
    const result = this.database.connection
      .prepare(
        `
          UPDATE review_jobs
          SET status = 'failed',
              last_error = ?,
              worker_id = NULL,
              heartbeat_at = NULL,
              updated_at = ?
          WHERE id = ?
            AND status = 'running'
            AND worker_id = ?
        `,
      )
      .run(params.error, failedAt, params.jobId, params.workerId);

    return result.changes > 0;
  }

  recoverStaleRunningJobs(staleBefore: string, resetAt: string = nowIso()): number {
    const result = this.database.connection
      .prepare(
        `
          UPDATE review_jobs
          SET status = 'pending',
              claimed_at = NULL,
              worker_id = NULL,
              heartbeat_at = NULL,
              updated_at = ?
          WHERE status = 'running'
            AND COALESCE(heartbeat_at, claimed_at) IS NOT NULL
            AND COALESCE(heartbeat_at, claimed_at) <= ?
        `,
      )
      .run(resetAt, staleBefore);

    return Number(result.changes);
  }
}
