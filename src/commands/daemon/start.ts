import { runDaemonStart } from "../../cli/legacy.js";

export async function runDaemonStartCommand(): Promise<void> {
  await runDaemonStart();
}
