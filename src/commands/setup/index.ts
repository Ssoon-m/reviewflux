import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getModel,
  getModels,
} from "@mariozechner/pi-ai";
import { getOAuthProvider, getOAuthProviders } from "@mariozechner/pi-ai/oauth";
import type { Command } from "commander";
import {
  loginWithPiOAuth,
  resolveOAuthProviderId,
} from "../../auth/pi-oauth";
import {
  promptPassword,
  promptSelect,
  promptText,
} from "../../cli/clack-prompter";
import {
  type CommandBuilderDependencies,
  resolveCommandBuilderDependencies,
} from "../../cli/command-builder";
import {
  type AuthMode,
  ensureReviewFluxHome,
  getReviewFluxHome,
  type LlmProvider,
  type ReviewFluxConfig,
  saveConfig,
} from "../../cli/config";
import {
  logging,
  type LoggingLevel,
  type LoggingType,
} from "../../infra/logging/index";
import {
  type CustomCompatibility,
  getCustomProviderId,
  validateCustomProviderConfig,
} from "../../llm/custom-provider";
import {
  getProviderChoiceHint,
  getProviderChoiceLabel,
  getProviderGroupsForSelection,
  getSelectableModelsForProvider,
} from "../../llm/provider-catalog";
import { getCodexEffortLevels } from "../../llm/reasoning-effort";
import { reviewQueuePath } from "../../review/queue/index";

type SetupOptions = { advanced: boolean };
type SetupOAuthMode = "browser" | "paste";
type SetupSemanticEvent =
  | "setup_started"
  | "setup_skipped"
  | "global_guidance_created"
  | "oauth_authorization_required"
  | "oauth_browser_opened"
  | "oauth_browser_open_failed"
  | "oauth_state_mismatch_retry"
  | "setup_completed";
type SetupLoggingContext = {
  provider?: string;
  authMode?: AuthMode;
  oauthMode?: SetupOAuthMode;
  advanced?: boolean;
  outcome?: string;
};
type SetupCompletionContext = {
  provider: string;
  authMode: AuthMode;
  oauthMode?: SetupOAuthMode;
  advanced: boolean;
};
type SetupSemanticLogEntry = {
  event: SetupSemanticEvent;
  type: LoggingType;
  level: LoggingLevel;
  message: string;
  context?: SetupLoggingContext;
};
type SetupSemanticLogger = (entry: SetupSemanticLogEntry) => void;
type OAuthLoginCallbacks = Parameters<typeof loginWithPiOAuth>[1];
type OAuthAuthCallbackParams = Parameters<
  NonNullable<OAuthLoginCallbacks["onAuth"]>
>[0];
type OAuthPromptCallbackParams = Parameters<
  NonNullable<OAuthLoginCallbacks["onPrompt"]>
>[0];
type OAuthProgressCallbackMessage = Parameters<
  NonNullable<OAuthLoginCallbacks["onProgress"]>
>[0];

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

type SetupCommandHandlers = {
  runSetup: (options: SetupOptions) => Promise<void>;
};

export type SetupCommandDependencies = CommandBuilderDependencies<
  SetupCommandHandlers
>;

export type SetupFlowCollaborators = {
  home?: string;
  promptSelect?: typeof promptSelect;
  promptPassword?: typeof promptPassword;
  promptText?: typeof promptText;
  loginWithPiOAuth?: typeof loginWithPiOAuth;
  ensureReviewFluxHome?: typeof ensureReviewFluxHome;
  ensureGlobalAgentsTemplate?: typeof ensureGlobalAgentsTemplate;
  saveConfig?: typeof saveConfig;
  releaseInteractiveInput?: typeof releaseInteractiveInput;
  openBrowser?: typeof openBrowser;
  getOAuthProvider?: typeof getOAuthProvider;
  getOAuthProviders?: typeof getOAuthProviders;
  resolveOAuthProviderId?: typeof resolveOAuthProviderId;
  getProviderGroupsForSelection?: typeof getProviderGroupsForSelection;
  getProviderChoiceLabel?: typeof getProviderChoiceLabel;
  getProviderChoiceHint?: typeof getProviderChoiceHint;
  getSelectableModelsForProvider?: typeof getSelectableModelsForProvider;
  getCodexEffortLevels?: typeof getCodexEffortLevels;
  getModels?: typeof getModels;
  getModel?: typeof getModel;
  validateCustomProviderConfig?: typeof validateCustomProviderConfig;
  getCustomProviderId?: typeof getCustomProviderId;
  logging?: typeof logging;
};

