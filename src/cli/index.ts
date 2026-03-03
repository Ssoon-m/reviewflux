#!/usr/bin/env node
import { printHelp, runHelpCommand } from "../commands/help/index.js";
import { runSetupCommand } from "../commands/setup/index.js";
import {
  runDaemonInstallCommand,
  runDaemonStartCommand,
  runDaemonStatusCommand,
  runDaemonStopCommand,
} from "../commands/daemon/index.js";
import {
  runProjectAddCommand,
  runProjectListCommand,
  runProjectRemoveCommand,
  runProjectSetModelCommand,
} from "../commands/project/index.js";

async function main() {
  const args = process.argv.slice(2);
  const [cmd, subcmd] = args;

  if (!cmd || cmd === "--help" || cmd === "-h") {
    await runHelpCommand();
    return;
  }

  if (cmd === "help") {
    await runHelpCommand();
    return;
  }

  if (cmd === "setup") {
    await runSetupCommand(args.slice(1));
    process.exit(0);
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

  if (cmd === "project" && subcmd === "add") {
    await runProjectAddCommand();
    return;
  }

  if (cmd === "project" && subcmd === "list") {
    await runProjectListCommand();
    return;
  }

  if (cmd === "project" && subcmd === "remove") {
    await runProjectRemoveCommand();
    return;
  }

  if (cmd === "project" && subcmd === "set-model") {
    await runProjectSetModelCommand();
    return;
  }

  printHelp();
  process.exitCode = 1;
}

main().catch((error) => {
  console.error("[reviewflux] fatal", error);
  process.exit(1);
});
