import { CommanderError } from "commander";
import { describe, expect, it, vi } from "vitest";
import { resolveCommandBuilderDependencies } from "../src/cli/command-builder.js";
import { buildProgram } from "../src/cli/program.js";
import { createCommanderTestHarness } from "./commander-test-harness.js";

describe("cli-program", () => {
  it("builds the Commander root program", () => {
    const harness = createCommanderTestHarness(buildProgram);

    expect(harness.program.name()).toBe("reviewflux");
    expect(harness.program.commands.map((command) => command.name())).toEqual(
      expect.arrayContaining(["setup", "project", "daemon"]),
    );
  });

  it("shows root help from the Commander runtime", async () => {
    const harness = createCommanderTestHarness(buildProgram);
    const { error, stdout } = await harness.run(["--help"]);

    expect(error).toBeInstanceOf(CommanderError);
    expect((error as CommanderError).code).toBe("commander.helpDisplayed");
    expect(stdout).toContain("Usage: reviewflux");
    expect(stdout).toContain("help [command]");
    expect(stdout).toContain("project");
  });

  it("shows root help when the help command is invoked without a topic", async () => {
    const harness = createCommanderTestHarness(buildProgram);
    const { error, stdout } = await harness.run(["help"]);

    expect(error).toBeInstanceOf(CommanderError);
    expect((error as CommanderError).code).toBe("commander.help");
    expect(stdout).toContain("Usage: reviewflux");
    expect(stdout).toContain("help [command]");
    expect(stdout).toContain("daemon");
  });

  it("shows help project from the Commander runtime", async () => {
    const harness = createCommanderTestHarness(buildProgram);
    const { error, stdout } = await harness.run(["help", "project"]);

    expect(error).toBeInstanceOf(CommanderError);
    expect((error as CommanderError).code).toBe("commander.help");
    expect(stdout).toContain("Usage: reviewflux project");
    expect(stdout).toContain("set-model");
  });

  it("shows project help when the project group is invoked without a subcommand", async () => {
    const harness = createCommanderTestHarness(buildProgram);
    const { error, stdout, stderr } = await harness.run(["project"]);
    const output = `${stdout}${stderr}`;

    expect(error).toBeInstanceOf(CommanderError);
    expect((error as CommanderError).code).toBe("commander.help");
    expect(output).toContain("Usage: reviewflux project");
    expect(output).toContain("remove");
  });

  it("shows daemon help when the daemon group is invoked without a subcommand", async () => {
    const harness = createCommanderTestHarness(buildProgram);
    const { error, stdout, stderr } = await harness.run(["daemon"]);
    const output = `${stdout}${stderr}`;

    expect(error).toBeInstanceOf(CommanderError);
    expect((error as CommanderError).code).toBe("commander.help");
    expect(output).toContain("Usage: reviewflux daemon");
    expect(output).toContain("install");
  });

  it("reports unknown root commands without exiting the process", async () => {
    const harness = createCommanderTestHarness(buildProgram);
    const { error, stderr } = await harness.run(["bogus"]);

    expect(error).toBeInstanceOf(CommanderError);
    expect((error as CommanderError).code).toBe("commander.unknownCommand");
    expect(stderr).toContain("error: unknown command 'bogus'");
  });

  it("registers setup options from the setup builder", async () => {
    const harness = createCommanderTestHarness(buildProgram);
    const { error, stdout } = await harness.run(["setup", "--help"]);

    expect(error).toBeInstanceOf(CommanderError);
    expect((error as CommanderError).code).toBe("commander.helpDisplayed");
    expect(stdout).toContain("Usage: reviewflux setup");
    expect(stdout).toContain("--advanced");
  });

  it("reports invalid setup options through the root Commander runtime", async () => {
    const harness = createCommanderTestHarness(buildProgram);
    const { error, stderr } = await harness.run(["setup", "--bogus"]);

    expect(error).toBeInstanceOf(CommanderError);
    expect((error as CommanderError).code).toBe("commander.unknownOption");
    expect(stderr).toContain("error: unknown option '--bogus'");
    expect(stderr).toContain("Usage: reviewflux setup");
  });

  it("routes daemon start through the registered daemon builder", async () => {
    const runDaemonStartCommand = vi.fn(async () => {});
    const harness = createCommanderTestHarness(() =>
      buildProgram({ daemon: { runDaemonStartCommand } }),
    );
    const { error } = await harness.run(["daemon", "start"]);

    expect(error).toBeUndefined();
    expect(runDaemonStartCommand).toHaveBeenCalledTimes(1);
  });

  it("merges injected handlers over builder defaults", () => {
    const defaults = {
      runSetupCommand: vi.fn(async () => {}),
      runProjectListCommand: vi.fn(async () => {}),
    };
    const injectedRunSetupCommand = vi.fn(async () => {});

    const handlers = resolveCommandBuilderDependencies(defaults, {
      runSetupCommand: injectedRunSetupCommand,
    });

    expect(handlers.runSetupCommand).toBe(injectedRunSetupCommand);
    expect(handlers.runProjectListCommand).toBe(defaults.runProjectListCommand);
  });
});
