import { spawn, spawnSync } from "node:child_process";
import { getModel, getModels, getProviders } from "@mariozechner/pi-ai";
import { promptPassword, promptSelect, promptText } from "../../cli/clack-prompter.js";
import {
  ensureReviewFluxHome,
  saveConfig,
  type AuthMode,
  type LlmProvider,
  type ReviewFluxConfig,
} from "../../cli/config.js";
import { loginWithPiOAuth, resolveOAuthProviderId } from "../../auth/pi-oauth.js";
import { getCodexEffortLevels } from "../../llm/reasoning-effort.js";

type SetupOptions = { advanced: boolean };

type OAuthCapableProvider = "openai-codex" | "google-gemini-cli";

function parseSetupOptions(args: string[]): SetupOptions {
  return { advanced: args.includes("--advanced") };
}

function assertNonEmpty(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field}_required`);
  return trimmed;
}

function getProviderChoices(): string[] {
  return getProviders().slice().sort((a, b) => a.localeCompare(b));
}

function isOAuthCapableProvider(provider: string): provider is OAuthCapableProvider {
  return provider === "openai-codex" || provider === "google-gemini-cli";
}

function resolveApiProviderForSetup(params: { authMode: AuthMode; provider: LlmProvider }): string {
  if (params.provider === "gemini") {
    return params.authMode === "oauth" ? "google-gemini-cli" : "google";
  }

  if (params.provider === "openai") {
    return params.authMode === "oauth" ? "openai-codex" : "openai";
  }

  return params.provider;
}

function assertModelSupportedByPiAi(params: {
  authMode: AuthMode;
  provider: LlmProvider;
  model: string;
}): void {
  const piProvider = resolveApiProviderForSetup(params);
  const resolved = getModel(piProvider as never, params.model as never);
  if (!resolved) throw new Error(`model_not_supported_by_pi_ai:${piProvider}/${params.model}`);
}

function getSelectableModels(params: {
  authMode: AuthMode;
  provider: LlmProvider;
}): Array<{ id: string; name: string }> {
  const provider = resolveApiProviderForSetup(params);

  return getModels(provider as never)
    .map((model) => ({ id: model.id, name: model.name }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

async function pickDefaultModel(params: {
  message: string;
  authMode: AuthMode;
  provider: LlmProvider;
  defaultModel?: string;
}): Promise<string> {
  const available = getSelectableModels(params);
  const fallback = params.defaultModel ?? available[0]?.id;

  if (!fallback) {
    throw new Error(`no_models_for_provider:${params.provider}`);
  }

  return promptSelect<string>({
    message: params.message,
    options: available.map((model) => ({ label: `${model.id} (${model.name})`, value: model.id })),
    initialValue: fallback,
  });
}

function openBrowser(url: string): boolean {
  const platform = process.platform;

  const spawnDetached = (command: string, args: string[]) => {
    const proc = spawn(command, args, { stdio: "ignore", detached: true });
    proc.unref();
    return proc.pid != null;
  };

  if (platform === "darwin") {
    const probe = spawnSync("which", ["open"], { encoding: "utf8" });
    if (probe.status !== 0) return false;
    return spawnDetached("open", [url]);
  }

  if (platform === "win32") {
    return spawnDetached("cmd", ["/c", "start", "", url]);
  }

  const probe = spawnSync("which", ["xdg-open"], { encoding: "utf8" });
  if (probe.status !== 0) return false;
  return spawnDetached("xdg-open", [url]);
}

async function collectOAuthConfig(provider: OAuthCapableProvider): Promise<NonNullable<ReviewFluxConfig["oauth"]>> {
  const oauthMode = await promptSelect<"browser" | "paste">({
    message: "OAuth setup method",
    options: [
      { label: "Browser login (recommended)", value: "browser" },
      { label: "Paste existing token", value: "paste" },
    ],
    initialValue: "browser",
  });

  if (oauthMode === "paste") {
    const accessToken = assertNonEmpty(
      await promptPassword({ message: "Paste OAuth access token", mask: "*" }),
      "oauth_access_token",
    );
    const refreshTokenRaw = await promptPassword({ message: "Refresh token (optional)", mask: "*" });
    const refreshToken = refreshTokenRaw.trim() || undefined;

    const providerId = resolveOAuthProviderId(provider);
    const projectIdRaw =
      providerId === "google-gemini-cli"
        ? await promptText({ message: "Google project ID (optional; needed for refresh)", initialValue: "" })
        : "";

    return {
      oauthProviderId: providerId,
      accessToken,
      ...(refreshToken ? { refreshToken } : {}),
      ...(projectIdRaw.trim() ? { projectId: projectIdRaw.trim() } : {}),
    };
  }

  return loginWithPiOAuth(provider, {
    onAuth: ({ url }) => {
      console.log("\n[reviewflux] OAuth URL ready");
      console.log("Open this URL in your LOCAL browser:");
      console.log(`${url}\n`);

      const opened = openBrowser(url);
      if (opened) {
        console.log("[reviewflux] opening browser for OAuth login...");
      } else {
        console.log("[reviewflux] browser auto-open failed. open the URL above manually.");
      }
    },
    onPrompt: async (prompt) => {
      while (true) {
        const value = await promptText({ message: prompt.message, initialValue: prompt.placeholder ?? "" });
        if (value.trim().length > 0 || prompt.allowEmpty) return value;
        console.log("[reviewflux] OAuth input is required.");
      }
    },
    onProgress: (message) => {
      if (message?.trim()) console.log(`[reviewflux] ${message}`);
    },
  });
}

async function pickCodexEffort(params: {
  authMode: AuthMode;
  model: string;
  defaultEffort?: "low" | "medium" | "high" | "xhigh";
}): Promise<"low" | "medium" | "high" | "xhigh"> {
  const supported = getCodexEffortLevels({ authMode: params.authMode, model: params.model });
  const fallback = supported.includes("medium") ? "medium" : supported[0] ?? "low";

  return promptSelect<"low" | "medium" | "high" | "xhigh">({
    message: `Select reasoning effort (${supported.join("/")})`,
    options: supported.map((level) => ({ label: level, value: level })),
    initialValue: params.defaultEffort && supported.includes(params.defaultEffort) ? params.defaultEffort : fallback,
  });
}

function defaultBaseUrlForProvider(provider: string): string {
  const firstModel = getModels(provider as never)[0];
  return firstModel?.baseUrl ?? "https://api.openai.com/v1";
}

async function runSetup(options: SetupOptions): Promise<void> {
  const home = ensureReviewFluxHome();

  console.log("[reviewflux] setup started");
  console.log(`[reviewflux] config directory: ${home}`);

  const providerChoices = getProviderChoices();
  if (providerChoices.length === 0) {
    throw new Error("no_providers_from_pi_ai");
  }

  const provider = await promptSelect<LlmProvider>({
    message: "Select LLM provider",
    options: providerChoices.map((p) => ({ label: p, value: p })),
    initialValue: providerChoices.includes("openai-codex") ? "openai-codex" : providerChoices[0],
  });

  const authModeOptions = isOAuthCapableProvider(provider)
    ? [
        { label: "OAuth", value: "oauth" as const },
        { label: "API Key", value: "apikey" as const },
      ]
    : [{ label: "API Key", value: "apikey" as const }];

  const authMode = await promptSelect<AuthMode>({
    message: "Select auth mode",
    options: authModeOptions,
    initialValue: authModeOptions.some((o) => o.value === "oauth") ? "oauth" : "apikey",
  });

  const defaultBaseUrl = defaultBaseUrlForProvider(resolveApiProviderForSetup({ authMode, provider }));
  let llmApiBaseUrl = defaultBaseUrl;

  if (options.advanced) {
    llmApiBaseUrl = assertNonEmpty(
      (await promptText({ message: "LLM API base URL", initialValue: defaultBaseUrl })) || defaultBaseUrl,
      "llm_api_base_url",
    );
  }

  const profileId = `${provider}:default`;

  if (authMode === "apikey") {
    const key = assertNonEmpty(await promptPassword({ message: "Paste API key", mask: "*" }), "api_key");
    const model = await pickDefaultModel({
      message: "Select default model",
      authMode,
      provider,
    });
    assertModelSupportedByPiAi({ authMode, provider, model });

    const effort = provider === "openai-codex" ? await pickCodexEffort({ authMode, model, defaultEffort: "medium" }) : undefined;

    const config: ReviewFluxConfig = {
      appName: "reviewflux",
      llm: provider,
      authMode,
      llmApiBaseUrl,
      model,
      ...(effort ? { effort } : {}),
      apiKey: { key },
      auth: {
        profiles: {
          [profileId]: {
            provider,
            mode: "apikey",
            apiKey: { key },
          },
        },
        order: {
          [provider]: [profileId],
        },
      },
    };

    const path = saveConfig(config);
    console.log(`\n[reviewflux] setup complete: ${path}`);
    console.log("Next: reviewflux daemon start");
    return;
  }

  if (!isOAuthCapableProvider(provider)) {
    throw new Error(`oauth_not_supported_for_provider:${provider}`);
  }

  const oauth = await collectOAuthConfig(provider);
  const model = await pickDefaultModel({
    message: "Select default model (OAuth verified)",
    authMode,
    provider,
  });
  assertModelSupportedByPiAi({ authMode, provider, model });

  const effort = provider === "openai-codex" ? await pickCodexEffort({ authMode, model, defaultEffort: "medium" }) : undefined;

  const config: ReviewFluxConfig = {
    appName: "reviewflux",
    llm: provider,
    authMode,
    llmApiBaseUrl,
    model,
    ...(effort ? { effort } : {}),
    oauth,
    auth: {
      profiles: {
        [profileId]: {
          provider,
          mode: "oauth",
          oauth,
        },
      },
      order: {
        [provider]: [profileId],
      },
    },
  };

  const path = saveConfig(config);
  console.log(`\n[reviewflux] setup complete: ${path}`);
  console.log("Next: reviewflux daemon start");
}

export async function runSetupCommand(args: string[]): Promise<void> {
  await runSetup(parseSetupOptions(args));
}
