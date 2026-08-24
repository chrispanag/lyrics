import type { Credit, Recording, Song } from "./types";
import { watchUrl } from "./youtube";

/*
 * The machine-readable description of a song, for the readers that are not
 * people.
 *
 * It is server-rendered, which is the whole reason it can exist while the app
 * itself is still `ssr: false`: a `<script type="application/ld+json">` is
 * markup that the crawler reading it never has to execute anything to see. The
 * lyrics therefore appear twice in the document — once here and once in the app
 * that hydrates below it — and that is accepted rather than worked around.
 */

/**
 * A song as schema.org `MusicComposition`, as the text of a script body.
 *
 * The text and not the object, because the escaping below is the part that must
 * not be forgotten and a caller handed an object is a caller that has to
 * remember it. Lyrics are contributor-typed text going into a raw `<script>`,
 * where the HTML parser is still looking for `</script`: a lyric containing one
 * closes the tag, and everything after it is parsed as markup. That is the same
 * stored-XSS vector the `⟦…⟧` search snippets exist to avoid, arriving from the
 * server this time and with the whole document behind it. JSON has no reason to
 * hold a literal `<`, so escaping every one of them to `\u003c` costs nothing
 * and makes a breakout impossible rather than filtered — every sequence the HTML
 * parser reacts to inside a script body starts with that character.
 *
 * `url` is the song's canonical address and has to be absolute, since nothing
 * resolves a relative one here: `metadataBase` applies to Next's own metadata
 * and not to a script this renders itself.
 */
export function songJsonLd(song: Song, url: string): string {
  const composers = named(song.credits, "composer");
  const lyricists = named(song.credits, "lyricist");

  const composition = {
    "@context": "https://schema.org",
    "@type": "MusicComposition",
    name: song.title,
    url,
    inLanguage: song.language,
    // Each of these is omitted rather than sent empty. An empty array is a
    // positive claim that a song has no composer, where absence is the truth
    // about a catalog most of whose credits are partial.
    ...(composers.length > 0 ? { composer: composers } : {}),
    ...(lyricists.length > 0 ? { lyricist: lyricists } : {}),
    ...(song.recordings.length > 0
      ? { recordedAs: song.recordings.map((item) => recording(song.title, item)) }
      : {}),
    // `lyrics` is absent from every listing read and may legitimately be empty
    // on a single-song read, which are different things and produce the same
    // omission here — the alternative is a CreativeWork whose text is "".
    ...(song.lyrics ? { lyrics: { "@type": "CreativeWork", text: song.lyrics } } : {}),
  };

  return JSON.stringify(composition).replace(/</g, "\\u003c");
}

/** The people credited in one role, in the order the song page reads them. */
function named(credits: Credit[], role: Credit["role"]) {
  return credits
    .filter((credit) => credit.role === role)
    .sort((a, b) => a.position - b.position)
    .map((credit) => person(credit.name));
}

/**
 * One performance.
 *
 * `name` is the song's own title because a MusicRecording is required to have
 * one and a recording's `label` is not a title — it is "Live, 1975" or the name
 * of a reissue, which is what `alternateName` is for. Most of this catalog's
 * recordings carry neither a label nor a performer, so every field but the name
 * is conditional.
 *
 * The link is built from `youtube_video_id` and never from `youtube_url`, for
 * the reason `WatchOnYouTube` gives: the URL column is validated text on one
 * write path out of two, and an id is eleven safe characters or it is absent.
 */
function recording(title: string, item: Recording) {
  return {
    "@type": "MusicRecording",
    name: title,
    ...(item.label ? { alternateName: item.label } : {}),
    ...(item.performers.length > 0
      ? { byArtist: item.performers.map((performer) => person(performer.name)) }
      : {}),
    // A year alone is a legal `datePublished` — the property takes a Date and
    // ISO 8601 admits `YYYY` — which matters because a year is all this schema
    // ever holds.
    ...(item.release_year ? { datePublished: String(item.release_year) } : {}),
    ...(item.youtube_video_id ? { url: watchUrl(item.youtube_video_id) } : {}),
  };
}

function person(name: string) {
  return { "@type": "Person", name };
}
