import type { Meta, StoryObj } from "@storybook/react-vite";
import { Route, Routes } from "react-router-dom";
import { expect, userEvent, within } from "storybook/test";

import { Layout } from "./Layout";
import { MenuHeader } from "./SearchHeader";
import { makeUser } from "@/test/handlers";

/**
 * The app's shell: the sidebar from `md` up, and below it the drawer the
 * hamburger opens. Story tests run at 1200×900 unless a story names a viewport,
 * which `DrawerOpen` does.
 */
const meta = {
  title: "Shell/Layout",
  component: Layout,
  parameters: { layout: "fullscreen" },
  render: () => (
    <Routes>
      <Route element={<Layout />}>
        <Route
          path="*"
          element={
            <>
              <MenuHeader />
              <div className="mx-auto max-w-2xl px-4 py-6">
                <h1 className="text-2xl font-semibold">A page</h1>
                <p className="mt-2 text-stone-600 dark:text-stone-400">
                  The screen a route renders goes here.
                </p>
              </div>
            </>
          }
        />
      </Route>
    </Routes>
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
  // The hamburger is `md:hidden`; the addon sizes the test browser from this.
  globals: { viewport: { value: "mobile1", isRotated: false } },
  play: async ({ canvas, canvasElement }) => {
    const trigger = canvas.getByRole("button", { name: "Open menu" });
    await userEvent.click(trigger);

    const drawer = within(canvasElement).getByRole("dialog", { name: "Navigation" });
    await expect(drawer).toBeVisible();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect(within(drawer).getByRole("link", { name: /Christos/ })).toBeVisible();
  },
};
