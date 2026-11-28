"use client";

import { useEffect, useRef, useState, type SubmitEvent } from "react";
import { Plus, Trash } from "lucide-react";

import { errorDetails, errorMessage } from "@/api/client";
import { useCreateSong, useGenres, useSong, useUpdateSong } from "@/api/hooks";
import { useAuth } from "@/auth/useAuth";
import { cardChrome } from "@/components/cardStyles";
import { PageHeader } from "@/components/PageHeader";
import { PageTitle } from "@/components/PageTitle";
import { Page } from "@/components/Page";
import { Waiting } from "@/routes/guards";
import { PersonAutocomplete, type PersonSelection } from "@/components/PersonAutocomplete";
import { WatchOnYouTube } from "@/components/WatchOnYouTube";
import {
  Button,
  Chip,
  ErrorMessage,
  Described,
  Field,
  FieldError,
  Input,
  Select,
  Textarea,
} from "@/components/ui";
import { songHref, songRefHref } from "@/lib/listContext";
import { extractVideoId } from "@/lib/youtube";
import { cn } from "@/lib/cn";
import { sectionLabel } from "@/components/textStyles";
import { CREDIT_PICKER_LABELS } from "@/lib/credits";
import { Redirect, useParams, useRouter } from "@/lib/navigation";
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

const isSentRecording = (recording: RecordingDraft): boolean => !isBlankRecording(recording);

/**
 * The row keys a save sent, in payload order, which is what the server keys a
 * row's error on. Blank rows are dropped at save, so a payload index differs
 * from the form index. Taken at submit rather than derived from the form as it
 * stands: a row typed into, cleared or removed after the error would otherwise
 * shift every error below it onto a row the server never named.
 */
interface SentRows {
  credits: string[];
  recordings: string[];
  performers: Record<string, string[]>;
}

const NO_ROWS_SENT: SentRows = { credits: [], recordings: [], performers: {} };

/** A row's payload index in the save that failed, or undefined if it was not sent. */
const sentAt = (keys: string[] | undefined, key: string): number | undefined => {
  const index = keys?.indexOf(key) ?? -1;
  return index === -1 ? undefined : index;
};

