#!/usr/bin/env node
import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as wait } from "node:timers/promises";
import { input, password, select } from "@inquirer/prompts";
import { ensureReviewFluxHome, loadConfig, saveConfig, type ReviewFluxConfig } from "./cli-config.js";

type SetupOptions = {
  advanced: boolean;
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

async function waitForOAuthCode(redirectUri: string, timeoutMs = 120_000): Promise<string> {
  const uri = new URL(redirectUri);
  const host = uri.hostname;
  const port = Number(uri.port || 80);
  const path = uri.pathname || "/";

  return await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      server.close();
      reject(new Error("oauth_callback_timeout"));
    }, timeoutMs);

    const server = createServer((req, res) => {
      const reqUrl = new URL(req.url ?? "/", redirectUri);
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
      if (!code) {
        res.statusCode = 400;
        res.end("Missing code. You can close this tab.");
        return;
      }

      clearTimeout(timer);
      server.close();
      res.statusCode = 200;
      res.end("ReviewFlux setup complete. You can close this tab.");
      resolve(code);
    });

    server.listen(port, host);
  });
}

async function exchangeCodeForToken(params: {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: params.redirectUri,
    client_id: params.clientId,
    client_secret: params.clientSecret
  });

  const res = await fetch(params.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body
  });

  const raw = await res.text();
  if (!res.ok) throw new Error(`oauth_token_request_failed (${res.status}): ${raw}`);

  const json = JSON.parse(raw) as { access_token?: string };
  const accessToken = json.access_token;
  if (!accessToken) throw new Error("oauth_token_missing_access_token");
  return accessToken;
}

function buildAuthorizeUrl(params: {
  authorizeUrl: string;
  clientId: string;
  redirectUri: string;
  scope?: string;
}): string {
  const state = randomUUID();
  const url = new URL(params.authorizeUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("state", state);
  if (params.scope?.trim()) url.searchParams.set("scope", params.scope.trim());
  return url.toString();
}

function extractAuthCode(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("oauth_code_required");

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    const url = new URL(trimmed);
    const code = url.searchParams.get("code");
    if (!code) throw new Error("oauth_redirect_missing_code");
    return code;
  }

  return trimmed;
}

async function collectOAuthConfig() {
  const oauthFlow = await select<"paste-token" | "browser-flow">({
    message: "OAuth setup method",
    choices: [
      { name: "Browser login (Auth Code flow)", value: "browser-flow" },
      { name: "Paste existing access token", value: "paste-token" }
    ],
    default: "browser-flow"
  });

  if (oauthFlow === "paste-token") {
    const authorizeUrl = await input({ message: "OAuth authorize URL (optional)", default: "" });
    const accessToken = assertNonEmpty(
      await password({ message: "Paste OAuth access token", mask: "*" }),
      "oauth_access_token"
    );

    return {
      authorizeUrl: authorizeUrl || undefined,
      accessToken
    };
  }

  const authorizeUrl = assertNonEmpty(
    await input({ message: "OAuth authorize URL (e.g. https://auth.example.com/authorize)" }),
    "oauth_authorize_url"
  );
  const tokenUrl = assertNonEmpty(
    await input({ message: "OAuth token URL (e.g. https://auth.example.com/oauth/token)" }),
    "oauth_token_url"
  );
  const clientId = assertNonEmpty(await input({ message: "OAuth client_id" }), "oauth_client_id");
  const clientSecret = assertNonEmpty(
    await password({ message: "OAuth client_secret", mask: "*" }),
    "oauth_client_secret"
  );
  const scope = await input({ message: "OAuth scope (optional)", default: "" });
  const redirectUri =
    (await input({ message: "Redirect URI", default: "http://127.0.0.1:8787/callback" })) ||
    "http://127.0.0.1:8787/callback";

  const loginUrl = buildAuthorizeUrl({ authorizeUrl, clientId, redirectUri, scope });
  console.log("\n[reviewflux] OAuth URL ready");
  console.log("Open this URL in your LOCAL browser:");
  console.log(`${loginUrl}\n`);

  const callbackMode = await select<"paste" | "local-server">({
    message: "How do you want to complete OAuth callback?",
    choices: [
      { name: "Paste redirect URL (or authorization code)", value: "paste" },
      { name: "Use local callback server", value: "local-server" }
    ],
    default: "paste"
  });

  let code: string;
  if (callbackMode === "local-server") {
    console.log("[reviewflux] opening browser for OAuth login...");
    const opened = openBrowser(loginUrl);
    if (!opened) {
      console.log("[reviewflux] browser auto-open failed. open the URL above manually.");
    }

    console.log("[reviewflux] waiting for OAuth callback...");
    code = await waitForOAuthCode(redirectUri);
    console.log("[reviewflux] callback received.");
  } else {
    const pasted = await input({ message: "Paste redirect URL (or authorization code)" });
    code = extractAuthCode(pasted);
  }

  console.log("[reviewflux] requesting access token...");
  const accessToken = await exchangeCodeForToken({ tokenUrl, clientId, clientSecret, code, redirectUri });

  return {
    authorizeUrl,
    tokenUrl,
    clientId,
    redirectUri,
    accessToken
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

  // OpenClaw-like default-first flow: hide base URL from normal setup.
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
    const oauth = await collectOAuthConfig();
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

async function runDaemonStart() {
  const cfg = loadConfig();
  console.log("[reviewflux] daemon start");

  if (cfg.authMode !== "oauth" || !cfg.oauth?.accessToken) {
    console.error("[reviewflux] currently only OAuth mode is executable in daemon start.");
    console.error("[reviewflux] run: reviewflux setup (choose OAuth)");
    process.exit(1);
  }

  console.log("[reviewflux] waiting 3 seconds before test request...");
  await wait(3000);

  const url = `${cfg.llmApiBaseUrl.replace(/\/$/, "")}/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${cfg.oauth.accessToken}`
    },
    body: JSON.stringify({
      model: cfg.model,
      messages: [{ role: "user", content: "안녕?" }]
    })
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`[reviewflux] request failed (${res.status})`);
    console.error(text);
    process.exit(1);
  }

  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = json.choices?.[0]?.message?.content ?? "";
  console.log("[reviewflux] response:");
  console.log(content);
}

async function main() {
  const [cmd, subcmd, ...rest] = process.argv.slice(2);

  if (!cmd || cmd === "--help" || cmd === "-h") {
    printHelp();
    return;
  }

  if (cmd === "setup") {
    await runSetup(parseSetupOptions(rest));
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
