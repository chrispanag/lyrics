import { useRef, useState } from "react";
import { Check, ListPlus, Minus, Pencil, Plus, Trash, Type } from "lucide-react";

import { errorMessage } from "@/api/client";
import {
  useDeleteSong,
  useList,
  useLists,
  useSong,
  useSongLists,
  useToggleSongInList,
} from "@/api/hooks";
import { useSignInHref } from "@/auth/returnTo";
import { useAuth } from "@/auth/useAuth";
import { ListSongNavBar, ListSongSwipe } from "@/components/ListSongNav";
import { PageTitle } from "@/components/PageTitle";
import { PersonLinks } from "@/components/PersonLinks";
import { SongSearch } from "@/components/SongSearch";
import { WatchOnYouTube } from "@/components/WatchOnYouTube";
import { CreditRow } from "@/components/CreditRow";
import { buttonClasses } from "@/components/buttonStyles";
import { genreLinkChrome } from "@/components/songStyles";
import { Button, ConfirmSheet, ErrorMessage, Sheet, Skeleton, Spinner } from "@/components/ui";
import { browseHref } from "@/lib/browse";
import { CREDIT_DISPLAY_LABELS, groupCredits, songPerformers } from "@/lib/credits";
import { cn } from "@/lib/cn";
import { DEFAULT_FONT_SIZE, FONT_SIZES, storeFontSize, storedFontSize } from "@/lib/fontSize";
import { LIST_PARAM, listPosition, songRefHref } from "@/lib/listContext";
import { canEditSong, hasRole, type Song } from "@/lib/types";
import { BackButton } from "@/components/BackButton";
import { recordingCount, songCount } from "@/lib/format";
import { Link, useParams, useRouter, useSearchParams } from "@/lib/navigation";
import { useStoredState } from "@/lib/useStoredState";
import { RecordingsSheet } from "@/components/RecordingsSheet";

/**
 * A song, with the catalog's search box above it. Siblings: the box shows in
 * every state of the song, and must sit outside the `<article>` the paging
 * swipe is read across.
 */
export function SongDetailPage() {
  return (
    <>
      <SongSearch />
      <SongArticle />
    </>
  );
}

/**
 * The song, and its chrome. The chrome depends only on the address and session,
 * so it renders at once; only the song's own content waits behind a skeleton.
 */
