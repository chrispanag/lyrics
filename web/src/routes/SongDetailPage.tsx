import { useLayoutEffect, useRef, useState } from "react";
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
import { ListSongNavBar, ListSongSwipe } from "@/components/ListSongNav";
import { PageTitle } from "@/components/PageTitle";
import { PersonLinks } from "@/components/PersonLinks";
import { SongSearch } from "@/components/SongSearch";
import { WatchOnYouTube } from "@/components/WatchOnYouTube";
import { buttonClasses } from "@/components/buttonStyles";
import { Button, ConfirmSheet, ErrorMessage, Sheet, Skeleton } from "@/components/ui";
import { browseHref } from "@/lib/browse";
import { CREDIT_DISPLAY_LABELS, groupCredits } from "@/lib/credits";
import { cn } from "@/lib/cn";
import { DEFAULT_FONT_SIZE, FONT_SIZES, storeFontSize, storedFontSize } from "@/lib/fontSize";
import { LIST_PARAM, listPosition, songRefHref } from "@/lib/listContext";
import { canEditSong, hasRole, type Song } from "@/lib/types";
import { BackButton } from "@/components/BackButton";
import { recordingCount, songCount } from "@/lib/format";
import { RecordingsSheet } from "@/components/RecordingsSheet";

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

/**
 * The song, and the chrome that is the same chrome for every song.
 *
 * Only the second half waits. The way back, the way into a list, the way to the
 * editor and the reader's place in a list are all decided by the address and the
 * session rather than by the song, so they are drawn at once — a step through a
 * list used to replace the lot with a grey block and draw it again a moment
 * later, and the one control a reader is most likely to reach for while waiting
 * is the one that takes them back out.
 *
 * What is left to a skeleton is the song's own: its title, who made it, its
 * lyrics and its notes.
 */
