import type { Command } from "commander";

type BuildProgram = () => Command;

export type CommanderRunResult = {
  error: unknown;
  stdout: string;
  stderr: string;
};

export type CommanderTestHarness = {
  program: Command;
  stdout: () => string;
  stderr: () => string;
  run: (args: string[]) => Promise<CommanderRunResult>;
};

export function createCommanderTestHarness(
  buildProgram: BuildProgram,
): CommanderTestHarness {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const program = buildProgram();

  const configureCommand = (command: Command) => {
    command.configureOutput({
      writeOut: (str) => {
        stdout.push(str);
      },
      writeErr: (str) => {
        stderr.push(str);
      },
    });
    command.exitOverride();

    for (const subcommand of command.commands) {
      configureCommand(subcommand);
    }
  };

  configureCommand(program);

  return {
    program,
    stdout: () => stdout.join(""),
    stderr: () => stderr.join(""),
    async run(args) {
      let error: unknown;

      try {
        await program.parseAsync(args, { from: "user" });
      } catch (caught) {
        error = caught;
      }

      return {
        error,
        stdout: stdout.join(""),
        stderr: stderr.join(""),
      };
    },
  };
}
