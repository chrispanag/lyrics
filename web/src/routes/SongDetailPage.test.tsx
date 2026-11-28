import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { Profiler, useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SongDetailPage } from "./SongDetailPage";
import { setTokenProvider } from "@/api/client";
import { keys } from "@/api/hooks";
import { returnDestination } from "@/auth/returnTo";
import { BackButton } from "@/components/BackButton";
import { RouteParams, useRouter, useSearchParams } from "@/lib/navigation";
import { deferred } from "@/test/deferred";
import {
  API,
  apiError,
  list,
  listById,
  makeGenre,
  makeList,
  makePopularity,
  makeRecording,
  makeSong,
  makeUser,
  notFound,
} from "@/test/handlers";
import { intersectAll, observedElements } from "@/test/intersection";
import { songMatchesRef } from "@/lib/listContext";
import { CHROME_TUCKED_ATTRIBUTE } from "@/lib/scrollChrome";
import type { Recording, Song } from "@/lib/types";
import { embedUrl } from "@/lib/youtube";
import { testQueryClient } from "@/test/providers";
import { renderWithProviders } from "@/test/render";
import { TestRoutes } from "@/test/routes";
import { scrollDown, scrollUp, setScrollY } from "@/test/scroll";
import { server } from "@/test/server";

/**
 * Stands in for the sign-in screen, naming where it would return the visitor,
 * read with the real screen's `returnDestination`.
 */
function SignInStub() {
  const params = useSearchParams();
  return (
    <div>
      <h1>Sign in</h1>
      <p>Return to {returnDestination(params)}</p>
    </div>
  );
}

// `scrollDown()`'s offset outlives the render and `StickyHeader` reads it at
// mount, so every spec in the file starts from the top.
beforeEach(() => setScrollY(0));

function renderDetail(options: Parameters<typeof renderWithProviders>[1] = {}) {
  return renderWithProviders(
    <TestRoutes
      routes={{
        "/songs/:id": <SongDetailPage />,
        "/login": <SignInStub />,
        // The list page Back has to reach again, with the real `BackButton`:
        // push versus replace is only visible by pressing Back.
        "/lists/:listId": (
          <div>
            <h1>List page</h1>
            <BackButton />
          </div>
        ),
        // Where a deleted song leaves the reader.
        "/": <h1>Catalog</h1>,
      }}
    />,
    { route: "/songs/song-1", ...options },
  );
}

/**
 * Renders the page with a handle on its router, to move the address as Back or
 * Forward would: a click outside a modal sheet would be the sheet's to
 * dismiss, not a navigation.
 */
function renderWithRouter(queryClient: ReturnType<typeof testQueryClient>) {
  const router: { push?: (href: string) => void } = {};
  function Router() {
    const { push } = useRouter();
    useEffect(() => {
      router.push = push;
    }, [push]);
    return null;
  }
  renderWithProviders(
    <TestRoutes
      routes={{
        "/songs/:id": (
          <>
            <SongDetailPage />
            <Router />
          </>
        ),
      }}
    />,
    { route: "/songs/song-1", queryClient },
  );
  return router;
}

/**
 * Moves the address to `next`, a card seeded into the cache at the step (the
 * test client drops unobserved data at once), so the page has a song to show
 * while its full read is held.
 */
function stepTo(
  router: { push?: (href: string) => void },
  queryClient: ReturnType<typeof testQueryClient>,
  next: Omit<Song, "lyrics">,
) {
  act(() => {
    queryClient.setQueryData(keys.songs({}), {
      data: [next],
      meta: { total: 1, limit: 20, offset: 0 },
    });
    router.push?.(`/songs/${next.id}`);
  });
}

