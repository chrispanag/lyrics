"use client";

import { type ReactNode, useId, useLayoutEffect, useRef, useState } from "react";
import { ChartColumn, Check, ListPlus, Pencil, Play, SixteenthNotes, Trash, X } from "lucide-react";

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
import { ButtonLink } from "@/components/ButtonLink";
import { Fact, FactList } from "@/components/FactList";
import { GenreTag } from "@/components/GenreTag";
import { TextSizeControl } from "@/components/TextSizeControl";
import { actionLabel } from "@/components/buttonStyles";
import { MenuItem, MoreActionsMenu } from "@/components/MoreActionsMenu";
import { SongStatsSheet } from "@/components/SongStatsSheet";
import {
  Button,
  ConfirmSheet,
  EmptyState,
  ErrorMessage,
  Sheet,
  Skeleton,
  Spinner,
} from "@/components/ui";
import { CREDIT_DISPLAY_LABELS, groupCredits, songPerformers } from "@/lib/credits";
import { cn } from "@/lib/cn";
import { panelChrome } from "@/components/cardStyles";
import { songRefHref } from "@/lib/listContext";
import { canEditSong, hasRole, type Recording, type Song } from "@/lib/types";
import { BackButton } from "@/components/BackButton";
import { headerBarPadding } from "@/components/SearchHeader";
import { linkClasses, sectionLabel } from "@/components/textStyles";
import { recordingCount, songCount } from "@/lib/format";
import { Link, useRouter } from "@/lib/navigation";
import { stickyBarClasses, useStickyBar } from "@/components/stickyBar";
import { FirstRecordingBadge, RecordingNotes, RecordingsSheet } from "@/components/RecordingsSheet";
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
      {/* Nothing failed, so it is said calmly, as a dead link is (app/not-found). */}
      <SongUnavailable>
        <EmptyState
          icon={<SixteenthNotes aria-hidden className="size-12" />}
          title="Song not found"
          description="No song has this address."
          action={<BrowseSongs />}
        />
      </SongUnavailable>
    </>
  );
}

/** The way back from a song that is not there. */
function BrowseSongs() {
  return (
    <ButtonLink href="/" variant="secondary" size="sm">
      Browse songs
    </ButtonLink>
  );
}

/** Where a song would be, holding what is said in its place. */
function SongUnavailable({ children }: { children: ReactNode }) {
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
      {children}
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
  const [videoOpen, setVideoOpen] = useState(false);
  // A sheet, or the player, belongs to the song it was opened on. Stepping to
  // another (Back, Forward, a list's arrows) closes them, rather than showing
  // the next song's counts or recordings under the same title, or playing the
  // last song over the next one's words.
  const [sheetsFor, setSheetsFor] = useState(id);
  if (sheetsFor !== id) {
    setSheetsFor(id);
    setListSheetOpen(false);
    setRecordingsOpen(false);
    setStatsOpen(false);
    setConfirmDelete(false);
    setVideoOpen(false);
  }
  // A refetch that takes the video away closes the player for good: were the
  // id to come back, it must not start playing again without a press.
  if (videoOpen && song && !song.youtube_video_id) setVideoOpen(false);
  // May run before the song arrives: `canEditSong` answers admins without it.
  const canEdit = canEditSong(user, song);

  // Settled with no song (a missing `id` too). Not `isError`: with a song in
  // hand that only means a failed refetch, which must not take the lyrics away.
  // See CLAUDE.md, "Frontend".
  if (!isLoading && !song) {
    return (
      <SongUnavailable>
        <ErrorMessage>{errorMessage(error, "This song could not be loaded.")}</ErrorMessage>
        <div className="mt-4">
          <BrowseSongs />
        </div>
      </SongUnavailable>
    );
  }

  return (
    // Full width of the reading pane once the list is beside it. Only there is
    // it the `song` container `SONG_COLUMN` is laid out by: the pane's width,
    // not the window's, decides whether the column is held to a line. A phone
    // has no `song` container.
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
                tallies, so this need not wait for the full read. */}
            <Button variant="ghost" size="sm" disabled={!song} onClick={() => setStatsOpen(true)}>
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
              <ButtonLink
                href={`${songRefHref(id ?? "")}/edit`}
                prefetch={false}
                variant="ghost"
                size="sm"
              >
                <Pencil aria-hidden className="size-4" />
                <span className={actionLabel}>Edit</span>
              </ButtonLink>
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
        <div className={SONG_COLUMN}>
          {/* The title, and the list's bar above it: the column's head. */}
          <div>
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
            videoOpen={videoOpen}
            onToggleVideo={() => setVideoOpen((open) => !open)}
            onShowRecordings={() => setRecordingsOpen(true)}
          />

          <div>
            <section aria-label="Lyrics">
              <div className="mb-2 flex items-center justify-between">
                <h2 className={sectionLabel}>Lyrics</h2>
                <TextSizeControl />
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
        "@3xl/app:shrink-0 @3xl/app:border-b @3xl/app:border-line @3xl/app:pt-safe",
        "@3xl/app:min-h-[var(--sticky-header-height,0px)]",
        stickyBarClasses({ phoneOnly: true }),
      )}
    >
      {children}
    </div>
  );
}

/**
 * The song's content under its tools: one column, the title, the credits and
 * the lyrics, at every width. In the reading pane's `song` container (see
 * `SongArticle`) it is held to 40rem and centered from `@2xl` (42rem), wider
 * than a comfortable line, rather than run out to the pane's left edge. A phone
 * has no `song` container.
 */
