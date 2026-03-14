import { describe, expect, it, vi } from "vitest";
import { runDaemonCycle } from "../src/commands/daemon/start.js";
import type { ProjectConfig } from "../src/review/types.js";

function makeProject(repo: string): ProjectConfig {
  return {
    repo,
    pr: { mode: "on_push", forceCommand: "@reviewflux" },
    context: { mode: "default" as const },
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
});
