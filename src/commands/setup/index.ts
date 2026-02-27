import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { promptPassword, promptSelect, promptText } from "../../cli/clack-prompter.js";
import { getModel, getModels, loginOpenAICodex, type OAuthCredentials } from "@mariozechner/pi-ai";
import {
  ensureReviewFluxHome,
  saveConfig,
  type AuthMode,
  type EffortLevel,
  type ReviewFluxConfig,
  type LlmProvider,
} from "../../cli/config.js";
import {
  assertOAuthState,
  buildCodexAuthorizeUrl,
  CODEX_AUTHORIZE_URL,
  CODEX_CLIENT_ID,
  CODEX_REDIRECT_URI,
  CODEX_TOKEN_URL,
  createOAuthState,
  createPkceChallenge,
  createPkceVerifier,
  extractAuthCode,
} from "../../auth/oauth-codex.js";

type SetupOptions = {
  advanced: boolean;
};

type OAuthTokenResponse = {
  accessToken: string;
  refreshToken?: string;
  tokenType?: string;
  expiresInSec?: number;
};

const DEFAULT_MODEL = "gpt-5.3-codex";

function parseSetupOptions(args: string[]): SetupOptions {
  return {
    advanced: args.includes("--advanced"),
  };
}

function assertNonEmpty(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field}_required`);
  return trimmed;
}

function resolvePiProviderForSetup(params: { authMode: AuthMode; provider: LlmProvider }): "openai" | "openai-codex" | "google" {
  if (params.provider === "gemini") return "google";
  return params.authMode === "oauth" ? "openai-codex" : "openai";
}

function assertModelSupportedByPiAi(params: { authMode: AuthMode; provider: LlmProvider; model: string }): void {
  const piProvider = resolvePiProviderForSetup(params);
  const resolved = getModel(piProvider, params.model as never);
  if (!resolved) {
    throw new Error(`model_not_supported_by_pi_ai:${piProvider}/${params.model}`);
  }
}

function getSelectableModels(params: { authMode: AuthMode; provider: LlmProvider }): Array<{ id: string; name: string }> {
  if (params.provider === "gemini") {
    return getModels("google")
      .filter((model) => model.id.startsWith("gemini-"))
      .map((model) => ({ id: model.id, name: model.name }));
  }

  if (params.authMode === "oauth") {
    return getModels("openai-codex").map((model) => ({ id: model.id, name: model.name }));
  }

  return getModels("openai")
    .filter((model) => model.id.includes("codex"))
    .map((model) => ({ id: model.id, name: model.name }));
}

async function pickDefaultModel(params: {
  message: string;
  authMode: AuthMode;
  provider: LlmProvider;
  defaultModel?: string;
}): Promise<string> {
  const available = getSelectableModels({ authMode: params.authMode, provider: params.provider });
  const fallback = available.find((m) => m.id === DEFAULT_MODEL)?.id ?? available[0]?.id ?? "gpt-5-codex";
  return promptSelect<string>({
    message: params.message,
    options: available.map((model) => ({
      label: `${model.id} (${model.name})`,
      value: model.id,
    })),
    initialValue: params.defaultModel ?? fallback,
  });
}

async function pickEffort(defaultEffort: EffortLevel = "medium"): Promise<EffortLevel> {
  return promptSelect<EffortLevel>({
    message: "Select effort",
    options: [
      { label: "Low", value: "low" },
      { label: "Medium", value: "medium" },
      { label: "High", value: "high" },
      { label: "Extra high", value: "xhigh" },
    ],
    initialValue: defaultEffort,
  });
}

async function fetchTextWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = 30_000,
): Promise<{ status: number; ok: boolean; text: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const text = await res.text();
    return { status: res.status, ok: res.ok, text };
  } finally {
    clearTimeout(timer);
  }
}

function openBrowser(url: string): boolean {
  const platform = process.platform;

  if (platform === "darwin") {
    const probe = spawnSync("which", ["open"], { encoding: "utf8" });
    if (probe.status !== 0) return false;
    const proc = spawn("open", [url], { stdio: "ignore" });
    return proc.pid != null;
  }

  if (platform === "win32") {
    const proc = spawn("cmd", ["/c", "start", "", url], { stdio: "ignore" });
    return proc.pid != null;
  }

  const probe = spawnSync("which", ["xdg-open"], { encoding: "utf8" });
  if (probe.status !== 0) return false;
  const proc = spawn("xdg-open", [url], { stdio: "ignore" });
  return proc.pid != null;
}

async function loginWithPiAiOpenAICodex(): Promise<OAuthCredentials> {
  let fallbackPromptShown = false;

  const creds = await loginOpenAICodex({
    onAuth: async ({ url }) => {
      console.log("\n[reviewflux] OAuth URL ready");
      console.log("Open this URL in your LOCAL browser:");
      console.log(`${url}\n`);

      const opened = openBrowser(url);
      if (opened) {
        console.log("[reviewflux] opening browser for OAuth login...");
      } else {
        console.log("[reviewflux] browser auto-open failed. open the URL above manually.");
      }

      console.log("[reviewflux] waiting for OAuth callback on http://127.0.0.1:1455/auth/callback ...");
    },
    onPrompt: async (prompt) => {
      if (!fallbackPromptShown) {
        console.log(
          "[reviewflux] automatic callback was not completed. Switching to manual fallback (paste redirect URL/code).",
        );
        fallbackPromptShown = true;
      }

      while (true) {
        const value = await promptText({ message: prompt.message, initialValue: prompt.placeholder ?? "" });
        const trimmed = value.trim();
        if (trimmed.length > 0) return trimmed;
        if (prompt.allowEmpty) return "";
        console.log("[reviewflux] OAuth input is required. Paste redirect URL/code to continue.");
      }
    },
    onProgress: (message) => {
      if (message?.trim()) console.log(`[reviewflux] ${message}`);
    },
  });

  console.log("[reviewflux] OAuth verified.");
  return creds;
}

async function waitForOAuthCode(params: {
  redirectUri: string;
  expectedState: string;
  timeoutMs?: number;
}): Promise<{ code: string; state?: string }> {
  const uri = new URL(params.redirectUri);
  const host = uri.hostname;
  if (uri.protocol === "https:") {
    throw new Error("oauth_redirect_https_not_supported");
  }
  if (uri.protocol !== "http:") {
    throw new Error(`oauth_redirect_unsupported_scheme:${uri.protocol}`);
  }
  const port = Number(uri.port || 80);
  const path = uri.pathname || "/";

  return await new Promise<{ code: string; state?: string }>((resolve, reject) => {
    const timer = setTimeout(() => {
      server.close();
      reject(new Error("oauth_callback_timeout"));
    }, params.timeoutMs ?? 120_000);

    const server = createServer((req, res) => {
      const reqUrl = new URL(req.url ?? "/", params.redirectUri);
      if (req.method !== "GET" || reqUrl.pathname !== path) {
        res.statusCode = 404;
        res.end("Not found");
        return;
      }

      const error = reqUrl.searchParams.get("error");
      if (error) {
        clearTimeout(timer);
        server.close();
        res.statusCode = 400;
        res.end("OAuth failed. You can close this tab.");
        reject(new Error(`oauth_error:${error}`));
        return;
      }

      const code = reqUrl.searchParams.get("code");
      const state = reqUrl.searchParams.get("state") ?? undefined;

      if (!code) {
        res.statusCode = 400;
        res.end("Missing code. You can close this tab.");
        return;
      }

      if (state !== params.expectedState) {
        clearTimeout(timer);
        server.close();
        res.statusCode = 400;
        res.end("State mismatch. You can close this tab.");
        reject(new Error("oauth_state_mismatch"));
        return;
      }

      clearTimeout(timer);
      server.close();
      res.statusCode = 200;
      res.end("ReviewFlux setup complete. You can close this tab.");
      resolve({ code, state });
    });

    server.once("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`oauth_callback_listen_failed:${error instanceof Error ? error.message : String(error)}`));
    });

    server.listen(port, host);
  });
}

async function requestOAuthToken(params: {
  tokenUrl: string;
  clientId: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<OAuthTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: params.redirectUri,
    client_id: params.clientId,
    code_verifier: params.codeVerifier,
  });

  const rawRes = await fetchTextWithTimeout(
    params.tokenUrl,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    },
    30_000,
  );

  if (!rawRes.ok) throw new Error(`oauth_token_request_failed (${rawRes.status}): ${rawRes.text}`);

  const json = JSON.parse(rawRes.text) as {
    access_token?: string;
    refresh_token?: string;
    token_type?: string;
    expires_in?: number;
  };

  if (!json.access_token) throw new Error("oauth_token_missing_access_token");

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    tokenType: json.token_type,
    expiresInSec: json.expires_in,
  };
}

type OAuthSetupStrategy = {
  collectOAuthConfig(options: SetupOptions): Promise<NonNullable<ReviewFluxConfig["oauth"]>>;
};

class CodexOAuthSetupStrategy implements OAuthSetupStrategy {
  async collectOAuthConfig(options: SetupOptions): Promise<NonNullable<ReviewFluxConfig["oauth"]>> {
    const oauthFlow = await promptSelect<"browser-flow" | "paste-token">({
      message: "OAuth setup method",
      options: [
        { label: "OpenAI Codex OAuth (browser login)", value: "browser-flow" },
        { label: "Paste existing access token", value: "paste-token" },
      ],
      initialValue: "browser-flow",
    });

    if (oauthFlow === "paste-token") {
      const accessToken = assertNonEmpty(
        await promptPassword({ message: "Paste OAuth access token", mask: "*" }),
        "oauth_access_token",
      );

      return {
        authorizeUrl: CODEX_AUTHORIZE_URL,
        tokenUrl: CODEX_TOKEN_URL,
        clientId: CODEX_CLIENT_ID,
        redirectUri: CODEX_REDIRECT_URI,
        accessToken,
      };
    }

    if (!options.advanced) {
      const creds = await loginWithPiAiOpenAICodex();
      return {
        authorizeUrl: CODEX_AUTHORIZE_URL,
        tokenUrl: CODEX_TOKEN_URL,
        clientId: CODEX_CLIENT_ID,
        redirectUri: CODEX_REDIRECT_URI,
        accessToken: creds.access,
        refreshToken: creds.refresh,
        expiresAtEpochMs: creds.expires,
      };
    }

    const authorizeUrl = assertNonEmpty(
      await promptText({ message: "OAuth authorize URL", initialValue: CODEX_AUTHORIZE_URL }),
      "oauth_authorize_url",
    );
    const tokenUrl = assertNonEmpty(await promptText({ message: "OAuth token URL", initialValue: CODEX_TOKEN_URL }), "oauth_token_url");
    const clientId = assertNonEmpty(await promptText({ message: "OAuth client_id", initialValue: CODEX_CLIENT_ID }), "oauth_client_id");
    const redirectUri = assertNonEmpty(await promptText({ message: "Redirect URI", initialValue: CODEX_REDIRECT_URI }), "oauth_redirect_uri");

    const codeVerifier = createPkceVerifier();
    const state = createOAuthState();
    const loginUrl = buildCodexAuthorizeUrl({
      authorizeUrl,
      clientId,
      redirectUri,
      state,
      codeChallenge: createPkceChallenge(codeVerifier),
    });

    console.log("\n[reviewflux] OAuth URL ready");
    console.log("Open this URL in your LOCAL browser:");
    console.log(`${loginUrl}\n`);

    const callbackMode = await promptSelect<"paste" | "local-server">({
      message: "How do you want to complete OAuth callback?",
      options: [
        { label: "Paste redirect URL (or code / code#state)", value: "paste" },
        { label: "Use local callback server", value: "local-server" },
      ],
      initialValue: "paste",
    });

    let authResult: { code: string; state?: string };

    if (callbackMode === "local-server") {
      console.log("[reviewflux] opening browser for OAuth login...");
      const opened = openBrowser(loginUrl);
      if (!opened) {
        console.log("[reviewflux] browser auto-open failed. open the URL above manually.");
      }

      console.log("[reviewflux] waiting for OAuth callback...");
      authResult = await waitForOAuthCode({ redirectUri, expectedState: state });
      console.log("[reviewflux] callback received.");
    } else {
      const pasted = await promptText({ message: "Paste redirect URL (or code / code#state)" });
      authResult = extractAuthCode(pasted);
      assertOAuthState({ expectedState: state, actualState: authResult.state, requireState: true });
    }

    console.log("[reviewflux] requesting access token...");
    const token = await requestOAuthToken({
      tokenUrl,
      clientId,
      code: authResult.code,
      redirectUri,
      codeVerifier,
    });

    return {
      authorizeUrl,
      tokenUrl,
      clientId,
      redirectUri,
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      tokenType: token.tokenType,
      expiresAtEpochMs: token.expiresInSec ? Date.now() + token.expiresInSec * 1000 : undefined,
    };
  }
}

class GeminiOAuthSetupStrategy implements OAuthSetupStrategy {
  async collectOAuthConfig(_options: SetupOptions): Promise<NonNullable<ReviewFluxConfig["oauth"]>> {
    console.log("[reviewflux] Gemini OAuth uses bearer token input in setup.");
    const accessToken = assertNonEmpty(
      await promptPassword({ message: "Paste Google OAuth access token", mask: "*" }),
      "oauth_access_token",
    );

    const refreshTokenRaw = await promptPassword({ message: "Refresh token (optional)", mask: "*" });
    const refreshToken = refreshTokenRaw.trim() || undefined;

    return {
      accessToken,
      ...(refreshToken ? { refreshToken } : {}),
    };
  }
}

function createOAuthSetupStrategy(provider: LlmProvider): OAuthSetupStrategy {
  if (provider === "gemini") {
    return new GeminiOAuthSetupStrategy();
  }
  return new CodexOAuthSetupStrategy();
}

async function collectOAuthConfig(provider: LlmProvider, options: SetupOptions): Promise<NonNullable<ReviewFluxConfig["oauth"]>> {
  return createOAuthSetupStrategy(provider).collectOAuthConfig(options);
}

async function runSetup(options: SetupOptions): Promise<void> {
  const home = ensureReviewFluxHome();

  console.log("[reviewflux] setup started");
  console.log(`[reviewflux] config directory: ${home}`);

  const provider = await promptSelect<LlmProvider>({
    message: "Select LLM provider",
    options: [
      { label: "codex (OpenAI)", value: "codex" },
      { label: "gemini (Google)", value: "gemini" },
    ],
    initialValue: "codex",
  });

  const authChoices = [
    { label: "OAuth", value: "oauth" as const },
    { label: "API Key", value: "apikey" as const },
  ];

  const authMode = await promptSelect<"oauth" | "apikey">({
    message: "Select auth mode",
    options: authChoices,
    initialValue: provider === "gemini" ? "apikey" : "oauth",
  });

  const defaultBaseUrl = provider === "gemini" ? "https://generativelanguage.googleapis.com/v1beta" : "https://api.openai.com/v1";
  let llmApiBaseUrl = defaultBaseUrl;

  if (options.advanced) {
    llmApiBaseUrl = assertNonEmpty(
      (await promptText({ message: "LLM API base URL", initialValue: defaultBaseUrl })) || defaultBaseUrl,
      "llm_api_base_url",
    );
  }

  let config: ReviewFluxConfig;

  if (authMode === "apikey") {
    const key = assertNonEmpty(await promptPassword({ message: "Paste API key", mask: "*" }), "api_key");
    const model = await pickDefaultModel({
      message: "Select default model",
      authMode: "apikey",
      provider,
      defaultModel: provider === "gemini" ? "gemini-2.5-flash" : "gpt-5-codex",
    });
    assertModelSupportedByPiAi({ authMode: "apikey", provider, model });
    const effort = await pickEffort("medium");

    const profileId = `${provider}:default`;
    config = {
      appName: "reviewflux",
      llm: provider,
      authMode: "apikey",
      llmApiBaseUrl,
      model,
      effort,
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
  } else {
    const oauth = await collectOAuthConfig(provider, options);
    const model = await pickDefaultModel({
      message: "Select default model (OAuth verified)",
      authMode: "oauth",
      provider,
      defaultModel: "gpt-5.3-codex",
    });
    assertModelSupportedByPiAi({ authMode: "oauth", provider, model });
    const effort = await pickEffort("medium");

    const profileId = `${provider}:default`;
    config = {
      appName: "reviewflux",
      llm: provider,
      authMode: "oauth",
      llmApiBaseUrl,
      model,
      effort,
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
  }

  const path = saveConfig(config);
  console.log(`\n[reviewflux] setup complete: ${path}`);
  console.log("Next: reviewflux daemon start");
}

export async function runSetupCommand(args: string[]): Promise<void> {
  await runSetup(parseSetupOptions(args));
}
