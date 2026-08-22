import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WatchOnYouTube } from "./WatchOnYouTube";

describe("WatchOnYouTube", () => {
  // The component takes an id and not a URL precisely so the destination cannot
  // be anything else — pinning the built href is what keeps that true, since a
  // prop renamed back to `href` would pass every other spec in the suite.
  it("builds the watch link from the video id and opens it in a new tab", () => {
    render(<WatchOnYouTube videoId="dQw4w9WgXcQ" />);

    const link = screen.getByRole("link", { name: /watch on youtube/i });
    expect(link).toHaveAttribute("href", "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(link).toHaveAttribute("target", "_blank");
    // Without noreferrer the opened tab is told which song page sent it.
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  // The one link in the app that opens elsewhere, so the one that has to say so:
  // a reader who cannot see the new tab appear has nothing else to tell them
  // Back will not bring them back to the song.
  it("announces that it leaves for a new tab", () => {
    render(<WatchOnYouTube videoId="dQw4w9WgXcQ" />);

    expect(
      screen.getByRole("link", { name: "Watch on YouTube (opens in a new tab)" }),
    ).toBeInTheDocument();
  });
});
