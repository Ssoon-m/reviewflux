#!/usr/bin/env node
import { printHelp } from "./legacy.js";
import { runSetupCommand } from "../commands/setup.js";
import {
  runDaemonInstallCommand,
  runDaemonStartCommand,
  runDaemonStatusCommand,
  runDaemonStopCommand,
} from "../commands/daemon/index.js";

async function main() {
  const args = process.argv.slice(2);
  const [cmd, subcmd] = args;

  if (!cmd || cmd === "--help" || cmd === "-h") {
    printHelp();
    return;
  }

  if (cmd === "setup") {
    await runSetupCommand(args.slice(1));
    return;
  }

  if (cmd === "daemon" && subcmd === "start") {
    await runDaemonStartCommand();
    return;
  }

  if (cmd === "daemon" && subcmd === "stop") {
    await runDaemonStopCommand();
    return;
  }

  if (cmd === "daemon" && subcmd === "status") {
    await runDaemonStatusCommand();
    return;
  }

  if (cmd === "daemon" && subcmd === "install") {
    await runDaemonInstallCommand();
    return;
  }

  printHelp();
  process.exitCode = 1;
}

main().catch((error) => {
  console.error("[reviewflux] fatal", error);
  process.exit(1);
});