const SONG_COLUMN = cn("p-4", "@2xl/song:mx-auto @2xl/song:max-w-168");

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
 * What is known about a song besides its words, between the title and the
 * lyrics at every width, as a record sleeve prints its credits: the facts in
 * one band that wraps, the recordings line, the genres, and the way to the
 * video. The video plays here, above the lyrics, so the words stay readable
 * while it plays; it opens on a press and is put away on another.
 *
 * The skeleton mirrors the band's first line and the genres, so the lyrics
 * under them barely move as the song arrives; change the two together.
 */
function SongDetails({
  song,
  videoOpen,
  onToggleVideo,
  onShowRecordings,
}: {
  song: Song | undefined;
  videoOpen: boolean;
  onToggleVideo: () => void;
  onShowRecordings: () => void;
}) {
  const playerId = useId();
  // Gated on the id, never the URL; see WatchOnYouTube.
  const videoId = song?.youtube_video_id;

  // A song with nothing to say gets no band: two rules around nothing, and an
  // empty landmark.
  if (song && !hasDetails(song)) return null;

  return (
    <aside aria-label="Song details" className="mt-3 mb-6 border-y border-line py-3">
      {song ? (
        <>
          <SongFacts song={song} onShowRecordings={onShowRecordings} />
          {(song.genres.length > 0 || videoId) && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {song.genres.map((genre) => (
                <GenreTag key={genre.id} genre={genre} linked />
              ))}
              {videoId && (
                // Full size, not `sm`: a phone's thumb reaches for it beside
                // the genres' links.
                <Button
                  variant="secondary"
                  onClick={onToggleVideo}
                  aria-expanded={videoOpen}
                  aria-controls={videoOpen ? playerId : undefined}
                  className="ml-auto"
                >
                  {videoOpen ? (
                    <X aria-hidden className="size-4" />
                  ) : (
                    <Play aria-hidden className="size-4" />
                  )}
                  {videoOpen ? "Hide video" : "Watch"}
                </Button>
              )}
            </div>
          )}
          {/* Closed on another song with the sheets (`SongArticle`), so a
              frame never plays one song under the next one's words. */}
          {videoId && videoOpen && (
            <div id={playerId} className="mt-3">
              <YouTubePlayer videoId={videoId} title={song.title} />
            </div>
          )}
        </>
      ) : (
        <>
          <Skeleton className="h-5 w-2/3" />
          {/* No `rounded-full` on the chip: `cn` is a plain join. */}
          <Skeleton className="mt-3 h-6 w-20" />
        </>
      )}
    </aside>
  );
}

/**
 * Whether `SongDetails` shows anything: the rows of `SongFacts` and
 * `OnlyRecording`, the genres and the video. Change them together.
 */
function hasDetails(song: Song): boolean {
  const only = song.recordings.length === 1 ? song.recordings[0] : undefined;
  return (
    songPerformers(song).length > 0 ||
    groupCredits(song.credits).length > 0 ||
    Boolean(song.release_year) ||
    song.genres.length > 0 ||
    Boolean(song.youtube_video_id) ||
    song.recordings.length > 1 ||
    Boolean(only && (only.label || only.is_first || only.notes))
  );
}

/** The credits and the recordings line, in the song's language. */
function SongFacts({ song, onShowRecordings }: { song: Song; onShowRecordings: () => void }) {
  const creditsByRole = groupCredits(song.credits);

  // Performers come from the first recording; the year and video from the
  // song's columns, which are the trigger's copy of that same row. No `??`
  // hedge between them. See CLAUDE.md, "Recordings".
  const performers = songPerformers(song);
  const year = song.release_year;
  const onlyRecording = song.recordings.length === 1 ? song.recordings[0] : undefined;
  // A lone recording's mark goes on its performers' line, which it describes.
  const markOnPerformers = Boolean(onlyRecording?.is_first && performers.length > 0);

  return (
    <div lang={song.language}>
      <FactList layout="inline" className="text-sm">
        {/* Performers lead; the row is conditional, since most recordings
            name nobody. */}
        {performers.length > 0 && (
          <Fact label="Performed by">
            <PersonLinks people={performers} />
            {markOnPerformers && (
              <span className="ml-2 inline-block">
                <FirstRecordingBadge />
              </span>
            )}
          </Fact>
        )}
        {creditsByRole.map(([role, names]) => (
          <Fact key={role} label={CREDIT_DISPLAY_LABELS[role]}>
            <PersonLinks people={names} />
          </Fact>
        ))}
        {year && <Fact label="Year">{year}</Fact>}
      </FactList>

      {onlyRecording ? (
        <OnlyRecording recording={onlyRecording} markShown={markOnPerformers} />
      ) : (
        song.recordings.length > 0 && (
          <button
            type="button"
            onClick={onShowRecordings}
            className={linkClasses("accent", "mt-2 text-sm")}
          >
            Show all {recordingCount(song.recordings.length)}
          </button>
        )
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
function OnlyRecording({
  recording,
  markShown,
}: {
  recording: Recording;
  /** The first-recording mark is already on the performers' line. */
  markShown: boolean;
}) {
  const mark = recording.is_first && !markShown;
  if (!recording.label && !mark && !recording.notes) return null;

  return (
    <div className="mt-2">
      {(recording.label || mark) && (
        <p className="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
          {recording.label}
          {/* Keyed on the flag, as in the sheet: being the only one makes no claim. */}
          {mark && <FirstRecordingBadge />}
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
