import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SongCard } from "./SongCard";
import { NavigationProvider } from "@/lib/navigation";
import { recordingBackend } from "@/test/backend";
import { makeGenre, makeRecording, makeSong } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";
import { recordRequests } from "@/test/requests";

// jsdom computes no layout, so a row's height is pinned by what it renders.
describe("SongCard", () => {
  // A row's height follows its content: no empty byline or genre row holding
  // a bare song open. The link's first child is the text column.
  it("draws only a title and a year for a song with nobody credited and no genres", () => {
    renderWithProviders(<SongCard song={makeSong({ credits: [], genres: [] })} />);
    const link = screen.getByRole("link");

    expect(screen.queryByRole("paragraph")).not.toBeInTheDocument();
    expect(link.firstElementChild?.children).toHaveLength(1);
    expect(link).toHaveTextContent(/^Θάλασσα Πλατιά1964$/);
  });

  it("gives the year a right-aligned column of its own, in tabular figures", () => {
    renderWithProviders(<SongCard song={makeSong()} />);
    const year = screen.getByText("1964");

    expect(year).toBe(screen.getByRole("link").lastElementChild);
    expect(year).toHaveClass("shrink-0", "text-right", "tabular-nums");
  });

  // The column stays, so the titles of rows with and without a year are as wide.
  it("leaves the year's column empty for a song without one", () => {
    const withYear = renderWithProviders(<SongCard song={makeSong()} />);
    const column = withYear.container.querySelector("a")?.lastElementChild;
    withYear.unmount();

    renderWithProviders(<SongCard song={makeSong({ release_year: null })} />);
    const empty = screen.getByRole("link").lastElementChild;

    expect(empty?.textContent).toBe("");
    expect(empty?.className).toBe(column?.className);
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

  // The tint is a fill, not a border: a row draws no edge at rest.
  it("marks the song the address has open, and tints its row", () => {
    renderWithProviders(<SongCard song={makeSong()} />, { route: "/songs/thalassa-platia" });
    const link = screen.getByRole("link", { name: /Θάλασσα Πλατιά/ });

    expect(link).toHaveAttribute("aria-current", "page");
    expect(link).toHaveClass("bg-accent-subtle");
    expect(link.className).not.toMatch(/(?:^|\s)border(?:\s|$)/);
  });

  it("draws no border or fill on a row at rest", () => {
    renderWithProviders(<SongCard song={makeSong()} />);
    const link = screen.getByRole("link");

    expect(link).not.toHaveAttribute("aria-current");
    expect(link.className).not.toMatch(/(?:^|\s)(?:border|bg-[\w-]+)(?:\s|$)/);
    expect(link).toHaveClass("hover:bg-subtle");
  });

  it("shows no save badge when the song has never been added to a list", () => {
    renderWithProviders(<SongCard song={makeSong()} />);

    expect(screen.queryByText(/saved/i)).not.toBeInTheDocument();
  });

  it("shows a song's genres under its byline", () => {
    const genre = makeGenre();
    renderWithProviders(<SongCard song={makeSong({ genres: [genre] })} />);

    expect(screen.getByText(genre.name)).toBeInTheDocument();
    expect(screen.getByRole("link").querySelector(".invisible")).toBeNull();
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
