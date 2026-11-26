import type { Decorator, Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http } from "msw";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { SongDetailPage } from "./SongDetailPage";
import { SongsPane } from "./SongsPane";
import { Layout } from "@/components/Layout";
import { ReaderSplit } from "@/components/ReaderSplit";
import { applyNavCollapsed, storeNavCollapsed } from "@/lib/navCollapsed";
import { catalogList, catalogSongs, entechno } from "@/test/catalog";
import {
  API,
  list,
  listById,
  makePopularity,
  makeRecording,
  makeSong,
  makeUser,
  songByRef,
} from "@/test/handlers";
import { deskViewport, phoneGlobals, phoneParameters } from "@/test/viewport";

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
  const tools = document.querySelector<HTMLElement>('[data-sticky-header="phone"]');
  const bar = document.querySelector<HTMLElement>(".bottom-bar");
  const tabs = document.querySelector<HTMLElement>(".bottom-bar-tabs");
  const row = document.querySelector<HTMLElement>(".bottom-bar-row");
  const pill = document.querySelector<HTMLElement>(".bottom-bar-pill");
  if (!tools || !bar || !tabs || !row || !pill) throw new Error("The phone's chrome is missing.");
  return { tools, bar, tabs, row, pill };
}

/**
 * Waits for `bar` to publish its height as `--sticky-header-height`, which it
 * does from a ResizeObserver: before the browser paints, so a reader never
 * sees it missing, but after React commits, so a story measuring at once can.
 */
const published = (bar: HTMLElement) =>
  waitFor(() =>
    expect(document.documentElement.style.getPropertyValue("--sticky-header-height")).toBe(
      `${bar.offsetHeight}px`,
    ),
  );

/** Scrolls far enough down that the chrome tucks away, and waits it out. */
async function tuck() {
  window.scrollTo({ top: 600, behavior: "instant" });
  await waitFor(() => expect(document.documentElement).toHaveAttribute("data-chrome-tucked"));
  await settled();
}

/**
 * Waits out the bars' slide and fades: `--duration-chrome` (250ms), and the
 * shrunk surface's 80ms fade after it.
 */
const settled = () => new Promise((resolve) => setTimeout(resolve, 400));

/**
 * At the top both bars are out; scrolled down, the top bar is gone and the
 * bottom one is its small pill, and the lyrics have more of the screen.
 */
export const PhoneChrome: Story = {
  ...onAPhone,
  play: async ({ canvas }) => {
    await canvas.findByText(LAST_LINE);
    const { tools, tabs, row, pill } = chrome();

    // No search header: the tools bar is the only bar above the song.
    await expect(canvas.queryByRole("combobox", { name: /search songs/i })).toBeNull();
    const top = tools.getBoundingClientRect();
    await expect(top.top).toBe(0);
    await expect(top.height).toBeLessThanOrEqual(56);
    await expect(within(tools).getByRole("button", { name: "Back" })).toBeVisible();
    // The only bar above the song publishes its height, so a control reached
    // by Tab scrolls clear of it.
    await published(tools);
    await expect(getComputedStyle(row).opacity).toBe("1");
    await expect(getComputedStyle(pill).opacity).toBe("0");
    // The room between the bars at the top of the page: more than the old
    // stack above the title left, even with the bottom bar out.
    const atTop = tabs.getBoundingClientRect().top - top.bottom;
    await expect(atTop).toBeGreaterThan(844 - 141);
    const classes = [tools.className, tabs.className];

    // A little way down, the bottom bar is partway to the pill, as far as the
    // scroll has taken it: 20px down is half its 40px.
    // A finger held on the screen keeps it there.
    window.dispatchEvent(new Event("touchstart"));
    window.scrollTo({ top: 20, behavior: "instant" });
    await waitFor(() => expect(chrome().bar).toHaveAttribute("data-chrome-scrubbing"));
    // Following the scroll on a short ease, so once that has run.
    await waitFor(() => {
      const [sx] = getComputedStyle(tabs).scale.split(" ").map(Number);
      expect(sx).toBeGreaterThan(0.4);
      expect(sx).toBeLessThan(0.9);
      // And the tools bar partway out of sight with it, by half its height.
      const slid = tools.getBoundingClientRect();
      expect(slid.top).toBeCloseTo(-slid.height / 2, 0);
    });
    window.dispatchEvent(new Event("touchend"));

    await tuck();

    // Drawn from the attribute on <html>: the page rendered nothing for it.
    await expect([tools.className, tabs.className]).toEqual(classes);
    await expect(tools.getBoundingClientRect().bottom).toBeLessThanOrEqual(0);
    await expect(getComputedStyle(row).opacity).toBe("0");
    await expect(getComputedStyle(pill).opacity).toBe("1");
    await expect(pill).toHaveTextContent("Μακρύ τραγούδι");
    // Everything above the pill's surface is the lyrics': its hit area
    // reaches higher, but draws nothing there.
    const scrolled = tabs.getBoundingClientRect().top;
    // Measured: 733px at the top, 812px scrolled (800 with the 36px pill).
    await expect(scrolled).toBeGreaterThan(atTop + 50);
    await expect(scrolled).toBeGreaterThanOrEqual(805);

    // Back up, and both return. The tabs take no presses until they start to
    // show, so a second tap on the pill cannot land on one unseen.
    window.scrollTo({ top: 400, behavior: "instant" });
    await waitFor(() => expect(document.documentElement).not.toHaveAttribute("data-chrome-tucked"));
    await expect(getComputedStyle(row).pointerEvents).toBe("none");
    await settled();
    await expect(tools.getBoundingClientRect().top).toBe(0);
    await expect(getComputedStyle(row).opacity).toBe("1");
    await expect(getComputedStyle(row).pointerEvents).toBe("auto");
  },
};

