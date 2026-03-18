import { Command, CommanderError } from "commander";
import { describe, expect, it, vi } from "vitest";
import {
  buildDaemonCommand,
  type DaemonCommandHandlers,
} from "../src/commands/daemon/index";
import {
  PROGRAM_DESCRIPTION,
  PROGRAM_NAME,
  configureHelp,
} from "../src/commands/help/index";
import { createCommanderTestHarness } from "./commander-test-harness";

function createDaemonHandlers(): DaemonCommandHandlers {
  return {
    runDaemonStartCommand: vi.fn(async () => {}),
    runDaemonStopCommand: vi.fn(async () => {}),
    runDaemonStatusCommand: vi.fn(async () => {}),
    runDaemonInstallCommand: vi.fn(async () => {}),
  };
}

function createDaemonHarness(
  dependencies: Partial<DaemonCommandHandlers> = {},
) {
  const handlers = { ...createDaemonHandlers(), ...dependencies };
  const harness = createCommanderTestHarness(() =>
    buildDaemonCommand(
      configureHelp(
        new Command().name(PROGRAM_NAME).description(PROGRAM_DESCRIPTION),
      ),
      handlers,
    ),
  );

  return { harness, handlers };
}

function expectNoDaemonHandlersCalled(handlers: DaemonCommandHandlers): void {
  expect(handlers.runDaemonStartCommand).not.toHaveBeenCalled();
  expect(handlers.runDaemonStopCommand).not.toHaveBeenCalled();
  expect(handlers.runDaemonStatusCommand).not.toHaveBeenCalled();
  expect(handlers.runDaemonInstallCommand).not.toHaveBeenCalled();
}

describe("daemon-command", () => {
  it.each([
    ["start", "runDaemonStartCommand"],
    ["stop", "runDaemonStopCommand"],
    ["status", "runDaemonStatusCommand"],
    ["install", "runDaemonInstallCommand"],
  ] as const)("routes daemon %s to the injected handler", async (subcommand, handlerName) => {
    const { harness, handlers } = createDaemonHarness();
    const { error } = await harness.run(["daemon", subcommand]);

    expect(error).toBeUndefined();
    expect(handlers[handlerName]).toHaveBeenCalledTimes(1);
    for (const [name, handler] of Object.entries(handlers)) {
      if (name !== handlerName) {
        expect(handler).not.toHaveBeenCalled();
      }
    }
  });

  it("shows daemon help without entering daemon handlers", async () => {
    const { harness, handlers } = createDaemonHarness();
    const { error, stdout } = await harness.run(["help", "daemon"]);

    expect(error).toBeInstanceOf(CommanderError);
    expect((error as CommanderError).code).toBe("commander.help");
    expect(stdout).toContain("Usage: rvw daemon");
    expect(stdout).toContain("install");
    expectNoDaemonHandlersCalled(handlers);
  });

  it("shows daemon start help without entering the live daemon loop", async () => {
    const { harness, handlers } = createDaemonHarness();
    const { error, stdout } = await harness.run(["daemon", "start", "--help"]);

    expect(error).toBeInstanceOf(CommanderError);
    expect((error as CommanderError).code).toBe("commander.helpDisplayed");
    expect(stdout).toContain("Usage: rvw daemon start");
    expect(stdout).toContain("start the background daemon");
    expectNoDaemonHandlersCalled(handlers);
  });

  it("rejects invalid daemon subcommands with help output", async () => {
    const { harness, handlers } = createDaemonHarness();
    const { error, stderr } = await harness.run(["daemon", "nope"]);

    expect(error).toBeInstanceOf(CommanderError);
    expect((error as CommanderError).code).toBe("commander.unknownCommand");
    expect(stderr).toContain("error: unknown command 'nope'");
    expect(stderr).toContain("Usage: rvw daemon");
    expectNoDaemonHandlersCalled(handlers);
  });
});
