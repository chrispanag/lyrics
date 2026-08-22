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
    { user: makeUser({ id: "user-1", role: "admin" }), ...options },
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
});
