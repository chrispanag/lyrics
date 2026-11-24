import type { Decorator, Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { SongDetailPage } from "./SongDetailPage";
import { Layout } from "@/components/Layout";
import { catalogList, catalogSongs, entechno } from "@/test/catalog";
import { listById, makeRecording, makeSong, makeUser, songByRef } from "@/test/handlers";
import { phoneGlobals, phoneParameters } from "@/test/phone";

const documented = makeSong({
  id: "song-9",
  slug: "to-palio-roloi",
  title: "Το Παλιό Ρολόι",
  lyrics:
    "Το παλιό ρολόι χτυπά\nμεσάνυχτα στην κάμαρά μου\nκι εσύ δεν είσαι πια εδώ\nνα μου κρατάς τα χέρια μου\n\nΤο παλιό ρολόι χτυπά\nκαι μετρά τα βάσανά μου",
  credits: [
    { person_id: "person-1", name: "Μίκης Θεοδωράκης", role: "composer", position: 0 },
    { person_id: "person-6", name: "Νίκος Γκάτσος", role: "lyricist", position: 1 },
  ],
  youtube_video_id: "dQw4w9WgXcQ",
  release_year: 1962,
  recordings: [
    makeRecording({
      youtube_video_id: "dQw4w9WgXcQ",
      release_year: 1962,
      label: "Columbia",
    }),
    makeRecording({
      id: "recording-2",
      is_first: false,
      position: 1,
      release_year: 1985,
      performers: [{ person_id: "person-7", name: "Χάρις Αλεξίου", position: 0 }],
    }),
  ],
  genres: [entechno],
});

/*
 * The page is mounted under `/songs/:id`, as in the app. Each story waits for
 * the song in `play`, so the axe check sees the page and not the skeleton.
 */
const meta = {
  title: "Pages/Song",
  component: SongDetailPage,
  parameters: { layout: "fullscreen", path: "/songs/:id", route: "/songs/thalassa-platia" },
  beforeEach({ msw }) {
    msw.use(songByRef(makeSong(), documented, ...catalogSongs.slice(1)));
  },
} satisfies Meta<typeof SongDetailPage>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Most of the catalog: a composer, a year, no recording with anyone's name. */
export const Minimal: Story = {
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("heading", { name: "Θάλασσα Πλατιά" })).toBeVisible();
    await expect(canvas.queryByText(/Performed by/)).toBeNull();
  },
};

export const Documented: Story = {
  parameters: { route: "/songs/to-palio-roloi" },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("heading", { name: "Το Παλιό Ρολόι" })).toBeVisible();
    await expect(canvas.getByRole("link", { name: /watch on youtube/i })).toHaveAttribute(
      "href",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    );
  },
};

/**
 * Copied lyrics keep their lines and the gap between verses: each line is its
 * own block, and only a real break survives a selection.
 */
export const CopiesVerseByVerse: Story = {
  parameters: { route: "/songs/to-palio-roloi" },
  play: async ({ canvas }) => {
    // The refrain opens both verses; the first one is in the paragraph either way.
    const [first] = await canvas.findAllByText("Το παλιό ρολόι χτυπά", { selector: "span" });
    const lyrics = first?.parentElement;
    if (!lyrics) throw new Error("No lyrics paragraph");
    const selection = window.getSelection();
    selection?.selectAllChildren(lyrics);
    await expect(selection?.toString().trim()).toBe(documented.lyrics);
    selection?.removeAllRanges();
  },
};

/** Read from a list: the bar names the list and the place in it. */
export const InAList: Story = {
  parameters: { route: "/songs/frangosyriani?list=list-1" },
  beforeEach({ msw }) {
    msw.use(listById(catalogList(3)));
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("link", { name: "Ρεμπέτικα" })).toBeVisible();
    await expect(canvas.getByText("2 of 3")).toBeVisible();
  },
};

/** The song's tallies, left open so the axe check sees the dialog. */
export const Stats: Story = {
  play: async ({ canvas }) => {
    const stats = await canvas.findByRole("button", { name: "Stats" });
    // Enabled once the song, which carries the tallies, has arrived.
    await waitFor(() => expect(stats).toBeEnabled());
    await userEvent.click(stats);
    const sheet = await canvas.findByRole("dialog", { name: "Stats" });
    await expect(sheet).toBeVisible();
    await expect(sheet).toHaveTextContent("Views");
  },
};

