import { describe, expect, it } from "vitest";
import type { AppConfig } from "../src/config/env";
import {
  buildModelAliasIndex,
  modelKey,
  parseModelAliasesJson,
  parseModelRef,
  resolveModelRefFromString,
  resolveRequestedModelRef,
} from "../src/llm/model-selection";
import { normalizeProviderId } from "../src/llm/provider-normalizer";
import { normalizeProviderModelId } from "../src/llm/models-config.providers";

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
  it("accepts pi-ai provider ids as-is (no aliasing)", () => {
    expect(normalizeProviderId("google")).toBe("google");
    expect(normalizeProviderId("openai-codex")).toBe("openai-codex");
  });
});

describe("model selection", () => {
  it("normalizes google/gemini preview model ids for pi-ai", () => {
    expect(normalizeProviderModelId("google", "gemini-3-pro")).toBe("gemini-3-pro-preview");
    expect(normalizeProviderModelId("google", "gemini-3-flash")).toBe("gemini-3-flash-preview");
    expect(normalizeProviderModelId("google", "gemini-3.1-pro")).toBe("gemini-3.1-pro");
  });

  it("parses model refs", () => {
    expect(parseModelRef("google/gemini-2.5-flash", "openai")).toEqual({
      provider: "google",
      model: "gemini-2.5-flash",
    });
    expect(parseModelRef("gpt-4o-mini", "openai")).toEqual({ provider: "openai", model: "gpt-4o-mini" });
  });

  it("resolves alias index", () => {
    const aliases = parseModelAliasesJson('{"fast":{"provider":"google","model":"gemini-2.5-flash"}}');
    const index = buildModelAliasIndex(aliases);
    expect(resolveModelRefFromString({ raw: "fast", defaultProvider: "openai", aliasIndex: index })).toEqual({
      provider: "google",
      model: "gemini-2.5-flash",
    });
  });

  it("resolves alias and enforces allowlist", () => {
    const config = makeConfig({
      LLM_PROVIDER: "google",
      LLM_MODEL: "fast",
      LLM_MODEL_ALIASES_JSON: '{"fast":{"provider":"google","model":"gemini-2.5-flash"}}',
      LLM_ALLOWED_MODELS: "google/gemini-2.5-flash",
    });

    const resolved = resolveRequestedModelRef(config);
    expect(resolved).toEqual({ provider: "google", model: "gemini-2.5-flash" });
    expect(modelKey(resolved)).toBe("google/gemini-2.5-flash");
  });

  it("throws when model is not allowed", () => {
    const config = makeConfig({
      LLM_PROVIDER: "openai",
      LLM_MODEL: "gpt-4o-mini",
      LLM_ALLOWED_MODELS: "openai/gpt-4.1",
    });

    expect(() => resolveRequestedModelRef(config)).toThrow("model_not_allowed:openai/gpt-4o-mini");
  });

  it("interprets unqualified allowlist entries with active provider", () => {
    const config = makeConfig({
      LLM_PROVIDER: "google",
      LLM_MODEL: "gemini-2.5-flash",
      LLM_ALLOWED_MODELS: "gemini-2.5-flash",
    });

    expect(resolveRequestedModelRef(config)).toEqual({ provider: "google", model: "gemini-2.5-flash" });
  });

  it("rejects models that are not supported by pi-ai", () => {
    const config = makeConfig({
      LLM_PROVIDER: "google",
      LLM_MODEL: "google/gemini-2.6-ultra",
    });

    expect(() => resolveRequestedModelRef(config)).toThrow("unsupported_model_for_provider:google/gemini-2.6-ultra");
  });
});
