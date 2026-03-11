import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { normalizeRepoKey } from "../llm/model-routing.js";

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

function reviewStatePath(home: string = homedir()): string {
  return join(home, ".reviewflux", "daemon-state.json");
}

function normalizeProjectReviewState(
  state: Partial<ProjectReviewState> | undefined,
): ProjectReviewState {
  return {
    initialized: state?.initialized ?? false,
    prHeads: state?.prHeads ?? {},
    seenForceCommentIds: state?.seenForceCommentIds ?? [],
    postedReviewKeys: state?.postedReviewKeys ?? [],
    handledManualTriggerKeys: state?.handledManualTriggerKeys ?? [],
  };
}

export function loadReviewState(home: string = homedir()): ReviewState {
  const path = reviewStatePath(home);
  if (!existsSync(path)) {
    return { projects: {} };
  }

  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<ReviewState>;
    const projects = Object.fromEntries(
      Object.entries(parsed.projects ?? {}).map(([repo, state]) => [
        repo,
        normalizeProjectReviewState(state),
      ]),
    );
    return { projects };
  } catch {
    return { projects: {} };
  }
}

export function saveReviewState(
  state: ReviewState,
  home: string = homedir(),
): void {
  const path = reviewStatePath(home);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
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
    projectState.seenForceCommentIds = projectState.seenForceCommentIds.slice(-500);
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
