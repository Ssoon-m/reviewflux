import type { DatabaseSync } from "node:sqlite";

export const REVIEW_QUEUE_SCHEMA_VERSION = 1;

export function bootstrapReviewQueueSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS review_queue_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS review_runtime_state (
      repo_key TEXT PRIMARY KEY,
      initialized INTEGER NOT NULL DEFAULT 0,
      pr_heads_json TEXT NOT NULL DEFAULT '{}',
      seen_force_comment_ids_json TEXT NOT NULL DEFAULT '[]',
      posted_review_keys_json TEXT NOT NULL DEFAULT '[]',
      handled_manual_trigger_keys_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS project_poll_state (
      repo_key TEXT PRIMARY KEY,
      initialized INTEGER NOT NULL DEFAULT 0,
      last_seen_issue_comment_id INTEGER,
      last_seen_review_comment_id INTEGER,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS project_pr_heads (
      repo_key TEXT NOT NULL,
      pr_number INTEGER NOT NULL,
      head_sha TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (repo_key, pr_number)
    );

    CREATE TABLE IF NOT EXISTS review_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_key TEXT NOT NULL,
      pr_number INTEGER NOT NULL,
      reason TEXT NOT NULL,
      event_name TEXT NOT NULL,
      event_key TEXT NOT NULL UNIQUE,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      available_at TEXT NOT NULL,
      claimed_at TEXT,
      completed_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS review_jobs_claim_idx
      ON review_jobs (status, available_at, id);
  `);

  db.prepare(`
    INSERT INTO review_queue_meta (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value
  `).run("schema_version", String(REVIEW_QUEUE_SCHEMA_VERSION));
}

