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
import { Link, useNavigationKey, usePathname, useRouter } from "@/lib/navigation";

/** How many songs the panel offers before deferring to the catalog. */
const PANEL_SIZE = 6;

/** The chrome of the panel's one-line answers, which differ only in what they say. */
const noteChrome = "px-4 py-3 text-sm";

/** Search the catalog from a song, in the header above it. */
export function SongSearch() {
  return <SongSearchBox />;
}

/**
 * Search the catalog, and step straight into what comes back: the field and
 * its results. Above a song (`panel`) the box sits in its own search header,
 * which the box's state pins, and the results drop down over the page; in the
 * phone's search sheet (`sheet`) they sit under the field and fill the sheet,
 * which is the whole screen and has nothing to dismiss them for.
 *
 * Focus never leaves the field: the highlight is `aria-activedescendant` and
 * rows are `tabIndex={-1}`, so `useArrowKeyPaging` (which stands down for a
 * focused field) can never page the list from under the panel. See "Frontend"
 * in CLAUDE.md.
 *
 * The panel is closed by a `pointerdown` listener, never a full-screen
 * transparent element.
 *
 * `onEscape` takes Escape from the field, which otherwise only closes the
 * panel.
 */
export function SongSearchBox({
  variant = "panel",
  onEscape,
  autoFocus,
}: {
  variant?: "panel" | "sheet";
  onEscape?: () => void;
  autoFocus?: boolean;
}) {
  const inSheet = variant === "sheet";
  const router = useRouter();
  const pathname = usePathname();
  const navigationKey = useNavigationKey();
  const wrapper = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  const [draft, setDraft] = useState("");
  // Closed without emptying the box; any edit re-opens it.
  const [dismissed, setDismissed] = useState(false);
  // The highlighted row; -1 is the field itself.
  const [active, setActive] = useState(-1);
  // Also pins the header; see the end.
  const [focused, setFocused] = useState(false);

  // Whatever was on screen is gone by the time the next page is. Keyed on the
  // navigation (`useNavigationKey`, which also changes for the song already
  // open) rather than on a click, because there are four ways out of the
  // panel — a press, Enter, a middle click, the catalog row — and one of them
  // would have been forgotten. Landing on a song with the box still full of the
  // search that found it is the failure this avoids. Reset while rendering, so
  // the next page is never drawn with the old search still in the box.
  const [searchedAt, setSearchedAt] = useState(navigationKey);
  if (searchedAt !== navigationKey) {
    setSearchedAt(navigationKey);
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
  // Whether the panel holds the listbox rather than a note: the one decision
  // `panelBody` and the combobox's ARIA state both read, so they cannot drift.
  // Never on a failure, or a failed refetch would read as "nothing matched".
  const listShown = open && !isError && results.length > 0;

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
  const here = songRefFromPath(pathname);
  const step = (song: Song) => ({
    href: songHref(song),
    replace: here !== null && songMatchesRef(song, here),
  });

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      // Browsers empty a `type="search"` field on Escape; the text must stay.
      // jsdom has no such default, so no spec can see this.
      event.preventDefault();
      if (onEscape) onEscape();
      else dismiss();
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
      // the reader cannot see: a dismissed panel, or one saying search failed
      // over rows a failed refetch left held.
      const song = listShown ? (activeSong ?? results[0]) : undefined;
      if (song) {
        const { href, replace } = step(song);
        if (replace) router.replace(href);
        else router.push(href);
      } else if (typed !== "") {
        router.push(browseHref({ q: typed }));
      }
      return;
    }
  };

  useEffect(() => {
    // The sheet is all search: a press anywhere in it is not a press away.
    if (!open || inSheet) return;

    // `pointerdown` rather than `click`, so the panel is out of the way before
    // the press it was covering is delivered.
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && wrapper.current?.contains(event.target)) return;
      dismiss();
    };

    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [dismiss, inSheet, open]);

  // Keeps the highlighted row in view with a phone keyboard up. Optional call:
  // jsdom has no `scrollIntoView`.
  useEffect(() => {
    if (active < 0) return;
    document.getElementById(optionId(listboxId, active))?.scrollIntoView?.({ block: "nearest" });
  }, [active, listboxId]);

  /**
   * The open panel's content. Rows before `searching`, so held results do not
   * blink.
   */
  const panelBody = (): ReactNode => {
    if (listShown) {
      return (
        <>
          <div
            id={listboxId}
            role="listbox"
            aria-label="Song search results"
            // In the sheet, the sheet's body is what scrolls.
            className={cn("py-1", !inSheet && "max-h-[50dvh] overflow-y-auto overscroll-contain")}
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
              href={browseHref({ q: query })}
              className="block border-t border-line px-4 py-3 text-sm font-medium text-fg-accent hover:bg-subtle"
            >
              See all {songCount(total)}
            </Link>
          )}
        </>
      );
    }

    if (isError) {
      return <p className={cn(noteChrome, "text-fg-danger")}>Search is unavailable right now.</p>;
    }

    return (
      <p role="status" className={cn(noteChrome, "text-fg-muted")}>
        {searching ? "Searching…" : `No songs matched “${query}”.`}
      </p>
    );
  };

  const box = (
    // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/noNoninteractiveElementInteractions: tracks focus leaving its children; nothing here is pressed.
    <div
      ref={wrapper}
      className="relative"
      // Closes the panel when a reader Tabs away. Ignores a null
      // `relatedTarget` (window blur, or Safari not focusing a clicked link),
      // which would unmount the row before its click lands. Not in the sheet,
      // where the only other control is Close.
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (inSheet || !(next instanceof Node)) return;
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
        // The sheet's: a reader opens it to type. It mounts once the dialog
        // is open (`Sheet`), so this lands inside it.
        autoFocus={autoFocus}
        role="combobox"
        // Both only while the listbox is rendered: the "nothing matched" and
        // "unavailable" notes are status messages, not the combobox's popup,
        // and expanded with nothing to control is announced as a popup that
        // is not there.
        aria-expanded={listShown}
        aria-controls={listShown ? listboxId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={listShown && activeSong ? optionId(listboxId, active) : undefined}
      />

      {open && (
        <div
          className={cn(
            "overflow-hidden rounded-card border border-line-strong bg-surface",
            inSheet ? "mt-3" : "absolute inset-x-0 top-full z-dropdown mt-2 shadow-popover",
          )}
        >
          {panelBody()}
        </div>
      )}
    </div>
  );

  if (inSheet) return box;
  // Held on screen while the results are up, and while the field is focused
  // too: on iOS, focusing a field can scroll the page, which would hide the
  // header before the panel opens.
  return <SearchHeader pinned={open || focused}>{box}</SearchHeader>;
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
      href={href}
      replace={replace}
      className={cn("block px-4 py-2.5 transition-colors hover:bg-subtle", active && "bg-subtle")}
    >
      <span className="block truncate font-medium">{song.title}</span>
      {/* fg-tertiary rather than fg-muted for the secondary lines: on the
          highlighted row's fill, fg-muted is under 4.5:1. */}
      {credits && <span className="block truncate text-xs text-fg-tertiary">{credits}</span>}
      {/* One line, without `whitespace-pre-line`, so a verse break stays a row. */}
      {song.snippet && (
        <Snippet text={song.snippet} className="mt-0.5 line-clamp-1 text-xs text-fg-tertiary" />
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
