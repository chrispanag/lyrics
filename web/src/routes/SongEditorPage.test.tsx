import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it, vi } from "vitest";
import { Route, Routes, createPath, useLocation } from "react-router-dom";

import { SongEditorPage } from "./SongEditorPage";
import { BackButton } from "@/components/BackButton";
import type { SongInput } from "@/lib/types";
import { API, makeRecording, makeSong, makeUser } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

/**
 * Stands in for the song page the editor is opened from and returns to.
 *
 * It names the address it was reached at, because "the song page" is not what
 * these specs are about — *which* song page is, down to the query string that
 * says which list the song is being read from. The back control is here for the
 * same reason: whether an entry was pushed or replaced is invisible in the
 * address, and pressing Back is the only way to see it. It is the real
 * `BackButton`, the one the song page ships, so what these specs press is the
 * control a reader presses rather than a second opinion about what it does.
 */
function SongStub() {
  return (
    <div>
      <h1>Song page</h1>
      <p>Address: {createPath(useLocation())}</p>
      <BackButton />
    </div>
  );
}

function renderEditor(options: Parameters<typeof renderWithProviders>[1] = {}) {
  return renderWithProviders(
    <Routes>
      <Route path="/songs/new" element={<SongEditorPage />} />
      <Route path="/songs/:id/edit" element={<SongEditorPage />} />
      <Route path="/songs/:id" element={<SongStub />} />
      <Route path="/lists/:id" element={<h1>List page</h1>} />
      <Route path="/" element={<h1>Catalog</h1>} />
    </Routes>,
    { user: makeUser({ role: "admin" }), ...options },
  );
}

const savesTheSong = http.patch(`${API}/api/v1/songs/:id`, () => HttpResponse.json(makeSong()));

async function save() {
  await userEvent.click(await screen.findByRole("button", { name: "Save changes" }));
}

