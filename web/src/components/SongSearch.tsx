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
import { Link, useLocation } from "react-router-dom";

import { SearchField } from "./SearchField";
import { SearchHeader } from "./SearchHeader";
import { Snippet } from "./Snippet";
import { useSongs } from "@/api/hooks";
import { browseHref } from "@/lib/browse";
import { cn } from "@/lib/cn";
import { songByline } from "@/lib/credits";
import { songCount } from "@/lib/format";
import { songHref, songMatchesRef, songRefFromPath } from "@/lib/listContext";
import type { Song } from "@/lib/types";
import { useDebounced } from "@/lib/useDebounced";
import { useNavigate } from "@/lib/navigation";

/** How many songs the panel offers before deferring to the catalog. */
const PANEL_SIZE = 6;

/** The chrome of the panel's one-line answers, which differ only in what they say. */
const noteChrome = "px-4 py-3 text-sm";

/**
 * Search the catalog from a song, and step straight into what comes back.
 *
 * Focus never leaves the field: the highlight is `aria-activedescendant` and
 * rows are `tabIndex={-1}`, so `useArrowKeyPaging` (which stands down for a
 * focused field) can never page the list from under the panel. See "Frontend"
 * in CLAUDE.md.
 *
 * Closed by a `pointerdown` listener, never a full-screen transparent element.
 *
 * Renders its own header because its own state decides when that is pinned.
 */
export function SongSearch() {
  const navigate = useNavigate();
  const location = useLocation();
  const wrapper = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  const [draft, setDraft] = useState("");
  // Closed without emptying the box; any edit re-opens it.
  const [dismissed, setDismissed] = useState(false);
  // The highlighted row; -1 is the field itself.
  const [active, setActive] = useState(-1);
  // Also pins the header; see the `pinned` argument below.
  const [focused, setFocused] = useState(false);

  // Whatever was on screen is gone by the time the next page is. Keyed on the
  // history entry rather than on a click, because there are four ways out of the
  // panel — a press, Enter, a middle click, the catalog row — and one of them
  // would have been forgotten. Landing on a song with the box still full of the
  // search that found it is the failure this avoids. Reset while rendering, so
  // the next page is never drawn with the old search still in the box.
  const [searchedAt, setSearchedAt] = useState(location.key);
  if (searchedAt !== location.key) {
    setSearchedAt(location.key);
    setDraft("");
    setDismissed(false);
    setActive(-1);
  }

  const typed = draft.trim();
  const query = useDebounced(typed);
  const open = typed !== "" && !dismissed;

  const { data, isLoading, isError } = useSongs(
    { q: query, sort: "relevance", limit: PANEL_SIZE },
    // An absent `q` returns the whole catalog, not an empty result.
    open && query !== "",
  );

  const results = data?.data ?? [];
  const total = data?.meta.total ?? 0;
  // Undefined when the results changed under the highlight.
  const activeSong = active >= 0 ? results[active] : undefined;

  // Waits for the debounce as well as the request, or every first keystroke
  // would flash "nothing matched".
  const searching = query !== typed || isLoading;

  /** Closes the panel, leaving the text. The one path for every way of closing. */
  const dismiss = useCallback(() => {
    setDismissed(true);
    setActive(-1);
  }, []);

  /**
   * Where a result leads. Replaces rather than pushes for the song already open,
   * which would otherwise leave a duplicate history entry.
   *
   * "Already open" uses `songMatchesRef`, since the bar may hold the UUID form.
   * The address carries no list; see `SongOption`.
   */
  const here = songRefFromPath(location.pathname);
  const step = (song: Song) => ({
    href: songHref(song),
    replace: here !== null && songMatchesRef(song, here),
  });

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      // Browsers empty a `type="search"` field on Escape; the text must stay.
      // jsdom has no such default, so no spec can see this.
      event.preventDefault();
      dismiss();
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      // With an empty box the arrows stay the page's, to scroll the lyrics.
      if (typed === "") return;

      // Otherwise the caret jumps to the end of the text.
      event.preventDefault();
      // An arrow also reopens a dismissed panel.
      setDismissed(false);
      setActive((current) => {
        // A highlight past the current results counts as none.
        const from = current < results.length ? current : -1;
        return event.key === "ArrowDown"
          ? Math.min(from + 1, results.length - 1)
          : Math.max(from - 1, -1);
      });
      return;
    }

    if (event.key === "Enter") {
      // The highlighted row, else the first, else the catalog. Never a row
      // from a dismissed panel the reader cannot see.
      const song = open ? (activeSong ?? results[0]) : undefined;
      if (song) {
        const { href, replace } = step(song);
        navigate(href, { replace });
      } else if (typed !== "") {
        navigate(browseHref({ q: typed }));
      }
      return;
    }
  };

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

  // Keeps the highlighted row in view with a phone keyboard up. Optional call:
  // jsdom has no `scrollIntoView`.
  useEffect(() => {
    if (active < 0) return;
    document.getElementById(optionId(listboxId, active))?.scrollIntoView?.({ block: "nearest" });
  }, [active, listboxId]);

  /**
   * The open panel's content. `isError` first, or a failure reads as "nothing
   * matched"; rows before `searching`, so held results do not blink.
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
            className="max-h-[50dvh] overflow-y-auto overscroll-contain py-1"
          >
            {results.map((song, index) => {
              const { href, replace } = step(song);
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
    // Pinned while focused too: on iOS, focusing a field can scroll the page,
    // which would hide the header before the panel opens.
    <SearchHeader pinned={open || focused}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: tracks focus leaving its children; nothing here is pressed. */}
      <div
        ref={wrapper}
        className="relative"
        // Closes the panel when a reader Tabs away. Ignores a null
        // `relatedTarget` (window blur, or Safari not focusing a clicked link),
        // which would unmount the row before its click lands.
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
          // Unguarded: losing the caret to nowhere still counts.
          onBlur={() => setFocused(false)}
          role="combobox"
          aria-expanded={open}
          // Only while the listbox is actually rendered.
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
 * One song in the panel: a real link that cannot hold focus. Memoized like
 * `SongCard`, since every keystroke re-renders the panel.
 *
 * The address deliberately carries no `?list=`: a search result is not the next
 * song in the reader's list and may not be in it.
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
  /** Set for the song already open; see `step`. */
  replace: boolean;
  song: Song;
  active: boolean;
}) {
  const credits = songByline(song);

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
      {/* One line, without `whitespace-pre-line`, so a verse break stays a row. */}
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
 * The id of one row, for `aria-activedescendant`. By index, not song id, so it
 * names whatever row is on screen now.
 */
function optionId(base: string, index: number): string {
  return `${base}-option-${index}`;
}
