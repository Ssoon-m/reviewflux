import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";
import dependencyCruiserPlugin from "./tools/eslint/dependency-cruiser-plugin.mjs";

export default defineConfig([
  {
    ignores: [
      "dist/**",
      "docs/**",
      "node_modules/**",
    ],
  },
  {
    files: ["**/*.{js,mjs,cjs,ts}"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    files: ["src/**/*.{js,mjs,cjs,ts}"],
    plugins: {
      "dependency-cruiser": dependencyCruiserPlugin,
    },
    settings: {
      "dependency-cruiser": {
        config: ".dependency-cruiser.cjs",
      },
    },
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{js,mjs,cjs,ts}"],
    rules: {
      "no-console": "off",
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    files: ["src/**/*.{js,mjs,cjs,ts}"],
    rules: {
      "dependency-cruiser/errors": "error",
      "dependency-cruiser/warnings": "warn",
    },
  },
  {
    files: ["**/*.ts"],
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        {
          disallowTypeAnnotations: false,
          prefer: "type-imports",
          fixStyle: "separate-type-imports",
        },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    files: ["tests/**/*.ts"],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },
  },
  {
    files: [".dependency-cruiser.cjs"],
    languageOptions: {
      sourceType: "commonjs",
    },
  },
]);
