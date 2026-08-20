import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { Route, Routes, useLocation } from "react-router-dom";

import { SongDetailPage } from "./SongDetailPage";
import { returnDestination } from "@/auth/returnTo";
import { API, listById, makeList, makeSong, makeUser, notFound } from "@/test/handlers";
import { intersectAll } from "@/test/intersection";
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

  // The facade exists so a song page does not pull a megabyte of player code
  // for the majority of visits that never press play.
  it("shows a YouTube thumbnail rather than an iframe until play is pressed", async () => {
    server.use(
      http.get(`${API}/api/v1/songs/:id`, () =>
        HttpResponse.json(makeSong({ youtube_video_id: "dQw4w9WgXcQ" })),
      ),
    );

    const { container } = renderDetail();

    expect(await screen.findByRole("button", { name: /play/i })).toBeInTheDocument();
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

  // Belt and braces, and the safe way round: a swipe that begins on a control
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
