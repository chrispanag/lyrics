import { useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Check,
  ListPlus,
  Minus,
  Pencil,
  Plus,
  Trash2,
  Type,
} from "lucide-react";

import { errorMessage } from "@/api/client";
import {
  useDeleteSong,
  useList,
  useLists,
  useSong,
  useSongLists,
  useToggleSongInList,
} from "@/api/hooks";
import { useAuth } from "@/auth/useAuth";
import { ListSongNavBar, ListSongNavFooter, ListSongTapZones } from "@/components/ListSongNav";
import { YouTubeFacade } from "@/components/YouTubeFacade";
import { buttonClasses } from "@/components/buttonStyles";
import { Button, ErrorMessage, Sheet, Skeleton } from "@/components/ui";
import { aboveTapZones } from "@/components/tapZoneStyles";
import { CREDIT_DISPLAY_ORDER } from "@/lib/credits";
import { cn } from "@/lib/cn";
import { LIST_PARAM, listPosition } from "@/lib/listContext";
import { canEditSong, hasRole, type Credit, type CreditRole } from "@/lib/types";
import { BackButton } from "@/components/BackButton";
import { songCount } from "@/lib/format";

const ROLE_LABELS: Record<CreditRole, string> = {
  artist: "Artist",
  composer: "Music",
  lyricist: "Lyrics",
  performer: "Performed by",
};

/** Reader font sizes, persisted so the choice survives navigation. */
const FONT_SIZES = ["text-base", "text-lg", "text-xl", "text-2xl"] as const;
const DEFAULT_FONT_SIZE = 1;
const FONT_SIZE_KEY = "lyrics:font-size";

