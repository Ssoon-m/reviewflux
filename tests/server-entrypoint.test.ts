import { describe, expect, it } from "vitest";
import { isDirectRun } from "../src/server.js";

describe("isDirectRun", () => {
  it("matches file url and path reliably", () => {
    expect(isDirectRun("file:///tmp/app/server.js", "/tmp/app/server.js")).toBe(true);
  });

  it("returns false when argv1 is missing", () => {
    expect(isDirectRun("file:///tmp/app/server.js", undefined)).toBe(false);
  });
});
