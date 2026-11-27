import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { Layout } from "./Layout";
import { Page } from "./Page";
import { PlainSheet } from "./PlainSheet";
import { makeUser } from "@/test/handlers";
import { phoneGlobals, phoneParameters } from "@/test/viewport";

/**
 * The app's shell: the navigation rail from `md` up, and below it the bottom
 * bar, around a `PlainSheet`, as the `(plain)` group sets out its screens.
 * Story tests run at 1200×900 unless a story names a viewport, as the phone
 * ones do.
 */
const meta = {
  title: "Shell/Layout",
  component: Layout,
  parameters: { layout: "fullscreen" },
  render: () => (
    <Layout>
      <PlainSheet>
        <Page width="content">
          <h1 className="text-2xl font-semibold">A page</h1>
          <p className="mt-2 text-fg-tertiary">The screen a route renders goes here.</p>
        </Page>
      </PlainSheet>
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
 * At a desk the rail is the navigation, and the phone's bar is not drawn.
 */
export const Guest: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("complementary")).toBeVisible();
    await expect(bottomBar(canvas)).toBeNull();
  },
};

/**
 * A screen of the `(plain)` group at a desk is one sheet beside the rail, as
 * the reader's list and song are two: the same inset from the window's edges
 * as theirs, at least a window tall, on the surface color.
 */
export const ScreenOnASheet: Story = {
  play: async ({ canvas }) => {
    const heading = await canvas.findByRole("heading", { name: "A page" });
    // The heading's page sits straight on the sheet.
    const sheet = heading.parentElement?.parentElement;
    if (!sheet) throw new Error("The screen has no sheet.");
    const box = sheet.getBoundingClientRect();

    await expect(box.left).toBe(64);
    await expect(box.top).toBe(8);
    // From the root's edge, short of the scrollbar's gutter, which a screen the
    // window scrolls keeps (`scrollbar-gutter: stable`).
    await expect(document.documentElement.getBoundingClientRect().right - box.right).toBe(8);
    await expect(window.innerHeight - box.bottom).toBe(8);
    await expect(getComputedStyle(sheet).backgroundColor).not.toBe(
      getComputedStyle(document.body).backgroundColor,
    );
    // The window has nothing to scroll past the sheet.
    await expect(document.documentElement.scrollHeight).toBe(window.innerHeight);
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

/**
 * The rail is 4rem of icons. An entry's name shows beside it while the entry
 * has focus or the pointer, over the page rather than pushing it aside.
 */
export const RailLabels: Story = {
  parameters: { user: makeUser({ display_name: "Christos" }) },
  play: async ({ canvas }) => {
    const rail = canvas.getByRole("complementary");
    await expect(rail.getBoundingClientRect().width).toBe(64);

    const lists = within(rail).getByRole("link", { name: "Lists" });
    const label = within(lists).getByText("Lists");
    await expect(getComputedStyle(label).opacity).toBe("0");

    lists.focus();
    await waitFor(() => expect(getComputedStyle(label).opacity).toBe("1"));
    // Past the rail's edge, so it covers the page rather than widening the rail.
    await expect(label.getBoundingClientRect().left).toBeGreaterThanOrEqual(64);
    await expect(rail.getBoundingClientRect().width).toBe(64);
  },
};

/**
 * A phone: no rail and no bar above the page, and the bottom bar holding the
 * navigation and Search.
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

/** On a phone the page, the content column and its sticky bars are the surface. */
export const PhoneIsTheSheet: Story = {
  parameters: phoneParameters,
  globals: phoneGlobals,
  play: async ({ canvas }) => {
    const heading = await canvas.findByRole("heading", { name: "A page" });
    // The color `bg-surface` paints, read from an element that carries it.
    const probe = document.createElement("div");
    probe.className = "bg-surface";
    document.body.append(probe);
    const surface = getComputedStyle(probe).backgroundColor;
    probe.remove();

    await expect(getComputedStyle(document.body).backgroundColor).toBe(surface);
    const column = heading.closest("main")?.firstElementChild as HTMLElement;
    await expect(getComputedStyle(column).backgroundColor).toBe(surface);
    // The sticky bars on it are drawn on the same color.
    await expect(getComputedStyle(column).getPropertyValue("--sticky-bar-bg").trim()).toBe(
      getComputedStyle(document.documentElement).getPropertyValue("--color-surface").trim(),
    );
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
