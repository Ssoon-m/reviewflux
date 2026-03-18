import { Command, CommanderError } from "commander";
import { describe, expect, it, vi } from "vitest";
import {
  buildSetupCommand,
  runSetupFlow,
} from "../src/commands/setup/index";
import { createCommanderTestHarness } from "./commander-test-harness";

function createSetupHarness(runSetup = vi.fn(async () => {})) {
  return {
    runSetup,
    harness: createCommanderTestHarness(() => {
      const program = new Command().name("reviewflux");
      program.showHelpAfterError();
      program.showSuggestionAfterError();
      return buildSetupCommand(program, { runSetup });
    }),
  };
}

describe("setup-command", () => {
  it("exports a direct setup flow helper for collaborator-driven tests", () => {
    expect(runSetupFlow).toBeTypeOf("function");
  });

  it("routes setup --advanced to advanced=true", async () => {
    const { harness, runSetup } = createSetupHarness();
    const { error } = await harness.run(["setup", "--advanced"]);

    expect(error).toBeUndefined();
    expect(runSetup).toHaveBeenCalledTimes(1);
    expect(runSetup).toHaveBeenCalledWith({ advanced: true });
  });

  it("routes plain setup to advanced=false", async () => {
    const { harness, runSetup } = createSetupHarness();
    const { error } = await harness.run(["setup"]);

    expect(error).toBeUndefined();
    expect(runSetup).toHaveBeenCalledTimes(1);
    expect(runSetup).toHaveBeenCalledWith({ advanced: false });
  });

  it("shows setup help without entering the setup flow", async () => {
    const { harness, runSetup } = createSetupHarness();
    const { error, stdout } = await harness.run(["setup", "--help"]);

    expect(error).toBeInstanceOf(CommanderError);
    expect((error as CommanderError).code).toBe("commander.helpDisplayed");
    expect(runSetup).not.toHaveBeenCalled();
    expect(stdout).toContain("Usage: reviewflux setup");
    expect(stdout).toContain("--advanced");
  });

  it("rejects invalid setup options through Commander validation", async () => {
    const { harness, runSetup } = createSetupHarness();
    const { error, stderr } = await harness.run(["setup", "--bogus"]);

    expect(error).toBeInstanceOf(CommanderError);
    expect((error as CommanderError).code).toBe("commander.unknownOption");
    expect(runSetup).not.toHaveBeenCalled();
    expect(stderr).toContain("error: unknown option '--bogus'");
  });
});
