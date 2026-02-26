import { describe, expect, it } from "vitest";
import type { AppConfig } from "../src/config/env.js";
import { resolveRequestedModelRef } from "../src/llm/model-policy.js";
import { normalizeProviderId } from "../src/llm/provider-normalizer.js";

function makeConfig(patch: Partial<AppConfig>): AppConfig {
  return {
    LLM_PROVIDER: "openai",
    LLM_AUTH_MODE: "apikey",
    LLM_API_KEY: "test-key",
    LLM_MODEL_ALIASES_JSON: undefined,
    LLM_ALLOWED_MODELS: undefined,
    OAUTH_TOKEN_URL: undefined,
    OAUTH_CLIENT_ID: undefined,
    OAUTH_CLIENT_SECRET: undefined,
    OAUTH_SCOPE: undefined,
    OAUTH_AUDIENCE: undefined,
    LLM_API_BASE_URL: "https://api.openai.com/v1",
    LLM_MODEL: "gpt-4o-mini",
    LLM_TIMEOUT_MS: 30_000,
    PORT: 3000,
    ...patch,
  };
}

describe("provider normalizer", () => {
  it("normalizes aliases", () => {
    expect(normalizeProviderId("google")).toBe("gemini");
    expect(normalizeProviderId("openai-codex")).toBe("openai");
  });
});

describe("model policy", () => {
  it("resolves alias and enforces allowlist", () => {
    const config = makeConfig({
      LLM_PROVIDER: "gemini",
      LLM_MODEL: "fast",
      LLM_MODEL_ALIASES_JSON: '{"fast":{"provider":"gemini","model":"gemini-2.5-flash"}}',
      LLM_ALLOWED_MODELS: "gemini/gemini-2.5-flash",
    });

    expect(resolveRequestedModelRef(config)).toEqual({ provider: "gemini", model: "gemini-2.5-flash" });
  });

  it("throws when model is not allowed", () => {
    const config = makeConfig({
      LLM_PROVIDER: "openai",
      LLM_MODEL: "gpt-4o-mini",
      LLM_ALLOWED_MODELS: "openai/gpt-4.1",
    });

    expect(() => resolveRequestedModelRef(config)).toThrow("model_not_allowed:openai/gpt-4o-mini");
  });
});
