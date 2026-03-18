import type { Command } from "commander";

export const PROGRAM_NAME = "rvw";
export const PROGRAM_DESCRIPTION = "CLI-first event-driven review runtime";

export function configureHelp(
  program: Command,
): Command {
  program.helpCommand("help [command]", "display help for command");
  program.showHelpAfterError();
  program.showSuggestionAfterError();

  return program;
}
