import { setTimeout as wait } from "node:timers/promises";
import { loadConfig } from "../cli/config.js";
import { logging } from "../infra/logging/index.js";
import { assertGhReady } from "./github.js";
import {
  ReviewJobStore,
  ReviewJobWorker,
  ReviewPollCoordinator,
  ReviewPollStateStore,
  ReviewQueueDatabase,
  reviewQueuePath,
} from "./queue/index.js";
import type { ProjectConfig } from "./types.js";

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
type DaemonSemanticEvent =
  | "daemon_started"
  | "daemon_no_projects"
  | "daemon_projects_loaded"
  | "daemon_cycle_recovered_jobs"
  | "daemon_cycle_worker_drain_failed"
  | "daemon_cycle_poll_failed"
  | "daemon_stopped";
type DaemonEventLogger = (entry: {
  event: DaemonSemanticEvent;
  type: "lifecycle" | "queue";
  level: "info" | "error";
  message: string;
  context?: {
    repo?: string;
    projectCount?: number;
    pollIntervalMs?: number;
    retryDelayMs?: number;
    maxAttempts?: number;
    staleRunningMs?: number;
    staleRunningCount?: number;
    errorMessage?: string;
  };
}) => void;
type RegisterSignalHandler = (
  signal: "SIGINT" | "SIGTERM",
  listener: () => void,
) => (() => void) | undefined;
type DaemonStartCollaborators = {
  loadConfig?: typeof loadConfig;
  assertGhReady?: typeof assertGhReady;
  wait?: typeof wait;
  registerSignalHandler?: RegisterSignalHandler;
  runCycle?: (params: {
    projects: ProjectConfig[];
    coordinator: DaemonCycleCoordinator;
    worker: DaemonCycleWorker;
    logDaemonEvent?: DaemonEventLogger;
    abortSignal?: AbortSignal;
  }) => Promise<void>;
  logging?: typeof logging;
};

function createDaemonEventLogger(writeLog: typeof logging): DaemonEventLogger {
  return (entry) => {
    writeLog({
      surface: "daemon",
      type: entry.type,
      level: entry.level,
      event: entry.event,
      message: entry.message,
      context: entry.context,
    });
  };
}

function resolveErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAbortWaitError(error: unknown, signal: AbortSignal): boolean {
  if (!signal.aborted) {
    return false;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.name === "AbortError"
    || error.message === "aborted"
    || ("code" in error && error.code === "ABORT_ERR")
  );
}

function logRecoveredJobs(recoveredJobs: number): void {
  if (recoveredJobs > 0) {
    console.log(`[reviewflux] recovered ${recoveredJobs} stale review job(s)`);
  }
}

export async function runDaemonCycle(params: {
  projects: ProjectConfig[];
  coordinator: DaemonCycleCoordinator;
  worker: DaemonCycleWorker;
  logDaemonEvent?: DaemonEventLogger;
  abortSignal?: AbortSignal;
}): Promise<void> {
  const logDaemonEvent = params.logDaemonEvent ?? createDaemonEventLogger(logging);
  const recoveredJobs = params.worker.recoverStaleRunningJobs();

  logRecoveredJobs(recoveredJobs);
  if (recoveredJobs > 0) {
    logDaemonEvent({
      event: "daemon_cycle_recovered_jobs",
      type: "queue",
      level: "info",
      message: "Recovered stale review jobs",
      context: { staleRunningCount: recoveredJobs },
    });
  }

  if (params.abortSignal?.aborted) {
    return;
  }

  try {
    await params.worker.drain({ signal: params.abortSignal });
  } catch (error) {
    const errorMessage = resolveErrorMessage(error);
    console.error("[reviewflux] review worker drain failed");
    console.error(errorMessage);
    logDaemonEvent({
      event: "daemon_cycle_worker_drain_failed",
      type: "queue",
      level: "error",
      message: "Review worker drain failed",
      context: { errorMessage },
    });
  }

  if (params.abortSignal?.aborted) {
    return;
  }

  for (const project of params.projects) {
    if (params.abortSignal?.aborted) {
      return;
    }

    try {
      await params.coordinator.pollProject(project);
    } catch (error) {
      const errorMessage = resolveErrorMessage(error);
      console.error(`[reviewflux] polling failed for ${project.repo}`);
      console.error(errorMessage);
      logDaemonEvent({
        event: "daemon_cycle_poll_failed",
        type: "queue",
        level: "error",
        message: "Project polling failed",
        context: {
          repo: project.repo,
          errorMessage,
        },
      });
    }
  }

  if (params.abortSignal?.aborted) {
    return;
  }

  try {
    await params.worker.drain({ signal: params.abortSignal });
  } catch (error) {
    const errorMessage = resolveErrorMessage(error);
    console.error("[reviewflux] review worker drain failed");
    console.error(errorMessage);
    logDaemonEvent({
      event: "daemon_cycle_worker_drain_failed",
      type: "queue",
      level: "error",
      message: "Review worker drain failed",
      context: { errorMessage },
    });
  }
}

