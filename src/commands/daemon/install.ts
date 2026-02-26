import { runDaemonInstall } from "../../cli/legacy.js";

export async function runDaemonInstallCommand(): Promise<void> {
  await runDaemonInstall();
}