/**
 * Scrolled down, left there so the axe check sees the pill over the lyrics in
 * both themes. The tabs' own surface shrinks to the pill, whose face then
 * draws its own; thin, but a full thumb's height to press, with a chevron
 * saying it opens.
 */
export const PhonePill: Story = {
  ...onAPhone,
  play: async ({ canvas }) => {
    await canvas.findByText(LAST_LINE);
    const { tabs, pill } = chrome();
    await expect(getComputedStyle(tabs).scale).toBe("1");

    await tuck();

    // The same surface, shrunk where it stood; at rest it has faded under the
    // face's own, drawn at full size.
    await expect(chrome().tabs).toBe(tabs);
    await expect(getComputedStyle(tabs).scale).not.toBe("1");
    await expect(getComputedStyle(tabs).opacity).toBe("0");
    const surface = tabs.getBoundingClientRect();
    // Measured: 24px.
    await expect(surface.height).toBeGreaterThanOrEqual(22);
    await expect(surface.height).toBeLessThanOrEqual(26);
    // On the pill's words, which it frames.
    const face = pill.querySelector<HTMLElement>(".bottom-bar-pill-face");
    if (!face) throw new Error("The pill has no face.");
    const words = face.getBoundingClientRect();
    await expect(Math.abs(words.top - surface.top)).toBeLessThan(1);
    await expect(Math.abs(words.width - surface.width)).toBeLessThan(1);
    await expect(getComputedStyle(face).borderTopWidth).toBe("1px");
    await expect(getComputedStyle(face).boxShadow).not.toBe("none");

    // A thumb's height to press, the surface inside it.
    const target = pill.getBoundingClientRect();
    await expect(target.height).toBeGreaterThanOrEqual(44);
    await expect(target.top).toBeLessThanOrEqual(surface.top);
    await expect(target.bottom).toBeGreaterThanOrEqual(surface.bottom);
    await expect(pill.querySelector("svg.lucide-chevron-up")).not.toBeNull();

    // A press at the top of the hit area, above the surface, opens the bar.
    const above = document.elementFromPoint(target.left + target.width / 2, target.top + 2);
    await expect(pill.contains(above)).toBe(true);
  },
};

