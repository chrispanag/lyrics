import { act, cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { Route, Routes, useLocation } from "react-router-dom";

import { SongDetailPage } from "./SongDetailPage";
import { API, listById, makeList, makeSong, makeUser, notFound } from "@/test/handlers";
import { scrollIntoView } from "@/test/intersection";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

/**
 * Stands in for the sign-in screen, showing where it would send the visitor back
 * to. That is what `AuthPages` does with the same state, so the address it names
 * here is the address a signed-in visitor lands on.
 */
function SignInStub() {
  const { state } = useLocation();
  const from = (state as { from?: string } | null)?.from ?? "/";
  return (
    <div>
      <h1>Sign in</h1>
      <p>Return to {from}</p>
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

  // The strips are what a phone gets instead of the arrows, and they carry the
  // title because nothing about them is visible to read.
  //
  // Asked for inside the lyrics, which is the whole of the fix and not a detail
  // of it: a strip lies over whatever shares its box, so the box it is given has
  // to be the one part of the page with nothing to press. Anywhere wider and
  // every control it reaches has to be lifted clear of it by hand — an allowlist
  // that was silently wrong twice, and only ever on a phone.
  it("puts the neighboring songs on strips over the lyrics, and names them", async () => {
    serveList();

    renderDetail({ route: "/songs/song-2?list=list-1" });

    const lyrics = within(await screen.findByRole("region", { name: "Lyrics" }));
    expect(lyrics.getByRole("link", { name: "Previous: First" })).toHaveAttribute(
      "href",
      "/songs/song-1?list=list-1",
    );
    expect(lyrics.getByRole("link", { name: "Next: Third" })).toBeInTheDocument();
  });

  // A strip has nothing visible about it, so the mark is the only thing that
  // says the gesture is there — and it is shown once, which makes when it plays
  // the whole question. Held back until the strips are on screen, because the
  // lyrics of a song with a video start below the fold and the one showing there
  // will ever be would be spent where nobody could see it.
  it("shows the paging mark when the lyrics come into view, once per device", async () => {
    serveList();

    renderDetail({ route: "/songs/song-2?list=list-1" });

    const mark = (await screen.findByRole("link", { name: "Next: Third" })).firstElementChild;
    expect(mark).toHaveClass("opacity-0");

    act(() => scrollIntoView());
    expect(mark).toHaveClass("opacity-100");

    // The next song of the list, on the same device: the mark has done its job
    // and the lyrics are left alone.
    cleanup();
    renderDetail({ route: "/songs/song-3?list=list-1" });

    const again = (await screen.findByRole("link", { name: "Previous: Second" })).firstElementChild;
    act(() => scrollIntoView());
    expect(again).toHaveClass("opacity-0");
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

    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByText("Return to /songs/song-2?list=list-1")).toBeInTheDocument();
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
