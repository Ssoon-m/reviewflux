import { Command } from "commander";
import {
  resolveCommandBuilderDependencies,
  type CommandBuilderDependencies,
} from "../../cli/command-builder.js";

type RunDaemonStartCommand = (typeof import("./start.js"))["runDaemonStartCommand"];
type RunDaemonStopCommand = (typeof import("./stop.js"))["runDaemonStopCommand"];
type RunDaemonStatusCommand = (typeof import("./status.js"))["runDaemonStatusCommand"];
type RunDaemonInstallCommand = (typeof import("./install.js"))["runDaemonInstallCommand"];

export type DaemonCommandHandlers = {
  runDaemonStartCommand: RunDaemonStartCommand;
  runDaemonStopCommand: RunDaemonStopCommand;
  runDaemonStatusCommand: RunDaemonStatusCommand;
  runDaemonInstallCommand: RunDaemonInstallCommand;
};

export type DaemonCommandDependencies = CommandBuilderDependencies<
  DaemonCommandHandlers
>;

export const runDaemonStartCommand: RunDaemonStartCommand = async (...args) => {
  const module = await import("./start.js");
  await module.runDaemonStartCommand(...args);
};

export const runDaemonStopCommand: RunDaemonStopCommand = async (...args) => {
  const module = await import("./stop.js");
  await module.runDaemonStopCommand(...args);
};

export const runDaemonStatusCommand: RunDaemonStatusCommand = async (...args) => {
  const module = await import("./status.js");
  await module.runDaemonStatusCommand(...args);
};

export const runDaemonInstallCommand: RunDaemonInstallCommand = async (...args) => {
  const module = await import("./install.js");
  await module.runDaemonInstallCommand(...args);
};

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
