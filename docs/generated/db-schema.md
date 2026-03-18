# Review Queue Database Snapshot

Source of truth: `src/review/queue/schema.ts`

Maintenance rule: this file is a checked-in snapshot. Update it by hand in the same change whenever `src/review/queue/schema.ts` changes. Do not treat this file as an independent source of truth.

## Schema Version
- `REVIEW_QUEUE_SCHEMA_VERSION = 3`

## Tables

### `review_queue_meta`
- `key TEXT PRIMARY KEY`
- `value TEXT NOT NULL`

### `review_runtime_state`
- `repo_key TEXT PRIMARY KEY`
- `initialized INTEGER NOT NULL DEFAULT 0`
- `pr_heads_json TEXT NOT NULL DEFAULT '{}'`
- `seen_force_comment_ids_json TEXT NOT NULL DEFAULT '[]'`
- `posted_review_keys_json TEXT NOT NULL DEFAULT '[]'`
- `handled_manual_trigger_keys_json TEXT NOT NULL DEFAULT '[]'`
- `updated_at TEXT NOT NULL`

### `project_poll_state`
- `repo_key TEXT PRIMARY KEY`
- `initialized INTEGER NOT NULL DEFAULT 0`
- `last_seen_issue_comment_id INTEGER`
- `last_seen_review_comment_id INTEGER`
- `last_manual_backstop_at TEXT`
- `next_manual_backstop_at TEXT`
- `updated_at TEXT NOT NULL`

### `project_pr_heads`
- `repo_key TEXT NOT NULL`
- `pr_number INTEGER NOT NULL`
- `head_sha TEXT NOT NULL`
- `last_seen_updated_at TEXT`
- `last_seen_issue_comment_id INTEGER`
- `last_seen_review_comment_id INTEGER`
- `last_targeted_refresh_at TEXT`
- `next_targeted_refresh_at TEXT`
- `updated_at TEXT NOT NULL`
- Primary key: `(repo_key, pr_number)`

### `review_jobs`
- `id INTEGER PRIMARY KEY AUTOINCREMENT`
- `repo_key TEXT NOT NULL`
- `pr_number INTEGER NOT NULL`
- `reason TEXT NOT NULL`
- `event_name TEXT NOT NULL`
- `event_key TEXT NOT NULL UNIQUE`
- `payload_json TEXT NOT NULL`
- `status TEXT NOT NULL`
- `attempts INTEGER NOT NULL DEFAULT 0`
- `available_at TEXT NOT NULL`
- `claimed_at TEXT`
- `worker_id TEXT`
- `heartbeat_at TEXT`
- `completed_at TEXT`
- `last_error TEXT`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`

## Indexes
- `review_jobs_claim_idx` on `(status, available_at, id)`
- `review_jobs_running_heartbeat_idx` on `(status, heartbeat_at)`