export function SongEditorPage() {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const router = useRouter();
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
  const [sentRows, setSentRows] = useState<SentRows>(NO_ROWS_SENT);
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

  // Named after the form, so its history entry differs from the song page.
  const heading = isEdit ? "Edit song" : "Add a song";

  if (authLoading) return <Waiting title={heading} />;
  if (!hasRole(user?.role, "contributor")) return <Redirect href="/" />;
  if (isEdit && loadingSong) return <Waiting title={heading} />;

  // A failed load must not fall through to the form: every save sends the whole
  // song, so saving an empty form would blank it.
  if (isEdit && (songFailed || !existing)) {
    return (
      <Page width="form">
        <PageTitle name="Edit song" />
        <ErrorMessage>
          This song could not be loaded, so it cannot be edited right now. Reload the page to try
          again.
        </ErrorMessage>
      </Page>
    );
  }

  // Display only; the server enforces this too.
  if (isEdit && existing && !canEditSong(user, existing)) {
    return <Redirect href={songHref(existing)} />;
  }

  /**
   * Leaves the editor by popping history: navigating to the song duplicates its
   * entry and drops `?list=`. A fresh tab has nothing behind it, so `back`
   * replaces with the song instead. See CLAUDE.md, "Frontend".
   */
  const leaveEditor = () => router.back(id ? songRefHref(id) : "/");

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

  /** Row errors, looked up by where each row landed in the failed save; see SentRows. */
  const recordingError = (recording: RecordingDraft, field: string): string | undefined => {
    const sent = sentAt(sentRows.recordings, recording.key);
    return sent === undefined ? undefined : fieldErrors[`recordings[${sent}].${field}`];
  };

  /** A credit's error, split by the control it concerns. */
  const creditError = (
    credit: CreditDraft,
  ): { name?: string | undefined; role?: string | undefined } => {
    const sent = sentAt(sentRows.credits, credit.key);
    if (sent === undefined) return {};
    const at = `credits[${sent}]`;
    return {
      name: fieldErrors[at] ?? fieldErrors[`${at}.name`],
      role: fieldErrors[`${at}.role`],
    };
  };

  const performerError = (
    recording: RecordingDraft,
    performer: PersonDraft,
  ): string | undefined => {
    const sent = sentAt(sentRows.recordings, recording.key);
    const sentPerformer = sentAt(sentRows.performers[recording.key], performer.key);
    if (sent === undefined || sentPerformer === undefined) return undefined;
    const at = `recordings[${sent}].performers[${sentPerformer}]`;
    return fieldErrors[at] ?? fieldErrors[`${at}.name`];
  };

  const onSubmit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setFieldErrors({});

    const sentCredits = credits.filter(named);
    const sentRecordings = recordings.filter(isSentRecording);
    const rows: SentRows = {
      credits: sentCredits.map((credit) => credit.key),
      recordings: sentRecordings.map((recording) => recording.key),
      performers: Object.fromEntries(
        sentRecordings.map((recording) => [
          recording.key,
          recording.performers.filter(named).map((performer) => performer.key),
        ]),
      ),
    };

    const payload: SongInput = {
      title: title.trim(),
      alt_title: altTitle.trim() || null,
      lyrics,
      language,
      notes: notes.trim() || null,
      // Blank rows are abandoned edits, dropped rather than rejected.
      credits: sentCredits.map((credit, index) => ({
        ...(credit.personId ? { person_id: credit.personId } : { name: credit.name.trim() }),
        role: credit.role,
        position: index,
      })),
      genre_ids: genreIds,
      // Blank recordings are dropped too; see `isBlankRecording`.
      recordings: sentRecordings.map((recording, index) => ({
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
      else router.replace(songHref(saved));
    } catch (caught) {
      setError(errorMessage(caught, "The song could not be saved."));
      setSentRows(rows);
      setFieldErrors(errorDetails(caught));
    }
  };

  const saving = createSong.isPending || updateSong.isPending;

  return (
    <Page width="form">
      <PageTitle name={heading} />
      <PageHeader title={heading} className="mb-6" />

      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        {error && <ErrorMessage>{error}</ErrorMessage>}

        <Field label="Title" htmlFor="title" error={fieldErrors.title}>
          <Input
            id="title"
            required
            value={title}
            onChange={(event) => track(setTitle)(event.target.value)}
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
          >
            {Object.entries(LANGUAGE_LABELS).map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </Select>
        </Field>

        <fieldset className="space-y-2">
          <legend className={cn(sectionLabel, "mb-1")}>Credits</legend>

          {credits.map((credit, index) => {
            const error = creditError(credit);
            const message = error.role ?? error.name;
            const errorId = `credit-${index}-error`;
            return (
              <div key={credit.key} className="space-y-1.5">
                <div className="flex gap-2">
                  <div className="flex-1">
                    <Described by={error.name ? errorId : undefined}>
                      <PersonAutocomplete
                        label={`Name for credit ${index + 1}`}
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
                    </Described>
                  </div>
                  <Described by={error.role ? errorId : undefined}>
                    <Select
                      aria-label={`Role for credit ${index + 1}`}
                      value={credit.role}
                      onChange={(event) =>
                        track(setCredits)(
                          credits.map((item, i) =>
                            i === index
                              ? { ...item, role: event.target.value as CreditRole }
                              : item,
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
                  </Described>
                  <Button
                    type="button"
                    variant="ghost"
                    // `size="icon"`, not a padding override: `cn` is a plain join.
                    size="icon"
                    aria-label={`Remove credit ${index + 1}`}
                    onClick={() => track(setCredits)(credits.filter((_, i) => i !== index))}
                    className="shrink-0"
                  >
                    <Trash aria-hidden className="size-4 text-fg-danger" />
                  </Button>
                </div>
                {message && <FieldError id={errorId}>{message}</FieldError>}
              </div>
            );
          })}

          {fieldErrors.credits && <ErrorMessage>{fieldErrors.credits}</ErrorMessage>}

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
          <legend className={cn(sectionLabel, "mb-2")}>Genres</legend>
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
              <p className="text-sm text-fg-muted">No genres exist yet.</p>
            )}
          </div>
          {fieldErrors.genre_ids && <ErrorMessage>{fieldErrors.genre_ids}</ErrorMessage>}
        </fieldset>

        <fieldset className="space-y-3">
          <legend className={cn(sectionLabel, "mb-1")}>Recordings</legend>
          <p className="text-sm text-fg-muted">
            Each recording has its own performers, link and year. A song can have none.
          </p>

          {recordings.map((recording, index) => {
            // Mirrors the server's parser; see lib/youtube.ts.
            const videoId = extractVideoId(recording.youtubeUrl);

            return (
              <fieldset key={recording.key} className={cn(cardChrome, "space-y-3 p-4")}>
                <legend className={cn(sectionLabel, "px-1")}>Recording {index + 1}</legend>

                <Field
                  label="Label"
                  htmlFor={`recording-${index}-label`}
                  error={recordingError(recording, "label")}
                  hint="Optional — the release or version this recording appeared on"
                >
                  <Input
                    id={`recording-${index}-label`}
                    value={recording.label}
                    onChange={(event) => editRecording(index, { label: event.target.value })}
                  />
                </Field>

                <Field
                  label="Year"
                  htmlFor={`recording-${index}-year`}
                  error={recordingError(recording, "release_year")}
                >
                  <Input
                    id={`recording-${index}-year`}
                    type="number"
                    inputMode="numeric"
                    min={1000}
                    max={2200}
                    value={recording.releaseYear}
                    onChange={(event) => editRecording(index, { releaseYear: event.target.value })}
                  />
                </Field>

                <Field
                  label="YouTube link"
                  htmlFor={`recording-${index}-youtube`}
                  error={recordingError(recording, "youtube_url")}
                  hint="A watch, youtu.be, or embed link"
                >
                  <Input
                    id={`recording-${index}-youtube`}
                    type="url"
                    inputMode="url"
                    value={recording.youtubeUrl}
                    onChange={(event) => editRecording(index, { youtubeUrl: event.target.value })}
                  />
                </Field>

                {/* Confirms a pasted link was recognized. Never a gate: an
                    unparseable stored link still saves. */}
                {videoId && <WatchOnYouTube videoId={videoId} />}

                <div className="space-y-2">
                  <span className={cn(sectionLabel, "block")}>Performers</span>
                  {recording.performers.map((performer, performerIndex) => {
                    const error = performerError(recording, performer);
                    const errorId = `recording-${index}-performer-${performerIndex}-error`;
                    return (
                      <div key={performer.key} className="space-y-1.5">
                        <div className="flex gap-2">
                          <div className="flex-1">
                            <Described by={error ? errorId : undefined}>
                              <PersonAutocomplete
                                label={`Name of performer ${performerIndex + 1} on recording ${index + 1}`}
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
                            </Described>
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
                            <Trash aria-hidden className="size-4 text-fg-danger" />
                          </Button>
                        </div>
                        {error && <FieldError id={errorId}>{error}</FieldError>}
                      </div>
                    );
                  })}
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
                  error={recordingError(recording, "notes")}
                  hint="Optional — anything worth saying about this performance"
                >
                  <Textarea
                    id={`recording-${index}-notes`}
                    rows={2}
                    value={recording.notes}
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
                    <Trash aria-hidden className="size-4 text-fg-danger" />
                    Remove
                  </Button>
                </div>
              </fieldset>
            );
          })}

          {/* "None of them": a radio cannot be unpressed, and all-false is a
              real state, since first-ness is a claim nobody may be able to make. */}
          {recordings.length > 0 && (
            <label className="flex items-center gap-2 text-sm text-fg-muted">
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

        <Field
          label="Notes"
          htmlFor="notes"
          hint="Optional — context, sources, or variations"
          error={fieldErrors.notes}
        >
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
    </Page>
  );
}
