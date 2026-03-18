import { readFileSync } from "node:fs";
import { Command } from "commander";
import {
  PROGRAM_DESCRIPTION,
  PROGRAM_NAME,
  configureHelp,
} from "../commands/help/index";
import {
  buildDaemonCommand,
  type DaemonCommandDependencies,
} from "../commands/daemon/index";
import { buildRepoCommand } from "../commands/repo/index";
import { buildSetupCommand } from "../commands/setup/index";

type ProgramCommandDependencies = {
  daemon?: DaemonCommandDependencies;
};

function resolveProgramVersion(): string {
  const raw = readFileSync(new URL("../../package.json", import.meta.url), "utf8");
  const parsed = JSON.parse(raw) as { version?: unknown };

  if (typeof parsed.version !== "string" || parsed.version.length === 0) {
    throw new Error("package_version_missing");
  }

  return parsed.version;
}

export function buildProgram(
  dependencies: ProgramCommandDependencies = {},
): Command {
  return buildDaemonCommand(
    buildRepoCommand(
      buildSetupCommand(
        configureHelp(
          new Command()
            .name(PROGRAM_NAME)
            .description(PROGRAM_DESCRIPTION)
            .version(resolveProgramVersion()),
        ),
      ),
    ),
    dependencies.daemon,
  );
}
