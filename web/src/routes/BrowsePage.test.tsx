import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";

import { BrowsePage } from "./BrowsePage";
import type { Genre, ListResponse, Song } from "@/lib/types";
import { API, apiError, list, makeGenre, makeSong, makeUser } from "@/test/handlers";
import { intersectAll } from "@/test/intersection";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

/**
 * Records the parameters each catalog request carried, answering every one
 * with `songs` (an empty catalog by default). `genres`, when given, replaces
 * the catalog's genres too.
 */
function recordRequests({
  songs = list([]),
  genres,
}: {
  songs?: ListResponse<Song>;
  genres?: Genre[];
} = {}) {
  const requests: URLSearchParams[] = [];
  server.use(
    http.get(`${API}/api/v1/songs`, ({ request }) => {
      requests.push(new URL(request.url).searchParams);
      return HttpResponse.json(songs);
    }),
  );
  if (genres) {
    server.use(http.get(`${API}/api/v1/genres`, () => HttpResponse.json(list(genres))));
  }
  return requests;
}

describe("BrowsePage", () => {
  it("lists songs with their credits", async () => {
    renderWithProviders(<BrowsePage />);

    expect(await screen.findByText("Θάλασσα Πλατιά")).toBeInTheDocument();
    expect(screen.getByText("Μίκης Θεοδωράκης")).toBeInTheDocument();
  });

  // Beside the lyrics the pane is a fixed height. The search stays put and the
  // scrollbar belongs to the songs. jsdom has no breakpoint; the classes say it.
  it("scrolls the songs under the search header", async () => {
    renderWithProviders(<BrowsePage />);

    const search = await screen.findByRole("searchbox", { name: /search songs/i });
    const song = await screen.findByRole("link", { name: /Θάλασσα Πλατιά/ });
    let scroller = song.parentElement;
    while (scroller && !scroller.classList.contains("@3xl/app:overflow-y-auto")) {
      scroller = scroller.parentElement;
    }

    expect(scroller).not.toBeNull();
    expect(scroller).not.toContainElement(search);
  });

  it("renders search snippets with the matched term highlighted", async () => {
    server.use(
      http.get(`${API}/api/v1/songs`, () =>
        HttpResponse.json(list([makeSong({ snippet: "Στης ⟦θάλασσας⟧ τα βάθη" })])),
      ),
    );

    renderWithProviders(<BrowsePage />, { route: "/?q=θάλασσα" });

    const mark = await screen.findByText("θάλασσας");
    expect(mark.tagName).toBe("MARK");
  });

  // Search state lives in the URL so a filtered result can be shared and the
  // back button behaves.
  it("puts the typed query into the URL", async () => {
    const user = userEvent.setup();
    const requests = recordRequests();

    renderWithProviders(<BrowsePage />);

    await user.type(screen.getByRole("searchbox", { name: /search songs/i }), "αγάπη");

    await waitFor(() => expect(requests.at(-1)?.get("q")).toBe("αγάπη"), { timeout: 3000 });
  });

  it("shows an empty state when nothing matches", async () => {
    server.use(http.get(`${API}/api/v1/songs`, () => HttpResponse.json(list([]))));

    renderWithProviders(<BrowsePage />, { route: "/?q=nothingmatches" });

    expect(await screen.findByText(/no songs matched/i)).toBeInTheDocument();
  });

  // Filters that match nothing are not an empty catalog, and the way out is
  // offered where the reader is looking.
  it("says filters matched nothing, and clears them on request", async () => {
    const requests = recordRequests();

    renderWithProviders(<BrowsePage />, { route: "/?language=en&genre_slug=laiko&sort=title" });

    expect(await screen.findByRole("heading", { name: /no songs matched/i })).toBeInTheDocument();
    expect(screen.queryByText(/no songs yet/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));

    await waitFor(() => expect(requests.at(-1)?.get("language")).toBeNull());
    expect(requests.at(-1)?.get("genre_slug")).toBeNull();
    // The ordering is a preference, not a filter.
    expect(requests.at(-1)?.get("sort")).toBe("title");
  });

  it("calls an unfiltered, empty catalog empty, with nothing to clear", async () => {
    recordRequests();

    renderWithProviders(<BrowsePage />);

    expect(await screen.findByRole("heading", { name: /no songs yet/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
  });

  it("names a person's page in a visible heading", async () => {
    recordRequests();

    renderWithProviders(<BrowsePage />, { route: "/?person=person-1" });

    const heading = await screen.findByRole("heading", {
      level: 1,
      name: "Songs by Μίκης Θεοδωράκης",
    });
    expect(heading).not.toHaveClass("sr-only");
  });

  // Below the split the plain catalog opens on the site's name, which scrolls
  // away above the search. Decorative: the tab and the pane's h1 name it.
  it("opens the plain catalog on its title page, above the search", async () => {
    recordRequests();

    renderWithProviders(<BrowsePage />, { route: "/" });

    const name = await screen.findByText("Songfolio");
    const masthead = name.closest("[aria-hidden]");
    expect(masthead).toHaveTextContent("Songs and their lyrics, in Greek and English");
    // Before the search in the page, and gone once the panes split.
    expect(masthead?.parentElement).toHaveClass("@3xl/app:hidden");
    expect(masthead?.compareDocumentPosition(screen.getByRole("searchbox")) ?? 0).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it.each([
    ["a search", "/?q=thalassa"],
    ["a filter", "/?language=el"],
    ["a person's page", "/?person=person-1"],
  ])("opens %s on what was asked for, with no title page", async (_, route) => {
    recordRequests();

    renderWithProviders(<BrowsePage />, { route });

    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByText("Songfolio")).not.toBeInTheDocument();
  });

  it("keeps a search's heading for assistive technology only", async () => {
    recordRequests();

    renderWithProviders(<BrowsePage />, { route: "/?q=thalassa" });

    expect(await screen.findByRole("heading", { level: 1, name: "Search: thalassa" })).toHaveClass(
      "sr-only",
    );
  });

  it("surfaces an API failure instead of rendering an empty list", async () => {
    server.use(
      http.get(`${API}/api/v1/songs`, () =>
        apiError(500, "internal_error", "Something went wrong."),
      ),
    );

    renderWithProviders(<BrowsePage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong.");
  });

  // The "Add song" affordance must match what the server would actually allow.
  it("hides the add-song link from users who cannot add songs", async () => {
    renderWithProviders(<BrowsePage />, { user: makeUser({ role: "user" }) });

    await screen.findByText("Θάλασσα Πλατιά");
    expect(screen.queryByRole("link", { name: /add song/i })).not.toBeInTheDocument();
  });

  it("shows the add-song link to contributors", async () => {
    renderWithProviders(<BrowsePage />, { user: makeUser({ role: "contributor" }) });

    expect(await screen.findByRole("link", { name: /add song/i })).toBeInTheDocument();
  });

  // The list stays beside the lyrics, so the song's address has to carry the
  // filters or opening one would show a different list.
  it("keeps the catalog filters on a song it opens", async () => {
    renderWithProviders(<BrowsePage />, { route: "/?q=θάλασσα&language=el" });

    const link = await screen.findByRole("link", { name: /Θάλασσα Πλατιά/ });
    const params = new URLSearchParams(link.getAttribute("href")?.split("?")[1]);

    expect(link.getAttribute("href")).toMatch(/^\/songs\/thalassa-platia\?/);
    expect(params.get("q")).toBe("θάλασσα");
    expect(params.get("language")).toBe("el");
  });
});

/*
 * The picker names the ordering in effect: an absent `sort` falls back to
 * relevance with a query and newest without, and each is offered once.
 */
describe("BrowsePage sort picker", () => {
  const openSortPicker = async () => {
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /filters/i }));
    return screen.getByRole("combobox", { name: "Sort by" }) as HTMLSelectElement;
  };

  it("offers each ordering once and selects the default", async () => {
    renderWithProviders(<BrowsePage />);

    const sort = await openSortPicker();

    expect(
      within(sort)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["Most popular", "Title (A–Z)", "Newest first", "Oldest first"]);
    expect(sort.value).toBe("newest");
  });

  it("offers relevance only while there is something to rank against", async () => {
    renderWithProviders(<BrowsePage />, { route: "/?q=αγάπη" });

    const sort = await openSortPicker();

    expect(
      within(sort)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["Relevance", "Most popular", "Title (A–Z)", "Newest first", "Oldest first"]);
    expect(sort.value).toBe("relevance");
  });

  // Relevance without a query orders by newest, so the picker says newest.
  it("falls back to newest when a cleared search leaves sort=relevance behind", async () => {
    const requests = recordRequests({ songs: list([makeSong()]) });

    renderWithProviders(<BrowsePage />, { route: "/?sort=relevance" });

    const sort = await openSortPicker();

    expect(sort.value).toBe("newest");
    await waitFor(() => expect(requests.at(-1)?.get("sort")).toBe("newest"));
  });
});

/*
 * Song pages link every credit to `/?person=<id>`; unread, the click silently
 * lands on the unfiltered catalog.
 */
describe("BrowsePage artist filter", () => {
  it("passes the person parameter through to the API", async () => {
    const requests = recordRequests({ songs: list([makeSong()]) });

    renderWithProviders(<BrowsePage />, { route: "/?person=person-1" });

    await waitFor(() => expect(requests.at(-1)?.get("person")).toBe("person-1"));
  });

  it("labels the active artist filter with the person's name", async () => {
    server.use(
      // No results, so the only place the name can appear is the chip itself.
      http.get(`${API}/api/v1/songs`, () => HttpResponse.json(list([]))),
    );

    renderWithProviders(<BrowsePage />, { route: "/?person=person-1" });

    // A chip showing a raw UUID would be worse than showing none at all.
    expect(await screen.findByText("Μίκης Θεοδωράκης")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /remove filter/i })).toBeInTheDocument();
  });

  it("returns to the whole catalog when the artist chip is removed", async () => {
    const requests = recordRequests();

    renderWithProviders(<BrowsePage />, { route: "/?person=person-1" });

    // Named first, so the absence below is the chip going rather than never arriving.
    expect(await screen.findByText("Μίκης Θεοδωράκης")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /remove filter/i }));

    await waitFor(() => expect(requests.at(-1)?.get("person")).toBeNull());
    expect(screen.queryByText("Μίκης Θεοδωράκης")).not.toBeInTheDocument();
  });
});

