import { PersonLinks } from "@/components/PersonLinks";
import { Sheet } from "@/components/ui";
import { WatchOnYouTube } from "@/components/WatchOnYouTube";
import type { Recording } from "@/lib/types";

/**
 * The mark a recording carries when it is the first, in the sheet and on a song
 * with only one. The brand ramp stops at 900, so no `brand-950` here. English
 * even inside the song's `lang`, where the lone recording places it.
 */
export function FirstRecordingBadge() {
  return (
    <span
      lang="en"
      className="rounded-full bg-accent-subtle px-2 py-0.5 text-xs font-medium text-fg-accent-subtle"
    >
      First recording
    </span>
  );
}

/** A recording's notes, with the contributor's own line breaks. */
export function RecordingNotes({ notes }: { notes: string }) {
  return <p className="mt-1 whitespace-pre-line text-sm text-fg-muted">{notes}</p>;
}

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
      <ul className="divide-y divide-line">
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
                    <p className="text-sm text-fg-muted">{recording.label}</p>
                  )}
                  {recording.notes && <RecordingNotes notes={recording.notes} />}
                </div>

                <div className="shrink-0 text-right text-sm">
                  {/* Keyed on the flag, never on index 0. */}
                  {recording.is_first && <FirstRecordingBadge />}
                  {recording.release_year !== null && hasOwnText && (
                    <p className="mt-1 text-fg-muted">{recording.release_year}</p>
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
