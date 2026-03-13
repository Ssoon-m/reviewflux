import { setTimeout as wait } from "node:timers/promises";
import { loadConfig } from "../../cli/config.js";
import { assertGhReady } from "../../review/github.js";
import type { ProjectConfig } from "../../review/types.js";
import {
  assertReviewQueueRuntimeSupported,
  ReviewJobStore,
  ReviewJobWorker,
  ReviewPollCoordinator,
  ReviewPollStateStore,
  ReviewQueueDatabase,
  reviewQueuePath,
} from "../../review/queue/index.js";

export { resolveReviewOutputFromModel } from "../../llm/review-output.js";

function resolvePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

const POLL_INTERVAL_MS = Math.max(
  resolvePositiveInt(process.env.REVIEWFLUX_POLL_INTERVAL_MS, 30_000),
  5_000,
);
const JOB_MAX_ATTEMPTS = Math.max(
  resolvePositiveInt(process.env.REVIEWFLUX_JOB_MAX_ATTEMPTS, 1),
  1,
);
const JOB_RETRY_DELAY_MS = Math.max(
  resolvePositiveInt(process.env.REVIEWFLUX_JOB_RETRY_DELAY_MS, 30_000),
  1_000,
);
const JOB_STALE_RUNNING_MS = Math.max(
  resolvePositiveInt(process.env.REVIEWFLUX_JOB_STALE_RUNNING_MS, 5 * 60_000),
  5_000,
);

type DaemonCycleCoordinator = Pick<ReviewPollCoordinator, "pollProject">;
type DaemonCycleWorker = Pick<ReviewJobWorker, "drain" | "recoverStaleRunningJobs">;

function logRecoveredJobs(recoveredJobs: number): void {
  if (recoveredJobs > 0) {
    console.log(`[reviewflux] recovered ${recoveredJobs} stale review job(s)`);
  }
}

export async function runDaemonCycle(params: {
  projects: ProjectConfig[];
  coordinator: DaemonCycleCoordinator;
  worker: DaemonCycleWorker;
}): Promise<void> {
  logRecoveredJobs(params.worker.recoverStaleRunningJobs());

  try {
    await params.worker.drain();
  } catch (error) {
    console.error("[reviewflux] review worker drain failed");
    console.error(error instanceof Error ? error.message : String(error));
  }

  for (const project of params.projects) {
    try {
      await params.coordinator.pollProject(project);
    } catch (error) {
      console.error(`[reviewflux] polling failed for ${project.repo}`);
      console.error(error instanceof Error ? error.message : String(error));
    }
  }

  try {
    await params.worker.drain();
  } catch (error) {
    console.error("[reviewflux] review worker drain failed");
    console.error(error instanceof Error ? error.message : String(error));
  }
}

export async function runDaemonStartCommand(): Promise<void> {
  const config = loadConfig();
  const projects = Object.values(config.projects ?? {}).sort((a, b) =>
    a.repo.localeCompare(b.repo),
  );

  console.log("[reviewflux] daemon start");

  if (projects.length === 0) {
    console.log(
      "[reviewflux] no projects configured. run: reviewflux project add",
    );
    return;
  }

  assertReviewQueueRuntimeSupported();
  await assertGhReady();

  console.log(`[reviewflux] gh polling mode enabled (${POLL_INTERVAL_MS}ms)`);
  console.log(`[reviewflux] tracking ${projects.length} project(s)`);
  for (const project of projects) {
    const modelValue = project.model
      ? `${project.model.provider}/${project.model.model}`
      : (project.modelAlias ?? "<default>");
    const contextInfo =
      project.context?.mode === "custom"
        ? `custom:${(project.context.include ?? []).join(",")}`
        : "default:AGENTS.md";
    console.log(
      `- ${project.repo} | mode=${project.pr.mode} | model=${modelValue} | context=${contextInfo}`,
    );
  }
  console.log("[reviewflux] force command is always enabled: @reviewflux");
  console.log(`[reviewflux] queue database: ${reviewQueuePath()}`);

  const database = new ReviewQueueDatabase();
  const pollStateStore = new ReviewPollStateStore(database);
  const jobStore = new ReviewJobStore(database);
  const coordinator = new ReviewPollCoordinator(pollStateStore, jobStore);
  const worker = new ReviewJobWorker(jobStore, {
    maxAttempts: JOB_MAX_ATTEMPTS,
    retryDelayMs: JOB_RETRY_DELAY_MS,
    staleRunningMs: JOB_STALE_RUNNING_MS,
  });
  const abortController = new AbortController();

  const shutdown = () => {
    abortController.abort();
    console.log("\n[reviewflux] daemon stopped");
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  try {
    while (!abortController.signal.aborted) {
      await runDaemonCycle({ projects, coordinator, worker });

      try {
        await wait(POLL_INTERVAL_MS, undefined, {
          signal: abortController.signal,
        });
      } catch {
        break;
      }
    }
  } finally {
    database.close();
  }
}
