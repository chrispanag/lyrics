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
 * Stands in for the song page the editor returns to. It names the address it
 * was reached at, query included, and carries the real `BackButton`, since
 * push versus replace is only visible by pressing Back.
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
  // Pins the trail, not just the address: a duplicate entry keeps the address right.
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

  // A fresh tab has nothing behind it, so the editor replaces itself with the song.
  it("sends a deep-linked edit to the song and leaves no form behind it", async () => {
    server.use(savesTheSong);
    renderEditor({ route: "/songs/song-1/edit" });

    await save();
    // The address it came in on, verbatim.
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

  // The add form in a fresh tab has no song to fall back to, so cancel lands on
  // the catalog.
  it("sends a deep-linked cancel on the add form to the catalog", async () => {
    renderEditor({ route: "/songs/new" });

    await userEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(await screen.findByRole("heading", { name: "Catalog" })).toBeInTheDocument();
  });

  // Adding a song lands on it, replacing the form, so Back reaches the catalog.
  it("replaces the add form with the song it created", async () => {
    server.use(http.post(`${API}/api/v1/songs`, () => HttpResponse.json(makeSong())));
    renderEditor({ route: ["/", "/songs/new"] });

    await userEvent.type(await screen.findByLabelText("Title"), "Καινούριο");
    await userEvent.click(screen.getByRole("button", { name: "Add song" }));

    // The slug, not the id; the fixture keeps them distinct.
    expect(await screen.findByText("Address: /songs/thalassa-platia")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("heading", { name: "Catalog" })).toBeInTheDocument();
  });

  // Link shapes are `lib/youtube.test.ts`'s; these pin that the field is wired to
  // `extractVideoId` at all.
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

  // Save-time rules: blank rows dropped, positions from the array, a person by id
  // or by name but never both, and no song-level link or year.
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
    await userEvent.click(screen.getByLabelText("Mark recording 1 as the first recording"));
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
    // Sent at the top level, the link and year are a 400.
    expect(body).not.toHaveProperty("youtube_url");
    expect(body).not.toHaveProperty("release_year");
  });

  // At most one recording may be first, so marking a second unmarks the first.
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

  // All-false is a real state, and a radio cannot be unpressed: hence "none".
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

  // An unparseable stored link hydrates and resends verbatim; the preview stays
  // dark and never gates the save.
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

  // Hydration is keyed on the song's id: a refetch's fresh object must not
  // overwrite unsaved edits.
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

  // Typing after a pick names somebody else: the picked id must not ride along
  // and outrank the text, or the save credits the person who was picked.
  it("sends a retyped name rather than the person it replaced", async () => {
    let body: SongInput | undefined;
    server.use(
      http.get(`${API}/api/v1/songs/song-1`, () =>
        HttpResponse.json(makeSong({ recordings: [makeRecording()] })),
      ),
      http.patch(`${API}/api/v1/songs/song-1`, async ({ request }) => {
        body = (await request.json()) as SongInput;
        return HttpResponse.json(makeSong());
      }),
    );
    renderEditor({ route: "/songs/song-1/edit" });

    const [credit, performer] = await screen.findAllByPlaceholderText("Name");
    await userEvent.clear(credit!);
    await userEvent.type(credit!, "Μάνος Χατζιδάκις");
    await userEvent.clear(performer!);
    await userEvent.type(performer!, "Μαρία Φαραντούρη");

    await save();

    await vi.waitFor(() => expect(body).toBeDefined());
    expect(body!.credits).toEqual([{ name: "Μάνος Χατζιδάκις", role: "composer", position: 0 }]);
    expect(body!.recordings[0]!.performers).toEqual([{ name: "Μαρία Φαραντούρη", position: 0 }]);
  });

  // Blank rows are not sent, so the server's `recordings[0]` is Recording 2 here.
  // Both rows are asserted: the error shown on the wrong row is still on screen.
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
