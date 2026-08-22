import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { Route, Routes, createPath, useLocation } from "react-router-dom";

import { SongEditorPage } from "./SongEditorPage";
import { BackButton } from "@/components/BackButton";
import { API, makeSong, makeUser } from "@/test/handlers";
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

    expect(await screen.findByText("Address: /songs/song-1")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("heading", { name: "Catalog" })).toBeInTheDocument();
  });

  // The preview is the only confirmation that a pasted link was recognized, so
  // what it recognizes has to be what the server recognizes — and the two
  // disagreeing is silent both ways round. Every shape here is one
  // `parseYouTubeURL` accepts, so a dark preview would be the field refusing a
  // link the save would have taken. The uppercased host is the one the server's
  // own comment records arriving, and the two extra hosts are on its list while
  // being the ones a host check is likeliest to drop.
  it.each([
    { what: "a watch link", pasted: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
    { what: "an uppercased host", pasted: "https://WWW.YOUTUBE.COM/watch?v=dQw4w9WgXcQ" },
    { what: "a privacy-enhanced embed link", pasted: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ" },
    { what: "the mobile host", pasted: "https://m.youtube.com/watch?v=dQw4w9WgXcQ" },
    { what: "the music host", pasted: "https://music.youtube.com/watch?v=dQw4w9WgXcQ" },
    { what: "a shorts link", pasted: "https://www.youtube.com/shorts/dQw4w9WgXcQ" },
    { what: "a short link with tracking on it", pasted: "https://youtu.be/dQw4w9WgXcQ?si=abc123" },
    { what: "a scheme-less short link", pasted: "youtu.be/dQw4w9WgXcQ" },
    { what: "a protocol-relative short link", pasted: "//youtu.be/dQw4w9WgXcQ" },
    { what: "a bare id", pasted: "dQw4w9WgXcQ" },
  ])("previews $what", async ({ pasted }) => {
    renderEditor({ route: "/songs/new" });

    await userEvent.type(await screen.findByLabelText("YouTube link"), pasted);

    expect(screen.getByRole("link", { name: /watch on youtube/i })).toHaveAttribute(
      "href",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    );
  });

  // The other direction, and the one a pattern matched against the raw text got
  // wrong: the id in the first two is real, so the preview was a working link to
  // it — telling the contributor the field was happy while the save answers "Not
  // a recognizable YouTube link." Which is why this reads the host as a host.
  it.each([
    {
      what: "a YouTube link carried inside another site's URL",
      pasted: "https://example.com/r?u=https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    },
    { what: "a host that merely ends in the right one", pasted: "https://notyoutube.com/watch?v=dQw4w9WgXcQ" },
    { what: "a playlist rather than a video", pasted: "https://www.youtube.com/playlist?list=PLdQw4w9WgXcQ" },
  ])("shows no preview for $what", async ({ pasted }) => {
    renderEditor({ route: "/songs/new" });

    await userEvent.type(await screen.findByLabelText("YouTube link"), pasted);

    expect(screen.queryByRole("link", { name: /watch on youtube/i })).not.toBeInTheDocument();
  });
});
