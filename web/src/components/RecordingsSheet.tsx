import { PersonLinks } from "@/components/PersonLinks";
import { Sheet } from "@/components/ui";
import { WatchOnYouTube } from "@/components/WatchOnYouTube";
import type { Recording } from "@/lib/types";

/**
 * Every recording of a song, in the order the server sent them.
 *
 * The rows are not re-sorted here: the list arrives first-recording-first and
 * sorting it again would be a second opinion about a rule the server owns.
 *
 * Built on `Sheet`, which is what makes the paging swipe and the arrow keys
 * stand down while this is up — they look for the `role="dialog"` and
 * `aria-modal` pair it writes. Anything replacing it has to write both.
 */
export function RecordingsSheet({
  recordings,
  language,
  open,
  onClose,
}: {
  recordings: Recording[];
  language: string;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Recordings">
      <ul className="divide-y divide-stone-200 dark:divide-stone-800">
        {recordings.map((recording) => {
          const hasPerformers = recording.performers.length > 0;
          // Whether the row's primary line says something other than the year.
          // When it does not, the year is standing in as that line and the
          // column on the right must not print it a second time. Derived here,
          // beside the fallback chain that consumes it, so the two cannot come
          // to disagree about what counts as the row's own text.
          const hasOwnText = hasPerformers || recording.label !== null;

          return (
          <li key={recording.id} className="py-3 first:pt-0 last:pb-0">
            <div className="flex items-start justify-between gap-3">
              {/* The song's language, on the contributor's words only. The
                  sheet renders outside the <header lang> the page marks, so
                  without this a Greek performer name is announced by an English
                  voice — the same half-done `lang` the chrome and the lyrics
                  were once split by. The labels around it are chrome and stay
                  outside. */}
              <div className="min-w-0" lang={language}>
                {hasPerformers ? (
                  <p className="font-medium">
                    <PersonLinks people={recording.performers} onNavigate={onClose} />
                  </p>
                ) : (
                  // Most of the catalog's recordings are a year and nothing
                  // else. With no performers the label carries the row, and
                  // with neither the year does — a row is never a blank line
                  // with a watch button under it.
                  <p className="font-medium">
                    {recording.label ?? recording.release_year ?? "Recording"}
                  </p>
                )}
                {/* Shown under the names, and not again when it has already
                    stood in for them above. */}
                {recording.label && hasPerformers && (
                  <p className="text-sm text-stone-500 dark:text-stone-400">{recording.label}</p>
                )}
                {recording.notes && (
                  <p className="mt-1 whitespace-pre-line text-sm text-stone-500 dark:text-stone-400">
                    {recording.notes}
                  </p>
                )}
              </div>

              <div className="shrink-0 text-right text-sm">
                {/* Keyed on the flag, never on being first in the list. Order
                    is something this list always has; "the first recording" is
                    a claim about history that a contributor may not have made,
                    and index 0 would assert it for them.

                    The colours are the pair the navigation's active tab uses.
                    The brand ramp stops at 900, so a `brand-950` resolves to
                    nothing and costs the badge its ground in dark mode alone. */}
                {recording.is_first && (
                  <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 dark:bg-brand-900/40 dark:text-brand-200">
                    First recording
                  </span>
                )}
                {/* Suppressed when the year is already the row's own text —
                    which for a recording with no performers and no label it is,
                    and that is most of the catalog. Rendered unconditionally it
                    read "1964 · First recording · 1964". */}
                {recording.release_year !== null && hasOwnText && (
                  <p className="mt-1 text-stone-500 dark:text-stone-400">
                    {recording.release_year}
                  </p>
                )}
              </div>
            </div>

            {/* The id, never the URL — the same rule the song page follows, and
                for the reason WatchOnYouTube records: only the id has been
                validated, so the link is built rather than trusted. */}
            {recording.youtube_video_id && (
              <WatchOnYouTube videoId={recording.youtube_video_id} className="mt-2" />
            )}
          </li>
          );
        })}
      </ul>
    </Sheet>
  );
}
