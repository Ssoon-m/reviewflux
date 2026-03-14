import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  runSetupFlow,
  type SetupFlowCollaborators,
} from "../src/commands/setup/index.js";

type SetupLogRecord = {
  ts: string;
  date: string;
  surface: "setup";
  type: "lifecycle" | "auth" | "queue" | "review" | "system";
  level: "info" | "warn" | "error";
  event: string;
  message: string;
  context: Record<string, string | number | boolean | undefined>;
};

type PromptSelectFn = NonNullable<SetupFlowCollaborators["promptSelect"]>;
type PromptPasswordFn = NonNullable<SetupFlowCollaborators["promptPassword"]>;
type EnsureHomeFn = NonNullable<SetupFlowCollaborators["ensureReviewFluxHome"]>;
type EnsureGuidanceFn = NonNullable<
  SetupFlowCollaborators["ensureGlobalAgentsTemplate"]
>;
type SaveConfigFn = NonNullable<SetupFlowCollaborators["saveConfig"]>;
type ReleaseInputFn = NonNullable<
  SetupFlowCollaborators["releaseInteractiveInput"]
>;
type ProviderGroupsFn = NonNullable<
  SetupFlowCollaborators["getProviderGroupsForSelection"]
>;
type GetSelectableModelsFn = NonNullable<
  SetupFlowCollaborators["getSelectableModelsForProvider"]
>;
type GetModelsFn = NonNullable<SetupFlowCollaborators["getModels"]>;
type GetModelFn = NonNullable<SetupFlowCollaborators["getModel"]>;
type GetOauthProvidersFn = NonNullable<
  SetupFlowCollaborators["getOAuthProviders"]
>;
type GetOauthProviderFn = NonNullable<
  SetupFlowCollaborators["getOAuthProvider"]
>;
type GetCodexEffortLevelsFn = NonNullable<
  SetupFlowCollaborators["getCodexEffortLevels"]
>;
type OAuthLoginFn = NonNullable<SetupFlowCollaborators["loginWithPiOAuth"]>;
type OpenBrowserFn = NonNullable<SetupFlowCollaborators["openBrowser"]>;
type OAuthCallbacks = Parameters<OAuthLoginFn>[1];
type OAuthConfig = Awaited<ReturnType<OAuthLoginFn>>;

const homes: string[] = [];
const originalHome = process.env.HOME;

function makeTempHome(): string {
  const home = mkdtempSync(join(tmpdir(), "reviewflux-setup-logging-"));
  homes.push(home);
  return home;
}

function reviewFluxHome(home: string): string {
  return join(home, ".reviewflux");
}

function setupLogPath(home: string, date: string): string {
  return join(reviewFluxHome(home), "logs", `setup-${date}.jsonl`);
}

function readSetupLog(home: string, date: string): {
  raw: string;
  records: SetupLogRecord[];
} {
  const raw = readFileSync(setupLogPath(home, date), "utf8");
  return {
    raw,
    records: raw
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as SetupLogRecord),
  };
}

function summarizedRecords(records: SetupLogRecord[]) {
  return records.map(({ event, type, level, message, context }) => ({
    event,
    type,
    level,
    message,
    context,
  }));
}

function normalizedConsoleLines(lines: string[]): string[] {
  return lines.map((line) => line.trim()).filter((line) => line.length > 0);
}

