/** The client half of the YouTube link parser, shared by every call site. */

/** The 11-character identifier, which is the only shape an id is ever stored in. */
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * The hosts the server accepts, `www.` already stripped. Mirrors
 * `parseYouTubeURL`'s list (Go); change both.
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
 * Mirrors `parseYouTubeURL` (Go), down to the host list and the case-sensitive
 * `v`; change both. The preview is a contributor's only confirmation, so any
 * disagreement is a verdict the save contradicts. Parses the URL rather than
 * pattern-matching, so the host is really the host.
 */
export function extractVideoId(raw: string): string | null {
  let trimmed = raw.trim();
  if (!trimmed) return null;
  // A bare id is a legitimate value, and the server accepts one.
  if (VIDEO_ID.test(trimmed)) return trimmed;

  // A scheme-less "youtu.be/xyz" parses as a path rather than a host, so it
  // gets a scheme. The test is `//`, not `://`, matching the server: tightened,
  // `youtube.com//watch?v=<id>` would preview a link the server rejects.
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

  // Exactly two segments, as the server checks.
  const [shape, id, ...extra] = trimSlashes(url.pathname).split("/");
  if (extra.length > 0 || !shape || !id) return null;
  return VIDEO_PATHS.has(shape) && VIDEO_ID.test(id) ? id : null;
}

/**
 * The canonical watch link for a stored video id, written once for the app and
 * the JSON-LD. The id is encoded so the destination always stays on YouTube.
 */
export function watchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

/** `strings.Trim(path, "/")`, which is what the server splits its segments off. */
function trimSlashes(path: string): string {
  return path.replace(/^\/+|\/+$/g, "");
}
