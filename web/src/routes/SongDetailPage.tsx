"use client";

import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
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
import { useRecordSongClick } from "@/api/recordSongClick";
import { useSignInHref } from "@/auth/returnTo";
import { useAuth } from "@/auth/useAuth";
import { ListSongNavBar, ListSongSwipe } from "@/components/ListSongNav";
import { PageTitle } from "@/components/PageTitle";
import { PersonLinks } from "@/components/PersonLinks";
import { SongSearch } from "@/components/SongSearch";
import { WatchOnYouTube } from "@/components/WatchOnYouTube";
import { actionLabel, buttonClasses } from "@/components/buttonStyles";
import { Button, ConfirmSheet, ErrorMessage, Sheet, Skeleton, Spinner } from "@/components/ui";
import { browseHref } from "@/lib/browse";
import { CREDIT_DISPLAY_LABELS, groupCredits, songPerformers } from "@/lib/credits";
import { cn } from "@/lib/cn";
import { panelChrome } from "@/components/cardStyles";
import {
  DEFAULT_FONT_SIZE,
  FONT_SIZES,
  applyFontSize,
  drawnFontSize,
  storeFontSize,
} from "@/lib/fontSize";
import { LIST_PARAM, listPosition, songRefHref } from "@/lib/listContext";
import { canEditSong, hasRole, type Song } from "@/lib/types";
import { BackButton } from "@/components/BackButton";
import { headerBarPadding } from "@/components/SearchHeader";
import { sectionLabel } from "@/components/textStyles";
import { recordingCount, songCount } from "@/lib/format";
import { Link, useParams, useRouter, useSearchParams } from "@/lib/navigation";
import { useStoredState } from "@/lib/useStoredState";
import { RecordingsSheet } from "@/components/RecordingsSheet";

/**
 * A song. While the list is put away, the catalog's search box sits above the
 * song, which is the way to another one; once the list is on screen the box
 * would be a second one. The box stays outside the `<article>` the paging
 * swipe is read across.
 */
export function SongDetailPage() {
  return (
    // Fills the reading pane once the list is beside it, so the tools can stay
    // put and the lyrics scroll under them.
    <div className="@3xl/app:flex @3xl/app:min-h-0 @3xl/app:flex-1 @3xl/app:flex-col">
      {/* `contents` until it is hidden: a box only as tall as the header
          would be its whole sticky range, and it would scroll away. */}
      <div className="contents @3xl/app:hidden">
        <SongSearch />
      </div>
      <SongArticle />
    </div>
  );
}

/**
 * What the song route's `not-found.tsx` renders when the API says no song has
 * the address: the page's own "not available", under the same search header,
 * which is also this screen's only way to the navigation on a phone.
 */
export function SongNotFound() {
  return (
    <>
      {/* `contents` until it is hidden: a box only as tall as the header
          would be its whole sticky range, and it would scroll away. */}
      <div className="contents @3xl/app:hidden">
        <SongSearch />
      </div>
      <SongUnavailable message="No song has this address." />
    </>
  );
}

