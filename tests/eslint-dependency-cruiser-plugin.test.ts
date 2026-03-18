import { randomUUID } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const eslintConfigPath = path.join(repoRoot, "eslint.config.mjs");
const tempFiles: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempFiles.splice(0).map((tempFile) => rm(tempFile, { force: true })),
  );
});

describe("eslint dependency-cruiser integration", () => {
  it("reports forbidden edges from .dependency-cruiser.cjs through ESLint", async () => {
    const tempFile = path.join(
      repoRoot,
      "src",
      "gateway",
      `__eslint-dependency-cruiser-${randomUUID()}.ts`,
    );
    tempFiles.push(tempFile);

    await writeFile(
      tempFile,
      'import { runReviewJob } from "../review/runtime";\n',
      "utf8",
    );

    const eslint = new ESLint({
      cwd: repoRoot,
      overrideConfigFile: eslintConfigPath,
    });
    const [result] = await eslint.lintFiles([tempFile]);

    expect(
      result?.messages.some(
        (message) =>
          message.ruleId === "dependency-cruiser/errors" &&
          message.message.includes("no-gateway-to-review-runtime"),
      ),
    ).toBe(true);
  });
});
