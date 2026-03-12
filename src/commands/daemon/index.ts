import { Command } from "commander";
import {
  resolveCommandBuilderDependencies,
  type CommandBuilderDependencies,
} from "../../cli/command-builder.js";
import { runDaemonInstallCommand } from "./install.js";
import { runDaemonStartCommand } from "./start.js";
import { runDaemonStatusCommand } from "./status.js";
import { runDaemonStopCommand } from "./stop.js";

export type DaemonCommandHandlers = {
  runDaemonStartCommand: typeof runDaemonStartCommand;
  runDaemonStopCommand: typeof runDaemonStopCommand;
  runDaemonStatusCommand: typeof runDaemonStatusCommand;
  runDaemonInstallCommand: typeof runDaemonInstallCommand;
};

export type DaemonCommandDependencies = CommandBuilderDependencies<
  DaemonCommandHandlers
>;

const defaultDaemonCommandHandlers: DaemonCommandHandlers = {
  runDaemonStartCommand,
  runDaemonStopCommand,
  runDaemonStatusCommand,
  runDaemonInstallCommand,
};

export function buildDaemonCommand(
  program: Command,
  dependencies: DaemonCommandDependencies = {},
): Command {
  const handlers = resolveCommandBuilderDependencies(
    defaultDaemonCommandHandlers,
    dependencies,
  );

  const daemon = program
    .command("daemon")
    .description("manage the background review daemon");

  daemon.command("start").description("start the background daemon").action(async () => {
    await handlers.runDaemonStartCommand();
  });
  daemon.command("stop").description("stop the background daemon").action(async () => {
    await handlers.runDaemonStopCommand();
  });
  daemon
    .command("status")
    .description("show background daemon status")
    .action(async () => {
      await handlers.runDaemonStatusCommand();
    });
  daemon.command("install").description("install the daemon service").action(async () => {
    await handlers.runDaemonInstallCommand();
  });

  return program;
}

export {
  runDaemonStartCommand,
  runDaemonStopCommand,
  runDaemonStatusCommand,
  runDaemonInstallCommand,
};
