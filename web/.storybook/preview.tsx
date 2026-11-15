import type { Decorator, Preview } from "@storybook/react-vite";
import { QueryClientProvider } from "@tanstack/react-query";
import { setupWorker } from "msw/browser";
import { createPreviewAnnotations } from "msw-storybook-addon/preview";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { useLayoutEffect, useState } from "react";

import { AuthContext } from "@/auth/context";
import { applyTheme, type Theme } from "@/lib/theme";
import type { User } from "@/lib/types";
import { API, handlers } from "@/test/handlers";
import { stubAuth, testQueryClient } from "@/test/providers";
import "@/styles/index.css";

/*
 * Stories render outside `AppRoot`, so the providers a component reaches for
 * are supplied here, configured per story through parameters:
 *
 * - `user`: who is signed in, `null` (the default) for a guest. The auth
 *   context is `stubAuth`, the same stub the specs use.
 * - `route`: the address to render at, or the history behind it.
 * - `path`: a route pattern to mount the story under, for a page that reads
 *   `useParams` (`/songs/:id`).
 *
 * Requests go to MSW with the specs' default handlers (`src/test/handlers.ts`);
 * a story adds its own in `beforeEach({ msw }) { msw.use(...) }`, which take
 * precedence and are reset after the story.
 */

const withProviders: Decorator = (Story, { parameters }) => {
  // One client per story, so no cached answer leaks into the next.
  const [queryClient] = useState(testQueryClient);
  const route = (parameters.route as string | string[] | undefined) ?? "/";
  const path = parameters.path as string | undefined;
  const user = (parameters.user as User | null | undefined) ?? null;

  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={Array.isArray(route) ? route : [route]}>
        <AuthContext.Provider value={stubAuth(user)}>
          {path ? (
            <Routes>
              <Route path={path} element={<Story />} />
            </Routes>
          ) : (
            <Story />
          )}
        </AuthContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>
  );
};

/** Drives the same `.dark` class on <html> the app's theme switch does. */
const withTheme: Decorator = (Story, context) => {
  const theme = context.globals.theme as Theme;
  useLayoutEffect(() => applyTheme(theme), [theme]);
  return <Story />;
};

/**
 * Started once for the whole run. A request to the API that no handler
 * answers is an error, as `onUnhandledFrame: "error"` makes it in the specs;
 * everything else (Vite's modules, fonts) passes through.
 */
const msw = createPreviewAnnotations(async () => {
  const worker = setupWorker(...handlers);
  await worker.start({
    quiet: true,
    onUnhandledFrame({ frame, defaults }) {
      if ("request" in frame && frame.request.url.startsWith(API)) defaults.error();
    },
  });
  return worker;
});

const preview: Preview = {
  decorators: [withProviders, withTheme],
  beforeEach: msw.beforeEach,
  // A docs page per component, built from its stories and props.
  tags: ["autodocs"],
  globalTypes: {
    theme: {
      description: "Color theme",
      toolbar: {
        title: "Theme",
        icon: "mirror",
        items: [
          { value: "light", title: "Light", icon: "sun" },
          { value: "dark", title: "Dark", icon: "moon" },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { theme: "light" },
  parameters: {
    // The app paints its own ground on <body>; Storybook's would sit on top.
    backgrounds: { disable: true },
    // Violations fail the story's test rather than only showing in the panel.
    a11y: { test: "error" },
  },
};

export default preview;
