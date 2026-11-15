import { useEffect, useRef, useState, type SubmitEvent } from "react";
import { Navigate, useLocation, useParams } from "react-router-dom";
import { Plus, Trash } from "lucide-react";

import { errorDetails, errorMessage } from "@/api/client";
import { useCreateSong, useGenres, useSong, useUpdateSong } from "@/api/hooks";
import { useAuth } from "@/auth/useAuth";
import { PageTitle } from "@/components/PageTitle";
import { PersonAutocomplete, type PersonSelection } from "@/components/PersonAutocomplete";
import { WatchOnYouTube } from "@/components/WatchOnYouTube";
import {
  Button,
  Chip,
  ErrorMessage,
  Field,
  Input,
  Select,
  Spinner,
  Textarea,
} from "@/components/ui";
import { songHref, songRefHref } from "@/lib/listContext";
import { extractVideoId } from "@/lib/youtube";
import { CREDIT_PICKER_LABELS } from "@/lib/credits";
import { useNavigate } from "@/lib/navigation";
import {
  CREDIT_ROLES,
  LANGUAGE_LABELS,
  canEditSong,
  hasRole,
  type CreditRole,
  type SongInput,
} from "@/lib/types";

/**
 * A React key for a row the contributor can add and remove. An index would hand
 * a removed row's component state to the row after it. A counter rather than
 * `crypto.randomUUID()`, which only exists in a secure context and so not under
 * `make mobile`.
 */
let lastRowKey = 0;
const rowKey = (): string => String(++lastRowKey);

interface PersonDraft extends PersonSelection {
  key: string;
}

interface CreditDraft extends PersonDraft {
  role: CreditRole;
}

/** One recording being edited. All strings, as input values; the year converts at save. */
interface RecordingDraft {
  key: string;
  label: string;
  youtubeUrl: string;
  releaseYear: string;
  notes: string;
  isFirst: boolean;
  performers: PersonDraft[];
}

const emptyRecording = (): RecordingDraft => ({
  key: rowKey(),
  label: "",
  youtubeUrl: "",
  releaseYear: "",
  notes: "",
  isFirst: false,
  performers: [],
});

/**
 * Whether a person row names anybody, picked or typed. The one test for which
 * credits, performers and recordings are sent, so they cannot disagree.
 */
const named = (person: PersonSelection): boolean => Boolean(person.personId || person.name.trim());

