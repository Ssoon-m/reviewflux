import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getActiveAuthProfile, getConfigPath, saveConfig, loadConfig, type ReviewFluxConfig } from "../src/cli/config.js";

describe("cli-config", () => {
  it("saves and loads config under ~/.reviewflux", () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "reviewflux-home-"));
    const config: ReviewFluxConfig = {
      appName: "reviewflux",
      llm: "codex",
      authMode: "oauth",
      llmApiBaseUrl: "https://api.openai.com/v1",
      model: "gpt-5-codex",
      oauth: {
        accessToken: "token"
      },
      auth: {
        profiles: {
          "codex:default": {
            provider: "codex",
            mode: "oauth",
            oauth: { accessToken: "token" },
          },
        },
        order: {
          codex: ["codex:default"],
        },
      },
    };

    const path = saveConfig(config, fakeHome);
    expect(path).toBe(getConfigPath(fakeHome));

    const mode = statSync(path).mode & 0o777;
    expect(mode).toBe(0o600);

    const loaded = loadConfig(fakeHome);
    expect(loaded).toEqual(config);
  });

  it("resolves active auth profile by provider order", () => {
    const config: ReviewFluxConfig = {
      appName: "reviewflux",
      llm: "gemini",
      authMode: "apikey",
      llmApiBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
      model: "gemini-2.5-flash",
      apiKey: { key: "legacy" },
      auth: {
        profiles: {
          "gemini:old": {
            provider: "gemini",
            mode: "apikey",
            apiKey: { key: "old-key" },
          },
          "gemini:default": {
            provider: "gemini",
            mode: "oauth",
            oauth: { accessToken: "new-token" },
          },
        },
        order: {
          gemini: ["gemini:default", "gemini:old"],
        },
      },
    };

    const profile = getActiveAuthProfile(config, "gemini");
    expect(profile?.mode).toBe("oauth");
  });
});
