import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it, vi } from "vitest";
import { Route, Routes, useLocation } from "react-router-dom";

import { SongDetailPage } from "./SongDetailPage";
import { returnDestination } from "@/auth/returnTo";
import { API, listById, makeList, makeSong, makeUser, notFound } from "@/test/handlers";
import { intersectAll, observedElements } from "@/test/intersection";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

/**
 * Stands in for the sign-in screen, showing where it would send the visitor back
 * to. It reads the address with `returnDestination`, which is what the real
 * screen reads it with, so the address it names here is the one a signed-in
 * visitor lands on rather than a second opinion about it.
 */
function SignInStub() {
  const { state } = useLocation();
  return (
    <div>
      <h1>Sign in</h1>
      <p>Return to {returnDestination(state)}</p>
    </div>
  );
}

function renderDetail(options: Parameters<typeof renderWithProviders>[1] = {}) {
  return renderWithProviders(
    <Routes>
      <Route path="/songs/:id" element={<SongDetailPage />} />
      <Route path="/login" element={<SignInStub />} />
      {/* Where a deleted song leaves the reader, since the song they were on is
          gone. Stubbed so that landing is something a spec can see. */}
      <Route path="/" element={<h1>Catalog</h1>} />
    </Routes>,
    { route: "/songs/song-1", ...options },
  );
}

