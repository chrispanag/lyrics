import type { Meta, StoryObj } from "@storybook/react-vite";
import { Plus } from "lucide-react";
import { expect } from "storybook/test";

import { PageHeader } from "./PageHeader";
import { Button } from "./ui";

const newList = (
  <Button size="sm">
    <Plus aria-hidden className="size-4" />
    New list
  </Button>
);

const meta = {
  title: "Primitives/PageHeader",
  component: PageHeader,
  args: { title: "Your lists" },
} satisfies Meta<typeof PageHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TitleOnly: Story = {};

/** The lists index: the page's one action opposite its title. */
export const WithActions: Story = {
  args: { actions: newList },
};

/** Admin: the section's name over the screen's. */
export const WithEyebrow: Story = {
  args: { eyebrow: "Admin", title: "Users" },
};

/**
 * A phone's width, less the page's gutters: a title too long to share its
 * line pushes the actions beneath it rather than out of the screen.
 */
export const Phone: Story = {
  args: { title: "Τα αγαπημένα μου ρεμπέτικα του καλοκαιριού", actions: newList },
  decorators: [
    (Story) => (
      <div className="w-[390px] px-4">
        {/* Measured inside the gutters, so spilling into one fails. */}
        <div data-testid="frame">
          <Story />
        </div>
      </div>
    ),
  ],
  play: async ({ canvas }) => {
    const frame = canvas.getByTestId("frame").getBoundingClientRect();
    const title = canvas.getByRole("heading", { level: 1 }).getBoundingClientRect();
    const action = canvas.getByRole("button", { name: "New list" }).getBoundingClientRect();

    await expect(action.right).toBeLessThanOrEqual(frame.right);
    await expect(title.right).toBeLessThanOrEqual(frame.right);
    // Wrapped beneath the title, not squeezed beside it.
    await expect(action.top).toBeGreaterThanOrEqual(title.bottom);
  },
};
