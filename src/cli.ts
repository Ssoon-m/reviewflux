#!/usr/bin/env node
import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
import { input, password, select } from "@inquirer/prompts";
import { completeSimple, getModel, loginOpenAICodex, type OAuthCredentials } from "@mariozechner/pi-ai";
import { ensureReviewFluxHome, loadConfig, saveConfig, type ReviewFluxConfig } from "./cli-config.js";
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
  extractAuthCode
} from "./oauth-codex.js";

type SetupOptions = {
  advanced: boolean;
};

type OAuthTokenResponse = {
  accessToken: string;
  refreshToken?: string;
  tokenType?: string;
  expiresInSec?: number;
};

function printHelp() {
  console.log(`reviewflux commands:
  reviewflux setup [--advanced]
  reviewflux daemon start
  reviewflux daemon install`);
}

function assertNonEmpty(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field}_required`);
  return trimmed;
}

function parseSetupOptions(args: string[]): SetupOptions {
  return {
    advanced: args.includes("--advanced")
  };
}

async function fetchTextWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = 30_000
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
          "[reviewflux] automatic callback was not completed. Switching to manual fallback (paste redirect URL/code)."
        );
        fallbackPromptShown = true;
      }

      while (true) {
        const value = await input({ message: prompt.message, default: prompt.placeholder ?? "" });
        const trimmed = value.trim();
        if (trimmed.length > 0) return trimmed;
        if (prompt.allowEmpty) return "";
        console.log("[reviewflux] OAuth input is required. Paste redirect URL/code to continue.");
      }
    },
    onProgress: (message) => {
      if (message?.trim()) console.log(`[reviewflux] ${message}`);
    }
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
    code_verifier: params.codeVerifier
  });

  const rawRes = await fetchTextWithTimeout(
    params.tokenUrl,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body
    },
    30_000
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
    expiresInSec: json.expires_in
  };
}

async function refreshOAuthToken(params: {
  tokenUrl: string;
  clientId: string;
  refreshToken: string;
}): Promise<OAuthTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: params.refreshToken,
    client_id: params.clientId
  });

  const rawRes = await fetchTextWithTimeout(
    params.tokenUrl,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body
    },
    30_000
  );

  if (!rawRes.ok) throw new Error(`oauth_refresh_failed (${rawRes.status}): ${rawRes.text}`);

  const json = JSON.parse(rawRes.text) as {
    access_token?: string;
    refresh_token?: string;
    token_type?: string;
    expires_in?: number;
  };

  if (!json.access_token) throw new Error("oauth_refresh_missing_access_token");

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    tokenType: json.token_type,
    expiresInSec: json.expires_in
  };
}

async function collectOAuthConfig(options: SetupOptions): Promise<NonNullable<ReviewFluxConfig["oauth"]>> {
  const oauthFlow = await select<"browser-flow" | "paste-token">({
    message: "OAuth setup method",
    choices: [
      { name: "OpenAI Codex OAuth (browser login)", value: "browser-flow" },
      { name: "Paste existing access token", value: "paste-token" }
    ],
    default: "browser-flow"
  });

  if (oauthFlow === "paste-token") {
    const accessToken = assertNonEmpty(
      await password({ message: "Paste OAuth access token", mask: "*" }),
      "oauth_access_token"
    );

    return {
      authorizeUrl: CODEX_AUTHORIZE_URL,
      tokenUrl: CODEX_TOKEN_URL,
      clientId: CODEX_CLIENT_ID,
      redirectUri: CODEX_REDIRECT_URI,
      accessToken
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
    await input({ message: "OAuth authorize URL", default: CODEX_AUTHORIZE_URL }),
    "oauth_authorize_url"
  );
  const tokenUrl = assertNonEmpty(await input({ message: "OAuth token URL", default: CODEX_TOKEN_URL }), "oauth_token_url");
  const clientId = assertNonEmpty(await input({ message: "OAuth client_id", default: CODEX_CLIENT_ID }), "oauth_client_id");
  const redirectUri = assertNonEmpty(await input({ message: "Redirect URI", default: CODEX_REDIRECT_URI }), "oauth_redirect_uri");

  const codeVerifier = createPkceVerifier();
  const state = createOAuthState();
  const loginUrl = buildCodexAuthorizeUrl({
    authorizeUrl,
    clientId,
    redirectUri,
    state,
    codeChallenge: createPkceChallenge(codeVerifier)
  });

  console.log("\n[reviewflux] OAuth URL ready");
  console.log("Open this URL in your LOCAL browser:");
  console.log(`${loginUrl}\n`);

  const callbackMode = await select<"paste" | "local-server">({
    message: "How do you want to complete OAuth callback?",
    choices: [
      { name: "Paste redirect URL (or code / code#state)", value: "paste" },
      { name: "Use local callback server", value: "local-server" }
    ],
    default: "paste"
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
    const pasted = await input({ message: "Paste redirect URL (or code / code#state)" });
    authResult = extractAuthCode(pasted);
    assertOAuthState({ expectedState: state, actualState: authResult.state, requireState: true });
  }

  console.log("[reviewflux] requesting access token...");
  const token = await requestOAuthToken({
    tokenUrl,
    clientId,
    code: authResult.code,
    redirectUri,
    codeVerifier
  });

  return {
    authorizeUrl,
    tokenUrl,
    clientId,
    redirectUri,
    accessToken: token.accessToken,
    refreshToken: token.refreshToken,
    tokenType: token.tokenType,
    expiresAtEpochMs: token.expiresInSec ? Date.now() + token.expiresInSec * 1000 : undefined
  };
}

async function runSetup(options: SetupOptions) {
  const home = ensureReviewFluxHome();

  console.log("[reviewflux] setup started");
  console.log(`[reviewflux] config directory: ${home}`);

  const provider = await select<"codex">({
    message: "Select LLM provider",
    choices: [{ name: "codex (only option for now)", value: "codex" }],
    default: "codex"
  });

  const authMode = await select<"oauth" | "apikey">({
    message: "Select auth mode",
    choices: [
      { name: "OAuth (recommended)", value: "oauth" },
      { name: "API Key", value: "apikey" }
    ],
    default: "oauth"
  });

  let llmApiBaseUrl = "https://api.openai.com/v1";

  if (options.advanced) {
    llmApiBaseUrl = assertNonEmpty(
      (await input({ message: "LLM API base URL", default: "https://api.openai.com/v1" })) ||
        "https://api.openai.com/v1",
      "llm_api_base_url"
    );
  }

  let config: ReviewFluxConfig;

  if (authMode === "apikey") {
    const key = assertNonEmpty(await password({ message: "Paste API key", mask: "*" }), "api_key");
    const model =
      (await input({
        message: "Model",
        default: "gpt-5-codex"
      })) || "gpt-5-codex";

    config = {
      appName: "reviewflux",
      llm: provider,
      authMode: "apikey",
      llmApiBaseUrl,
      model,
      apiKey: { key }
    };
  } else {
    const oauth = await collectOAuthConfig(options);
    const model =
      (await input({
        message: "Model (OAuth verified)",
        default: "gpt-5-codex"
      })) || "gpt-5-codex";

    config = {
      appName: "reviewflux",
      llm: provider,
      authMode: "oauth",
      llmApiBaseUrl,
      model,
      oauth
    };
  }

  const path = saveConfig(config);
  console.log(`\n[reviewflux] setup complete: ${path}`);
  console.log("Next: reviewflux daemon start");
}

function resolveApiKeyForDaemon(cfg: ReviewFluxConfig): string {
  if (cfg.authMode === "oauth" && cfg.oauth?.accessToken) {
    return cfg.oauth.accessToken;
  }
  if (cfg.authMode === "apikey" && cfg.apiKey?.key?.trim()) {
    return cfg.apiKey.key.trim();
  }
  throw new Error("daemon_missing_credentials");
}

async function runDaemonStart() {
  const cfg = loadConfig();
  console.log("[reviewflux] daemon start");

  if (
    cfg.authMode === "oauth" &&
    cfg.oauth?.accessToken &&
    cfg.oauth.expiresAtEpochMs &&
    cfg.oauth.refreshToken &&
    cfg.oauth.tokenUrl &&
    cfg.oauth.clientId &&
    Date.now() >= cfg.oauth.expiresAtEpochMs - 10_000
  ) {
    console.log("[reviewflux] access token expired soon. refreshing...");
    const token = await refreshOAuthToken({
      tokenUrl: cfg.oauth.tokenUrl,
      clientId: cfg.oauth.clientId,
      refreshToken: cfg.oauth.refreshToken
    });
    cfg.oauth.accessToken = token.accessToken;
    cfg.oauth.refreshToken = token.refreshToken ?? cfg.oauth.refreshToken;
    cfg.oauth.tokenType = token.tokenType ?? cfg.oauth.tokenType;
    cfg.oauth.expiresAtEpochMs = token.expiresInSec ? Date.now() + token.expiresInSec * 1000 : undefined;
    saveConfig(cfg);
  }

  const apiKey = resolveApiKeyForDaemon(cfg);

  console.log("[reviewflux] waiting 3 seconds before test request...");
  await wait(3000);

  const model = getModel("openai", cfg.model as never);
  const modelWithBaseUrl = {
    ...model,
    baseUrl: cfg.llmApiBaseUrl.replace(/\/$/, "")
  };

  try {
    const result = await completeSimple(
      modelWithBaseUrl,
      {
        messages: [{ role: "user", content: "안녕?", timestamp: Date.now() }]
      },
      { apiKey, maxTokens: 256 }
    );

    const text = result.content
      .filter((item): item is { type: "text"; text: string } => item.type === "text")
      .map((item) => item.text)
      .join("\n")
      .trim();

    if (result.stopReason === "error") {
      console.error("[reviewflux] model returned error response");
      console.error(result.errorMessage ?? "unknown_model_error");
      process.exit(1);
    }

    console.log("[reviewflux] response:");
    if (text.length > 0) {
      console.log(text);
    } else {
      console.log("(no text block returned)");
      console.log(
        `[reviewflux] stopReason=${result.stopReason}, contentTypes=${result.content.map((item) => item.type).join(",")}`
      );
      console.log("[reviewflux] raw content:");
      console.log(JSON.stringify(result.content, null, 2));
    }
  } catch (error) {
    console.error("[reviewflux] request failed (pi-ai)");
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const [cmd, subcmd, ...rest] = args;

  if (!cmd || cmd === "--help" || cmd === "-h") {
    printHelp();
    return;
  }

  if (cmd === "setup") {
    await runSetup(parseSetupOptions(args.slice(1)));
    return;
  }

  if (cmd === "daemon" && subcmd === "start") {
    await runDaemonStart();
    return;
  }

  if (cmd === "daemon" && subcmd === "install") {
    console.log("[reviewflux] daemon install placeholder (service manager wiring will be added).");
    return;
  }

  printHelp();
  process.exitCode = 1;
}

main().catch((error) => {
  console.error("[reviewflux] fatal", error);
  process.exit(1);
});
