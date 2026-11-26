import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { YouTubePlayer } from "./YouTubePlayer";

describe("YouTubePlayer", () => {
  // Nothing from YouTube but the thumbnail until the reader asks to play.
  it("shows the thumbnail and a play button, and no player", () => {
    render(<YouTubePlayer videoId="dQw4w9WgXcQ" title="Θάλασσα Πλατιά" />);

    const play = screen.getByRole("button", { name: "Play video" });
    const thumbnail = play.querySelector("img");
    expect(thumbnail).toHaveAttribute("src", "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
    expect(thumbnail).toHaveAttribute("loading", "lazy");
    expect(thumbnail).toHaveAttribute("alt", "");
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("swaps in the no-cookie player when pressed, and hands it focus", async () => {
    render(<YouTubePlayer videoId="dQw4w9WgXcQ" title="Θάλασσα Πλατιά" />);

    await userEvent.click(screen.getByRole("button", { name: "Play video" }));

    const player = screen.getByTitle("Θάλασσα Πλατιά on YouTube");
    expect(player.tagName).toBe("IFRAME");
    expect(player).toHaveAttribute(
      "src",
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1",
    );
    expect(player).toHaveAttribute("allow", "autoplay; encrypted-media; picture-in-picture");
    expect(player).toHaveAttribute("allowfullscreen");
    expect(player).toHaveFocus();
    expect(screen.queryByRole("button", { name: "Play video" })).toBeNull();
  });
});
