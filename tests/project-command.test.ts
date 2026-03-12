import { Command, CommanderError } from "commander";
import { describe, expect, it, vi } from "vitest";
import {
  PROGRAM_DESCRIPTION,
  PROGRAM_NAME,
  configureHelp,
} from "../src/commands/help/index.js";
import {
  buildProjectCommand,
  type ProjectCommandHandlers,
} from "../src/commands/project/index.js";
import { createCommanderTestHarness } from "./commander-test-harness.js";

function createProjectHandlers(): ProjectCommandHandlers {
  return {
    runProjectAddCommand: vi.fn(async () => {}),
    runProjectListCommand: vi.fn(async () => {}),
    runProjectRemoveCommand: vi.fn(async () => {}),
    runProjectSetModelCommand: vi.fn(async () => {}),
  };
}

function createProjectHarness(
  dependencies: Partial<ProjectCommandHandlers> = {},
) {
  const handlers = { ...createProjectHandlers(), ...dependencies };
  const harness = createCommanderTestHarness(() =>
    buildProjectCommand(
      configureHelp(
        new Command().name(PROGRAM_NAME).description(PROGRAM_DESCRIPTION),
      ),
      handlers,
    ),
  );

  return { harness, handlers };
}

function expectNoProjectHandlersCalled(handlers: ProjectCommandHandlers): void {
  expect(handlers.runProjectAddCommand).not.toHaveBeenCalled();
  expect(handlers.runProjectListCommand).not.toHaveBeenCalled();
  expect(handlers.runProjectRemoveCommand).not.toHaveBeenCalled();
  expect(handlers.runProjectSetModelCommand).not.toHaveBeenCalled();
}

describe("project-command", () => {
  it.each([
    ["add", "runProjectAddCommand"],
    ["list", "runProjectListCommand"],
    ["remove", "runProjectRemoveCommand"],
    ["set-model", "runProjectSetModelCommand"],
  ] as const)("routes project %s to the injected handler", async (subcommand, handlerName) => {
    const { harness, handlers } = createProjectHarness();
    const { error } = await harness.run(["project", subcommand]);

    expect(error).toBeUndefined();
    expect(handlers[handlerName]).toHaveBeenCalledTimes(1);
    for (const [name, handler] of Object.entries(handlers)) {
      if (name !== handlerName) {
        expect(handler).not.toHaveBeenCalled();
      }
    }
  });

  it("shows help project without entering project flows", async () => {
    const { harness, handlers } = createProjectHarness();
    const { error, stdout } = await harness.run(["help", "project"]);

    expect(error).toBeInstanceOf(CommanderError);
    expect((error as CommanderError).code).toBe("commander.help");
    expect(stdout).toContain("Usage: reviewflux project");
    expect(stdout).toContain("remove");
    expectNoProjectHandlersCalled(handlers);
  });

  it("shows project add help without entering prompt or config flows", async () => {
    const { harness, handlers } = createProjectHarness();
    const { error, stdout } = await harness.run(["project", "add", "--help"]);

    expect(error).toBeInstanceOf(CommanderError);
    expect((error as CommanderError).code).toBe("commander.helpDisplayed");
    expect(stdout).toContain("Usage: reviewflux project add");
    expect(stdout).toContain("add a project to track");
    expectNoProjectHandlersCalled(handlers);
  });

  it("rejects invalid project subcommands with help output", async () => {
    const { harness, handlers } = createProjectHarness();
    const { error, stderr } = await harness.run(["project", "nope"]);

    expect(error).toBeInstanceOf(CommanderError);
    expect((error as CommanderError).code).toBe("commander.unknownCommand");
    expect(stderr).toContain("error: unknown command 'nope'");
    expect(stderr).toContain("Usage: reviewflux project");
    expectNoProjectHandlersCalled(handlers);
  });
});
