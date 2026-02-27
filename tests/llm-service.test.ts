import { describe, expect, it } from "vitest";
import type { AppConfig } from "../src/config/env.js";
import { createLlmService } from "../src/llm/service.js";

function makeConfig(patch: Partial<AppConfig>): AppConfig {
  return {
    LLM_PROVIDER: "openai",
    LLM_AUTH_MODE: "apikey",
    LLM_API_KEY: "test-key",
    LLM_MODEL_ALIASES_JSON: undefined,
    LLM_ALLOWED_MODELS: undefined,
    OAUTH_TOKEN_URL: "https://auth.example.com/token",
    OAUTH_CLIENT_ID: "id",
    OAUTH_CLIENT_SECRET: "secret",
    OAUTH_SCOPE: undefined,
    OAUTH_AUDIENCE: undefined,
    LLM_API_BASE_URL: "https://api.openai.com/v1",
    LLM_MODEL: "gpt-4o-mini",
    LLM_TIMEOUT_MS: 30000,
    PORT: 3000,
    ...patch,
  };
}

describe("createLlmService", () => {
  it("rejects cross-provider alias when single baseUrl is configured", () => {
    const config = makeConfig({
      LLM_PROVIDER: "openai",
      LLM_MODEL: "fast",
      LLM_MODEL_ALIASES_JSON: '{"fast":{"provider":"gemini","model":"gemini-2.5-flash"}}',
    });

    expect(() => createLlmService(config)).toThrow("provider_baseurl_mismatch:openai->gemini");
  });
});