function SongArticle() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const { user, loading: sessionLoading } = useAuth();

  // No `isError` deliberately — see the guard below, which is the whole reason
  // the flag is not read. `error` still is: it names the failure that left this
  // page with no song at all.
  const { data: song, isLoading, error } = useSong(id);
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
  // one leaves empty page below that pages nothing — which is the safe way
  // round, a swipe below the lyrics doing nothing rather than the lyrics having
  // a dead strip across them.
  const surface = useRef<HTMLElement>(null);

  const [listSheetOpen, setListSheetOpen] = useState(false);
  const [recordingsOpen, setRecordingsOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // The default first, and the reader's own size a moment later. Read during
  // the first render instead — which is what this was — and the size is a
  // browser-only answer inside a render body: it throws where there is no
  // storage, and wrapping that only trades the throw for the worse failure,
  // a server rendering one size and the client's first render another. React
  // answers that mismatch by discarding the server's HTML and rendering the
  // whole root again.
  //
  // A layout effect rather than an ordinary one because it runs before the
  // browser paints, so on the client-only route this is today nothing changes
  // visually at all — where an effect would paint text-lg first and correct it.
  // That is the same flash `THEME_BOOT_SCRIPT` is in `app/layout.tsx` to avoid
  // one level up, and for the same reason: the wrong answer painted once reads
  // worse than the right one painted a beat late.
  const [fontSizeIndex, setFontSizeIndex] = useState(DEFAULT_FONT_SIZE);
  useLayoutEffect(() => {
    setFontSizeIndex(storedFontSize());
  }, []);

  const setFontSize = (index: number) => {
    const clamped = Math.max(0, Math.min(FONT_SIZES.length - 1, index));
    setFontSizeIndex(clamped);
    storeFontSize(clamped);
  };

  // Asked of a song that may not be here yet, which `canEditSong` answers for
  // the role that can edit every song and refuses for everyone else — see the
  // order of its guards. A contributor's link therefore arrives with the song
  // rather than being promised early and then withdrawn.
  const canEdit = canEditSong(user, song);

  // A song this page has not got, once the request has settled on not having
  // it. Both halves earn their place. `!song` alone is every load, since the
  // shell below is rendered while the song is in flight, so every song would
  // paint this page on its way in; `!isLoading` alone never fires, a settled
  // request being the only kind that is not loading. A missing `id` lands here
  // too, its query never having been enabled — a disabled query is not
  // `isLoading` either.
  //
  // `isError` is deliberately *not* a third disjunct, though it reads like the
  // obvious one. It is only ever true here with a song already in hand — a
  // refetch that failed, which react-query runs on every return to the tab —
  // and a reader on a phone that lost signal mid-song would then watch the
  // lyrics they were reading replaced by an error about a request they never
  // made. The cached song stays instead. What that costs is the other
  // direction: a song deleted by somebody else stays readable here until the
  // page is reloaded, and a failed refresh is silent. Both are quieter than
  // taking a song off the screen of someone reading it.
  if (!isLoading && !song) {
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

  // Located by the address rather than by the song, so the bar is there while the
  // next song loads instead of blinking out at every step through a list — the
  // reader's place in it is what the URL already says.
  const position = contextList && id ? listPosition(contextList, id) : null;

  return (
    // The catalog's column, which is the search header's above it: the box a
    // reader's eye follows down from the field has to be the same box, and the
    // open results panel hung 48px past this article on each side while it was
    // narrower. Every state of the page carries it, or the width changes as the
    // song arrives.
    <article ref={surface} aria-busy={isLoading} className="mx-auto max-w-3xl px-4 py-4">
      {/* The song alone, not the song and its artist: a tab strip truncates
          hard, and the title is what a reader is looking for among ten of
          these. Nameless while the song is in flight, rather than a tab that
          flashes "undefined — Songfolio" on every step through a list. */}
      <PageTitle name={song?.title} />
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
              to={`${songRefHref(id ?? "")}/edit`}
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
              // The one irreversible action on the page, and the confirmation
              // behind it names the song. Held until there is a song to name:
              // asking someone to confirm the deletion of a title they have not
              // been shown is the one wait worth keeping.
              disabled={!song}
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
          {/* The bar is chrome and comes at once; the gesture is read across the
              song, so it waits for one. Not a nicety: the mark that explains the
              swipe is shown once per device the moment it is on screen, and a
              song that fails to load would spend that showing on a page with no
              gesture on it — which is the failure `useSwipeHint`'s observer
              exists to prevent, arriving from the other side. What it costs is a
              swipe made during the load window doing nothing; the bar's own
              arrows are there throughout, and a hint still showing when the
              reader swipes ends with the step they have just made. */}
          {song && <ListSongSwipe position={position} surface={surface} />}
        </>
      )}

      {song ? (
        <SongHeader song={song} onShowRecordings={() => setRecordingsOpen(true)} />
      ) : (
        // The header's own margins and rhythm, so the lyrics heading below —
        // which is a control, being where the text size is set — lands within a
        // pixel or two of where the song will put it: `mb-5` under the block and
        // `mt-3` off the title, then the two credit lines, the recordings button
        // `mt-2` under them and the one genre chip most songs carry. A song with
        // more or fewer moves it, and there is nothing here that could know
        // which; what the shape buys is that the common case does not.
        //
        // The button's `mt-2` needs the plain wrapper around it. `space-y-*`
        // puts a `margin-block-end` on every child of the group but the last, so
        // a button dropped straight in would have its 8px top margin collapse
        // against the credits' 12px bottom one and lose — the class written and
        // then ignored, the gap silently the group's rather than the button's.
        //
        // No `rounded-full` on the chip, tempting as it is: `cn` is a plain join,
        // so it would land beside Skeleton's own `rounded-lg` and CSS source
        // order, not this line, would pick the winner.
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

        {!song ? (
          <Skeleton className="h-64 w-full" />
        ) : song.lyrics?.trim() ? (
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
      {song?.youtube_video_id && (
        <WatchOnYouTube videoId={song.youtube_video_id} className="mt-6" />
      )}

      {song?.notes && (
        <section className="mt-8 rounded-2xl bg-stone-100 p-4 dark:bg-stone-900">
          <h2 className="mb-1 text-sm font-semibold text-stone-700 dark:text-stone-300">Notes</h2>
          <p className="whitespace-pre-line text-sm text-stone-600 dark:text-stone-400">
            {song.notes}
          </p>
        </section>
      )}

      {/* The song itself is not wanted here — a list holds ids — so the sheet
          opens on a song still loading, which is what lets Save be pressed the
          moment it is seen rather than only once the lyrics have landed. */}
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
            // The sheet keeps its mount across an open and a close, so a refusal
            // left on the mutation would be waiting inside it the next time it is
            // opened — an error reported against an attempt nobody has made yet.
            deleteSong.reset();
          }}
          title="Delete this song?"
          pending={deleteSong.isPending}
          // A refused delete is otherwise silent, and silence reads as nothing
          // having happened: the spinner stops, `onSuccess` never navigates, and
          // the sheet sits there with the same button on it. The one irreversible
          // action on the page is the last one that can afford to fail quietly.
          error={
            deleteSong.isError
              ? errorMessage(deleteSong.error, "This song could not be deleted.")
              : undefined
          }
          onConfirm={() => deleteSong.mutate(song.id, { onSuccess: () => navigate("/") })}
        >
          “{song.title}” will be removed for everyone, along with its place in any lists. This
          cannot be undone.
        </ConfirmSheet>
      )}
    </article>
  );
}