/*
 * The filter button's width is taken from the search field, so a filter count
 * must not change it: the count is a badge on a square `size="icon"` button.
 */
describe("BrowsePage filter button", () => {
  it("keeps its size, and its count, while a filter is active", async () => {
    renderWithProviders(<BrowsePage />, { route: "/?genre_slug=rok&language=el" });

    const button = await screen.findByRole("button", { name: /filters/i });

    // `size="icon"` is unconditional, so one direction is enough.
    expect(button).toHaveClass("size-11");
    // `aria-label` hides the badge, so the name must carry the number.
    expect(button).toHaveAccessibleName("Filters, 2 active");
  });
});

// A link can name a deleted genre; the chip must still render so the filter can
// be cleared. Do not gate it on `activeGenre &&`.
describe("BrowsePage filter chips", () => {
  it("can clear a filter whose genre no longer exists", async () => {
    // The catalog knows nothing of `rok`: the genre behind it is gone.
    server.use(
      http.get(`${API}/api/v1/songs`, () => HttpResponse.json(list([]))),
      http.get(`${API}/api/v1/genres`, () => HttpResponse.json(list([]))),
    );

    renderWithProviders(<BrowsePage />, { route: "/?genre_slug=rok" });

    // Labeled with the slug from the address, there being no name to show.
    expect(await screen.findByText("rok")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Remove filter" }));

    expect(screen.queryByText("rok")).not.toBeInTheDocument();
  });

  it("lifts a language filter from its chip, which names the language", async () => {
    const requests = recordRequests();

    renderWithProviders(<BrowsePage />, { route: "/?language=en" });

    // "English", not the code from the address.
    expect(await screen.findByText("English")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Remove filter" }));

    await waitFor(() => expect(requests.at(-1)?.get("language")).toBeNull());
    expect(screen.queryByText("English")).not.toBeInTheDocument();
  });
});

/*
 * Clearing the box must drop `q`, not leave an empty `q=` behind: the title,
 * the sort default and the empty state all read whether there is a query.
 */
describe("BrowsePage clearing a search", () => {
  it("returns to the unfiltered catalog when the search box is emptied", async () => {
    const user = userEvent.setup();
    const requests = recordRequests();

    renderWithProviders(<BrowsePage />, { route: "/?q=αγάπη" });

    expect(await screen.findByText(/no songs matched/i)).toBeInTheDocument();

    await user.clear(screen.getByRole("searchbox", { name: /search songs/i }));

    // The catalog's own empty state, not the search's.
    expect(await screen.findByText(/no songs yet/i, {}, { timeout: 3000 })).toBeInTheDocument();
    await waitFor(() => expect(requests.at(-1)?.get("q")).toBeNull());
  });
});

/** The `n`th song of a catalog, distinct in id, slug and title. */
const nthSong = (n: number) => makeSong({ id: `song-${n}`, slug: `song-${n}`, title: `Song ${n}` });

/**
 * A catalog of `total` songs served a page at a time by offset, recording each
 * request's offset. `failAt` answers that offset with an error once.
 */
function serveCatalogOf(total: number, { failAt }: { failAt?: number } = {}) {
  const offsets: string[] = [];
  let failed = false;
  server.use(
    http.get(`${API}/api/v1/songs`, ({ request }) => {
      const params = new URL(request.url).searchParams;
      const offset = Number(params.get("offset") ?? "0");
      const limit = Number(params.get("limit") ?? "20");
      offsets.push(String(offset));
      if (offset === failAt && !failed) {
        failed = true;
        return apiError(500, "internal_error", "Something went wrong.");
      }
      const songs = Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_, i) =>
        nthSong(offset + i + 1),
      );
      return HttpResponse.json(list(songs, { total, limit, offset }));
    }),
  );
  return offsets;
}

