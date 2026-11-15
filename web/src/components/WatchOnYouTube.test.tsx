import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WatchOnYouTube } from "./WatchOnYouTube";

describe("WatchOnYouTube", () => {
  // Pins the built href: a prop renamed back to `href` would pass everything else.
  it("builds the watch link from the video id and opens it in a new tab", () => {
    render(<WatchOnYouTube videoId="dQw4w9WgXcQ" />);

    const link = screen.getByRole("link", { name: /watch on youtube/i });
    expect(link).toHaveAttribute("href", "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("announces that it leaves for a new tab", () => {
    render(<WatchOnYouTube videoId="dQw4w9WgXcQ" />);

    expect(
      screen.getByRole("link", { name: "Watch on YouTube (opens in a new tab)" }),
    ).toBeInTheDocument();
  });
});