/**
 * Drives a one-finger horizontal swipe across an element in client coordinates
 * (jsdom lays nothing out; `window.innerWidth` is 1024). Dispatched inside the
 * song so it reaches the article by bubbling. `fingers` is the touch count the
 * moves report; more than one is a pinch.
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

describe("SongDetailPage popularity", () => {
  it("records one click and leaves the tally off the page", async () => {
    const bodies: unknown[] = [];
    server.use(
      http.get(`${API}/api/v1/songs/:id`, () =>
        HttpResponse.json(
          makeSong({
            popularity: makePopularity({
              anonymous_clicks: 3,
              authenticated_clicks: 1,
              list_adds: 4,
              list_users: 2,
              score: 27,
            }),
          }),
        ),
      ),
      http.post(`${API}/api/v1/songs/:id/clicks`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(
          makePopularity({
            anonymous_clicks: 4,
            authenticated_clicks: 1,
            list_adds: 4,
            list_users: 2,
            score: 28,
          }),
        );
      }),
    );

    renderDetail();

    await screen.findByRole("heading", { name: "Θάλασσα Πλατιά" });
    expect(screen.queryByText(/click/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/saved/i)).not.toBeInTheDocument();
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toEqual({ visitor_id: expect.stringMatching(/^[0-9a-f-]{36}$/i) });
    expect(bodies).toHaveLength(1);
    expect(screen.queryByText(/click/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/saved/i)).not.toBeInTheDocument();
  });

  // The tallies live behind Stats, for anyone. The recorded click's reply
  // updates them, so they usually count this visit too: a refetch racing the
  // click can land after it with the count from just before.
  it("shows the song's tallies under Stats", async () => {
    server.use(
      http.get(`${API}/api/v1/songs/:id`, () =>
        HttpResponse.json(
          makeSong({
            popularity: makePopularity({
              anonymous_clicks: 3,
              authenticated_clicks: 1,
              list_adds: 4,
              list_users: 1,
              score: 27,
            }),
          }),
        ),
      ),
      http.post(`${API}/api/v1/songs/:id/clicks`, () =>
        HttpResponse.json(
          makePopularity({
            anonymous_clicks: 1203,
            authenticated_clicks: 1,
            list_adds: 4,
            list_users: 1,
            score: 1220,
          }),
        ),
      ),
    );

    renderDetail();

    const stats = await screen.findByRole("button", { name: "Stats" });
    await waitFor(() => expect(stats).toBeEnabled());
    // Off a narrow page until asked for.
    expect(screen.queryByText("4 times")).toBeNull();
    await userEvent.click(stats);

    const sheet = await screen.findByRole("dialog", { name: "Stats" });
    const row = (label: string) => within(sheet).getByText(label).closest("div");
    await waitFor(() => expect(row("Views")).toHaveTextContent("1,204"));
    expect(row("Views")).toHaveTextContent("1 by signed-in readers");
    expect(row("Added to a list")).toHaveTextContent("4 times");
    expect(row("In lists of")).toHaveTextContent("1 person");
    // The row a reader would read as the song's age, which for an imported
    // catalog is only the import's.
    expect(within(sheet).queryByText(/catalog since/i)).not.toBeInTheDocument();
  });

  // The card clicked in the catalog already carries the tallies, so Stats is
  // offered before the full read with the lyrics arrives.
  it("offers Stats from the clicked card, before the full song arrives", async () => {
    const { lyrics: _lyrics, ...card } = makeSong({
      popularity: makePopularity({ anonymous_clicks: 6, list_adds: 2, list_users: 2, score: 10 }),
    });
    const queryClient = testQueryClient();
    queryClient.setQueryData(keys.songs({}), {
      data: [card],
      meta: { total: 1, limit: 20, offset: 0 },
    });
    server.use(http.get(`${API}/api/v1/songs/:id`, () => new Promise(() => {})));

    renderDetail({ route: "/songs/thalassa-platia", queryClient });

    const stats = await screen.findByRole("button", { name: "Stats" });
    expect(stats).toBeEnabled();
    await userEvent.click(stats);

    const sheet = await screen.findByRole("dialog", { name: "Stats" });
    const row = (label: string) => within(sheet).getByText(label).closest("div");
    expect(row("Views")).toHaveTextContent("6");
    expect(row("Added to a list")).toHaveTextContent("2 times");
    expect(row("In lists of")).toHaveTextContent("2 people");
  });

  // As on Back or Forward: the sheet was about the song it opened on.
  it("closes Stats when the address moves to another song", async () => {
    const user = userEvent.setup();
    // The next song is a card already in the cache, so the page has a song to
    // show at once and nothing else would close the sheet.
    const { lyrics: _lyrics, ...next } = makeSong({ id: "song-2", slug: "song-2", title: "Άλλο" });
    const queryClient = testQueryClient();
    // The next song's full read is held, so its card is what stands in.
    server.use(
      http.get(`${API}/api/v1/songs/:id`, ({ params }) =>
        params.id === "song-2" ? new Promise(() => {}) : HttpResponse.json(makeSong()),
      ),
    );
    const router = renderWithRouter(queryClient);

    const stats = await screen.findByRole("button", { name: "Stats" });
    await waitFor(() => expect(stats).toBeEnabled());
    await user.click(stats);
    await screen.findByRole("dialog", { name: "Stats" });

    stepTo(router, queryClient, next);

    // On the next song already, its card standing in, so only the reset can
    // have closed the sheet.
    expect(await screen.findByRole("heading", { name: "Άλλο", hidden: true })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Stats" })).toBeNull());
  });

  it("waits for the song before offering Stats", () => {
    server.use(http.get(`${API}/api/v1/songs/:id`, () => new Promise(() => {})));

    renderDetail();

    expect(screen.getByRole("button", { name: "Stats" })).toBeDisabled();
  });

  it("sends the session when the reader is signed in", async () => {
    let authorization: string | null = null;
    server.use(
      http.post(`${API}/api/v1/songs/:id/clicks`, ({ request }) => {
        authorization = request.headers.get("Authorization");
        return new HttpResponse(null, { status: 204 });
      }),
    );
    setTokenProvider(async () => "listener-token");

    try {
      renderDetail({ user: makeUser() });
      await screen.findByRole("heading", { name: "Θάλασσα Πλατιά" });
      await waitFor(() => expect(authorization).toBe("Bearer listener-token"));
    } finally {
      setTokenProvider(async () => null);
    }
  });
});

describe("SongDetailPage", () => {
  // Next merges every active segment's params, and the list kept beside the
  // song is one: a param named like the song's would carry the list's id.
  it("reads the song from the address, whatever the params hold", async () => {
    // Only the song's own address answers, as the API does.
    server.use(
      http.get(`${API}/api/v1/songs/:id`, ({ params }) =>
        params.id === "song-1" ? HttpResponse.json(makeSong()) : notFound("Song was not found."),
      ),
    );
    renderWithProviders(
      <RouteParams params={{ id: "8b6d3d33-ed96-4ff4-a65e-72834d909075" }}>
        <SongDetailPage />
      </RouteParams>,
      { route: "/songs/song-1?list=8b6d3d33-ed96-4ff4-a65e-72834d909075" },
    );

    expect(await screen.findByRole("heading", { name: "Θάλασσα Πλατιά" })).toBeInTheDocument();
  });

  it("renders the title, credits, and lyrics", async () => {
    renderDetail();

    expect(await screen.findByRole("heading", { name: "Θάλασσα Πλατιά" })).toBeInTheDocument();
    expect(screen.getByText("Μίκης Θεοδωράκης")).toBeInTheDocument();
    expect(screen.getByText(/Στης θάλασσας τα βάθη/)).toBeInTheDocument();
  });

  // The list is beside the lyrics on a wide screen, so Back leaves. The bar
  // keeps the song's tools and stays above the scrolling lyrics; the title
  // scrolls with them, and the scrollbar is theirs. jsdom has no breakpoint;
  // the classes say it.
  it("keeps the song's tools above the scrolling lyrics", async () => {
    renderDetail();

    const title = await screen.findByRole("heading", { name: "Θάλασσα Πλατιά" });
    const addToList = screen.getByRole("button", { name: /add to list/i });
    // Back, then the tools, inside the bar.
    const bar = addToList.parentElement?.parentElement?.parentElement;
    // The header, the reading column's head, the columns, and their scroller.
    const scroller = title.closest("header")?.parentElement?.parentElement?.parentElement;

    expect(title.closest("header")).toHaveAttribute("lang", "el");
    expect(screen.getByText("Μίκης Θεοδωράκης").closest("[lang]")).toHaveAttribute("lang", "el");
    expect(bar).toHaveClass("@3xl/app:shrink-0");
    expect(bar).not.toContainElement(title);
    expect(scroller).toHaveClass("@3xl/app:overflow-y-auto");
    expect(scroller).toContainElement(title);
    expect(scroller).not.toContainElement(addToList);
    expect(screen.getByRole("button", { name: "Back" })).toHaveClass("@3xl/app:hidden");
  });

  // Lyrics are plain text whose line breaks carry the verses. Each line is its
  // own block, so a long one wraps under a hanging indent, and a blank line
  // keeps the gap between verses.
  it("sets each lyric line apart, verses and all", async () => {
    server.use(
      http.get(`${API}/api/v1/songs/:id`, () =>
        HttpResponse.json(
          // Leading and trailing breaks are what a pasted textarea stores: no
          // line for them.
          makeSong({
            lyrics:
              "\nΠρώτος στίχος\r\nδεύτερος <b>στίχος</b>\n\nτρίτη στροφή\n  \nτέταρτη στροφή\n",
          }),
        ),
      ),
    );

    renderDetail();

    const first = await screen.findByText("Πρώτος στίχος");
    const lines = [...(first.parentElement?.children ?? [])];
    expect(lines.map((line) => line.textContent)).toEqual([
      "Πρώτος στίχος",
      // User input: shown as written, never as markup.
      "δεύτερος <b>στίχος</b>",
      "",
      "τρίτη στροφή",
      "",
      "τέταρτη στροφή",
    ]);
    // A real break, which a copied selection keeps, so the verses stay apart;
    // a line of only spaces is just as blank.
    expect(lines[2]?.querySelector("br")).not.toBeNull();
    expect(lines[4]?.querySelector("br")).not.toBeNull();
  });

  // The title is set in the lyrics' serif, so the two read as one piece. jsdom
  // resolves no fonts; the class says it, and the stories check the face.
  it("sets the title in the lyrics' face", async () => {
    renderDetail();

    const title = await screen.findByRole("heading", { level: 1, name: "Θάλασσα Πλατιά" });
    expect(title.closest("header")).toHaveClass("font-lyrics");
  });

  // Notes are a footnote after the last verse, in a region assistive tech can
  // find, and user input shown as written.
  it("follows the lyrics with the notes, as plain text", async () => {
    server.use(
      http.get(`${API}/api/v1/songs/:id`, () =>
        HttpResponse.json(makeSong({ notes: "Πρώτη <i>ηχογράφηση</i>\nστην Αθήνα." })),
      ),
    );

    renderDetail();

    const notes = await screen.findByRole("region", { name: "Notes" });
    const lyrics = screen.getByRole("region", { name: "Lyrics" });
    expect(lyrics.compareDocumentPosition(notes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(notes).getByRole("heading", { name: "Notes" })).toBeInTheDocument();
    const text = within(notes).getByText(/Πρώτη/);
    expect(text.textContent).toBe("Πρώτη <i>ηχογράφηση</i>\nστην Αθήνα.");
    expect(text.querySelector("i")).toBeNull();
    expect(text).toHaveClass("whitespace-pre-line");
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
      http.get(`${API}/api/v1/songs/:id`, () =>
        HttpResponse.json(makeSong({ created_by: "user-1" })),
      ),
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

  // Nothing loaded from YouTube until the reader asks. The fixture sets only
  // the id, the gate: the importer stores `youtube_url` unvalidated.
  it("plays the video above the lyrics on a press, and puts it away on another", async () => {
    const user = userEvent.setup();
    server.use(
      http.get(`${API}/api/v1/songs/:id`, () =>
        HttpResponse.json(makeSong({ youtube_video_id: "dQw4w9WgXcQ" })),
      ),
    );

    const { container } = renderDetail();

    const watch = await screen.findByRole("button", { name: "Watch" });
    expect(watch).toHaveAttribute("aria-expanded", "false");
    expect(container.querySelector("iframe")).toBeNull();

    await user.click(watch);

    const player = screen.getByTitle("Θάλασσα Πλατιά on YouTube");
    expect(player).toHaveAttribute("src", embedUrl("dQw4w9WgXcQ"));
    expect(player).toHaveFocus();
    const hide = screen.getByRole("button", { name: "Hide video" });
    expect(hide).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById(hide.getAttribute("aria-controls") ?? "")).toContainElement(
      player,
    );
    // Between the credits and the lyrics, so the words stay in view under it.
    expect(player.compareDocumentPosition(screen.getByRole("region", { name: "Lyrics" }))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );

    await user.click(hide);

    expect(container.querySelector("iframe")).toBeNull();
    expect(screen.getByRole("button", { name: "Watch" })).toBeInTheDocument();
  });

  // The other half of the gate: a `youtube_url` with no id (an unparseable
  // imported link) must offer nothing.
  it("offers no video link when the song has no video id", async () => {
    server.use(
      http.get(`${API}/api/v1/songs/:id`, () =>
        HttpResponse.json(
          makeSong({ youtube_url: "https://example.com/not-a-video", youtube_video_id: null }),
        ),
      ),
    );

    renderDetail();

    await screen.findByRole("heading", { name: "Θάλασσα Πλατιά" });
    expect(screen.queryByRole("button", { name: "Watch" })).not.toBeInTheDocument();
  });

  // A guest is offered Add to list and sent to sign in.
  it("offers Add to list to a guest and sends them to sign in", async () => {
    const user = userEvent.setup();

    renderDetail();

    await user.click(await screen.findByRole("button", { name: /add to list/i }));

    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });

  it("opens the list sheet for a signed-in reader instead", async () => {
    const user = userEvent.setup();

    renderDetail({ user: makeUser({ id: "user-1" }) });

    await user.click(await screen.findByRole("button", { name: /add to list/i }));

    expect(await screen.findByRole("dialog", { name: /add to list/i })).toBeInTheDocument();
  });

  it("reports a song that could not be loaded", async () => {
    server.use(http.get(`${API}/api/v1/songs/:id`, () => notFound("Song was not found.")));

    renderDetail();

    expect(await screen.findByRole("alert")).toHaveTextContent("Song was not found.");
  });

  // A video taken away and put back, as an editor fixing its link might: the
  // player must not come back and play on its own.
  it("closes the player for good when a refetch drops the video", async () => {
    const user = userEvent.setup();
    let videoId: string | null = "dQw4w9WgXcQ";
    server.use(
      http.get(`${API}/api/v1/songs/:id`, () =>
        HttpResponse.json(makeSong({ youtube_video_id: videoId })),
      ),
    );
    const { queryClient } = renderDetail();

    await user.click(await screen.findByRole("button", { name: "Watch" }));
    expect(document.querySelector("iframe")).not.toBeNull();

    videoId = null;
    await act(() => queryClient.refetchQueries({ queryKey: keys.song("song-1") }));
    await waitFor(() => expect(screen.queryByRole("button", { name: /hide video/i })).toBeNull());

    videoId = "dQw4w9WgXcQ";
    await act(() => queryClient.refetchQueries({ queryKey: keys.song("song-1") }));

    expect(await screen.findByRole("button", { name: "Watch" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(document.querySelector("iframe")).toBeNull();
  });

  // A failed refetch with the song in hand keeps the lyrics on screen.
  it("keeps a song a reader already has when a refetch fails", async () => {
    const { queryClient } = renderDetail();

    await screen.findByRole("heading", { name: "Θάλασσα Πλατιά" });

    server.use(http.get(`${API}/api/v1/songs/:id`, () => notFound("Song was not found.")));
    await act(() => queryClient.refetchQueries({ queryKey: keys.song("song-1") }));

    // The refetch promise resolves before the page re-renders, so a control is
    // pressed first; asserting straight away passes even with `isError` back.
    await userEvent.click(screen.getByRole("button", { name: "Increase text size" }));

    expect(screen.getByRole("heading", { name: "Θάλασσα Πλατιά" })).toBeInTheDocument();
    expect(screen.getByText(/Στης θάλασσας τα βάθη/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

/*
 * What is on screen before the song is: the chrome stays; only the song's own
 * content waits.
 */
