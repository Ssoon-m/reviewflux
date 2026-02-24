#!/usr/bin/env node
import { setTimeout as wait } from "node:timers/promises";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { ensureReviewFluxHome, loadConfig, saveConfig, type ReviewFluxConfig } from "./cli-config.js";

function printHelp() {
  console.log(`reviewflux commands:
  reviewflux setup
  reviewflux daemon start
  reviewflux daemon install`);
}

async function ask(question: string): Promise<string> {
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question(question);
    return answer.trim();
  } finally {
    rl.close();
  }
}

async function runSetup() {
  const home = ensureReviewFluxHome();

  console.log("[reviewflux] setup started");
  console.log(`[reviewflux] config directory: ${home}`);

  console.log("\nLLM provider:");
  console.log("  1) codex (only option for now)");
  await ask("Select provider [1]: ");

  console.log("\nAuth mode:");
  console.log("  1) OAuth (recommended)");
  console.log("  2) API Key");
  const authChoice = (await ask("Select auth mode [1/2]: ")) || "1";

  const llmApiBaseUrl =
    (await ask("LLM API base URL (default: https://api.openai.com/v1): ")) || "https://api.openai.com/v1";
  const model = (await ask("Model (default: gpt-5-codex): ")) || "gpt-5-codex";

  let config: ReviewFluxConfig;

  if (authChoice === "2") {
    const key = await ask("Paste API key: ");
    config = {
      appName: "reviewflux",
      llm: "codex",
      authMode: "apikey",
      llmApiBaseUrl,
      model,
      apiKey: { key }
    };
  } else {
    const authorizeUrl = await ask("OAuth authorize URL (optional, press enter to skip): ");
    if (authorizeUrl) {
      console.log(`Open this URL in your browser and complete auth:\n${authorizeUrl}`);
    }
    const accessToken = await ask("Paste OAuth access token: ");

    config = {
      appName: "reviewflux",
      llm: "codex",
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
