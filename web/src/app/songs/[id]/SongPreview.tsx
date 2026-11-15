import { PageTitle } from "@/components/PageTitle";
import { WatchOnYouTube } from "@/components/WatchOnYouTube";
import { browseHref } from "@/lib/browse";
import { CREDIT_DISPLAY_LABELS, groupCredits } from "@/lib/credits";
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
  const performers = song.recordings[0]?.performers ?? [];

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
            {song.alt_title && (
              <p className="mt-1 text-lg text-stone-500 dark:text-stone-400">{song.alt_title}</p>
            )}

            <dl className="mt-3 space-y-1 text-sm">
              {performers.length > 0 && <Credit label="Performed by" people={performers} />}
              {groupCredits(song.credits).map(([role, names]) => (
                <Credit key={role} label={CREDIT_DISPLAY_LABELS[role]} people={names} />
              ))}
              {song.release_year && (
                <div className="flex gap-2">
                  <dt className="text-stone-500 dark:text-stone-400">Year</dt>
                  <dd className="font-medium">{song.release_year}</dd>
                </div>
              )}
            </dl>

            {/* The app's "Show all …" button, as text: it is a fact before it is a control. */}
            {song.recordings.length > 0 && (
              <p className="mt-2 text-sm font-medium text-stone-500 dark:text-stone-400">
                {recordingCount(song.recordings.length)}
              </p>
            )}

            {song.genres.length > 0 && (
              <ul className="mt-3 flex flex-wrap gap-1.5">
                {song.genres.map((genre) => (
                  <li key={genre.id}>
                    <a
                      href={browseHref({ genre_slug: genre.slug })}
                      className="rounded-full bg-stone-200 px-2.5 py-1 text-xs font-medium text-stone-700 dark:bg-stone-800 dark:text-stone-300"
                    >
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
              className="mb-2 flex h-8 items-center text-sm font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400"
            >
              Lyrics
            </h2>
            {song.lyrics?.trim() ? (
              <p
                lang={song.language}
                className={`whitespace-pre-line leading-loose text-stone-800 dark:text-stone-200 ${FONT_SIZES[DEFAULT_FONT_SIZE]}`}
                style={{ fontFamily: "var(--font-lyrics)" }}
              >
                {song.lyrics}
              </p>
            ) : (
              <p className="text-sm italic text-stone-500">No lyrics have been added yet.</p>
            )}
          </section>

          {song.youtube_video_id && (
            <WatchOnYouTube videoId={song.youtube_video_id} className="mt-6" />
          )}

          {song.notes && (
            <section className="mt-8 rounded-2xl bg-stone-100 p-4 dark:bg-stone-900">
              <h2 className="mb-1 text-sm font-semibold text-stone-700 dark:text-stone-300">
                Notes
              </h2>
              <p className="whitespace-pre-line text-sm text-stone-600 dark:text-stone-400">
                {song.notes}
              </p>
            </section>
          )}
        </article>
      </main>
    </div>
  );
}

/** One credit row; each name links to the catalog filtered by that person. */
function Credit({
  label,
  people,
}: {
  label: string;
  people: { person_id: string; name: string }[];
}) {
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 text-stone-500 dark:text-stone-400">{label}</dt>
      <dd className="font-medium">
        {people.map((person, index) => (
          <span key={person.person_id}>
            {index > 0 && ", "}
            <a href={browseHref({ person: person.person_id })}>{person.name}</a>
          </span>
        ))}
      </dd>
    </div>
  );
}
