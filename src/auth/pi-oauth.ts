import { getOAuthProvider, type OAuthCredentials, type OAuthLoginCallbacks } from "@mariozechner/pi-ai";
import type { LlmProvider, OAuthConfig } from "../cli/config.js";

type SupportedProvider = "openai-codex" | "google-gemini-cli";

export function resolveOAuthProviderId(provider: LlmProvider): SupportedProvider {
  if (provider === "gemini") return "google-gemini-cli";
  return "openai-codex";
}

function toOAuthCredentials(oauth: OAuthConfig): OAuthCredentials {
  const providerData = oauth.providerData ?? {};
  return {
    refresh: oauth.refreshToken ?? "",
    access: oauth.accessToken,
    expires: oauth.expiresAtEpochMs ?? Date.now() + 3600_000,
    ...(oauth.projectId ? { projectId: oauth.projectId } : {}),
    ...(oauth.accountId ? { accountId: oauth.accountId } : {}),
    ...providerData,
  };
}

function toOAuthConfig(providerId: string, creds: OAuthCredentials): OAuthConfig {
  const { refresh, access, expires, projectId, accountId, ...rest } = creds as OAuthCredentials & {
    projectId?: unknown;
    accountId?: unknown;
  };

  return {
    oauthProviderId: providerId,
    accessToken: access,
    refreshToken: refresh,
    expiresAtEpochMs: expires,
    ...(typeof projectId === "string" ? { projectId } : {}),
    ...(typeof accountId === "string" ? { accountId } : {}),
    ...(Object.keys(rest).length > 0 ? { providerData: rest } : {}),
  };
}

function getProviderForLlm(llmProvider: LlmProvider) {
  const providerId = resolveOAuthProviderId(llmProvider);
  const provider = getOAuthProvider(providerId);
  if (!provider) {
    throw new Error(`oauth_provider_not_registered:${providerId}`);
  }
  return { providerId, provider };
}

export async function loginWithPiOAuth(
  llmProvider: LlmProvider,
  callbacks: OAuthLoginCallbacks,
): Promise<OAuthConfig> {
  const { providerId, provider } = getProviderForLlm(llmProvider);
  const creds = await provider.login(callbacks);
  return toOAuthConfig(providerId, creds);
}

export async function refreshWithPiOAuth(llmProvider: LlmProvider, oauth: OAuthConfig): Promise<OAuthConfig> {
  const providerId = oauth.oauthProviderId ?? resolveOAuthProviderId(llmProvider);
  const provider = getOAuthProvider(providerId);
  if (!provider) {
    throw new Error(`oauth_provider_not_registered:${providerId}`);
  }
  const creds = toOAuthCredentials(oauth);
  if (!creds.refresh?.trim()) {
    throw new Error("oauth_refresh_missing_refresh_token");
  }
  const refreshed = await provider.refreshToken(creds);
  return toOAuthConfig(providerId, refreshed);
}

export function apiKeyFromPiOAuth(llmProvider: LlmProvider, oauth: OAuthConfig): string {
  const providerId = oauth.oauthProviderId ?? resolveOAuthProviderId(llmProvider);
  const provider = getOAuthProvider(providerId);
  if (!provider) {
    throw new Error(`oauth_provider_not_registered:${providerId}`);
  }
  return provider.getApiKey(toOAuthCredentials(oauth));
}
