import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ReviewQueueDatabase,
  supportsReviewQueueNodeVersion,
} from "../src/review/queue/database.js";

function withProcessNodeVersion<T>(version: string, run: () => T): T {
  const originalVersions = process.versions;
  Object.defineProperty(process, "versions", {
    value: { ...originalVersions, node: version },
    configurable: true,
  });

  try {
    return run();
  } finally {
    Object.defineProperty(process, "versions", {
      value: originalVersions,
      configurable: true,
    });
  }
}

describe("review queue runtime support", () => {
  it.each(["20.0.0", "20.19.0", "22.0.0", "25.3.1"])(
    "accepts Node %s",
    (version) => {
      expect(supportsReviewQueueNodeVersion(version)).toBe(true);
    },
  );

  it.each(["18.20.5", "21.7.3", "", "garbage"])(
    "rejects Node %s",
    (version) => {
      expect(supportsReviewQueueNodeVersion(version)).toBe(false);
    },
  );

  it("rejects unsupported Node versions before opening the sqlite database", () => {
    const home = mkdtempSync(join(tmpdir(), "reviewflux-runtime-"));

    try {
      expect(() =>
        withProcessNodeVersion("21.7.3", () => new ReviewQueueDatabase({ home })),
      ).toThrowError(
        "Review queue storage requires Node.js 20.x or 22+. Current version: 21.7.3",
      );
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
