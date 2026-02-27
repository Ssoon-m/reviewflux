import { describe, expect, it } from "vitest";
import type { AppConfig } from "../src/config/env.js";
import { resolveAuthInput } from "../src/llm/auth-resolver.js";

function makeConfig(patch: Partial<AppConfig>): AppConfig {
  return {
    LLM_PROVIDER: "openai",
    LLM_AUTH_MODE: "apikey",
    LLM_API_KEY: undefined,
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

describe("resolveAuthInput", () => {
  it("does not fallback to OPENAI_API_KEY for gemini", () => {
    const prevOpenAi = process.env.OPENAI_API_KEY;
    const prevGemini = process.env.GEMINI_API_KEY;
    process.env.OPENAI_API_KEY = "openai-key";
    delete process.env.GEMINI_API_KEY;

    const config = makeConfig({ LLM_AUTH_MODE: "apikey", LLM_PROVIDER: "gemini" });

    expect(() =>
      resolveAuthInput({
        config,
        provider: "gemini",
        model: "gemini-2.5-flash",
      }),
    ).toThrow("api_key_not_found_for_provider:gemini");

    if (prevOpenAi === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prevOpenAi;
    if (prevGemini === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prevGemini;
  });
});
