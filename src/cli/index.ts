#!/usr/bin/env node
import { CommanderError } from "commander";
import { buildProgram } from "./program";
import { normalizeRootArgs } from "./root-args";

function applyExitOverride(command: import("commander").Command): void {
  command.exitOverride();
  for (const subcommand of command.commands) {
    applyExitOverride(subcommand);
  }
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
