import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { bootstrapReviewQueueSchema } from "./schema.js";

type NodeSqliteModule = typeof import("node:sqlite");

const require = createRequire(import.meta.url);

export type ReviewQueueDatabaseOptions = {
  home?: string;
  path?: string;
};

export function reviewQueuePath(home: string = homedir()): string {
  return join(home, ".reviewflux", "reviewflux.db");
}

function resolveDatabasePath(options: ReviewQueueDatabaseOptions = {}): string {
  if (options.path) return options.path;
  return reviewQueuePath(options.home);
}

function loadNodeSqlite(): NodeSqliteModule {
  try {
    return require("node:sqlite") as NodeSqliteModule;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Review queue storage requires node:sqlite support in this Node.js runtime. ${detail}`,
    );
  }
}

export function assertReviewQueueRuntimeSupported(): void {
  const major = Number.parseInt(process.versions.node.split(".")[0] ?? "", 10);
  if (!Number.isFinite(major) || major < 22) {
    throw new Error(
      `Review queue storage requires Node.js 22 or newer. Current version: ${process.versions.node}`,
    );
  }

  let database: DatabaseSync | null = null;
  try {
    const { DatabaseSync } = loadNodeSqlite();
    database = new DatabaseSync(":memory:");
    database.exec("SELECT 1");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Review queue storage could not initialize SQLite support. ${detail}`,
    );
  } finally {
    database?.close();
  }
}

export class ReviewQueueDatabase {
  readonly path: string;

  constructor(options: ReviewQueueDatabaseOptions = {}) {
    this.path = resolveDatabasePath(options);
    mkdirSync(dirname(this.path), { recursive: true });
    const { DatabaseSync } = loadNodeSqlite();
    this.connection = new DatabaseSync(this.path);
    this.connection.exec("PRAGMA journal_mode = WAL");
    this.connection.exec("PRAGMA synchronous = NORMAL");
    this.connection.exec("PRAGMA foreign_keys = ON");
    this.connection.exec("PRAGMA busy_timeout = 5000");
    bootstrapReviewQueueSchema(this.connection);
  }

  readonly connection: DatabaseSync;

  transaction<T>(action: () => T): T {
    this.connection.exec("BEGIN IMMEDIATE");
    try {
      const result = action();
      this.connection.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        this.connection.exec("ROLLBACK");
      } catch {
        // Ignore rollback failures after the original error.
      }
      throw error;
    }
  }

  close(): void {
    this.connection.close();
  }
}