export function SongDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const { user, loading: sessionLoading } = useAuth();

  const { data: song, isLoading, isError, error } = useSong(id);
  const deleteSong = useDeleteSong();

  // The list this song is being read from, if it is being read from one. Held
  // until the session is known for the reason ListDetailPage documents: asked
  // for a moment too early, a private list answers 404 to its own owner.
  //
  // Nothing here reports a failure. A list the reader may not see, or one this
  // song has since left, leaves the page with no navigation on it — which is the
  // page as it was before there was any, and the song is what was asked for.
  const listId = params.get(LIST_PARAM) ?? undefined;
  const { data: contextList } = useList(listId, !sessionLoading);

  const [listSheetOpen, setListSheetOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [fontSizeIndex, setFontSizeIndex] = useState(() => {
    // The absent-key case has to be caught before Number(): localStorage returns
    // null, Number(null) is 0, and 0 is a perfectly valid index — so the
    // intended default of text-lg was unreachable and every first-time reader
    // silently got the smallest size.
    const raw = localStorage.getItem(FONT_SIZE_KEY);
    if (raw === null) return DEFAULT_FONT_SIZE;
    const stored = Number(raw);
    return Number.isInteger(stored) && stored >= 0 && stored < FONT_SIZES.length
      ? stored
      : DEFAULT_FONT_SIZE;
  });

  const setFontSize = (index: number) => {
    const clamped = Math.max(0, Math.min(FONT_SIZES.length - 1, index));
    setFontSizeIndex(clamped);
    localStorage.setItem(FONT_SIZE_KEY, String(clamped));
  };

  const canEdit = canEditSong(user, song);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="aspect-video w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (isError || !song) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-6">
        <ErrorMessage>{errorMessage(error, "This song could not be loaded.")}</ErrorMessage>
        <Link to="/" className="mt-4 inline-block text-sm text-brand-600 hover:underline">
          Back to browse
        </Link>
      </div>
    );
  }

  const creditsByRole = groupCredits(song.credits);
  const position = contextList ? listPosition(contextList, song.id) : null;

  return (
    <article className="mx-auto max-w-2xl px-4 py-4">
      <div className={cn(aboveTapZones, "mb-4 flex items-center justify-between gap-2")}>
        <BackButton />

        <div className="flex items-center gap-1">
          {/* Shown to guests too, who are sent to sign in and returned here:
              hiding it entirely leaves someone who wants to keep a song with
              nothing to press and no hint that lists exist. The label is
              spelled out for screen readers because the visible one is dropped
              on small screens, where the icon is the whole button. */}
          <Button
            variant="ghost"
            size="sm"
            aria-label="Save to a list"
            // `user` is null until the session is restored, and acting on that
            // sends someone who is already signed in to the sign-in screen and
            // straight back — with the sheet they asked for never opening.
            disabled={sessionLoading}
            onClick={() =>
              user
                ? setListSheetOpen(true)
                // The search string travels with the path, not just the path:
                // `?list=` is what keeps a reader inside the list they came
                // from, and returning them to the bare song after they sign in
                // strands them exactly where this page's navigation exists to
                // stop — silently, since the song still renders.
                : navigate("/login", {
                    state: { from: location.pathname + location.search },
                  })
            }
          >
            <ListPlus aria-hidden className="size-4" />
            <span className="hidden sm:inline">Save</span>
          </Button>
          {canEdit && (
            <Link
              to={`/songs/${song.id}/edit`}
              className={buttonClasses("ghost", "sm")}
            >
              <Pencil aria-hidden className="size-4" />
              <span className="hidden sm:inline">Edit</span>
            </Link>
          )}
          {hasRole(user?.role, "admin") && (
            // The icon is the whole button, so without an explicit label a
            // screen reader announces the one irreversible action on the page
            // as an unnamed button.
            <Button
              variant="ghost"
              size="sm"
              aria-label="Delete song"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 aria-hidden className="size-4 text-red-600" />
            </Button>
          )}
        </div>
      </div>

      {position && <ListSongNavBar position={position} />}

      <header className={cn(aboveTapZones, "mb-5")}>
        <h1 className="text-3xl font-bold leading-tight tracking-tight text-balance">
          {song.title}
        </h1>
        {song.alt_title && (
          <p className="mt-1 text-lg text-stone-500 dark:text-stone-400">{song.alt_title}</p>
        )}

        <dl className="mt-3 space-y-1 text-sm">
          {creditsByRole.map(([role, names]) => (
            <div key={role} className="flex gap-2">
              <dt className="shrink-0 text-stone-500 dark:text-stone-400">{ROLE_LABELS[role]}</dt>
              <dd className="font-medium">
                {names.map((credit, index) => (
                  <span key={credit.person_id}>
                    {index > 0 && ", "}
                    <Link
                      to={`/?person=${credit.person_id}`}
                      className="hover:text-brand-600 hover:underline"
                    >
                      {credit.name}
                    </Link>
                  </span>
                ))}
              </dd>
            </div>
          ))}
          {song.release_year && (
            <div className="flex gap-2">
              <dt className="text-stone-500 dark:text-stone-400">Year</dt>
              <dd className="font-medium">{song.release_year}</dd>
            </div>
          )}
        </dl>

        {song.genres.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {song.genres.map((genre) => (
              <Link
                key={genre.id}
                to={`/?genre_slug=${genre.slug}`}
                className="rounded-full bg-stone-200 px-2.5 py-1 text-xs font-medium text-stone-700 hover:bg-stone-300 dark:bg-stone-800 dark:text-stone-300"
              >
                {genre.name}
              </Link>
            ))}
          </div>
        )}
      </header>

      {song.youtube_video_id && (
        <div className={cn(aboveTapZones, "mb-6")}>
          <YouTubeFacade videoId={song.youtube_video_id} title={song.title} />
        </div>
      )}

      <section aria-label="Lyrics">
        <div className={cn(aboveTapZones, "mb-2 flex items-center justify-between")}>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">
            Lyrics
          </h2>
          <div className="flex items-center gap-1" role="group" aria-label="Text size">
            <Type aria-hidden className="mr-1 size-4 text-stone-400" />
            <button
              type="button"
              onClick={() => setFontSize(fontSizeIndex - 1)}
              disabled={fontSizeIndex === 0}
              aria-label="Decrease text size"
              className="rounded-lg p-2 text-stone-600 hover:bg-stone-200 disabled:opacity-40 dark:text-stone-400 dark:hover:bg-stone-800"
            >
              <Minus aria-hidden className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => setFontSize(fontSizeIndex + 1)}
              disabled={fontSizeIndex === FONT_SIZES.length - 1}
              aria-label="Increase text size"
              className="rounded-lg p-2 text-stone-600 hover:bg-stone-200 disabled:opacity-40 dark:text-stone-400 dark:hover:bg-stone-800"
            >
              <Plus aria-hidden className="size-4" />
            </button>
          </div>
        </div>

        {song.lyrics?.trim() ? (
          // whitespace-pre-line preserves the line and verse breaks that give
          // lyrics their shape, without needing any markup in the stored text.
          <p
            className={cn(
              "whitespace-pre-line leading-loose text-stone-800 dark:text-stone-200",
              FONT_SIZES[fontSizeIndex],
            )}
            style={{ fontFamily: "var(--font-lyrics)" }}
          >
            {song.lyrics}
          </p>
        ) : (
          <p className="text-sm italic text-stone-500">No lyrics have been added yet.</p>
        )}
      </section>

      {song.notes && (
        <section className="mt-8 rounded-2xl bg-stone-100 p-4 dark:bg-stone-900">
          <h2 className="mb-1 text-sm font-semibold text-stone-700 dark:text-stone-300">Notes</h2>
          <p className="whitespace-pre-line text-sm text-stone-600 dark:text-stone-400">
            {song.notes}
          </p>
        </section>
      )}

      {position && <ListSongNavFooter position={position} />}

      {user && (
        <AddToListSheet
          songId={song.id}
          open={listSheetOpen}
          onClose={() => setListSheetOpen(false)}
        />
      )}

      <Sheet open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete this song?">
        <p className="text-sm text-stone-600 dark:text-stone-400">
          “{song.title}” will be removed for everyone, along with its place in any lists. This
          cannot be undone.
        </p>
        <div className="mt-5 flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={() => setConfirmDelete(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            className="flex-1"
            loading={deleteSong.isPending}
            onClick={() => {
              deleteSong.mutate(song.id, { onSuccess: () => navigate("/") });
            }}
          >
            Delete
          </Button>
        </div>
      </Sheet>

      {/* Last, so a screen reader reaches the song before the ways out of it. */}
      {position && <ListSongTapZones position={position} />}
    </article>
  );
}

