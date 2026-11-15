// Storybook builds with Vite, like the specs, rather than with Next: no
// component under src/components imports from `next/*`, and the app itself is
// client-only behind `ssr: false`. `@storybook/nextjs-vite` is the switch to
// make if a story ever needs Next's modules mocked.
import type { StorybookConfig } from "@storybook/react-vite";
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
    // Imported only by lazy chunks (`SortableSongList`), so Vite would find them
    // mid-run, re-optimize and reload — which on a cold cache, as in CI, loads
    // a second React and every hook throws. Named here, they are bundled up front.
    config.optimizeDeps ??= {};
    config.optimizeDeps.include = [
      ...(config.optimizeDeps.include ?? []),
      "@dnd-kit/core",
      "@dnd-kit/sortable",
      "@dnd-kit/utilities",
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
      "process.env.NODE_ENV": JSON.stringify(
        configType === "PRODUCTION" ? "production" : "development",
      ),
      "process.env": "{}",
    };
    return config;
  },
};

export default config;
