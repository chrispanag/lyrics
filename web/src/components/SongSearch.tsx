import {
  memo,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { SearchField } from "./SearchField";
import { SearchHeader } from "./SearchHeader";
import { Snippet } from "./Snippet";
import { useSongs } from "@/api/hooks";
import { browseHref } from "@/lib/browse";
import { cn } from "@/lib/cn";
import { creditLine } from "@/lib/credits";
import { songCount } from "@/lib/format";
import { songHref } from "@/lib/listContext";
import type { Song } from "@/lib/types";
import { useDebounced } from "@/lib/useDebounced";

/**
 * How many songs the panel offers before it defers to the catalog.
 *
 * Small on purpose: this is the way to a song whose name the reader already has
 * in mind, not a way to read results. Anything past six is what the catalog page
 * is for, and the row at the foot of the panel is the way there.
 */
const PANEL_SIZE = 6;

/** The chrome of the panel's one-line answers, which differ only in what they say. */
const noteChrome = "px-4 py-3 text-sm";

/**
 * Search the catalog from a song, and step straight into what comes back.
 *
 * The panel is the whole point of it. A box that only carried the query to the
 * catalog would be the Browse tab with extra steps — one press already reaches
 * that box — whereas this lands a reader on the next song in a single press,
 * which is what makes moving between two songs quick enough to do while reading.
 *
 * Focus never leaves the field. That is a keyboard convenience (the arrow keys
 * are in one place, and the highlight is `aria-activedescendant` rather than
 * something to Tab through) but it is also what keeps the panel out of the song
 * page's gestures: `useArrowKeyPaging` stands down for a focused field, so left
 * and right stay the caret's while the results are up, and the rows carry
 * `tabIndex={-1}` so focus cannot come to rest on one — a link holding focus is
 * exactly where an arrow key would page the list out from under the panel
 * instead. Nothing here has to ask `modalIsOpen()`, and nothing here stops an
 * event from propagating: there is no conflict left to resolve.
 *
 * Nothing is laid over the page either. The panel is closed by a press that
 * lands outside it, read from a listener rather than from a full-screen
 * transparent element — the shape of thing the song page deliberately has none
 * of; see `ListSongSwipe` for what invisible boxes cost here.
 *
 * The header comes with it rather than being wrapped around it by the page,
 * because the results hang off that box: what pins it is this component's own
 * state, read during the render that opens the panel. Handed up to a parent to be
 * handed back down, it arrived a render late and put the same boolean in two
 * places.
 */
export function SongSearch() {
  const navigate = useNavigate();
  const location = useLocation();
  const wrapper = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  const [draft, setDraft] = useState("");
  // Escape and a press outside close the panel without emptying the box, so the
  // text is still there to add a letter to. Any edit re-opens it.
  const [dismissed, setDismissed] = useState(false);
  // Which row the arrow keys have moved to; -1 is the field itself, which is
  // where every query starts.
  const [active, setActive] = useState(-1);
  // Whether the field has the caret, which is the other half of what pins the
  // header: see the `pinned` argument at the foot of this file.
  const [focused, setFocused] = useState(false);

  const typed = draft.trim();
  // Left to `useDebounced`'s own default, which is the beat every other search
  // box in the app waits: restated here it would be a fourth copy of one number,
  // with a comment claiming a parity that nothing checks.
  const query = useDebounced(typed);
  const open = typed !== "" && !dismissed;

  const { data, isLoading, isError } = useSongs(
    { q: query, sort: "relevance", limit: PANEL_SIZE },
    // An empty box must ask for nothing: `q` absent is not an empty result but
    // the entire catalog, so the panel would open on the newest songs and
    // present them as matches for whatever had just been deleted.
    open && query !== "",
  );

  const results = data?.data ?? [];
  const total = data?.meta.total ?? 0;
  // Out of range whenever the results have changed under the highlight, which is
  // why Enter falls back to the first row rather than clamping this.
  const activeSong = active >= 0 ? results[active] : undefined;

  // Results held from the previous query are shown while the next one is in
  // flight (`placeholderData`), so "nothing matched" must wait for the debounce
  // to catch up with the box as well as for the request — otherwise the first
  // keystroke of every search answers itself with a no.
  const searching = query !== typed || isLoading;

  /**
   * Closes the panel, leaving the text where it is.
   *
   * Held in a callback so the listener below can call it rather than repeat it:
   * written out twice, anything added to closing lands on one of Escape and a
   * press outside, and the two then leave the component in different states with
   * nothing to say so.
   */
  const dismiss = useCallback(() => {
    setDismissed(true);
    setActive(-1);
  }, []);

  /**
   * Where a result leads, and whether stepping there should push an entry.
   *
   * Pushing is right for every song but the one already open, which a reader can
   * perfectly well find by searching its own lyrics: a second entry for the same
   * address is a Back press that appears to do nothing, and inside a list it eats
   * one step of the trail. That is the failure the editor's own exit documents.
   *
   * The address carries no list, deliberately — see `SongOption`.
   */
  const step = (songId: string) => {
    const href = songHref(songId);
    return { href, replace: href === location.pathname };
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      // Claimed, because WebKit and Chromium empty a `type="search"` field on
      // Escape and that is the one thing this must not do: the text is what the
      // reader came back to add a letter to, and losing it leaves the reopen
      // gesture below with nothing to reopen. jsdom implements no such default,
      // so the spec beside this cannot see it — verified in Chrome by hand.
      event.preventDefault();
      dismiss();
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      // An empty box has no panel and nothing to move within, so the arrows stay
      // the page's — they scroll the lyrics. Claiming a key and then doing
      // nothing with it is how a page stops scrolling for no visible reason;
      // `useArrowKeyPaging` claims its own only once it acts, for the same reason.
      if (typed === "") return;

      // An arrow in a field moves the caret to the end of the text by default,
      // so without this the box would jump about as the reader stepped down.
      event.preventDefault();
      // An arrow is also the way back to a panel that was dismissed with the
      // text still in the box.
      setDismissed(false);
      setActive((current) => {
        // A highlight the results no longer have is no highlight, which is the
        // same reading `activeSong` takes of it. Carried forward instead, the
        // arrow after a query that returned fewer rows steps from a row nobody
        // can see and skips the first.
        const from = current < results.length ? current : -1;
        return event.key === "ArrowDown"
          ? Math.min(from + 1, results.length - 1)
          : Math.max(from - 1, -1);
      });
      return;
    }

    if (event.key === "Enter") {
      // Never a dead Enter. The highlighted row, or the first one if the reader
      // typed and pressed straight through, or — with nothing to jump to yet —
      // the catalog, which is also where a query with no matches at all is worth
      // taking: it has the filters and the spelling advice this panel does not.
      //
      // Only ever a row that is on screen. With the panel dismissed the rows are
      // still in hand, and jumping to one of them then would open a song the
      // reader cannot see from a panel they closed.
      const song = open ? activeSong ?? results[0] : undefined;
      if (song) {
        const { href, replace } = step(song.id);
        navigate(href, { replace });
      } else if (typed !== "") {
        navigate(browseHref({ q: typed }));
      }
      return;
    }
  };

  // Whatever was on screen is gone by the time the next page is. Keyed on the
  // history entry rather than on a click, because there are four ways out of the
  // panel — a press, Enter, a middle click, the catalog row — and one of them
  // would have been forgotten. Landing on a song with the box still full of the
  // search that found it is the failure this avoids.
  useEffect(() => {
    setDraft("");
    setDismissed(false);
    setActive(-1);
  }, [location.key]);

  useEffect(() => {
    if (!open) return;

    // `pointerdown` rather than `click`, so the panel is out of the way before
    // the press it was covering is delivered.
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && wrapper.current?.contains(event.target)) return;
      dismiss();
    };

    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [dismiss, open]);

  // Six rows are taller than the panel gets on a phone with the keyboard up, so
  // the highlight has to be able to bring its own row into view. Called
  // optionally: jsdom has no layout and so no `scrollIntoView`, and this is a
  // convenience rather than something a spec should be made to stub.
  useEffect(() => {
    if (active < 0) return;
    document.getElementById(optionId(listboxId, active))?.scrollIntoView?.({ block: "nearest" });
  }, [active, listboxId]);

  /**
   * What the open panel has to say, in the order the branches have to be read.
   *
   * `isError` first, which is the rule both admin screens were written without:
   * a failed request has no rows either, so "nothing matched" stands in for a
   * fault and sends the reader off to check their spelling. Rows next, ahead of
   * `searching`, so the results held over from the previous query stay on screen
   * while the next one is in flight rather than blinking through "Searching…" on
   * every keystroke.
   */
  const panelBody = (): ReactNode => {
    if (isError) {
      return (
        <p className={cn(noteChrome, "text-red-700 dark:text-red-300")}>
          Search is unavailable right now.
        </p>
      );
    }

    if (results.length > 0) {
      return (
        <>
          <div
            id={listboxId}
            role="listbox"
            aria-label="Song search results"
            className="max-h-[50vh] overflow-y-auto overscroll-contain py-1"
          >
            {results.map((song, index) => {
              const { href, replace } = step(song.id);
              return (
                <SongOption
                  key={song.id}
                  id={optionId(listboxId, index)}
                  href={href}
                  replace={replace}
                  song={song}
                  active={index === active}
                />
              );
            })}
          </div>

          {total > results.length && (
            <Link
              to={browseHref({ q: query })}
              className="block border-t border-stone-200 px-4 py-3 text-sm font-medium text-brand-600 hover:bg-stone-50 dark:border-stone-700 dark:text-brand-400 dark:hover:bg-stone-800"
            >
              See all {songCount(total)}
            </Link>
          )}
        </>
      );
    }

    return (
      <p role="status" className={cn(noteChrome, "text-stone-500 dark:text-stone-400")}>
        {searching ? "Searching…" : `No songs matched “${query}”.`}
      </p>
    );
  };

  return (
    // The header is the catalog's, column and all, because the field has to keep
    // its place across a navigation — tapping a song otherwise moves the box out
    // from under the finger that tapped it. With no filter button to sit beside,
    // the field takes that width too; see `SearchHeader`.
    //
    // Pinned while the panel is up, since the results hang off that box — and
    // while the field merely has the caret, which is the case a panel cannot
    // cover: on iOS, focusing a field can scroll the document by itself, and
    // that is read as scrolling down to the lyrics. Nothing is open yet at that
    // moment, so a header pinned on `open` alone slides away with the caret in
    // it and snaps back on the first keystroke.
    <SearchHeader pinned={open || focused}>
      <div
        ref={wrapper}
        className="relative"
        // Focus leaving for somewhere else closes the panel, which a press
        // outside cannot do for a reader who Tabs away: the rows are not tab
        // stops, so focus jumps clear of the panel and would leave it standing
        // over the lyrics with no press to shut it. Only when focus actually
        // landed somewhere — a null `relatedTarget` is the window going away,
        // or Safari declining to focus a link it was clicked on, and
        // dismissing then would unmount the row before its click reached it.
        onBlur={(event) => {
          const next = event.relatedTarget;
          if (!(next instanceof Node)) return;
          if (wrapper.current?.contains(next)) return;
          dismiss();
        }}
      >
        <SearchField
          value={draft}
          onChange={(next) => {
            setDraft(next);
            setDismissed(false);
            setActive(-1);
          }}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          // Unguarded, unlike the wrapper's: what this tracks is the caret, so
          // losing it to nowhere at all — a press on the lyrics — has to count.
          onBlur={() => setFocused(false)}
          role="combobox"
          aria-expanded={open}
          // Only while the listbox is really rendered, which the panel's
          // "Searching…" and "nothing matched" answers are not: an id that
          // resolves to nothing promises a screen reader a list that is not
          // there.
          aria-controls={results.length > 0 ? listboxId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={activeSong ? optionId(listboxId, active) : undefined}
        />

        {open && (
          <div
            className={cn(
              "absolute inset-x-0 top-full z-10 mt-2 overflow-hidden rounded-2xl border shadow-xl",
              "border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-900",
            )}
          >
            {panelBody()}
          </div>
        )}
      </div>
    </SearchHeader>
  );
}

