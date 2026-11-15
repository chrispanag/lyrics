import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, delay, http } from "msw";
import { expect } from "storybook/test";

import { BrowsePage } from "./BrowsePage";
import type { Song } from "@/lib/types";
import { catalogGenres, catalogSongs } from "@/test/catalog";
import { API, apiError, list, makeUser } from "@/test/handlers";

/** Serves `songs` for the catalog and the catalog's genres for the filter. */
function serveCatalog(songs: Song[]) {
  return [
    http.get(`${API}/api/v1/songs`, () => HttpResponse.json(list(songs))),
    http.get(`${API}/api/v1/genres`, () => HttpResponse.json(list(catalogGenres))),
  ];
}

/*
 * Every story that loads waits for its content in `play`, which is also what
 * makes the axe check run against the loaded page rather than the skeleton.
 */
const meta = {
  title: "Pages/Browse",
  component: BrowsePage,
  parameters: { layout: "fullscreen" },
  beforeEach({ msw }) {
    msw.use(...serveCatalog(catalogSongs));
  },
} satisfies Meta<typeof BrowsePage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Catalog: Story = {
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("Φραγκοσυριανή")).toBeVisible();
    await expect(canvas.queryByRole("link", { name: /add song/i })).toBeNull();
  },
};

/** The affordance follows what the server would allow. */
export const AsContributor: Story = {
  parameters: { user: makeUser({ role: "contributor" }) },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("link", { name: /add song/i })).toBeVisible();
  },
};

export const SearchResults: Story = {
  parameters: { route: "/?q=θάλασσα" },
  beforeEach({ msw }) {
    msw.use(
      ...serveCatalog(
        catalogSongs
          .slice(0, 2)
          .map((song) => ({ ...song, snippet: "Στης ⟦θάλασσας⟧ τα βάθη η αγάπη μου κοιμάται" })),
      ),
    );
  },
  play: async ({ canvas }) => {
    await expect((await canvas.findAllByText("θάλασσας"))[0]?.tagName).toBe("MARK");
  },
};

/**
 * A filter chip is keyed on the URL, so a genre deleted while someone held the
 * link still shows a chip to clear, under its raw slug.
 */
export const FilteredByDeletedGenre: Story = {
  parameters: { route: "/?genre_slug=smyrneiko" },
  beforeEach({ msw }) {
    msw.use(...serveCatalog([]));
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("smyrneiko")).toBeVisible();
  },
};

export const NoMatches: Story = {
  parameters: { route: "/?q=nothingmatches" },
  beforeEach({ msw }) {
    msw.use(...serveCatalog([]));
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText(/no songs matched/i)).toBeVisible();
  },
};

/** A failure is said, not shown as an empty catalog. */
export const Failed: Story = {
  beforeEach({ msw }) {
    msw.use(
      http.get(`${API}/api/v1/songs`, () =>
        apiError(500, "internal_error", "Something went wrong."),
      ),
    );
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("alert")).toHaveTextContent("Something went wrong.");
  },
};

export const Loading: Story = {
  beforeEach({ msw }) {
    msw.use(
      http.get(`${API}/api/v1/songs`, async () => {
        await delay("infinite");
        return HttpResponse.json(list([]));
      }),
    );
  },
};