/**
 * An admin can edit and delete any song; the page offers both, Delete behind
 * "More actions", left open so the axe check sees the menu.
 */
export const AsAdmin: Story = {
  parameters: { user: makeUser({ role: "admin" }) },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("link", { name: /edit/i })).toBeVisible();
    const more = canvas.getByRole("button", { name: "More actions" });
    // Held shut until the song, which the confirmation names, has arrived.
    await waitFor(() => expect(more).toBeEnabled());
    await userEvent.click(more);
    await expect(canvas.getByRole("menuitem", { name: "Delete song" })).toBeVisible();
  },
};

/** The song's own language is marked, so a screen reader voices it correctly. */
export const English: Story = {
  parameters: { route: "/songs/yesterday" },
  play: async ({ canvas }) => {
    const title = await canvas.findByRole("heading", { name: "Yesterday" });
    await expect(title.closest("[lang]")).toHaveAttribute("lang", "en");
  },
};

const longLine = makeSong({
  id: "song-10",
  slug: "makria-grammi",
  title: "Μακριά γραμμή",
  lyrics: "Κι αν η νύχτα πέσει βαριά πάνω στα σπίτια και στα στενά της γειτονιάς μας\nάλλος στίχος",
});

/**
 * A phone's width: a line too long to fit wraps, and its remainder starts
 * further in than the line did, so it never reads as the next line.
 */
export const WrappedLineOnAPhone: Story = {
  parameters: { route: "/songs/makria-grammi" },
  beforeEach({ msw }) {
    msw.use(songByRef(longLine));
  },
  decorators: [
    (Story) => (
      <div className="w-[390px]">
        <Story />
      </div>
    ),
  ],
  play: async ({ canvas }) => {
    const line = await canvas.findByText(/Κι αν η νύχτα πέσει βαριά/);
    const range = document.createRange();
    range.selectNodeContents(line);
    const rows = [...range.getClientRects()];
    // Wrapped, so the check below has a continuation to measure.
    await expect(new Set(rows.map((row) => Math.round(row.top))).size).toBeGreaterThan(1);
    const [start, ...continuations] = rows.map((row) => row.left);
    await expect(Math.max(...continuations)).toBeGreaterThan((start ?? 0) + 4);
  },
};

export const NotFound: Story = {
  parameters: { route: "/songs/no-such-song" },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("alert")).toHaveTextContent("Song was not found.");
  },
};

/*
 * A phone, 390×844, in the shell: the thin top bar of Back and the tools, the
 * bottom bar, and the lyrics between them. Before the bottom bar, the search
 * header (73px) and the tools row (68px) stacked above the title, 141px in all.
 */

const LAST_LINE = "Κι ο τελευταίος στίχος";

const longSong = makeSong({
  id: "song-11",
  slug: "makry-tragoydi",
  title: "Μακρύ τραγούδι",
  lyrics: [
    ...Array.from({ length: 60 }, (_, index) => `Στίχος ${index + 1} του τραγουδιού`),
    LAST_LINE,
  ].join("\n"),
});

/** The page in the shell, which draws the bottom bar. */
const inShell: Decorator = (Story) => (
  <Layout>
    <Story />
  </Layout>
);

const onAPhone: Story = {
  parameters: { ...phoneParameters, route: "/songs/makry-tragoydi" },
  globals: phoneGlobals,
  decorators: [inShell],
  beforeEach({ msw }) {
    msw.use(songByRef(longSong));
  },
};

/** The phone's chrome, found by what index.css and the page key on. */
function chrome() {
  const tools = document.querySelector<HTMLElement>(".max-md\\:sticky");
  const bar = document.querySelector<HTMLElement>(".bottom-bar");
  const tabs = document.querySelector<HTMLElement>(".bottom-bar-tabs");
  const pill = document.querySelector<HTMLElement>(".bottom-bar-pill");
  if (!tools || !bar || !tabs || !pill) throw new Error("The phone's chrome is missing.");
  return { tools, bar, tabs, pill };
}

