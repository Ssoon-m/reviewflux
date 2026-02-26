import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    "cli/index": "src/cli/index.ts",
    "gateway/http-server": "src/gateway/http-server.ts",
  },
  outDir: "dist",
  format: "esm",
  platform: "node",
  target: "node22",
  clean: true,
});
