import * as childProcess from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runDaemonStopCommand } from "../src/commands/daemon/stop";

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>(
    "node:child_process",
  );
  return {
    ...actual,
    spawnSync: vi.fn(),
  };
});

function mockPsOutput(stdout: string): void {
  vi.mocked(childProcess.spawnSync).mockReturnValue({
    status: 0,
    stdout,
    stderr: "",
    pid: 0,
    output: [],
    signal: null,
    error: undefined,
  } as ReturnType<typeof childProcess.spawnSync>);
}

describe("daemon stop", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stops target daemon pid when valid root pid is provided", async () => {
    mockPsOutput("111 1 node /usr/bin/node scripts/run-node.mjs daemon start\n");
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      await runDaemonStopCommand("111");

      expect(killSpy).toHaveBeenCalledWith(111, "SIGTERM");
      expect(killSpy).toHaveBeenCalledWith(111, "SIGKILL");
      expect(
        logSpy.mock.calls.map((line) => String(line[0])).join("\n"),
      ).toContain("[reviewflux] stopped daemon pid=111");
    } finally {
      killSpy.mockRestore();
      logSpy.mockRestore();
    }
  });

  it("warns and logs not found when pid is not in daemon list", async () => {
    mockPsOutput("111 1 node /usr/bin/node scripts/run-node.mjs daemon start\n");
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      await runDaemonStopCommand("999");

      expect(logSpy.mock.calls.map((line) => String(line[0]))).toEqual([
        "[reviewflux] daemon pid not found: 999",
        "[reviewflux] run `rvw daemon list` and choose a PID from the result.",
      ]);
      expect(killSpy).not.toHaveBeenCalled();
    } finally {
      killSpy.mockRestore();
      logSpy.mockRestore();
    }
  });

  it("rejects invalid pid input without throwing", async () => {
    mockPsOutput("111 1 node /usr/bin/node scripts/run-node.mjs daemon start\n");
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      await runDaemonStopCommand("abc");

      expect(logSpy.mock.calls.map((line) => String(line[0]))).toEqual([
        "[reviewflux] invalid daemon PID. try numeric PID from `rvw daemon list`.",
      ]);
      expect(killSpy).not.toHaveBeenCalled();
    } finally {
      killSpy.mockRestore();
      logSpy.mockRestore();
    }
  });
});