/**
 * The settle at rest is a transition on each bar's `--chrome-progress`
 * (`chrome-follows`), which the bottom bar's scale and fades and the top bar's
 * slide are drawn from, and only where motion is welcome: under reduced
 * motion the bars change at once. The test browser cannot be put in reduced
 * motion from a story, so this reads the style sheet: every rule that
 * transitions a bar's progress sits in a
 * `prefers-reduced-motion: no-preference` block.
 */
export const PhoneMorphMotion: Story = {
  ...onAPhone,
  play: async ({ canvas }) => {
    await canvas.findByText(LAST_LINE);
    const { bar, tools } = chrome();
    if (matchMedia("(prefers-reduced-motion: no-preference)").matches) {
      for (const eased of [bar, tools]) {
        await expect(getComputedStyle(eased).transitionProperty.split(", ")).toContain(
          "--chrome-progress",
        );
      }
      // Following the scroll is eased too, briefly: drawn as is, a flick
      // popped the bars from one end to the other.
      bar.setAttribute("data-chrome-scrubbing", "");
      try {
        await expect(getComputedStyle(bar).transitionDuration).toBe("0.1s");
      } finally {
        bar.removeAttribute("data-chrome-scrubbing");
      }
    }

    const transitions: { media: string[] }[] = [];
    // A part that asks for its bar's progress with `inherit` is left behind
    // by WebKit (index.css, `chrome-follows`); Chromium draws it right, so
    // only the style sheet shows the mistake here.
    const inheritsProgress: string[] = [];
    const walk = (rules: CSSRuleList, media: string[]) => {
      for (const rule of Array.from(rules)) {
        if (rule instanceof CSSMediaRule) walk(rule.cssRules, [...media, rule.conditionText]);
        else if (rule instanceof CSSStyleRule) {
          if (rule.selectorText.includes("chrome-follows") && rule.style.transition) {
            transitions.push({ media });
          }
          if (rule.style.getPropertyValue("--chrome-progress").trim() === "inherit") {
            inheritsProgress.push(rule.selectorText);
          }
          if (rule.cssRules.length > 0) walk(rule.cssRules, media);
        } else if ("cssRules" in rule) walk((rule as CSSGroupingRule).cssRules, media);
      }
    };
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        walk(sheet.cssRules, []);
      } catch {
        // A cross-origin sheet (a font's) cannot be read, and is not ours.
      }
    }
    await expect(inheritsProgress).toEqual([]);
    await expect(transitions.length).toBeGreaterThan(0);
    for (const { media } of transitions) {
      await expect(
        media.some((query) => query.includes("prefers-reduced-motion: no-preference")),
      ).toBe(true);
    }
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

/*
 * A desk, in the shell with the catalog beside the song, as the reader route
 * lays them out. The song's own pane decides the tier, not the window: the
 * navigation column and the list take their share first.
 */

/** The shell, and the catalog and the song side by side in it. */
const besideTheList: Decorator = (Story) => (
  <Layout>
    <ReaderSplit catalog={<SongsPane />}>
      <Story />
    </ReaderSplit>
  </Layout>
);

/** Documented, and long enough to scroll: what the details column is for. */
const wideSong = makeSong({
  ...documented,
  id: "song-12",
  slug: "megalo-tragoydi",
  title: "Μεγάλο τραγούδι",
  lyrics: longSong.lyrics ?? "",
  popularity: makePopularity({
    anonymous_clicks: 120,
    authenticated_clicks: 4,
    list_adds: 7,
    list_users: 5,
  }),
});

/**
 * `wideSong` beside the list, in a desk window of the given size with the
 * navigation open or put away, which is put back open after.
 */
function atADesk(width: number, height: number, navCollapsed: boolean): Story {
  const desk = deskViewport(width, height);
  return {
    parameters: { ...desk.parameters, route: "/songs/megalo-tragoydi" },
    globals: desk.globals,
    decorators: [besideTheList],
    beforeEach({ msw }) {
      msw.use(
        songByRef(wideSong),
        http.get(`${API}/api/v1/songs`, () => HttpResponse.json(list(catalogSongs))),
      );
      storeNavCollapsed(navCollapsed);
      applyNavCollapsed(navCollapsed);
      return () => {
        storeNavCollapsed(false);
        applyNavCollapsed(false);
      };
    },
  };
}

