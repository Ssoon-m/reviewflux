import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReviewFluxConfig } from "../src/cli/config.js";
import {
  runDaemonCycle,
  runDaemonStartCommand,
} from "../src/commands/daemon/start.js";
import { reviewQueuePath } from "../src/review/queue/index.js";
import type { ProjectConfig } from "../src/review/types.js";

type DaemonLogRecord = {
  ts: string;
  date: string;
  surface: "daemon";
  type: "lifecycle" | "queue" | "system";
  level: "info" | "warn" | "error";
  event: string;
  message: string;
  context: Record<string, string | number | boolean | undefined>;
};

function makeTempHome(): string {
  return mkdtempSync(join(tmpdir(), "reviewflux-daemon-start-"));
}

function getDaemonLogPath(home: string, date: string): string {
  return join(home, ".reviewflux", "logs", date, "daemon.jsonl");
}

function readDaemonLog(home: string, date: string): DaemonLogRecord[] {
  return readFileSync(getDaemonLogPath(home, date), "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as DaemonLogRecord);
}

const homes: string[] = [];
const originalHome = process.env.HOME;

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { recursive: true, force: true });
  }

  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }

  vi.restoreAllMocks();
  vi.useRealTimers();
});

function makeProject(repo: string): ProjectConfig {
  return {
    repo,
    pr: { mode: "on_push", forceCommand: "@reviewflux" },
    context: { mode: "default" as const },
  };
}

function makeConfig(
  projects: NonNullable<ReviewFluxConfig["projects"]>,
): ReviewFluxConfig {
  return {
    appName: "reviewflux",
    llm: "openai",
    authMode: "oauth",
    llmApiBaseUrl: "https://api.openai.com/v1",
    model: "gpt-5.4",
    projects,
  };
}