/**
 * A song's title, what it is called elsewhere, who made and performed it, its
 * genres, and the way into the rest of its recordings.
 *
 * Its own component because it is the half of the page that has to wait for the
 * song: the shell above renders in every state, and this is what a skeleton
 * stands in for until there is something to put here.
 *
 * That skeleton is shaped like this header, so the spacing below is load-bearing
 * twice over: a field added here, or an `mb-5`/`mt-3` changed, moves the lyrics
 * heading — a control — as the song arrives, unless the block beside the call
 * site moves with it. Nothing catches that, jsdom laying nothing out.
 */
function SongHeader({ song, onShowRecordings }: { song: Song; onShowRecordings: () => void }) {
  const creditsByRole = groupCredits(song.credits);

  // The performers come off the first recording, which the server has already
  // sorted to the front. The year — and the video, below the lyrics — comes off
  // the song's own copy of it, deliberately, and not as a fallback for a
  // recording that might be missing: those columns *are* the trigger's copy of
  // the same row this reads index 0 of, pinned against it by
  // TestFirstRecordingRuleHasOneAuthority. So there is one source here rather
  // than two hedged against each other, and it is the source SongCard's badge
  // reads, which is what makes the card and the page agree structurally instead
  // of by a `??` that can never fire.
  const performers = song.recordings[0]?.performers ?? [];
  const year = song.release_year;

  return (
    /* The song's own language, like the lyrics below — a Greek title is content
       too, and it is what a screen reader announces first. */
    <header className="mb-5" lang={song.language}>
      <h1 className="text-3xl font-bold leading-tight tracking-tight text-balance">{song.title}</h1>
      {song.alt_title && (
        <p className="mt-1 text-lg text-stone-500 dark:text-stone-400">{song.alt_title}</p>
      )}

      <dl className="mt-3 space-y-1 text-sm">
        {/* The performers lead, which is the order this block has always had —
            they were `artist` credits sorted to the front. Rendered only when
            there are any: most of the catalog's recordings carry a year and
            nobody's name, and a label above an empty value is the thing
            groupCredits filters out for the other rows. */}
        {performers.length > 0 && (
          <div className="flex gap-2">
            <dt className="shrink-0 text-stone-500 dark:text-stone-400">Performed by</dt>
            <dd className="font-medium">
              <PersonLinks people={performers} />
            </dd>
          </div>
        )}
        {creditsByRole.map(([role, names]) => (
          <div key={role} className="flex gap-2">
            <dt className="shrink-0 text-stone-500 dark:text-stone-400">
              {CREDIT_DISPLAY_LABELS[role]}
            </dt>
            <dd className="font-medium">
              <PersonLinks people={names} />
            </dd>
          </div>
        ))}
        {year && (
          <div className="flex gap-2">
            <dt className="text-stone-500 dark:text-stone-400">Year</dt>
            <dd className="font-medium">{year}</dd>
          </div>
        )}
      </dl>

      {/* Offered for a single recording too, not just for several: the sheet is
          the only place a recording's label and notes are shown, so at one
          recording there is still something behind this that the lines above do
          not say. */}
      {song.recordings.length > 0 && (
        <button
          type="button"
          onClick={onShowRecordings}
          className="mt-2 text-sm font-medium text-brand-600 hover:underline"
        >
          Show all {recordingCount(song.recordings.length)}
        </button>
      )}

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
