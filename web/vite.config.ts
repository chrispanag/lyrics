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
    // Forward the API through this server, so a phone talks to one origin and
    // reaches the API over loopback. Two reasons that beats pointing the phone
    // straight at :8080: the macOS firewall blocks incoming connections to the
    // unsigned binary `go run` produces, so :8080 answers on localhost and
    // hangs from the network; and one origin is how the app is deployed, so
    // CORS stays out of the picture here exactly as it does in production.
    //
    // Only requests the client sends same-origin come through here, which is
    // what `make mobile` arranges by clearing VITE_API_BASE_URL. `make web`
    // keeps calling :8080 directly.
    proxy: { "/api": "http://localhost:8080" },
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
