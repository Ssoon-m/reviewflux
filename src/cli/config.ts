import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type AuthMode = "oauth" | "apikey";

export type EffortLevel = "low" | "medium" | "high" | "xhigh";

export type LlmProvider = string;

export type OAuthConfig = {
  authorizeUrl?: string;
  tokenUrl?: string;
  clientId?: string;
  redirectUri?: string;
  oauthProviderId?: string;
  accessToken: string;
  refreshToken?: string;
  tokenType?: string;
  expiresAtEpochMs?: number;
  projectId?: string;
  accountId?: string;
  providerData?: Record<string, unknown>;
};

export type ApiKeyConfig = {
  key: string;
};

export type AuthProfile =
  | {
      provider: LlmProvider;
      mode: "oauth";
      oauth: OAuthConfig;
    }
  | {
      provider: LlmProvider;
      mode: "apikey";
      apiKey: ApiKeyConfig;
    };

export type ReviewFluxConfig = {
  appName: "reviewflux";
  llm: LlmProvider;
  authMode: AuthMode;
  llmApiBaseUrl: string;
  model: string;
  models?: string[];
  modelAliases?: Record<string, { provider: LlmProvider; model: string }>;
  repoModelPolicies?: Record<string, { defaultAlias?: string; taskAliases?: Record<string, string> }>;
  effort?: EffortLevel;
  // Legacy single-auth fields (kept for backwards compatibility)
  oauth?: OAuthConfig;
  apiKey?: ApiKeyConfig;
  // OpenClaw-style provider auth profiles
  auth?: {
    profiles?: Record<string, AuthProfile>;
    order?: Partial<Record<LlmProvider, string[]>>;
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

export function getActiveAuthProfile(config: ReviewFluxConfig, provider: LlmProvider): AuthProfile | undefined {
  const profiles = config.auth?.profiles;
  if (!profiles) return undefined;

  const ordered = config.auth?.order?.[provider] ?? [];
  for (const profileId of ordered) {
    const profile = profiles[profileId];
    if (profile && profile.provider === provider) return profile;
  }

  for (const profile of Object.values(profiles)) {
    if (profile.provider === provider) return profile;
  }

  return undefined;
}
