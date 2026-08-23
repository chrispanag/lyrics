import { useRef, useState } from "react";
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
import { returnTo } from "@/auth/returnTo";
import { useAuth } from "@/auth/useAuth";
import { ListSongNavBar, ListSongNavFooter, ListSongSwipe } from "@/components/ListSongNav";
import { PageTitle } from "@/components/PageTitle";
import { SongSearch } from "@/components/SongSearch";
import { WatchOnYouTube } from "@/components/WatchOnYouTube";
import { buttonClasses } from "@/components/buttonStyles";
import { Button, ConfirmSheet, ErrorMessage, Sheet, Skeleton } from "@/components/ui";
import { browseHref } from "@/lib/browse";
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

/**
 * A song, with the catalog's search box above it.
 *
 * Two siblings rather than one component, for two reasons that both bite if they
 * are folded together. The box has to be there in every state the song below can
 * be in — while it loads, and above all when it failed to load, where searching
 * again is the way out rather than the browser's Back — and it has to sit outside
 * the `<article>`, which is the surface the paging swipe is read across: a
 * gesture that began in the results panel would page the list out from under it.
 */
export function SongDetailPage() {
  return (
    <>
      <SongSearch />
      <SongArticle />
    </>
  );
}

function SongArticle() {
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

  // The song, as the surface the paging swipe is read across. The whole of it
  // rather than a region: a swipe is a movement and not a press, so it needs no
  // box of its own to be safe in — and a song with no lyrics still has somewhere
  // to make the gesture. It stops where the song stops, though, so a very short
  // one leaves empty page below that pages nothing; the tab bar's own strip
  // beneath it is not the song, and reading a swipe there would page a list from
  // a press aimed at Browse.
  const surface = useRef<HTMLElement>(null);

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
      <div className="mx-auto max-w-3xl space-y-4 px-4 py-6">
        {/* Nameless while the song is in flight, rather than a tab that flashes
            "undefined — Songfolio" on every step through a list. */}
        <PageTitle />
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (isError || !song) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-6">
        <PageTitle name="Song not available" />
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
    // The catalog's column, which is the search header's above it: the box a
    // reader's eye follows down from the field has to be the same box, and the
    // open results panel hung 48px past this article on each side while it was
    // narrower. Every state of the page carries it, or the width changes as the
    // song arrives.
    <article ref={surface} className="mx-auto max-w-3xl px-4 py-4">
      {/* The song alone, not the song and its artist: a tab strip truncates
          hard, and the title is what a reader is looking for among ten of
          these. */}
      <PageTitle name={song.title} />
      <div className="mb-4 flex items-center justify-between gap-2">
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
            // `user` is the last session this browser had until the restore
            // settles, so neither branch may be taken on it: the sheet would
            // open on a session that has since expired, or — with no snapshot
            // to seed it — someone already signed in is sent to the sign-in
            // screen and straight back, the sheet they asked for never opening.
            disabled={sessionLoading}
            onClick={() =>
              user ? setListSheetOpen(true) : navigate("/login", { state: returnTo(location) })
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

      {position && (
        <>
          <ListSongNavBar position={position} />
          <ListSongSwipe position={position} surface={surface} />
        </>
      )}

      {/* The song's own language, like the lyrics below — a Greek title is
          content too, and it is what a screen reader announces first. */}
      <header className="mb-5" lang={song.language}>
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
                      to={browseHref({ person: credit.person_id })}
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
                to={browseHref({ genre_slug: genre.slug })}
                className="rounded-full bg-stone-200 px-2.5 py-1 text-xs font-medium text-stone-700 hover:bg-stone-300 dark:bg-stone-800 dark:text-stone-300"
              >
                {genre.name}
              </Link>
            ))}
          </div>
        )}
      </header>

      <section aria-label="Lyrics">
        <div className="mb-2 flex items-center justify-between">
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
          //
          // `lang` is the other half of `<html lang="en">`. The document
          // declares the language of the chrome, which is English; this is the
          // one place the catalog's actual content lives, and it is mostly
          // Greek. Without it a screen reader reads Greek lyrics in an English
          // voice — the same defect `lang="el"` used to cause in the other
          // direction, moved onto the text the site exists for.
          <p
            lang={song.language}
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

      {/* Below the lyrics rather than above them: the video is somewhere else
          to go once the song has been read, and a block between the credits and
          the first line is what the facade did wrong. Gated on the id, not the
          URL — see WatchOnYouTube for why the URL is not the field to trust. */}
      {song.youtube_video_id && (
        <WatchOnYouTube videoId={song.youtube_video_id} className="mt-6" />
      )}

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

      <ConfirmSheet
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this song?"
        pending={deleteSong.isPending}
        onConfirm={() => deleteSong.mutate(song.id, { onSuccess: () => navigate("/") })}
      >
        “{song.title}” will be removed for everyone, along with its place in any lists. This cannot
        be undone.
      </ConfirmSheet>
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
