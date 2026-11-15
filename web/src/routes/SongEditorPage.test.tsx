import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it, vi } from "vitest";

import { SongEditorPage } from "./SongEditorPage";
import { BackButton } from "@/components/BackButton";
import type { Song, SongInput } from "@/lib/types";
import { API, apiError, list, makeGenre, makeRecording, makeSong, makeUser } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";
import { CurrentAddress, TestRoutes } from "@/test/routes";
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
      <CurrentAddress label="Address:" />
      <BackButton />
    </div>
  );
}

function renderEditor(options: Parameters<typeof renderWithProviders>[1] = {}) {
  return renderWithProviders(
    <TestRoutes
      routes={{
        "/songs/new": <SongEditorPage />,
        "/songs/:id/edit": <SongEditorPage />,
        "/songs/:id": <SongStub />,
        "/lists/:id": <h1>List page</h1>,
        "/": <h1>Catalog</h1>,
      }}
    />,
    { user: makeUser({ role: "admin" }), ...options },
  );
}

const savesTheSong = http.patch(`${API}/api/v1/songs/:id`, () => HttpResponse.json(makeSong()));

async function save() {
  await userEvent.click(await screen.findByRole("button", { name: "Save changes" }));
}

/**
 * Captures what the editor saves. Given a song, `song-1` is served as that song
 * and the save is its PATCH; with none, the save is the add form's POST. The
 * returned getter waits for the request and hands back its body.
 */
