import { describe, expect, it } from "vitest";

import { embedUrl, extractVideoId, watchUrl } from "./youtube";

describe("extractVideoId", () => {
  // Every shape here is one `parseYouTubeURL` accepts; the preview must agree.
  it.each([
    { what: "a watch link", pasted: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
    { what: "an uppercased host", pasted: "https://WWW.YOUTUBE.COM/watch?v=dQw4w9WgXcQ" },
    {
      what: "a privacy-enhanced embed link",
      pasted: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    },
    { what: "the mobile host", pasted: "https://m.youtube.com/watch?v=dQw4w9WgXcQ" },
    { what: "the music host", pasted: "https://music.youtube.com/watch?v=dQw4w9WgXcQ" },
    { what: "a shorts link", pasted: "https://www.youtube.com/shorts/dQw4w9WgXcQ" },
    { what: "a short link with tracking on it", pasted: "https://youtu.be/dQw4w9WgXcQ?si=abc123" },
    { what: "a scheme-less short link", pasted: "youtu.be/dQw4w9WgXcQ" },
    { what: "a protocol-relative short link", pasted: "//youtu.be/dQw4w9WgXcQ" },
    { what: "a bare id", pasted: "dQw4w9WgXcQ" },
  ])("reads the id out of $what", ({ pasted }) => {
    expect(extractVideoId(pasted)).toBe("dQw4w9WgXcQ");
  });

  // Shapes the server refuses, including real ids behind a wrong host.
  it.each([
    {
      what: "a YouTube link carried inside another site's URL",
      pasted: "https://example.com/r?u=https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    },
    {
      what: "a host that merely ends in the right one",
      pasted: "https://notyoutube.com/watch?v=dQw4w9WgXcQ",
    },
    {
      what: "a playlist rather than a video",
      pasted: "https://www.youtube.com/playlist?list=PLdQw4w9WgXcQ",
    },
    // Already contains `//`, so no scheme is prefixed and there is no host.
    {
      what: "a doubled slash where the scheme belongs",
      pasted: "youtube.com//watch?v=dQw4w9WgXcQ",
    },
    { what: "nothing at all", pasted: "   " },
  ])("refuses $what", ({ pasted }) => {
    expect(extractVideoId(pasted)).toBeNull();
  });
});

// Written out once here, so the specs that render them can use the helpers.
describe("a stored id's addresses", () => {
  it("points at YouTube's watch page and player", () => {
    expect(watchUrl("dQw4w9WgXcQ")).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(embedUrl("dQw4w9WgXcQ")).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1",
    );
  });

  // An id is always eleven safe characters; encoded anyway, so none of them
  // can step out of YouTube's path.
  it("encodes the id", () => {
    expect(embedUrl("../a?b")).toBe("https://www.youtube-nocookie.com/embed/..%2Fa%3Fb?autoplay=1");
  });
});
