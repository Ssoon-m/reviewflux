import { homedir } from "node:os";
import { normalizeRepoKey } from "../lib/repo/input.js";
import { ReviewQueueDatabase } from "./queue/database.js";

export type ProjectReviewState = {
  initialized: boolean;
  prHeads: Record<string, string>;
  seenForceCommentIds: string[];
  postedReviewKeys: string[];
  handledManualTriggerKeys: string[];
};

export type ReviewState = {
  projects: Record<string, ProjectReviewState>;
};

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function normalizeStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function parseJson<T>(input: string, fallback: T): T {
  try {
    return JSON.parse(input) as T;
  } catch {
    return fallback;
  }
}

function normalizeProjectReviewState(
  state: Partial<ProjectReviewState> | undefined,
): ProjectReviewState {
  return {
    initialized: state?.initialized ?? false,
    prHeads: normalizeStringRecord(state?.prHeads),
    seenForceCommentIds: normalizeStringArray(state?.seenForceCommentIds),
    postedReviewKeys: normalizeStringArray(state?.postedReviewKeys),
    handledManualTriggerKeys: normalizeStringArray(
      state?.handledManualTriggerKeys,
    ),
  };
}

export function loadReviewState(home: string = homedir()): ReviewState {
  const database = new ReviewQueueDatabase({ home });

  try {
    const rows = database.connection.prepare(
      `
        SELECT
          repo_key,
          initialized,
          pr_heads_json,
          seen_force_comment_ids_json,
          posted_review_keys_json,
          handled_manual_trigger_keys_json
        FROM review_runtime_state
      `,
    ).all() as Array<{
      repo_key: string;
      initialized: number;
      pr_heads_json: string;
      seen_force_comment_ids_json: string;
      posted_review_keys_json: string;
      handled_manual_trigger_keys_json: string;
    }>;

    const projects = Object.fromEntries(
      rows.map((row) => [
        row.repo_key,
        normalizeProjectReviewState({
          initialized: row.initialized === 1,
          prHeads: parseJson(row.pr_heads_json, {}),
          seenForceCommentIds: parseJson(row.seen_force_comment_ids_json, []),
          postedReviewKeys: parseJson(row.posted_review_keys_json, []),
          handledManualTriggerKeys: parseJson(
            row.handled_manual_trigger_keys_json,
            [],
          ),
        }),
      ]),
    );
    return { projects };
  } finally {
    database.close();
  }
}

export function saveReviewState(
  state: ReviewState,
  home: string = homedir(),
): void {
  const database = new ReviewQueueDatabase({ home });
  const updatedAt = new Date().toISOString();

  try {
    database.transaction(() => {
      database.connection.exec(`DELETE FROM review_runtime_state`);
      const statement = database.connection.prepare(
        `
          INSERT INTO review_runtime_state (
            repo_key,
            initialized,
            pr_heads_json,
            seen_force_comment_ids_json,
            posted_review_keys_json,
            handled_manual_trigger_keys_json,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
      );

      for (const [repoKey, projectState] of Object.entries(state.projects)) {
        const normalized = normalizeProjectReviewState(projectState);
        statement.run(
          repoKey,
          normalized.initialized ? 1 : 0,
          JSON.stringify(normalized.prHeads),
          JSON.stringify(normalized.seenForceCommentIds),
          JSON.stringify(normalized.postedReviewKeys),
          JSON.stringify(normalized.handledManualTriggerKeys),
          updatedAt,
        );
      }
    });
  } finally {
    database.close();
  }
}

export function buildProjectReviewState(
  state: ReviewState,
  repo: string,
): ProjectReviewState {
  const key = normalizeRepoKey(repo);
  const existing = state.projects[key];
  if (existing) {
    const normalized = normalizeProjectReviewState(existing);
    state.projects[key] = normalized;
    return normalized;
  }

  const created = normalizeProjectReviewState(undefined);
  state.projects[key] = created;
  return created;
}

export function trackSeenCommentId(
  projectState: ProjectReviewState,
  id: string,
): void {
  if (projectState.seenForceCommentIds.includes(id)) return;
  projectState.seenForceCommentIds.push(id);
  if (projectState.seenForceCommentIds.length > 500) {
    projectState.seenForceCommentIds =
      projectState.seenForceCommentIds.slice(-500);
  }
}

export function trackPostedReviewKey(
  projectState: ProjectReviewState,
  key: string,
): void {
  if (projectState.postedReviewKeys.includes(key)) return;
  projectState.postedReviewKeys.push(key);
  if (projectState.postedReviewKeys.length > 1000) {
    projectState.postedReviewKeys = projectState.postedReviewKeys.slice(-1000);
  }
}

export function hasHandledManualTriggerKey(
  projectState: ProjectReviewState,
  key: string,
): boolean {
  return projectState.handledManualTriggerKeys.includes(key);
}

export function trackHandledManualTriggerKey(
  projectState: ProjectReviewState,
  key: string,
): void {
  if (projectState.handledManualTriggerKeys.includes(key)) return;
  projectState.handledManualTriggerKeys.push(key);
  if (projectState.handledManualTriggerKeys.length > 1000) {
    projectState.handledManualTriggerKeys =
      projectState.handledManualTriggerKeys.slice(-1000);
  }
}
