import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function getReviewFluxHome(home: string = homedir()): string {
  return join(home, ".reviewflux");
}

export function getReviewFluxPath(
  home: string = homedir(),
  ...pathSegments: string[]
): string {
  return join(getReviewFluxHome(home), ...pathSegments);
}

export function ensureReviewFluxHome(home: string = homedir()): string {
  const dir = getReviewFluxHome(home);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  chmodSync(dir, 0o700);
  return dir;
}

export function getReviewFluxLogsDir(home: string = homedir()): string {
  return getReviewFluxPath(home, "logs");
}

export function ensureReviewFluxLogsDir(home: string = homedir()): string {
  ensureReviewFluxHome(home);
  const dir = getReviewFluxLogsDir(home);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  chmodSync(dir, 0o700);
  return dir;
}
