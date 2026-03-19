import * as childProcess from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runDaemonListCommand } from "../src/commands/daemon/list";

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

describe("daemon list", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows only root daemons and excludes command details", async () => {
    mockPsOutput(
      `101 1 node /usr/bin/node scripts/run-node.mjs daemon start\n` +
      `202 101 node /usr/bin/node scripts/run-node.mjs daemon start\n` +
      `303 1 node /opt/homebrew/bin/node dist/cli/index.mjs daemon start\n` +
      `404 999 bash sleep 999\n`,
    );

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      await runDaemonListCommand();
      const output = logSpy.mock.calls.map((line) => String(line[0])).join("\n");

      expect(output).toContain("[reviewflux] running daemons:");
      expect(output).toContain("| PID ");
      expect(output).toContain("STATUS");
      expect(output).toContain("| 101 ");
      expect(output).toContain("| 303 ");
      expect(output).not.toContain("COMMAND");
      expect(output).not.toContain("| 202 |");
    } finally {
      logSpy.mockRestore();
    }
  });

  it("shows empty status when no daemons are detected", async () => {
    mockPsOutput("404 999 bash sleep 999\n");

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      await runDaemonListCommand();
      const output = logSpy.mock.calls.map((line) => String(line[0]));

      expect(output).toEqual(["[reviewflux] no running daemon processes found."]);
    } finally {
      logSpy.mockRestore();
    }
  });
});
