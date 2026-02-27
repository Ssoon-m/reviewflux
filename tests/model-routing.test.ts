import { describe, expect, it } from "vitest";
import { ModelRouter, normalizeRepoKey, resolveModel, type RoutingConfig } from "../src/llm/model-routing.js";

describe("model routing", () => {
  const config: RoutingConfig = {
    defaultAlias: "codex",
    aliases: {
      codex: { provider: "openai-codex", model: "gpt-5.3-codex" },
      gemini: { provider: "google", model: "gemini-2.5-pro" },
      "gemini-fast": { provider: "google", model: "gemini-2.5-flash" },
    },
    repoPolicies: {
      "ssoon-m/coin-auto-trading": {
        defaultAlias: "gemini",
        taskAliases: {
          summary: "gemini-fast",
        },
      },
    },
  };

  it("uses global default when no repo/task override exists", () => {
    const router = new ModelRouter(config);
    expect(router.resolve()).toEqual({ provider: "openai-codex", model: "gpt-5.3-codex" });
    expect(resolveModel(config)).toEqual({ provider: "openai-codex", model: "gpt-5.3-codex" });
  });

  it("uses repo default alias when repo policy exists", () => {
    expect(resolveModel(config, { repo: "Ssoon-m/coin-auto-trading" })).toEqual({
      provider: "google",
      model: "gemini-2.5-pro",
    });
  });

  it("uses task-specific alias over repo default", () => {
    expect(resolveModel(config, { repo: "ssoon-m/coin-auto-trading", task: "summary" })).toEqual({
      provider: "google",
      model: "gemini-2.5-flash",
    });
  });

  it("uses explicit alias override over everything", () => {
    expect(resolveModel(config, { repo: "ssoon-m/coin-auto-trading", aliasOverride: "codex" })).toEqual({
      provider: "openai-codex",
      model: "gpt-5.3-codex",
    });
  });

  it("normalizes repo keys", () => {
    expect(normalizeRepoKey(" Ssoon-m/Coin-Auto-Trading ")).toBe("ssoon-m/coin-auto-trading");
  });

  it("throws when alias does not exist", () => {
    expect(() => resolveModel(config, { aliasOverride: "missing" })).toThrow("llm_alias_not_found:missing");
  });
});
