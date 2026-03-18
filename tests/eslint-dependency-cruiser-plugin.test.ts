import path from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const eslintConfigPath = path.join(repoRoot, "eslint.config.mjs");

describe("eslint dependency-cruiser integration", () => {
  it("reports forbidden edges from live lint text using .dependency-cruiser.cjs", async () => {
    const virtualFilePath = path.join(
      repoRoot,
      "src",
      "gateway",
      "__eslint-dependency-cruiser-live.ts",
    );

    const eslint = new ESLint({
      cwd: repoRoot,
      overrideConfigFile: eslintConfigPath,
    });
    const [result] = await eslint.lintText(
      'import { runReviewJob } from "../review/runtime";\n',
      { filePath: virtualFilePath },
    );

    expect(
      result?.messages.some(
        (message) =>
          message.ruleId === "dependency-cruiser/errors" &&
          message.message.includes("no-gateway-to-review-runtime"),
      ),
    ).toBe(true);
  });
});