describe("BrowsePage infinite scrolling", () => {
  it("loads the next songs as the end of the list comes into view, until there are none", async () => {
    const offsets = serveCatalogOf(25);

    renderWithProviders(<BrowsePage />);

    expect(await screen.findByText("Song 20")).toBeInTheDocument();
    expect(screen.queryByText("Song 21")).not.toBeInTheDocument();
    expect(screen.getByText("25 songs")).toBeInTheDocument();

    act(() => intersectAll());

    expect(await screen.findByText("Song 25")).toBeInTheDocument();
    // Page one stays: the list grows rather than turning over.
    expect(screen.getByText("Song 1")).toBeInTheDocument();
    expect(offsets).toEqual(["0", "20"]);

    // Nothing left, so nothing is watching for the end.
    act(() => intersectAll());
    expect(offsets).toEqual(["0", "20"]);
  });

  // Never by scrolling alone: a failing API would be asked on every pixel.
  it("says when more songs could not load, and tries again when asked", async () => {
    const user = userEvent.setup();
    const offsets = serveCatalogOf(25, { failAt: 20 });

    renderWithProviders(<BrowsePage />);
    await screen.findByText("Song 20");
    act(() => intersectAll());

    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong.");
    // The songs already shown stay.
    expect(screen.getByText("Song 1")).toBeInTheDocument();
    act(() => intersectAll());
    expect(offsets).toEqual(["0", "20"]);

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Song 25")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("starts a new search from its first songs", async () => {
    const user = userEvent.setup();
    const offsets = serveCatalogOf(45);

    renderWithProviders(<BrowsePage />);
    await screen.findByText("Song 20");
    act(() => intersectAll());
    await screen.findByText("Song 40");

    await user.type(screen.getByRole("searchbox", { name: /search songs/i }), "αγάπη");

    await waitFor(() => expect(offsets).toEqual(["0", "20", "0"]), { timeout: 3000 });
  });
});

