import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, fn, userEvent, within } from "storybook/test";

import { Button, ConfirmSheet } from "./ui";

/**
 * `Sheet` is a native modal `<dialog>`, which jsdom only stubs
 * (`src/test/dialog.ts`). These run in a real browser, so the top layer, the
 * inert page and focus returning to the opener are the browser's own.
 *
 * Escape is not tested: `storybook/test`'s `userEvent` dispatches synthetic
 * events, and a browser closes a dialog only on trusted input.
 */
const meta = {
  title: "Primitives/ConfirmSheet",
  component: ConfirmSheet,
  args: {
    open: false,
    title: "Delete this song?",
    children: "It is removed from every list it is on. This cannot be undone.",
    onClose: fn(),
    onConfirm: fn(),
  },
  render: function Render(args) {
    const [open, setOpen] = useState(args.open);
    return (
      <>
        <Button variant="danger" onClick={() => setOpen(true)}>
          Delete song
        </Button>
        <ConfirmSheet
          {...args}
          open={open}
          onClose={() => {
            args.onClose();
            setOpen(false);
          }}
        />
      </>
    );
  },
} satisfies Meta<typeof ConfirmSheet>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Cancel: Story = {
  play: async ({ args, canvas, canvasElement }) => {
    const trigger = canvas.getByRole("button", { name: "Delete song" });
    await userEvent.click(trigger);

    const dialog = within(canvasElement).getByRole("dialog", { name: "Delete this song?" });
    await expect(dialog.matches(":modal")).toBe(true);

    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await expect(dialog).not.toHaveAttribute("open");
    await expect(trigger).toHaveFocus();
    await expect(args.onClose).toHaveBeenCalledOnce();
    await expect(args.onConfirm).not.toHaveBeenCalled();
  },
};

export const Confirm: Story = {
  play: async ({ args, canvas, canvasElement }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Delete song" }));
    const dialog = within(canvasElement).getByRole("dialog");

    await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await expect(args.onConfirm).toHaveBeenCalledOnce();
  },
};

/** A refusal is shown inside the sheet, which stays open. */
export const Refused: Story = {
  args: { open: true, error: "Only an admin can delete a song someone else added." },
};

export const Pending: Story = {
  args: { open: true, pending: true },
};
