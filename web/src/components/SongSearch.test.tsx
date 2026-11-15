import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { createPath, useLocation } from "react-router-dom";

import { SongSearch } from "./SongSearch";
import { API, apiError, list, makeSong } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";
import { useNavigate } from "@/lib/navigation";
import type { Song } from "@/lib/types";

/** The current address, serialized by `createPath` so nothing is dropped. */
function Address() {
  return <p>Now at {createPath(useLocation())}</p>;
}

/**
 * The box, with the address beside it. No `<Routes>`: the box stays mounted
 * across a jump, as on the real page, so the reset on navigation is observable.
 */
function renderSearch(route: string | string[] = "/songs/song-1") {
  return renderWithProviders(
    <>
      <SongSearch />
      <Address />
      {/* Somewhere for focus to go that is not the box. */}
      <button type="button">Elsewhere</button>
      <Back />
    </>,
    { route },
  );
}

/** The back gesture, as a press: what the reader's next Back would actually do. */
function Back() {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(-1)}>
      Back
    </button>
  );
}

const matches = [
  makeSong({ id: "song-2", slug: "to-tragoydi-tis-limnis", title: "Το Τραγούδι της Λίμνης" }),
  makeSong({ id: "song-3", slug: "aspro-poykamiso", title: "Άσπρο Πουκάμισο" }),
];

/** Two more, for the spec that needs a panel to shrink from four rows to two. */
const more = [
  makeSong({ id: "song-4", slug: "tragoydi-tetarto", title: "Τραγούδι Τέταρτο" }),
  makeSong({ id: "song-5", slug: "tragoydi-pempto", title: "Τραγούδι Πέμπτο" }),
];

/**
 * What the catalog answers a search with. `total` is passed only when given:
 * `{ total: undefined }` would overwrite `list()`'s own count.
 */
function searchAnswers(songs: Song[], total?: number) {
  server.use(
    http.get(`${API}/api/v1/songs`, () =>
      HttpResponse.json(list(songs, total === undefined ? {} : { total })),
    ),
  );
}

const box = () => screen.getByRole("combobox", { name: /search songs/i });

