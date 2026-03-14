import { appendFileSync, chmodSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { ensureReviewFluxLogsDir } from "../../config/reviewflux-home.js";

const LOGGING_SURFACES = [
  "setup",
  "daemon",
  "queue-poller",
  "queue-worker",
  "review-runtime",
] as const;

export type LoggingSurface =
  | "setup"
  | "daemon"
  | "queue-poller"
  | "queue-worker"
  | "review-runtime";

export type LoggingType = "lifecycle" | "auth" | "queue" | "review" | "system";

export type LoggingLevel = "info" | "warn" | "error";

const LOGGING_CONTEXT_KEYS = [
  "provider",
  "authMode",
  "oauthMode",
  "advanced",
  "repo",
  "prNumber",
  "reason",
  "eventKey",
  "attempt",
  "workerId",
  "projectCount",
  "pollIntervalMs",
  "retryDelayMs",
  "maxAttempts",
  "staleRunningMs",
  "pending",
  "running",
  "done",
  "failed",
  "staleRunningCount",
  "automaticCount",
  "manualCount",
  "outcome",
  "errorMessage",
] as const;

const LOG_RETENTION_DAYS = 14;
const DAY_IN_MS = 24 * 60 * 60 * 1000;
const LEGACY_LOG_FILE_NAME_PATTERN = new RegExp(
  `^(${LOGGING_SURFACES.join("|")})-(\\d{4}-\\d{2}-\\d{2})\\.jsonl$`,
);
const LOG_DAY_DIRECTORY_PATTERN = /^(\d{4}-\d{2}-\d{2})$/;

let lastPrunedDate: string | null = null;

export type LoggingContextKey = (typeof LOGGING_CONTEXT_KEYS)[number];

export type LoggingContextValue = string | number | boolean;

export type LoggingContext = Partial<Record<LoggingContextKey, LoggingContextValue>>;

export type LoggingInput = {
  surface: LoggingSurface;
  type: LoggingType;
  level: LoggingLevel;
  event: string;
  message: string;
  context?: Record<string, unknown>;
};

export type LoggingRecord = {
  ts: string;
  date: string;
  surface: LoggingSurface;
  type: LoggingType;
  level: LoggingLevel;
  event: string;
  message: string;
  context: LoggingContext;
};

export function sanitizeOperationalLogMessage(
  message: string,
  fallback: string,
): string {
  const raw = message
    .split(/\r?\n/, 1)[0]
    .replace(/\s+/g, " ")
    .trim();

  if (!raw) {
    return fallback;
  }

  const sanitized = raw
    .replace(
      /([?&](?:access_token|refresh_token|client_secret|api_key|token|code|state)=)[^&\s]+/gi,
      "$1[redacted]",
    )
    .replace(/\bbearer\s+[^\s,;]+/gi, "bearer [redacted]")
    .replace(
      /\b(access[_-]?token|refresh[_-]?token|client[_-]?secret|api[_-]?key|secret|token|authorization|code|state)\s*[:=]\s*[^\s,;]+/gi,
      "$1=[redacted]",
    )
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, "[redacted]")
    .replace(/\bgh[pousr]_[A-Za-z0-9_]+\b/gi, "[redacted]")
    .trim();

  if (!sanitized) {
    return fallback;
  }

  return sanitized.slice(0, 160);
}

function isLoggingContextValue(value: unknown): value is LoggingContextValue {
  return (
    typeof value === "string"
    || typeof value === "boolean"
    || (typeof value === "number" && Number.isFinite(value))
  );
}

function sanitizeContext(context: Record<string, unknown> | undefined): LoggingContext {
  if (!context) {
    return {};
  }

  const sanitized: LoggingContext = {};
  for (const key of LOGGING_CONTEXT_KEYS) {
    const value = context[key];
    if (isLoggingContextValue(value)) {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

function parseUtcDate(date: string): number | null {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  if (parsed.toISOString().slice(0, 10) !== date) {
    return null;
  }

  return parsed.getTime();
}

function pruneExpiredLogs(logsDir: string, currentDate: string): void {
  if (lastPrunedDate === currentDate) {
    return;
  }

  const currentDateTime = parseUtcDate(currentDate);
  if (currentDateTime === null) {
    return;
  }

  lastPrunedDate = currentDate;

  let entries: Array<{ isDirectory(): boolean; isFile(): boolean; name: string }>;
  try {
    entries = readdirSync(logsDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.isFile()) {
      const match = LEGACY_LOG_FILE_NAME_PATTERN.exec(entry.name);
      if (!match) {
        continue;
      }

      const [, , fileDate] = match;
      const fileDateTime = parseUtcDate(fileDate);
      if (fileDateTime === null) {
        continue;
      }

      if (currentDateTime - fileDateTime <= LOG_RETENTION_DAYS * DAY_IN_MS) {
        continue;
      }

      try {
        rmSync(join(logsDir, entry.name), { force: true });
      } catch {}
      continue;
    }

    if (!entry.isDirectory()) {
      continue;
    }

    const match = LOG_DAY_DIRECTORY_PATTERN.exec(entry.name);
    if (!match) {
      continue;
    }

    const [, directoryDate] = match;
    const directoryDateTime = parseUtcDate(directoryDate);
    if (directoryDateTime === null) {
      continue;
    }

    if (currentDateTime - directoryDateTime <= LOG_RETENTION_DAYS * DAY_IN_MS) {
      continue;
    }

    try {
      rmSync(join(logsDir, entry.name), { force: true, recursive: true });
    } catch {}
  }
}

function resolveLogsDir(): string | null {
  try {
    const home = process.env.HOME?.trim();
    if (home) {
      return ensureReviewFluxLogsDir(home);
    }

    return ensureReviewFluxLogsDir();
  } catch {
    return null;
  }
}

function serializeRecord(record: LoggingRecord): string | null {
  try {
    return JSON.stringify(record);
  } catch {
    return null;
  }
}

function appendRecord(path: string, line: string): boolean {
  try {
    appendFileSync(path, line, {
      encoding: "utf8",
      flag: "a",
      mode: 0o600,
    });
    return true;
  } catch {
    return false;
  }
}

function setLogFileMode(path: string): void {
  try {
    chmodSync(path, 0o600);
  } catch {}
}

function ensureLogDayDir(logsDir: string, date: string): string | null {
  const path = join(logsDir, date);
  try {
    mkdirSync(path, { recursive: true, mode: 0o700 });
    chmodSync(path, 0o700);
    return path;
  } catch {
    return null;
  }
}

export function logging(input: LoggingInput): void {
  const ts = new Date().toISOString();
  const date = ts.slice(0, 10);
  const record: LoggingRecord = {
    ts,
    date,
    surface: input.surface,
    type: input.type,
    level: input.level,
    event: input.event,
    message: input.message,
    context: sanitizeContext(input.context),
  };
  const serialized = serializeRecord(record);
  if (serialized === null) {
    return;
  }

  const logsDir = resolveLogsDir();
  if (logsDir === null) {
    return;
  }

  pruneExpiredLogs(logsDir, date);

  const logDayDir = ensureLogDayDir(logsDir, date);
  if (logDayDir === null) {
    return;
  }

  const path = join(logDayDir, `${input.surface}.jsonl`);
  if (!appendRecord(path, `${serialized}\n`)) {
    return;
  }

  setLogFileMode(path);
}
