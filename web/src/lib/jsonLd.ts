import { groupCredits } from "./credits";
import { listHref, songHref } from "./listContext";
import { SITE_NAME, SITE_ORIGIN } from "./site";
import type { Recording, Song, SongList } from "./types";
import { watchUrl } from "./youtube";

/*
 * The machine-readable description of a song, server-rendered for crawlers. See
 * "What the server renders" in CLAUDE.md.
 */

/** Every `<` in the script body: every character the HTML parser reacts to. */
const TAG_OPENER = /</g;

/**
 * A value as the text of a script body: every `<` becomes `\u003c`, so nothing
 * in it can close the tag (stored XSS). Every JSON-LD this app emits goes
 * through here, constant or not, so the next one copies a safe shape.
 */
function scriptBody(value: unknown): string {
  return JSON.stringify(value).replace(TAG_OPENER, "\\u003c");
}

/**
 * The site itself, as schema.org `WebSite`: what a search engine reads the
 * site's name from in results. On the catalog, the site's home.
 */
export function websiteJsonLd(): string {
  return scriptBody({
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    url: `${SITE_ORIGIN}/`,
    inLanguage: ["el", "en"],
  });
}

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

  return scriptBody(composition);
}

/**
 * A public list as schema.org `ItemList`, as the text of a script body: its
 * songs in the list's order, each by its canonical address (no `?list=`, which
 * is a reading position, not an address). Escaped like `songJsonLd`, since a
 * list's name and description are typed by its owner.
 *
 * `origin` must be absolute; every song must carry a `slug`, or its address is
 * `/songs/undefined` (the route refuses such a list before calling this).
 */
export function listJsonLd(list: SongList, origin: string): string {
  const songs = list.songs ?? [];
  return scriptBody({
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: list.name,
    description: list.description ?? undefined,
    url: `${origin}${listHref(list.id)}`,
    numberOfItems: songs.length,
    itemListElement: songs.map((song, index) => ({
      "@type": "ListItem",
      position: index + 1,
      url: `${origin}${songHref(song)}`,
      name: song.title,
    })),
  });
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
