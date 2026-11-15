import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";

import { BrowsePage } from "./BrowsePage";
import { API, apiError, list, makeSong, makeUser } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

describe("BrowsePage", () => {
  it("lists songs with their credits", async () => {
    renderWithProviders(<BrowsePage />);

    expect(await screen.findByText("Θάλασσα Πλατιά")).toBeInTheDocument();
    expect(screen.getByText("Μίκης Θεοδωράκης")).toBeInTheDocument();
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
    let requestedQuery: string | null = null;

    server.use(
      http.get(`${API}/api/v1/songs`, ({ request }) => {
        requestedQuery = new URL(request.url).searchParams.get("q");
        return HttpResponse.json(list([]));
      }),
    );

    renderWithProviders(<BrowsePage />);

    await user.type(screen.getByRole("searchbox", { name: /search songs/i }), "αγάπη");

    await waitFor(() => expect(requestedQuery).toBe("αγάπη"), { timeout: 3000 });
  });

  it("shows an empty state when nothing matches", async () => {
    server.use(
      http.get(`${API}/api/v1/songs`, () =>
        HttpResponse.json(list([])),
      ),
    );

    renderWithProviders(<BrowsePage />, { route: "/?q=nothingmatches" });

    expect(await screen.findByText(/no songs matched/i)).toBeInTheDocument();
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
});

/*
 * The debounced-search effect re-runs on every param write; without its guard
 * it clears `page` and the list silently snaps back to the first page.
 */
describe("BrowsePage pagination", () => {
  it("advances to the next page and stays there", async () => {
    const user = userEvent.setup();
    const offsets: string[] = [];

    server.use(
      http.get(`${API}/api/v1/songs`, ({ request }) => {
        offsets.push(new URL(request.url).searchParams.get("offset") ?? "0");
        // Three pages' worth of results behind a single page of rows.
        return HttpResponse.json(list([makeSong()], { total: 45 }));
      }),
    );

    renderWithProviders(<BrowsePage />);

    await user.click(await screen.findByRole("button", { name: /next/i }));

    expect(await screen.findByText("Page 2 of 3")).toBeInTheDocument();
    await waitFor(() => expect(offsets.at(-1)).toBe("20"));

    // The offset has to survive past the debounce, not just the first render.
    await act(() => new Promise((resolve) => setTimeout(resolve, 500)));
    expect(screen.getByText("Page 2 of 3")).toBeInTheDocument();
    expect(offsets.at(-1)).toBe("20");
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

    expect(within(sort).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Title (A–Z)",
      "Newest first",
      "Oldest first",
    ]);
    expect(sort.value).toBe("newest");
  });

  it("offers relevance only while there is something to rank against", async () => {
    renderWithProviders(<BrowsePage />, { route: "/?q=αγάπη" });

    const sort = await openSortPicker();

    expect(within(sort).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Relevance",
      "Title (A–Z)",
      "Newest first",
      "Oldest first",
    ]);
    expect(sort.value).toBe("relevance");
  });

  // Relevance without a query orders by newest, so the picker says newest.
  it("falls back to newest when a cleared search leaves sort=relevance behind", async () => {
    let requestedSort: string | null = null;

    server.use(
      http.get(`${API}/api/v1/songs`, ({ request }) => {
        requestedSort = new URL(request.url).searchParams.get("sort");
        return HttpResponse.json(list([makeSong()]));
      }),
    );

    renderWithProviders(<BrowsePage />, { route: "/?sort=relevance" });

    const sort = await openSortPicker();

    expect(sort.value).toBe("newest");
    await waitFor(() => expect(requestedSort).toBe("newest"));
  });
});

/*
 * Song pages link every credit to `/?person=<id>`; unread, the click silently
 * lands on the unfiltered catalog.
 */
describe("BrowsePage artist filter", () => {
  it("passes the person parameter through to the API", async () => {
    let requestedPerson: string | null = null;

    server.use(
      http.get(`${API}/api/v1/songs`, ({ request }) => {
        requestedPerson = new URL(request.url).searchParams.get("person");
        return HttpResponse.json(list([makeSong()]));
      }),
    );

    renderWithProviders(<BrowsePage />, { route: "/?person=person-1" });

    await waitFor(() => expect(requestedPerson).toBe("person-1"));
  });

  it("labels the active artist filter with the person's name", async () => {
    server.use(
      // No results, so the only place the name can appear is the chip itself.
      http.get(`${API}/api/v1/songs`, () =>
        HttpResponse.json(list([])),
      ),
    );

    renderWithProviders(<BrowsePage />, { route: "/?person=person-1" });

    // A chip showing a raw UUID would be worse than showing none at all.
    expect(await screen.findByText("Μίκης Θεοδωράκης")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /remove filter/i })).toBeInTheDocument();
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
    expect(button).toHaveAccessibleName("Filters (2 active)");
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
});
