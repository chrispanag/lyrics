import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent } from "storybook/test";

import { ProfilePage } from "./ProfilePage";
import { makeUser } from "@/test/handlers";

/**
 * The profile, and for a guest the only screen with the theme switch. The
 * switch is native radios: one Tab stop, the arrow keys moving the choice.
 */
const meta = {
  title: "Pages/Profile",
  component: ProfilePage,
  parameters: { layout: "fullscreen", route: "/profile" },
} satisfies Meta<typeof ProfilePage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Guest: Story = {
  play: async ({ canvas, globals }) => {
    const group = canvas.getByRole("group", { name: "Appearance" });
    await expect(group).toBeVisible();
    // "System" starts checked, so pressing it would change nothing. The run's own
    // theme is a real change that leaves the ground axe then judges where it was.
    const name = globals.theme === "dark" ? "Dark" : "Light";
    await userEvent.click(canvas.getByRole("radio", { name }));
    await expect(canvas.getByRole("radio", { name })).toBeChecked();
  },
};

export const SignedIn: Story = {
  parameters: {
    user: makeUser({ display_name: "Μαρία Φαραντούρη", role: "contributor" }),
    // axe reads `Avatar`'s initials ("ΜΦ") as the "Edit picture" button's
    // visible label. They identify a person and label nothing; naming the
    // button after them would announce "ΜΦ Edit picture". The cause is the
    // component, so any control wrapping an `Avatar` meets this; off here for
    // this story only, since the rule caught the filter button's real mismatch.
    a11y: { config: { rules: [{ id: "label-content-name-mismatch", enabled: false }] } },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("heading", { name: "Profile" })).toBeVisible();
  },
};
