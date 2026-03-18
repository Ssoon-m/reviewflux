import { Command, CommanderError } from "commander";
import { describe, expect, it, vi } from "vitest";
import {
  PROGRAM_DESCRIPTION,
  PROGRAM_NAME,
  configureHelp,
} from "../src/commands/help/index";
import {
  buildRepoCommand,
  type RepoCommandHandlers,
} from "../src/commands/repo/index";
import { createCommanderTestHarness } from "./commander-test-harness";

function createRepoHandlers(): RepoCommandHandlers {
  return {
    runRepoAddCommand: vi.fn(async () => {}),
    runRepoListCommand: vi.fn(async () => {}),
    runRepoRemoveCommand: vi.fn(async () => {}),
    runRepoSetModelCommand: vi.fn(async () => {}),
  };
}

function createRepoHarness(
  dependencies: Partial<RepoCommandHandlers> = {},
) {
  const handlers = { ...createRepoHandlers(), ...dependencies };
  const harness = createCommanderTestHarness(() =>
    buildRepoCommand(
      configureHelp(
        new Command().name(PROGRAM_NAME).description(PROGRAM_DESCRIPTION),
      ),
      handlers,
    ),
  );

  return { harness, handlers };
}

function expectNoRepoHandlersCalled(handlers: RepoCommandHandlers): void {
  expect(handlers.runRepoAddCommand).not.toHaveBeenCalled();
  expect(handlers.runRepoListCommand).not.toHaveBeenCalled();
  expect(handlers.runRepoRemoveCommand).not.toHaveBeenCalled();
  expect(handlers.runRepoSetModelCommand).not.toHaveBeenCalled();
}

describe("repo-command", () => {
  it.each([
    ["add", "runRepoAddCommand"],
    ["list", "runRepoListCommand"],
    ["remove", "runRepoRemoveCommand"],
    ["set-model", "runRepoSetModelCommand"],
  ] as const)("routes repo %s to the injected handler", async (subcommand, handlerName) => {
    const { harness, handlers } = createRepoHarness();
    const { error } = await harness.run(["repo", subcommand]);

    expect(error).toBeUndefined();
    expect(handlers[handlerName]).toHaveBeenCalledTimes(1);
    for (const [name, handler] of Object.entries(handlers)) {
      if (name !== handlerName) {
        expect(handler).not.toHaveBeenCalled();
      }
    }
  });

  it("shows help repo without entering repo flows", async () => {
    const { harness, handlers } = createRepoHarness();
    const { error, stdout } = await harness.run(["help", "repo"]);

    expect(error).toBeInstanceOf(CommanderError);
    expect((error as CommanderError).code).toBe("commander.help");
    expect(stdout).toContain("Usage: reviewflux repo");
    expect(stdout).toContain("remove");
    expectNoRepoHandlersCalled(handlers);
  });

  it("shows repo add help without entering prompt or config flows", async () => {
    const { harness, handlers } = createRepoHarness();
    const { error, stdout } = await harness.run(["repo", "add", "--help"]);

    expect(error).toBeInstanceOf(CommanderError);
    expect((error as CommanderError).code).toBe("commander.helpDisplayed");
    expect(stdout).toContain("Usage: reviewflux repo add");
    expect(stdout).toContain("add a repository to track");
    expectNoRepoHandlersCalled(handlers);
  });

  it("rejects invalid repo subcommands with help output", async () => {
    const { harness, handlers } = createRepoHarness();
    const { error, stderr } = await harness.run(["repo", "nope"]);

    expect(error).toBeInstanceOf(CommanderError);
    expect((error as CommanderError).code).toBe("commander.unknownCommand");
    expect(stderr).toContain("error: unknown command 'nope'");
    expect(stderr).toContain("Usage: reviewflux repo");
    expectNoRepoHandlersCalled(handlers);
  });
});
