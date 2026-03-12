#!/usr/bin/env node
import { CommanderError } from "commander";
import { buildProgram } from "./program.js";

function applyExitOverride(command: import("commander").Command): void {
  command.exitOverride();
  for (const subcommand of command.commands) {
    applyExitOverride(subcommand);
  }
}

function normalizeRootArgs(
  argv: string[],
  groupCommandNames: ReadonlySet<string>,
): string[] {
  const [nodePath, scriptPath, command, ...rest] = argv;

  if (
    nodePath !== undefined &&
    scriptPath !== undefined &&
    command !== undefined &&
    groupCommandNames.has(command) &&
    rest.length === 0
  ) {
    return [nodePath, scriptPath, command, "--help"];
  }

  return argv;
}

async function main() {
  const program = buildProgram();
  applyExitOverride(program);
  const groupCommandNames = new Set(
    program.commands
      .filter((command) => command.commands.length > 0)
      .map((command) => command.name()),
  );

  await program.parseAsync(normalizeRootArgs(process.argv, groupCommandNames));
}

main().catch((error) => {
  if (error instanceof CommanderError) {
    process.exit(error.exitCode);
  }

  console.error("[reviewflux] fatal", error);
  process.exit(1);
});