describe("SongDetailPage", () => {
  it("renders the title, credits, and lyrics", async () => {
    renderDetail();

    expect(await screen.findByRole("heading", { name: "Θάλασσα Πλατιά" })).toBeInTheDocument();
    expect(screen.getByText("Μίκης Θεοδωράκης")).toBeInTheDocument();
    expect(screen.getByText(/Στης θάλασσας τα βάθη/)).toBeInTheDocument();
  });

  // The lyrics are stored as plain text with meaningful line breaks; losing
  // them would run every verse together.
  it("preserves line breaks in the lyrics", async () => {
    renderDetail();

    const lyrics = await screen.findByText(/Στης θάλασσας τα βάθη/);
    expect(lyrics).toHaveClass("whitespace-pre-line");
    expect(lyrics.textContent).toContain("\n");
  });

  it("does not offer editing to a guest", async () => {
    renderDetail();

    await screen.findByRole("heading", { name: "Θάλασσα Πλατιά" });
    expect(screen.queryByRole("link", { name: /edit/i })).not.toBeInTheDocument();
  });

  it("does not offer editing to a contributor who did not add the song", async () => {
    server.use(
      http.get(`${API}/api/v1/songs/:id`, () =>
        HttpResponse.json(makeSong({ created_by: "someone-else" })),
      ),
    );

    renderDetail({ user: makeUser({ id: "user-1", role: "contributor" }) });

    await screen.findByRole("heading", { name: "Θάλασσα Πλατιά" });
    expect(screen.queryByRole("link", { name: /edit/i })).not.toBeInTheDocument();
  });

  it("offers editing to the contributor who added the song", async () => {
    server.use(
      http.get(`${API}/api/v1/songs/:id`, () => HttpResponse.json(makeSong({ created_by: "user-1" }))),
    );

    renderDetail({ user: makeUser({ id: "user-1", role: "contributor" }) });

    expect(await screen.findByRole("link", { name: /edit/i })).toBeInTheDocument();
  });

  it("offers editing and deletion to an admin regardless of author", async () => {
    server.use(
      http.get(`${API}/api/v1/songs/:id`, () =>
        HttpResponse.json(makeSong({ created_by: "someone-else" })),
      ),
    );

    renderDetail({ user: makeUser({ id: "admin-1", role: "admin" }) });

    expect(await screen.findByRole("link", { name: /edit/i })).toBeInTheDocument();
  });

  // The video leaves the page entirely: no player, no thumbnail, nothing that
  // loads from YouTube before someone asks for it.
  //
  // The fixture sets only the id, which is also the gate: `youtube_url` is
  // stored unvalidated by the catalog importer, so the page must not reach for
  // it. A page that regressed to reading the URL would fail here rather than
  // quietly rendering whatever the old database held.
  it("links out to the video in a new tab instead of embedding it", async () => {
    server.use(
      http.get(`${API}/api/v1/songs/:id`, () =>
        HttpResponse.json(makeSong({ youtube_video_id: "dQw4w9WgXcQ" })),
      ),
    );

    const { container } = renderDetail();

    const link = await screen.findByRole("link", { name: /watch on youtube/i });
    expect(link).toHaveAttribute("href", "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(link).toHaveAttribute("target", "_blank");
    expect(container.querySelector("iframe")).toBeNull();
  });

  // Saving is the reason to hold an account, so a guest is invited into it
  // rather than shown a page with the affordance missing.
  it("offers saving to a guest and sends them to sign in", async () => {
    const user = userEvent.setup();

    renderDetail();

    await user.click(await screen.findByRole("button", { name: /save to a list/i }));

    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });

  it("opens the list sheet for a signed-in reader instead", async () => {
    const user = userEvent.setup();

    renderDetail({ user: makeUser({ id: "user-1" }) });

    await user.click(await screen.findByRole("button", { name: /save to a list/i }));

    expect(await screen.findByRole("dialog", { name: /save to list/i })).toBeInTheDocument();
  });

  it("reports a song that could not be loaded", async () => {
    server.use(http.get(`${API}/api/v1/songs/:id`, () => notFound("Song was not found.")));

    renderDetail();

    expect(await screen.findByRole("alert")).toHaveTextContent("Song was not found.");
  });
});

/*
 * Reading a song from inside a list.
 *
 * The list is named by a query parameter rather than router state, so these
 * specs drive it the way a shared link does: by the URL alone.
 */
describe("SongDetailPage inside a list", () => {
  const inList = [
    makeSong({ id: "song-1", title: "First" }),
    makeSong({ id: "song-2", title: "Second" }),
    makeSong({ id: "song-3", title: "Third" }),
  ];

  /**
   * Serves list-1 with the given songs, and every song by id.
   *
   * Both are needed together: a spec that pages forward asks for a song the
   * default handler would answer with the one it always returns, and the whole
   * point is that the reader arrives at a different one. Only the songs half is
   * local — a list by id is what every list spec needs, so it is shared.
   */
  function serveList(songs = inList) {
    server.use(
      listById(makeList({ id: "list-1", name: "Ρεμπέτικα", songs, item_count: songs.length })),
      http.get(`${API}/api/v1/songs/:id`, ({ params }) => {
        const found = inList.find((song) => song.id === params.id);
        return found ? HttpResponse.json(found) : notFound("Song was not found.");
      }),
    );
  }

  it("shows the list a song is being read from and where it sits in it", async () => {
    serveList();

    renderDetail({ route: "/songs/song-2?list=list-1" });

    expect(await screen.findByRole("link", { name: "Ρεμπέτικα" })).toHaveAttribute(
      "href",
      "/lists/list-1",
    );
    expect(screen.getByText("2 of 3")).toBeInTheDocument();
  });

  // The context has to survive the step, or the second song is a dead end — which
  // is the whole failure this exists to prevent.
  it("steps to the next song and stays in the list", async () => {
    const user = userEvent.setup();
    serveList();

    renderDetail({ route: "/songs/song-2?list=list-1" });

    await user.click(await screen.findByRole("link", { name: "Next song" }));

    expect(await screen.findByRole("heading", { name: "Third" })).toBeInTheDocument();
    expect(screen.getByText("3 of 3")).toBeInTheDocument();
  });

  it("steps back with the left arrow key", async () => {
    const user = userEvent.setup();
    serveList();

    renderDetail({ route: "/songs/song-2?list=list-1" });
    await screen.findByRole("heading", { name: "Second" });

    await user.keyboard("{ArrowLeft}");

    expect(await screen.findByRole("heading", { name: "First" })).toBeInTheDocument();
  });

  // An open sheet owns the arrow keys. The nav asks the DOM whether a modal is
  // up rather than being handed a list of this page's sheets — a list the next
  // sheet would not be on, and paging the song out from under an open one reads
  // as a bug in the sheet.
  it("leaves the arrow keys to an open sheet", async () => {
    const user = userEvent.setup();
    serveList();

    renderDetail({ route: "/songs/song-2?list=list-1", user: makeUser({ id: "user-1" }) });

    await user.click(await screen.findByRole("button", { name: /save to a list/i }));
    await screen.findByRole("dialog", { name: /save to list/i });

    await user.keyboard("{ArrowRight}");

    expect(screen.getByRole("heading", { name: "Second" })).toBeInTheDocument();
  });

  it("offers no step past either end of the list", async () => {
    serveList();

    renderDetail({ route: "/songs/song-1?list=list-1" });

    expect(await screen.findByRole("link", { name: "Next song" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Previous song" })).not.toBeInTheDocument();
  });

  /**
   * A one-finger gesture, in the client coordinates that decide whether it is a
   * swipe: where it starts across the screen, and how far and which way it went.
   *
   * jsdom lays nothing out, so none of this is measured — the coordinates are
   * the whole of what the listener reads, and `window.innerWidth` is the 1024
   * jsdom reports. Dispatched on an element inside the song rather than on the
   * article itself, because the gesture is read across the whole page and has to
   * arrive by bubbling for that to be true.
   *
   * `fingers` is how many touches the move reports: a second one landing partway
   * through is a pinch, and the movement is no longer a swipe.
   */
  function swipe(
    target: Element,
    fromX: number,
    toX: number,
    { dy = 4, fingers = 1 }: { dy?: number; fingers?: number } = {},
  ) {
    const at = (clientX: number, clientY: number) => ({ clientX, clientY });
    const moved = at(toX, 400 + dy);
    fireEvent.touchStart(target, { touches: [at(fromX, 400)] });
    fireEvent.touchMove(target, {
      touches: fingers > 1 ? [moved, at(toX + 40, 300)] : [moved],
    });
    fireEvent.touchEnd(target, { changedTouches: [moved] });
  }

  /**
   * The middle song of the list, open, with the lyrics a thumb would be over.
   *
   * Every swipe spec starts here: it has a song on either side, so a gesture
   * read the wrong way round is a different song rather than nothing at all.
   */
  async function openSecond(options: Parameters<typeof renderDetail>[0] = {}) {
    serveList();
    renderDetail({ route: "/songs/song-2?list=list-1", ...options });
    await screen.findByRole("heading", { name: "Second" });
    return screen.getByRole("region", { name: "Lyrics" });
  }

  /** That the gesture was not read as a swipe: the reader has not moved. */
  function stillOnSecond() {
    expect(screen.getByRole("heading", { name: "Second" })).toBeInTheDocument();
  }

  // Left is onward, the way a page turns. This is what replaced the tap strips
  // that used to stand in for the arrows on a phone: a swipe is a movement
  // rather than a press, so it cannot take a tap meant for something else, and
  // the page carries no invisible targets to keep controls clear of.
  it("steps on with a swipe left across the song", async () => {
    swipe(await openSecond(), 500, 380);

    expect(await screen.findByRole("heading", { name: "Third" })).toBeInTheDocument();
  });

  it("steps back with a swipe right", async () => {
    swipe(await openSecond(), 500, 620);

    expect(await screen.findByRole("heading", { name: "First" })).toBeInTheDocument();
  });

  // Both screen edges are already spoken for — back and forward in Safari, the
  // system's back gesture on Android — so a gesture that starts there would page
  // the list *and* leave the page in the same movement.
  it("leaves a swipe that starts at the screen edge to the browser", async () => {
    const lyrics = await openSecond();

    swipe(lyrics, 8, 300);
    swipe(lyrics, 1020, 700);

    stillOnSecond();
  });

  // Reading a song is vertical scrolling, which is this gesture with the axes
  // swapped, so the two are told apart by which way the finger actually went.
  it("leaves a drag that went mostly up or down alone", async () => {
    swipe(await openSecond(), 500, 400, { dy: -260 });

    stillOnSecond();
  });

  // A second finger means a pinch, and the page belongs to it. One landing
  // inside the song is already dropped by its own touchstart; this is the other
  // one — a finger that goes down outside the article, where the only sign of it
  // is the touch count on the moves of the finger that is still here.
  it("drops the gesture when a second finger joins it", async () => {
    swipe(await openSecond(), 500, 380, { fingers: 2 });

    stillOnSecond();
  });

  // A long press and a drag sideways ends exactly where a swipe ends and means
  // the opposite of leaving. Compared against how the gesture started rather
  // than simply read, so a selection made earlier and left on the page cannot
  // quietly kill every swipe after it — which is why the selection is made
  // *during* the gesture here.
  it("leaves a movement that selected text alone", async () => {
    const lyrics = await openSecond();
    const line = screen.getByText(/Στης θάλασσας τα βάθη/);

    fireEvent.touchStart(lyrics, { touches: [{ clientX: 500, clientY: 400 }] });
    window.getSelection()?.selectAllChildren(line);
    fireEvent.touchEnd(lyrics, { changedTouches: [{ clientX: 380, clientY: 404 }] });

    stillOnSecond();
  });

  // The same movement from the other side, and the case a guard that only asked
  // "is anything selected now" let through: a reader who already has a word
  // selected and drags a handle sideways to grow it is not leaving either. What
  // is compared is *what* is selected, so both are refused — otherwise this one
  // pages the song and takes the selection and the reader's place in the list
  // with it.
  it("leaves a movement that extended an existing selection alone", async () => {
    const lyrics = await openSecond();
    const line = screen.getByText(/Στης θάλασσας τα βάθη/);
    const text = line.firstChild as Text;
    const selection = window.getSelection();

    /** A selection of the first `to` characters of the line, as a handle drag makes. */
    const select = (to: number) => {
      const range = document.createRange();
      range.setStart(text, 0);
      range.setEnd(text, to);
      selection?.removeAllRanges();
      selection?.addRange(range);
    };

    // Already selected when the finger goes down, which is what tells this case
    // apart from the one above.
    select(5);
    fireEvent.touchStart(lyrics, { touches: [{ clientX: 500, clientY: 400 }] });
    select(15);
    fireEvent.touchEnd(lyrics, { changedTouches: [{ clientX: 380, clientY: 404 }] });

    stillOnSecond();
  });

  // A selection made earlier and simply left on the page is the other half of
  // that comparison: it must not quietly kill every swipe after it, which is why
  // what is selected is compared rather than merely read.
  it("still reads a swipe over a selection the reader left behind", async () => {
    const lyrics = await openSecond();
    window.getSelection()?.selectAllChildren(screen.getByText(/Στης θάλασσας τα βάθη/));

    swipe(lyrics, 500, 380);

    expect(await screen.findByRole("heading", { name: "Third" })).toBeInTheDocument();
  });

  // An open sheet owns the gestures over it, as it owns the arrow keys: paging
  // the song out from under one reads as a bug in the sheet. The sheet is fixed
  // over the page but rendered inside it, so its touches reach the listener and
  // have to be turned away by hand.
  it("leaves the swipe to an open sheet", async () => {
    const user = userEvent.setup();
    await openSecond({ user: makeUser({ id: "user-1" }) });

    await user.click(screen.getByRole("button", { name: /save to a list/i }));
    const sheet = await screen.findByRole("dialog", { name: /save to list/i });

    swipe(sheet, 500, 380);

    stillOnSecond();
  });

  // Belt and suspenders, and the safe way round: a swipe that begins on a control
  // does nothing, rather than a control being unreachable under the gesture,
  // which is exactly how the tap strips went wrong. Swiping *back* here, so a
  // guard that failed would be visible as the previous song rather than as the
  // one the control itself leads to.
  it("does not read a swipe that started on a control", async () => {
    await openSecond();

    swipe(screen.getByRole("link", { name: "Next song" }), 500, 620);

    stillOnSecond();
  });

  // The swipe has nothing visible about it, so the mark is the only thing that
  // says the gesture is there — and it is shown once, which makes when it plays
  // the whole question. Gated on the mark really being on screen: at a desk it
  // is display:none, so it never comes into view and the one showing is not
  // spent on a machine that has no gesture to explain.
  it("shows the swipe mark when it comes into view, once per device", async () => {
    await openSecond();

    const mark = screen.getByText("Swipe through the list");
    expect(mark).toHaveClass("opacity-0");

    act(() => intersectAll());
    expect(mark).toHaveClass("opacity-100");

    // The next song of the list, on the same device: the mark has done its job,
    // and is not built at all rather than left invisible over the lyrics.
    cleanup();
    serveList();
    renderDetail({ route: "/songs/song-3?list=list-1" });
    await screen.findByRole("heading", { name: "Third" });

    act(() => intersectAll());
    expect(screen.queryByText("Swipe through the list")).not.toBeInTheDocument();
  });

  // The gesture has to outlive the mark, and only the order of two lines makes
  // that true: the component that installs the swipe is the same one that draws
  // the mark, and it renders nothing at all once the single showing is spent — so
  // the hook runs above that early return. Every phone that has already been
  // shown the mark is in this state permanently, which is why it is pinned:
  // moving the hook below the return, or making the component conditional at its
  // call site, would take paging away from all of them with nothing else failing.
  it("still pages the list on a device that has already seen the mark", async () => {
    localStorage.setItem("lyrics:swipe-hint-seen", "1");

    const lyrics = await openSecond();
    expect(screen.queryByText("Swipe through the list")).not.toBeInTheDocument();

    swipe(lyrics, 500, 380);

    expect(await screen.findByRole("heading", { name: "Third" })).toBeInTheDocument();
  });

  // Every touch listener is passive and nothing calls `preventDefault`: the
  // gesture is read after the movement rather than taken from it, which is what
  // leaves a long song's vertical scroll alone. A listener registered
  // `{ passive: false }` — the natural way to add a drag-follow animation later —
  // kills scrolling on every phone, and neither jsdom, which has no scrolling,
  // nor a desktop mouse, which has no such conflict, would show it. The
  // registration is the only readable form of the rule.
  it("reads every touch passively, so a long song still scrolls", async () => {
    const registered: { type: string; on: Element; options?: boolean | AddEventListenerOptions }[] =
      [];
    const original = Element.prototype.addEventListener;
    const spy = vi
      .spyOn(Element.prototype, "addEventListener")
      .mockImplementation(function (this: Element, type, listener, options) {
        registered.push({ type, on: this, options });
        return original.call(this, type, listener, options);
      });

    try {
      await openSecond();

      // Only what landed on the song itself: React delegates every browser
      // event, touches included, on the root container it owns. Scoping to the
      // surface also says where these belong — pointed at a part of the page
      // instead, the gesture would quietly narrow to it.
      const article = screen.getByRole("article");
      const touches = registered.filter(
        ({ type, on }) => on === article && type.startsWith("touch"),
      );

      // Distinct types, because the listeners are torn down and put back as the
      // list query settles and the addresses either side arrive. What matters is
      // that all four are here and that every registration of them is passive.
      expect([...new Set(touches.map(({ type }) => type))].sort()).toEqual([
        "touchcancel",
        "touchend",
        "touchmove",
        "touchstart",
      ]);
      for (const { options } of touches) {
        expect(options).toMatchObject({ passive: true });
      }
    } finally {
      spy.mockRestore();
    }
  });

  // Past its showing the mark is not rendered at all, rather than left invisible
  // over the page, which is the shape of thing the tap strips were. Stepping to a
  // song already in the query cache does not tear the page down, so a mark that
  // merely went transparent would sit over every song for the rest of the
  // session. Dropped after the fade rather than with it, so the fade is seen.
  it("drops the mark once the fade has run, rather than leaving it invisible", async () => {
    await openSecond();

    // Installed before the showing starts, so the dwell and the fade below are
    // scheduled on these rather than on the clock openSecond needed.
    vi.useFakeTimers();
    try {
      act(() => intersectAll());
      expect(screen.getByText("Swipe through the list")).toHaveClass("opacity-100");

      // HINT_VISIBLE_MS, and then the duration-700 the pill fades over.
      act(() => vi.advanceTimersByTime(3500));
      expect(screen.getByText("Swipe through the list")).toHaveClass("opacity-0");

      act(() => vi.advanceTimersByTime(700));
      expect(screen.queryByText("Swipe through the list")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  // Which element is watched is the whole of the rule: `md:hidden` has to sit on
  // the observed box rather than on the pill inside it. Moved inward the mark is
  // still hidden at a desk — but the box keeps its box, so the observer fires
  // there and spends the one showing on a machine with no gesture to explain, and
  // the reader who later picks up a phone is never told. jsdom applies no CSS, so
  // the class is the only way to say this.
  it("watches the box that has no box at a desk, not the pill inside it", async () => {
    await openSecond();

    const observed = observedElements();
    expect(observed).toHaveLength(1);
    expect(observed[0]).toHaveClass("md:hidden");
    expect(observed[0]).toContainElement(screen.getByText("Swipe through the list"));
  });

  it("names them again where the lyrics end", async () => {
    serveList();

    renderDetail({ route: "/songs/song-2?list=list-1" });

    const footer = await screen.findByRole("navigation", { name: /more from this list/i });
    expect(within(footer).getByRole("link", { name: "Previous First" })).toBeInTheDocument();
    expect(within(footer).getByRole("link", { name: "Next Third" })).toBeInTheDocument();
  });

  // A list of one has nothing on either side, and the footer's border alone
  // under the lyrics reads as a section that failed to load.
  it("draws no footer on a list of one", async () => {
    serveList([inList[1]!]);

    renderDetail({ route: "/songs/song-2?list=list-1" });

    expect(await screen.findByText("1 of 1")).toBeInTheDocument();
    expect(
      screen.queryByRole("navigation", { name: /more from this list/i }),
    ).not.toBeInTheDocument();
  });

  // A song taken out of the list in another tab, or a parameter typed by hand.
  // The song was what was asked for and it is there; the navigation is what goes.
  it("shows the song with no navigation when it is not in the list", async () => {
    serveList([inList[0]!, inList[2]!]);

    renderDetail({ route: "/songs/song-2?list=list-1" });

    expect(await screen.findByRole("heading", { name: "Second" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: /song navigation/i })).not.toBeInTheDocument();
  });

  it("shows the song with no navigation when the list cannot be read", async () => {
    serveList();

    renderDetail({ route: "/songs/song-2?list=someone-elses-list" });

    expect(await screen.findByRole("heading", { name: "Second" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: /song navigation/i })).not.toBeInTheDocument();
  });

  // The sign-in round trip is the one way out of this page that comes back to
  // it, so it is the one that must carry the parameter. Sent away with the path
  // alone, a guest who presses Save returns to the same song stripped of its
  // list — the dead end this navigation exists to prevent, reached by the only
  // control on the page that promises to bring them back.
  it("keeps the list across the sign-in round trip", async () => {
    const user = userEvent.setup();
    serveList();

    renderDetail({ route: "/songs/song-2?list=list-1", user: null });

    await user.click(await screen.findByRole("button", { name: "Save to a list" }));

    expect(await screen.findByText("Return to /songs/song-2?list=list-1")).toBeInTheDocument();
  });

  // Nothing asks for a list when a song is opened from browse, where there is
  // none — a request per song page for a list nobody named would be pure waste.
  it("asks for no list when a song is opened on its own", async () => {
    let requested = 0;
    server.use(
      http.get(`${API}/api/v1/lists/:id`, () => {
        requested += 1;
        return HttpResponse.json(makeList());
      }),
    );

    renderDetail();

    await screen.findByRole("heading", { name: "Θάλασσα Πλατιά" });
    expect(requested).toBe(0);
  });
});

// The confirmation is `ConfirmSheet`, shared with the list and genre deletes.
// Neither of the two older sheets had a spec when it was extracted, so this and
// its counterpart in ListsPages are what keep the shared component honest — a
// change to its buttons or its wiring would otherwise land silently on three
// screens at once.
describe("SongDetailPage deletion", () => {
  it("asks before deleting a song, and deletes the one it named", async () => {
    let deleted = "";
    server.use(
      http.delete(`${API}/api/v1/songs/:id`, ({ params }) => {
        deleted = String(params.id);
        return new HttpResponse(null, { status: 204 });
      }),
    );

    renderDetail({ user: makeUser({ role: "admin" }) });

    await userEvent.click(await screen.findByRole("button", { name: "Delete song" }));
    expect(screen.getByText(/will be removed for everyone/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(deleted).toBe("song-1"));
    // And the reader does not stay on the song that no longer exists.
    expect(await screen.findByRole("heading", { name: "Catalog" })).toBeInTheDocument();
  });

  it("does nothing to a song the confirmation was dismissed for", async () => {
    let requested = false;
    server.use(
      http.delete(`${API}/api/v1/songs/:id`, () => {
        requested = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    renderDetail({ user: makeUser({ role: "admin" }) });

    await userEvent.click(await screen.findByRole("button", { name: "Delete song" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByText(/will be removed for everyone/)).not.toBeInTheDocument();
    expect(requested).toBe(false);
  });
});
