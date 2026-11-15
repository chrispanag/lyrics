import type { Decorator, Preview } from "@storybook/react-vite";
import { MemoryRouter } from "react-router-dom";
import { useLayoutEffect } from "react";

import { applyTheme, type Theme } from "@/lib/theme";
import "@/styles/index.css";

/**
 * Stories render outside `AppRoot`, so the providers a component reaches for
 * are supplied here. Only the router so far: `SongCard` and friends render
 * `<Link>`. Add the query client and auth stub (`src/test/render.tsx` has the
 * shape) when the first story needs them, rather than mounting them for all.
 */
const withRouter: Decorator = (Story) => (
  <MemoryRouter>
    <Story />
  </MemoryRouter>
);

/** Drives the same `.dark` class on <html> the app's theme switch does. */
const withTheme: Decorator = (Story, context) => {
  const theme = context.globals.theme as Theme;
  useLayoutEffect(() => applyTheme(theme), [theme]);
  return <Story />;
};

const preview: Preview = {
  decorators: [withRouter, withTheme],
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
