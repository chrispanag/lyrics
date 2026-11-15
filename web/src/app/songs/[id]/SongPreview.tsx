import { panelChrome } from "@/components/cardStyles";
import { CreditRow } from "@/components/CreditRow";
import { PageTitle } from "@/components/PageTitle";
import { genreLinkChrome } from "@/components/songStyles";
import { WatchOnYouTube } from "@/components/WatchOnYouTube";
import { browseHref } from "@/lib/browse";
import { cn } from "@/lib/cn";
import { CREDIT_DISPLAY_LABELS, groupCredits, songPerformers } from "@/lib/credits";
import { DEFAULT_FONT_SIZE, FONT_SIZES } from "@/lib/fontSize";
import { recordingCount } from "@/lib/format";
import type { Song } from "@/lib/types";

/**
 * The song as a server renders it, for whoever reads the HTML: a crawler, an
 * agent, a screen reader before the bundle arrives. `UntilAppMounts` removes it
 * when the app paints the real page.
 *
 * Static by design: plain links, no controls, since nothing here is
 * interactive until the app replaces it. It mirrors `SongDetailPage`'s
 * `SongHeader` and lyrics section, and the geometry matters as much as the
 * content — the sidebar's `w-60` and the search header's height are reserved
 * so the text does not jump when the app takes over. Change them together.
 */
export function SongPreview({ song }: { song: Song }) {
  const performers = songPerformers(song);

  return (
    <div className="md:pl-60">
      {/* The search header the app draws above the article: a 3rem field,
          `py-3` and a hairline border. */}
      <div aria-hidden className="h-[calc(4.5rem+1px)]" />
      <main className="mx-auto max-w-3xl px-4 py-4">
        {/* Hoisted into the server's <head>; the app's own replaces it. */}
        <PageTitle name={song.title} />
        {/* Where the app's back button and actions sit. */}
        <div aria-hidden className="mb-4 h-9" />

        <article>
          <header className="mb-5" lang={song.language}>
            <h1 className="text-3xl font-bold leading-tight tracking-tight text-balance">
              {song.title}
            </h1>
            {song.alt_title && <p className="mt-1 text-lg text-fg-muted">{song.alt_title}</p>}

            <dl className="mt-3 space-y-1 text-sm">
              {performers.length > 0 && (
                <CreditRow label="Performed by">
                  <PlainPersonLinks people={performers} />
                </CreditRow>
              )}
              {groupCredits(song.credits).map(([role, names]) => (
                <CreditRow key={role} label={CREDIT_DISPLAY_LABELS[role]}>
                  <PlainPersonLinks people={names} />
                </CreditRow>
              ))}
              {song.release_year && <CreditRow label="Year">{song.release_year}</CreditRow>}
            </dl>

            {/* The app's "Show all …" button, as text: it is a fact before it is a control. */}
            {song.recordings.length > 0 && (
              <p className="mt-2 text-sm font-medium text-fg-muted">
                {recordingCount(song.recordings.length)}
              </p>
            )}

            {song.genres.length > 0 && (
              <ul className="mt-3 flex flex-wrap gap-1.5">
                {song.genres.map((genre) => (
                  <li key={genre.id}>
                    <a href={browseHref({ genre_slug: genre.slug })} className={genreLinkChrome}>
                      {genre.name}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </header>

          <section aria-labelledby="lyrics-heading">
            {/* `h-8`: the row the app's text-size buttons make. */}
            <h2
              id="lyrics-heading"
              className="mb-2 flex h-8 items-center text-sm font-semibold uppercase tracking-wide text-fg-muted"
            >
              Lyrics
            </h2>
            {song.lyrics?.trim() ? (
              <p
                lang={song.language}
                className={`whitespace-pre-line leading-loose text-fg ${FONT_SIZES[DEFAULT_FONT_SIZE]}`}
                style={{ fontFamily: "var(--font-lyrics)" }}
              >
                {song.lyrics}
              </p>
            ) : (
              <p className="text-sm italic text-fg-muted">No lyrics have been added yet.</p>
            )}
          </section>

          {song.youtube_video_id && (
            <WatchOnYouTube videoId={song.youtube_video_id} className="mt-6" />
          )}

          {song.notes && (
            <section className={cn(panelChrome, "mt-8")}>
              <h2 className="mb-1 text-sm font-semibold text-fg-secondary">Notes</h2>
              <p className="whitespace-pre-line text-sm text-fg-tertiary">{song.notes}</p>
            </section>
          )}
        </article>
      </main>
    </div>
  );
}

/**
 * `PersonLinks` with plain anchors, there being no router here; each name links
 * to the catalog filtered by that person.
 */
function PlainPersonLinks({ people }: { people: { person_id: string; name: string }[] }) {
  return people.map((person, index) => (
    <span key={person.person_id}>
      {index > 0 && ", "}
      <a href={browseHref({ person: person.person_id })}>{person.name}</a>
    </span>
  ));
}
