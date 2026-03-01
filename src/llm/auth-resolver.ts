import { OAuthTokenProvider } from "../auth/oauth-token-provider.js";
import type { AppConfig } from "../config/env.js";
import type { LlmProviderName } from "./types.js";

function resolveApiKey(config: AppConfig, provider: LlmProviderName): string {
  const explicit = config.LLM_API_KEY?.trim();
  if (explicit) return explicit;

  const normalized = provider.trim().toLowerCase();
  const envCandidates = [
    `${normalized.replace(/[^a-z0-9]/g, "_").toUpperCase()}_API_KEY`,
    normalized === "google" || normalized === "google-gemini-cli" ? "GEMINI_API_KEY" : undefined,
    normalized === "openai" || normalized === "openai-codex" ? "OPENAI_API_KEY" : undefined,
  ].filter(Boolean) as string[];

  for (const keyName of envCandidates) {
    const value = process.env[keyName]?.trim();
    if (value) return value;
  }

  throw new Error(`api_key_not_found_for_provider:${provider}`);
}

function resolveProviderForAuth(params: { provider: string; authMode: "oauth" | "apikey" }): string {
  if (params.provider === "gemini") {
    return params.authMode === "oauth" ? "google-gemini-cli" : "gemini";
  }

  if (params.provider === "openai") {
    return params.authMode === "oauth" ? "openai-codex" : "openai";
  }

  return params.provider;
}

export function resolveAuthInput(params: {
  config: AppConfig;
  provider: LlmProviderName;
  model: string;
}):
  | {
      authMode: "oauth";
      provider: LlmProviderName;
      baseUrl: string;
      model: string;
      timeoutMs?: number;
      tokenProvider: OAuthTokenProvider;
    }
  | {
      authMode: "apikey";
      provider: LlmProviderName;
      baseUrl: string;
      model: string;
      timeoutMs?: number;
      apiKey: string;
    } {
  const { config, model } = params;
  const provider = resolveProviderForAuth({ provider: params.provider, authMode: config.LLM_AUTH_MODE });

  if (config.LLM_AUTH_MODE === "oauth") {
    if (provider !== "openai-codex" && provider !== "google-gemini-cli") {
      throw new Error(`oauth_not_supported_for_provider:${provider}`);
    }

    return {
      authMode: "oauth",
      provider,
      baseUrl: config.LLM_API_BASE_URL,
      model,
      timeoutMs: config.LLM_TIMEOUT_MS,
      tokenProvider: new OAuthTokenProvider({
        tokenUrl: config.OAUTH_TOKEN_URL!,
        clientId: config.OAUTH_CLIENT_ID!,
        clientSecret: config.OAUTH_CLIENT_SECRET!,
        scope: config.OAUTH_SCOPE,
        audience: config.OAUTH_AUDIENCE,
        timeoutMs: config.LLM_TIMEOUT_MS,
      }),
    };
  }

  return {
    authMode: "apikey",
    provider,
    baseUrl: config.LLM_API_BASE_URL,
    model,
    timeoutMs: config.LLM_TIMEOUT_MS,
    apiKey: resolveApiKey(config, provider),
  };
}