/** Waits out the bars' 200ms slide and fade. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 400));

/**
 * At the top both bars are out; scrolled down, the top bar is gone and the
 * bottom one is its small pill, and the lyrics have more of the screen.
 */
export const PhoneChrome: Story = {
  ...onAPhone,
  play: async ({ canvas }) => {
    await canvas.findByText(LAST_LINE);
    const { tools, bar, tabs, pill } = chrome();

    // No search header: the tools bar is the only bar above the song.
    await expect(canvas.queryByRole("combobox", { name: /search songs/i })).toBeNull();
    const top = tools.getBoundingClientRect();
    await expect(top.top).toBe(0);
    await expect(top.height).toBeLessThanOrEqual(56);
    await expect(within(tools).getByRole("button", { name: "Back" })).toBeVisible();
    await expect(getComputedStyle(tabs).opacity).toBe("1");
    await expect(getComputedStyle(pill).opacity).toBe("0");
    // The room between the bars at the top of the page: more than the old
    // stack above the title left, even with the bottom bar out.
    const atTop = tabs.getBoundingClientRect().top - top.bottom;
    await expect(atTop).toBeGreaterThan(844 - 141);

    window.scrollTo({ top: 600, behavior: "instant" });
    await waitFor(() => expect(bar).toHaveAttribute("data-tucked"));
    await settled();

    await expect(tools.getBoundingClientRect().bottom).toBeLessThanOrEqual(0);
    await expect(getComputedStyle(tabs).opacity).toBe("0");
    await expect(getComputedStyle(pill).opacity).toBe("1");
    await expect(pill).toHaveTextContent("Μακρύ τραγούδι");
    // Everything above the pill is the lyrics'.
    const scrolled = pill.getBoundingClientRect().top;
    // Measured: 733px at the top, 800px scrolled.
    await expect(scrolled).toBeGreaterThan(atTop + 50);
    await expect(scrolled).toBeGreaterThan(844 - 60);

    // Back up, and both return.
    window.scrollTo({ top: 400, behavior: "instant" });
    await waitFor(() => expect(bar).not.toHaveAttribute("data-tucked"));
    await settled();
    await expect(tools.getBoundingClientRect().top).toBe(0);
    await expect(getComputedStyle(tabs).opacity).toBe("1");
  },
};

/** At the very end of the song, the last line scrolls clear of the bar at its full height. */
export const PhoneLastLine: Story = {
  ...onAPhone,
  play: async ({ canvas }) => {
    const last = await canvas.findByText(LAST_LINE);
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" });
    await settled();

    const { bar, pill } = chrome();
    const line = last.getBoundingClientRect();
    // The bar's box is where the expanded tabs sit; the pill sits inside it.
    await expect(line.bottom).toBeLessThanOrEqual(bar.getBoundingClientRect().top);
    await expect(line.bottom).toBeLessThanOrEqual(pill.getBoundingClientRect().top);
  },
};

/** The bar's Search opens a full-screen sheet with the field ready to type in. */
export const PhoneSearch: Story = {
  ...onAPhone,
  play: async ({ canvas }) => {
    await canvas.findByText(LAST_LINE);
    await userEvent.click(canvas.getByRole("button", { name: "Search" }));

    const sheet = await canvas.findByRole("dialog", { name: "Search" });
    await expect(sheet).toBeVisible();
    const field = within(sheet).getByRole("combobox", { name: /search songs/i });
    await waitFor(() => expect(field).toHaveFocus());
    // The field sits at the top, clear of where a keyboard rises.
    await expect(field.getBoundingClientRect().top).toBeLessThan(844 / 4);
  },
};

/** Read from a list: the swipe hint sits above the bottom bar, not under it. */
export const PhoneInAList: Story = {
  parameters: { ...phoneParameters, route: "/songs/frangosyriani?list=list-1" },
  globals: phoneGlobals,
  decorators: [inShell],
  loaders: [() => localStorage.removeItem("lyrics:swipe-hint-seen")],
  beforeEach({ msw }) {
    msw.use(listById(catalogList(3)));
  },
  play: async ({ canvas }) => {
    const hint = await canvas.findByText("Swipe through the list");
    const { bar } = chrome();
    await expect(hint.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      bar.getBoundingClientRect().top,
    );
  },
};