function SongArticle() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const signIn = useSignInHref();
  const params = useSearchParams();
  const { user, loading: sessionLoading } = useAuth();

  // No `isError`, deliberately; see the guard below.
  const { data: song, isLoading, error } = useSong(id);
  const deleteSong = useDeleteSong();

  // The list this song is read from, if any. A failure just leaves the page
  // without list navigation.
  const listId = params.get(LIST_PARAM) ?? undefined;
  const { data: contextList } = useList(listId, !sessionLoading);

  // The whole article is the surface the paging swipe is read across.
  const surface = useRef<HTMLElement>(null);

  const [listSheetOpen, setListSheetOpen] = useState(false);
  const [recordingsOpen, setRecordingsOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // State rather than a store, since the size is also the reader's own state
  // and a store would need a writer of its own.
  const [fontSizeIndex, setFontSizeIndex] = useStoredState(DEFAULT_FONT_SIZE, storedFontSize);

  const setFontSize = (index: number) => {
    const clamped = Math.max(0, Math.min(FONT_SIZES.length - 1, index));
    setFontSizeIndex(clamped);
    storeFontSize(clamped);
  };

  // May run before the song arrives: `canEditSong` answers admins without it.
  const canEdit = canEditSong(user, song);

  // Settled with no song (a missing `id` too). Not `isError`: with a song in
  // hand that only means a failed refetch, which must not take the lyrics away.
  // See CLAUDE.md, "Frontend".
  if (!isLoading && !song) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-6">
        <PageTitle name="Song not available" />
        <ErrorMessage>{errorMessage(error, "This song could not be loaded.")}</ErrorMessage>
        <Link href="/" className="mt-4 inline-block text-sm text-fg-accent hover:underline">
          Back to browse
        </Link>
      </div>
    );
  }

  // Located by the address, so the bar stays up while the next song loads.
  const position = contextList && id ? listPosition(contextList, id) : null;

  return (
    // The search header's column; every state of the page must carry it.
    <article ref={surface} aria-busy={isLoading} className="mx-auto max-w-3xl px-4 py-4">
      {/* The title alone; nameless while in flight. */}
      <PageTitle name={song?.title} />
      <div className="mb-4 flex items-center justify-between gap-2">
        <BackButton />

        <div className="flex items-center gap-1">
          {/* Shown to guests too, who are sent to sign in. Labeled because the
              visible text is dropped on small screens. */}
          <Button
            variant="ghost"
            size="sm"
            aria-label="Save to a list"
            // `user` is only a snapshot until the restore settles; neither branch
            // may be decided on it.
            disabled={sessionLoading}
            onClick={() => (user ? setListSheetOpen(true) : router.push(signIn))}
          >
            <ListPlus aria-hidden className="size-4" />
            <span className="hidden sm:inline">Save</span>
          </Button>
          {canEdit && (
            <Link href={`${songRefHref(id ?? "")}/edit`} className={buttonClasses("ghost", "sm")}>
              <Pencil aria-hidden className="size-4" />
              <span className="hidden sm:inline">Edit</span>
            </Link>
          )}
          {hasRole(user?.role, "admin") && (
            <Button
              variant="ghost"
              size="sm"
              aria-label="Delete song"
              // Waits for the song: the confirmation names it.
              disabled={!song}
              onClick={() => setConfirmDelete(true)}
            >
              <Trash aria-hidden className="size-4 text-fg-danger" />
            </Button>
          )}
        </div>
      </div>

      {position && (
        <>
          <ListSongNavBar position={position} />
          {/* The swipe waits for the song: its once-per-device hint must not be
              spent on a song that fails to load. */}
          {song && <ListSongSwipe position={position} surface={surface} />}
        </>
      )}

      {song ? (
        <SongHeader song={song} onShowRecordings={() => setRecordingsOpen(true)} />
      ) : (
        // Shaped like `SongHeader` so the text-size controls below do not move
        // as the song arrives; change the two together. The plain wrapper stops
        // `space-y-*`'s margin collapsing the recordings line's `mt-2`. No
        // `rounded-full` on the chip: `cn` is a plain join.
        <div className="mb-5 space-y-3">
          <Skeleton className="h-9 w-2/3" />
          <div>
            <div className="space-y-1">
              <Skeleton className="h-5 w-1/2" />
              <Skeleton className="h-5 w-1/3" />
            </div>
            <Skeleton className="mt-2 h-5 w-36" />
          </div>
          <Skeleton className="h-6 w-20" />
        </div>
      )}

      <section aria-label="Lyrics">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-muted">Lyrics</h2>
          {/* A fieldset is the native group; preflight zeroes its border, margin
              and padding. Named by `aria-label`, not a <legend>: the controls
              are icons, and a visible "Text size" would crowd the heading row. */}
          <fieldset className="flex items-center gap-1" aria-label="Text size">
            <Type aria-hidden className="mr-1 size-4 text-fg-subtle" />
            <button
              type="button"
              onClick={() => setFontSize(fontSizeIndex - 1)}
              disabled={fontSizeIndex === 0}
              aria-label="Decrease text size"
              className="rounded-lg p-2 text-fg-tertiary hover:bg-muted disabled:opacity-40"
            >
              <Minus aria-hidden className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => setFontSize(fontSizeIndex + 1)}
              disabled={fontSizeIndex === FONT_SIZES.length - 1}
              aria-label="Increase text size"
              className="rounded-lg p-2 text-fg-tertiary hover:bg-muted disabled:opacity-40"
            >
              <Plus aria-hidden className="size-4" />
            </button>
          </fieldset>
        </div>

        {!song ? (
          <Skeleton className="h-64 w-full" />
        ) : song.lyrics?.trim() ? (
          // whitespace-pre-line keeps the stored line and verse breaks.
          // `lang` pairs with `<html lang="en">`: the lyrics are mostly Greek.
          <p
            lang={song.language}
            className={cn("whitespace-pre-line leading-loose text-fg", FONT_SIZES[fontSizeIndex])}
            style={{ fontFamily: "var(--font-lyrics)" }}
          >
            {song.lyrics}
          </p>
        ) : (
          <p className="text-sm italic text-fg-muted">No lyrics have been added yet.</p>
        )}
      </section>

      {/* Gated on the id, never the URL; see WatchOnYouTube. */}
      {song?.youtube_video_id && (
        <WatchOnYouTube videoId={song.youtube_video_id} className="mt-6" />
      )}

      {song?.notes && (
        <section className="mt-8 rounded-2xl bg-panel p-4">
          <h2 className="mb-1 text-sm font-semibold text-fg-secondary">Notes</h2>
          <p className="whitespace-pre-line text-sm text-fg-tertiary">{song.notes}</p>
        </section>
      )}

      {/* Needs only the id, so Save works while the song is loading. */}
      {user && id && (
        <AddToListSheet songId={id} open={listSheetOpen} onClose={() => setListSheetOpen(false)} />
      )}

      {song && (
        <RecordingsSheet
          recordings={song.recordings}
          language={song.language}
          open={recordingsOpen}
          onClose={() => setRecordingsOpen(false)}
        />
      )}

      {song && (
        <ConfirmSheet
          open={confirmDelete}
          onClose={() => {
            setConfirmDelete(false);
            // The sheet stays mounted, so a stale refusal would show on reopen.
            deleteSong.reset();
          }}
          title="Delete this song?"
          pending={deleteSong.isPending}
          // A refused delete is otherwise silent.
          error={
            deleteSong.isError
              ? errorMessage(deleteSong.error, "This song could not be deleted.")
              : undefined
          }
          onConfirm={() => deleteSong.mutate(song.id, { onSuccess: () => router.push("/") })}
        >
          “{song.title}” will be removed for everyone, along with its place in any lists. This
          cannot be undone.
        </ConfirmSheet>
      )}
    </article>
  );
}