describe("SongSearch", () => {
  it("offers matches as they are typed and opens the one that is pressed", async () => {
    const user = userEvent.setup();
    searchAnswers(matches);

    renderSearch();
    await user.type(box(), "τραγ");

    await user.click(await screen.findByRole("option", { name: /Λίμνης/ }));

    expect(screen.getByText("Now at /songs/to-tragoydi-tis-limnis")).toBeInTheDocument();
    // And the box is emptied behind it.
    expect(box()).toHaveValue("");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("opens the first match on Enter, without one having to be chosen", async () => {
    const user = userEvent.setup();
    searchAnswers(matches);

    renderSearch();
    await user.type(box(), "τραγ");
    await screen.findByRole("option", { name: /Λίμνης/ });

    await user.keyboard("{Enter}");

    expect(screen.getByText("Now at /songs/to-tragoydi-tis-limnis")).toBeInTheDocument();
  });

  it("moves the highlight with the arrow keys and opens the highlighted song", async () => {
    const user = userEvent.setup();
    searchAnswers(matches);

    renderSearch();
    await user.type(box(), "τραγ");
    await screen.findByRole("option", { name: /Λίμνης/ });

    await user.keyboard("{ArrowDown}{ArrowDown}");

    const second = screen.getByRole("option", { name: /Πουκάμισο/ });
    expect(second).toHaveAttribute("aria-selected", "true");
    // Focus stays in the field, keeping the page's arrow-key paging out of it.
    expect(box()).toHaveFocus();
    expect(box()).toHaveAttribute("aria-activedescendant", second.id);

    await user.keyboard("{Enter}");

    expect(screen.getByText("Now at /songs/aspro-poykamiso")).toBeInTheDocument();
  });

  it("takes a query that matched nothing to the catalog", async () => {
    const user = userEvent.setup();
    searchAnswers([]);

    renderSearch();
    await user.type(box(), "zzz");
    expect(await screen.findByText(/No songs matched/)).toBeInTheDocument();

    await user.keyboard("{Enter}");

    expect(screen.getByText("Now at /?q=zzz")).toBeInTheDocument();
  });

  it("says a search failed rather than saying nothing matched", async () => {
    const user = userEvent.setup();
    server.use(http.get(`${API}/api/v1/songs`, () => apiError(500, "internal", "boom")));

    renderSearch();
    await user.type(box(), "τραγ");

    expect(await screen.findByText(/unavailable/i)).toBeInTheDocument();
    expect(screen.queryByText(/No songs matched/)).not.toBeInTheDocument();
  });

  // An absent `q` returns the entire catalog, not an empty result.
  it("asks for nothing while the box is empty", async () => {
    const user = userEvent.setup();
    const asked: string[] = [];
    server.use(
      http.get(`${API}/api/v1/songs`, ({ request }) => {
        asked.push(new URL(request.url).searchParams.get("q") ?? "");
        return HttpResponse.json(list(matches));
      }),
    );

    renderSearch();
    await user.type(box(), "τραγ");
    await screen.findByRole("option", { name: /Λίμνης/ });

    await user.clear(box());
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
    // Longer than the debounce; inside `act`, since the debounce settling is a
    // state update.
    await act(() => new Promise((resolve) => setTimeout(resolve, 400)));

    expect(asked).not.toContain("");
    expect(asked.at(-1)).toBe("τραγ");
  });

  it("closes on Escape with the text left in the box, and an arrow reopens it", async () => {
    const user = userEvent.setup();
    searchAnswers(matches);

    renderSearch();
    await user.type(box(), "τραγ");
    await screen.findByRole("option", { name: /Λίμνης/ });

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(box()).toHaveValue("τραγ");

    await user.keyboard("{ArrowDown}");

    expect(await screen.findByRole("listbox")).toBeInTheDocument();
  });

  // The rows are still held after Escape, but the reader can no longer see them.
  it("takes the query to the catalog on Enter once the panel is closed", async () => {
    const user = userEvent.setup();
    searchAnswers(matches);

    renderSearch();
    await user.type(box(), "love");
    await screen.findByRole("option", { name: /Λίμνης/ });

    await user.keyboard("{Escape}");
    await user.keyboard("{Enter}");

    expect(screen.getByText("Now at /?q=love")).toBeInTheDocument();
  });

  // Carried forward, the next ArrowDown would skip the first row.
  it("starts the highlight over when the results shrink under it", async () => {
    const user = userEvent.setup();
    searchAnswers([...matches, ...more]);

    renderSearch();
    await user.type(box(), "τραγ");
    await screen.findByRole("option", { name: /Λίμνης/ });
    // Down to the last of the four, then a query that answers with two.
    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}");
    searchAnswers(matches);
    await user.type(box(), "ο");
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(2));

    await user.keyboard("{ArrowDown}");

    expect(screen.getByRole("option", { name: /Λίμνης/ })).toHaveAttribute("aria-selected", "true");
  });

  // Focused directly rather than tabbed: the first Tab lands on the clear
  // button, which is inside the box.
  it("closes when focus moves to something outside it", async () => {
    const user = userEvent.setup();
    searchAnswers(matches);

    renderSearch();
    await user.type(box(), "τραγ");
    await screen.findByRole("option", { name: /Λίμνης/ });

    act(() => screen.getByRole("button", { name: "Elsewhere" }).focus());

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("stays open while focus is still inside it", async () => {
    const user = userEvent.setup();
    searchAnswers(matches);

    renderSearch();
    await user.type(box(), "τραγ");
    await screen.findByRole("option", { name: /Λίμνης/ });

    act(() => screen.getByRole("button", { name: /clear search/i }).focus());

    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("names the listbox only when there are rows in it", async () => {
    const user = userEvent.setup();
    searchAnswers([]);

    renderSearch();
    await user.type(box(), "zzz");
    await screen.findByText(/No songs matched/);

    expect(box()).toHaveAttribute("aria-expanded", "true");
    expect(box()).not.toHaveAttribute("aria-controls");
  });

  it("closes when a press lands outside it", async () => {
    const user = userEvent.setup();
    searchAnswers(matches);

    renderSearch();
    await user.type(box(), "τραγ");
    await screen.findByRole("option", { name: /Λίμνης/ });

    await user.click(screen.getByText(/Now at/));

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  // A pushed duplicate entry would make the next Back appear to do nothing.
  it("does not push a second entry for the song already open", async () => {
    const user = userEvent.setup();
    searchAnswers([makeSong({ id: "song-1", slug: "this-very-song", title: "This Very Song" })]);

    // Opened at the id form, pinning that "already open" is asked of the song,
    // not the address.
    renderSearch(["/songs/song-0", "/songs/song-1"]);
    await user.type(box(), "τραγ");

    await user.click(await screen.findByRole("option", { name: /This Very Song/ }));
    expect(screen.getByText("Now at /songs/this-very-song")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Back" }));

    expect(screen.getByText("Now at /songs/song-0")).toBeInTheDocument();
  });

  // Deliberate: a search result may not be in the list at all.
  it("leaves the list behind when the song was found by searching", async () => {
    const user = userEvent.setup();
    searchAnswers(matches);

    renderSearch("/songs/song-1?list=list-1");
    await user.type(box(), "τραγ");

    expect(await screen.findByRole("option", { name: /Λίμνης/ })).toHaveAttribute(
      "href",
      "/songs/to-tragoydi-tis-limnis",
    );
  });

  it("offers the whole catalog when there are more matches than it lists", async () => {
    const user = userEvent.setup();
    searchAnswers(matches, 12);

    renderSearch();
    await user.type(box(), "love");

    expect(await screen.findByRole("link", { name: /see all 12 songs/i })).toHaveAttribute(
      "href",
      "/?q=love",
    );
  });
});
