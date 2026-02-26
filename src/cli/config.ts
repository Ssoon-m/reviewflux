import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type AuthMode = "oauth" | "apikey";

export type EffortLevel = "low" | "medium" | "high" | "xhigh";

export type ReviewFluxConfig = {
  appName: "reviewflux";
  llm: "codex";
  authMode: AuthMode;
  llmApiBaseUrl: string;
  model: string;
  models?: string[];
  effort?: EffortLevel;
  oauth?: {
    authorizeUrl?: string;
    tokenUrl?: string;
    clientId?: string;
    redirectUri?: string;
    accessToken: string;
    refreshToken?: string;
    tokenType?: string;
    expiresAtEpochMs?: number;
  };
  apiKey?: {
    key: string;
  };
};

export function getReviewFluxHome(home: string = homedir()): string {
  return join(home, ".reviewflux");
}

export function getConfigPath(home: string = homedir()): string {
  return join(getReviewFluxHome(home), "config.json");
}

export function ensureReviewFluxHome(home: string = homedir()): string {
  const dir = getReviewFluxHome(home);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  chmodSync(dir, 0o700);
  return dir;
}

export function saveConfig(config: ReviewFluxConfig, home: string = homedir()): string {
  ensureReviewFluxHome(home);
  const path = getConfigPath(home);
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  chmodSync(path, 0o600);
  return path;
}

export function loadConfig(home: string = homedir()): ReviewFluxConfig {
  const path = getConfigPath(home);
  if (!existsSync(path)) {
    throw new Error(`config_not_found:${path}`);
  }

  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw) as ReviewFluxConfig;
}
