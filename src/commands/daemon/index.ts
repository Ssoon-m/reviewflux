import { Command } from "commander";
import {
  resolveCommandBuilderDependencies,
  type CommandBuilderDependencies,
} from "../../cli/command-builder.js";

export type DaemonCommandHandlers = {
  runDaemonStartCommand: () => Promise<void>;
  runDaemonStopCommand: () => Promise<void>;
  runDaemonStatusCommand: () => Promise<void>;
  runDaemonInstallCommand: () => Promise<void>;
};

export type DaemonCommandDependencies = CommandBuilderDependencies<
  DaemonCommandHandlers
>;

const defaultDaemonCommandHandlers: DaemonCommandHandlers = {
  runDaemonStartCommand: async () => {
    const module = await import("./start.js");
    await module.runDaemonStartCommand();
  },
  runDaemonStopCommand: async () => {
    const module = await import("./stop.js");
    await module.runDaemonStopCommand();
  },
  runDaemonStatusCommand: async () => {
    const module = await import("./status.js");
    await module.runDaemonStatusCommand();
  },
  runDaemonInstallCommand: async () => {
    const module = await import("./install.js");
    await module.runDaemonInstallCommand();
  },
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

export async function runDaemonStartCommand(): Promise<void> {
  const module = await import("./start.js");
  await module.runDaemonStartCommand();
}

export async function runDaemonStopCommand(): Promise<void> {
  const module = await import("./stop.js");
  await module.runDaemonStopCommand();
}

export async function runDaemonStatusCommand(): Promise<void> {
  const module = await import("./status.js");
  await module.runDaemonStatusCommand();
}

export async function runDaemonInstallCommand(): Promise<void> {
  const module = await import("./install.js");
  await module.runDaemonInstallCommand();
}
