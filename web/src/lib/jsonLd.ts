import { groupCredits } from "./credits";
import type { Recording, Song } from "./types";
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
 * Every `<` in the script body, which is every character the HTML parser could
 * react to. Module scope so it is compiled once rather than per render, the same
 * reason `listContext`'s address patterns are.
 */
const TAG_OPENER = /</g;

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
  // The song page's own grouping, so the two cannot disagree about who wrote
  // what: same display order, same dropping of the roles nobody is credited in.
  // The property names stay written out below rather than being taken from the
  // role — `composer` and `lyricist` happening to be spelled the same on both
  // sides is not a rule, and a third role added to `CreditRole` would otherwise
  // be emitted as a MusicComposition property that does not exist.
  const credited = new Map(groupCredits(song.credits));
  const composer = people(credited.get("composer"));
  const lyricist = people(credited.get("lyricist"));

  // Absent rather than empty, throughout — and `undefined` is how, because the
  // one thing this function does with the object is stringify it, and
  // `JSON.stringify` drops a property whose value is undefined. That is what
  // keeps the shape readable down the left margin; it is also the reason this
  // returns text rather than the object, since a caller stringifying it for
  // itself would work identically and a caller doing anything else would not.
  //
  // Empty is a positive claim, and each of these would be the wrong one: that
  // nobody wrote the song, that it was never recorded, that its lyrics are known
  // to be blank. A catalog whose credits are mostly partial says none of that.
  const composition = {
    "@context": "https://schema.org",
    "@type": "MusicComposition",
    name: song.title,
    url,
    inLanguage: song.language,
    composer: composer.length > 0 ? composer : undefined,
    lyricist: lyricist.length > 0 ? lyricist : undefined,
    recordedAs:
      song.recordings.length > 0
        ? song.recordings.map((item) => recording(song.title, item))
        : undefined,
    // `lyrics` is absent from every listing read and may legitimately be empty
    // on a single-song read; both arrive here as nothing to say.
    lyrics: song.lyrics ? { "@type": "CreativeWork", text: song.lyrics } : undefined,
  };

  return JSON.stringify(composition).replace(TAG_OPENER, "\\u003c");
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
    alternateName: item.label ?? undefined,
    byArtist: item.performers.length > 0 ? people(item.performers) : undefined,
    // A year alone is a legal `datePublished` — the property takes a Date and
    // ISO 8601 admits `YYYY` — which matters because a year is all this schema
    // ever holds.
    datePublished: item.release_year ? String(item.release_year) : undefined,
    url: item.youtube_video_id ? watchUrl(item.youtube_video_id) : undefined,
  };
}

/** Named people, in the order they arrived. */
function people(named: { name: string }[] | undefined) {
  return (named ?? []).map(({ name }) => ({ "@type": "Person", name }));
}