/* The sheet writes every choice to the URL, so a filtered view can be shared. */
describe("BrowsePage filter sheet", () => {
  /** A catalog with two genres for the sheet to offer. */
  const recordSheetRequests = () =>
    recordRequests({
      songs: list([makeSong()]),
      genres: [
        makeGenre({ id: "genre-1", name: "Ρεμπέτικο", slug: "rempetiko", song_count: 12 }),
        makeGenre({ id: "genre-2", name: "Έντεχνο", slug: "entechno", song_count: 3 }),
      ],
    });

  const openFilters = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(await screen.findByRole("button", { name: /filters/i }));
    return screen.getByRole("dialog", { name: "Filters" });
  };

  it("filters by a genre, and a second press on it lifts the filter", async () => {
    const user = userEvent.setup();
    const requests = recordSheetRequests();

    renderWithProviders(<BrowsePage />);
    const sheet = await openFilters(user);

    const genre = await within(sheet).findByRole("button", { name: /Ρεμπέτικο/ });
    expect(genre).toHaveAttribute("aria-pressed", "false");
    await user.click(genre);

    await waitFor(() => expect(requests.at(-1)?.get("genre_slug")).toBe("rempetiko"));
    expect(screen.getByRole("button", { name: "Filters, 1 active" })).toBeInTheDocument();
    expect(genre).toHaveAttribute("aria-pressed", "true");

    await user.click(genre);

    await waitFor(() => expect(requests.at(-1)?.has("genre_slug")).toBe(false));
    expect(screen.getByRole("button", { name: "Filters" })).toBeInTheDocument();
  });

  it("filters by language, and 'Any language' lifts it rather than sending it empty", async () => {
    const user = userEvent.setup();
    const requests = recordSheetRequests();

    renderWithProviders(<BrowsePage />);
    const sheet = await openFilters(user);
    const language = within(sheet).getByRole("combobox", { name: "Language" });

    await user.selectOptions(language, "el");
    await waitFor(() => expect(requests.at(-1)?.get("language")).toBe("el"));

    await user.selectOptions(language, "");
    await waitFor(() => expect(requests.at(-1)?.has("language")).toBe(false));
  });

  it("puts the chosen ordering into the request", async () => {
    const user = userEvent.setup();
    const requests = recordSheetRequests();

    renderWithProviders(<BrowsePage />);
    const sheet = await openFilters(user);

    await user.selectOptions(within(sheet).getByRole("combobox", { name: "Sort by" }), "title");

    await waitFor(() => expect(requests.at(-1)?.get("sort")).toBe("title"));
  });

  it("can order the catalog by popularity", async () => {
    const user = userEvent.setup();
    const requests = recordSheetRequests();

    renderWithProviders(<BrowsePage />);
    const sheet = await openFilters(user);

    await user.selectOptions(
      within(sheet).getByRole("combobox", { name: "Sort by" }),
      "popularity",
    );

    await waitFor(() => expect(requests.at(-1)?.get("sort")).toBe("popularity"));
  });

  // A key the badge counts but "Clear all" misses leaves a badge that nothing
  // in the sheet can clear.
  it("clears every filter and the ordering, and keeps the search", async () => {
    const user = userEvent.setup();
    const requests = recordSheetRequests();

    renderWithProviders(<BrowsePage />, {
      route: "/?q=αγάπη&person=person-1&genre_slug=rempetiko&language=el&sort=title",
    });
    const sheet = await openFilters(user);

    await user.click(within(sheet).getByRole("button", { name: "Clear all" }));

    await waitFor(() => {
      const last = requests.at(-1);
      expect(last?.get("q")).toBe("αγάπη");
      expect(last?.has("person")).toBe(false);
      expect(last?.has("genre_slug")).toBe(false);
      expect(last?.has("language")).toBe(false);
      // The default with a query, now the chosen ordering is gone.
      expect(last?.get("sort")).toBe("relevance");
    });
    expect(screen.getByRole("button", { name: "Filters" })).toBeInTheDocument();
  });
});
