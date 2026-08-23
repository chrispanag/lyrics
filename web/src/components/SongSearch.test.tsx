import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { createPath, useLocation, useNavigate } from "react-router-dom";

import { SongSearch } from "./SongSearch";
import { API, apiError, list, makeSong } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";
import type { Song } from "@/lib/types";

/**
 * Where the panel has taken the reader, as something a spec can read.
 *
 * Serialized by `createPath`, the way `SongEditorPage.test.tsx` does it, rather
 * than by joining `pathname` and `search` — a hand-joined address silently drops
 * anything else the location carries.
 */
function Address() {
  return <p>Now at {createPath(useLocation())}</p>;
}

/**
 * The box, with the address beside it.
 *
 * No `<Routes>`, deliberately: on the real page the box lives above the route
 * element rather than inside it, so it stays mounted across a jump from one song
 * to the next — which is the only way the "empties itself on the way out" rule
 * below can be observed at all.
 */
function renderSearch(route: string | string[] = "/songs/song-1") {
  return renderWithProviders(
    <>
      <SongSearch />
      <Address />
      {/* Somewhere for focus to go that is not the box — the song page has its
          Back and Save buttons here. */}
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
 * What the catalog answers a search with, and how many it says there are.
 *
 * The override is passed only when there is one: `{ total: undefined }` would
 * overwrite `list()`'s count of the rows it was given with nothing, which is the
 * drift that helper's own docstring exists to prevent — every spec here would
 * then read `meta.total` as 0 and the "See all …" row would be unreachable in
 * all of them.
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
    // And the box is empty behind it. Landing on the song with the search that
    // found it still in the field, and its panel still over the first verse, is
    // the state this component spends an effect on avoiding.
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
    // The field keeps focus and names the row instead of handing it over, which
    // is what leaves the song page's own arrow keys out of this.
    expect(box()).toHaveFocus();
    expect(box()).toHaveAttribute("aria-activedescendant", second.id);

    await user.keyboard("{Enter}");

    expect(screen.getByText("Now at /songs/aspro-poykamiso")).toBeInTheDocument();
  });

  // Never a dead Enter: a query with nothing behind it is worth taking to the
  // catalog, which has the filters and the advice about spelling that six rows
  // in a panel cannot carry.
  it("takes a query that matched nothing to the catalog", async () => {
    const user = userEvent.setup();
    searchAnswers([]);

    renderSearch();
    await user.type(box(), "zzz");
    expect(await screen.findByText(/No songs matched/)).toBeInTheDocument();

    await user.keyboard("{Enter}");

    expect(screen.getByText("Now at /?q=zzz")).toBeInTheDocument();
  });

  // A failed request has no rows either, so a panel reading only the count says
  // nothing matched and sends the reader off to check their spelling. Both admin
  // screens shipped without this and both told that same lie.
  it("says a search failed rather than saying nothing matched", async () => {
    const user = userEvent.setup();
    server.use(http.get(`${API}/api/v1/songs`, () => apiError(500, "internal", "boom")));

    renderSearch();
    await user.type(box(), "τραγ");

    expect(await screen.findByText(/unavailable/i)).toBeInTheDocument();
    expect(screen.queryByText(/No songs matched/)).not.toBeInTheDocument();
  });

  // An absent `q` is not an empty result but the entire catalog, so a box that
  // asked anyway would open on the newest songs and call them matches for the
  // query that had just been deleted.
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
    // Longer than the debounce, so anything an empty box was going to ask for
    // has been asked by the time this is read. Inside `act`, since the wait is
    // exactly long enough for the debounce to settle and that is a state update.
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

  // The rows are still in hand when the panel is closed — `placeholderData` holds
  // them — so an Enter after Escape would open a song from a panel the reader
  // shut, chosen from rows they can no longer see.
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

  // A highlight the results no longer have is no highlight. Carried forward, the
  // next arrow steps from a row nobody can see: from row 6 of a panel that now
  // has two, ArrowDown used to land on the *second* and skip the first.
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

    expect(screen.getByRole("option", { name: /Λίμνης/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  // Nothing else closes it for a reader who never touches the screen: the rows
  // are not tab stops, so focus leaves the panel behind, open over the lyrics.
  //
  // Focus is moved to the control outside rather than tabbed there, because the
  // first Tab from the field lands on the clear button — which is part of the box,
  // and where the panel is meant to stay open. What the rule is about is focus
  // reaching something that is not.
  it("closes when focus moves to something outside it", async () => {
    const user = userEvent.setup();
    searchAnswers(matches);

    renderSearch();
    await user.type(box(), "τραγ");
    await screen.findByRole("option", { name: /Λίμνης/ });

    act(() => screen.getByRole("button", { name: "Elsewhere" }).focus());

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  // And stays open while focus is still somewhere in the box, which the clear
  // button and the catalog row both are.
  it("stays open while focus is still inside it", async () => {
    const user = userEvent.setup();
    searchAnswers(matches);

    renderSearch();
    await user.type(box(), "τραγ");
    await screen.findByRole("option", { name: /Λίμνης/ });

    act(() => screen.getByRole("button", { name: /clear search/i }).focus());

    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  // Only while a listbox is really rendered: the panel also answers with
  // "Searching…" and with nothing matched, and an id pointing at neither is a
  // promise to a screen reader that a list is there.
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

  // A reader can find the song they are already on by searching its own lyrics.
  // Pushed, that is a second entry for one address: the page appears not to have
  // moved and the next Back is a press that does nothing — and inside a list it
  // eats one step of the trail. The same failure the editor's exit documents.
  it("does not push a second entry for the song already open", async () => {
    const user = userEvent.setup();
    searchAnswers([makeSong({ id: "song-1", slug: "this-very-song", title: "This Very Song" })]);

    // Opened at the song's *id* form, which is what a link shared before slugs
    // existed says — so this also pins that "the song already open" is asked of
    // the song rather than of the address. The step still replaces, and the
    // address it replaces with is the canonical one.
    renderSearch(["/songs/song-0", "/songs/song-1"]);
    await user.type(box(), "τραγ");

    await user.click(await screen.findByRole("option", { name: /This Very Song/ }));
    expect(screen.getByText("Now at /songs/this-very-song")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Back" }));

    expect(screen.getByText("Now at /songs/song-0")).toBeInTheDocument();
  });

  // A song found by searching is not the next song in whatever list the reader
  // was reading — it may well not be in it at all — so the address carries no
  // list. Keeping `?list=` here would put a list bar on a song with steps to
  // either side of a position it does not hold.
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