function SongUnavailable({ message }: { message: string }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-6 @3xl/app:mx-0 @3xl/app:max-w-none @3xl/app:px-3">
      <PageTitle name="Song not available" />
      <ErrorMessage>{message}</ErrorMessage>
      <Link href="/" className="mt-4 inline-block text-sm text-fg-accent hover:underline">
        Back to browse
      </Link>
    </div>
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
  // After the session settles, so a signed-in reader is not an anonymous click.
  useRecordSongClick(id, !sessionLoading && Boolean(song));
  const deleteSong = useDeleteSong();

  // The list this song is read from, if any. A failure just leaves the page
  // without list navigation.
  const listId = params.get(LIST_PARAM) ?? undefined;
  const { data: contextList } = useList(listId, !sessionLoading);

  // The whole article is the surface the paging swipe is read across.
  const surface = useRef<HTMLElement>(null);
  // The lyrics, under the tools. A new song opens at the top; the list beside
  // it keeps its own place.
  const lyrics = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: id is the trigger.
  useLayoutEffect(() => {
    lyrics.current?.scrollTo({ top: 0, behavior: "instant" });
  }, [id]);

  const [listSheetOpen, setListSheetOpen] = useState(false);
  const [recordingsOpen, setRecordingsOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Only the buttons' limits read this: the lyrics are sized by CSS from the
  // attribute the boot script set before first paint (lib/fontSize).
  const [fontSizeIndex, setFontSizeIndex] = useStoredState(DEFAULT_FONT_SIZE, drawnFontSize);

  const setFontSize = (index: number) => {
    const clamped = Math.max(0, Math.min(FONT_SIZES.length - 1, index));
    setFontSizeIndex(clamped);
    applyFontSize(clamped);
    storeFontSize(clamped);
  };

  // May run before the song arrives: `canEditSong` answers admins without it.
  const canEdit = canEditSong(user, song);

  // Settled with no song (a missing `id` too). Not `isError`: with a song in
  // hand that only means a failed refetch, which must not take the lyrics away.
  // See CLAUDE.md, "Frontend".
  if (!isLoading && !song) {
    return <SongUnavailable message={errorMessage(error, "This song could not be loaded.")} />;
  }

  // Located by the address, so the bar stays up while the next song loads.
  const position = contextList && id ? listPosition(contextList, id) : null;

  return (
    // Full width of the reading pane once the list is beside it. The phone keeps
    // the column.
    <article
      ref={surface}
      aria-busy={isLoading}
      className="mx-auto max-w-3xl @3xl/app:mx-0 @3xl/app:flex @3xl/app:min-h-0 @3xl/app:max-w-none @3xl/app:flex-1 @3xl/app:flex-col"
    >
      {/* The title alone; nameless while in flight. */}
      <PageTitle name={song?.title} />
      {/* Beside the list, Back leaves and this bar is the header: it stays
          put, and the lyrics scroll under it, so the scrollbar starts at the
          title. Its height follows the search header, chips included, so the
          two borders stay one line. */}
      <div
        className={cn(
          "@3xl/app:shrink-0 @3xl/app:border-b @3xl/app:border-line @3xl/app:bg-canvas @3xl/app:pt-safe",
          "@3xl/app:min-h-[var(--sticky-header-height,0px)]",
        )}
      >
        <div className={cn("flex items-center gap-2 @max-3xl/app:py-4", headerBarPadding)}>
          <BackButton className="@3xl/app:hidden" />
          {/* As tall as the search field once the list is beside the song, so
              the tools share its center. */}
          <div className="ml-auto flex items-center gap-1 @3xl/app:h-12">
            {/* Shown to guests too, who are sent to sign in. Labeled because "Save"
              alone does not say where to. */}
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
              <span className={actionLabel}>Save</span>
            </Button>
            {canEdit && (
              <Link href={`${songRefHref(id ?? "")}/edit`} className={buttonClasses("ghost", "sm")}>
                <Pencil aria-hidden className="size-4" />
                <span className={actionLabel}>Edit</span>
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
      </div>
      <div
        ref={lyrics}
        className="@3xl/app:min-h-0 @3xl/app:flex-1 @3xl/app:overflow-y-auto @3xl/app:overscroll-y-contain"
      >
        <div className="p-4">
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
              <h2 className={sectionLabel}>Lyrics</h2>
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
                  className="rounded-compact p-2 text-fg-tertiary hover:bg-muted disabled:opacity-40"
                >
                  <Minus aria-hidden className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setFontSize(fontSizeIndex + 1)}
                  disabled={fontSizeIndex === FONT_SIZES.length - 1}
                  aria-label="Increase text size"
                  className="rounded-compact p-2 text-fg-tertiary hover:bg-muted disabled:opacity-40"
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
                className="lyrics-size whitespace-pre-line leading-loose text-fg"
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
            <section className={cn(panelChrome, "mt-8")}>
              <h2 className="mb-1 text-sm font-semibold text-fg-secondary">Notes</h2>
              <p className="whitespace-pre-line text-sm text-fg-tertiary">{song.notes}</p>
            </section>
          )}

          {/* Needs only the id, so Save works while the song is loading. */}
          {user && id && (
            <AddToListSheet
              songId={id}
              open={listSheetOpen}
              onClose={() => setListSheetOpen(false)}
            />
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
        </div>
      </div>
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
              className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-fg-secondary hover:bg-muted-hover"
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
                  className="flex w-full items-center justify-between gap-3 rounded-control px-3 py-3 text-left transition-colors hover:bg-subtle"
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
                      present ? "border-accent bg-accent text-fg-on-fill" : "border-line-strong",
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
        className="mt-3 block rounded-control border border-dashed border-line-strong px-3 py-3 text-center text-sm text-fg-tertiary hover:border-line-accent hover:text-fg-accent"
      >
        Manage lists
      </Link>
    </Sheet>
  );
}

/** One labeled row of the header's credits; the value is names or a year. */
function CreditRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 text-fg-muted">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}
