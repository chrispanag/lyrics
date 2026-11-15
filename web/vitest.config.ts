// The unit-test setup, which used to live in the `test` block of
// vite.config.ts. Vitest keeps its own Vite-based pipeline after the migration
// to Next — the app is built by Next, the tests are transformed here — so
// @vitejs/plugin-react stays a devDependency for this file alone. That is also
// what keeps the JSX transform independent of tsconfig's `jsx` setting, which
// Next owns and sets to "preserve".
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    css: false,
    // Playwright specs live in e2e/ and are driven by their own runner.
    exclude: ["node_modules/**", ".next/**", "e2e/**"],
    // Node 25+ defines its own `localStorage` global — undefined without
    // --localstorage-file — and jsdom's environment does not replace a global
    // that already exists, so every spec saw no storage at all. Off, jsdom's
    // is the one specs get, and a node-environment spec has none, as in a
    // real server.
    poolOptions: {
      forks: { execArgv: ["--no-experimental-webstorage"] },
    },
  },
});
