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
  },
});
