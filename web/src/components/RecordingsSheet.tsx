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
 * the server owns the "first recording" order. Shared by the sheet and the
 * song's details column, so the two always say the same thing.
 *
 * `language` marks the contributor's words: the sheet renders outside the
 * page's song-language blocks. `onNavigate` lets a modal close itself when a
 * performer's link is followed beneath it.
 */
export function RecordingList({
  recordings,
  language,
  onNavigate,
}: {
  recordings: Recording[];
  language: string;
  onNavigate?: (() => void) | undefined;
}) {
  return (
    <ul className="divide-y divide-line">
      {recordings.map((recording) => {
        const hasPerformers = recording.performers.length > 0;
        // False when the year stands in as the primary line, so the right
        // column must not print it again.
        const hasOwnText = hasPerformers || recording.label !== null;

        return (
          <li key={recording.id} className="py-3 first:pt-0 last:pb-0">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0" lang={language}>
                {hasPerformers ? (
                  <p className="font-medium">
                    <PersonLinks people={recording.performers} onNavigate={onNavigate} />
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
                {/* Keyed on the flag, never on index 0. Under the name, not
                    beside it: in the details column a name beside the mark
                    has room for a word a line. */}
                {recording.is_first && (
                  <p className="mt-1">
                    <FirstRecordingBadge />
                  </p>
                )}
                {recording.notes && <RecordingNotes notes={recording.notes} />}
              </div>

              {recording.release_year !== null && hasOwnText && (
                <p className="shrink-0 text-sm text-fg-muted">{recording.release_year}</p>
              )}
            </div>

            {/* The id, never the URL: only the id is validated. */}
            {recording.youtube_video_id && (
              <WatchOnYouTube videoId={recording.youtube_video_id} className="mt-2" />
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Every recording of a song, out of the way of reading it (`RecordingList`). */
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
      <RecordingList recordings={recordings} language={language} onNavigate={onClose} />
    </Sheet>
  );
}
