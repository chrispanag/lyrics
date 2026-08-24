/**
 * The client half of the YouTube link parser.
 *
 * This module exists so more than one field can share the parser. The editor
 * previews a link per recording, and a copy per call site is how the two halves
 * of a mirrored implementation start to disagree — see `extractVideoId` below
 * for what the mirror is and why it cannot be collapsed into one.
 */

// Module scope: these are evaluated once rather than on every keystroke, since
// extractVideoId runs in the render body.

/** The 11-character identifier, which is the only shape an id is ever stored in. */
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * The hosts the server accepts, `www.` already stripped — the same list as
 * `parseYouTubeURL`'s, and written out for the same reason it is there.
 *
 * A host missing from here reads as a link the field rejected while the save
 * would have taken it, and `youtube-nocookie.com` is not a hypothetical:
 * YouTube's own share dialog hands out `youtube-nocookie.com/embed/<id>`
 * whenever privacy-enhanced mode is checked. `m.` and `music.` are the same
 * trap one step quieter — they previewed only because the patterns this
 * replaced matched anywhere in the text, so naming the host is what keeps them.
 */
const VIDEO_HOSTS = new Set([
  "youtu.be",
  "youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
]);

/** The path shapes that carry the id as their second segment. */
const VIDEO_PATHS = new Set(["embed", "v", "shorts", "live"]);

/**
 * Extracts a video ID for the live preview.
 *
 * The server does the authoritative parsing and rejects anything it does not
 * recognize; this only decides whether to render a preview. But the preview is
 * now the only confirmation that a pasted link was recognized, so anything the
 * two disagree about is a verdict the save then contradicts — which makes this
 * a deliberate mirror of `parseYouTubeURL`, down to the host list and the
 * case-sensitive `v`.
 *
 * Parsing the URL rather than matching patterns against the raw text is what
 * makes the host actually the host, and it closes both directions of that
 * disagreement at once. A pattern looking for `youtube.com/watch?v=` also finds
 * it in the query string of any other site, so `example.com/?u=<a youtube
 * link>` lit the preview for a link the server refuses; and a pattern is
 * case-sensitive where the server lowercases the host, so a pasted
 * `WWW.YOUTUBE.COM/watch?v=…` — the shape `parseYouTubeURL`'s own comment
 * records arriving — left the preview dark on a link that saves fine.
 * `URL.hostname` is lowercased by the parser, so that half comes for free.
 */
export function extractVideoId(raw: string): string | null {
  let trimmed = raw.trim();
  if (!trimmed) return null;
  // A bare id is a legitimate value, and the server accepts one.
  if (VIDEO_ID.test(trimmed)) return trimmed;

  // A scheme-less "youtu.be/xyz" parses as a path rather than a host. The
  // protocol-relative form has a host already and only wants the scheme, which
  // is the shape `url.Parse` handles for the server without being asked.
  //
  // The second test looks for `//` rather than `://`, which is the server's
  // test and not a loose spelling of it. `youtube.com//watch?v=<id>` contains
  // `//`, so neither stack prefixes a scheme, and `url.Parse` then yields no
  // host at all and the save refuses the link. Tightened to `://` this would
  // prefix that string instead, resolve `youtube.com` as the host, read `v` and
  // light a preview for a link the server rejects — the exact class of
  // disagreement this function exists to close.
  if (trimmed.startsWith("//")) trimmed = `https:${trimmed}`;
  else if (!trimmed.includes("//")) trimmed = `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, "");
  if (!VIDEO_HOSTS.has(host)) return null;

  if (host === "youtu.be") {
    const id = trimSlashes(url.pathname);
    return VIDEO_ID.test(id) ? id : null;
  }

  // Case-sensitive on the key, like the server's `Query().Get("v")`.
  const v = url.searchParams.get("v");
  if (v && VIDEO_ID.test(v)) return v;

  // /embed/<id>, /v/<id>, /shorts/<id>, /live/<id> — two segments and no more,
  // which is the length the server checks for.
  const [shape, id, ...extra] = trimSlashes(url.pathname).split("/");
  if (extra.length > 0 || !shape || !id) return null;
  return VIDEO_PATHS.has(shape) && VIDEO_ID.test(id) ? id : null;
}

/**
 * The canonical watch link for a stored video id.
 *
 * Here rather than in `WatchOnYouTube` because that component is no longer the
 * only thing that builds one: the JSON-LD a song page server-renders names the
 * same video, and the promise that component's own comment makes — that the
 * canonical shape is written in one place per stack — is precisely what a second
 * copy ends. The id is encoded for the reason stated there: on the eleven
 * characters both write paths validate, encoding is the identity, so it changes
 * nothing today and is what keeps the destination inside YouTube for every
 * writer there will ever be.
 */
export function watchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

/** `strings.Trim(path, "/")`, which is what the server splits its segments off. */
function trimSlashes(path: string): string {
  return path.replace(/^\/+|\/+$/g, "");
}