describe("SongDetailPage while the song loads", () => {
  /** Serves the song only once the spec lets it through, answering with the release. */
  function serveHeldSong(song = makeSong()) {
    const [held, release] = deferred();

    server.use(
      http.get(`${API}/api/v1/songs/:id`, async () => {
        await held;
        return HttpResponse.json(song);
      }),
    );

    return release;
  }

  it("keeps the way back and the way to a list on screen", async () => {
    const release = serveHeldSong();

    renderDetail();

    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add to list/i })).toBeInTheDocument();

    release();
    expect(await screen.findByRole("heading", { name: "Θάλασσα Πλατιά" })).toBeInTheDocument();
  });

  // `!song` holds for the whole wait, so the failure branch must read `isLoading`.
  it("does not report the song as unavailable while it is in flight", async () => {
    const release = serveHeldSong();

    renderDetail();

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    release();
    await screen.findByRole("heading", { name: "Θάλασσα Πλατιά" });
  });

  // `canEditSong` answers an admin before the song arrives; its admin check must
  // stay ahead of the `!song` guard.
  it("offers an admin the editor before the song has arrived", async () => {
    const release = serveHeldSong(makeSong({ created_by: "someone-else" }));

    renderDetail({ user: makeUser({ id: "admin-1", role: "admin" }) });

    expect(screen.getByRole("link", { name: /edit/i })).toHaveAttribute(
      "href",
      "/songs/song-1/edit",
    );

    release();
    await screen.findByRole("heading", { name: "Θάλασσα Πλατιά" });
  });

  // The confirmation names the song, so it waits for one.
  it("holds the delete control until there is a song for it to name", async () => {
    const release = serveHeldSong();

    renderDetail({ user: makeUser({ id: "admin-1", role: "admin" }) });

    // The menu holds nothing that could act yet, so it does not open at all.
    expect(screen.getByRole("button", { name: "More actions" })).toBeDisabled();

    release();
    await screen.findByRole("heading", { name: "Θάλασσα Πλατιά" });
    await userEvent.click(screen.getByRole("button", { name: "More actions" }));
    expect(screen.getByRole("menuitem", { name: "Delete song" })).toBeEnabled();
  });
});

