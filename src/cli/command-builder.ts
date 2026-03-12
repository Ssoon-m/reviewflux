import type { Command } from "commander";

export type CommandHandler = (...args: any[]) => void | Promise<void>;

export type CommandHandlerMap = Record<string, CommandHandler>;

export type CommandBuilderDependencies<
  THandlers extends CommandHandlerMap,
> = Partial<THandlers>;

export type CommandBuilder<THandlers extends CommandHandlerMap> = (
  program: Command,
  dependencies?: CommandBuilderDependencies<THandlers>,
) => Command;

export function resolveCommandBuilderDependencies<
  THandlers extends CommandHandlerMap,
>(
  defaults: THandlers,
  dependencies: CommandBuilderDependencies<THandlers> = {},
): THandlers {
  return { ...defaults, ...dependencies };
}