/** Waits for the whole song, then finds the parts the desk stories measure. */
async function songParts(canvas: ReturnType<typeof within>) {
  await canvas.findByText(LAST_LINE);
  return {
    details: canvas.getByRole("complementary", { name: "Song details" }),
    lyrics: canvas.getByRole("region", { name: "Lyrics" }),
    title: canvas.getByRole("heading", { level: 1, name: "Μεγάλο τραγούδι" }),
  };
}

/** The lyrics' own scroller: the first ancestor that scrolls. */
function scrollerOf(element: HTMLElement): HTMLElement {
  let node = element.parentElement;
  while (node && getComputedStyle(node).overflowY !== "auto") node = node.parentElement;
  if (!node) throw new Error("The lyrics have no scroller.");
  return node;
}

/**
 * The pane's left and right edges as the content sees them: the lyrics'
 * scroller less its scrollbar, which a window that always shows one draws
 * between the details column and the pane's edge.
 */
function paneEdges(lyrics: HTMLElement): { left: number; right: number } {
  const scroller = scrollerOf(lyrics);
  const left = scroller.getBoundingClientRect().left + scroller.clientLeft;
  return { left, right: left + scroller.clientWidth };
}

/**
 * 1440×900 with the navigation open: the song's pane is 51rem, past `@3xl`,
 * so the details sit in a sticky column beside the lyrics, which start right
 * under the title. The recordings and tallies are shown in place, so the
 * buttons for their sheets are put away.
 */
export const WideDetailsColumn: Story = {
  ...atADesk(1440, 900, false),
  play: async ({ canvas }) => {
    const { details, lyrics, title } = await songParts(canvas);
    // The column's height takes off the catalog header's (`published`): under
    // load the song can render first, and the column is then the header's
    // height too tall for the pane. The catalog's is the one
    // <header> that publishes: the song's own <header> does not, and its
    // tools bar is a <div>.
    const header = document.querySelector<HTMLElement>("header[data-sticky-header]");
    if (!header) throw new Error("The catalog's header is missing.");
    await published(header);

    // Beside, not above: the lyrics against the pane's left edge, the column
    // against its right, not a pair centered in it.
    await expect(details.getBoundingClientRect().left).toBeGreaterThan(
      lyrics.getBoundingClientRect().right,
    );
    const pane = paneEdges(lyrics);
    await expect(lyrics.getBoundingClientRect().left - pane.left).toBeLessThanOrEqual(24);
    await expect(pane.right - details.getBoundingClientRect().right).toBeLessThanOrEqual(24);
    // The lyrics start under the title, not under the credits.
    const gap = lyrics.getBoundingClientRect().top - title.getBoundingClientRect().bottom;
    await expect(gap).toBeGreaterThanOrEqual(0);
    await expect(gap).toBeLessThan(40);

    // A rule on its left, the length of the pane however little it holds.
    await expect(getComputedStyle(details).borderLeftWidth).toBe("1px");
    // No longer than the pane either, or it would run past its bottom.
    const reading = scrollerOf(lyrics).getBoundingClientRect();
    const below = reading.bottom - details.getBoundingClientRect().bottom;
    await expect(below).toBeGreaterThanOrEqual(0);
    await expect(below).toBeLessThanOrEqual(24);

    // Every block under a heading.
    for (const name of ["Credits", "Video", "Recordings", "Stats"]) {
      await expect(within(details).getByRole("heading", { level: 2, name })).toBeVisible();
    }
    await expect(within(details).getByRole("region", { name: "Recordings" })).toBeVisible();
    await expect(within(details).getByText("Χάρις Αλεξίου")).toBeVisible();
    const stats = within(details).getByRole("region", { name: "Stats" });
    await expect(stats).toBeVisible();
    await expect(within(stats).getByText("Views").closest("div")).toHaveTextContent("124");
    await expect(within(details).getByRole("button", { name: "Play video" })).toBeVisible();

    // What the column replaces is put away, out of the accessibility tree too.
    // The only Stats left is the column's heading; the recordings' own watch
    // links stay, but not the one under the lyrics.
    await expect(canvas.queryByRole("button", { name: "Stats" })).toBeNull();
    await expect(canvas.queryByRole("button", { name: /show all/i })).toBeNull();
    for (const link of canvas.getAllByRole("link", { name: /watch on youtube/i })) {
      await expect(details).toContainElement(link);
    }

    // Sticky: the lyrics scroll away under it, and it stays where it was.
    const scroller = scrollerOf(lyrics);
    const before = details.getBoundingClientRect().top;
    scroller.scrollTo({ top: 800, behavior: "instant" });
    await waitFor(() =>
      expect(title.getBoundingClientRect().bottom).toBeLessThan(
        scroller.getBoundingClientRect().top,
      ),
    );
    const after = details.getBoundingClientRect();
    await expect(Math.abs(after.top - before)).toBeLessThanOrEqual(1);
    await expect(after.bottom).toBeLessThanOrEqual(window.innerHeight);
    await expect(within(details).getByRole("region", { name: "Stats" })).toBeVisible();
  },
};