/*
 * Opening a song from a catalog or list already in the cache: the card stands
 * in for the song until the full read, which alone has the lyrics.
 */
describe("SongDetailPage from a cached card", () => {
  /** What a list read returns for the song: no lyrics. */
  const card = () => {
    const { lyrics: _lyrics, ...rest } = makeSong({ genres: [makeGenre()] });
    return rest;
  };

  /** A client whose catalog already holds the card, as after browsing. */
  function warmClient() {
    const queryClient = testQueryClient();
    queryClient.setQueryData(keys.songs({}), {
      data: [card()],
      meta: { total: 1, limit: 20, offset: 0 },
    });
    return queryClient;
  }

  it("paints the header from the card before the song arrives", async () => {
    const [held, release] = deferred();
    server.use(
      http.get(`${API}/api/v1/songs/:id`, async () => {
        await held;
        return HttpResponse.json(makeSong());
      }),
    );

    // By slug, the address a card links to.
    renderDetail({ route: "/songs/thalassa-platia", queryClient: warmClient() });

    expect(screen.getByRole("heading", { name: "Θάλασσα Πλατιά" })).toBeInTheDocument();
    expect(screen.getByText("Μίκης Θεοδωράκης")).toBeInTheDocument();
    expect(screen.getByText("Ρεμπέτικο")).toBeInTheDocument();

    release();
    expect(await screen.findByText(/Στης θάλασσας τα βάθη/)).toBeInTheDocument();
  });

  it("matches the card by id as well", () => {
    server.use(http.get(`${API}/api/v1/songs/:id`, () => new Promise(() => {})));

    renderDetail({ route: "/songs/song-1", queryClient: warmClient() });

    expect(screen.getByRole("heading", { name: "Θάλασσα Πλατιά" })).toBeInTheDocument();
  });

  // The card has no lyrics because the list leaves them out, not because the
  // song has none.
  it("shows no empty-lyrics message while on the card", async () => {
    const [held, release] = deferred();
    server.use(
      http.get(`${API}/api/v1/songs/:id`, async () => {
        await held;
        return HttpResponse.json(makeSong());
      }),
    );

    renderDetail({ route: "/songs/thalassa-platia", queryClient: warmClient() });

    expect(screen.queryByText("No lyrics have been added yet.")).not.toBeInTheDocument();
    expect(screen.getByRole("article")).toHaveAttribute("aria-busy", "true");

    release();
    await screen.findByText(/Στης θάλασσας τα βάθη/);
    expect(screen.getByRole("article")).toHaveAttribute("aria-busy", "false");
  });

  it("still reports a song with no lyrics once the full read says so", async () => {
    server.use(
      http.get(`${API}/api/v1/songs/:id`, () => HttpResponse.json(makeSong({ lyrics: "" }))),
    );

    renderDetail({ route: "/songs/thalassa-platia", queryClient: warmClient() });

    expect(await screen.findByText("No lyrics have been added yet.")).toBeInTheDocument();
  });
});

/*
 * The recordings on a song page: the first one's performers and year in the
 * header, and the sheet holding all of them.
 */
describe("SongDetailPage recordings", () => {
  /**
   * A song with these recordings and the copies `refresh_songs_denorm` makes of
   * the first one's year and link, as a real response has.
   */
  function withRecordings(recordings: Recording[]) {
    const first = recordings[0];
    server.use(
      http.get(`${API}/api/v1/songs/:id`, () =>
        HttpResponse.json(
          makeSong({
            recordings,
            release_year: first?.release_year ?? null,
            youtube_url: first?.youtube_url ?? null,
            youtube_video_id: first?.youtube_video_id ?? null,
          }),
        ),
      ),
    );
  }

  /**
   * A two-song list where both have a recording, so the guard specs have paging
   * to suppress.
   */
  function servePagedList() {
    const songs = [
      makeSong({
        id: "song-2",
        slug: "second",
        title: "Θάλασσα Πλατιά",
        // Two, so there is a sheet to open: a lone recording shows inline.
        recordings: [makeRecording(), makeRecording({ id: "r2", is_first: false })],
      }),
      makeSong({
        id: "song-3",
        slug: "third",
        title: "Επόμενο",
        recordings: [makeRecording({ id: "r9" })],
      }),
    ];
    server.use(
      listById(makeList({ id: "list-1", name: "Ρεμπέτικα", songs, item_count: songs.length })),
      // By slug or id, as the API answers.
      http.get(`${API}/api/v1/songs/:id`, ({ params }) => {
        const found = songs.find((song) => songMatchesRef(song, String(params.id)));
        return found ? HttpResponse.json(found) : notFound("Song was not found.");
      }),
    );
  }

  it("names the first recording's performers and year", async () => {
    withRecordings([makeRecording({ release_year: 1971 })]);

    renderDetail();

    expect(await screen.findByText("Performed by")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Γιώργος Νταλάρας" })).toHaveAttribute(
      "href",
      "/?person=person-2",
    );
    expect(screen.getByText("1971")).toBeInTheDocument();
  });

  // The commonest recording: a year and nobody named, so no "Performed by" row.
  it("omits the performers row when the recording names nobody", async () => {
    withRecordings([makeRecording({ performers: [] })]);

    renderDetail();

    await screen.findByRole("heading", { name: "Θάλασσα Πλατιά" });
    expect(screen.queryByText("Performed by")).not.toBeInTheDocument();
    expect(screen.getByText("1964")).toBeInTheDocument();
  });

  // Both halves of the video gate, per recording; see the pair above.
  it("plays the first recording's video id", async () => {
    const user = userEvent.setup();
    withRecordings([makeRecording({ youtube_video_id: "dQw4w9WgXcQ" })]);

    renderDetail();

    await user.click(await screen.findByRole("button", { name: "Watch" }));
    expect(screen.getByTitle("Θάλασσα Πλατιά on YouTube")).toHaveAttribute(
      "src",
      embedUrl("dQw4w9WgXcQ"),
    );
  });

  it("offers no video for a recording whose link never parsed", async () => {
    withRecordings([
      makeRecording({
        youtube_url: "https://youtube.com/watch?feature=share",
        youtube_video_id: null,
      }),
    ]);

    renderDetail();

    await screen.findByRole("heading", { name: "Θάλασσα Πλατιά" });
    expect(screen.queryByRole("button", { name: "Watch" })).not.toBeInTheDocument();
  });

  // Its performers and year are the song's own rows, so only the label and the
  // notes are added, and the year is said once.
  it("shows a lone recording inline rather than offering a sheet", async () => {
    withRecordings([makeRecording({ label: "Columbia", notes: "Recorded in Athens." })]);

    renderDetail();

    const inline = (await screen.findByText("Columbia")).parentElement;
    expect(inline).toHaveTextContent("Recorded in Athens.");
    // The mark is on the performers' line, which it describes, not the label's.
    expect(inline).not.toHaveTextContent("First recording");
    expect(screen.getByText("1964")).toBeInTheDocument();
    const performer = screen.getByText("Γιώργος Νταλάρας");
    expect(performer.closest("dd")).toHaveTextContent("First recording");
    expect(screen.queryByRole("button", { name: /show all/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: /recordings/i })).not.toBeInTheDocument();
  });

  // The mark joins the performers it is about, rather than taking a line of its
  // own under the year.
  it("marks a lone first recording on its performers' line", async () => {
    withRecordings([makeRecording({ label: null, notes: null })]);

    renderDetail();

    const performer = await screen.findByText("Γιώργος Νταλάρας");
    const row = performer.closest("dd");
    expect(row).toHaveTextContent("First recording");
    // Once: no second list of recordings marks it again.
    expect(screen.getAllByText("First recording")).toHaveLength(1);
  });

  // Unmarked, unlabeled and without notes, it has nothing the page lacks.
  it("adds nothing for a lone recording with nothing of its own to say", async () => {
    withRecordings([makeRecording({ is_first: false })]);

    renderDetail();

    await screen.findByRole("heading", { name: "Θάλασσα Πλατιά" });
    expect(screen.queryByText(/first recording/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /show all/i })).not.toBeInTheDocument();
  });

  it("keeps the sheet for two recordings, with nothing inline", async () => {
    withRecordings([
      makeRecording({ id: "r1", label: "Columbia" }),
      makeRecording({ id: "r2", is_first: false, release_year: 1988 }),
    ]);

    renderDetail();

    expect(
      await screen.findByRole("button", { name: "Show all 2 recordings" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Columbia")).toBeNull();
    expect(screen.queryByText(/first recording/i)).toBeNull();
  });

  it("offers nothing to open when the song has no recordings", async () => {
    renderDetail();

    await screen.findByRole("heading", { name: "Θάλασσα Πλατιά" });
    expect(screen.queryByText("Performed by")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /show all/i })).not.toBeInTheDocument();
  });

  // What each row says is `RecordingList`'s; see RecordingsSheet.test.tsx.
  it("lists every recording in the sheet", async () => {
    const user = userEvent.setup();
    withRecordings([
      makeRecording({ id: "r1" }),
      makeRecording({ id: "r2", is_first: false, release_year: 1988 }),
    ]);

    renderDetail();

    await user.click(await screen.findByRole("button", { name: "Show all 2 recordings" }));

    const sheet = await screen.findByRole("dialog", { name: /recordings/i });
    expect(within(sheet).getAllByRole("listitem")).toHaveLength(2);
  });

  // The sheet renders inside the swiped article, so paging must stand down for
  // it via the modal marking `lib/modal.ts` reads.
  it("leaves the arrow keys to an open recordings sheet", async () => {
    const user = userEvent.setup();
    servePagedList();
    renderDetail({ route: "/songs/song-2?list=list-1" });

    await user.click(await screen.findByRole("button", { name: /show all/i }));
    await screen.findByRole("dialog", { name: /recordings/i });

    await user.keyboard("{ArrowRight}");

    expect(screen.getByRole("heading", { name: "Θάλασσα Πλατιά" })).toBeInTheDocument();
  });

  it("leaves the swipe to an open recordings sheet", async () => {
    const user = userEvent.setup();
    servePagedList();
    renderDetail({ route: "/songs/song-2?list=list-1" });

    await user.click(await screen.findByRole("button", { name: /show all/i }));
    const sheet = await screen.findByRole("dialog", { name: /recordings/i });

    swipe(sheet, 500, 380);

    expect(screen.getByRole("heading", { name: "Θάλασσα Πλατιά" })).toBeInTheDocument();
  });

  // Closing must return focus to the trigger.
  it("returns focus to the control that opened it", async () => {
    const user = userEvent.setup();
    withRecordings([makeRecording(), makeRecording({ id: "r2", is_first: false })]);

    renderDetail();

    const trigger = await screen.findByRole("button", { name: /show all/i });
    await user.click(trigger);
    await screen.findByRole("dialog", { name: /recordings/i });

    await user.click(screen.getByRole("button", { name: "Close" }));

    expect(trigger).toHaveFocus();
  });
});