describe("daemon start cycle", () => {
  it("recovers stale running jobs before draining and polling on every cycle", async () => {
    const calls: string[] = [];
    const worker = {
      recoverStaleRunningJobs: vi.fn(() => {
        calls.push("recover");
        return 0;
      }),
      drain: vi.fn(async () => {
        calls.push("drain");
        return 0;
      }),
    };
    const coordinator = {
      pollProject: vi.fn(async (project: { repo: string }) => {
        calls.push(`poll:${project.repo}`);
      }),
    };
    const projects = [makeProject("a/repo"), makeProject("b/repo")];

    await runDaemonCycle({ projects, coordinator, worker });
    await runDaemonCycle({ projects, coordinator, worker });

    expect(calls).toEqual([
      "recover",
      "drain",
      "poll:a/repo",
      "poll:b/repo",
      "drain",
      "recover",
      "drain",
      "poll:a/repo",
      "poll:b/repo",
      "drain",
    ]);
    expect(worker.recoverStaleRunningJobs).toHaveBeenCalledTimes(2);
  });

  it("logs recovered jobs when a later cycle finds stale work", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const worker = {
      recoverStaleRunningJobs: vi
        .fn<() => number>()
        .mockReturnValueOnce(0)
        .mockReturnValueOnce(1),
      drain: vi.fn(async () => 0),
    };
    const coordinator = {
      pollProject: vi.fn(async () => {}),
    };
    const projects = [makeProject("a/repo")];

    try {
      await runDaemonCycle({ projects, coordinator, worker });
      await runDaemonCycle({ projects, coordinator, worker });

      expect(logSpy).toHaveBeenCalledWith(
        "[reviewflux] recovered 1 stale review job(s)",
      );
    } finally {
      logSpy.mockRestore();
    }
  });

  it("writes daemon cycle events to the daemon log", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-14T09:00:00.000Z"));

    const home = makeTempHome();
    homes.push(home);
    process.env.HOME = home;
    const sensitiveDrainCode = "WORKER_AUTH_FAILED";
    const sensitivePollCode = "UPSTREAM_PROVIDER_401";
    const sensitiveDrainMessage =
      "drain boom provider body access_token=super-secret-token";
    const sensitivePollState = "oauth-state-secret";
    const sensitivePollMessage =
      `poll boom upstream response code=401 state=${sensitivePollState} bearer super-secret-token`;

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const worker = {
      recoverStaleRunningJobs: vi.fn(() => 1),
      drain: vi
        .fn<() => Promise<number>>()
        .mockRejectedValueOnce(
          Object.assign(new Error(sensitiveDrainMessage), {
            code: sensitiveDrainCode,
          }),
        )
        .mockResolvedValueOnce(0),
    };
    const coordinator = {
      pollProject: vi.fn(async (project: { repo: string }) => {
        if (project.repo === "b/repo") {
          throw Object.assign(new Error(sensitivePollMessage), {
            code: sensitivePollCode,
          });
        }
      }),
    };

    try {
      await runDaemonCycle({
        projects: [makeProject("a/repo"), makeProject("b/repo")],
        coordinator,
        worker,
      });

      expect(logSpy).toHaveBeenCalledWith(
        "[reviewflux] recovered 1 stale review job(s)",
      );
      expect(errorSpy.mock.calls).toEqual([
        ["[reviewflux] review worker drain failed"],
        [sensitiveDrainMessage],
        ["[reviewflux] polling failed for b/repo"],
        [sensitivePollMessage],
      ]);

      const rawDaemonLog = readFileSync(getDaemonLogPath(home, "2026-03-14"), "utf8");
      expect(rawDaemonLog).not.toContain(sensitiveDrainMessage);
      expect(rawDaemonLog).not.toContain(sensitivePollMessage);
      expect(rawDaemonLog).not.toContain(sensitiveDrainCode);
      expect(rawDaemonLog).not.toContain(sensitivePollCode);
      expect(rawDaemonLog).not.toContain("super-secret-token");
      expect(rawDaemonLog).not.toContain(sensitivePollState);

      expect(readDaemonLog(home, "2026-03-14")).toEqual([
        {
          ts: "2026-03-14T09:00:00.000Z",
          date: "2026-03-14",
          surface: "daemon",
          type: "queue",
          level: "info",
          event: "daemon_cycle_recovered_jobs",
          message: "Recovered stale review jobs",
          context: { staleRunningCount: 1 },
        },
        {
          ts: "2026-03-14T09:00:00.000Z",
          date: "2026-03-14",
          surface: "daemon",
          type: "queue",
          level: "error",
          event: "daemon_cycle_worker_drain_failed",
          message: "Review worker drain failed",
          context: {
            errorMessage: "drain boom provider body access_token=[redacted]",
          },
        },
        {
          ts: "2026-03-14T09:00:00.000Z",
          date: "2026-03-14",
          surface: "daemon",
          type: "queue",
          level: "error",
          event: "daemon_cycle_poll_failed",
          message: "Project polling failed",
          context: {
            repo: "b/repo",
            errorMessage: "poll boom upstream response code=[redacted] state=[redacted] bearer [redacted]",
          },
        },
      ]);
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it("writes daemon start, project load, and stop events without changing console output", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-14T10:00:00.000Z"));

    const home = makeTempHome();
    homes.push(home);
    process.env.HOME = home;

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const signalHandlers = new Map<string, () => void>();

    try {
      await runDaemonStartCommand({
        loadConfig: () => makeConfig({
          alpha: {
            repo: "a/repo",
            pr: { mode: "on_push", forceCommand: "@reviewflux" },
            modelAlias: "gpt-5.4",
            context: { mode: "default" },
          },
        }),
        assertGhReady: vi.fn(async () => {}),
        registerSignalHandler: (signal, listener) => {
          signalHandlers.set(signal, listener);
        },
        runCycle: vi.fn(async () => {}),
        wait: vi.fn(async () => {
          signalHandlers.get("SIGTERM")?.();
          throw new Error("aborted");
        }),
      });

      expect(logSpy.mock.calls.map(([message]) => message)).toEqual([
        "[reviewflux] daemon start",
        "[reviewflux] gh polling mode enabled (30000ms)",
        "[reviewflux] tracking 1 project(s)",
        "- a/repo | mode=on_push | model=gpt-5.4 | context=default:AGENTS.md",
        "[reviewflux] force command is always enabled: @reviewflux",
        `[reviewflux] queue database: ${reviewQueuePath(home)}`,
        "\n[reviewflux] daemon stopped",
      ]);

      expect(readDaemonLog(home, "2026-03-14")).toEqual([
        {
          ts: "2026-03-14T10:00:00.000Z",
          date: "2026-03-14",
          surface: "daemon",
          type: "lifecycle",
          level: "info",
          event: "daemon_started",
          message: "Daemon start requested",
          context: {
            projectCount: 1,
            pollIntervalMs: 30000,
            retryDelayMs: 30000,
            maxAttempts: 1,
            staleRunningMs: 300000,
          },
        },
        {
          ts: "2026-03-14T10:00:00.000Z",
          date: "2026-03-14",
          surface: "daemon",
          type: "lifecycle",
          level: "info",
          event: "daemon_projects_loaded",
          message: "Daemon projects loaded",
          context: {
            projectCount: 1,
            pollIntervalMs: 30000,
            retryDelayMs: 30000,
            maxAttempts: 1,
            staleRunningMs: 300000,
          },
        },
        {
          ts: "2026-03-14T10:00:00.000Z",
          date: "2026-03-14",
          surface: "daemon",
          type: "lifecycle",
          level: "info",
          event: "daemon_stopped",
          message: "Daemon stopped",
          context: {},
        },
      ]);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("writes daemon no-project events without changing console output", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-14T11:00:00.000Z"));

    const home = makeTempHome();
    homes.push(home);
    process.env.HOME = home;

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const assertGhReady = vi.fn(async () => {});
    const runCycle = vi.fn(async () => {});

    try {
      await runDaemonStartCommand({
        loadConfig: () => makeConfig({}),
        assertGhReady,
        runCycle,
      });

      expect(assertGhReady).not.toHaveBeenCalled();
      expect(runCycle).not.toHaveBeenCalled();
      expect(logSpy.mock.calls.map(([message]) => message)).toEqual([
        "[reviewflux] daemon start",
        "[reviewflux] no projects configured. run: reviewflux project add",
      ]);

      expect(readDaemonLog(home, "2026-03-14")).toEqual([
        {
          ts: "2026-03-14T11:00:00.000Z",
          date: "2026-03-14",
          surface: "daemon",
          type: "lifecycle",
          level: "info",
          event: "daemon_started",
          message: "Daemon start requested",
          context: {
            projectCount: 0,
            pollIntervalMs: 30000,
            retryDelayMs: 30000,
            maxAttempts: 1,
            staleRunningMs: 300000,
          },
        },
        {
          ts: "2026-03-14T11:00:00.000Z",
          date: "2026-03-14",
          surface: "daemon",
          type: "lifecycle",
          level: "info",
          event: "daemon_no_projects",
          message: "No projects configured for daemon",
          context: { projectCount: 0 },
        },
      ]);
    } finally {
      logSpy.mockRestore();
    }
  });
});
