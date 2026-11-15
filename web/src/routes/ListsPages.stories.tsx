import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http } from "msw";
import { expect } from "storybook/test";

import { ListDetailPage, ListsPage } from "./ListsPages";
import { catalogSongs } from "@/test/catalog";
import { API, list, listById, makeList, makeUser } from "@/test/handlers";

const owner = makeUser({ id: "user-1", display_name: "Christos" });

const rempetika = makeList({
  description: "Όσα παίζουμε τα Σάββατα.",
  songs: catalogSongs.slice(0, 4).map((song, position) => ({ ...song, position })),
  item_count: 4,
});

/*
 * The list pages. The detail page is mounted under `/lists/:id`; each story
 * waits for its content in `play`, so the axe check sees the loaded page.
 */
const meta = {
  title: "Pages/List",
  component: ListDetailPage,
  parameters: { layout: "fullscreen", path: "/lists/:id", route: "/lists/list-1" },
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
    await expect(await canvas.findAllByRole("button", { name: /reorder/i })).toHaveLength(4);
    await expect(canvas.getByRole("button", { name: /delete list/i })).toBeVisible();
  },
};

/** Someone else's public list: read-only, with the way to copy it. */
export const AsReader: Story = {
  parameters: { user: makeUser({ id: "user-2" }) },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("button", { name: /save to my lists/i })).toBeVisible();
    await expect(canvas.queryByRole("button", { name: /delete list/i })).toBeNull();
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
