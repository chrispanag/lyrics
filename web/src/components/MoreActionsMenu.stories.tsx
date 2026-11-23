import type { Meta, StoryObj } from "@storybook/react-vite";
import { Pencil, Trash } from "lucide-react";
import { expect, fn, userEvent } from "storybook/test";

import { MenuItem, MoreActionsMenu } from "./MoreActionsMenu";

/**
 * The menu in a real browser: the popover's top layer and its placement by
 * anchor, which jsdom has neither of. The keyboard and dismissal are specced in
 * `MoreActionsMenu.test.tsx`.
 *
 * The bar is as narrow as the list pane beside the lyrics, with the trigger at
 * its end as in every toolbar, so the panel has to grow back across it.
 */
const meta = {
  title: "Primitives/MoreActionsMenu",
  component: MoreActionsMenu,
  args: { children: null },
  render: () => (
    <div data-testid="bar" className="flex w-80 items-center justify-end border-b border-line">
      <MoreActionsMenu>
        <MenuItem icon={Pencil} onSelect={fn()}>
          Rename
        </MenuItem>
        <MenuItem icon={Trash} danger onSelect={fn()}>
          Delete list
        </MenuItem>
      </MoreActionsMenu>
    </div>
  ),
} satisfies Meta<typeof MoreActionsMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Open, below the trigger and inside the bar's width. */
export const Open: Story = {
  play: async ({ canvas }) => {
    const trigger = canvas.getByRole("button", { name: "More actions" });
    await userEvent.click(trigger);

    const menu = canvas.getByRole("menu", { name: "More actions" });
    await expect(menu.matches(":popover-open")).toBe(true);
    await expect(canvas.getByRole("menuitem", { name: "Delete list" })).toBeVisible();

    const bar = canvas.getByTestId("bar").getBoundingClientRect();
    const button = trigger.getBoundingClientRect();
    const panel = menu.getBoundingClientRect();
    await expect(panel.top).toBeGreaterThanOrEqual(button.bottom);
    await expect(Math.round(panel.right)).toBe(Math.round(button.right));
    await expect(panel.left).toBeGreaterThanOrEqual(bar.left);
  },
};
