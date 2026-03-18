import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ensureReviewFluxHome,
  getActiveAuthProfile,
  getAuthStorePath,
  getConfigPath,
  loadConfig,
  type ReviewFluxConfig,
  saveConfig,
} from "../src/cli/config";
import {
  ensureReviewFluxLogsDir,
  getReviewFluxHome,
  getReviewFluxLogsDir,
} from "../src/config/reviewflux-home";

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
    expect(existsSync(getAuthStorePath(fakeHome))).toBe(true);

    const mode = statSync(path).mode & 0o777;
    expect(mode).toBe(0o600);

    const authMode = statSync(getAuthStorePath(fakeHome)).mode & 0o777;
    expect(authMode).toBe(0o600);

    const savedConfigRaw = JSON.parse(readFileSync(path, "utf8")) as ReviewFluxConfig;
    expect(savedConfigRaw.auth).toBeUndefined();
    expect(savedConfigRaw.oauth).toBeUndefined();
    expect(savedConfigRaw.apiKey).toBeUndefined();

    const savedAuthRaw = JSON.parse(readFileSync(getAuthStorePath(fakeHome), "utf8")) as {
      oauth?: { accessToken?: string };
      profiles?: Record<string, unknown>;
    };
    expect(savedAuthRaw.oauth).toBeUndefined();
    expect(Object.keys(savedAuthRaw.profiles ?? {}).length).toBeGreaterThan(0);

    const loaded = loadConfig(fakeHome);
    expect(loaded.oauth).toBeUndefined();
    expect(loaded.auth?.profiles?.["codex:default"]).toBeDefined();
  });

  it("builds ReviewFlux config and log paths from the raw user home once", () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "reviewflux-home-"));
    const reviewFluxHome = ensureReviewFluxHome(fakeHome);
    const logsDir = ensureReviewFluxLogsDir(fakeHome);

    expect(reviewFluxHome).toBe(getReviewFluxHome(fakeHome));
    expect(reviewFluxHome).toBe(join(fakeHome, ".reviewflux"));
    expect(getConfigPath(fakeHome)).toBe(join(fakeHome, ".reviewflux", "config.json"));
    expect(getAuthStorePath(fakeHome)).toBe(join(fakeHome, ".reviewflux", "auth.json"));
    expect(logsDir).toBe(getReviewFluxLogsDir(fakeHome));
    expect(logsDir).toBe(join(fakeHome, ".reviewflux", "logs"));
    expect(existsSync(logsDir)).toBe(true);
    expect(statSync(logsDir).mode & 0o777).toBe(0o700);
    expect(getConfigPath(fakeHome)).not.toContain(join(".reviewflux", ".reviewflux"));
    expect(getAuthStorePath(fakeHome)).not.toContain(join(".reviewflux", ".reviewflux"));
    expect(logsDir).not.toContain(join(".reviewflux", ".reviewflux"));
  });

  it("resolves active auth profile by provider order", () => {
    const config: ReviewFluxConfig = {
      appName: "reviewflux",
      llm: "google",
      authMode: "apikey",
      llmApiBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
      model: "gemini-2.5-flash",
      apiKey: { key: "legacy" },
      auth: {
        profiles: {
          "google:old": {
            provider: "google",
            mode: "apikey",
            apiKey: { key: "old-key" },
          },
          "google:default": {
            provider: "google",
            mode: "oauth",
            oauth: { accessToken: "new-token" },
          },
        },
        order: {
          google: ["google:default", "google:old"],
        },
      },
    };

    const profile = getActiveAuthProfile(config, "google");
    expect(profile?.mode).toBe("oauth");
  });

  it("migrates inline secrets from config.json into auth.json", () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "reviewflux-home-"));
    ensureReviewFluxHome(fakeHome);

    const legacyConfig: ReviewFluxConfig = {
      appName: "reviewflux",
      llm: "openai-codex",
      authMode: "oauth",
      llmApiBaseUrl: "https://api.openai.com/v1",
      model: "gpt-5-codex",
      oauth: { accessToken: "legacy-token" },
      auth: {
        profiles: {
          "openai-codex:default": {
            provider: "openai-codex",
            mode: "oauth",
            oauth: { accessToken: "legacy-token" },
          },
        },
      },
    };

    writeFileSync(getConfigPath(fakeHome), `${JSON.stringify(legacyConfig, null, 2)}\n`, "utf8");

    const loaded = loadConfig(fakeHome);
    expect(loaded.oauth).toBeUndefined();
    expect(loaded.auth?.profiles?.["openai-codex:default"]).toBeDefined();

    const migratedConfigRaw = JSON.parse(readFileSync(getConfigPath(fakeHome), "utf8")) as ReviewFluxConfig;
    expect(migratedConfigRaw.oauth).toBeUndefined();
    expect(migratedConfigRaw.auth).toBeUndefined();

    const authRaw = JSON.parse(readFileSync(getAuthStorePath(fakeHome), "utf8")) as {
      oauth?: { accessToken?: string };
      profiles?: Record<string, unknown>;
    };
    expect(authRaw.oauth).toBeUndefined();
    expect(authRaw.profiles?.["openai-codex:default"]).toBeDefined();
  });

  it("preserves auth order even when auth store has no profiles", () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "reviewflux-home-"));

    const config: ReviewFluxConfig = {
      appName: "reviewflux",
      llm: "google",
      authMode: "oauth",
      llmApiBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
      model: "gemini-2.5-pro",
      oauth: { accessToken: "legacy-token" },
      auth: {
        order: {
          google: ["google:default"],
        },
      },
    };

    saveConfig(config, fakeHome);
    const loaded = loadConfig(fakeHome);

    expect(loaded.auth?.order?.google).toEqual(["google:default"]);
    expect(loaded.auth?.profiles).toEqual({});
  });
});
