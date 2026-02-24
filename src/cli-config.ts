import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type AuthMode = "oauth" | "apikey";

export type ReviewFluxConfig = {
  appName: "reviewflux";
  llm: "codex";
  authMode: AuthMode;
  llmApiBaseUrl: string;
  model: string;
  oauth?: {
    authorizeUrl?: string;
    tokenUrl?: string;
    clientId?: string;
    redirectUri?: string;
    accessToken: string;
  };
  apiKey?: {
    key: string;
  };
};

export function getReviewFluxHome(home: string = homedir()): string {
  return join(home, "reviewflux");
}

export function getConfigPath(home: string = homedir()): string {
  return join(getReviewFluxHome(home), "config.json");
}

export function ensureReviewFluxHome(home: string = homedir()): string {
  const dir = getReviewFluxHome(home);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export function saveConfig(config: ReviewFluxConfig, home: string = homedir()): string {
  ensureReviewFluxHome(home);
  const path = getConfigPath(home);
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, "utf8");
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