type SetupFlowRuntime = {
  home: string;
  promptSelect: typeof promptSelect;
  promptPassword: typeof promptPassword;
  promptText: typeof promptText;
  loginWithPiOAuth: typeof loginWithPiOAuth;
  ensureReviewFluxHome: typeof ensureReviewFluxHome;
  ensureGlobalAgentsTemplate: typeof ensureGlobalAgentsTemplate;
  saveConfig: typeof saveConfig;
  releaseInteractiveInput: typeof releaseInteractiveInput;
  openBrowser: typeof openBrowser;
  getOAuthProvider: typeof getOAuthProvider;
  getOAuthProviders: typeof getOAuthProviders;
  resolveOAuthProviderId: typeof resolveOAuthProviderId;
  getProviderGroupsForSelection: typeof getProviderGroupsForSelection;
  getProviderChoiceLabel: typeof getProviderChoiceLabel;
  getProviderChoiceHint: typeof getProviderChoiceHint;
  getSelectableModelsForProvider: typeof getSelectableModelsForProvider;
  getCodexEffortLevels: typeof getCodexEffortLevels;
  getModels: typeof getModels;
  getModel: typeof getModel;
  validateCustomProviderConfig: typeof validateCustomProviderConfig;
  getCustomProviderId: typeof getCustomProviderId;
  logSetupEvent: SetupSemanticLogger;
};

function createSetupEventLogger(writeLog: typeof logging): SetupSemanticLogger {
  return (entry) => {
    writeLog({
      surface: "setup",
      type: entry.type,
      level: entry.level,
      event: entry.event,
      message: entry.message,
      context: entry.context,
    });
  };
}

function resolveSetupFlowRuntime(
  collaborators: SetupFlowCollaborators = {},
): SetupFlowRuntime {
  return {
    home: collaborators.home ?? homedir(),
    promptSelect: collaborators.promptSelect ?? promptSelect,
    promptPassword: collaborators.promptPassword ?? promptPassword,
    promptText: collaborators.promptText ?? promptText,
    loginWithPiOAuth: collaborators.loginWithPiOAuth ?? loginWithPiOAuth,
    ensureReviewFluxHome:
      collaborators.ensureReviewFluxHome ?? ensureReviewFluxHome,
    ensureGlobalAgentsTemplate:
      collaborators.ensureGlobalAgentsTemplate ?? ensureGlobalAgentsTemplate,
    saveConfig: collaborators.saveConfig ?? saveConfig,
    releaseInteractiveInput:
      collaborators.releaseInteractiveInput ?? releaseInteractiveInput,
    openBrowser: collaborators.openBrowser ?? openBrowser,
    getOAuthProvider: collaborators.getOAuthProvider ?? getOAuthProvider,
    getOAuthProviders: collaborators.getOAuthProviders ?? getOAuthProviders,
    resolveOAuthProviderId:
      collaborators.resolveOAuthProviderId ?? resolveOAuthProviderId,
    getProviderGroupsForSelection:
      collaborators.getProviderGroupsForSelection ?? getProviderGroupsForSelection,
    getProviderChoiceLabel:
      collaborators.getProviderChoiceLabel ?? getProviderChoiceLabel,
    getProviderChoiceHint:
      collaborators.getProviderChoiceHint ?? getProviderChoiceHint,
    getSelectableModelsForProvider:
      collaborators.getSelectableModelsForProvider ?? getSelectableModelsForProvider,
    getCodexEffortLevels:
      collaborators.getCodexEffortLevels ?? getCodexEffortLevels,
    getModels: collaborators.getModels ?? getModels,
    getModel: collaborators.getModel ?? getModel,
    validateCustomProviderConfig:
      collaborators.validateCustomProviderConfig ?? validateCustomProviderConfig,
    getCustomProviderId: collaborators.getCustomProviderId ?? getCustomProviderId,
    logSetupEvent: createSetupEventLogger(collaborators.logging ?? logging),
  };
}

