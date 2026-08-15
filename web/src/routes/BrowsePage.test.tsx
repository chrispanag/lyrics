import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";

import { BrowsePage } from "./BrowsePage";
import { API, list, makeSong, makeUser } from "@/test/handlers";
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
        HttpResponse.json(
          { error: { code: "internal_error", message: "Something went wrong." } },
          { status: 500 },
        ),
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
 * Paging writes `page` into the URL, but the debounced-search effect runs on
 * every param write and clears `page` — so without its guard the two fight and
 * the list snaps straight back to the first page. That failure is silent: the
 * button is enabled, the click is handled, and the same twenty songs come back.
 * Nothing else in the suite renders a second page.
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

    // The regression only shows up once the search effect re-runs off the back
    // of that param write, so the offset has to survive past the 250ms debounce
    // rather than merely be correct on the first render after the click.
    await act(() => new Promise((resolve) => setTimeout(resolve, 500)));
    expect(screen.getByText("Page 2 of 3")).toBeInTheDocument();
    expect(offsets.at(-1)).toBe("20");
  });
});

/*
 * Song pages link every credit to `/?person=<id>`. If browse does not read
 * that parameter the click still "works" — it lands on the unfiltered catalog
 * with no error and no chip, which reads as though the artist appears on every
 * song. Nothing else in the suite covers the wire between the two pages.
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
