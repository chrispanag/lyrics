import type { Meta, StoryObj } from "@storybook/react-vite";

import { Avatar } from "./Avatar";
import { makeUser } from "@/test/handlers";

/**
 * Initials only: a picture is fetched from the API by address, and nothing
 * serves one under Storybook.
 */
const meta = {
  title: "Account/Avatar",
  component: Avatar,
  args: { user: makeUser({ display_name: "Μαρία Φαραντούρη" }) },
  argTypes: { size: { control: "inline-radio", options: ["sm", "md", "lg"] } },
} satisfies Meta<typeof Avatar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Initials: Story = {};

/** The palette is keyed on the id, so each person keeps their color. */
export const Palette: Story = {
  render: () => (
    <div className="flex gap-2">
      {["a", "b", "c", "d", "e", "f"].map((id) => (
        <Avatar key={id} size="md" user={makeUser({ id, display_name: `Person ${id}` })} />
      ))}
    </div>
  ),
};

export const NoDisplayName: Story = {
  args: { size: "lg", user: makeUser({ display_name: null }) },
};
