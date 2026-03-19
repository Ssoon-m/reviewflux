import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    "cli/index": "src/cli/index.ts",
  },
  outDir: "dist",
  format: "esm",
  platform: "node",
  target: "node20",
  clean: true,
});
