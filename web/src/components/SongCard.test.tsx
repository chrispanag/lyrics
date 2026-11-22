import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SongCard } from "./SongCard";
import { type NavigationBackend, NavigationProvider } from "@/lib/navigation";
import { makeGenre, makeRecording, makeSong } from "@/test/handlers";
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

  // Read off the id, as the song page's watch link is, so the two agree.
  it("badges a song with a video, and only one", () => {
    const { unmount } = renderWithProviders(
      <SongCard song={makeSong({ youtube_video_id: "dQw4w9WgXcQ" })} />,
    );
    expect(screen.getByRole("img", { name: "Has a video" })).toBeInTheDocument();
    unmount();

    renderWithProviders(<SongCard song={makeSong()} />);
    expect(screen.queryByRole("img", { name: "Has a video" })).toBeNull();
  });

  it("badges how many times the song was added to a list, and nothing else", () => {
    renderWithProviders(
      <SongCard
        song={makeSong({
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

    expect(screen.getByText("4")).toBeInTheDocument();
    const label = "Saved to a list 4 times";
    // Spoken in the link, and again in the hover tip. The tip is aria-hidden so
    // a screen reader does not hear it twice.
    const copies = screen.getAllByText(label);
    expect(copies).toHaveLength(2);
    expect(copies.filter((node) => node.classList.contains("sr-only"))).toHaveLength(1);
    const tip = copies.find((node) => node.closest("[aria-hidden='true']"));
    // Above the badge: below it, the tip sat on the byline.
    expect(tip?.closest("[aria-hidden='true']")).toHaveClass(
      "invisible",
      "bottom-full",
      "group-hover/saves:visible",
    );
    expect(screen.queryByText("9")).not.toBeInTheDocument();
    expect(screen.queryByText(/click/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/people/i)).not.toBeInTheDocument();
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

  // Compared against a real chip's classes, the nearest jsdom gets to its box.
  it("holds the genre row open with a chip's box when a song has none", () => {
    const genre = makeGenre();
    const withGenre = renderWithProviders(<SongCard song={makeSong({ genres: [genre] })} />);
    const chip = screen.getByText(genre.name);

    // No placeholder beside real chips.
    expect(withGenre.container.querySelector(".invisible")).toBeNull();

    const { container } = renderWithProviders(<SongCard song={makeSong({ genres: [] })} />);
    const placeholder = container.querySelector(".invisible");

    expect(placeholder).toHaveClass(`${chip.className} invisible`, { exact: true });
    expect(placeholder?.textContent).toBe("\u00A0");
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

  it("loads the song at once on a press, which a touch has no hover before", async () => {
    const requests = recordRequests((path) => path === detail);
    try {
      renderWithProviders(<SongCard song={song} />);
      fireEvent.pointerDown(screen.getByRole("link"), { pointerType: "touch" });

      await waitFor(() => expect(requests.paths).toEqual([detail]));
    } finally {
      requests.stop();
    }
  });

  // The test router's `prefetch` does nothing, so a backend that records it is
  // what can see the page being loaded alongside the song.
  it("loads the song's page with the song, at the address the card opens", async () => {
    const requests = recordRequests((path) => path === detail);
    const prefetch = vi.fn<(href: string) => void>();
    const backend = {
      pathname: "/",
      searchParams: new URLSearchParams(),
      params: {},
      push: () => {},
      replace: () => {},
      back: () => {},
      liveHref: () => "/",
      writeSearch: () => {},
      prefetch,
      Link: ({ href, replace: _replace, prefetch: _prefetch, ...rest }) => (
        <a href={href} {...rest} />
      ),
    } satisfies NavigationBackend;
    try {
      renderWithProviders(
        <NavigationProvider backend={backend}>
          <SongCard song={song} listId="l" />
        </NavigationProvider>,
      );
      fireEvent.pointerDown(screen.getByRole("link"), { pointerType: "touch" });

      expect(prefetch).toHaveBeenCalledExactlyOnceWith("/songs/to-kalo-pedi?list=l");
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