describe("SongEditorPage", () => {
  // The trail is what is pinned here, not the address alone: the address was
  // right the whole time the duplicate entry made Back take two presses.
  it("returns a saved edit to the page it was opened from, list and all", async () => {
    server.use(savesTheSong);
    renderEditor({ route: ["/lists/list-1", "/songs/song-1?list=list-1", "/songs/song-1/edit"] });

    await save();

    expect(await screen.findByText("Address: /songs/song-1?list=list-1")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("heading", { name: "List page" })).toBeInTheDocument();
  });

  it("returns a canceled edit to the page it was opened from, list and all", async () => {
    renderEditor({ route: ["/lists/list-1", "/songs/song-1?list=list-1", "/songs/song-1/edit"] });

    await userEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(await screen.findByText("Address: /songs/song-1?list=list-1")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("heading", { name: "List page" })).toBeInTheDocument();
  });

  // Opening the editor's address in a fresh tab is the one way in with nothing
  // behind it. Popping there would leave the site, so the song is navigated to —
  // and replaces the editor, or Back returns to a form already saved.
  it("sends a deep-linked edit to the song and leaves no form behind it", async () => {
    server.use(savesTheSong);
    renderEditor({ route: "/songs/song-1/edit" });

    await save();
    // The address it came in on, verbatim — which is what deriving the fallback
    // from the route parameter buys, rather than building one from the song.
    expect(await screen.findByText("Address: /songs/song-1")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByText("Address: /songs/song-1")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Edit song" })).not.toBeInTheDocument();
  });

  it("sends a deep-linked cancel to the song rather than off the site", async () => {
    renderEditor({ route: "/songs/song-1/edit" });

    await userEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(await screen.findByText("Address: /songs/song-1")).toBeInTheDocument();
  });

  // The other half of that fallback, and the half with no song to name: the add
  // form deep-linked into a fresh tab has neither a page behind it nor an id, so
  // the catalog is where canceling has to land.
  it("sends a deep-linked cancel on the add form to the catalog", async () => {
    renderEditor({ route: "/songs/new" });

    await userEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(await screen.findByRole("heading", { name: "Catalog" })).toBeInTheDocument();
  });

  // Adding a song is the one save that does not go back — the reader has to land
  // on what they created, not on the catalog they opened the form from — so this
  // one replaces its own entry, and Back reaches the catalog past the form.
  it("replaces the add form with the song it created", async () => {
    server.use(http.post(`${API}/api/v1/songs`, () => HttpResponse.json(makeSong())));
    renderEditor({ route: ["/", "/songs/new"] });

    await userEvent.type(await screen.findByLabelText("Title"), "Καινούριο");
    await userEvent.click(screen.getByRole("button", { name: "Add song" }));

    // The created song's *slug*, not its id: a reader is landed on an address,
    // and the fixture keeps a song's two identifiers deliberately different so
    // this cannot pass against code that confuses them.
    expect(await screen.findByText("Address: /songs/thalassa-platia")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("heading", { name: "Catalog" })).toBeInTheDocument();
  });

  // Which shapes are recognized is `extractVideoId`'s own spec, in
  // `lib/youtube.test.ts` — what these two pin is that a recording's link field
  // is wired to it at all, in both directions. A field wired to nothing passes
  // every shape spec in that file and previews neither of these.
  it("previews a recognized link on a recording", async () => {
    renderEditor({ route: "/songs/new" });

    await userEvent.click(await screen.findByRole("button", { name: /add recording/i }));
    await userEvent.type(
      screen.getByLabelText("YouTube link"),
      "https://youtu.be/dQw4w9WgXcQ?si=abc123",
    );

    expect(screen.getByRole("link", { name: /watch on youtube/i })).toHaveAttribute(
      "href",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    );
  });

  it("shows no preview for a link the server would refuse", async () => {
    renderEditor({ route: "/songs/new" });

    await userEvent.click(await screen.findByRole("button", { name: /add recording/i }));
    await userEvent.type(
      screen.getByLabelText("YouTube link"),
      "https://www.youtube.com/playlist?list=PLdQw4w9WgXcQ",
    );

    expect(screen.queryByRole("link", { name: /watch on youtube/i })).not.toBeInTheDocument();
  });

  // The payload was untested before recordings existed, and it is where every
  // save-time rule lives: blank rows dropped, positions derived from the array,
  // a person named by id or by name but never both — and, now, the absence of
  // the two fields that moved onto recordings.
  it("sends recordings, dropping blank rows and deriving positions", async () => {
    let body: SongInput | undefined;
    server.use(
      http.post(`${API}/api/v1/songs`, async ({ request }) => {
        body = (await request.json()) as SongInput;
        return HttpResponse.json(makeSong());
      }),
    );
    renderEditor({ route: "/songs/new" });

    await userEvent.type(await screen.findByLabelText("Title"), "Καινούριο");

    // One recording worth keeping, and one abandoned empty row after it.
    await userEvent.click(screen.getByRole("button", { name: /add recording/i }));
    await userEvent.type(screen.getByLabelText("Year"), "1964");
    await userEvent.click(screen.getByRole("button", { name: /add performer/i }));
    await userEvent.type(screen.getByPlaceholderText("Name"), "Γιώργος Νταλάρας");
    await userEvent.click(
      screen.getByLabelText("Mark recording 1 as the first recording"),
    );
    await userEvent.click(screen.getByRole("button", { name: /add recording/i }));

    await userEvent.click(screen.getByRole("button", { name: "Add song" }));

    await vi.waitFor(() => expect(body).toBeDefined());
    expect(body?.recordings).toEqual([
      {
        label: null,
        youtube_url: null,
        release_year: 1964,
        notes: null,
        is_first: true,
        position: 0,
        performers: [{ name: "Γιώργος Νταλάρας", position: 0 }],
      },
    ]);
    // The link and the year are the recording's now. Sent at the top level they
    // are a 400, so their absence here is part of the contract rather than tidy.
    expect(body).not.toHaveProperty("youtube_url");
    expect(body).not.toHaveProperty("release_year");
  });

  // At most one recording may claim to be the first — the database enforces it
  // with a unique index — so the control is a radio group and marking a second
  // has to unmark the first rather than produce a payload the server refuses.
  it("lets only one recording be marked as the first", async () => {
    let body: SongInput | undefined;
    server.use(
      http.post(`${API}/api/v1/songs`, async ({ request }) => {
        body = (await request.json()) as SongInput;
        return HttpResponse.json(makeSong());
      }),
    );
    renderEditor({ route: "/songs/new" });

    await userEvent.type(await screen.findByLabelText("Title"), "Δύο Εκτελέσεις");
    for (const year of ["1964", "1988"]) {
      await userEvent.click(screen.getByRole("button", { name: /add recording/i }));
      const years = screen.getAllByLabelText("Year");
      await userEvent.type(years[years.length - 1]!, year);
    }

    await userEvent.click(screen.getByLabelText("Mark recording 1 as the first recording"));
    await userEvent.click(screen.getByLabelText("Mark recording 2 as the first recording"));
    await userEvent.click(screen.getByRole("button", { name: "Add song" }));

    await vi.waitFor(() => expect(body).toBeDefined());
    expect(body!.recordings.map((recording) => recording.is_first)).toEqual([false, true]);
  });

  // All-false is a state the data really holds: the mark is a claim about
  // history, and a contributor who cannot make it has to be able to say so. A
  // radio group cannot be cleared by pressing a member again, hence the extra
  // option.
  it("can leave every recording unmarked", async () => {
    let body: SongInput | undefined;
    server.use(
      http.post(`${API}/api/v1/songs`, async ({ request }) => {
        body = (await request.json()) as SongInput;
        return HttpResponse.json(makeSong());
      }),
    );
    renderEditor({ route: "/songs/new" });

    await userEvent.type(await screen.findByLabelText("Title"), "Άγνωστη Πρώτη");
    await userEvent.click(screen.getByRole("button", { name: /add recording/i }));
    await userEvent.type(screen.getByLabelText("Year"), "1964");

    await userEvent.click(screen.getByLabelText("Mark recording 1 as the first recording"));
    await userEvent.click(screen.getByLabelText("No recording marked as first"));
    await userEvent.click(screen.getByRole("button", { name: "Add song" }));

    await vi.waitFor(() => expect(body).toBeDefined());
    expect(body!.recordings[0]!.is_first).toBe(false);
  });

  // A stored link this app cannot parse is a real thing — the importer kept
  // whatever it was given — and the server carries such a value through a save
  // that resends it unchanged. So the field must hydrate it verbatim and send it
  // back untouched, with the preview simply staying dark: the preview is
  // confirmation, never a gate.
  it("round-trips a stored link it cannot parse", async () => {
    const stored = "https://youtube.com/watch?feature=share";
    let body: SongInput | undefined;
    server.use(
      http.get(`${API}/api/v1/songs/song-1`, () =>
        HttpResponse.json(
          makeSong({
            recordings: [makeRecording({ youtube_url: stored, youtube_video_id: null })],
          }),
        ),
      ),
      http.patch(`${API}/api/v1/songs/song-1`, async ({ request }) => {
        body = (await request.json()) as SongInput;
        return HttpResponse.json(makeSong());
      }),
    );
    renderEditor({ route: "/songs/song-1/edit" });

    expect(await screen.findByLabelText("YouTube link")).toHaveValue(stored);
    expect(screen.queryByRole("link", { name: /watch on youtube/i })).not.toBeInTheDocument();

    await save();

    await vi.waitFor(() => expect(body).toBeDefined());
    expect(body!.recordings[0]!.youtube_url).toBe(stored);
  });

  // The hydration gate is keyed on the song's id, not on the object: react-query
  // hands back a fresh one on every refetch, and an effect that re-ran then
  // would overwrite a recording being edited and reset the unsaved-changes
  // guard with it.
  it("keeps an edited recording through a refetch", async () => {
    server.use(
      http.get(`${API}/api/v1/songs/song-1`, () =>
        HttpResponse.json(makeSong({ recordings: [makeRecording()] })),
      ),
      savesTheSong,
    );
    const { queryClient } = renderEditor({ route: "/songs/song-1/edit" });

    const label = await screen.findByLabelText("Label");
    await userEvent.type(label, "Live στο Λυκαβηττό");

    await queryClient.refetchQueries({ queryKey: ["song"] });

    expect(screen.getByLabelText("Label")).toHaveValue("Live στο Λυκαβηττό");
  });

  // A field error has to land on the row that earned it, and the row's index in
  // the form is not the index the server counted: blank rows are dropped from
  // the payload, so the server keys `recordings[0]` on what is Recording 2 here.
  // Read by the draft index instead, the message appears under the empty row —
  // which has no link in it at all — and the row that does looks fine. Both
  // halves are asserted, because the wrong-row version satisfies "the message is
  // on screen" perfectly.
  it("puts a recording's error on the row the server counted", async () => {
    server.use(
      http.post(`${API}/api/v1/songs`, () =>
        HttpResponse.json(
          {
            error: {
              code: "validation_failed",
              message: "The song could not be saved.",
              details: { "recordings[0].youtube_url": "Not a recognizable YouTube link." },
            },
          },
          { status: 422 },
        ),
      ),
    );
    renderEditor({ route: "/songs/new" });

    await userEvent.type(await screen.findByLabelText("Title"), "Λάθος Σύνδεσμος");
    // An abandoned empty row, then the one carrying the bad link.
    await userEvent.click(screen.getByRole("button", { name: /add recording/i }));
    await userEvent.click(screen.getByRole("button", { name: /add recording/i }));
    const links = screen.getAllByLabelText("YouTube link");
    await userEvent.type(links[1]!, "https://vimeo.com/123");

    await userEvent.click(screen.getByRole("button", { name: "Add song" }));

    const message = await screen.findByText("Not a recognizable YouTube link.");
    expect(links[1]!).toHaveAttribute("aria-describedby", message.id);
    expect(links[0]!).not.toHaveAttribute("aria-describedby", message.id);
  });
});
