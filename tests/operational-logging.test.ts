import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type FsModule = typeof import("node:fs");
type LoggingSurface =
  | "setup"
  | "daemon"
  | "queue-poller"
  | "queue-worker"
  | "review-runtime";
type LoggingContext = Record<string, string | number | boolean | undefined>;
type LoggingInput = {
  surface: LoggingSurface;
  type: "lifecycle" | "auth" | "queue" | "review" | "system";
  level: "info" | "warn" | "error";
  event: string;
  message: string;
  context?: Record<string, unknown>;
};
type LoggingRecord = {
  ts: string;
  date: string;
  surface: LoggingSurface;
  type: LoggingInput["type"];
  level: LoggingInput["level"];
  event: string;
  message: string;
  context: LoggingContext;
};
type LoggingModule = {
  logging: (input: LoggingInput) => void;
};

function makeTempHome(): string {
  return mkdtempSync(join(tmpdir(), "reviewflux-logging-"));
}

function getLogsDir(home: string): string {
  return join(home, ".reviewflux", "logs");
}

function getLogDayDir(home: string, date: string): string {
  return join(getLogsDir(home), date);
}

function getLogPath(home: string, surface: LoggingSurface, date: string): string {
  return join(getLogDayDir(home, date), `${surface}.jsonl`);
}

function writeSeedLog(path: string, contents: string): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  writeFileSync(path, contents, { encoding: "utf8", mode: 0o600 });
  chmodSync(path, 0o600);
}

function readLogFile(path: string): {
  raw: string;
  lines: string[];
  records: LoggingRecord[];
} {
  const raw = readFileSync(path, "utf8");
  const lines = raw.split("\n").filter((line) => line.length > 0);
  return {
    raw,
    lines,
    records: lines.map((line) => JSON.parse(line) as LoggingRecord),
  };
}

async function loadLoggingModule(): Promise<LoggingModule> {
  vi.resetModules();
  return import("../src/infra/logging/index.js");
}

async function loadLoggingModuleWithFsMock(
  createOverrides: (actual: FsModule) => Partial<FsModule>,
): Promise<LoggingModule> {
  vi.resetModules();
  vi.doMock("node:fs", async () => {
    const actual = await vi.importActual<FsModule>("node:fs");
    return {
      ...actual,
      ...createOverrides(actual),
    };
  });
  return import("../src/infra/logging/index.js");
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

  vi.useRealTimers();
  vi.doUnmock("node:fs");
  vi.resetModules();
});

beforeEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.doUnmock("node:fs");
  vi.resetModules();
});