/**
 * One song in the panel.
 *
 * A real link, so a middle click opens it in a tab like every other way into a
 * song here — but one that cannot hold focus, which is what keeps the field's
 * arrow keys the only arrow keys in play while the panel is up.
 *
 * Memoized for the reason `SongCard` records: the box holds its text in state,
 * so every keystroke re-renders the panel, and without this each row re-runs
 * `creditLine` (copy, sort, Set) and the snippet's own scan for a song that has
 * not changed. Songs come from the query cache, so their identity is stable.
 *
 * The address carries no list. A song reached from a search has left whatever
 * list the reader was in — it may well not be in it — so pretending otherwise
 * would put a list bar on a song that is not in the list, with steps to songs
 * either side of a position it does not hold. `?list=` survives a step through
 * the list and the browser's Back; it does not survive a search, deliberately.
 */
const SongOption = memo(function SongOption({
  id,
  href,
  replace,
  song,
  active,
}: {
  id: string;
  href: string;
  /** Set for the song already open; see `step` for why that one is not pushed. */
  replace: boolean;
  song: Song;
  active: boolean;
}) {
  const credits = creditLine(song.credits);

  return (
    <Link
      id={id}
      role="option"
      aria-selected={active}
      tabIndex={-1}
      to={href}
      replace={replace}
      className={cn(
        "block px-4 py-2.5 transition-colors hover:bg-stone-100 dark:hover:bg-stone-800",
        active && "bg-stone-100 dark:bg-stone-800",
      )}
    >
      <span className="block truncate font-medium">{song.title}</span>
      {credits && (
        <span className="block truncate text-xs text-stone-500 dark:text-stone-400">{credits}</span>
      )}
      {/* The line the match was found on, which for a catalog searched by lyrics
          is the row's whole reason: two songs by the same writer are told apart
          by the words the reader remembered, not by the credits. Clamped to one
          line and without `whitespace-pre-line`, so a snippet spanning a verse
          break stays a row rather than becoming a paragraph. */}
      {song.snippet && (
        <Snippet
          text={song.snippet}
          className="mt-0.5 line-clamp-1 text-xs text-stone-500 dark:text-stone-400"
        />
      )}
    </Link>
  );
});

/**
 * The id of one row, which is how the field names the highlighted one.
 *
 * By index rather than by song id, because `aria-activedescendant` has to name
 * an element that is on screen: an id built from the song would keep resolving
 * after the results underneath it changed.
 */
function optionId(base: string, index: number): string {
  return `${base}-option-${index}`;
}
