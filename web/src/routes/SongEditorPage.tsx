import { useEffect, useState, type FormEvent } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { Plus, Trash2 } from "lucide-react";

import { errorDetails, errorMessage } from "@/api/client";
import { useCreateSong, useGenres, useSong, useUpdateSong } from "@/api/hooks";
import { useAuth } from "@/auth/useAuth";
import { PersonAutocomplete, type PersonSelection } from "@/components/PersonAutocomplete";
import { YouTubeFacade } from "@/components/YouTubeFacade";
import { Button, Chip, ErrorMessage, Field, Input, Select, Spinner, Textarea } from "@/components/ui";
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

const ROLE_LABELS: Record<CreditRole, string> = {
  artist: "Artist",
  composer: "Composer",
  lyricist: "Lyricist",
  performer: "Performer",
};

export function SongEditorPage() {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();

  const { data: existing, isLoading: loadingSong } = useSong(id);
  const { data: genres } = useGenres();
  const createSong = useCreateSong();
  const updateSong = useUpdateSong(id ?? "");

  const [title, setTitle] = useState("");
  const [altTitle, setAltTitle] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [language, setLanguage] = useState("el");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [releaseYear, setReleaseYear] = useState("");
  const [notes, setNotes] = useState("");
  const [credits, setCredits] = useState<CreditDraft[]>([]);
  const [genreIds, setGenreIds] = useState<string[]>([]);

  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);

  // Populate once the song arrives.
  useEffect(() => {
    if (!existing) return;
    setTitle(existing.title);
    setAltTitle(existing.alt_title ?? "");
    setLyrics(existing.lyrics);
    setLanguage(existing.language);
    setYoutubeUrl(existing.youtube_url ?? "");
    setReleaseYear(existing.release_year ? String(existing.release_year) : "");
    setNotes(existing.notes ?? "");
    setCredits(
      existing.credits.map((credit) => ({
        personId: credit.person_id,
        name: credit.name,
        role: credit.role,
      })),
    );
    setGenreIds(existing.genres.map((genre) => genre.id));
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

  // The server enforces this too; the redirect just avoids showing a form that
  // is guaranteed to be rejected.
  if (isEdit && existing && !canEditSong(user, existing)) {
    return <Navigate to={`/songs/${existing.id}`} replace />;
  }

  const track = <T,>(setter: (value: T) => void) => (value: T) => {
    setter(value);
    setDirty(true);
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
      youtube_url: youtubeUrl.trim() || null,
      release_year: releaseYear ? Number(releaseYear) : null,
      notes: notes.trim() || null,
      // Blank rows are dropped rather than rejected: an empty credit is an
      // abandoned edit, not a mistake worth interrupting the save for.
      credits: credits
        .filter((credit) => credit.personId || credit.name.trim())
        .map((credit, index) => ({
          ...(credit.personId ? { person_id: credit.personId } : { name: credit.name.trim() }),
          role: credit.role,
          position: index,
        })),
      genre_ids: genreIds,
    };

    try {
      const saved = isEdit
        ? await updateSong.mutateAsync(payload)
        : await createSong.mutateAsync(payload);
      setDirty(false);
      navigate(`/songs/${saved.id}`, { replace: true });
    } catch (caught) {
      setError(errorMessage(caught, "The song could not be saved."));
      setFieldErrors(errorDetails(caught));
    }
  };

  const videoId = extractVideoId(youtubeUrl);
  const saving = createSong.isPending || updateSong.isPending;

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="mb-6 text-2xl font-bold tracking-tight">
        {isEdit ? "Edit song" : "Add a song"}
      </h1>

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

        <div className="grid grid-cols-2 gap-3">
          <Field label="Language" htmlFor="language" error={fieldErrors.language}>
            <Select
              id="language"
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

          <Field label="Year" htmlFor="release-year" error={fieldErrors.release_year}>
            <Input
              id="release-year"
              type="number"
              inputMode="numeric"
              min={1000}
              max={2200}
              value={releaseYear}
              onChange={(event) => track(setReleaseYear)(event.target.value)}
            />
          </Field>
        </div>

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
                    {ROLE_LABELS[role]}
                  </option>
                ))}
              </Select>
              <Button
                type="button"
                variant="ghost"
                size="md"
                aria-label={`Remove credit ${index + 1}`}
                onClick={() => track(setCredits)(credits.filter((_, i) => i !== index))}
                className="shrink-0 px-2"
              >
                <Trash2 aria-hidden className="size-4 text-red-600" />
              </Button>
            </div>
          ))}

          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => track(setCredits)([...credits, { name: "", role: "artist" }])}
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

        <Field
          label="YouTube link"
          htmlFor="youtube-url"
          error={fieldErrors.youtube_url}
          hint="A watch, youtu.be, or embed link"
        >
          <Input
            id="youtube-url"
            type="url"
            inputMode="url"
            value={youtubeUrl}
            onChange={(event) => track(setYoutubeUrl)(event.target.value)}
            aria-describedby={fieldErrors.youtube_url ? "youtube-url-error" : "youtube-url-hint"}
          />
        </Field>

        {videoId && (
          <div className="overflow-hidden rounded-2xl">
            <YouTubeFacade videoId={videoId} title={title || "Preview"} />
          </div>
        )}

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
              navigate(-1);
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

// Module scope: a regex literal allocates a new RegExp every time it is
// evaluated, and extractVideoId runs in the render body on every keystroke.
const VIDEO_ID_PATTERNS = [
  /(?:youtube\.com\/watch\?(?:.*&)?v=)([A-Za-z0-9_-]{11})/,
  /(?:youtu\.be\/)([A-Za-z0-9_-]{11})/,
  /(?:youtube\.com\/(?:embed|v|shorts|live)\/)([A-Za-z0-9_-]{11})/,
  /^([A-Za-z0-9_-]{11})$/,
];

/**
 * Extracts a video ID for the live preview.
 *
 * The server does the authoritative parsing and rejects anything it does not
 * recognize; this only decides whether to render a preview.
 */
function extractVideoId(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  for (const pattern of VIDEO_ID_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}
