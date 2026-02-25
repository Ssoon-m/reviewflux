import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getConfigPath, saveConfig, loadConfig, type ReviewFluxConfig } from "../src/cli-config.js";

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
      }
    };

    const path = saveConfig(config, fakeHome);
    expect(path).toBe(getConfigPath(fakeHome));

    const mode = statSync(path).mode & 0o777;
    expect(mode).toBe(0o600);

    const loaded = loadConfig(fakeHome);
    expect(loaded).toEqual(config);
  });
});
