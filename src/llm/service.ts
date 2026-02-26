import { OAuthTokenProvider } from "../auth/oauth-token-provider.js";
import type { AppConfig } from "../config/env.js";
import { resolveModelRef } from "./model-ref.js";
import { createLlmProvider } from "./factory.js";
import type { LlmProvider } from "./types.js";

export function parseModelAliasesJson(raw?: string) {
  if (!raw?.trim()) return {};
  const parsed = JSON.parse(raw) as Record<string, { provider: "openai" | "gemini"; model: string }>;
  return Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k.toLowerCase(), v]));
}

export function createLlmService(config: AppConfig): LlmProvider {
  const aliases = parseModelAliasesJson(config.LLM_MODEL_ALIASES_JSON);
  const modelRef = resolveModelRef({ raw: config.LLM_MODEL, defaultProvider: config.LLM_PROVIDER, aliases });

  if (config.LLM_AUTH_MODE === "oauth") {
    return createLlmProvider({
      authMode: "oauth",
      provider: modelRef.provider,
      baseUrl: config.LLM_API_BASE_URL,
      model: modelRef.model,
      timeoutMs: config.LLM_TIMEOUT_MS,
      tokenProvider: new OAuthTokenProvider({
        tokenUrl: config.OAUTH_TOKEN_URL!,
        clientId: config.OAUTH_CLIENT_ID!,
        clientSecret: config.OAUTH_CLIENT_SECRET!,
        scope: config.OAUTH_SCOPE,
        audience: config.OAUTH_AUDIENCE,
        timeoutMs: config.LLM_TIMEOUT_MS,
      }),
    });
  }

  return createLlmProvider({
    authMode: "apikey",
    provider: modelRef.provider,
    baseUrl: config.LLM_API_BASE_URL,
    model: modelRef.model,
    timeoutMs: config.LLM_TIMEOUT_MS,
    apiKey: config.LLM_API_KEY!,
  });
}
