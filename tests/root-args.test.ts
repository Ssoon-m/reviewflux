import { describe, expect, it } from "vitest";
import { normalizeRootArgs } from "../src/cli/root-args";

describe("normalizeRootArgs", () => {
  const groupCommandNames = new Set(["repo", "daemon"]);

  it("rewrites an empty invocation to root help", () => {
    expect(normalizeRootArgs(["node", "rvw"], groupCommandNames)).toEqual([
      "node",
      "rvw",
      "--help",
    ]);
  });

  it("rewrites bare group commands to group help", () => {
    expect(
      normalizeRootArgs(["node", "rvw", "repo"], groupCommandNames),
    ).toEqual(["node", "rvw", "repo", "--help"]);
  });

  it("leaves explicit arguments untouched", () => {
    expect(
      normalizeRootArgs(
        ["node", "rvw", "setup", "--advanced"],
        groupCommandNames,
      ),
    ).toEqual(["node", "rvw", "setup", "--advanced"]);
  });
});
