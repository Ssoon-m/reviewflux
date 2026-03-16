import { describe, expect, it } from "vitest";
import { normalizeRootArgs } from "../src/cli/root-args.js";

describe("normalizeRootArgs", () => {
  const groupCommandNames = new Set(["repo", "daemon"]);

  it("rewrites an empty invocation to root help", () => {
    expect(normalizeRootArgs(["node", "reviewflux"], groupCommandNames)).toEqual([
      "node",
      "reviewflux",
      "--help",
    ]);
  });

  it("rewrites bare group commands to group help", () => {
    expect(
      normalizeRootArgs(["node", "reviewflux", "repo"], groupCommandNames),
    ).toEqual(["node", "reviewflux", "repo", "--help"]);
  });

  it("leaves explicit arguments untouched", () => {
    expect(
      normalizeRootArgs(
        ["node", "reviewflux", "setup", "--advanced"],
        groupCommandNames,
      ),
    ).toEqual(["node", "reviewflux", "setup", "--advanced"]);
  });
});
