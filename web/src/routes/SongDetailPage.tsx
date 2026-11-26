"use client";

import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { ChartColumn, Check, ListPlus, Minus, Pencil, Plus, Trash, Type } from "lucide-react";

import { errorMessage } from "@/api/client";
import { useDeleteSong, useLists, useSong, useSongLists, useToggleSongInList } from "@/api/hooks";
import { useRecordSongClick } from "@/api/recordSongClick";
import { useListPosition } from "@/api/useListPosition";
import { useSignInHref } from "@/auth/returnTo";
import { useAuth } from "@/auth/useAuth";
import { ListSongNavBar, ListSongSwipe } from "@/components/ListSongNav";
import { contentWidth } from "@/components/Page";
import { PageTitle } from "@/components/PageTitle";
import { PersonLinks } from "@/components/PersonLinks";
import { SongSearch } from "@/components/SongSearch";
import { WatchOnYouTube } from "@/components/WatchOnYouTube";
import { actionLabel, buttonClasses } from "@/components/buttonStyles";
import { MenuItem, MoreActionsMenu } from "@/components/MoreActionsMenu";
import { SongStats, SongStatsSheet } from "@/components/SongStatsSheet";
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
import { songRefHref } from "@/lib/listContext";
import { canEditSong, hasRole, type Recording, type Song } from "@/lib/types";
import { BackButton } from "@/components/BackButton";
import { headerBarPadding } from "@/components/SearchHeader";
import { sectionLabel } from "@/components/textStyles";
import { recordingCount, songCount } from "@/lib/format";
import { Link, useRouter } from "@/lib/navigation";
import { stickyBarClasses, useStickyBar } from "@/components/stickyBar";
import { useStoredState } from "@/lib/useStoredState";
import {
  FirstRecordingBadge,
  RecordingList,
  RecordingNotes,
  RecordingsSheet,
} from "@/components/RecordingsSheet";
import { YouTubePlayer } from "@/components/YouTubePlayer";

/**
 * The catalog's search box above a song, from `md` up while the list is put
 * away: the way to another song. Once the list is on screen the box would be
 * a second one, and below `md` the bottom bar's Search is the way, so the song
 * gets the room.
 *
 * `contents` until it is hidden: a box only as tall as the header would be its
 * whole sticky range, and it would scroll away.
 */
function SongSearchAbove() {
  return (
    <div className="contents max-md:hidden @3xl/app:hidden">
      <SongSearch />
    </div>
  );
}

/**
 * A song. The search box above it stays outside the `<article>` the paging
 * swipe is read across.
 */
export function SongDetailPage() {
  return (
    // Fills the reading pane once the list is beside it, so the tools can stay
    // put and the lyrics scroll under them.
    <div className="@3xl/app:flex @3xl/app:min-h-0 @3xl/app:flex-1 @3xl/app:flex-col">
      <SongSearchAbove />
      <SongArticle />
    </div>
  );
}

/**
 * What the song route's `not-found.tsx` renders when the API says no song has
 * the address: the page's own "not available", under the same search header
 * as a song, from which the reader can look for the one they meant.
 */
export function SongNotFound() {
  return (
    <>
      <SongSearchAbove />
      <SongUnavailable message="No song has this address." />
    </>
  );
}

