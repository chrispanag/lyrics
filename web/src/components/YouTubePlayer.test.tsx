import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { YouTubePlayer } from "./YouTubePlayer";
import { embedUrl } from "@/lib/youtube";

describe("YouTubePlayer", () => {
  it("plays the no-cookie player at once, and takes focus", () => {
    render(<YouTubePlayer videoId="dQw4w9WgXcQ" title="Θάλασσα Πλατιά" />);

    const player = screen.getByTitle("Θάλασσα Πλατιά on YouTube");
    expect(player.tagName).toBe("IFRAME");
    expect(player).toHaveAttribute("src", embedUrl("dQw4w9WgXcQ"));
    // Without an origin YouTube refuses to play (error 153).
    expect(player).toHaveAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    expect(player).toHaveAttribute("allow", "autoplay; encrypted-media; picture-in-picture");
    expect(player).toHaveAttribute("allowfullscreen");
    expect(player).toHaveFocus();
  });
});
