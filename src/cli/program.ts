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

export function buildProgram(
  dependencies: ProgramCommandDependencies = {},
): Command {
  return buildDaemonCommand(
    buildRepoCommand(
      buildSetupCommand(
        configureHelp(
          new Command().name(PROGRAM_NAME).description(PROGRAM_DESCRIPTION),
        ),
      ),
    ),
    dependencies.daemon,
  );
}