/**
 * 1920×1080 with the navigation put away: the song's pane is 96rem, far wider
 * than the lyrics and the column need. The lyrics keep to the pane's left edge
 * at 40rem, the column to its right, and the room left over is between them,
 * not around a centered pair.
 */
export const WideDetailsColumnFullWidth: Story = {
  ...atADesk(1920, 1080, true),
  play: async ({ canvas }) => {
    const { details, lyrics } = await songParts(canvas);
    const article = canvas.getByRole("article");
    // The navigation slides shut once the shell has read the stored choice.
    await waitFor(() => expect(article.getBoundingClientRect().left).toBe(384));
    const pane = paneEdges(lyrics);
    const column = lyrics.getBoundingClientRect();
    const aside = details.getBoundingClientRect();

    // Past the 64rem a centered pair would have been held to.
    await expect(pane.right - pane.left).toBeGreaterThan(1024);
    await expect(Math.abs(column.width - 640)).toBeLessThanOrEqual(1);
    await expect(column.left - pane.left).toBeLessThanOrEqual(24);
    await expect(pane.right - aside.right).toBeLessThanOrEqual(24);
    await expect(aside.left - column.right).toBeGreaterThan(32);
  },
};

/**
 * 1100×900 with the navigation put away: the song's pane is about 45rem, too
 * narrow for the column but wider than a comfortable line, so the title and
 * the lyrics share one 40rem column centered in the pane, the details above
 * the lyrics as on a phone.
 */
export const CenteredColumn: Story = {
  ...atADesk(1100, 900, true),
  play: async ({ canvas }) => {
    const { details, lyrics, title } = await songParts(canvas);
    const article = canvas.getByRole("article");
    // The navigation slides shut once the shell has read the stored choice;
    // the pane has its width once the list is the wider one beside it.
    await waitFor(() => expect(article.getBoundingClientRect().left).toBe(384));
    const pane = article.getBoundingClientRect();
    const column = lyrics.getBoundingClientRect();

    // About 40rem, and as far from either edge of the pane.
    await expect(Math.abs(column.width - 640)).toBeLessThanOrEqual(1);
    await expect(pane.width).toBeGreaterThan(column.width + 32);
    await expect(
      Math.abs(column.left - pane.left - (pane.right - column.right)),
    ).toBeLessThanOrEqual(16);
    // The title on the same column.
    await expect(Math.abs(title.getBoundingClientRect().left - column.left)).toBeLessThanOrEqual(1);

    // No column beside it: the details sit above the lyrics, and its own
    // block, and the player, are not drawn.
    await expect(details.getBoundingClientRect().bottom).toBeLessThanOrEqual(column.top);
    await expect(within(details).queryByRole("region", { name: "Recordings" })).toBeNull();
    await expect(within(details).queryByRole("region", { name: "Stats" })).toBeNull();
    await expect(canvas.queryByRole("button", { name: "Play video" })).toBeNull();
    await expect(canvas.getByRole("button", { name: "Stats" })).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Show all 2 recordings" })).toBeVisible();
  },
};