/* Reading a song from inside a list, named by `?list=` in the URL alone. */
describe("SongDetailPage inside a list", () => {
  const inList = [
    makeSong({ id: "song-1", slug: "first", title: "First" }),
    makeSong({ id: "song-2", slug: "second", title: "Second" }),
    makeSong({ id: "song-3", slug: "third", title: "Third" }),
  ];

  /**
   * Serves list-1 with the given songs, and each song by ref, since the default
   * handler always answers with the same song.
   */
  function serveList(songs = inList) {
    server.use(
      listById(makeList({ id: "list-1", name: "Ρεμπέτικα", songs, item_count: songs.length })),
      http.get(`${API}/api/v1/songs/:id`, ({ params }) => {
        const found = inList.find((song) => songMatchesRef(song, String(params.id)));
        return found ? HttpResponse.json(found) : notFound("Song was not found.");
      }),
    );
  }

  // Both addresses: shared links hold either, and `listPosition` missing one
  // silently drops the bar, swipe and arrow keys.
  it.each([
    ["by id", "/songs/song-2?list=list-1"],
    ["by slug", "/songs/second?list=list-1"],
  ])("shows the list a song is being read from and where it sits in it, %s", async (_, route) => {
    serveList();

    renderDetail({ route });

    expect(await screen.findByRole("link", { name: "Ρεμπέτικα" })).toHaveAttribute(
      "href",
      "/lists/list-1",
    );
    expect(screen.getByText("2 of 3")).toBeInTheDocument();
  });

  // `?list=` must survive the step.
  it("steps to the next song and stays in the list", async () => {
    const user = userEvent.setup();
    serveList();

    renderDetail({ route: "/songs/song-2?list=list-1" });

    await user.click(await screen.findByRole("link", { name: "Next song" }));

    expect(await screen.findByRole("heading", { name: "Third" })).toBeInTheDocument();
    expect(screen.getByText("3 of 3")).toBeInTheDocument();
  });

  /*
   * Steps through a list replace, so one Back leaves it. Only the trail shows
   * that, and each way through says `replace` separately, so each is asserted.
   */

  /** One press of the page's own Back, and the list is behind the reader. */
  async function backLeavesTheList(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("heading", { name: "List page" })).toBeInTheDocument();
  }

  // Two steps: the trail must not grow.
  it("leaves the list on the first Back press, however far the reader stepped", async () => {
    const user = userEvent.setup();
    serveList();

    renderDetail({ route: ["/lists/list-1", "/songs/song-1?list=list-1"] });

    await user.click(await screen.findByRole("link", { name: "Next song" }));
    await screen.findByRole("heading", { name: "Second" });
    await user.click(screen.getByRole("link", { name: "Next song" }));
    await screen.findByRole("heading", { name: "Third" });

    await backLeavesTheList(user);
  });

  it("leaves the list on the first Back press after an arrow-key step", async () => {
    const user = userEvent.setup();
    serveList();

    renderDetail({ route: ["/lists/list-1", "/songs/song-1?list=list-1"] });
    await screen.findByRole("heading", { name: "First" });

    await user.keyboard("{ArrowRight}");
    await screen.findByRole("heading", { name: "Second" });

    await backLeavesTheList(user);
  });

  // The exception: the list's name pushes. Replacing would leave two identical
  // list entries and a Back that appears not to move.
  it("keeps the song behind the list when the bar's own name is pressed", async () => {
    const user = userEvent.setup();
    serveList();

    renderDetail({ route: ["/lists/list-1", "/songs/song-2?list=list-1"] });

    await user.click(await screen.findByRole("link", { name: "Ρεμπέτικα" }));
    await screen.findByRole("heading", { name: "List page" });

    await user.click(screen.getByRole("button", { name: "Back" }));

    expect(await screen.findByRole("heading", { name: "Second" })).toBeInTheDocument();
  });

  // The bar comes from the address, so it stays up while the next song loads.
  it("keeps the list navigation up while the next song loads", async () => {
    serveList();
    const [held, release] = deferred();
    server.use(
      http.get(`${API}/api/v1/songs/:id`, async ({ params }) => {
        await held;
        const found = inList.find((song) => songMatchesRef(song, String(params.id)));
        return found ? HttpResponse.json(found) : notFound("Song was not found.");
      }),
    );

    renderDetail({ route: "/songs/song-2?list=list-1" });

    // The list is not the slow half.
    expect(await screen.findByText("2 of 3")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Next song" })).toBeInTheDocument();

    release();
    expect(await screen.findByRole("heading", { name: "Second" })).toBeInTheDocument();
    expect(screen.getByText("2 of 3")).toBeInTheDocument();
  });

  // The once-per-device swipe mark must not be built before the song arrives.
  // Asserted as nothing being observed, since an unspent pill renders invisibly.
  it("does not spend the swipe mark on a song still in flight", async () => {
    serveList();
    const [held, release] = deferred();
    server.use(
      http.get(`${API}/api/v1/songs/:id`, async ({ params }) => {
        await held;
        const found = inList.find((song) => songMatchesRef(song, String(params.id)));
        return found ? HttpResponse.json(found) : notFound("Song was not found.");
      }),
    );

    renderDetail({ route: "/songs/song-2?list=list-1" });

    await screen.findByText("2 of 3");
    expect(observedElements()).toHaveLength(0);
    // Nothing observed, so an intersection spends nothing either.
    act(() => intersectAll());
    expect(localStorage.getItem("lyrics:swipe-hint-seen")).toBeNull();

    release();
    // The list's card stands in for the song meanwhile, so wait on the swipe.
    await waitFor(() => expect(observedElements()).toHaveLength(1));
  });

  it("steps back with the left arrow key", async () => {
    const user = userEvent.setup();
    serveList();

    renderDetail({ route: "/songs/song-2?list=list-1" });
    await screen.findByRole("heading", { name: "Second" });

    await user.keyboard("{ArrowLeft}");

    expect(await screen.findByRole("heading", { name: "First" })).toBeInTheDocument();
  });

  // An open sheet owns the arrow keys; the nav asks the DOM via `lib/modal.ts`.
  it("leaves the arrow keys to an open sheet", async () => {
    const user = userEvent.setup();
    serveList();

    renderDetail({ route: "/songs/song-2?list=list-1", user: makeUser({ id: "user-1" }) });

    await user.click(await screen.findByRole("button", { name: /add to list/i }));
    await screen.findByRole("dialog", { name: /add to list/i });

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
   * The middle song of the list, open: a gesture read the wrong way round lands
   * on a different song rather than nowhere.
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

  // Left is onward, the way a page turns.
  it("steps on with a swipe left across the song", async () => {
    swipe(await openSecond(), 500, 380);

    expect(await screen.findByRole("heading", { name: "Third" })).toBeInTheDocument();
  });

  it("steps back with a swipe right", async () => {
    swipe(await openSecond(), 500, 620);

    expect(await screen.findByRole("heading", { name: "First" })).toBeInTheDocument();
  });

  // The swipe replaces too; see the trail specs above.
  it("leaves the list on the first Back press after a swipe", async () => {
    const user = userEvent.setup();

    swipe(await openSecond({ route: ["/lists/list-1", "/songs/song-2?list=list-1"] }), 500, 380);
    await screen.findByRole("heading", { name: "Third" });

    await backLeavesTheList(user);
  });

  // Screen edges belong to the browser's back/forward gestures.
  it("leaves a swipe that starts at the screen edge to the browser", async () => {
    const lyrics = await openSecond();

    swipe(lyrics, 8, 300);
    swipe(lyrics, 1020, 700);

    stillOnSecond();
  });

  // Vertical scrolling must not read as a swipe.
  it("leaves a drag that went mostly up or down alone", async () => {
    swipe(await openSecond(), 500, 400, { dy: -260 });

    stillOnSecond();
  });

  // A second finger landing outside the article shows only in the moves' touch
  // count; it is a pinch.
  it("drops the gesture when a second finger joins it", async () => {
    swipe(await openSecond(), 500, 380, { fingers: 2 });

    stillOnSecond();
  });

  // A selection made during the gesture means it was not a swipe.
  it("leaves a movement that selected text alone", async () => {
    const lyrics = await openSecond();
    const line = screen.getByText(/Στης θάλασσας τα βάθη/);

    fireEvent.touchStart(lyrics, { touches: [{ clientX: 500, clientY: 400 }] });
    window.getSelection()?.selectAllChildren(line);
    fireEvent.touchEnd(lyrics, { changedTouches: [{ clientX: 380, clientY: 404 }] });

    stillOnSecond();
  });

  // Extending an existing selection by its handle is refused too, which is why
  // the selected text is compared rather than its presence checked.
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

    // Already selected at touchdown.
    select(5);
    fireEvent.touchStart(lyrics, { touches: [{ clientX: 500, clientY: 400 }] });
    select(15);
    fireEvent.touchEnd(lyrics, { changedTouches: [{ clientX: 380, clientY: 404 }] });

    stillOnSecond();
  });

  // A selection merely left on the page must not block swipes.
  it("still reads a swipe over a selection the reader left behind", async () => {
    const lyrics = await openSecond();
    window.getSelection()?.selectAllChildren(screen.getByText(/Στης θάλασσας τα βάθη/));

    swipe(lyrics, 500, 380);

    expect(await screen.findByRole("heading", { name: "Third" })).toBeInTheDocument();
  });

  // An open sheet owns the gestures; it renders inside the page, so its touches
  // reach the listener and must be turned away.
  it("leaves the swipe to an open sheet", async () => {
    const user = userEvent.setup();
    await openSecond({ user: makeUser({ id: "user-1" }) });

    await user.click(screen.getByRole("button", { name: /add to list/i }));
    const sheet = await screen.findByRole("dialog", { name: /add to list/i });

    swipe(sheet, 500, 380);

    stillOnSecond();
  });

  // A swipe starting on a control does nothing. Swiping back, so a failed guard
  // shows as the previous song rather than the control's own destination.
  it("does not read a swipe that started on a control", async () => {
    await openSecond();

    swipe(screen.getByRole("link", { name: "Next song" }), 500, 620);

    stillOnSecond();
  });

  // The once-per-device swipe mark is spent only when it is actually on screen.
  it("shows the swipe mark when it comes into view, once per device", async () => {
    await openSecond();

    const mark = screen.getByText("Swipe through the list");
    expect(mark).toHaveClass("opacity-0");

    act(() => intersectAll());
    expect(mark).toHaveClass("opacity-100");

    // Once spent, the mark is not built at all.
    cleanup();
    serveList();
    renderDetail({ route: "/songs/song-3?list=list-1" });
    await screen.findByRole("heading", { name: "Third" });

    act(() => intersectAll());
    expect(screen.queryByText("Swipe through the list")).not.toBeInTheDocument();
  });

  // The swipe must outlive the spent mark: the hook runs above the component's
  // early return, and the component must not be made conditional at its call site.
  it("still pages the list on a device that has already seen the mark", async () => {
    localStorage.setItem("lyrics:swipe-hint-seen", "1");

    const lyrics = await openSecond();
    expect(screen.queryByText("Swipe through the list")).not.toBeInTheDocument();

    swipe(lyrics, 500, 380);

    expect(await screen.findByRole("heading", { name: "Third" })).toBeInTheDocument();
  });

  // Every touch listener must be passive: `{ passive: false }` kills vertical
  // scrolling on phones, invisibly in jsdom and on a desktop.
  it("reads every touch passively, so a long song still scrolls", async () => {
    const registered: {
      type: string;
      on: Element;
      options?: boolean | AddEventListenerOptions | undefined;
    }[] = [];
    const original = Element.prototype.addEventListener;
    const spy = vi.spyOn(Element.prototype, "addEventListener").mockImplementation(function (
      this: Element,
      type,
      listener,
      options,
    ) {
      registered.push({ type, on: this, options });
      return original.call(this, type, listener, options);
    });

    try {
      await openSecond();

      // Only the surface's own: React registers its delegated listeners on the root.
      const article = screen.getByRole("article");
      const touches = registered.filter(
        ({ type, on }) => on === article && type.startsWith("touch"),
      );

      // Distinct types: listeners are re-registered as the list settles.
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

  // Past its showing the mark unmounts, after the fade: stepping to a cached song
  // does not remount the page, so a transparent mark would linger.
  it("drops the mark once the fade has run, rather than leaving it invisible", async () => {
    await openSecond();

    // Fake timers before the showing starts, so the dwell and fade use them.
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

  // `md:hidden` must be on the observed box, not the pill, or a desk spends the
  // showing. jsdom applies no CSS, so the class is asserted.
  it("watches the box that has no box at a desk, not the pill inside it", async () => {
    await openSecond();

    const observed = observedElements();
    expect(observed).toHaveLength(1);
    expect(observed[0]).toHaveClass("md:hidden");
    expect(observed[0]).toContainElement(screen.getByText("Swipe through the list"));
  });

  // A list of one has nowhere to swipe, so no mark is built to spend its
  // showing. The bar stays, with the link back to the list.
  it("draws no swipe mark on a list of one, and spends no showing on it", async () => {
    serveList([inList[1]!]);

    renderDetail({ route: "/songs/song-2?list=list-1" });

    // Wait for the song: the swipe is not built before it.
    await screen.findByRole("heading", { name: "Second" });
    expect(screen.getByText("1 of 1")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Next song" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Previous song" })).not.toBeInTheDocument();

    expect(screen.queryByText("Swipe through the list")).not.toBeInTheDocument();
    expect(observedElements()).toHaveLength(0);
    act(() => intersectAll());
    expect(localStorage.getItem("lyrics:swipe-hint-seen")).toBeNull();
  });

  // A song not in the named list still renders, without list navigation.
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

  // The sign-in round trip must carry `?list=`.
  it("keeps the list across the sign-in round trip", async () => {
    const user = userEvent.setup();
    serveList();

    renderDetail({ route: "/songs/song-2?list=list-1", user: null });

    await user.click(await screen.findByRole("button", { name: "Add to list" }));

    expect(await screen.findByText("Return to /songs/song-2?list=list-1")).toBeInTheDocument();
  });

  // A focused search field owns the arrow keys; `useArrowKeyPaging` stands down.
  it("does not page the list while the reader is typing in the search box", async () => {
    const user = userEvent.setup();
    serveList();

    renderDetail({ route: "/songs/song-2?list=list-1" });
    await screen.findByRole("heading", { name: "Second" });

    await user.type(
      screen.getByRole("combobox", { name: /search songs/i }),
      "τρ{ArrowRight}{ArrowLeft}",
    );

    expect(screen.getByRole("heading", { name: "Second" })).toBeInTheDocument();
  });

  // No `?list=`, no list request.
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

describe("SongDetailPage Add to list", () => {
  function serveSheet(membership: () => Response | Promise<Response>) {
    server.use(
      http.get(`${API}/api/v1/lists`, () =>
        HttpResponse.json(
          list([
            makeList({ id: "list-1", name: "Ρεμπέτικα" }),
            makeList({ id: "list-2", name: "Έντεχνα" }),
          ]),
        ),
      ),
      http.get(`${API}/api/v1/songs/:id/lists`, membership),
    );
  }

  it("marks the lists the song is on, and pressing one takes it off", async () => {
    let request = "";
    serveSheet(() => HttpResponse.json({ list_ids: ["list-1"] }));
    server.use(
      http.all(`${API}/api/v1/lists/:listId/songs/:songId`, ({ request: sent, params }) => {
        request = `${sent.method} ${String(params.listId)}`;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderDetail({ user: makeUser() });

    await userEvent.click(await screen.findByRole("button", { name: "Add to list" }));
    const on = await screen.findByRole("button", { name: /Ρεμπέτικα/ });
    expect(on).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Έντεχνα/ })).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    await userEvent.click(on);
    await waitFor(() => expect(request).toBe("DELETE list-1"));
  });

  // Drawn from the lists alone, every row reads as unchecked, and pressing
  // one would add a song that is already there.
  it("offers no list until it knows which ones the song is on", async () => {
    const [held, release] = deferred();
    serveSheet(async () => {
      await held;
      return HttpResponse.json({ list_ids: ["list-1"] });
    });
    renderDetail({ user: makeUser() });

    await userEvent.click(await screen.findByRole("button", { name: "Add to list" }));
    expect(await screen.findByText("Loading")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Ρεμπέτικα/ })).not.toBeInTheDocument();

    release();
    expect(await screen.findByRole("button", { name: /Ρεμπέτικα/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  // Pending lasts until membership is refetched: a second press on the stale
  // state would re-add the song just taken off. A refusal must be said, too.
  it("holds the rows while a change is in flight, and says when it is refused", async () => {
    const [held, release] = deferred();
    serveSheet(() => HttpResponse.json({ list_ids: ["list-1"] }));
    server.use(
      http.all(`${API}/api/v1/lists/:listId/songs/:songId`, async () => {
        await held;
        return apiError(500, "internal", "Something went wrong.");
      }),
    );
    renderDetail({ user: makeUser() });

    await userEvent.click(await screen.findByRole("button", { name: "Add to list" }));
    const on = await screen.findByRole("button", { name: /Ρεμπέτικα/ });
    await userEvent.click(on);

    await waitFor(() => expect(on).toBeDisabled());
    release();
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong.");
    expect(on).toBeEnabled();
  });

  it("says the lists could not be loaded rather than showing every one unchecked", async () => {
    serveSheet(() => apiError(500, "internal", "Something went wrong."));
    renderDetail({ user: makeUser() });

    await userEvent.click(await screen.findByRole("button", { name: "Add to list" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong.");
    expect(screen.queryByRole("button", { name: /Ρεμπέτικα/ })).not.toBeInTheDocument();
  });
});

/** Chooses Delete from the toolbar's "More actions" menu. */
async function chooseDeleteSong() {
  await userEvent.click(await screen.findByRole("button", { name: "More actions" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "Delete song" }));
}

// Exercises the shared `ConfirmSheet`, as does ListsPages' delete spec.
describe("SongDetailPage deletion", () => {
  // Delete is one press further away than it was, behind the menu, and still
  // asks before it acts.
  it("asks before deleting from inside the menu, and hands focus back to it", async () => {
    renderDetail({ user: makeUser({ role: "admin" }) });
    await screen.findByRole("heading", { name: "Θάλασσα Πλατιά" });

    await chooseDeleteSong();

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Delete this song?" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "More actions" })).toHaveFocus());
  });

  it("shows no menu to a reader who cannot delete", async () => {
    renderDetail({ user: makeUser({ role: "contributor" }) });
    await screen.findByRole("heading", { name: "Θάλασσα Πλατιά" });

    expect(screen.queryByRole("button", { name: "More actions" })).not.toBeInTheDocument();
  });

  it("asks before deleting a song, and deletes the one it named", async () => {
    let deleted = "";
    server.use(
      http.delete(`${API}/api/v1/songs/:id`, ({ params }) => {
        deleted = String(params.id);
        return new HttpResponse(null, { status: 204 });
      }),
    );

    renderDetail({ user: makeUser({ role: "admin" }) });

    await chooseDeleteSong();
    expect(screen.getByText(/will be removed for everyone/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(deleted).toBe("song-1"));
    // And the reader does not stay on the song that no longer exists.
    expect(await screen.findByRole("heading", { name: "Catalog" })).toBeInTheDocument();
  });

  // A refused delete must say so in the sheet.
  it("reports a delete the server refused, and forgets it on the way out", async () => {
    server.use(
      http.delete(`${API}/api/v1/songs/:id`, () =>
        HttpResponse.json({ error: { message: "Song is referenced by a list." } }, { status: 409 }),
      ),
    );

    renderDetail({ user: makeUser({ role: "admin" }) });

    await chooseDeleteSong();
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Song is referenced by a list.");
    // The refusal does not survive into the next opening.
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await chooseDeleteSong();

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
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

    await chooseDeleteSong();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByText(/will be removed for everyone/)).not.toBeInTheDocument();
    expect(requested).toBe(false);
  });
});

/*
 * The search box above the song, as placed on this page. The box itself is
 * `SongSearch.test.tsx`'s; the header's rule is `Layout.test.tsx`'s.
 */
describe("SongDetailPage search", () => {
  // Searching again is the way off a song that will not load.
  it("keeps the search box on a song that could not be loaded", async () => {
    server.use(http.get(`${API}/api/v1/songs/:id`, () => notFound("Song was not found.")));

    renderDetail();

    expect(await screen.findByRole("alert")).toHaveTextContent("Song was not found.");
    expect(screen.getByRole("combobox", { name: /search songs/i })).toBeInTheDocument();
  });

  // Open results pin the header: on iOS, focusing the field scrolls the page.
  it("holds the header still while the results are up", async () => {
    const user = userEvent.setup();

    // By element, not role: a <header> inside <main> is no banner.
    const { container } = renderDetail();
    await screen.findByRole("heading", { name: "Θάλασσα Πλατιά" });
    const header = container.querySelector("header");

    await user.type(screen.getByRole("combobox", { name: /search songs/i }), "θα");
    await screen.findByRole("listbox");
    scrollDown();

    // `toHaveClass`, which fails on a missing header too.
    expect(header).not.toHaveClass("max-md:-translate-y-full");
  });

  /*
   * jsdom has no breakpoints, so the `max-md:` classes are the readable form
   * of what a phone draws. There the bottom bar's Search is the way to another
   * song, and the song takes the room the search header had.
   */
  it("leaves the search header off on a phone", async () => {
    renderDetail();
    await screen.findByRole("heading", { name: "Θάλασσα Πλατιά" });

    const header = screen.getByRole("combobox", { name: /search songs/i }).closest("header");
    expect(header?.parentElement).toHaveClass("max-md:hidden");
  });
});

/*
 * On a phone, Back and the tools are one thin sticky bar, which gets out of
 * the way on the way down with the rest of the phone's chrome.
 */
describe("SongDetailPage tools bar on a phone", () => {
  const toolsBar = () =>
    screen.getByRole("button", { name: "Stats" }).closest("[data-sticky-header]") as HTMLElement;
  const tucked = () => document.documentElement.hasAttribute(CHROME_TUCKED_ATTRIBUTE);

  // `StickyHeader`'s chrome, under `max-md:` alone.
  it("is sticky on a phone, and only there", async () => {
    renderDetail();
    await screen.findByRole("heading", { name: "Θάλασσα Πλατιά" });

    expect(toolsBar()).toContainElement(screen.getByRole("button", { name: "Back" }));
    expect(toolsBar()).toHaveClass("max-md:sticky-bar");
    expect(toolsBar()).not.toHaveClass("sticky-bar");
  });

  // index.css slides it by the attribute on <html>, and never while it holds
  // focus; the specs for that rule are `StickyHeader`'s.
  it("hides on the way down and returns on the way up", async () => {
    renderDetail();
    await screen.findByRole("heading", { name: "Θάλασσα Πλατιά" });
    expect(toolsBar()).toHaveClass("max-md:chrome-follows", "max-md:chrome-slides-up");

    scrollDown();
    expect(tucked()).toBe(true);

    scrollUp();
    expect(tucked()).toBe(false);
  });

  // The page holds the lyrics, the tools and the sheets: a re-render of it on
  // every change of scroll direction is what drawing the tuck in CSS avoids.
  it("renders nothing for a tuck", async () => {
    const commits = vi.fn();
    renderWithProviders(
      <TestRoutes
        routes={{
          "/songs/:id": (
            <Profiler id="song" onRender={commits}>
              <SongDetailPage />
            </Profiler>
          ),
        }}
      />,
      { route: "/songs/song-1" },
    );
    // The lyrics: the full read, not the cached card.
    await screen.findByText("η αγάπη μου κοιμάται");
    // Whatever was still settling (the session, the click count) lands first.
    await new Promise((resolve) => setTimeout(resolve, 50));
    commits.mockClear();

    scrollDown();
    expect(tucked()).toBe(true);
    scrollUp();
    expect(tucked()).toBe(false);

    expect(commits).not.toHaveBeenCalled();
  });
});

describe("SongDetailPage credits", () => {
  // As a record sleeve prints them: after the title, before the words, at
  // every width, with no column of their own beside the lyrics.
  it("come after the title and before the lyrics", async () => {
    renderDetail();

    const title = await screen.findByRole("heading", { name: "Θάλασσα Πλατιά" });
    const details = screen.getByRole("complementary", { name: "Song details" });
    const lyrics = screen.getByRole("region", { name: "Lyrics" });
    expect(title.compareDocumentPosition(details)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(details.compareDocumentPosition(lyrics)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(within(details).getByText("Μίκης Θεοδωράκης")).toBeInTheDocument();
  });

  // Two rules around nothing, and an empty landmark, would say less than none.
  it("draws no band for a song with nothing to say", async () => {
    server.use(
      http.get(`${API}/api/v1/songs/:id`, () =>
        HttpResponse.json(makeSong({ credits: [], release_year: null })),
      ),
    );

    renderDetail();

    await screen.findByRole("heading", { name: "Θάλασσα Πλατιά" });
    expect(screen.queryByRole("complementary", { name: "Song details" })).not.toBeInTheDocument();
  });

  // Started on one song, the player does not keep playing it under the next.
  // The next song is a card already in the cache, so the page stays up through
  // the step and only the reset can put the player away.
  it("puts the player away when the address moves to another song", async () => {
    const user = userEvent.setup();
    const { lyrics: _lyrics, ...next } = makeSong({
      id: "song-2",
      slug: "song-2",
      title: "Άλλο",
      youtube_video_id: "abcdefghijk",
    });
    const queryClient = testQueryClient();
    server.use(
      http.get(`${API}/api/v1/songs/:id`, ({ params }) =>
        params.id === "song-2"
          ? new Promise(() => {})
          : HttpResponse.json(makeSong({ youtube_video_id: "dQw4w9WgXcQ" })),
      ),
    );
    const router = renderWithRouter(queryClient);

    await user.click(await screen.findByRole("button", { name: "Watch" }));
    expect(document.querySelector("iframe")).not.toBeNull();

    stepTo(router, queryClient, next);

    await screen.findByRole("heading", { name: "Άλλο" });
    expect(document.querySelector("iframe")).toBeNull();
    expect(screen.getByRole("button", { name: "Watch" })).toHaveAttribute("aria-expanded", "false");
  });
});
