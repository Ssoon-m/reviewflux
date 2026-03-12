export function normalizeRootArgs(
  argv: string[],
  groupCommandNames: ReadonlySet<string>,
): string[] {
  const [nodePath, scriptPath, command, ...rest] = argv;

  if (nodePath === undefined || scriptPath === undefined) {
    return argv;
  }

  if (command === undefined) {
    return [nodePath, scriptPath, "--help"];
  }

  if (groupCommandNames.has(command) && rest.length === 0) {
    return [nodePath, scriptPath, command, "--help"];
  }

  return argv;
}
