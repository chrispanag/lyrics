// Storybook builds with Vite, like the specs, rather than with Next: no
// component imports from `next/*`: routing goes through the seam, which stories
// mount on its in-memory `TestRouter`. `@storybook/nextjs-vite` is the switch
// to make if a story ever needs Next's modules mocked.
import type { StorybookConfig } from "@storybook/react-vite";
import { readFileSync } from "node:fs";
import path from "node:path";

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-docs", "@storybook/addon-a11y", "@storybook/addon-vitest"],
  framework: "@storybook/react-vite",
  // Holds only MSW's worker script, kept out of the app's public/ so
  // production never serves it.
  staticDirs: ["./public"],
  // TypeScript 7 has no compiler API, so react-docgen-typescript cannot run;
  // react-docgen parses the source itself.
  typescript: { reactDocgen: "react-docgen" },
  viteFinal: (config, { configType }) => {
    // The same alias as vitest.config.ts: `storybook dev` and `build` do not
    // read that file. Change both.
    config.resolve ??= {};
    config.resolve.alias = {
      ...config.resolve.alias,
      "@": path.resolve(import.meta.dirname, "../src"),
    };
    // Every runtime dependency is bundled up front. Vite's scan starts from the
    // story files, so a package only a lazy chunk imports (`@dnd-kit/*` from
    // `SortableSongList`) is found mid-run instead, re-optimized and reloaded —
    // which on a cold cache, as in CI, loads a second React and every hook
    // throws. Read from package.json, so a new dependency needs no entry here.
    // `next` is the exception: the app's shell, which no story imports.
    const { dependencies } = JSON.parse(
      readFileSync(path.join(import.meta.dirname, "../package.json"), "utf8"),
    ) as { dependencies: Record<string, string> };
    config.optimizeDeps ??= {};
    config.optimizeDeps.include = [
      ...(config.optimizeDeps.include ?? []),
      ...Object.keys(dependencies).filter((name) => name !== "next"),
    ];
    // Next inlines `process.env.NEXT_PUBLIC_*` at build time and Vite does not,
    // so `api/client.ts` would throw on `process` in the browser. Mirror Next:
    // what is set in the shell is inlined (unlike Next, `.env*` files are not
    // read), and the rest of `process.env` is empty, which gives the API base
    // its development fallback.
    const nextPublic = Object.entries(process.env)
      .filter(([name]) => name.startsWith("NEXT_PUBLIC_"))
      .map(([name, value]) => [`process.env.${name}`, JSON.stringify(value)]);
    config.define = {
      ...config.define,
      ...Object.fromEntries(nextPublic),
      // Pinned to `API` in src/test/handlers.ts whatever the shell says or the
      // build mode is: MSW's handlers answer that origin alone, and a production
      // build would otherwise fall back to same-origin requests nothing answers.
      "process.env.NEXT_PUBLIC_API_BASE_URL": JSON.stringify("http://localhost:8080"),
      "process.env.NODE_ENV": JSON.stringify(
        configType === "PRODUCTION" ? "production" : "development",
      ),
      "process.env": "{}",
    };
    return config;
  },
};

export default config;
