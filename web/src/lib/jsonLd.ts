import { groupCredits } from "./credits";
import type { Recording, Song } from "./types";
import { watchUrl } from "./youtube";

/*
 * The machine-readable description of a song, server-rendered for crawlers. See
 * "What the server says while the app is still client-only" in CLAUDE.md.
 */

/** Every `<` in the script body: every character the HTML parser reacts to. */
const TAG_OPENER = /</g;

/**
 * A song as schema.org `MusicComposition`, as the text of a script body.
 *
 * Returns text so the escaping cannot be forgotten: every `<` becomes `\u003c`,
 * so a lyric containing `</script` cannot close the tag (stored XSS).
 *
 * `url` must be absolute; `metadataBase` does not apply here.
 */
export function songJsonLd(song: Song, url: string): string {
  // The song page's own grouping. Property names stay written out rather than
  // taken from the role, so a new `CreditRole` cannot emit a bogus property.
  const credited = new Map(groupCredits(song.credits));
  const composer = people(credited.get("composer"));
  const lyricist = people(credited.get("lyricist"));

  // Absent rather than empty (empty is a positive claim); `JSON.stringify`
  // drops undefined properties.
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
    // Absent from listing reads, and may be empty on a single-song read.
    lyrics: song.lyrics ? { "@type": "CreativeWork", text: song.lyrics } : undefined,
  };

  return JSON.stringify(composition).replace(TAG_OPENER, "\\u003c");
}

/**
 * One performance. `name` is the song's title (required; a `label` is not a
 * title). The link is built from `youtube_video_id`, never `youtube_url`.
 */
function recording(title: string, item: Recording) {
  return {
    "@type": "MusicRecording",
    name: title,
    alternateName: item.label ?? undefined,
    byArtist: item.performers.length > 0 ? people(item.performers) : undefined,
    // A bare year is a legal ISO 8601 `datePublished`.
    datePublished: item.release_year ? String(item.release_year) : undefined,
    url: item.youtube_video_id ? watchUrl(item.youtube_video_id) : undefined,
  };
}

/** Named people, in the order they arrived. */
function people(named: { name: string }[] | undefined) {
  return (named ?? []).map(({ name }) => ({ "@type": "Person", name }));
}
