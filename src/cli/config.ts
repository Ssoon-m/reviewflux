import { chmodSync, existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { ensureReviewFluxHome, getReviewFluxPath } from "../config/reviewflux-home.js";

export { ensureReviewFluxHome, getReviewFluxHome } from "../config/reviewflux-home.js";

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
  projects?: Record<
    string,
    {
      repo: string;
      workspaceDir?: string;
      modelAlias?: string;
      model?: { provider: LlmProvider; model: string };
      pr: {
        mode: "opened_once" | "on_push";
        forceCommand: "@reviewflux";
      };
      context?: {
        mode: "default" | "custom";
        include?: string[];
      };
    }
  >;
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

type AuthStoreFile = {
  version: 1;
  profiles?: NonNullable<NonNullable<ReviewFluxConfig["auth"]>["profiles"]>;
  order?: NonNullable<NonNullable<ReviewFluxConfig["auth"]>["order"]>;
  oauth?: ReviewFluxConfig["oauth"];
  apiKey?: ReviewFluxConfig["apiKey"];
};
export function getConfigPath(home: string = homedir()): string {
  return getReviewFluxPath(home, "config.json");
}

export function getAuthStorePath(home: string = homedir()): string {
  return getReviewFluxPath(home, "auth.json");
}

function writeConfigFile(path: string, config: Omit<ReviewFluxConfig, "auth" | "oauth" | "apiKey">): void {
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  chmodSync(path, 0o600);
}

function writeAuthStoreFile(params: {
  authPath: string;
  auth?: ReviewFluxConfig["auth"];
  apiKey?: ReviewFluxConfig["apiKey"];
}): void {
  const profiles = params.auth?.profiles;
  const hasProfiles = !!profiles && Object.keys(profiles).length > 0;
  const hasOrder = !!params.auth?.order && Object.keys(params.auth.order).length > 0;
  const hasApiKey = !!params.apiKey?.key?.trim();

  if (!hasProfiles && !hasOrder && !hasApiKey) {
    if (existsSync(params.authPath)) unlinkSync(params.authPath);
    return;
  }

  const authStore: AuthStoreFile = {
    version: 1,
    ...(hasProfiles ? { profiles } : {}),
    ...(params.auth?.order ? { order: params.auth.order } : {}),
    ...(hasApiKey ? { apiKey: params.apiKey } : {}),
  };

  writeFileSync(params.authPath, `${JSON.stringify(authStore, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  chmodSync(params.authPath, 0o600);
}

export function saveConfig(config: ReviewFluxConfig, home: string = homedir()): string {
  ensureReviewFluxHome(home);
  const path = getConfigPath(home);
  const authPath = getAuthStorePath(home);

  const { auth, oauth, apiKey, ...configWithoutSecrets } = config;

  writeAuthStoreFile({ authPath, auth, apiKey });
  writeConfigFile(path, configWithoutSecrets);

  return path;
}

function readAuthStore(
  home: string = homedir(),
): Pick<ReviewFluxConfig, "auth" | "oauth" | "apiKey"> | undefined {
  const authPath = getAuthStorePath(home);
  if (!existsSync(authPath)) return undefined;

  const raw = readFileSync(authPath, "utf8");
  const parsed = JSON.parse(raw) as Partial<AuthStoreFile>;

  const profiles = parsed.profiles && typeof parsed.profiles === "object" ? parsed.profiles : undefined;
  const order = parsed.order && typeof parsed.order === "object" ? parsed.order : undefined;
  const oauth = parsed.oauth && typeof parsed.oauth === "object" ? parsed.oauth : undefined;
  const apiKey = parsed.apiKey && typeof parsed.apiKey === "object" ? parsed.apiKey : undefined;

  if (!profiles && !order && !oauth && !apiKey) return undefined;

  const normalizedProfiles = { ...(profiles ?? {}) };
  const normalizedOrder = { ...(order ?? {}) };

  if ((!profiles || Object.keys(profiles).length === 0) && oauth?.accessToken) {
    const providerId = oauth.oauthProviderId?.trim();
    if (providerId) {
      const profileId = `${providerId}:default`;
      normalizedProfiles[profileId] = {
        provider: providerId,
        mode: "oauth",
        oauth,
      };
      normalizedOrder[providerId] = [profileId];
    }
  }

  return {
    ...(Object.keys(normalizedProfiles).length > 0 || Object.keys(normalizedOrder).length > 0
      ? {
          auth: {
            profiles: normalizedProfiles,
            ...(Object.keys(normalizedOrder).length > 0 ? { order: normalizedOrder } : {}),
          },
        }
      : {}),
    ...(apiKey ? { apiKey } : {}),
  };
}

export function loadConfig(home: string = homedir()): ReviewFluxConfig {
  const path = getConfigPath(home);
  if (!existsSync(path)) {
    throw new Error(`config_not_found:${path}`);
  }

  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw) as ReviewFluxConfig;
  const authStore = readAuthStore(home);

  if (authStore) {
    if (parsed.auth || parsed.oauth || parsed.apiKey) {
      const { auth: _auth, oauth: _oauth, apiKey: _apiKey, ...publicConfig } = parsed;
      writeConfigFile(path, publicConfig);
    }

    return {
      ...parsed,
      ...authStore,
    };
  }

  if (parsed.auth || parsed.oauth || parsed.apiKey) {
    writeAuthStoreFile({
      authPath: getAuthStorePath(home),
      auth: parsed.auth,
      apiKey: parsed.apiKey,
    });
    const { auth: _auth, oauth: _oauth, apiKey: _apiKey, ...publicConfig } = parsed;
    writeConfigFile(path, publicConfig);

    const migratedAuthStore = readAuthStore(home);
    if (migratedAuthStore) {
      return {
        ...publicConfig,
        ...migratedAuthStore,
      };
    }

    return publicConfig as ReviewFluxConfig;
  }

  return parsed;
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
