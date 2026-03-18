import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname } from "node:path";
import { getReviewFluxPath } from "../../config/reviewflux-home";
import { bootstrapReviewQueueSchema } from "./schema";

type BetterSqlite3Module = typeof import("better-sqlite3");
type BetterSqlite3Database = import("better-sqlite3").Database;

const require = createRequire(import.meta.url);

export type ReviewQueueDatabaseOptions = {
  home?: string;
  path?: string;
};

export function reviewQueuePath(home: string = homedir()): string {
  return getReviewFluxPath(home, "reviewflux.db");
}

function resolveDatabasePath(options: ReviewQueueDatabaseOptions = {}): string {
  if (options.path) return options.path;
  return reviewQueuePath(options.home);
}

function loadBetterSqlite3(): BetterSqlite3Module {
  try {
    return require("better-sqlite3") as BetterSqlite3Module;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Review queue storage requires better-sqlite3 support in this runtime. ${detail}`,
      { cause: error },
    );
  }
}

export function supportsReviewQueueNodeVersion(version: string): boolean {
  const major = Number.parseInt(version.split(".")[0] ?? "", 10);
  return Number.isFinite(major) && (major === 20 || major >= 22);
}

export function assertReviewQueueRuntimeSupported(): void {
  if (!supportsReviewQueueNodeVersion(process.versions.node)) {
    throw new Error(
      `Review queue storage requires Node.js 20.x or 22+. Current version: ${process.versions.node}`,
    );
  }

  let database: BetterSqlite3Database | null = null;
  try {
    const Database = loadBetterSqlite3();
    database = new Database(":memory:");
    database.exec("SELECT 1");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Review queue storage could not initialize SQLite support. ${detail}`,
      { cause: error },
    );
  } finally {
    database?.close();
  }
}

export class ReviewQueueDatabase {
  readonly path: string;

  constructor(options: ReviewQueueDatabaseOptions = {}) {
    assertReviewQueueRuntimeSupported();
    this.path = resolveDatabasePath(options);
    mkdirSync(dirname(this.path), { recursive: true });
    const Database = loadBetterSqlite3();
    this.connection = new Database(this.path, { timeout: 5000 });
    this.connection.pragma("journal_mode = WAL");
    this.connection.pragma("synchronous = NORMAL");
    this.connection.pragma("foreign_keys = ON");
    bootstrapReviewQueueSchema(this.connection);
  }

  readonly connection: BetterSqlite3Database;

  transaction<T>(action: () => T): T {
    return this.connection.transaction((work: () => T) => work()).immediate(action);
  }

  close(): void {
    this.connection.close();
  }
}
