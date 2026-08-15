// defineConfig comes from vitest/config, not vite, so the `test` block below
// is typed.
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
  build: {
    // The floor is React + Router + Query + the Prelude session SDK, which
    // together land around 220 kB gzipped. The editor and admin console are
    // already split out; the rest is framework code that every route needs, so
    // the default 500 kB warning would fire on every build with nothing left
    // to act on.
    chunkSizeWarningLimit: 700,
  },
  server: {
    port: 5173,
    // Bind on all interfaces so the dev server is reachable from a phone on
    // the same network — the mobile layout needs testing on real hardware.
    host: true,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    css: false,
    // Playwright specs live in e2e/ and are driven by their own runner.
    exclude: ["node_modules/**", "dist/**", "e2e/**"],
  },
});
