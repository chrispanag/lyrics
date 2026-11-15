import { PersonLinks } from "@/components/PersonLinks";
import { Sheet } from "@/components/ui";
import { WatchOnYouTube } from "@/components/WatchOnYouTube";
import type { Recording } from "@/lib/types";

/**
 * Every recording of a song, in the order the server sent them. Not re-sorted:
 * the server owns the "first recording" order.
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
          // False when the year stands in as the primary line, so the right
          // column must not print it again.
          const hasOwnText = hasPerformers || recording.label !== null;

          return (
            <li key={recording.id} className="py-3 first:pt-0 last:pb-0">
              <div className="flex items-start justify-between gap-3">
                {/* The sheet renders outside the page's <header lang>, so the
                    contributor's words need the song's language here. */}
                <div className="min-w-0" lang={language}>
                  {hasPerformers ? (
                    <p className="font-medium">
                      <PersonLinks people={recording.performers} onNavigate={onClose} />
                    </p>
                  ) : (
                    // Falls back to the label, then the year: never a blank line.
                    <p className="font-medium">
                      {recording.label ?? recording.release_year ?? "Recording"}
                    </p>
                  )}
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
                  {/* Keyed on the flag, never on index 0. The brand ramp stops
                      at 900, so no `brand-950` here. */}
                  {recording.is_first && (
                    <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 dark:bg-brand-900/40 dark:text-brand-200">
                      First recording
                    </span>
                  )}
                  {recording.release_year !== null && hasOwnText && (
                    <p className="mt-1 text-stone-500 dark:text-stone-400">
                      {recording.release_year}
                    </p>
                  )}
                </div>
              </div>

              {/* The id, never the URL: only the id is validated. */}
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
