import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      ".next",
      "next-env.d.ts",
      "node_modules",
      "playwright-report",
      "test-results",
      "coverage",
    ],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Kept after the move to Next: its Fast Refresh has the same
      // component-only-exports constraint Vite's did, and this rule is what
      // holds up the style-module convention in CLAUDE.md — buttonStyles.ts,
      // lib/modal.ts and the rest exist because of it. `metadata` and
      // `viewport` are the two non-component exports the App Router asks a
      // route file for, so they are named rather than the rule switched off
      // for src/app.
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true, allowExportNames: ["metadata", "viewport"] },
      ],
      // Unused arguments prefixed with _ are a deliberate signal, not an oversight.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
