import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http } from "msw";
import { expect } from "storybook/test";

import { ListDetailPage, ListsPage } from "./ListsPages";
import { SongOpenContext } from "@/lib/catalogPane";
import { catalogList } from "@/test/catalog";
import { API, list, listById, makeList, makeUser } from "@/test/handlers";
import { expectCompactRows, PHONE_FRAME, phoneWidth } from "@/test/phone";

const owner = makeUser({ id: "user-1", display_name: "Christos" });

const rempetika = catalogList(4, { description: "Όσα παίζουμε τα Σάββατα." });

/*
 * The list pages. The detail page is mounted under `/lists/:listId`; each story
 * waits for its content in `play`, so the axe check sees the loaded page.
 */
const meta = {
  title: "Pages/List",
  component: ListDetailPage,
  parameters: { layout: "fullscreen", path: "/lists/:listId", route: "/lists/list-1" },
  beforeEach({ msw }) {
    msw.use(listById(rempetika));
  },
} satisfies Meta<typeof ListDetailPage>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The owner gets drag handles (a lazy chunk) and the list's controls. */
export const AsOwner: Story = {
  parameters: { user: owner },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("heading", { name: "Ρεμπέτικα" })).toBeVisible();
    // The module the page's `lazy` names, so this resolves when the page's own
    // import does: the dev server compiles it on first request, mid-play, and
    // on a loaded machine that outlasts findBy's one second.
    await import("@/components/SortableSongList");
    await expect(await canvas.findAllByRole("button", { name: /reorder/i })).toHaveLength(4);
    await expect(canvas.getByRole("button", { name: "More actions" })).toBeVisible();
  },
};

/**
 * The owner's rows on a phone: the handle and the remove button fit beside a
 * compact row, inside the page's gutters, without making it taller.
 */
export const AsOwnerOnAPhone: Story = {
  parameters: { user: owner },
  decorators: [phoneWidth],
  play: async ({ canvas }) => {
    await import("@/components/SortableSongList");
    const handles = await canvas.findAllByRole("button", { name: /reorder/i });
    const removes = canvas.getAllByRole("button", { name: /^Remove .* from this list$/ });
    const frame = canvas.getByTestId(PHONE_FRAME).getBoundingClientRect();
    const rows = canvas
      .getAllByRole("link")
      .filter((link) => link.getAttribute("href")?.includes("?list="));
    await expect(rows).toHaveLength(4);

    const boxes = await expectCompactRows(rows);
    for (const [index, box] of boxes.entries()) {
      const handle = handles[index]?.getBoundingClientRect();
      const remove = removes[index]?.getBoundingClientRect();
      await expect(handle?.right).toBeLessThanOrEqual(box.left);
      await expect(remove?.left).toBeGreaterThanOrEqual(box.right);
      await expect(handle?.left).toBeGreaterThanOrEqual(frame.left);
      await expect(remove?.right).toBeLessThanOrEqual(frame.right);
    }
  },
};

/** Someone else's public list: read-only, with the way to copy it. */
export const AsReader: Story = {
  parameters: { user: makeUser({ id: "user-2" }) },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("button", { name: /save to my lists/i })).toBeVisible();
    await expect(canvas.queryByRole("button", { name: "More actions" })).toBeNull();
  },
};

/**
 * The list beside a song read from it: the pane a wide screen keeps on the left,
 * the open song marked, and the song's own title and heading left to the song.
 */
export const BesideASong: Story = {
  parameters: { path: "/songs/:id", route: "/songs/thalassa-platia?list=list-1" },
  // What `ReaderSplit` tells the pane beside an open song.
  decorators: [
    (Story) => (
      <SongOpenContext value>
        <Story />
      </SongOpenContext>
    ),
  ],
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("heading", { level: 2, name: "Ρεμπέτικα" })).toBeVisible();
    await expect(canvas.getByRole("link", { name: /Θάλασσα Πλατιά/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
  },
};

/**
 * The owner's list beside a song: the open song's fill and bar are the whole
 * row's, the handle and the remove button inside them and the bar at its edge.
 */
export const AsOwnerBesideASong: Story = {
  parameters: { user: owner, path: "/songs/:id", route: "/songs/thalassa-platia?list=list-1" },
  decorators: [
    (Story) => (
      <SongOpenContext value>
        <Story />
      </SongOpenContext>
    ),
    phoneWidth,
  ],
  play: async ({ canvas }) => {
    await import("@/components/SortableSongList");
    const handle = await canvas.findByRole("button", { name: "Reorder Θάλασσα Πλατιά" });
    const open = canvas.getByRole("link", { current: "page" });
    const row = open.closest("li")?.firstElementChild;
    if (!(row instanceof HTMLElement)) throw new Error("The open song has no row.");

    // The fill on the row, the card itself left clear to show it.
    const rowStyle = getComputedStyle(row);
    await expect(rowStyle.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
    await expect(getComputedStyle(open).backgroundColor).toBe("rgba(0, 0, 0, 0)");
    await expect(row.contains(handle)).toBe(true);

    // The bar at the row's left edge, ahead of the handle, not beside the title.
    const bar = getComputedStyle(row, "::before");
    await expect(bar.width).toBe("4px");
    await expect(bar.left).toBe("0px");
    await expect(row.getBoundingClientRect().left).toBeLessThan(
      handle.getBoundingClientRect().left + 1,
    );
    await expect(getComputedStyle(open, "::before").content).toBe("none");
  },
};

export const Empty: Story = {
  parameters: { user: owner },
  beforeEach({ msw }) {
    msw.use(listById(makeList()));
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("heading", { name: "Ρεμπέτικα" })).toBeVisible();
  },
};

/** A private list answers 404 to anyone else, and the page says so. */
export const NotAvailable: Story = {
  parameters: { route: "/lists/list-404" },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText(/not available/i)).toBeVisible();
  },
};

/** The signed-in reader's own lists. */
export const YourLists: Story = {
  render: () => <ListsPage />,
  parameters: { user: owner, path: "/lists", route: "/lists" },
  beforeEach({ msw }) {
    msw.use(
      http.get(`${API}/api/v1/lists`, () =>
        HttpResponse.json(
          list([
            makeList({ is_default: true, name: "Favorites", item_count: 12 }),
            makeList({ id: "list-2", name: "Ρεμπέτικα", item_count: 4 }),
            makeList({ id: "list-3", name: "Έντεχνα", is_public: false, item_count: 1 }),
          ]),
        ),
      ),
    );
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("Έντεχνα")).toBeVisible();
  },
};