function globalAgentsPath(home: string): string {
  return join(getReviewFluxHome(home), GLOBAL_AGENTS_FILE);
}

function logSetupCompletion(
  path: string,
  home: string,
  logSetupEvent?: SetupSemanticLogger,
  context?: SetupCompletionContext,
): void {
  console.log(`\n[reviewflux] setup complete: ${path}`);
  console.log(`[reviewflux] queue database: ${reviewQueuePath(home)}`);
  console.log("Next: rvw daemon start");
  logSetupEvent?.({
    event: "setup_completed",
    type: "lifecycle",
    level: "info",
    message: "Setup completed",
    context: context ? { ...context, outcome: "success" } : undefined,
  });
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

function assertNonEmpty(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field}_required`);
  return trimmed;
}

/** OAuth support comes from pi-ai’s OAuth provider registry only. */
function isOAuthCapableProvider(
  provider: string,
  getOAuthProvidersFn: typeof getOAuthProviders = getOAuthProviders,
): boolean {
  return getOAuthProvidersFn().some((p: { id: string }) => p.id === provider);
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
}, getModelFn: typeof getModel = getModel): void {
  const piProvider = resolveApiProviderForSetup(params);
  const resolved = getModelFn(piProvider as never, params.model as never);
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
}, runtime: Pick<SetupFlowRuntime, "promptSelect" | "getSelectableModelsForProvider">): Promise<string> {
  const provider = resolveApiProviderForSetup(params);
  const available = runtime.getSelectableModelsForProvider(provider);
  const fallback = params.defaultModel ?? available[0]?.id;

  if (!fallback) {
    throw new Error(`no_models_for_provider:${params.provider}`);
  }

  return runtime.promptSelect<string>({
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
  runtime: SetupFlowRuntime,
): Promise<{
  oauth: NonNullable<ReviewFluxConfig["oauth"]>;
  oauthMode: SetupOAuthMode;
}> {
  const oauthMode = await runtime.promptSelect<SetupOAuthMode>({
    message: "OAuth setup method",
    options: [
      { label: "Browser login (recommended)", value: "browser" },
      { label: "Paste existing token", value: "paste" },
    ],
    initialValue: "browser",
  });

  if (oauthMode === "paste") {
    const accessToken = assertNonEmpty(
      await runtime.promptPassword({
        message: "Paste OAuth access token",
        mask: "*",
      }),
      "oauth_access_token",
    );
    const refreshTokenRaw = await runtime.promptPassword({
      message: "Refresh token (optional)",
      mask: "*",
    });
    const refreshToken = refreshTokenRaw.trim() || undefined;

    const providerId = runtime.resolveOAuthProviderId(provider);
    const projectIdRaw =
      providerId === "google-gemini-cli"
        ? await runtime.promptText({
            message: "Google project ID (optional; needed for refresh)",
            initialValue: "",
          })
        : "";

    return {
      oauthMode,
      oauth: {
        oauthProviderId: providerId,
        accessToken,
        ...(refreshToken ? { refreshToken } : {}),
        ...(projectIdRaw.trim() ? { projectId: projectIdRaw.trim() } : {}),
      },
    };
  }

  const isGitHubCopilot = provider === "github-copilot";
  const usesCallbackServer =
    runtime.getOAuthProvider(provider)?.usesCallbackServer === true;
  const oauthLoggingContext: SetupLoggingContext = {
    provider,
    authMode: "oauth",
    oauthMode,
  };

  const callbacks: OAuthLoginCallbacks = {
    onAuth: ({ url, instructions }: OAuthAuthCallbackParams) => {
      console.log("\n[reviewflux] OAuth authorization required");
      runtime.logSetupEvent({
        event: "oauth_authorization_required",
        type: "auth",
        level: "info",
        message: "OAuth authorization required",
        context: oauthLoggingContext,
      });
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

      const opened = runtime.openBrowser(url);
      if (opened) {
        console.log("[reviewflux] opening browser for OAuth login...");
        runtime.logSetupEvent({
          event: "oauth_browser_opened",
          type: "auth",
          level: "info",
          message: "OAuth browser opened",
          context: oauthLoggingContext,
        });
      } else {
        console.log(
          "[reviewflux] browser auto-open failed. open the URL above manually.",
        );
        runtime.logSetupEvent({
          event: "oauth_browser_open_failed",
          type: "auth",
          level: "warn",
          message: "OAuth browser open failed",
          context: oauthLoggingContext,
        });
      }
    },
    onPrompt: async (prompt: OAuthPromptCallbackParams) => {
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
        const value = await runtime.promptText({
          message: prompt.message,
          initialValue: anthropicCodePlaceholder ?? "",
        });
        if (value.trim().length > 0 || prompt.allowEmpty) return value;
        console.log("[reviewflux] OAuth input is required.");
      }
    },
    onProgress: (message: OAuthProgressCallbackMessage) => {
      if (message?.trim()) console.log(`[reviewflux] ${message}`);
    },
  };

  if (provider === "openai-codex") {
    callbacks.onManualCodeInput = async () => {
      const manualPrompt = manualOAuthPromptForProvider(provider);
      return assertNonEmpty(
        await runtime.promptText({
          message: manualPrompt.message,
          placeholder: manualPrompt.placeholder,
        }),
        "oauth_manual_code",
      );
    };
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return {
        oauth: await runtime.loginWithPiOAuth(provider, callbacks),
        oauthMode,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isStateMismatch = /state/i.test(message);
      if (!isStateMismatch || attempt === 1) throw error;
      console.log(
        "[reviewflux] OAuth state mismatch detected. Retrying with a fresh login session...",
      );
      console.log("[reviewflux] Use only the latest URL opened by this retry.");
      runtime.logSetupEvent({
        event: "oauth_state_mismatch_retry",
        type: "auth",
        level: "warn",
        message: "OAuth state mismatch retry",
        context: oauthLoggingContext,
      });
    }
  }

  throw new Error("oauth_login_failed");
}

async function pickCodexEffort(params: {
  authMode: AuthMode;
  model: string;
  defaultEffort?: "low" | "medium" | "high" | "xhigh";
}, runtime: Pick<SetupFlowRuntime, "promptSelect" | "getCodexEffortLevels">): Promise<"low" | "medium" | "high" | "xhigh"> {
  const supported = runtime.getCodexEffortLevels({
    authMode: params.authMode,
    model: params.model,
  });
  const fallback = supported.includes("medium")
    ? "medium"
    : (supported[0] ?? "low");

  return runtime.promptSelect<"low" | "medium" | "high" | "xhigh">({
    message: `Select reasoning effort (${supported.join("/")})`,
    options: supported.map((level) => ({ label: level, value: level })),
    initialValue:
      params.defaultEffort && supported.includes(params.defaultEffort)
        ? params.defaultEffort
        : fallback,
  });
}

function defaultBaseUrlForProvider(
  provider: string,
  getModelsFn: typeof getModels = getModels,
): string {
  const firstModel = getModelsFn(provider as never)[0];
  return firstModel?.baseUrl ?? "https://api.openai.com/v1";
}

/** Orchestrates prompts for custom provider; validation is delegated to llm/custom-provider. */
async function saveCustomProviderConfig(
  options: SetupOptions,
  runtime: SetupFlowRuntime,
): Promise<void> {
  const home = runtime.home;
  runtime.ensureReviewFluxHome(home);
  const baseUrl = assertNonEmpty(
    await runtime.promptText({
      message: "Custom endpoint base URL",
      initialValue: "https://api.openai.com/v1",
    }),
    "base_url",
  );
  const modelId = assertNonEmpty(
    await runtime.promptText({
      message: "Model ID",
      placeholder: "e.g. gpt-4o or claude-3-5-sonnet",
    }),
    "model_id",
  );
  const compatibility = (await runtime.promptSelect<CustomCompatibility>({
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
    await runtime.promptPassword({ message: "API key", mask: "*" }),
    "api_key",
  );

  const validated = runtime.validateCustomProviderConfig({
    baseUrl,
    modelId,
    compatibility,
    apiKey: key,
  });
  const provider = runtime.getCustomProviderId(validated.compatibility);
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

  const path = runtime.saveConfig(config, home);
  logSetupCompletion(path, home, runtime.logSetupEvent, {
    provider,
    authMode: "apikey",
    advanced: options.advanced,
  });
  runtime.releaseInteractiveInput();
}

export async function runSetupFlow(
  options: SetupOptions,
  collaborators: SetupFlowCollaborators = {},
): Promise<void> {
  const runtime = resolveSetupFlowRuntime(collaborators);
  const home = runtime.home;
  const reviewFluxHome = runtime.ensureReviewFluxHome(home);
  const globalAgents = runtime.ensureGlobalAgentsTemplate(home);

  runtime.logSetupEvent({
    event: "setup_started",
    type: "lifecycle",
    level: "info",
    message: "Setup started",
    context: { advanced: options.advanced },
  });

  console.log("[reviewflux] setup started");
  console.log(`[reviewflux] config directory: ${reviewFluxHome}`);
  console.log(`[reviewflux] queue database: ${reviewQueuePath(home)}`);
  if (globalAgents.created) {
    console.log(
      `[reviewflux] created global review guidance: ${globalAgentsPath(home)}`,
    );
    console.log(
      `[reviewflux] global review template source: ${globalAgents.source}`,
    );
    runtime.logSetupEvent({
      event: "global_guidance_created",
      type: "lifecycle",
      level: "info",
      message: "Global guidance created",
      context: { advanced: options.advanced },
    });
  }

  const groups = runtime.getProviderGroupsForSelection();
  if (groups.length === 0) {
    throw new Error("no_providers_from_pi_ai");
  }

  const SKIP_VALUE = "__skip__";
  const BACK_VALUE = "__back__";
  const CUSTOM_GROUP_VALUE = "__custom__";

  let provider: LlmProvider;
  while (true) {
    const selectedGroupKey = await runtime.promptSelect<string>({
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
        (groups[0] as (typeof groups)[number]).groupKey,
    });

    if (selectedGroupKey === SKIP_VALUE) {
      console.log(
        "[reviewflux] setup skipped. Run rvw setup again when ready.",
      );
      runtime.logSetupEvent({
        event: "setup_skipped",
        type: "lifecycle",
        level: "info",
        message: "Setup skipped",
        context: { advanced: options.advanced, outcome: "skipped" },
      });
      runtime.releaseInteractiveInput();
      return;
    }

    if (selectedGroupKey === CUSTOM_GROUP_VALUE) {
      await saveCustomProviderConfig(options, runtime);
      return;
    }

    const selectedGroup = groups.find((g) => g.groupKey === selectedGroupKey) as (typeof groups)[number];

    if (selectedGroup.providers.length === 1) {
      provider = selectedGroup.providers[0] as LlmProvider;
      break;
    }

    const methodSelection = await runtime.promptSelect<string>({
      message: `${selectedGroup.groupLabel} auth method`,
      options: [
        ...selectedGroup.providers.map((p) => ({
          label: runtime.getProviderChoiceLabel(p),
          value: p,
          hint: runtime.getProviderChoiceHint(p),
        })),
        { label: "Back", value: BACK_VALUE },
      ],
      initialValue:
        selectedGroup.providers.find(
          (p) => p === "openai-codex" || p === "google-gemini-cli",
        ) ?? (selectedGroup.providers[0] as string),
    });

    if (methodSelection === BACK_VALUE) {
      continue;
    }
    provider = methodSelection as LlmProvider;
    break;
  }

  const authMode: AuthMode = isOAuthCapableProvider(
    provider,
    runtime.getOAuthProviders,
  )
    ? "oauth"
    : "apikey";

  const defaultBaseUrl = defaultBaseUrlForProvider(
    resolveApiProviderForSetup({ authMode, provider }),
    runtime.getModels,
  );
  let llmApiBaseUrl = defaultBaseUrl;

  if (options.advanced) {
    llmApiBaseUrl = assertNonEmpty(
      (await runtime.promptText({
        message: "LLM API base URL",
        initialValue: defaultBaseUrl,
      })) || defaultBaseUrl,
      "llm_api_base_url",
    );
  }

  const profileId = `${provider}:default`;

  if (authMode === "apikey") {
    const key = assertNonEmpty(
      await runtime.promptPassword({ message: "Paste API key", mask: "*" }),
      "api_key",
    );
    const model = await pickDefaultModel({
      message: "Select default model",
      authMode,
      provider,
    }, runtime);
    assertModelSupportedByPiAi({ authMode, provider, model }, runtime.getModel);

    const effort =
      provider === "openai-codex"
        ? await pickCodexEffort(
            { authMode, model, defaultEffort: "medium" },
            runtime,
          )
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

    const path = runtime.saveConfig(config, home);
    logSetupCompletion(path, home, runtime.logSetupEvent, {
      provider,
      authMode,
      advanced: options.advanced,
    });
    runtime.releaseInteractiveInput();
    return;
  }

  if (!isOAuthCapableProvider(provider, runtime.getOAuthProviders)) {
    throw new Error(`oauth_not_supported_for_provider:${provider}`);
  }

  const { oauth, oauthMode } = await collectOAuthConfig(provider, runtime);
  const model = await pickDefaultModel({
    message: "Select default model (OAuth verified)",
    authMode,
    provider,
  }, runtime);
  assertModelSupportedByPiAi({ authMode, provider, model }, runtime.getModel);

  const effort =
    provider === "openai-codex"
      ? await pickCodexEffort(
          { authMode, model, defaultEffort: "medium" },
          runtime,
        )
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

  const path = runtime.saveConfig(config, home);
  logSetupCompletion(path, home, runtime.logSetupEvent, {
    provider,
    authMode,
    oauthMode,
    advanced: options.advanced,
  });
  runtime.releaseInteractiveInput();
}

const defaultSetupCommandHandlers: SetupCommandHandlers = {
  runSetup: runSetupFlow,
};

function normalizeSetupOptions(options: Partial<SetupOptions> = {}): SetupOptions {
  return { advanced: options.advanced === true };
}

export function buildSetupCommand(
  program: Command,
  dependencies: SetupCommandDependencies = {},
): Command {
  const handlers = resolveCommandBuilderDependencies(
    defaultSetupCommandHandlers,
    dependencies,
  );

  program
    .command("setup")
    .description("configure ReviewFlux auth and local defaults")
    .option("--advanced", "show advanced setup prompts")
    .action(async (options: Partial<SetupOptions>) => {
      await handlers.runSetup(normalizeSetupOptions(options));
    });

  return program;
}


/**
 * 1. PR 코드 diff
 * 2. REVIEWFLUX-AGENTS.md 파일에 있는 내용을 참고하여 코드 리뷰를 시작해야함
* 3. 유저가 repo add 를 통해 선택한 AGENTS.md 파일에 있는 내용도 같이 참고해서 코드리뷰를 해야함 (유저 저장소의 코드 컨벤션 등이 담긴 AGENTS.md 파일)
 * 4. 코드리뷰에 대한 결과를 뽑는데, 리뷰 결과는 JSON 형식으로 뽑아야함
 * 5. {line, path, body} 형식으로 나와야 하는데 line과 path는 코드 diff에 있는 내용을 참고해서 뽑아야함 
 * 6. line과 path를 뽑는 이유는 github에서 코드 리뷰를 할 때, 코드 리뷰를 하는 라인과 파일 경로를 명시해야 하기 때문입니다.
 * 7. 만약 리뷰를 함에 있어서 line과 path가 없다면 그냥 {line: '', path: '', body: 'Summary, Findings, Verification Notes가 담긴 내용...'} 과 같이 body에 내용만 적어서 뽑으면 됩니다.
 * 8. body는 리뷰 결과에 대한 설명이 담긴 내용이 되어야 함 => 이건 또 Summary, Findings, Verification Notes 이런 형식으로 나와야합니다.
 * 9. 결국 요약하자면 LLM을 통해 코드 리뷰를 하고 {line:'', path:'', body: ''} 형태의 json을 1차적으로 뽑고 2차적으론 body에 내가 지정한 형태의 출력 형식 내용이 들어갑니다.
 */
