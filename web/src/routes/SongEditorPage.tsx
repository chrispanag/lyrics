import { useEffect, useRef, useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import { Plus, Trash2 } from "lucide-react";

import { errorDetails, errorMessage } from "@/api/client";
import { useCreateSong, useGenres, useSong, useUpdateSong } from "@/api/hooks";
import { useAuth } from "@/auth/useAuth";
import { PageTitle } from "@/components/PageTitle";
import { PersonAutocomplete, type PersonSelection } from "@/components/PersonAutocomplete";
import { WatchOnYouTube } from "@/components/WatchOnYouTube";
import { Button, Chip, ErrorMessage, Field, Input, Select, Spinner, Textarea } from "@/components/ui";
import { songHref, songRefHref } from "@/lib/listContext";
import { extractVideoId } from "@/lib/youtube";
import { CREDIT_PICKER_LABELS } from "@/lib/credits";
import {
  CREDIT_ROLES,
  LANGUAGE_LABELS,
  canEditSong,
  hasRole,
  type CreditRole,
  type SongInput,
} from "@/lib/types";

interface CreditDraft extends PersonSelection {
  role: CreditRole;
}

/**
 * One recording being edited. Every value is a string because every one of them
 * is an input's value — the year included, which is why it is converted at save
 * rather than held as a number that an empty field has no honest value for.
 */
interface RecordingDraft {
  label: string;
  youtubeUrl: string;
  releaseYear: string;
  notes: string;
  isFirst: boolean;
  performers: PersonSelection[];
}

const emptyRecording = (): RecordingDraft => ({
  label: "",
  youtubeUrl: "",
  releaseYear: "",
  notes: "",
  isFirst: false,
  performers: [],
});

/**
 * Whether a person row names anybody — either one picked from the autocomplete
 * or one typed in.
 *
 * The same question decides three things: which credits are sent, which
 * performers are sent, and whether a recording is worth sending at all. Written
 * out at each of them, the second and third can come to disagree, and a
 * recording is then submitted whose performers are all dropped.
 */
const named = (person: PersonSelection): boolean => Boolean(person.personId || person.name.trim());

/**
 * Whether a recording row is an abandoned add rather than a performance.
 *
 * Beside `RecordingDraft` and `emptyRecording` deliberately: it is a field-by-
 * field mirror of that shape, so the shape and the "is anything in it" test have
 * to be read together. Held down in `onSubmit` instead, a field added to the
 * draft is a field this predicate does not know about — and a row carrying only
 * that field is then dropped at save, silently, since the form still looks
 * filled in and the whole payload is sent on the next save anyway.
 *
 * `isFirst` is deliberately not among the fields consulted: marking an empty row
 * as the first recording says nothing about any performance.
 */
const isBlankRecording = (recording: RecordingDraft): boolean =>
  !recording.label.trim() &&
  !recording.youtubeUrl.trim() &&
  !recording.releaseYear &&
  !recording.notes.trim() &&
  !recording.performers.some(named);

export function SongEditorPage() {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const location = useLocation();
  const { user, loading: authLoading } = useAuth();

  const { data: existing, isLoading: loadingSong, isError: songFailed } = useSong(id);
  const { data: genres } = useGenres();
  const createSong = useCreateSong();
  const updateSong = useUpdateSong(id ?? "");

  const [title, setTitle] = useState("");
  const [altTitle, setAltTitle] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [language, setLanguage] = useState("el");
  const [notes, setNotes] = useState("");
  const [credits, setCredits] = useState<CreditDraft[]>([]);
  const [genreIds, setGenreIds] = useState<string[]>([]);
  const [recordings, setRecordings] = useState<RecordingDraft[]>([]);

  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);

  // Populate once the song arrives, and only once per song.
  //
  // Keying this on `existing` alone made it re-run on every refetch — react-query
  // hands back a fresh object each time — so a reconnect or a cache invalidation
  // silently overwrote whatever was in the form and reset `dirty`, taking the
  // unsaved-changes guard down with it.
  const hydratedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!existing || hydratedFor.current === existing.id) return;
    hydratedFor.current = existing.id;
    setTitle(existing.title);
    setAltTitle(existing.alt_title ?? "");
    // This page reads a single song, so the body is there; the fallback is for
    // the type, which allows for the listing projections that leave it out.
    setLyrics(existing.lyrics ?? "");
    setLanguage(existing.language);
    setNotes(existing.notes ?? "");
    setCredits(
      existing.credits.map((credit) => ({
        personId: credit.person_id,
        name: credit.name,
        role: credit.role,
      })),
    );
    setGenreIds(existing.genres.map((genre) => genre.id));
    // Hydrated here rather than in an effect of its own, for the reason above:
    // keyed on `existing`, a refetch would overwrite recordings a contributor
    // had edited and not yet saved.
    //
    // The link is taken verbatim, unparsed. A stored link this app cannot read
    // is a real thing — the importer kept what it was given — and the server
    // carries such a value through a save that resends it unchanged. Cleaning
    // it up here would break that match and refuse the save.
    setRecordings(
      existing.recordings.map((recording) => ({
        label: recording.label ?? "",
        youtubeUrl: recording.youtube_url ?? "",
        releaseYear: recording.release_year ? String(recording.release_year) : "",
        notes: recording.notes ?? "",
        isFirst: recording.is_first,
        performers: recording.performers.map((performer) => ({
          personId: performer.person_id,
          name: performer.name,
        })),
      })),
    );
    setDirty(false);
  }, [existing]);

  // Warn before a tab close discards unsaved lyrics. Route-level navigation is
  // guarded separately by the confirm in the cancel handler.
  useEffect(() => {
    if (!dirty) return;

    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  if (authLoading) return <Spinner />;
  if (!hasRole(user?.role, "contributor")) return <Navigate to="/" replace />;
  if (isEdit && loadingSong) return <Spinner />;

  // A failed load must not fall through to the form. The fields would render
  // empty under an "Edit song" heading, and every save sends the whole song —
  // so a contributor who assumed the page had merely lost focus and retyped the
  // title would overwrite the real lyrics, credits, and genres with blanks.
  if (isEdit && (songFailed || !existing)) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-6">
        {/* This branch persists rather than resolving, so it needs a name like
            the equivalent states on the song and list pages — otherwise the one
            page a contributor is stuck on is the one whose tab says nothing. */}
        <PageTitle name="Edit song" />
        <ErrorMessage>
          This song could not be loaded, so it cannot be edited right now. Reload the page to
          try again.
        </ErrorMessage>
      </div>
    );
  }

  // The server enforces this too; the redirect just avoids showing a form that
  // is guaranteed to be rejected.
  if (isEdit && existing && !canEditSong(user, existing)) {
    return <Navigate to={songHref(existing)} replace />;
  }

  /**
   * Leaves the editor for the page it was opened from.
   *
   * Popping rather than navigating, because an edit is only ever reached from
   * the song's own page: pushing the song again — or replacing the editor entry
   * with it, which is the same thing one entry earlier — leaves two identical
   * song entries in a row, and the reader has to press Back twice to get past a
   * page that never appeared to change. Popping also restores the previous
   * address verbatim, which is what keeps `?list=` on a song reached from a
   * list; building the destination would drop it, the Edit link having dropped
   * it first.
   *
   * `key` is `"default"` only on the entry a tab was opened on, so an editor
   * address opened in a fresh tab — the one way in with nothing behind it —
   * takes the fallback instead, and replaces so Back does not return to a form
   * already saved or abandoned. The fallback is derived rather than passed,
   * since where the editor belongs is the same question at both call sites.
   */
  const leaveEditor = () => {
    if (location.key === "default") navigate(id ? songRefHref(id) : "/", { replace: true });
    else navigate(-1);
  };

  const track = <T,>(setter: (value: T) => void) => (value: T) => {
    setter(value);
    setDirty(true);
  };

  /** Rewrites one recording, leaving the rest alone. */
  const editRecording = (index: number, patch: Partial<RecordingDraft>) =>
    track(setRecordings)(
      recordings.map((recording, i) => (i === index ? { ...recording, ...patch } : recording)),
    );

  /**
   * Rewrites one recording's performers.
   *
   * Three controls edit that list — the name field, the remove button and the add
   * button — and each spelled out the `editRecording(index, { performers: ... })`
   * wrapper around its own one-line change, which is the nesting rather than the
   * change being what the row read as.
   */
  const editPerformers = (
    index: number,
    next: (performers: PersonSelection[]) => PersonSelection[],
  ) =>
    track(setRecordings)(
      recordings.map((recording, i) =>
        i === index ? { ...recording, performers: next(recording.performers) } : recording,
      ),
    );

  /**
   * Marks one recording as the first, or none of them.
   *
   * Written across every row rather than on the one pressed, because at most one
   * may claim it — the database enforces that with a unique index and the API
   * refuses the payload before then, so a second `true` is not something to
   * discover at save time.
   */
  const markFirst = (index: number | null) =>
    track(setRecordings)(
      recordings.map((recording, i) => ({ ...recording, isFirst: i === index })),
    );

  /**
   * A recording's field error, looked up by the index the server keyed it on.
   *
   * That is not the row's index in the form. Blank rows are dropped from the
   * payload, so the server counts only the rows it was actually sent — and read
   * by the draft index instead, a message lands on whichever row happens to sit
   * at the payload's position: with one abandoned empty row above a bad link,
   * "Not a recognizable YouTube link." appears under the empty row, which has no
   * link in it at all, and the row that does shows nothing wrong. With two, the
   * key matches no row and the message disappears, leaving only "The song could
   * not be saved."
   *
   * A blank row is sent nothing and so can own no error, which is what the guard
   * says; without it a blank row would claim the message belonging to the next
   * row down.
   */
  const recordingError = (index: number, field: string): string | undefined => {
    if (isBlankRecording(recordings[index]!)) return undefined;
    const sent = recordings.slice(0, index).filter((r) => !isBlankRecording(r)).length;
    return fieldErrors[`recordings[${sent}].${field}`];
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setFieldErrors({});

    const payload: SongInput = {
      title: title.trim(),
      alt_title: altTitle.trim() || null,
      lyrics,
      language,
      notes: notes.trim() || null,
      // Blank rows are dropped rather than rejected: an empty credit is an
      // abandoned edit, not a mistake worth interrupting the save for.
      credits: credits
        .filter(named)
        .map((credit, index) => ({
          ...(credit.personId ? { person_id: credit.personId } : { name: credit.name.trim() }),
          role: credit.role,
          position: index,
        })),
      genre_ids: genreIds,
      // A recording with nothing in it is an abandoned add, like a blank credit
      // row. What counts as "nothing in it" is stated beside the draft shape it
      // reads, which is the only place both can be kept in step.
      recordings: recordings
        .filter((recording) => !isBlankRecording(recording))
        .map((recording, index) => ({
          label: recording.label.trim() || null,
          youtube_url: recording.youtubeUrl.trim() || null,
          release_year: recording.releaseYear ? Number(recording.releaseYear) : null,
          notes: recording.notes.trim() || null,
          is_first: recording.isFirst,
          position: index,
          performers: recording.performers
            .filter(named)
            .map((performer, performerIndex) => ({
              ...(performer.personId
                ? { person_id: performer.personId }
                : { name: performer.name.trim() }),
              position: performerIndex,
            })),
        })),
    };

    try {
      const saved = isEdit
        ? await updateSong.mutateAsync(payload)
        : await createSong.mutateAsync(payload);
      setDirty(false);
      // Adding a song is the one save that does not go back: the reader has to
      // land on what they just created, not wherever they opened the form from
      // — which for `/songs/new` is usually the catalog, and popping would
      // return them there with nothing to show for it.
      if (isEdit) leaveEditor();
      else navigate(songHref(saved), { replace: true });
    } catch (caught) {
      setError(errorMessage(caught, "The song could not be saved."));
      setFieldErrors(errorDetails(caught));
    }
  };

  const saving = createSong.isPending || updateSong.isPending;
  const heading = isEdit ? "Edit song" : "Add a song";

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      {/* Named after the form rather than the song being edited, so the entry
          the editor leaves behind is distinguishable from the song page it was
          opened from — which is the whole point on a route that pops history to
          get out. One binding for the tab and the heading, so the two cannot
          drift into disagreeing about which form this is. */}
      <PageTitle name={heading} />
      <h1 className="mb-6 text-2xl font-bold tracking-tight">{heading}</h1>

      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        {error && <ErrorMessage>{error}</ErrorMessage>}

        <Field label="Title" htmlFor="title" error={fieldErrors.title}>
          <Input
            id="title"
            required
            value={title}
            onChange={(event) => track(setTitle)(event.target.value)}
            aria-describedby={fieldErrors.title ? "title-error" : undefined}
          />
        </Field>

        <Field label="Alternative title" htmlFor="alt-title" hint="Optional — a transliteration or a well-known variant">
          <Input
            id="alt-title"
            value={altTitle}
            onChange={(event) => track(setAltTitle)(event.target.value)}
          />
        </Field>

        {/* The year used to sit beside this. It belongs to a recording now, so
            there is one field here rather than a grid of two. */}
        <Field label="Language" htmlFor="language" error={fieldErrors.language}>
          <Select
            id="language"
            className="w-full"
            value={language}
            onChange={(event) => track(setLanguage)(event.target.value)}
          >
            {Object.entries(LANGUAGE_LABELS).map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </Select>
        </Field>

        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium text-stone-700 dark:text-stone-300">
            Credits
          </legend>

          {credits.map((credit, index) => (
            <div key={index} className="flex gap-2">
              <div className="flex-1">
                <PersonAutocomplete
                  id={`credit-name-${index}`}
                  value={credit}
                  placeholder="Name"
                  onChange={(selection) =>
                    track(setCredits)(
                      credits.map((item, i) => (i === index ? { ...item, ...selection } : item)),
                    )
                  }
                />
              </div>
              <Select
                aria-label={`Role for credit ${index + 1}`}
                value={credit.role}
                onChange={(event) =>
                  track(setCredits)(
                    credits.map((item, i) =>
                      i === index ? { ...item, role: event.target.value as CreditRole } : item,
                    ),
                  )
                }
                className="w-36 shrink-0"
              >
                {CREDIT_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {CREDIT_PICKER_LABELS[role]}
                  </option>
                ))}
              </Select>
              <Button
                type="button"
                variant="ghost"
                // Nothing but an icon, so the size states that rather than a
                // `px-2` fighting the one `md` brings: `cn` is a plain join, so
                // both paddings stayed in the class list and the width of this
                // button was whichever Tailwind emitted last.
                size="icon"
                aria-label={`Remove credit ${index + 1}`}
                onClick={() => track(setCredits)(credits.filter((_, i) => i !== index))}
                className="shrink-0"
              >
                <Trash2 aria-hidden className="size-4 text-red-600" />
              </Button>
            </div>
          ))}

          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => track(setCredits)([...credits, { name: "", role: "composer" }])}
          >
            <Plus aria-hidden className="size-4" />
            Add credit
          </Button>
        </fieldset>

        <fieldset>
          <legend className="mb-2 text-sm font-medium text-stone-700 dark:text-stone-300">
            Genres
          </legend>
          <div className="flex flex-wrap gap-2">
            {genres?.data.map((genre) => (
              <Chip
                key={genre.id}
                active={genreIds.includes(genre.id)}
                onClick={() =>
                  track(setGenreIds)(
                    genreIds.includes(genre.id)
                      ? genreIds.filter((g) => g !== genre.id)
                      : [...genreIds, genre.id],
                  )
                }
              >
                {genre.name}
              </Chip>
            ))}
            {genres?.data.length === 0 && (
              <p className="text-sm text-stone-500">No genres exist yet.</p>
            )}
          </div>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="mb-1 text-sm font-medium text-stone-700 dark:text-stone-300">
            Recordings
          </legend>
          <p className="text-sm text-stone-500 dark:text-stone-400">
            Each recording has its own performers, link and year. A song can have none.
          </p>

          {recordings.map((recording, index) => {
            // Per row, in the render body like the single field this replaced.
            // The parser is shared with every other caller — see lib/youtube.ts
            // — because a copy per field is a copy per field to keep in step
            // with the server.
            const videoId = extractVideoId(recording.youtubeUrl);

            return (
              <fieldset
                key={index}
                className="space-y-3 rounded-2xl border border-stone-200 p-4 dark:border-stone-800"
              >
                <legend className="px-1 text-sm font-medium text-stone-700 dark:text-stone-300">
                  Recording {index + 1}
                </legend>

                <Field
                  label="Label"
                  htmlFor={`recording-${index}-label`}
                  error={recordingError(index, "label")}
                  hint="Optional — the release or version this recording appeared on"
                >
                  <Input
                    id={`recording-${index}-label`}
                    value={recording.label}
                    // Field renders the hint and the error under ids derived
                    // from htmlFor and leaves pointing at them to the caller,
                    // so an input that names neither has a hint nobody hears.
                    aria-describedby={
                      recordingError(index, "label")
                        ? `recording-${index}-label-error`
                        : `recording-${index}-label-hint`
                    }
                    onChange={(event) => editRecording(index, { label: event.target.value })}
                  />
                </Field>

                <Field
                  label="Year"
                  htmlFor={`recording-${index}-year`}
                  error={recordingError(index, "release_year")}
                >
                  <Input
                    id={`recording-${index}-year`}
                    type="number"
                    inputMode="numeric"
                    min={1000}
                    max={2200}
                    value={recording.releaseYear}
                    aria-describedby={
                      recordingError(index, "release_year")
                        ? `recording-${index}-year-error`
                        : undefined
                    }
                    onChange={(event) => editRecording(index, { releaseYear: event.target.value })}
                  />
                </Field>

                <Field
                  label="YouTube link"
                  htmlFor={`recording-${index}-youtube`}
                  error={recordingError(index, "youtube_url")}
                  hint="A watch, youtu.be, or embed link"
                >
                  <Input
                    id={`recording-${index}-youtube`}
                    type="url"
                    inputMode="url"
                    value={recording.youtubeUrl}
                    // The song-level field this replaced carried the same pair,
                    // and it is the only thing saying which link shapes are
                    // accepted — dropped, a screen reader hears the label alone.
                    aria-describedby={
                      recordingError(index, "youtube_url")
                        ? `recording-${index}-youtube-error`
                        : `recording-${index}-youtube-hint`
                    }
                    onChange={(event) => editRecording(index, { youtubeUrl: event.target.value })}
                  />
                </Field>

                {/* The only confirmation that a pasted link was recognized, now
                    that there is no thumbnail to show: nothing appears until the
                    id parses, and it parses exactly what the server does. Its
                    absence is not a refusal — a stored link this cannot read
                    still saves, which is why nothing here gates on it. */}
                {videoId && <WatchOnYouTube videoId={videoId} />}

                <div className="space-y-2">
                  <span className="block text-sm font-medium text-stone-700 dark:text-stone-300">
                    Performers
                  </span>
                  {recording.performers.map((performer, performerIndex) => (
                    <div key={performerIndex} className="flex gap-2">
                      <div className="flex-1">
                        <PersonAutocomplete
                          id={`recording-${index}-performer-${performerIndex}`}
                          value={performer}
                          placeholder="Name"
                          onChange={(selection) =>
                            editPerformers(index, (performers) =>
                              performers.map((item, i) =>
                                i === performerIndex ? { ...item, ...selection } : item,
                              ),
                            )
                          }
                        />
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        // Nothing but an icon, exactly like the remove-credit
                        // button above: `size` says so rather than a `px-2`
                        // joining `md`'s `px-4` in the class list and leaving the
                        // width to whichever Tailwind emitted last.
                        size="icon"
                        aria-label={`Remove performer ${performerIndex + 1} from recording ${index + 1}`}
                        onClick={() =>
                          editPerformers(index, (performers) =>
                            performers.filter((_, i) => i !== performerIndex),
                          )
                        }
                        className="shrink-0"
                      >
                        <Trash2 aria-hidden className="size-4 text-red-600" />
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => editPerformers(index, (performers) => [...performers, { name: "" }])}
                  >
                    <Plus aria-hidden className="size-4" />
                    Add performer
                  </Button>
                </div>

                {/* The notes a recording carries are rendered on the song page's
                    recordings sheet and validated per row by the server, so
                    without a control here they were a value nothing could write
                    and nothing could correct — and isBlankRecording consulting a
                    field no input sets was dead logic. */}
                <Field
                  label="Notes"
                  htmlFor={`recording-${index}-notes`}
                  error={recordingError(index, "notes")}
                  hint="Optional — anything worth saying about this performance"
                >
                  <Textarea
                    id={`recording-${index}-notes`}
                    rows={2}
                    value={recording.notes}
                    aria-describedby={
                      recordingError(index, "notes")
                        ? `recording-${index}-notes-error`
                        : `recording-${index}-notes-hint`
                    }
                    onChange={(event) => editRecording(index, { notes: event.target.value })}
                  />
                </Field>

                <div className="flex items-center justify-between gap-2">
                  {/* A radio, so at most one recording can claim it by
                      construction rather than by a check at save time. */}
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="first-recording"
                      checked={recording.isFirst}
                      onChange={() => markFirst(index)}
                      aria-label={`Mark recording ${index + 1} as the first recording`}
                      className="size-4"
                    />
                    First recording
                  </label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove recording ${index + 1}`}
                    onClick={() =>
                      track(setRecordings)(recordings.filter((_, i) => i !== index))
                    }
                  >
                    <Trash2 aria-hidden className="size-4 text-red-600" />
                    Remove
                  </Button>
                </div>
              </fieldset>
            );
          })}

          {/* The way to say "none of them". A radio group cannot be cleared by
              pressing a member again, and all-false is a state the data really
              holds — first-ness is a claim a contributor may not be able to
              make. It also means removing the marked recording needs no rule
              about which one inherits the mark: none does. */}
          {recordings.length > 0 && (
            <label className="flex items-center gap-2 text-sm text-stone-500 dark:text-stone-400">
              <input
                type="radio"
                name="first-recording"
                checked={recordings.every((recording) => !recording.isFirst)}
                onChange={() => markFirst(null)}
                className="size-4"
              />
              No recording marked as first
            </label>
          )}

          {fieldErrors.recordings && <ErrorMessage>{fieldErrors.recordings}</ErrorMessage>}

          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => track(setRecordings)([...recordings, emptyRecording()])}
          >
            <Plus aria-hidden className="size-4" />
            Add recording
          </Button>
        </fieldset>

        <Field label="Lyrics" htmlFor="lyrics" error={fieldErrors.lyrics}>
          <Textarea
            id="lyrics"
            rows={16}
            value={lyrics}
            onChange={(event) => track(setLyrics)(event.target.value)}
            placeholder="One line per line. Blank lines separate verses."
            // Monospace keeps hand-aligned verses looking the way they were typed.
            className="font-mono text-sm leading-relaxed"
          />
        </Field>

        <Field label="Notes" htmlFor="notes" hint="Optional — context, sources, or variations">
          <Textarea
            id="notes"
            rows={3}
            value={notes}
            onChange={(event) => track(setNotes)(event.target.value)}
          />
        </Field>

        <div className="flex gap-2 pt-2">
          <Button
            type="button"
            variant="secondary"
            className="flex-1"
            onClick={() => {
              if (dirty && !confirm("Discard your unsaved changes?")) return;
              leaveEditor();
            }}
          >
            Cancel
          </Button>
          <Button type="submit" className="flex-1" loading={saving}>
            {isEdit ? "Save changes" : "Add song"}
          </Button>
        </div>
      </form>
    </div>
  );
}
