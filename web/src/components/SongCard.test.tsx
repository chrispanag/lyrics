import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SongCard } from "./SongCard";
import { NavigationProvider } from "@/lib/navigation";
import { recordingBackend } from "@/test/backend";
import { laiko, rempetiko } from "@/test/catalog";
import { makeRecording, makeSong } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";
import { recordRequests } from "@/test/requests";

// jsdom computes no layout, so reserved slots are pinned by what holds them open.
describe("SongCard", () => {
  // The only paragraph, since the fixture has no snippet (which is also a <p>).
  it("keeps the subtitle's line on a song with nobody credited", () => {
    renderWithProviders(<SongCard song={makeSong({ credits: [] })} />);

    expect(screen.getByRole("paragraph")).toHaveClass("min-h-lh");
  });

  // Performers come from a different field than the credits, so a regression
  // would drop them silently.
  it("names the first recording's performers ahead of the credits", () => {
    renderWithProviders(<SongCard song={makeSong({ recordings: [makeRecording()] })} />);

    expect(screen.getByText("Γιώργος Νταλάρας · Μίκης Θεοδωράκης")).toBeInTheDocument();
  });

  // The pairing a per-field dedupe would miss.
  it("names someone who both wrote and performed a song once", () => {
    renderWithProviders(
      <SongCard
        song={makeSong({
          credits: [{ person_id: "person-9", name: "Nick Cave", role: "composer", position: 0 }],
          recordings: [
            makeRecording({
              performers: [{ person_id: "person-9", name: "Nick Cave", position: 0 }],
            }),
          ],
        })}
      />,
    );

    expect(screen.getByText("Nick Cave")).toBeInTheDocument();
  });

  it("falls back to the credits when a song has no recordings", () => {
    renderWithProviders(<SongCard song={makeSong()} />);

    expect(screen.getByText("Μίκης Θεοδωράκης")).toBeInTheDocument();
  });

  // A song's tallies and its video are on its own page; the card names it.
  it("shows no badges, for a video or for any tally", () => {
    renderWithProviders(
      <SongCard
        song={makeSong({
          youtube_video_id: "dQw4w9WgXcQ",
          popularity: {
            anonymous_clicks: 9,
            authenticated_clicks: 2,
            list_adds: 4,
            list_users: 2,
            score: 39,
          },
        })}
      />,
    );

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    for (const tally of ["4", "9", "2", "39"]) {
      expect(screen.queryByText(tally)).not.toBeInTheDocument();
    }
    expect(screen.queryByText(/saved to a list/i)).not.toBeInTheDocument();
  });

  it("marks the song the address has open", () => {
    renderWithProviders(<SongCard song={makeSong()} />, { route: "/songs/thalassa-platia" });

    expect(screen.getByRole("link", { name: /Θάλασσα Πλατιά/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("shows no save badge when the song has never been added to a list", () => {
    renderWithProviders(<SongCard song={makeSong()} />);

    expect(screen.queryByText(/saved/i)).not.toBeInTheDocument();
  });

  it("puts a song's genres before its names, on the same line", () => {
    renderWithProviders(<SongCard song={makeSong({ genres: [rempetiko, laiko] })} />);

    expect(screen.getByRole("paragraph")).toHaveTextContent(
      /^Ρεμπέτικο · Λαϊκό · Μίκης Θεοδωράκης$/,
    );
  });

  // No separator leads the line when there is no genre for it to follow.
  it("shows the names alone for a song with no genre", () => {
    renderWithProviders(<SongCard song={makeSong({ genres: [] })} />);

    expect(screen.getByRole("paragraph")).toHaveTextContent(/^Μίκης Θεοδωράκης$/);
  });

  // Nor trails it when there are no names after it.
  it("shows the genre alone for a song with nobody credited", () => {
    renderWithProviders(<SongCard song={makeSong({ credits: [], genres: [rempetiko] })} />);

    expect(screen.getByRole("paragraph")).toHaveTextContent(/^Ρεμπέτικο$/);
  });
});

// Only the wait is on fake timers: the request itself needs the real ones.
describe("SongCard prefetch on intent", () => {
  const song = makeSong({ slug: "to-kalo-pedi" });
  const detail = "/api/v1/songs/to-kalo-pedi";
  const mouse = { pointerType: "mouse" };

  afterEach(() => vi.useRealTimers());

  /** Runs `act` on the fake clock, then hands the real one back and lets requests land. */
  async function settle(advanceMs: number) {
    await act(() => vi.advanceTimersByTimeAsync(advanceMs));
    vi.useRealTimers();
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  it("loads the song once the pointer has rested on the card", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const requests = recordRequests((path) => path === detail);
    try {
      renderWithProviders(<SongCard song={song} />);
      fireEvent.pointerEnter(screen.getByRole("link"), mouse);
      await settle(200);

      await waitFor(() => expect(requests.paths).toEqual([detail]));
    } finally {
      requests.stop();
    }
  });

  it("loads nothing when the pointer only passes over", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const requests = recordRequests((path) => path === detail);
    try {
      renderWithProviders(<SongCard song={song} />);
      const card = screen.getByRole("link");
      fireEvent.pointerEnter(card, mouse);
      await act(() => vi.advanceTimersByTimeAsync(20));
      fireEvent.pointerLeave(card, mouse);
      await settle(500);

      expect(requests.paths).toEqual([]);
    } finally {
      requests.stop();
    }
  });

  it("loads the song at once on a mouse press", async () => {
    const requests = recordRequests((path) => path === detail);
    try {
      renderWithProviders(<SongCard song={song} />);
      fireEvent.pointerDown(screen.getByRole("link"), mouse);

      await waitFor(() => expect(requests.paths).toEqual([detail]));
    } finally {
      requests.stop();
    }
  });

  it("loads the song once a touch has been held, which has no hover before it", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const requests = recordRequests((path) => path === detail);
    try {
      renderWithProviders(<SongCard song={song} />);
      fireEvent.pointerDown(screen.getByRole("link"), { pointerType: "touch" });
      await settle(200);

      await waitFor(() => expect(requests.paths).toEqual([detail]));
    } finally {
      requests.stop();
    }
  });

  // The browser cancels a touch it takes for a scroll: a finger flicking down
  // the list must not load every card it lands on.
  it("loads nothing for a touch that turns into a scroll", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const requests = recordRequests((path) => path === detail);
    try {
      renderWithProviders(<SongCard song={song} />);
      const card = screen.getByRole("link");
      fireEvent.pointerDown(card, { pointerType: "touch" });
      await act(() => vi.advanceTimersByTimeAsync(20));
      fireEvent.pointerCancel(card, { pointerType: "touch" });
      await settle(500);

      expect(requests.paths).toEqual([]);
    } finally {
      requests.stop();
    }
  });

  it("loads the song once keyboard focus has rested on the card", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const requests = recordRequests((path) => path === detail);
    try {
      renderWithProviders(<SongCard song={song} />);
      act(() => screen.getByRole("link").focus());
      await settle(200);

      await waitFor(() => expect(requests.paths).toEqual([detail]));
    } finally {
      requests.stop();
    }
  });

  it("loads the song's page with the song, at the address the card opens", async () => {
    const requests = recordRequests((path) => path === detail);
    const backend = recordingBackend();
    try {
      renderWithProviders(
        <NavigationProvider backend={backend}>
          <SongCard song={song} listId="l" />
        </NavigationProvider>,
      );
      fireEvent.pointerDown(screen.getByRole("link"), mouse);

      expect(backend.prefetch).toHaveBeenCalledExactlyOnceWith("/songs/to-kalo-pedi?list=l");
      // Waited out, or the song's read lands in the next spec's recording.
      await waitFor(() => expect(requests.paths).toEqual([detail]));
    } finally {
      requests.stop();
    }
  });

  it("leaves the song already open alone", async () => {
    const requests = recordRequests((path) => path === detail);
    try {
      renderWithProviders(<SongCard song={song} />, { route: "/songs/to-kalo-pedi" });
      fireEvent.pointerDown(screen.getByRole("link"));
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(requests.paths).toEqual([]);
    } finally {
      requests.stop();
    }
  });
});
