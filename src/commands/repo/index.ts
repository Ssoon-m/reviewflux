import { Command } from "commander";
import {
  resolveCommandBuilderDependencies,
  type CommandBuilderDependencies,
} from "../../cli/command-builder.js";
import { runRepoAddCommand } from "./add.js";
import { runRepoListCommand } from "./list.js";
import { runRepoRemoveCommand } from "./remove.js";
import { runRepoSetModelCommand } from "./set-model.js";

export type RepoCommandHandlers = {
  runRepoAddCommand: typeof runRepoAddCommand;
  runRepoListCommand: typeof runRepoListCommand;
  runRepoRemoveCommand: typeof runRepoRemoveCommand;
  runRepoSetModelCommand: typeof runRepoSetModelCommand;
};

export type RepoCommandDependencies =
  CommandBuilderDependencies<RepoCommandHandlers>;

const defaultRepoCommandHandlers: RepoCommandHandlers = {
  runRepoAddCommand,
  runRepoListCommand,
  runRepoRemoveCommand,
  runRepoSetModelCommand,
};

export function buildRepoCommand(
  program: Command,
  dependencies: RepoCommandDependencies = {},
): Command {
  const handlers = resolveCommandBuilderDependencies(
    defaultRepoCommandHandlers,
    dependencies,
  );

  const repo = program
    .command("repo")
    .description("manage tracked repositories");

  repo.command("add").description("add a repository to track").action(async () => {
    await handlers.runRepoAddCommand();
  });
  repo.command("list").description("list tracked repositories").action(async () => {
    await handlers.runRepoListCommand();
  });
  repo.command("remove").description("remove a tracked repository").action(async () => {
    await handlers.runRepoRemoveCommand();
  });
  repo
    .command("set-model")
    .description("set the review model for a repository")
    .action(async () => {
      await handlers.runRepoSetModelCommand();
    });

  return program;
}

export {
  runRepoAddCommand,
  runRepoListCommand,
  runRepoRemoveCommand,
  runRepoSetModelCommand,
};
