import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

import { Layout } from "./Layout";
import { MenuHeader } from "./SearchHeader";
import { applyNavCollapsed, storeNavCollapsed } from "@/lib/navCollapsed";
import { makeUser } from "@/test/handlers";

/**
 * The app's shell: the sidebar from `md` up, and below it the drawer the
 * hamburger opens. The sidebar collapses on a desk too, and the hamburger is
 * what opens it again. Story tests run at 1200×900 unless a story names a
 * viewport, which `DrawerOpen` does.
 */

/** Stories start with the column open, whatever an earlier one stored. */
const openNavigation = () => {
  storeNavCollapsed(false);
  applyNavCollapsed(false);
};
const meta = {
  title: "Shell/Layout",
  component: Layout,
  parameters: { layout: "fullscreen" },
  loaders: [openNavigation],
  render: () => (
    <Layout>
      <MenuHeader />
      <div className="mx-auto max-w-2xl px-4 py-6">
        <h1 className="text-2xl font-semibold">A page</h1>
        <p className="mt-2 text-fg-tertiary">The screen a route renders goes here.</p>
      </div>
    </Layout>
  ),
} satisfies Meta<typeof Layout>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A guest gets the profile link (the theme switch lives there) and Sign in. */
export const Guest: Story = {};

export const SignedIn: Story = {
  parameters: {
    user: makeUser({ display_name: "Μαρία Φαραντούρη", role: "contributor" }),
    route: "/lists",
  },
};

/** Admin is one entry naming the section, lit on any screen inside it. */
export const Admin: Story = {
  parameters: {
    user: makeUser({ display_name: "Christos", role: "admin" }),
    route: "/admin/genres",
  },
};

/**
 * The drawer is modal only while open, and inert while closed so its links
 * are not a second copy of the navigation in the tab order.
 */
export const DrawerOpen: Story = {
  parameters: { user: makeUser({ display_name: "Christos" }) },
  // The hamburger is hidden while the column is open at a desk; the addon
  // sizes the test browser from this.
  globals: { viewport: { value: "mobile1", isRotated: false } },
  play: async ({ canvas }) => {
    const trigger = canvas.getByRole("button", { name: "Open menu" });
    await userEvent.click(trigger);

    const drawer = canvas.getByRole("dialog", { name: "Navigation" });
    await expect(drawer).toBeVisible();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect(within(drawer).getByRole("link", { name: /Christos/ })).toBeVisible();
  },
};

/** Collapsed, the column leaves the layout and the hamburger brings it back. */
export const Collapsed: Story = {
  parameters: { user: makeUser({ display_name: "Christos" }) },
  loaders: [
    () => {
      storeNavCollapsed(true);
      applyNavCollapsed(true);
    },
  ],
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole("complementary")).toBeNull();
    const open = canvas.getByRole("button", { name: "Open menu" });
    await expect(open).toBeVisible();

    await userEvent.click(open);

    const sidebar = canvas.getByRole("complementary");
    await expect(sidebar).toBeVisible();
    await expect(within(sidebar).getByRole("link", { name: /Christos/ })).toBeVisible();

    await userEvent.click(canvas.getByRole("button", { name: "Hide navigation" }));

    await expect(canvas.queryByRole("complementary")).toBeNull();
    await expect(canvas.getByRole("button", { name: "Open menu" })).toBeVisible();
  },
};
