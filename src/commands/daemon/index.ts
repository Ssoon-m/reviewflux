import type { Command } from "commander";
import {
  resolveCommandBuilderDependencies,
  type CommandBuilderDependencies,
} from "../../cli/command-builder";

type RunDaemonStartCommand = (typeof import("./start"))["runDaemonStartCommand"];
type RunDaemonStopCommand = (typeof import("./stop"))["runDaemonStopCommand"];
type RunDaemonStatusCommand = (typeof import("./status"))["runDaemonStatusCommand"];
type RunDaemonListCommand = (typeof import("./list"))["runDaemonListCommand"];

export type DaemonCommandHandlers = {
  runDaemonStartCommand: RunDaemonStartCommand;
  runDaemonStopCommand: RunDaemonStopCommand;
  runDaemonStatusCommand: RunDaemonStatusCommand;
  runDaemonListCommand: RunDaemonListCommand;
};

export type DaemonCommandDependencies = CommandBuilderDependencies<
  DaemonCommandHandlers
>;

export const runDaemonStartCommand: RunDaemonStartCommand = async (...args) => {
  const module = await import("./start");
  await module.runDaemonStartCommand(...args);
};

export const runDaemonStopCommand: RunDaemonStopCommand = async (...args) => {
  const module = await import("./stop");
  await module.runDaemonStopCommand(...args);
};

export const runDaemonStatusCommand: RunDaemonStatusCommand = async (...args) => {
  const module = await import("./status");
  await module.runDaemonStatusCommand(...args);
};

export const runDaemonListCommand: RunDaemonListCommand = async (...args) => {
  const module = await import("./list");
  await module.runDaemonListCommand(...args);
};

const defaultDaemonCommandHandlers: DaemonCommandHandlers = {
  runDaemonStartCommand,
  runDaemonStopCommand,
  runDaemonStatusCommand,
  runDaemonListCommand,
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
  daemon
    .command("stop")
    .description("stop the background daemon")
    .argument("[pid]", "daemon process id from `rvw daemon list`")
    .action(async (pid: string) => {
      await handlers.runDaemonStopCommand(pid);
    });
  daemon
    .command("status")
    .description("show background daemon status")
    .action(async () => {
      await handlers.runDaemonStatusCommand();
    });
  daemon.command("list").description("list running daemon processes").action(async () => {
    await handlers.runDaemonListCommand();
  });

  return program;
}
