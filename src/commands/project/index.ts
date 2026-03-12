import { Command } from "commander";
import {
  resolveCommandBuilderDependencies,
  type CommandBuilderDependencies,
} from "../../cli/command-builder.js";
import { runProjectAddCommand } from "./add.js";
import { runProjectListCommand } from "./list.js";
import { runProjectRemoveCommand } from "./remove.js";
import { runProjectSetModelCommand } from "./set-model.js";

export type ProjectCommandHandlers = {
  runProjectAddCommand: typeof runProjectAddCommand;
  runProjectListCommand: typeof runProjectListCommand;
  runProjectRemoveCommand: typeof runProjectRemoveCommand;
  runProjectSetModelCommand: typeof runProjectSetModelCommand;
};

export type ProjectCommandDependencies =
  CommandBuilderDependencies<ProjectCommandHandlers>;

const defaultProjectCommandHandlers: ProjectCommandHandlers = {
  runProjectAddCommand,
  runProjectListCommand,
  runProjectRemoveCommand,
  runProjectSetModelCommand,
};

export function buildProjectCommand(
  program: Command,
  dependencies: ProjectCommandDependencies = {},
): Command {
  const handlers = resolveCommandBuilderDependencies(
    defaultProjectCommandHandlers,
    dependencies,
  );

  const project = program
    .command("project")
    .description("manage tracked projects");

  project.command("add").description("add a project to track").action(async () => {
    await handlers.runProjectAddCommand();
  });
  project.command("list").description("list tracked projects").action(async () => {
    await handlers.runProjectListCommand();
  });
  project.command("remove").description("remove a tracked project").action(async () => {
    await handlers.runProjectRemoveCommand();
  });
  project
    .command("set-model")
    .description("set the review model for a project")
    .action(async () => {
      await handlers.runProjectSetModelCommand();
    });

  return program;
}

export {
  runProjectAddCommand,
  runProjectListCommand,
  runProjectRemoveCommand,
  runProjectSetModelCommand,
};
