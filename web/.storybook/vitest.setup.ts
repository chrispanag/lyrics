// Applies preview.tsx's decorators and parameters (the a11y check included)
// to every story the `storybook` Vitest project runs.
import { setProjectAnnotations } from "@storybook/react-vite";
import * as a11yAnnotations from "@storybook/addon-a11y/preview";

import * as projectAnnotations from "./preview";

setProjectAnnotations([a11yAnnotations, projectAnnotations]);