/**
 * A song's title, credits, genres and the way into its recordings. The
 * skeleton in `SongArticle` mirrors its spacing; change both together.
 */
function SongHeader({ song, onShowRecordings }: { song: Song; onShowRecordings: () => void }) {
  const creditsByRole = groupCredits(song.credits);

  // Performers come from the first recording; the year and video from the
  // song's columns, which are the trigger's copy of that same row. No `??`
  // hedge between them. See CLAUDE.md, "Recordings".
  const performers = songPerformers(song);
  const year = song.release_year;

  return (
    /* The song's own language: the title is content too. */
    <header className="mb-5" lang={song.language}>
      <h1 className="text-3xl font-bold leading-tight tracking-tight text-balance">{song.title}</h1>
      {song.alt_title && <p className="mt-1 text-lg text-fg-muted">{song.alt_title}</p>}

      <dl className="mt-3 space-y-1 text-sm">
        {/* Performers lead; the row is conditional, since most recordings
            name nobody. */}
        {performers.length > 0 && (
          <CreditRow label="Performed by">
            <PersonLinks people={performers} />
          </CreditRow>
        )}
        {creditsByRole.map(([role, names]) => (
          <CreditRow key={role} label={CREDIT_DISPLAY_LABELS[role]}>
            <PersonLinks people={names} />
          </CreditRow>
        ))}
        {year && <CreditRow label="Year">{year}</CreditRow>}
      </dl>

      {/* Offered for one recording too: only the sheet shows labels and notes. */}
      {song.recordings.length > 0 && (
        <button
          type="button"
          onClick={onShowRecordings}
          className="mt-2 text-sm font-medium text-fg-accent hover:underline"
        >
          Show all {recordingCount(song.recordings.length)}
        </button>
      )}

      {song.genres.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {song.genres.map((genre) => (
            <Link
              key={genre.id}
              href={browseHref({ genre_slug: genre.slug })}
              className={cn(genreLinkChrome, "hover:bg-muted-hover")}
            >
              {genre.name}
            </Link>
          ))}
        </div>
      )}
    </header>
  );
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
  const lists = useLists(open);
  const membership = useSongLists(songId, open);
  const toggle = useToggleSongInList(songId);

  // Rows wait for both answers: drawn from the lists alone, every row reads as
  // unchecked, and pressing one sends an add for a song already on that list.
  // A failed refetch keeps the answer in hand and says nothing, as the song
  // page does; only a failure that leaves nothing to show is reported.
  const failure = (lists.data ? null : lists.error) ?? (membership.data ? null : membership.error);
  const memberOf = new Set(membership.data?.list_ids ?? []);

  return (
    <Sheet open={open} onClose={onClose} title="Save to list">
      {failure && (
        <ErrorMessage>{errorMessage(failure, "Your lists could not be loaded.")}</ErrorMessage>
      )}
      {toggle.error && (
        <ErrorMessage>{errorMessage(toggle.error, "That list could not be changed.")}</ErrorMessage>
      )}
      {!failure && (!lists.data || !membership.data) && <Spinner />}
      <ul className="space-y-1">
        {membership.data &&
          lists.data?.data.map((list) => {
            const present = memberOf.has(list.id);
            return (
              <li key={list.id}>
                <button
                  type="button"
                  onClick={() => toggle.mutate({ listId: list.id, present })}
                  // Pending lasts until membership is refetched, so a second
                  // press cannot act on the stale `present` and re-add.
                  disabled={toggle.isPending}
                  aria-pressed={present}
                  className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-subtle"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{list.name}</span>
                    <span className="block text-xs text-fg-muted">
                      {songCount(list.item_count)}
                    </span>
                  </span>
                  <span
                    className={cn(
                      "flex size-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                      present ? "border-accent bg-accent text-white" : "border-line-strong",
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
        href="/lists"
        onClick={onClose}
        className="mt-3 block rounded-xl border border-dashed border-line-strong px-3 py-3 text-center text-sm text-fg-tertiary hover:border-line-accent hover:text-fg-accent"
      >
        Manage lists
      </Link>
    </Sheet>
  );
}
