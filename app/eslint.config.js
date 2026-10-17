// Lint rules: recommended JS and TypeScript rules, React hooks,
// imports ordered (external, blank line, internal), and Prettier as a rule.
import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import importX from "eslint-plugin-import-x";
import prettierRecommended from "eslint-plugin-prettier/recommended";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  // build output and generated eval results
  globalIgnores(["dist/**", "coverage/**", "eval/forms-results.*"]),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ["web/**/*.{ts,tsx}", "plugins/*/web/**/*.{ts,tsx}"],
    extends: [
      reactHooks.configs.flat["recommended-latest"],
      reactRefresh.configs.vite,
    ],
    languageOptions: { globals: globals.browser },
  },
  {
    files: [
      "server/**/*.ts",
      "eval/**/*.ts",
      "plugins/*/*.ts",
      "shared/**/*.ts",
      "*.config.{js,ts}",
    ],
    languageOptions: { globals: globals.node },
  },
  {
    plugins: { "import-x": importX },
    rules: {
      "import-x/order": [
        "error",
        {
          groups: [
            ["builtin", "external"],
            ["internal", "parent", "sibling", "index"],
          ],
          "newlines-between": "always",
          alphabetize: { order: "asc", caseInsensitive: true },
        },
      ],
      "linebreak-style": ["error", "unix"],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  prettierRecommended,
]);
