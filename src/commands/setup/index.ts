import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getModel,
  getModels,
} from "@mariozechner/pi-ai";
import { getOAuthProvider, getOAuthProviders } from "@mariozechner/pi-ai/oauth";
import {
  promptPassword,
  promptSelect,
  promptText,
} from "../../cli/clack-prompter.js";
import {
  ensureReviewFluxHome,
  saveConfig,
  type AuthMode,
  type LlmProvider,
  type ReviewFluxConfig,
} from "../../cli/config.js";
import {
  loginWithPiOAuth,
  resolveOAuthProviderId,
} from "../../auth/pi-oauth.js";
import {
  getCustomProviderId,
  type CustomCompatibility,
  validateCustomProviderConfig,
} from "../../llm/custom-provider.js";
import {
  getProviderChoiceHint,
  getProviderChoiceLabel,
  getProviderGroupsForSelection,
  getSelectableModelsForProvider,
} from "../../llm/provider-catalog.js";
import { getCodexEffortLevels } from "../../llm/reasoning-effort.js";

type SetupOptions = { advanced: boolean };

const GLOBAL_AGENTS_FILE = "AGENTS.md";
const GLOBAL_AGENTS_TEMPLATE_FILE = "REVIEWFLUX-AGENTS.md";
const GLOBAL_AGENTS_TEMPLATE_RELATIVE_DIR = [
  "src",
  "commands",
  "setup",
] as const;

type GlobalAgentsTemplateResolution = {
  content: string;
  source: string;
};

function globalAgentsPath(home: string): string {
  return join(home, GLOBAL_AGENTS_FILE);
}

function embeddedGlobalAgentsTemplate(): string {
  return [
    "# ReviewFlux Global Review Guidance (fallback)",
    "",
    "This fallback is used only when REVIEWFLUX-AGENTS.md cannot be found during setup.",
    "",
    "Add your team-specific review guidance here.",
    "Example topics:",
    "- Scope boundaries",
    "- Severity definitions",
    "- Required verification steps",
    "",
  ].join("\n");
}

function resolveGlobalAgentsTemplate(): GlobalAgentsTemplateResolution {
  const moduleDir = fileURLToPath(new URL(".", import.meta.url));
  const candidatePaths = [
    join(
      process.cwd(),
      ...GLOBAL_AGENTS_TEMPLATE_RELATIVE_DIR,
      GLOBAL_AGENTS_TEMPLATE_FILE,
    ),
    join(process.cwd(), GLOBAL_AGENTS_TEMPLATE_FILE),
    join(moduleDir, GLOBAL_AGENTS_TEMPLATE_FILE),
    join(
      moduleDir,
      "..",
      "..",
      ...GLOBAL_AGENTS_TEMPLATE_RELATIVE_DIR,
      GLOBAL_AGENTS_TEMPLATE_FILE,
    ),
    join(moduleDir, "..", "..", GLOBAL_AGENTS_TEMPLATE_FILE),
    join(moduleDir, "..", "..", "..", GLOBAL_AGENTS_TEMPLATE_FILE),
  ];

  for (const path of candidatePaths) {
    if (!existsSync(path)) continue;
    const content = readFileSync(path, "utf8");
    if (content.trim()) return { content, source: path };
  }

  return {
    content: embeddedGlobalAgentsTemplate(),
    source: "embedded fallback",
  };
}

function ensureGlobalAgentsTemplate(home: string): {
  created: boolean;
  source: string;
} {
  const path = globalAgentsPath(home);
  if (existsSync(path)) return { created: false, source: path };

  const template = resolveGlobalAgentsTemplate();
  writeFileSync(path, template.content, { encoding: "utf8", mode: 0o600 });
  chmodSync(path, 0o600);
  return { created: true, source: template.source };
}

function parseSetupOptions(args: string[]): SetupOptions {
  return { advanced: args.includes("--advanced") };
}

