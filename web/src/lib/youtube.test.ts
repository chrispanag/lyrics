import { describe, expect, it } from "vitest";

import { extractVideoId } from "./youtube";

describe("extractVideoId", () => {
  // The preview is the only confirmation that a pasted link was recognized, so
  // what it recognizes has to be what the server recognizes — and the two
  // disagreeing is silent both ways round. Every shape here is one
  // `parseYouTubeURL` accepts, so a null would be the field refusing a link the
  // save would have taken. The uppercased host is the one the server's own
  // comment records arriving, and the two extra hosts are on its list while
  // being the ones a host check is likeliest to drop.
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

  // The other direction, and the one a pattern matched against the raw text got
  // wrong: the id in the first two is real, so the preview was a working link to
  // it — telling the contributor the field was happy while the save answers "Not
  // a recognizable YouTube link." Which is why this reads the host as a host.
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
    // `youtube.com//watch?v=…` already contains `//`, so no scheme is prefixed
    // and `url.Parse` yields no host — the case the `//`-not-`://` test exists
    // for, and the one a tightened test would light a preview for.
    { what: "a doubled slash where the scheme belongs", pasted: "youtube.com//watch?v=dQw4w9WgXcQ" },
    { what: "nothing at all", pasted: "   " },
  ])("refuses $what", ({ pasted }) => {
    expect(extractVideoId(pasted)).toBeNull();
  });
});
