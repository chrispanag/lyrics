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
      // lib/modal.ts and the rest exist because of it. The App Router's own
      // export vocabulary is allowed in the override below rather than here,
      // because here is every file in the app.
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      // Unused arguments prefixed with _ are a deliberate signal, not an oversight.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // What the App Router asks a route file to export beside its component, in
    // the one directory that has such files. Scoped rather than added to the
    // rule above, because the rule above reaches `src/components` and
    // `src/routes` — which is where the style-module convention it holds up
    // actually lives, and where a `metadata` export means nothing at all. It is
    // also a growing vocabulary: `generateViewport`, `generateStaticParams` and a
    // route handler's verbs each arrive as another name, and each would otherwise
    // be another widening of the rule for the whole app.
    //
    // The segment configs — `revalidate`, `dynamic` — need no entry, being
    // constants that `allowConstantExport` already covers.
    files: ["src/app/**/*.{ts,tsx}"],
    rules: {
      "react-refresh/only-export-components": [
        "warn",
        {
          allowConstantExport: true,
          allowExportNames: ["metadata", "viewport", "generateMetadata"],
        },
      ],
    },
  },
);