function SongUnavailable({ message }: { message: string }) {
  return (
    <div
      className={cn(
        "mx-auto px-4 py-6 @3xl/app:mx-0 @3xl/app:max-w-none @3xl/app:px-3",
        // No header above it on a phone, so it keeps clear of the notch itself.
        "max-md:pt-[calc(--spacing(6)+env(safe-area-inset-top))]",
        contentWidth,
      )}
    >
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
  // From the address, not `useParams`: Next merges the params of every active
  // segment, and the list kept beside the song is one (see `listInView`). The
  // list this song is read from, if any, as the pane beside it reads it; a
  // failure just leaves the page without list navigation. Located by the
  // address, so the bar stays up while the next song loads.
  const { ref: id, position } = useListPosition();
  const router = useRouter();
  const signIn = useSignInHref();
  const { user, loading: sessionLoading } = useAuth();

  // No `isError`, deliberately; see the guard below.
  const { data: song, isLoading, isPlaceholderData, error } = useSong(id, { fromCachedCard: true });
  // The song read in full. A placeholder is the catalog's card, which carries
  // no lyrics: that is not "no lyrics", and not a song that has loaded.
  const fullSong = isPlaceholderData ? undefined : song;
  // After the session settles, so a signed-in reader is not an anonymous click,
  // and after the full read: a cached card is not a song that has loaded.
  useRecordSongClick(id, !sessionLoading && Boolean(fullSong));
  const deleteSong = useDeleteSong();

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
  const [statsOpen, setStatsOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // A sheet belongs to the song it was opened on. Stepping to another (Back,
  // Forward, a list's arrows) closes them, rather than showing the next song's
  // counts or recordings under the same title.
  const [sheetsFor, setSheetsFor] = useState(id);
  if (sheetsFor !== id) {
    setSheetsFor(id);
    setListSheetOpen(false);
    setRecordingsOpen(false);
    setStatsOpen(false);
    setConfirmDelete(false);
  }
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

  return (
    // Full width of the reading pane once the list is beside it. The phone keeps
    // the column. Beside the list it is also the `song` container, which the
    // reading column and the details column are laid out by (`SONG_COLUMNS`):
    // the pane's own width, not the window's, decides, since the list and the
    // navigation take a varying share of the window. Only there: below it no
    // `song` container exists, so none of those queries match and a phone or
    // a lone pane keeps the single column it has always had.
    <article
      ref={surface}
      aria-busy={isLoading || isPlaceholderData}
      className={cn(
        "mx-auto @3xl/app:mx-0 @3xl/app:flex @3xl/app:min-h-0 @3xl/app:max-w-none @3xl/app:flex-1 @3xl/app:flex-col",
        "@3xl/app:@container/song",
        contentWidth,
      )}
    >
      {/* The title alone; nameless while in flight. */}
      <PageTitle name={song?.title} />
      <SongToolsBar>
        <div
          className={cn(
            "flex items-center gap-2 max-md:py-1 md:@max-3xl/app:py-4",
            headerBarPadding,
          )}
        >
          <BackButton className="@3xl/app:hidden" />
          {/* As tall as the search field once the list is beside the song, so
              the tools share its center. */}
          <div className="ml-auto flex items-center gap-1 @3xl/app:h-12">
            {/* For everyone. The card a reader clicked already carries the
                tallies, so this need not wait for the full read. Not where
                the details column shows the tallies themselves. */}
            <Button
              variant="ghost"
              size="sm"
              disabled={!song}
              onClick={() => setStatsOpen(true)}
              className="@3xl/song:hidden"
            >
              <ChartColumn aria-hidden className="size-4" />
              <span className={actionLabel}>Stats</span>
            </Button>
            {/* Shown to guests too, who are sent to sign in. */}
            <Button
              variant="ghost"
              size="sm"
              // `user` is only a snapshot until the restore settles; neither branch
              // may be decided on it.
              disabled={sessionLoading}
              onClick={() => (user ? setListSheetOpen(true) : router.push(signIn))}
            >
              <ListPlus aria-hidden className="size-4" />
              <span className={actionLabel}>Add to list</span>
            </Button>
            {canEdit && (
              <Link
                href={`${songRefHref(id ?? "")}/edit`}
                prefetch={false}
                className={buttonClasses("ghost", "sm")}
              >
                <Pencil aria-hidden className="size-4" />
                <span className={actionLabel}>Edit</span>
              </Link>
            )}
            {/* A step away from a reader's thumb. Waits for the song: the
                confirmation names it. Only an admin has anything in it, so no
                one else is shown the menu. */}
            <MoreActionsMenu disabled={!song}>
              {hasRole(user?.role, "admin") && (
                <MenuItem icon={Trash} danger onSelect={() => setConfirmDelete(true)}>
                  Delete song
                </MenuItem>
              )}
            </MoreActionsMenu>
          </div>
        </div>
      </SongToolsBar>
      <div
        ref={lyrics}
        className="@3xl/app:min-h-0 @3xl/app:flex-1 @3xl/app:overflow-y-auto @3xl/app:overscroll-y-contain"
      >
        <div className={SONG_COLUMNS}>
          {/* The title, and the list's bar above it: the reading column's head. */}
          <div className="@3xl/song:col-start-1 @3xl/song:row-start-1 @3xl/song:mb-5">
            {position && (
              <>
                <ListSongNavBar position={position} />
                {/* The swipe waits for the song: its once-per-device hint must not be
                spent on a song that fails to load. */}
                {fullSong && <ListSongSwipe position={position} surface={surface} />}
              </>
            )}
            {song ? <SongTitle song={song} /> : <Skeleton className="h-9 w-2/3" />}
          </div>

          <SongDetails
            song={song}
            fullSong={fullSong}
            onShowRecordings={() => setRecordingsOpen(true)}
          />

          <div className="@3xl/song:col-start-1 @3xl/song:row-start-2">
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

              {!fullSong ? (
                <Skeleton className="h-64 w-full" />
              ) : fullSong.lyrics?.trim() ? (
                // `lang` pairs with `<html lang="en">`: the lyrics are mostly Greek.
                <p
                  lang={fullSong.language}
                  className="lyrics-size leading-loose text-fg"
                  style={{ fontFamily: "var(--font-lyrics)" }}
                >
                  <LyricsLines lyrics={fullSong.lyrics} />
                </p>
              ) : (
                <p className="text-sm italic text-fg-muted">No lyrics have been added yet.</p>
              )}
            </section>

            {/* Gated on the id, never the URL; see WatchOnYouTube. The details
                column plays the video in place instead. */}
            {song?.youtube_video_id && (
              <WatchOnYouTube videoId={song.youtube_video_id} className="mt-6 @3xl/song:hidden" />
            )}

            {song?.notes && (
              <section className={cn(panelChrome, "mt-8")}>
                <h2 className="mb-1 text-sm font-semibold text-fg-secondary">Notes</h2>
                <p className="whitespace-pre-line text-sm text-fg-tertiary">{song.notes}</p>
              </section>
            )}
          </div>
        </div>

        {/* Needs only the id, so Add to list works while the song is loading. */}
        {user && id && (
          <AddToListSheet
            songId={id}
            open={listSheetOpen}
            onClose={() => setListSheetOpen(false)}
          />
        )}

        {song && (
          <SongStatsSheet song={song} open={statsOpen} onClose={() => setStatsOpen(false)} />
        )}

        {song && (
          <RecordingsSheet
            recordings={song.recordings}
            language={song.language}
            // Only reachable past one recording: a refetch that leaves one
            // closes it rather than stranding it with nothing to return to.
            open={recordingsOpen && song.recordings.length > 1}
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
    </article>
  );
}

/**
 * The row of Back and the song's tools.
 *
 * Beside the list, Back leaves and this bar is the header: it stays put, and
 * the lyrics scroll under it, so the scrollbar starts at the title. Its height
 * follows the search header, chips included, so the two borders stay one line.
 *
 * On a phone it is the page's only top bar, so it is a thin sticky one, with
 * `StickyHeader`'s chrome and its tuck, and it publishes its height for the
 * root's scroll padding as that header would (`useStickyBar`). Only there:
 * beside the list it reads the height the catalog's header publishes.
 */
function SongToolsBar({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useStickyBar(ref, { phoneOnly: true });

  return (
    <div
      ref={ref}
      // "phone": index.css keeps focus inside it from scrolling where it is
      // stuck, and leaves it alone where it is an ordinary row.
      data-sticky-header="phone"
      className={cn(
        "@3xl/app:shrink-0 @3xl/app:border-b @3xl/app:border-line @3xl/app:bg-canvas @3xl/app:pt-safe",
        "@3xl/app:min-h-[var(--sticky-header-height,0px)]",
        stickyBarClasses({ phoneOnly: true }),
      )}
    >
      {children}
    </div>
  );
}

/**
 * The song's content under its tools, in the reading pane's `song` container
 * (see `SongArticle`), in three tiers by the pane's width:
 *
 * - Narrow, and on a phone, where there is no `song` container: one column,
 *   the details above the lyrics.
 * - From `@2xl` (42rem), wider than a comfortable line: the same column held
 *   to 40rem and centered in the pane, rather than run out to its left edge.
 * - From `@3xl` (48rem): the details move beside the lyrics, a sticky column
 *   on the right, and the lyrics start right under the title. 48rem leaves the
 *   lyrics at least 26rem beside a 16rem column, which a pane reaches in a
 *   1280px window with the navigation put away, or a 1440px one with it open.
 *   From `@5xl` (64rem) the column widens to 20rem; the lyrics stay at 40rem.
 *
 * One tree for all three: the details are a grid item placed in the second
 * column, not a second copy, so nothing is in the page twice.
 */
const SONG_COLUMNS = cn(
  "p-4",
  "@2xl/song:mx-auto @2xl/song:max-w-168",
  "@3xl/song:grid @3xl/song:max-w-240 @3xl/song:grid-cols-[minmax(0,1fr)_16rem] @3xl/song:grid-rows-[auto_1fr] @3xl/song:gap-x-8",
  "@5xl/song:max-w-256 @5xl/song:grid-cols-[minmax(0,1fr)_20rem]",
);

/** The song's title, in the song's own language: the title is content too. */
function SongTitle({ song }: { song: Song }) {
  return (
    <header lang={song.language}>
      <h1 className="text-3xl font-bold leading-tight tracking-tight text-balance">{song.title}</h1>
      {song.alt_title && <p className="mt-1 text-lg text-fg-muted">{song.alt_title}</p>}
    </header>
  );
}

/**
 * What is known about a song besides its words: credits, year and genres, and
 * its recordings, a lone one inline or the way into several. Under the title
 * in a narrow pane; beside the lyrics in a wide one (`SONG_COLUMNS`), where it
 * also plays the video and shows the recordings and tallies in place of the
 * sheets, whose buttons are hidden there.
 *
 * Ahead of the lyrics in the DOM in every tier, because in a narrow pane it is
 * ahead of them on screen, and one tree cannot be in two places: moving it
 * after the lyrics would have a phone read the credits after the song they
 * head. Beside the lyrics it is a labeled landmark, a step to skip.
 *
 * Credits and recordings come from the card while the full read is on its way,
 * as the header always has. The tallies wait for the full read: the column
 * shows them as the song page's own, and a card's are as old as its list.
 *
 * In a narrow pane the skeleton mirrors the real spacing, so the lyrics do not
 * move as the song arrives; change the two together.
 */
function SongDetails({
  song,
  fullSong,
  onShowRecordings,
}: {
  song: Song | undefined;
  fullSong: Song | undefined;
  onShowRecordings: () => void;
}) {
  return (
    <aside
      aria-label="Song details"
      className={cn(
        "mt-3 mb-5",
        "@3xl/song:col-start-2 @3xl/song:row-span-2 @3xl/song:row-start-1 @3xl/song:m-0 @3xl/song:self-start",
        // Sticky under the pane's header, which sits outside the lyrics'
        // scroller, so the column's top is the scroller's. As tall as that
        // scroller at most, the page's padding taken off, and scrolled on its
        // own past that. The padding keeps a focused link's ring unclipped.
        "@3xl/song:sticky @3xl/song:top-4 @3xl/song:max-h-[calc(100dvh-var(--sticky-header-height,0px)-2rem)] @3xl/song:overflow-y-auto @3xl/song:overscroll-y-contain @3xl/song:p-1",
      )}
    >
      {song ? (
        <>
          <SongFacts song={song} onShowRecordings={onShowRecordings} />
          <div className="hidden space-y-6 @3xl/song:mt-6 @3xl/song:block">
            {song.youtube_video_id && (
              <YouTubePlayer key={song.id} videoId={song.youtube_video_id} title={song.title} />
            )}
            {song.recordings.length > 0 && (
              <section aria-labelledby="song-recordings" className="text-sm">
                <h2 id="song-recordings" className={cn(sectionLabel, "mb-2")}>
                  Recordings
                </h2>
                <RecordingList recordings={song.recordings} language={song.language} />
              </section>
            )}
            <section aria-labelledby="song-stats" className="text-sm">
              <h2 id="song-stats" className={cn(sectionLabel, "mb-2")}>
                Stats
              </h2>
              {fullSong ? (
                <SongStats popularity={fullSong.popularity} />
              ) : (
                <Skeleton className="h-24 w-full" />
              )}
            </section>
          </div>
        </>
      ) : (
        <>
          <div className="space-y-1">
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-5 w-1/3" />
          </div>
          {/* No `rounded-full` on the chip: `cn` is a plain join. */}
          <Skeleton className="mt-2 h-5 w-36" />
          <Skeleton className="mt-3 h-6 w-20" />
        </>
      )}
    </aside>
  );
}

/** The credits, the recordings line and the genres, in the song's language. */
function SongFacts({ song, onShowRecordings }: { song: Song; onShowRecordings: () => void }) {
  const creditsByRole = groupCredits(song.credits);

  // Performers come from the first recording; the year and video from the
  // song's columns, which are the trigger's copy of that same row. No `??`
  // hedge between them. See CLAUDE.md, "Recordings".
  const performers = songPerformers(song);
  const year = song.release_year;
  const onlyRecording = song.recordings.length === 1 ? song.recordings[0] : undefined;

  return (
    <div lang={song.language}>
      <dl className="space-y-1 text-sm">
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

      {/* Beside the lyrics the column lists every recording instead. */}
      {onlyRecording ? (
        <div className="@3xl/song:hidden">
          <OnlyRecording recording={onlyRecording} />
        </div>
      ) : (
        song.recordings.length > 0 && (
          <button
            type="button"
            onClick={onShowRecordings}
            className="mt-2 text-sm font-medium text-fg-accent hover:underline @3xl/song:hidden"
          >
            Show all {recordingCount(song.recordings.length)}
          </button>
        )
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
    </div>
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
    <Sheet open={open} onClose={onClose} title="Add to list">
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

/**
 * What the recordings sheet would add about a song's only recording, in its
 * place. Its performers, year and video are already on the page, as the song's
 * copies of this same row, so only the label, the first-recording mark and the
 * notes remain. Nothing at all when the row has none of them.
 */
function OnlyRecording({ recording }: { recording: Recording }) {
  if (!recording.label && !recording.is_first && !recording.notes) return null;

  return (
    <div className="mt-2">
      {(recording.label || recording.is_first) && (
        <p className="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
          {recording.label}
          {/* Keyed on the flag, as in the sheet: being the only one makes no claim. */}
          {recording.is_first && <FirstRecordingBadge />}
        </p>
      )}
      {recording.notes && <RecordingNotes notes={recording.notes} />}
    </div>
  );
}

/**
 * The lyrics, one block per stored line, each with a hanging indent: on a
 * narrow screen a line too long to fit wraps with its remainder indented, so a
 * continuation never reads as the next line. `text-indent` reaches only a
 * block's first line, hence a block per line. Plain text throughout: lyrics are
 * user input.
 *
 * A blank line is a `<br>`, not an empty block held open: an empty block adds
 * nothing to a copied selection, which would run the verses together. A line
 * of only spaces is blank too, since its spaces collapse to nothing. Leading
 * and trailing breaks, which a pasted textarea often stores, are dropped.
 */
function LyricsLines({ lyrics }: { lyrics: string }) {
  return lyrics
    .trim()
    .split(/\r?\n/)
    .map((line, index) => (
      // biome-ignore lint/suspicious/noArrayIndexKey: one string's lines, never reordered.
      <span key={index} className="block pl-[1em] -indent-[1em]">
        {line.trim() ? line : <br />}
      </span>
    ));
}

/** One labeled row of the song's credits; the value is names or a year. */
function CreditRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 text-fg-muted">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}