function assertNonEmpty(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field}_required`);
  return trimmed;
}

/** OAuth support comes from pi-ai’s OAuth provider registry only. */
function isOAuthCapableProvider(provider: string): boolean {
  return getOAuthProviders().some((p) => p.id === provider);
}

/** Use the chosen provider id as-is; pi-ai defines models and auth per provider. */
function resolveApiProviderForSetup(params: {
  authMode: AuthMode;
  provider: LlmProvider;
}): string {
  return params.provider;
}

function assertModelSupportedByPiAi(params: {
  authMode: AuthMode;
  provider: LlmProvider;
  model: string;
}): void {
  const piProvider = resolveApiProviderForSetup(params);
  const resolved = getModel(piProvider as never, params.model as never);
  if (!resolved)
    throw new Error(
      `model_not_supported_by_pi_ai:${piProvider}/${params.model}`,
    );
}

async function pickDefaultModel(params: {
  message: string;
  authMode: AuthMode;
  provider: LlmProvider;
  defaultModel?: string;
}): Promise<string> {
  const provider = resolveApiProviderForSetup(params);
  const available = getSelectableModelsForProvider(provider);
  const fallback = params.defaultModel ?? available[0]?.id;

  if (!fallback) {
    throw new Error(`no_models_for_provider:${params.provider}`);
  }

  return promptSelect<string>({
    message: params.message,
    options: available.map((model) => ({
      label: `${model.id} (${model.name})`,
      value: model.id,
    })),
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

function releaseInteractiveInput(): void {
  if (!process.stdin.isTTY) return;
  process.stdin.setRawMode?.(false);
  process.stdin.pause();
}

function extractDeviceCode(
  instructions: string | undefined,
): string | undefined {
  if (!instructions) return undefined;
  const match = instructions.match(/enter\s+code\s*:\s*(.+)$/i);
  const code = match?.[1]?.trim();
  return code && code.length > 0 ? code : undefined;
}

function manualOAuthPromptForProvider(provider: LlmProvider): {
  message: string;
  placeholder: string;
} {
  if (provider === "openai-codex") {
    return {
      message: "Paste OpenAI redirect URL or authorization code",
      placeholder: "http://localhost:1455/auth/callback?code=...&state=...",
    };
  }

  return {
    message: "Paste authorization code",
    placeholder: "XXXX-XXXX",
  };
}

async function collectOAuthConfig(
  provider: LlmProvider,
): Promise<NonNullable<ReviewFluxConfig["oauth"]>> {
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
    const refreshTokenRaw = await promptPassword({
      message: "Refresh token (optional)",
      mask: "*",
    });
    const refreshToken = refreshTokenRaw.trim() || undefined;

    const providerId = resolveOAuthProviderId(provider);
    const projectIdRaw =
      providerId === "google-gemini-cli"
        ? await promptText({
            message: "Google project ID (optional; needed for refresh)",
            initialValue: "",
          })
        : "";

    return {
      oauthProviderId: providerId,
      accessToken,
      ...(refreshToken ? { refreshToken } : {}),
      ...(projectIdRaw.trim() ? { projectId: projectIdRaw.trim() } : {}),
    };
  }

  const isGitHubCopilot = provider === "github-copilot";
  const usesCallbackServer =
    getOAuthProvider(provider)?.usesCallbackServer === true;

  const callbacks: Parameters<typeof loginWithPiOAuth>[1] = {
    onAuth: ({ url, instructions }) => {
      console.log("\n[reviewflux] OAuth authorization required");
      if (isGitHubCopilot) {
        console.log("GitHub Copilot device login");
        console.log(`Verification URL: ${url}`);
        const code = extractDeviceCode(instructions);
        if (code) {
          console.log(`Enter code: ${code}`);
        }
      } else {
        console.log("Open this URL in your LOCAL browser:");
        console.log(`${url}`);
      }
      if (instructions?.trim()) {
        console.log(`\n${instructions.trim()}`);
      }
      if (usesCallbackServer && !isGitHubCopilot) {
        console.log(
          "[reviewflux] waiting for browser callback. If needed, paste redirect URL in terminal.",
        );
      }
      console.log("");

      const opened = openBrowser(url);
      if (opened) {
        console.log("[reviewflux] opening browser for OAuth login...");
      } else {
        console.log(
          "[reviewflux] browser auto-open failed. open the URL above manually.",
        );
      }
    },
    onPrompt: async (prompt) => {
      if (
        isGitHubCopilot &&
        prompt.message.includes("GitHub Enterprise URL/domain")
      ) {
        console.log(
          "[reviewflux] Using github.com (press setup again for enterprise if needed).",
        );
        return "";
      }

      const anthropicCodePlaceholder =
        provider === "anthropic" && /authorization code/i.test(prompt.message)
          ? "code#state"
          : prompt.placeholder;

      while (true) {
        const value = await promptText({
          message: prompt.message,
          initialValue: anthropicCodePlaceholder ?? "",
        });
        if (value.trim().length > 0 || prompt.allowEmpty) return value;
        console.log("[reviewflux] OAuth input is required.");
      }
    },
    onProgress: (message) => {
      if (message?.trim()) console.log(`[reviewflux] ${message}`);
    },
  };

  if (provider === "openai-codex") {
    callbacks.onManualCodeInput = async () => {
      const manualPrompt = manualOAuthPromptForProvider(provider);
      return assertNonEmpty(
        await promptText({
          message: manualPrompt.message,
          placeholder: manualPrompt.placeholder,
        }),
        "oauth_manual_code",
      );
    };
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await loginWithPiOAuth(provider, callbacks);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isStateMismatch = /state/i.test(message);
      if (!isStateMismatch || attempt === 1) throw error;
      console.log(
        "[reviewflux] OAuth state mismatch detected. Retrying with a fresh login session...",
      );
      console.log("[reviewflux] Use only the latest URL opened by this retry.");
    }
  }

  throw new Error("oauth_login_failed");
}

async function pickCodexEffort(params: {
  authMode: AuthMode;
  model: string;
  defaultEffort?: "low" | "medium" | "high" | "xhigh";
}): Promise<"low" | "medium" | "high" | "xhigh"> {
  const supported = getCodexEffortLevels({
    authMode: params.authMode,
    model: params.model,
  });
  const fallback = supported.includes("medium")
    ? "medium"
    : (supported[0] ?? "low");

  return promptSelect<"low" | "medium" | "high" | "xhigh">({
    message: `Select reasoning effort (${supported.join("/")})`,
    options: supported.map((level) => ({ label: level, value: level })),
    initialValue:
      params.defaultEffort && supported.includes(params.defaultEffort)
        ? params.defaultEffort
        : fallback,
  });
}

function defaultBaseUrlForProvider(provider: string): string {
  const firstModel = getModels(provider as never)[0];
  return firstModel?.baseUrl ?? "https://api.openai.com/v1";
}

/** Orchestrates prompts for custom provider; validation is delegated to llm/custom-provider. */
async function saveCustomProviderConfig(): Promise<void> {
  const baseUrl = assertNonEmpty(
    await promptText({
      message: "Custom endpoint base URL",
      initialValue: "https://api.openai.com/v1",
    }),
    "base_url",
  );
  const modelId = assertNonEmpty(
    await promptText({
      message: "Model ID",
      placeholder: "e.g. gpt-4o or claude-3-5-sonnet",
    }),
    "model_id",
  );
  const compatibility = (await promptSelect<CustomCompatibility>({
    message: "API compatibility",
    options: [
      {
        label: "OpenAI",
        value: "openai",
        hint: "OpenAI-style /v1/chat/completions",
      },
      {
        label: "Anthropic",
        value: "anthropic",
        hint: "Anthropic Messages API",
      },
    ],
    initialValue: "openai",
  })) as CustomCompatibility;
  const key = assertNonEmpty(
    await promptPassword({ message: "API key", mask: "*" }),
    "api_key",
  );

  const validated = validateCustomProviderConfig({
    baseUrl,
    modelId,
    compatibility,
    apiKey: key,
  });
  const provider = getCustomProviderId(validated.compatibility);
  const profileId = `${provider}:default`;

  const config: ReviewFluxConfig = {
    appName: "reviewflux",
    llm: provider,
    authMode: "apikey",
    llmApiBaseUrl: validated.baseUrl,
    model: validated.modelId,
    apiKey: { key: validated.apiKey ?? "" },
    auth: {
      profiles: {
        [profileId]: {
          provider,
          mode: "apikey",
          apiKey: { key: validated.apiKey ?? "" },
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
  releaseInteractiveInput();
}

async function runSetup(options: SetupOptions): Promise<void> {
  const home = ensureReviewFluxHome();
  const globalAgents = ensureGlobalAgentsTemplate(home);

  console.log("[reviewflux] setup started");
  console.log(`[reviewflux] config directory: ${home}`);
  if (globalAgents.created) {
    console.log(
      `[reviewflux] created global review guidance: ${globalAgentsPath(home)}`,
    );
    console.log(
      `[reviewflux] global review template source: ${globalAgents.source}`,
    );
  }

  const groups = getProviderGroupsForSelection();
  if (groups.length === 0) {
    throw new Error("no_providers_from_pi_ai");
  }

  const SKIP_VALUE = "__skip__";
  const BACK_VALUE = "__back__";
  const CUSTOM_GROUP_VALUE = "__custom__";

  let provider: LlmProvider;
  while (true) {
    const selectedGroupKey = await promptSelect<string>({
      message: "Model/auth provider",
      options: [
        {
          label: "Custom Provider",
          value: CUSTOM_GROUP_VALUE,
          hint: "Any OpenAI or Anthropic compatible endpoint",
        },
        ...groups.map((g) => ({
          label: g.groupLabel,
          value: g.groupKey,
          hint: g.hint,
        })),
        { label: "Skip for now", value: SKIP_VALUE },
      ],
      initialValue:
        groups.find((g) => g.providers.includes("openai-codex"))?.groupKey ??
        groups[0]!.groupKey,
    });

    if (selectedGroupKey === SKIP_VALUE) {
      console.log(
        "[reviewflux] setup skipped. Run reviewflux setup again when ready.",
      );
      releaseInteractiveInput();
      return;
    }

    if (selectedGroupKey === CUSTOM_GROUP_VALUE) {
      await saveCustomProviderConfig();
      return;
    }

    const selectedGroup = groups.find((g) => g.groupKey === selectedGroupKey)!;

    if (selectedGroup.providers.length === 1) {
      provider = selectedGroup.providers[0]!;
      break;
    }

    const methodSelection = await promptSelect<string>({
      message: `${selectedGroup.groupLabel} auth method`,
      options: [
        ...selectedGroup.providers.map((p) => ({
          label: getProviderChoiceLabel(p),
          value: p,
          hint: getProviderChoiceHint(p),
        })),
        { label: "Back", value: BACK_VALUE },
      ],
      initialValue:
        selectedGroup.providers.find(
          (p) => p === "openai-codex" || p === "google-gemini-cli",
        ) ?? selectedGroup.providers[0]!,
    });

    if (methodSelection === BACK_VALUE) {
      continue;
    }
    provider = methodSelection as LlmProvider;
    break;
  }

  const authMode: AuthMode = isOAuthCapableProvider(provider)
    ? "oauth"
    : "apikey";

  const defaultBaseUrl = defaultBaseUrlForProvider(
    resolveApiProviderForSetup({ authMode, provider }),
  );
  let llmApiBaseUrl = defaultBaseUrl;

  if (options.advanced) {
    llmApiBaseUrl = assertNonEmpty(
      (await promptText({
        message: "LLM API base URL",
        initialValue: defaultBaseUrl,
      })) || defaultBaseUrl,
      "llm_api_base_url",
    );
  }

  const profileId = `${provider}:default`;

  if (authMode === "apikey") {
    const key = assertNonEmpty(
      await promptPassword({ message: "Paste API key", mask: "*" }),
      "api_key",
    );
    const model = await pickDefaultModel({
      message: "Select default model",
      authMode,
      provider,
    });
    assertModelSupportedByPiAi({ authMode, provider, model });

    const effort =
      provider === "openai-codex"
        ? await pickCodexEffort({ authMode, model, defaultEffort: "medium" })
        : undefined;

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
    releaseInteractiveInput();
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

  const effort =
    provider === "openai-codex"
      ? await pickCodexEffort({ authMode, model, defaultEffort: "medium" })
      : undefined;

  const config: ReviewFluxConfig = {
    appName: "reviewflux",
    llm: provider,
    authMode,
    llmApiBaseUrl,
    model,
    ...(effort ? { effort } : {}),
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
  releaseInteractiveInput();
}

export async function runSetupCommand(args: string[]): Promise<void> {
  await runSetup(parseSetupOptions(args));
}
