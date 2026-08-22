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
import { songHref } from "@/lib/listContext";
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
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [releaseYear, setReleaseYear] = useState("");
  const [notes, setNotes] = useState("");
  const [credits, setCredits] = useState<CreditDraft[]>([]);
  const [genreIds, setGenreIds] = useState<string[]>([]);

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
    return <Navigate to={songHref(existing.id)} replace />;
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
    if (location.key === "default") navigate(id ? songHref(id) : "/", { replace: true });
    else navigate(-1);
  };

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
      // Adding a song is the one save that does not go back: the reader has to
      // land on what they just created, not wherever they opened the form from
      // — which for `/songs/new` is usually the catalog, and popping would
      // return them there with nothing to show for it.
      if (isEdit) leaveEditor();
      else navigate(songHref(saved.id), { replace: true });
    } catch (caught) {
      setError(errorMessage(caught, "The song could not be saved."));
      setFieldErrors(errorDetails(caught));
    }
  };

  const videoId = extractVideoId(youtubeUrl);
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

        <div className="grid grid-cols-2 gap-3">
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

        {/* The only confirmation that a pasted link was recognized, now that
            there is no thumbnail to show: nothing appears until the id parses,
            and it parses exactly what the server does — see extractVideoId. */}
        {videoId && <WatchOnYouTube videoId={videoId} />}

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

// Module scope: these are evaluated once rather than on every keystroke, since
// extractVideoId runs in the render body.

/** The 11-character identifier, which is the only shape an id is ever stored in. */
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * The hosts the server accepts, `www.` already stripped — the same list as
 * `parseYouTubeURL`'s, and written out for the same reason it is there.
 *
 * A host missing from here reads as a link the field rejected while the save
 * would have taken it, and `youtube-nocookie.com` is not a hypothetical:
 * YouTube's own share dialog hands out `youtube-nocookie.com/embed/<id>`
 * whenever privacy-enhanced mode is checked. `m.` and `music.` are the same
 * trap one step quieter — they previewed only because the patterns this
 * replaced matched anywhere in the text, so naming the host is what keeps them.
 */
const VIDEO_HOSTS = new Set([
  "youtu.be",
  "youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
]);

/** The path shapes that carry the id as their second segment. */
const VIDEO_PATHS = new Set(["embed", "v", "shorts", "live"]);

/**
 * Extracts a video ID for the live preview.
 *
 * The server does the authoritative parsing and rejects anything it does not
 * recognize; this only decides whether to render a preview. But the preview is
 * now the only confirmation that a pasted link was recognized, so anything the
 * two disagree about is a verdict the save then contradicts — which makes this
 * a deliberate mirror of `parseYouTubeURL`, down to the host list and the
 * case-sensitive `v`.
 *
 * Parsing the URL rather than matching patterns against the raw text is what
 * makes the host actually the host, and it closes both directions of that
 * disagreement at once. A pattern looking for `youtube.com/watch?v=` also finds
 * it in the query string of any other site, so `example.com/?u=<a youtube
 * link>` lit the preview for a link the server refuses; and a pattern is
 * case-sensitive where the server lowercases the host, so a pasted
 * `WWW.YOUTUBE.COM/watch?v=…` — the shape `parseYouTubeURL`'s own comment
 * records arriving — left the preview dark on a link that saves fine.
 * `URL.hostname` is lowercased by the parser, so that half comes for free.
 */
function extractVideoId(raw: string): string | null {
  let trimmed = raw.trim();
  if (!trimmed) return null;
  // A bare id is a legitimate value, and the server accepts one.
  if (VIDEO_ID.test(trimmed)) return trimmed;

  // A scheme-less "youtu.be/xyz" parses as a path rather than a host. The
  // protocol-relative form has a host already and only wants the scheme, which
  // is the shape `url.Parse` handles for the server without being asked.
  //
  // The second test looks for `//` rather than `://`, which is the server's
  // test and not a loose spelling of it. `youtube.com//watch?v=<id>` contains
  // `//`, so neither stack prefixes a scheme, and `url.Parse` then yields no
  // host at all and the save refuses the link. Tightened to `://` this would
  // prefix that string instead, resolve `youtube.com` as the host, read `v` and
  // light a preview for a link the server rejects — the exact class of
  // disagreement this function exists to close.
  if (trimmed.startsWith("//")) trimmed = `https:${trimmed}`;
  else if (!trimmed.includes("//")) trimmed = `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, "");
  if (!VIDEO_HOSTS.has(host)) return null;

  if (host === "youtu.be") {
    const id = trimSlashes(url.pathname);
    return VIDEO_ID.test(id) ? id : null;
  }

  // Case-sensitive on the key, like the server's `Query().Get("v")`.
  const v = url.searchParams.get("v");
  if (v && VIDEO_ID.test(v)) return v;

  // /embed/<id>, /v/<id>, /shorts/<id>, /live/<id> — two segments and no more,
  // which is the length the server checks for.
  const [shape, id, ...extra] = trimSlashes(url.pathname).split("/");
  if (extra.length > 0 || !shape || !id) return null;
  return VIDEO_PATHS.has(shape) && VIDEO_ID.test(id) ? id : null;
}

/** `strings.Trim(path, "/")`, which is what the server splits its segments off. */
function trimSlashes(path: string): string {
  return path.replace(/^\/+|\/+$/g, "");
}
