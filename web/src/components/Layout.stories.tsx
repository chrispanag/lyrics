import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { Layout } from "./Layout";
import { Page } from "./Page";
import { MenuHeader } from "./SearchHeader";
import { applyNavCollapsed, storeNavCollapsed } from "@/lib/navCollapsed";
import { makeUser } from "@/test/handlers";
import { phoneGlobals, phoneParameters } from "@/test/phone";

/**
 * The app's shell: the sidebar from `md` up, and below it the bottom bar. The
 * sidebar collapses on a desk too, and the menu button is what opens it again.
 * Story tests run at 1200×900 unless a story names a viewport, as the phone
 * ones do.
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
      <Page width="content">
        <h1 className="text-2xl font-semibold">A page</h1>
        <p className="mt-2 text-fg-tertiary">The screen a route renders goes here.</p>
      </Page>
    </Layout>
  ),
} satisfies Meta<typeof Layout>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The phone's bar, which a desk never draws. */
const bottomBar = (canvas: ReturnType<typeof within>) =>
  canvas.queryByRole("navigation", { name: "Navigation" });

/** Waits until the lit tab's shading sits exactly under the tab named `name`. */
async function markUnder(bar: HTMLElement, name: string) {
  // Read afresh each time: the mark is drawn anew when the tabs change.
  await waitFor(() => {
    const mark = bar.querySelector<HTMLElement>(".bottom-bar-mark");
    if (!mark) throw new Error("No mark under the lit tab.");
    const tab = within(bar).getByRole("link", { name }).getBoundingClientRect();
    const drawn = mark.getBoundingClientRect();
    expect(Math.abs(drawn.left - tab.left)).toBeLessThan(1);
    expect(Math.abs(drawn.width - tab.width)).toBeLessThan(1);
    expect(getComputedStyle(mark).opacity).toBe("1");
  });
}

/**
 * A guest gets the profile link (the theme switch lives there) and Sign in.
 * At a desk the column is the navigation, and the phone's bar is not drawn.
 */
export const Guest: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("complementary")).toBeVisible();
    await expect(bottomBar(canvas)).toBeNull();
  },
};

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

/** Collapsed, the column leaves the layout and the menu button brings it back. */
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

    // The column stays in the tree until the slide ends, then drops out of it.
    await waitFor(() => {
      if (canvas.queryByRole("complementary") !== null) {
        throw new Error("The column is still in the accessibility tree.");
      }
    });
    await expect(canvas.getByRole("button", { name: "Open menu" })).toBeVisible();
  },
};

/**
 * A phone: no column, no menu button and no bar above the page, and the bottom
 * bar holding the navigation and Search.
 */
export const PhoneSignedIn: Story = {
  parameters: {
    ...phoneParameters,
    user: makeUser({ display_name: "Μαρία Φαραντούρη", role: "contributor" }),
    route: "/lists",
  },
  globals: phoneGlobals,
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole("complementary")).toBeNull();
    await expect(canvas.queryByRole("button", { name: "Open menu" })).toBeNull();

    const bar = bottomBar(canvas);
    if (!bar) throw new Error("No bottom bar on a phone.");
    await expect(bar).toBeVisible();
    await expect(within(bar).getByRole("link", { name: "Lists" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(within(bar).getByRole("link", { name: "Profile" })).toBeVisible();
    await expect(within(bar).getByRole("button", { name: "Search" })).toBeVisible();

    // One shading for the lit tab, which slides to the next one lit.
    await markUnder(bar, "Lists");
    await userEvent.click(within(bar).getByRole("link", { name: "Profile" }));
    await markUnder(bar, "Profile");
  },
};

/** A guest's bar: Browse and Profile, which holds Sign in and the theme. */
export const PhoneGuest: Story = {
  parameters: phoneParameters,
  globals: phoneGlobals,
  play: async ({ canvas }) => {
    const bar = bottomBar(canvas);
    if (!bar) throw new Error("No bottom bar on a phone.");
    await expect(within(bar).queryByRole("link", { name: "Lists" })).toBeNull();
    await expect(within(bar).getByRole("link", { name: "Profile" })).toBeVisible();
    await markUnder(bar, "Browse");
  },
};

/** An admin's console has no tab: Profile leads there, and stays lit inside it. */
export const PhoneAdmin: Story = {
  parameters: {
    ...phoneParameters,
    user: makeUser({ display_name: "Christos", role: "admin" }),
    route: "/admin/genres",
  },
  globals: phoneGlobals,
  play: async ({ canvas }) => {
    const bar = bottomBar(canvas);
    if (!bar) throw new Error("No bottom bar on a phone.");
    await expect(within(bar).queryByRole("link", { name: "Admin" })).toBeNull();
    await expect(within(bar).getByRole("link", { name: "Profile" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await markUnder(bar, "Profile");
  },
};