/**
 * Groups credits by role, preserving the curated order within each.
 *
 * Returns entries rather than a record so the role keeps its `CreditRole` type
 * through to the caller, which is what lets ROLE_LABELS be indexed without a cast.
 */
function groupCredits(credits: Credit[]): [CreditRole, Credit[]][] {
  return CREDIT_DISPLAY_ORDER.map(
    (role) =>
      [
        role,
        credits.filter((credit) => credit.role === role).sort((a, b) => a.position - b.position),
      ] as [CreditRole, Credit[]],
  ).filter(([, matching]) => matching.length > 0);
}

function AddToListSheet({
  songId,
  open,
  onClose,
}: {
  songId: string;
  open: boolean;
  onClose: () => void;
}) {
  const { data: lists } = useLists(open);
  const { data: membership } = useSongLists(songId, open);
  const toggle = useToggleSongInList(songId);

  const memberOf = new Set(membership?.list_ids ?? []);

  return (
    <Sheet open={open} onClose={onClose} title="Save to list">
      <ul className="space-y-1">
        {lists?.data.map((list) => {
          const present = memberOf.has(list.id);
          return (
            <li key={list.id}>
              <button
                type="button"
                onClick={() => toggle.mutate({ listId: list.id, present })}
                aria-pressed={present}
                className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-stone-100 dark:hover:bg-stone-800"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{list.name}</span>
                  <span className="block text-xs text-stone-500">
                    {songCount(list.item_count)}
                  </span>
                </span>
                <span
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                    present
                      ? "border-brand-600 bg-brand-600 text-white"
                      : "border-stone-300 dark:border-stone-600",
                  )}
                >
                  {present && <Check aria-hidden className="size-4" />}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <Link
        to="/lists"
        onClick={onClose}
        className="mt-3 block rounded-xl border border-dashed border-stone-300 px-3 py-3 text-center text-sm text-stone-600 hover:border-brand-400 hover:text-brand-600 dark:border-stone-700 dark:text-stone-400"
      >
        Manage lists
      </Link>
    </Sheet>
  );
}
