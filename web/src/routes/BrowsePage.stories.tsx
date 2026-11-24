import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, delay, http } from "msw";
import { expect } from "storybook/test";

import { BrowsePage } from "./BrowsePage";
import type { Song } from "@/lib/types";
import { catalogGenres, catalogSongs, laiko, rempetiko } from "@/test/catalog";
import { API, apiError, list, makeRecording, makeSong, makeUser } from "@/test/handlers";
import { expectCompactRows, phoneWidth } from "@/test/phone";

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

/** A dozen songs with long Greek titles and bylines, each a different slug. */
const dozen = Array.from({ length: 12 }, (_, index) =>
  makeSong({
    id: `song-${index}`,
    slug: `tragoudi-${index}`,
    title: `Τραγούδι ${index + 1}: Ήρθε η ώρα να φύγω από τη γειτονιά μας`,
    credits: [
      { person_id: "person-1", name: "Μίκης Θεοδωράκης", role: "composer", position: 0 },
      { person_id: "person-2", name: "Ιάκωβος Καμπανέλλης", role: "lyricist", position: 0 },
    ],
    recordings: [makeRecording()],
    // Every third song without a genre, to show the rows stay level.
    genres: index % 3 === 0 ? [] : [rempetiko, laiko].slice(0, index % 3),
  }),
);

/**
 * A phone's screen, about 740px of it under the browser's own bars, holds ten
 * songs: rows a thumb can still hit, and the open one marked.
 */
export const OnAPhone: Story = {
  parameters: { route: "/songs/tragoudi-2" },
  beforeEach({ msw }) {
    msw.use(...serveCatalog(dozen));
  },
  decorators: [phoneWidth],
  play: async ({ canvas }) => {
    await canvas.findByText(/Τραγούδι 12:/);
    const rows = canvas
      .getAllByRole("link")
      .filter((link) => link.getAttribute("href")?.startsWith("/songs/tragoudi-"));
    await expect(rows).toHaveLength(12);

    const boxes = await expectCompactRows(rows);
    const first = boxes[0]?.top ?? 0;
    await expect(boxes.filter((box) => box.bottom - first <= 740).length).toBeGreaterThanOrEqual(
      10,
    );

    // Marked by more than its attribute: a fill and a bar the rest lack.
    const open = canvas.getByRole("link", { current: "page" });
    const other = rows.find((row) => row !== open);
    const openStyle = getComputedStyle(open);
    await expect(openStyle.backgroundColor).not.toBe(
      other && getComputedStyle(other).backgroundColor,
    );
    const bar = getComputedStyle(open, "::before");
    await expect(bar.width).toBe("4px");
    await expect(bar.backgroundColor).not.toBe(openStyle.backgroundColor);
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
      }),
    );
  },
};
