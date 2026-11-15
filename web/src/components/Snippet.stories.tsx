import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";

import { Snippet } from "./Snippet";

const meta = {
  title: "Catalog/Snippet",
  component: Snippet,
  args: {
    text: "Στης ⟦θάλασσας⟧ τα βάθη η ⟦αγάπη⟧ μου κοιμάται",
    className: "text-sm text-stone-600 dark:text-stone-400",
  },
} satisfies Meta<typeof Snippet>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Highlighted: Story = {};

/**
 * Lyrics are contributor-typed and come back from `ts_headline` verbatim, so
 * markup in them must be shown, never parsed. See "Search" in CLAUDE.md.
 */
export const MarkupInLyrics: Story = {
  args: { text: "<b>bold</b> and ⟦<img src=x onerror=alert(1)>⟧" },
  play: async ({ canvas, canvasElement }) => {
    await expect(canvasElement.querySelector("b, img")).toBeNull();
    await expect(canvas.getByText("<img src=x onerror=alert(1)>").tagName).toBe("MARK");
  },
};
