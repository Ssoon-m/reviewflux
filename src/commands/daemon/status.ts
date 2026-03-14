import {
  ReviewJobStore,
  ReviewQueueDatabase,
  reviewQueuePath,
} from "../../review/queue/index.js";

function resolvePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

export async function runDaemonStatusCommand(): Promise<void> {
  const staleRunningMs = Math.max(
    resolvePositiveInt(process.env.REVIEWFLUX_JOB_STALE_RUNNING_MS, 5 * 60_000),
    5_000,
  );
  const database = new ReviewQueueDatabase();

  try {
    const jobStore = new ReviewJobStore(database);
    const snapshot = jobStore.getStatusSnapshot({
      staleBefore: new Date(Date.now() - staleRunningMs).toISOString(),
    });

    console.log("[reviewflux] daemon status");
    console.log(`[reviewflux] queue database: ${reviewQueuePath()}`);
    console.log(
      `[reviewflux] jobs pending=${snapshot.counts.pending} running=${snapshot.counts.running} done=${snapshot.counts.done} failed=${snapshot.counts.failed}`,
    );
    console.log(
      `[reviewflux] stale running (>${staleRunningMs}ms): ${snapshot.staleRunningCount}`,
    );
    console.log(
      `[reviewflux] oldest pending available_at: ${snapshot.oldestPendingAvailableAt ?? "none"}`,
    );
    console.log(
      `[reviewflux] oldest running claimed_at: ${snapshot.oldestRunningClaimedAt ?? "none"}`,
    );
  } finally {
    database.close();
  }
}
