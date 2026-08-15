import { screen } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { Route, Routes } from "react-router-dom";

import { SongDetailPage } from "./SongDetailPage";
import { API, makeSong, makeUser } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

function renderDetail(options: Parameters<typeof renderWithProviders>[1] = {}) {
  return renderWithProviders(
    <Routes>
      <Route path="/songs/:id" element={<SongDetailPage />} />
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

  it("reports a song that could not be loaded", async () => {
    server.use(
      http.get(`${API}/api/v1/songs/:id`, () =>
        HttpResponse.json(
          { error: { code: "not_found", message: "Song was not found." } },
          { status: 404 },
        ),
      ),
    );

    renderDetail();

    expect(await screen.findByRole("alert")).toHaveTextContent("Song was not found.");
  });
});
