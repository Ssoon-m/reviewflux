#!/usr/bin/env node
import { setTimeout as wait } from "node:timers/promises";
import { input, password, select } from "@inquirer/prompts";
import { ensureReviewFluxHome, loadConfig, saveConfig, type ReviewFluxConfig } from "./cli-config.js";

function printHelp() {
  console.log(`reviewflux commands:
  reviewflux setup
  reviewflux daemon start
  reviewflux daemon install`);
}

async function runSetup() {
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

  const llmApiBaseUrl =
    (await input({ message: "LLM API base URL", default: "https://api.openai.com/v1" })) ||
    "https://api.openai.com/v1";
  const model = (await input({ message: "Model", default: "gpt-5-codex" })) || "gpt-5-codex";

  let config: ReviewFluxConfig;

  if (authMode === "apikey") {
    const key = await password({ message: "Paste API key", mask: "*" });
    config = {
      appName: "reviewflux",
      llm: provider,
      authMode: "apikey",
      llmApiBaseUrl,
      model,
      apiKey: { key }
    };
  } else {
    const authorizeUrl = await input({ message: "OAuth authorize URL (optional)", default: "" });
    if (authorizeUrl) {
      console.log(`Open this URL in your browser and complete auth:\n${authorizeUrl}`);
    }
    const accessToken = await password({ message: "Paste OAuth access token", mask: "*" });

    config = {
      appName: "reviewflux",
      llm: provider,
      authMode: "oauth",
      llmApiBaseUrl,
      model,
      oauth: {
        authorizeUrl: authorizeUrl || undefined,
        accessToken
      }
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
  const [cmd, subcmd] = process.argv.slice(2);

  if (!cmd || cmd === "--help" || cmd === "-h") {
    printHelp();
    return;
  }

  if (cmd === "setup") {
    await runSetup();
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