function createBaseCollaborators(
  home: string,
  overrides: SetupFlowCollaborators,
): SetupFlowCollaborators {
  const ensureReviewFluxHome = ((targetHome: string) =>
    reviewFluxHome(targetHome)) as EnsureHomeFn;
  const ensureGlobalAgentsTemplate = (() => ({
    created: false,
    source: "existing guidance",
  })) as EnsureGuidanceFn;
  const saveConfig = (() => join(reviewFluxHome(home), "config.json")) as SaveConfigFn;
  const releaseInteractiveInput = vi.fn() as ReleaseInputFn;
  const getProviderGroupsForSelection = (() => []) as ProviderGroupsFn;
  const getSelectableModelsForProvider = ((provider: string) => [
    { id: `${provider}-model`, name: `${provider} model` },
  ]) as GetSelectableModelsFn;
  const getModels = (() => [{ baseUrl: "https://api.example.test/v1" }]) as GetModelsFn;
  const getModel = (() => ({ id: "stub-model" })) as GetModelFn;
  const getOAuthProviders = (() => []) as GetOauthProvidersFn;
  const getOAuthProvider = (() => undefined) as GetOauthProviderFn;
  const getCodexEffortLevels = (() => ["medium"] as const) as GetCodexEffortLevelsFn;

  return {
    home,
    ensureReviewFluxHome,
    ensureGlobalAgentsTemplate,
    saveConfig,
    releaseInteractiveInput,
    getProviderGroupsForSelection,
    getSelectableModelsForProvider,
    getModels,
    getModel,
    getOAuthProviders,
    getOAuthProvider,
    getCodexEffortLevels,
    ...overrides,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { recursive: true, force: true });
  }

  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }

  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("setup logging", () => {
  it("logs skip and global guidance events without changing console strings", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-14T09:00:00.000Z"));

    const home = makeTempHome();
    process.env.HOME = home;

    const consoleLines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((value?: unknown) => {
      consoleLines.push(String(value ?? ""));
    });

    const promptSelect = (async () => "__skip__") as PromptSelectFn;
    const getProviderGroupsForSelection = (() => [
      {
        groupKey: "openai",
        groupLabel: "OpenAI",
        providers: ["openai"],
        hint: "API key",
      },
    ]) as ProviderGroupsFn;
    const ensureGlobalAgentsTemplate = (() => ({
      created: true,
      source: "fixture template",
    })) as EnsureGuidanceFn;

    await runSetupFlow(
      { advanced: false },
      createBaseCollaborators(home, {
        promptSelect,
        getProviderGroupsForSelection,
        ensureGlobalAgentsTemplate,
      }),
    );

    const { raw, records } = readSetupLog(home, "2026-03-14");
    expect(summarizedRecords(records)).toEqual([
      {
        event: "setup_started",
        type: "lifecycle",
        level: "info",
        message: "Setup started",
        context: { advanced: false },
      },
      {
        event: "global_guidance_created",
        type: "lifecycle",
        level: "info",
        message: "Global guidance created",
        context: { advanced: false },
      },
      {
        event: "setup_skipped",
        type: "lifecycle",
        level: "info",
        message: "Setup skipped",
        context: { advanced: false, outcome: "skipped" },
      },
    ]);
    expect(raw).not.toContain("fixture template");

    expect(normalizedConsoleLines(consoleLines)).toEqual(
      expect.arrayContaining([
        "[reviewflux] setup started",
        `[reviewflux] config directory: ${reviewFluxHome(home)}`,
        `[reviewflux] created global review guidance: ${join(reviewFluxHome(home), "AGENTS.md")}`,
        "[reviewflux] setup skipped. Run reviewflux setup again when ready.",
      ]),
    );
  });

  it("persists only safe semantic oauth events and redacts urls codes and tokens", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-14T10:00:00.000Z"));

    const home = makeTempHome();
    process.env.HOME = home;

    const verificationUrl = "https://verify.example/device?user_code=ABCD-EFGH";
    const redirectUrl = "http://localhost:1455/auth/callback?code=oauth-secret&state=stale-state";
    const accessToken = "access-token-secret";
    const refreshToken = "refresh-token-secret";
    const deviceCode = "ABCD-EFGH";

    const consoleLines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((value?: unknown) => {
      consoleLines.push(String(value ?? ""));
    });

    const promptSelect = (async ({ message }: { message: string }) => {
      if (message === "Model/auth provider") return "openai";
      if (message === "OAuth setup method") return "browser";
      if (message === "Select default model (OAuth verified)") return "gpt-5";
      if (message.startsWith("Select reasoning effort")) return "medium";
      throw new Error(`Unexpected promptSelect message: ${message}`);
    }) as PromptSelectFn;
    const getProviderGroupsForSelection = (() => [
      {
        groupKey: "openai",
        groupLabel: "OpenAI",
        providers: ["openai-codex"],
        hint: "OAuth",
      },
    ]) as ProviderGroupsFn;
    const getSelectableModelsForProvider = (() => [
      { id: "gpt-5", name: "GPT-5" },
    ]) as GetSelectableModelsFn;
    const getModels = (() => [
      { baseUrl: "https://api.example.test/v1" },
    ]) as GetModelsFn;
    const getModel = (() => ({ id: "gpt-5" })) as GetModelFn;
    const getOAuthProviders = (() => [
      { id: "openai-codex" },
    ]) as GetOauthProvidersFn;
    const getOAuthProvider = (() => ({
      usesCallbackServer: true,
    })) as GetOauthProviderFn;
    const openBrowserResults = [false, true];
    const openBrowser = vi.fn(() => {
      return openBrowserResults.shift() ?? false;
    }) as OpenBrowserFn;
    let attempt = 0;
    const loginWithPiOAuth = (async (
      _provider: string,
      callbacks: OAuthCallbacks,
    ) => {
      attempt += 1;
      callbacks.onAuth?.({
        url: attempt === 1 ? verificationUrl : redirectUrl,
        instructions: `Enter code: ${deviceCode}\nReturn to ${redirectUrl}`,
      });
      if (attempt === 1) {
        throw new Error("OAuth state mismatch");
      }
      return {
        oauthProviderId: "openai-codex",
        accessToken,
        refreshToken,
      } as OAuthConfig;
    }) as OAuthLoginFn;

    await runSetupFlow(
      { advanced: false },
      createBaseCollaborators(home, {
        promptSelect,
        getProviderGroupsForSelection,
        getSelectableModelsForProvider,
        getModels,
        getModel,
        getOAuthProviders,
        getOAuthProvider,
        openBrowser,
        loginWithPiOAuth,
      }),
    );

    const { raw, records } = readSetupLog(home, "2026-03-14");
    expect(summarizedRecords(records)).toEqual([
      {
        event: "setup_started",
        type: "lifecycle",
        level: "info",
        message: "Setup started",
        context: { advanced: false },
      },
      {
        event: "oauth_authorization_required",
        type: "auth",
        level: "info",
        message: "OAuth authorization required",
        context: {
          provider: "openai-codex",
          authMode: "oauth",
          oauthMode: "browser",
        },
      },
      {
        event: "oauth_browser_open_failed",
        type: "auth",
        level: "warn",
        message: "OAuth browser open failed",
        context: {
          provider: "openai-codex",
          authMode: "oauth",
          oauthMode: "browser",
        },
      },
      {
        event: "oauth_state_mismatch_retry",
        type: "auth",
        level: "warn",
        message: "OAuth state mismatch retry",
        context: {
          provider: "openai-codex",
          authMode: "oauth",
          oauthMode: "browser",
        },
      },
      {
        event: "oauth_authorization_required",
        type: "auth",
        level: "info",
        message: "OAuth authorization required",
        context: {
          provider: "openai-codex",
          authMode: "oauth",
          oauthMode: "browser",
        },
      },
      {
        event: "oauth_browser_opened",
        type: "auth",
        level: "info",
        message: "OAuth browser opened",
        context: {
          provider: "openai-codex",
          authMode: "oauth",
          oauthMode: "browser",
        },
      },
      {
        event: "setup_completed",
        type: "lifecycle",
        level: "info",
        message: "Setup completed",
        context: {
          provider: "openai-codex",
          authMode: "oauth",
          oauthMode: "browser",
          advanced: false,
          outcome: "success",
        },
      },
    ]);
    expect(raw).not.toContain(verificationUrl);
    expect(raw).not.toContain(redirectUrl);
    expect(raw).not.toContain(deviceCode);
    expect(raw).not.toContain(accessToken);
    expect(raw).not.toContain(refreshToken);

    expect(normalizedConsoleLines(consoleLines)).toEqual(
      expect.arrayContaining([
        "[reviewflux] OAuth authorization required",
        "Open this URL in your LOCAL browser:",
        "[reviewflux] browser auto-open failed. open the URL above manually.",
        "[reviewflux] OAuth state mismatch detected. Retrying with a fresh login session...",
        "[reviewflux] Use only the latest URL opened by this retry.",
        "[reviewflux] opening browser for OAuth login...",
      ]),
    );
  });

  it("does not persist api keys during api-key setup completion logging", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-14T11:00:00.000Z"));

    const home = makeTempHome();
    process.env.HOME = home;

    const apiKey = "sk-live-secret";

    vi.spyOn(console, "log").mockImplementation(() => {});

    const promptSelect = (async ({ message }: { message: string }) => {
      if (message === "Model/auth provider") return "openai";
      if (message === "Select default model") return "gpt-4o";
      throw new Error(`Unexpected promptSelect message: ${message}`);
    }) as PromptSelectFn;
    const promptPassword = (async () => apiKey) as PromptPasswordFn;
    const getProviderGroupsForSelection = (() => [
      {
        groupKey: "openai",
        groupLabel: "OpenAI",
        providers: ["openai"],
        hint: "API key",
      },
    ]) as ProviderGroupsFn;
    const getSelectableModelsForProvider = (() => [
      { id: "gpt-4o", name: "GPT-4o" },
    ]) as GetSelectableModelsFn;
    const getModels = (() => [
      { baseUrl: "https://api.example.test/v1" },
    ]) as GetModelsFn;
    const getModel = (() => ({ id: "gpt-4o" })) as GetModelFn;
    const getOAuthProviders = (() => []) as GetOauthProvidersFn;

    await runSetupFlow(
      { advanced: false },
      createBaseCollaborators(home, {
        promptSelect,
        promptPassword,
        getProviderGroupsForSelection,
        getSelectableModelsForProvider,
        getModels,
        getModel,
        getOAuthProviders,
      }),
    );

    const { raw, records } = readSetupLog(home, "2026-03-14");
    expect(summarizedRecords(records)).toEqual([
      {
        event: "setup_started",
        type: "lifecycle",
        level: "info",
        message: "Setup started",
        context: { advanced: false },
      },
      {
        event: "setup_completed",
        type: "lifecycle",
        level: "info",
        message: "Setup completed",
        context: {
          provider: "openai",
          authMode: "apikey",
          advanced: false,
          outcome: "success",
        },
      },
    ]);
    expect(raw).not.toContain(apiKey);
  });
});
