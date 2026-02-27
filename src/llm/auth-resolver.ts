import { OAuthTokenProvider } from "../auth/oauth-token-provider.js";
import type { AppConfig } from "../config/env.js";
import type { LlmProviderName } from "./types.js";

function resolveApiKey(config: AppConfig, provider: LlmProviderName): string {
  const explicit = config.LLM_API_KEY?.trim();
  if (explicit) return explicit;

  if (provider === "gemini") {
    const key = process.env.GEMINI_API_KEY?.trim();
    if (key) return key;
    throw new Error("api_key_not_found_for_provider:gemini");
  }

  const key = process.env.OPENAI_API_KEY?.trim();
  if (key) return key;

  throw new Error("api_key_not_found_for_provider:openai");
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
  const { config, provider, model } = params;

  if (config.LLM_AUTH_MODE === "oauth") {
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