describe("operational logging", () => {
  it("writes newline-delimited JSONL records for a surface day", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-14T12:34:56.000Z"));

    const home = makeTempHome();
    homes.push(home);
    process.env.HOME = home;

    const { logging } = await loadLoggingModule();

    logging({
      surface: "setup",
      type: "lifecycle",
      level: "info",
      event: "setup_started",
      message: "Setup started",
      context: {
        provider: "openai-codex",
        advanced: false,
        projectCount: 0,
      },
    });

    logging({
      surface: "setup",
      type: "lifecycle",
      level: "info",
      event: "setup_completed",
      message: "Setup completed",
      context: {
        provider: "openai-codex",
        advanced: true,
        outcome: "success",
      },
    });

    const path = getLogPath(home, "setup", "2026-03-14");
    expect(existsSync(path)).toBe(true);

    const { raw, lines, records } = readLogFile(path);
    expect(raw.endsWith("\n")).toBe(true);
    expect(lines).toHaveLength(2);
    expect(Object.keys(records[0] ?? {})).toEqual([
      "ts",
      "date",
      "surface",
      "type",
      "level",
      "event",
      "message",
      "context",
    ]);
    expect(records).toEqual([
      {
        ts: "2026-03-14T12:34:56.000Z",
        date: "2026-03-14",
        surface: "setup",
        type: "lifecycle",
        level: "info",
        event: "setup_started",
        message: "Setup started",
        context: {
          provider: "openai-codex",
          advanced: false,
          projectCount: 0,
        },
      },
      {
        ts: "2026-03-14T12:34:56.000Z",
        date: "2026-03-14",
        surface: "setup",
        type: "lifecycle",
        level: "info",
        event: "setup_completed",
        message: "Setup completed",
        context: {
          provider: "openai-codex",
          advanced: true,
          outcome: "success",
        },
      },
    ]);
    expect(lines).toEqual(records.map((record) => JSON.stringify(record)));
  });

  it("drops non allowlisted context keys from persisted records", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-14T18:00:00.000Z"));

    const home = makeTempHome();
    homes.push(home);
    process.env.HOME = home;

    const input: LoggingInput = {
      surface: "queue-worker",
      type: "queue",
      level: "error",
      event: "job_failed",
      message: "Job failed",
      context: {
        provider: "openai-codex",
        prNumber: 42,
        advanced: true,
        retryDelayMs: 500,
        errorMessage: "boom",
        secret: "should-drop",
        stack: "stack trace",
        rawError: { message: "boom" },
        details: [1, 2, 3],
      },
    };

    const { logging } = await loadLoggingModule();
    logging(input);

    const { raw, lines, records } = readLogFile(getLogPath(home, "queue-worker", "2026-03-14"));
    const expectedContext: LoggingContext = {
      provider: "openai-codex",
      prNumber: 42,
      advanced: true,
      retryDelayMs: 500,
      errorMessage: "boom",
    };

    expect(raw.endsWith("\n")).toBe(true);
    expect(lines).toHaveLength(1);
    expect(records[0]?.context).toEqual(expectedContext);
    expect(records[0]?.context).not.toHaveProperty("secret");
    expect(records[0]?.context).not.toHaveProperty("stack");
    expect(records[0]?.context).not.toHaveProperty("rawError");
    expect(records[0]?.context).not.toHaveProperty("details");
    expect(lines[0]).not.toContain("should-drop");
    expect(lines[0]).not.toContain("stack trace");
  });

  it("prunes only expired daily log directories and legacy flat files and retries on later days", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T08:00:00.000Z"));

    const home = makeTempHome();
    homes.push(home);
    process.env.HOME = home;

    const logsDir = getLogsDir(home);
    mkdirSync(logsDir, { recursive: true, mode: 0o700 });
    chmodSync(logsDir, 0o700);

    const expiredSetupPath = getLogPath(home, "setup", "2026-02-28");
    const expiredDaemonPath = getLogPath(home, "daemon", "2026-02-27");
    const boundaryPath = getLogPath(home, "setup", "2026-03-01");
    const recentPath = getLogPath(home, "queue-worker", "2026-03-10");
    const expiredLegacyPath = join(logsDir, "setup-2026-02-26.jsonl");
    const recentLegacyPath = join(logsDir, "daemon-2026-03-10.jsonl");
    const malformedDateDirPath = join(logsDir, "2026-02-30");
    const malformedDatePath = join(malformedDateDirPath, "setup.jsonl");
    const malformedLegacyPath = join(logsDir, "setup-2026-02-30.jsonl");
    const malformedSurfacePath = join(logsDir, "other-2026-02-01.jsonl");
    const unrelatedDirPath = join(logsDir, "notes");
    const unrelatedPath = join(unrelatedDirPath, "notes.txt");

    writeSeedLog(expiredSetupPath, "seed\n");
    writeSeedLog(expiredDaemonPath, "seed\n");
    writeSeedLog(boundaryPath, "seed\n");
    writeSeedLog(recentPath, "seed\n");
    writeSeedLog(malformedDatePath, "seed\n");
    writeFileSync(expiredLegacyPath, "seed\n", { encoding: "utf8", mode: 0o600 });
    chmodSync(expiredLegacyPath, 0o600);
    writeFileSync(recentLegacyPath, "seed\n", { encoding: "utf8", mode: 0o600 });
    chmodSync(recentLegacyPath, 0o600);
    writeFileSync(malformedLegacyPath, "seed\n", { encoding: "utf8", mode: 0o600 });
    chmodSync(malformedLegacyPath, 0o600);
    writeFileSync(malformedSurfacePath, "seed\n", { encoding: "utf8", mode: 0o600 });
    chmodSync(malformedSurfacePath, 0o600);
    writeSeedLog(unrelatedPath, "seed\n");

    const { logging } = await loadLoggingModule();
    logging({
      surface: "setup",
      type: "lifecycle",
      level: "info",
      event: "setup_started",
      message: "Setup started",
    });

    expect(existsSync(expiredSetupPath)).toBe(false);
    expect(existsSync(expiredDaemonPath)).toBe(false);
    expect(existsSync(expiredLegacyPath)).toBe(false);
    expect(existsSync(boundaryPath)).toBe(true);
    expect(existsSync(recentPath)).toBe(true);
    expect(existsSync(recentLegacyPath)).toBe(true);
    expect(existsSync(malformedDateDirPath)).toBe(true);
    expect(existsSync(malformedDatePath)).toBe(true);
    expect(existsSync(malformedLegacyPath)).toBe(true);
    expect(existsSync(malformedSurfacePath)).toBe(true);
    expect(existsSync(unrelatedDirPath)).toBe(true);
    expect(existsSync(unrelatedPath)).toBe(true);

    const lateExpiredPath = getLogPath(home, "daemon", "2026-02-20");
    writeSeedLog(lateExpiredPath, "late\n");

    logging({
      surface: "daemon",
      type: "system",
      level: "info",
      event: "daemon_started",
      message: "Daemon started",
    });

    expect(existsSync(lateExpiredPath)).toBe(true);

    vi.setSystemTime(new Date("2026-03-16T08:00:00.000Z"));

    logging({
      surface: "daemon",
      type: "system",
      level: "info",
      event: "daemon_status_snapshot",
      message: "Daemon status snapshot",
    });

    expect(existsSync(lateExpiredPath)).toBe(false);
    expect(existsSync(getLogDayDir(home, "2026-02-20"))).toBe(false);
    expect(existsSync(malformedDateDirPath)).toBe(true);
    expect(existsSync(malformedDatePath)).toBe(true);
    expect(existsSync(malformedLegacyPath)).toBe(true);
    expect(existsSync(malformedSurfacePath)).toBe(true);
    expect(existsSync(unrelatedDirPath)).toBe(true);
    expect(existsSync(unrelatedPath)).toBe(true);
  });

  it("creates secure log directory and file modes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-16T01:02:03.000Z"));

    const home = makeTempHome();
    homes.push(home);
    process.env.HOME = home;

    const { logging } = await loadLoggingModule();
    logging({
      surface: "review-runtime",
      type: "review",
      level: "info",
      event: "review_posted",
      message: "Review posted",
    });

    const logsDir = getLogsDir(home);
    const logDayDir = getLogDayDir(home, "2026-03-16");
    const logPath = getLogPath(home, "review-runtime", "2026-03-16");

    expect(statSync(logsDir).mode & 0o777).toBe(0o700);
    expect(statSync(logDayDir).mode & 0o777).toBe(0o700);
    expect(statSync(logPath).mode & 0o777).toBe(0o600);
  });

  it("swallows filesystem and serialization failures", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T09:00:00.000Z"));

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const input: LoggingInput = {
      surface: "setup",
      type: "lifecycle",
      level: "info",
      event: "setup_started",
      message: "Setup started",
    };

    const mkdirHome = makeTempHome();
    homes.push(mkdirHome);
    process.env.HOME = mkdirHome;

    let module = await loadLoggingModuleWithFsMock(() => ({
      mkdirSync: vi.fn(() => {
        throw new Error("mkdir boom");
      }),
    }));
    expect(() => module.logging(input)).not.toThrow();
    expect(existsSync(getLogPath(mkdirHome, "setup", "2026-03-15"))).toBe(false);

    vi.doUnmock("node:fs");

    const readdirHome = makeTempHome();
    homes.push(readdirHome);
    process.env.HOME = readdirHome;
    mkdirSync(getLogsDir(readdirHome), { recursive: true, mode: 0o700 });
    chmodSync(getLogsDir(readdirHome), 0o700);

    module = await loadLoggingModuleWithFsMock(() => ({
      readdirSync: vi.fn(() => {
        throw new Error("readdir boom");
      }),
    }));
    expect(() => module.logging(input)).not.toThrow();
    expect(existsSync(getLogPath(readdirHome, "setup", "2026-03-15"))).toBe(true);

    vi.doUnmock("node:fs");

    const appendHome = makeTempHome();
    homes.push(appendHome);
    process.env.HOME = appendHome;

    module = await loadLoggingModuleWithFsMock(() => ({
      appendFileSync: vi.fn(() => {
        throw new Error("append boom");
      }),
    }));
    expect(() => module.logging(input)).not.toThrow();
    expect(existsSync(getLogPath(appendHome, "setup", "2026-03-15"))).toBe(false);

    vi.doUnmock("node:fs");

    const chmodHome = makeTempHome();
    homes.push(chmodHome);
    process.env.HOME = chmodHome;

    module = await loadLoggingModuleWithFsMock((actual) => ({
      chmodSync: vi.fn((path, mode) => {
        if (String(path).endsWith(".jsonl")) {
          throw new Error("chmod boom");
        }
        return actual.chmodSync(path, mode);
      }),
    }));
    expect(() => module.logging(input)).not.toThrow();
    expect(existsSync(getLogPath(chmodHome, "setup", "2026-03-15"))).toBe(true);

    vi.doUnmock("node:fs");

    const serializeHome = makeTempHome();
    homes.push(serializeHome);
    process.env.HOME = serializeHome;

    module = await loadLoggingModule();
    const originalStringify = JSON.stringify.bind(JSON);
    vi.spyOn(JSON, "stringify").mockImplementation((value, replacer, space) => {
      if (
        typeof value === "object"
        && value !== null
        && "surface" in value
        && "ts" in value
      ) {
        throw new Error("serialize boom");
      }
      return originalStringify(value, replacer, space);
    });
    expect(() => module.logging(input)).not.toThrow();
    expect(existsSync(getLogPath(serializeHome, "setup", "2026-03-15"))).toBe(false);

    expect(errorSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
