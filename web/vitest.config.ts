// Vitest keeps its own Vite pipeline (Next builds the app), which is why
// @vitejs/plugin-react is a devDependency; tsconfig's `jsx` is Next's.
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import { playwright } from "@vitest/browser-playwright";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
  test: {
    // Two projects, which the package scripts run separately: `unit` is the
    // jsdom suite, `storybook` renders every story as a test in a real Chromium,
    // its a11y check included. Coverage is the unit suite's alone — a story
    // renders a component without asserting on it, so counting stories would
    // let the floor below be met by code nothing checks.
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "jsdom",
          globals: true,
          setupFiles: ["./vitest.setup.ts"],
          css: false,
          // Every `vi.spyOn` is put back before each test, so a spec need not
          // restore its own and a failing assertion cannot leak one into the
          // next test. A spy made in `beforeAll` or at describe scope is
          // therefore gone by the first test: make it in `beforeEach`.
          restoreMocks: true,
          exclude: ["node_modules/**", ".next/**", "e2e/**"],
        },
      },
      {
        extends: true,
        plugins: [storybookTest({ configDir: path.join(import.meta.dirname, ".storybook") })],
        test: {
          name: "storybook",
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/**/*.stories.{ts,tsx}",
        "src/test/**",
        "src/**/*.d.ts",
        // The Next shell: wrappers that do anything only inside a Next build,
        // where a spec under jsdom would test its own mocks.
        "src/AppRoot.tsx",
        "src/app/layout.tsx",
        "src/app/client.tsx",
        // Brackets escaped: unescaped, `[[]` is a character class matching one
        // `[`, and the pattern silently misses the folder.
        "src/app/\\[\\[...slug\\]\\]/page.tsx",
        "src/app/songs/new/page.tsx",
      ],
      reporter: ["text-summary"],
      // A floor just under what the suite measures, so coverage cannot erode
      // unnoticed. Raise it when the suite rises; lowering it is a decision.
      thresholds: { statements: 97, branches: 91, functions: 96, lines: 98 },
    },
  },
});
