import { parseSetupOptions, runSetup } from "../cli/legacy.js";

export async function runSetupCommand(args: string[]): Promise<void> {
  await runSetup(parseSetupOptions(args));
}