/**
 * Whether a recording row is an abandoned add. Mirrors `RecordingDraft` field by
 * field, `key` aside: a new draft field must be added here, or a row holding
 * only it is silently dropped at save. `isFirst` alone says nothing about a
 * performance.
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

  // Populate once per song, not per refetch: react-query returns a fresh object
  // each time, which would overwrite unsaved edits. Everything hydrated goes here.
  const hydratedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!existing || hydratedFor.current === existing.id) return;
    hydratedFor.current = existing.id;
    setTitle(existing.title);
    setAltTitle(existing.alt_title ?? "");
    // Present on a single song; the type also covers listings that omit it.
    setLyrics(existing.lyrics ?? "");
    setLanguage(existing.language);
    setNotes(existing.notes ?? "");
    setCredits(
      existing.credits.map((credit) => ({
        key: rowKey(),
        personId: credit.person_id,
        name: credit.name,
        role: credit.role,
      })),
    );
    setGenreIds(existing.genres.map((genre) => genre.id));
    // The link is taken verbatim: the server exempts an unparseable stored link
    // only when it is resent unchanged.
    setRecordings(
      existing.recordings.map((recording) => ({
        key: rowKey(),
        label: recording.label ?? "",
        youtubeUrl: recording.youtube_url ?? "",
        releaseYear: recording.release_year ? String(recording.release_year) : "",
        notes: recording.notes ?? "",
        isFirst: recording.is_first,
        performers: recording.performers.map((performer) => ({
          key: rowKey(),
          personId: performer.person_id,
          name: performer.name,
        })),
      })),
    );
    setDirty(false);
  }, [existing]);

  // Warn before a tab close discards unsaved lyrics.
  useEffect(() => {
    if (!dirty) return;

    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  if (authLoading) return <Spinner />;
  if (!hasRole(user?.role, "contributor")) return <Navigate to="/" replace />;
  if (isEdit && loadingSong) return <Spinner />;

  // A failed load must not fall through to the form: every save sends the whole
  // song, so saving an empty form would blank it.
  if (isEdit && (songFailed || !existing)) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-6">
        <PageTitle name="Edit song" />
        <ErrorMessage>
          This song could not be loaded, so it cannot be edited right now. Reload the page to try
          again.
        </ErrorMessage>
      </div>
    );
  }

  // Display only; the server enforces this too.
  if (isEdit && existing && !canEditSong(user, existing)) {
    return <Navigate to={songHref(existing)} replace />;
  }

  /**
   * Leaves the editor by popping history: navigating to the song duplicates its
   * entry and drops `?list=`. A fresh tab (`key === "default"`) has nothing
   * behind it, so it replaces with the song instead. See CLAUDE.md, "Frontend".
   */
  const leaveEditor = () => {
    if (location.key === "default") navigate(id ? songRefHref(id) : "/", { replace: true });
    else navigate(-1);
  };

  const track =
    <T,>(setter: (value: T) => void) =>
    (value: T) => {
      setter(value);
      setDirty(true);
    };

  /** Rewrites one recording, leaving the rest alone. */
  const editRecording = (index: number, patch: Partial<RecordingDraft>) =>
    track(setRecordings)(
      recordings.map((recording, i) => (i === index ? { ...recording, ...patch } : recording)),
    );

  /** Rewrites one recording's performers. */
  const editPerformers = (index: number, next: (performers: PersonDraft[]) => PersonDraft[]) =>
    track(setRecordings)(
      recordings.map((recording, i) =>
        i === index ? { ...recording, performers: next(recording.performers) } : recording,
      ),
    );

  /** Marks one recording as the first, or none; at most one may claim it. */
  const markFirst = (index: number | null) =>
    track(setRecordings)(
      recordings.map((recording, i) => ({ ...recording, isFirst: i === index })),
    );

  /**
   * A recording's field error, by the payload index the server keyed it on.
   * Blank rows are not sent, so that differs from the form index, and a blank
   * row owns no error.
   */
  const recordingError = (index: number, field: string): string | undefined => {
    const recording = recordings[index];
    if (!recording || isBlankRecording(recording)) return undefined;
    const sent = recordings.slice(0, index).filter((r) => !isBlankRecording(r)).length;
    return fieldErrors[`recordings[${sent}].${field}`];
  };

  const onSubmit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setFieldErrors({});

    const payload: SongInput = {
      title: title.trim(),
      alt_title: altTitle.trim() || null,
      lyrics,
      language,
      notes: notes.trim() || null,
      // Blank rows are abandoned edits, dropped rather than rejected.
      credits: credits.filter(named).map((credit, index) => ({
        ...(credit.personId ? { person_id: credit.personId } : { name: credit.name.trim() }),
        role: credit.role,
        position: index,
      })),
      genre_ids: genreIds,
      // Blank recordings are dropped too; see `isBlankRecording`.
      recordings: recordings
        .filter((recording) => !isBlankRecording(recording))
        .map((recording, index) => ({
          label: recording.label.trim() || null,
          youtube_url: recording.youtubeUrl.trim() || null,
          release_year: recording.releaseYear ? Number(recording.releaseYear) : null,
          notes: recording.notes.trim() || null,
          is_first: recording.isFirst,
          position: index,
          performers: recording.performers.filter(named).map((performer, performerIndex) => ({
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
      // A new song lands the reader on it rather than popping back.
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
      {/* Named after the form, so its history entry differs from the song page. */}
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

        <Field
          label="Alternative title"
          htmlFor="alt-title"
          hint="Optional — a transliteration or a well-known variant"
        >
          <Input
            id="alt-title"
            value={altTitle}
            onChange={(event) => track(setAltTitle)(event.target.value)}
          />
        </Field>

        <Field label="Language" htmlFor="language" error={fieldErrors.language}>
          <Select
            id="language"
            className="w-full"
            value={language}
            onChange={(event) => track(setLanguage)(event.target.value)}
            aria-describedby={fieldErrors.language ? "language-error" : undefined}
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
            <div key={credit.key} className="flex gap-2">
              <div className="flex-1">
                <PersonAutocomplete
                  id={`credit-name-${index}`}
                  value={credit}
                  placeholder="Name"
                  onChange={(selection) =>
                    track(setCredits)(
                      // The selection replaces the person whole: spread over
                      // `item`, a retyped name keeps the picked id, which wins.
                      credits.map((item, i) =>
                        i === index ? { key: item.key, role: item.role, ...selection } : item,
                      ),
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
                // `size="icon"`, not a padding override: `cn` is a plain join.
                size="icon"
                aria-label={`Remove credit ${index + 1}`}
                onClick={() => track(setCredits)(credits.filter((_, i) => i !== index))}
                className="shrink-0"
              >
                <Trash aria-hidden className="size-4 text-red-600" />
              </Button>
            </div>
          ))}

          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() =>
              track(setCredits)([...credits, { key: rowKey(), name: "", role: "composer" }])
            }
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
            // Mirrors the server's parser; see lib/youtube.ts.
            const videoId = extractVideoId(recording.youtubeUrl);

            return (
              <fieldset
                key={recording.key}
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
                    // `Field` leaves pointing at its hint or error to the caller.
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
                    // The hint is the only statement of accepted link shapes.
                    aria-describedby={
                      recordingError(index, "youtube_url")
                        ? `recording-${index}-youtube-error`
                        : `recording-${index}-youtube-hint`
                    }
                    onChange={(event) => editRecording(index, { youtubeUrl: event.target.value })}
                  />
                </Field>

                {/* Confirms a pasted link was recognized. Never a gate: an
                    unparseable stored link still saves. */}
                {videoId && <WatchOnYouTube videoId={videoId} />}

                <div className="space-y-2">
                  <span className="block text-sm font-medium text-stone-700 dark:text-stone-300">
                    Performers
                  </span>
                  {recording.performers.map((performer, performerIndex) => (
                    <div key={performer.key} className="flex gap-2">
                      <div className="flex-1">
                        <PersonAutocomplete
                          id={`recording-${index}-performer-${performerIndex}`}
                          value={performer}
                          placeholder="Name"
                          onChange={(selection) =>
                            editPerformers(index, (performers) =>
                              performers.map((item, i) =>
                                i === performerIndex ? { key: item.key, ...selection } : item,
                              ),
                            )
                          }
                        />
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        // `size="icon"`, not a padding override: `cn` is a plain join.
                        size="icon"
                        aria-label={`Remove performer ${performerIndex + 1} from recording ${index + 1}`}
                        onClick={() =>
                          editPerformers(index, (performers) =>
                            performers.filter((_, i) => i !== performerIndex),
                          )
                        }
                        className="shrink-0"
                      >
                        <Trash aria-hidden className="size-4 text-red-600" />
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      editPerformers(index, (performers) => [
                        ...performers,
                        { key: rowKey(), name: "" },
                      ])
                    }
                  >
                    <Plus aria-hidden className="size-4" />
                    Add performer
                  </Button>
                </div>

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
                  {/* A radio, so at most one recording can claim it. */}
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
                    onClick={() => track(setRecordings)(recordings.filter((_, i) => i !== index))}
                  >
                    <Trash aria-hidden className="size-4 text-red-600" />
                    Remove
                  </Button>
                </div>
              </fieldset>
            );
          })}

          {/* "None of them": a radio cannot be unpressed, and all-false is a
              real state, since first-ness is a claim nobody may be able to make. */}
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
            aria-describedby={fieldErrors.lyrics ? "lyrics-error" : undefined}
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