export async function runDaemonStartCommand(
  collaborators: DaemonStartCollaborators = {},
): Promise<void> {
  const resolveConfig = collaborators.loadConfig ?? loadConfig;
  const requireGhReady = collaborators.assertGhReady ?? assertGhReady;
  const waitForNextPoll = collaborators.wait ?? wait;
  const registerSignalHandler =
    collaborators.registerSignalHandler
    ?? ((signal: "SIGINT" | "SIGTERM", listener: () => void) => {
      process.once(signal, listener);
      return () => {
        process.off(signal, listener);
      };
    });
  const runCycle = collaborators.runCycle ?? runDaemonCycle;
  const logDaemonEvent = createDaemonEventLogger(collaborators.logging ?? logging);
  const config = resolveConfig();
  const projects = Object.values(config.projects ?? {}).sort((a, b) =>
    a.repo.localeCompare(b.repo),
  );

  console.log("[reviewflux] daemon start");

  if (projects.length === 0) {
    console.log(
      "[reviewflux] no projects configured. run: reviewflux project add",
    );
    logDaemonEvent({
      event: "daemon_no_projects",
      type: "lifecycle",
      level: "info",
      message: "No projects configured for daemon",
      context: { projectCount: 0 },
    });
    return;
  }

  await requireGhReady();

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

  logDaemonEvent({
    event: "daemon_projects_loaded",
    type: "lifecycle",
    level: "info",
    message: "Daemon projects loaded",
    context: {
      projectCount: projects.length,
      pollIntervalMs: POLL_INTERVAL_MS,
      retryDelayMs: JOB_RETRY_DELAY_MS,
      maxAttempts: JOB_MAX_ATTEMPTS,
      staleRunningMs: JOB_STALE_RUNNING_MS,
    },
  });

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
  const unregisterSignalHandlers: Array<() => void> = [];
  let didLogStop = false;

  const logDaemonStopped = () => {
    if (didLogStop) {
      return;
    }

    didLogStop = true;
    console.log("\n[reviewflux] daemon stopped");
    logDaemonEvent({
      event: "daemon_stopped",
      type: "lifecycle",
      level: "info",
      message: "Daemon stopped",
    });
  };

  const shutdown = () => {
    if (abortController.signal.aborted) {
      return;
    }
    abortController.abort();
  };

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    const unregister = registerSignalHandler(signal, shutdown);
    if (typeof unregister === "function") {
      unregisterSignalHandlers.push(unregister);
    }
  }

  logDaemonEvent({
    event: "daemon_started",
    type: "lifecycle",
    level: "info",
    message: "Daemon started",
    context: {
      projectCount: projects.length,
      pollIntervalMs: POLL_INTERVAL_MS,
      retryDelayMs: JOB_RETRY_DELAY_MS,
      maxAttempts: JOB_MAX_ATTEMPTS,
      staleRunningMs: JOB_STALE_RUNNING_MS,
    },
  });

  try {
    while (!abortController.signal.aborted) {
      await runCycle({
        projects,
        coordinator,
        worker,
        logDaemonEvent,
        abortSignal: abortController.signal,
      });

      try {
        await waitForNextPoll(POLL_INTERVAL_MS, undefined, {
          signal: abortController.signal,
        });
      } catch (error) {
        if (isAbortWaitError(error, abortController.signal)) {
          break;
        }

        throw error;
      }
    }
  } finally {
    logDaemonStopped();
    for (const unregister of unregisterSignalHandlers) {
      unregister();
    }
    database.close();
  }
}
