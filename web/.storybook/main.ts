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
  // TypeScript 7 has no compiler API, so react-docgen-typescript cannot run;
  // react-docgen parses the source itself.
  typescript: { reactDocgen: "react-docgen" },
  viteFinal: (config, { configType }) => {
    config.resolve ??= {};
    config.resolve.alias = {
      ...config.resolve.alias,
      "@": path.resolve(import.meta.dirname, "../src"),
    };
    // Next inlines `process.env.NEXT_PUBLIC_*` at build time and Vite does not,
    // so `api/client.ts` would throw on `process` in the browser. Mirror Next:
    // what is set is inlined, and the rest of `process.env` is empty, which
    // gives the API base its development fallback.
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