function captureSave(song?: Song) {
  let body: SongInput | undefined;
  const capture = async ({ request }: { request: Request }) => {
    body = (await request.json()) as SongInput;
    return HttpResponse.json(makeSong());
  };
  server.use(
    ...(song
      ? [
          http.get(`${API}/api/v1/songs/song-1`, () => HttpResponse.json(song)),
          http.patch(`${API}/api/v1/songs/song-1`, capture),
        ]
      : [http.post(`${API}/api/v1/songs`, capture)]),
  );
  return async () => {
    await vi.waitFor(() => expect(body).toBeDefined());
    return body!;
  };
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
    const sent = captureSave();
    renderEditor({ route: "/songs/new" });

    await userEvent.type(await screen.findByLabelText("Title"), "Καινούριο");

    // One recording worth keeping, and one abandoned empty row after it.
    await userEvent.click(screen.getByRole("button", { name: /add recording/i }));
    await userEvent.type(screen.getByLabelText("Year"), "1964");
    await userEvent.click(screen.getByRole("button", { name: /add performer/i }));
    await userEvent.type(
      screen.getByLabelText("Name of performer 1 on recording 1"),
      "Γιώργος Νταλάρας",
    );
    await userEvent.click(screen.getByLabelText("Mark recording 1 as the first recording"));
    await userEvent.click(screen.getByRole("button", { name: /add recording/i }));

    await userEvent.click(screen.getByRole("button", { name: "Add song" }));

    const body = await sent();
    expect(body.recordings).toEqual([
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
    const sent = captureSave();
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

    const body = await sent();
    expect(body.recordings.map((recording) => recording.is_first)).toEqual([false, true]);
  });

  // All-false is a real state, and a radio cannot be unpressed: hence "none".
  it("can leave every recording unmarked", async () => {
    const sent = captureSave();
    renderEditor({ route: "/songs/new" });

    await userEvent.type(await screen.findByLabelText("Title"), "Άγνωστη Πρώτη");
    await userEvent.click(screen.getByRole("button", { name: /add recording/i }));
    await userEvent.type(screen.getByLabelText("Year"), "1964");

    await userEvent.click(screen.getByLabelText("Mark recording 1 as the first recording"));
    await userEvent.click(screen.getByLabelText("No recording marked as first"));
    await userEvent.click(screen.getByRole("button", { name: "Add song" }));

    const body = await sent();
    expect(body.recordings[0]!.is_first).toBe(false);
  });

  // An unparseable stored link hydrates and resends verbatim; the preview stays
  // dark and never gates the save.
  it("round-trips a stored link it cannot parse", async () => {
    const stored = "https://youtube.com/watch?feature=share";
    const sent = captureSave(
      makeSong({
        recordings: [makeRecording({ youtube_url: stored, youtube_video_id: null })],
      }),
    );
    renderEditor({ route: "/songs/song-1/edit" });

    expect(await screen.findByLabelText("YouTube link")).toHaveValue(stored);
    expect(screen.queryByRole("link", { name: /watch on youtube/i })).not.toBeInTheDocument();

    await save();

    const body = await sent();
    expect(body.recordings[0]!.youtube_url).toBe(stored);
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
    const sent = captureSave(makeSong({ recordings: [makeRecording()] }));
    renderEditor({ route: "/songs/song-1/edit" });

    const credit = await screen.findByLabelText("Name for credit 1");
    const performer = screen.getByLabelText("Name of performer 1 on recording 1");
    await userEvent.clear(credit);
    await userEvent.type(credit, "Μάνος Χατζιδάκις");
    await userEvent.clear(performer);
    await userEvent.type(performer, "Μαρία Φαραντούρη");

    await save();

    const body = await sent();
    expect(body.credits).toEqual([{ name: "Μάνος Χατζιδάκις", role: "composer", position: 0 }]);
    expect(body.recordings[0]!.performers).toEqual([{ name: "Μαρία Φαραντούρη", position: 0 }]);
  });

  // Blank rows are not sent, so the server's `recordings[0]` is Recording 2 here.
  // Both rows are asserted: the error shown on the wrong row is still on screen.
  it("puts a recording's error on the row the server counted", async () => {
    server.use(
      http.post(`${API}/api/v1/songs`, () =>
        apiError(422, "validation_failed", "The song could not be saved.", {
          "recordings[0].youtube_url": "Not a recognizable YouTube link.",
        }),
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

  // Every save sends the whole song, so a field that fails to hydrate is blanked
  // by the next save of anything else.
  it("resends an untouched song exactly as it was stored", async () => {
    server.use(http.get(`${API}/api/v1/genres`, () => HttpResponse.json(list([makeGenre()]))));
    const sent = captureSave(
      makeSong({
        alt_title: "Thalassa Platia",
        notes: "Από το «Μικρές Κυκλάδες».",
        credits: [
          { person_id: "person-1", name: "Μίκης Θεοδωράκης", role: "composer", position: 0 },
          { person_id: "person-3", name: "Οδυσσέας Ελύτης", role: "lyricist", position: 1 },
        ],
        genres: [makeGenre({ id: "genre-1" })],
        // A recording with no year is the common case.
        recordings: [makeRecording({ release_year: null, label: "Live", notes: "Ηρώδειο" })],
      }),
    );
    renderEditor({ route: "/songs/song-1/edit" });

    await save();

    const body = await sent();
    expect(body).toEqual({
      title: "Θάλασσα Πλατιά",
      alt_title: "Thalassa Platia",
      lyrics: "Στης θάλασσας τα βάθη\nη αγάπη μου κοιμάται",
      language: "el",
      notes: "Από το «Μικρές Κυκλάδες».",
      credits: [
        { person_id: "person-1", role: "composer", position: 0 },
        { person_id: "person-3", role: "lyricist", position: 1 },
      ],
      genre_ids: ["genre-1"],
      recordings: [
        {
          label: "Live",
          youtube_url: null,
          release_year: null,
          notes: "Ηρώδειο",
          is_first: true,
          position: 0,
          performers: [{ person_id: "person-2", position: 0 }],
        },
      ],
    });
  });

  it("sends the song's own fields as edited, blanks as null", async () => {
    const sent = captureSave(makeSong({ alt_title: "Old", notes: "Old notes" }));
    renderEditor({ route: "/songs/song-1/edit" });

    const title = await screen.findByLabelText("Title");
    await userEvent.clear(title);
    await userEvent.type(title, "  Sea  ");
    expect(screen.getByLabelText("Alternative title")).toHaveAccessibleDescription(
      "Optional — a transliteration or a well-known variant",
    );
    expect(screen.getByLabelText("Notes")).toHaveAccessibleDescription(
      "Optional — context, sources, or variations",
    );
    // Whitespace alone is no alternative title, and no notes.
    await userEvent.clear(screen.getByLabelText("Alternative title"));
    await userEvent.type(screen.getByLabelText("Alternative title"), "   ");
    await userEvent.clear(screen.getByLabelText("Notes"));
    await userEvent.selectOptions(screen.getByLabelText("Language"), "en");
    const lyrics = screen.getByLabelText("Lyrics");
    await userEvent.clear(lyrics);
    await userEvent.type(lyrics, "  Line one");

    await save();

    const body = await sent();
    expect(body).toMatchObject({
      title: "Sea",
      alt_title: null,
      notes: null,
      language: "en",
      // Lyrics are sent verbatim: leading spaces can be hand-aligned verse.
      lyrics: "  Line one",
    });
  });

  // Positions come from the array, so removing a row renumbers what follows.
  it("sends credits as edited: role changed, row removed, row added, blank dropped", async () => {
    const sent = captureSave(
      makeSong({
        credits: [
          { person_id: "person-1", name: "Μίκης Θεοδωράκης", role: "composer", position: 0 },
          { person_id: "person-3", name: "Οδυσσέας Ελύτης", role: "composer", position: 1 },
        ],
      }),
    );
    renderEditor({ route: "/songs/song-1/edit" });

    await userEvent.selectOptions(await screen.findByLabelText("Role for credit 2"), "lyricist");
    await userEvent.click(screen.getByRole("button", { name: "Remove credit 1" }));
    await userEvent.click(screen.getByRole("button", { name: "Add credit" }));
    await userEvent.type(screen.getByLabelText("Name for credit 2"), "  Νίκος Γκάτσος ");
    // An abandoned add.
    await userEvent.click(screen.getByRole("button", { name: "Add credit" }));

    await save();

    const body = await sent();
    expect(body.credits).toEqual([
      { person_id: "person-3", role: "lyricist", position: 0 },
      { name: "Νίκος Γκάτσος", role: "composer", position: 1 },
    ]);
  });

  it("toggles genres on and off", async () => {
    server.use(
      http.get(`${API}/api/v1/genres`, () =>
        HttpResponse.json(
          list([
            makeGenre({ id: "genre-1", name: "Ρεμπέτικο" }),
            makeGenre({ id: "genre-2", name: "Έντεχνο", slug: "entechno" }),
          ]),
        ),
      ),
    );
    const sent = captureSave(makeSong({ genres: [makeGenre({ id: "genre-1" })] }));
    renderEditor({ route: "/songs/song-1/edit" });

    const rempetiko = await screen.findByRole("button", { name: "Ρεμπέτικο" });
    const entechno = screen.getByRole("button", { name: "Έντεχνο" });
    expect(rempetiko).toHaveAttribute("aria-pressed", "true");
    expect(entechno).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(rempetiko);
    await userEvent.click(entechno);
    expect(rempetiko).toHaveAttribute("aria-pressed", "false");
    expect(entechno).toHaveAttribute("aria-pressed", "true");

    await save();

    const body = await sent();
    expect(body.genre_ids).toEqual(["genre-2"]);
  });

  it("says so when no genres exist rather than showing an empty row", async () => {
    renderEditor({ route: "/songs/new" });

    expect(await screen.findByText("No genres exist yet.")).toBeInTheDocument();
  });

  // Removing the marked recording needs no rule about who inherits the mark.
  it("drops a removed recording and a removed performer from the save", async () => {
    const sent = captureSave(
      makeSong({
        recordings: [
          makeRecording({ id: "recording-1", release_year: 1964 }),
          makeRecording({
            id: "recording-2",
            release_year: 1988,
            is_first: false,
            performers: [
              { person_id: "person-2", name: "Γιώργος Νταλάρας", position: 0 },
              { person_id: "person-4", name: "Μαρία Φαραντούρη", position: 1 },
            ],
          }),
        ],
      }),
    );
    renderEditor({ route: "/songs/song-1/edit" });

    await userEvent.click(await screen.findByRole("button", { name: "Remove recording 1" }));
    // What was Recording 2 is Recording 1 now.
    await userEvent.click(
      screen.getByRole("button", { name: "Remove performer 1 from recording 1" }),
    );
    await userEvent.type(
      screen.getByLabelText("Notes", { selector: "#recording-0-notes" }),
      "Ζωντανά",
    );

    expect(screen.getByLabelText("No recording marked as first")).toBeChecked();

    await save();

    const body = await sent();
    expect(body.recordings).toEqual([
      {
        label: null,
        youtube_url: null,
        release_year: 1988,
        notes: "Ζωντανά",
        is_first: false,
        position: 0,
        performers: [{ person_id: "person-4", position: 0 }],
      },
    ]);
  });

  // Each message is asserted through the control it describes: a message that
  // renders but is not wired up is invisible to a screen reader.
  it("puts the server's field errors beside the fields they name", async () => {
    server.use(
      http.get(`${API}/api/v1/songs/song-1`, () =>
        HttpResponse.json(makeSong({ recordings: [makeRecording()] })),
      ),
      http.patch(`${API}/api/v1/songs/song-1`, () =>
        apiError(422, "validation_failed", "The song could not be saved.", {
          title: "Title is required.",
          language: "Language is not supported.",
          lyrics: "Lyrics are too long.",
          notes: "Song notes are too long.",
          credits: "Too many credits.",
          genre_ids: "Too many genres.",
          recordings: "Only one recording may be the first.",
          "recordings[0].label": "Label is too long.",
          "recordings[0].release_year": "Year is out of range.",
          "recordings[0].notes": "Notes are too long.",
        }),
      ),
    );
    renderEditor({ route: "/songs/song-1/edit" });

    await save();

    expect(await screen.findByText("The song could not be saved.")).toBeInTheDocument();
    expect(screen.getByText("Only one recording may be the first.")).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toHaveAccessibleDescription("Title is required.");
    expect(screen.getByLabelText("Language")).toHaveAccessibleDescription(
      "Language is not supported.",
    );
    expect(screen.getByLabelText("Lyrics")).toHaveAccessibleDescription("Lyrics are too long.");
    expect(screen.getByLabelText("Notes", { selector: "#notes" })).toHaveAccessibleDescription(
      "Song notes are too long.",
    );
    expect(screen.getByText("Too many credits.")).toBeInTheDocument();
    expect(screen.getByText("Too many genres.")).toBeInTheDocument();
    expect(screen.getByLabelText("Label")).toHaveAccessibleDescription("Label is too long.");
    expect(screen.getByLabelText("Year")).toHaveAccessibleDescription("Year is out of range.");
    expect(
      screen.getByLabelText("Notes", { selector: "#recording-0-notes" }),
    ).toHaveAccessibleDescription("Notes are too long.");
  });

  // The server numbers rows as sent, and blank rows are not: a row's error
  // belongs to the row it names in the payload, not the form row at that index.
  it("puts a credit's or performer's error on the row the server meant, past blank ones", async () => {
    server.use(
      http.get(`${API}/api/v1/songs/song-1`, () =>
        HttpResponse.json(
          makeSong({
            credits: [
              { person_id: "person-1", name: "Μίκης Θεοδωράκης", role: "composer", position: 0 },
              { person_id: "person-3", name: "Νίκος Γκάτσος", role: "lyricist", position: 1 },
            ],
            recordings: [
              // Nothing on it: a blank row, which is not sent.
              makeRecording({
                id: "rec-1",
                label: null,
                youtube_url: null,
                youtube_video_id: null,
                release_year: null,
                notes: null,
                is_first: false,
                performers: [],
              }),
              makeRecording({
                id: "rec-2",
                performers: [
                  { person_id: "person-2", name: "Γιώργος Νταλάρας", position: 0 },
                  { person_id: "person-4", name: "Μαρία Φαραντούρη", position: 1 },
                ],
              }),
            ],
          }),
        ),
      ),
      http.patch(`${API}/api/v1/songs/song-1`, () =>
        apiError(422, "validation_failed", "The song could not be saved.", {
          "credits[0].name": "Name is too long.",
          "recordings[0].performers[0].name": "Name is too long.",
        }),
      ),
    );
    renderEditor({ route: "/songs/song-1/edit" });

    // Emptied, the first credit and the first performer are dropped at save.
    await userEvent.clear(await screen.findByDisplayValue("Μίκης Θεοδωράκης"));
    await userEvent.clear(screen.getByDisplayValue("Γιώργος Νταλάρας"));
    await save();

    await screen.findByText("The song could not be saved.");
    expect(screen.getByLabelText("Name for credit 2")).toHaveAccessibleDescription(
      "Name is too long.",
    );
    expect(screen.getByLabelText("Name for credit 1")).not.toHaveAttribute("aria-describedby");
    expect(screen.getByLabelText("Name of performer 2 on recording 2")).toHaveAccessibleDescription(
      "Name is too long.",
    );
    expect(screen.getByLabelText("Name of performer 1 on recording 2")).not.toHaveAttribute(
      "aria-describedby",
    );
    // Refilling a dropped row must not move the error: the server named the
    // rows of the save that failed, not of the form as it now stands.
    await userEvent.type(screen.getByLabelText("Name for credit 1"), "Μάνος Χατζιδάκις");
    expect(screen.getByLabelText("Name for credit 2")).toHaveAccessibleDescription(
      "Name is too long.",
    );
    expect(screen.getByLabelText("Name for credit 1")).not.toHaveAttribute("aria-describedby");
  });

  it("puts a credit's role error on the role, not the name", async () => {
    server.use(
      http.patch(`${API}/api/v1/songs/song-1`, () =>
        apiError(422, "validation_failed", "The song could not be saved.", {
          "credits[0].role": "Role must be composer or lyricist.",
        }),
      ),
    );
    renderEditor({ route: "/songs/song-1/edit" });

    await screen.findByDisplayValue("Μίκης Θεοδωράκης");
    await save();

    expect(await screen.findByLabelText("Role for credit 1")).toHaveAccessibleDescription(
      "Role must be composer or lyricist.",
    );
    expect(screen.getByLabelText("Name for credit 1")).not.toHaveAttribute("aria-describedby");
  });

  // A failed load must not fall through to an empty form: saving it would blank
  // the song.
  it("offers no form for a song that could not be loaded", async () => {
    server.use(
      http.get(`${API}/api/v1/songs/song-1`, () =>
        apiError(500, "internal", "Something went wrong."),
      ),
    );
    renderEditor({ route: "/songs/song-1/edit" });

    expect(await screen.findByText(/could not be loaded/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
  });

  // Deciding on the restoring session would bounce a contributor off on reload.
  it("waits for the session before deciding who may edit", () => {
    renderEditor({ route: "/songs/new", user: null, auth: { loading: true } });

    expect(screen.getByRole("status")).toHaveTextContent("Loading");
    expect(screen.queryByRole("heading", { name: "Catalog" })).not.toBeInTheDocument();
  });

  it("sends an account below contributor to the catalog", async () => {
    renderEditor({ route: "/songs/new", user: makeUser({ role: "user" }) });

    expect(await screen.findByRole("heading", { name: "Catalog" })).toBeInTheDocument();
  });

  // Contributors edit only their own songs; the server enforces it as well.
  it("sends a contributor to the song when it is somebody else's", async () => {
    server.use(
      http.get(`${API}/api/v1/songs/song-1`, () =>
        HttpResponse.json(makeSong({ created_by: "someone-else" })),
      ),
    );
    renderEditor({
      route: "/songs/song-1/edit",
      user: makeUser({ id: "user-1", role: "contributor" }),
    });

    expect(await screen.findByText("Address: /songs/thalassa-platia")).toBeInTheDocument();
  });

  it("lets a contributor edit their own song", async () => {
    server.use(
      http.get(`${API}/api/v1/songs/song-1`, () =>
        HttpResponse.json(makeSong({ created_by: "user-1" })),
      ),
    );
    renderEditor({
      route: "/songs/song-1/edit",
      user: makeUser({ id: "user-1", role: "contributor" }),
    });

    expect(await screen.findByRole("heading", { name: "Edit song" })).toBeInTheDocument();
  });

  it("asks before a cancel discards unsaved changes, and stays if told no", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderEditor({ route: ["/songs/song-1", "/songs/song-1/edit"] });

    await userEvent.type(await screen.findByLabelText("Title"), "!");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(confirm).toHaveBeenCalledWith("Discard your unsaved changes?");
    expect(screen.getByRole("heading", { name: "Edit song" })).toBeInTheDocument();

    confirm.mockReturnValue(true);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(await screen.findByText("Address: /songs/song-1")).toBeInTheDocument();
  });

  // A tab close is the one way out the Cancel button never sees.
  it("guards a tab close only while there are unsaved changes", async () => {
    renderEditor({ route: "/songs/song-1/edit" });
    const unload = () => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };

    const title = await screen.findByLabelText("Title");
    expect(unload()).toBe(false);

    await userEvent.type(title, "!");
    expect(unload()).toBe(true);
  });
});
