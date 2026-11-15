// Vitest keeps its own Vite pipeline (Next builds the app), which is why
// @vitejs/plugin-react is a devDependency; tsconfig's `jsx` is Next's.
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
