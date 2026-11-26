import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { RecordingList } from "./RecordingsSheet";
import { makeRecording } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";

/*
 * The list the recordings sheet and a song's details column both render. The
 * sheet's own behavior is pinned through the song page's specs.
 */
describe("RecordingList", () => {
  const recordings = [
    makeRecording({ id: "r1", label: "Columbia", youtube_video_id: "dQw4w9WgXcQ" }),
    makeRecording({
      id: "r2",
      is_first: false,
      performers: [],
      label: null,
      release_year: 1988,
      notes: "Live.",
    }),
  ];

  it("lists every recording in the server's order, marking the first by its flag", () => {
    renderWithProviders(<RecordingList recordings={recordings} language="el" />);

    const [first, second] = screen.getAllByRole("listitem");
    if (!first || !second) throw new Error("Two rows expected.");
    expect(within(first).getByRole("link", { name: "Γιώργος Νταλάρας" })).toHaveAttribute(
      "href",
      "/?person=person-2",
    );
    expect(within(first).getByText("Columbia")).toBeInTheDocument();
    expect(within(first).getByText("First recording")).toBeInTheDocument();
    expect(within(first).getByText("1964")).toBeInTheDocument();
    expect(within(first).getByRole("link", { name: /watch on youtube/i })).toHaveAttribute(
      "href",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    );
    // Nobody named and no label: the year is its line, said once.
    expect(within(second).getAllByText("1988")).toHaveLength(1);
    expect(within(second).getByText("Live.")).toBeInTheDocument();
    expect(within(second).queryByText("First recording")).toBeNull();
    expect(within(second).queryByRole("link", { name: /watch on youtube/i })).toBeNull();
  });

  it("marks the contributor's words with the song's language", () => {
    renderWithProviders(<RecordingList recordings={recordings} language="el" />);

    expect(screen.getByText("Columbia").closest("[lang]")).toHaveAttribute("lang", "el");
  });

  // The sheet closes itself this way, since the navigation happens beneath it.
  it("tells its host when a performer's link is followed", async () => {
    const onNavigate = vi.fn();
    renderWithProviders(
      <RecordingList recordings={recordings} language="el" onNavigate={onNavigate} />,
    );

    await userEvent.click(screen.getByRole("link", { name: "Γιώργος Νταλάρας" }));

    expect(onNavigate).toHaveBeenCalledOnce();
  });
});
