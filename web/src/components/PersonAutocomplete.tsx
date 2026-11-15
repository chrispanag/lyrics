import { useEffect, useId, useRef, useState } from "react";

import { usePeople } from "@/api/hooks";
import { Input } from "@/components/ui";
import { useDebounced } from "@/lib/useDebounced";
import { cn } from "@/lib/cn";
import { songCount } from "@/lib/format";

export interface PersonSelection {
  personId?: string;
  name: string;
}

/**
 * A name field that suggests existing people and accepts new ones.
 *
 * Selecting a suggestion sends `person_id`, while free text sends `name` and
 * lets the server upsert. That matters for catalog integrity: the server
 * matches on a normalized name, so "Μάνος Χατζιδάκις" typed on two different
 * songs converges on one record rather than splitting his catalog in two.
 */
export function PersonAutocomplete({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: PersonSelection;
  onChange: (selection: PersonSelection) => void;
  placeholder?: string;
  /**
   * The field's accessible name. Required: it sits in rows with no visible
   * label, and a placeholder is only a fallback name — the same "Name" on
   * every row, telling one row from the next not at all.
   */
  label: string;
}) {
  const inputId = useId();
  const listId = `${inputId}-suggestions`;

  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const blurTimer = useRef<number | undefined>(undefined);

  const query = useDebounced(value.name, 200);
  // Keeps the previous suggestions up while the next request is in flight, so
  // the listbox does not remount on every debounce pause.
  const { data } = usePeople(query, {
    enabled: open && query.trim().length > 0,
    placeholderData: (previous) => previous,
  });
  // Placeholder data outlives the enabled flag, so the emptied input has to be
  // gated here too or clearing the field would leave stale names showing.
  const suggestions = query.trim() ? (data?.data ?? []) : [];
  const listShown = open && suggestions.length > 0;
  // Undefined when nothing is highlighted, or the suggestions shrank under it.
  const activePerson = listShown && highlighted >= 0 ? suggestions[highlighted] : undefined;
  // Focus never leaves the field, so the highlight reaches assistive tech only
  // through `aria-activedescendant` — the same shape as `SongSearch`.
  const activeId = activePerson ? optionId(listId, highlighted) : undefined;

  // Keeps the highlighted row in view: focus stays in the field, so the list
  // never scrolls itself, and it shows about six names. As in SongSearch;
  // optional call, since jsdom has no `scrollIntoView`.
  useEffect(() => {
    if (highlighted < 0) return;
    document.getElementById(optionId(listId, highlighted))?.scrollIntoView?.({ block: "nearest" });
  }, [highlighted, listId]);

  // Every way of closing clears the highlight too. Left behind, it outlives the
  // list: reopening announces a person nobody chose, and Enter picks them.
  const close = () => {
    setOpen(false);
    setHighlighted(-1);
  };

  const select = (person: { id: string; name: string }) => {
    onChange({ personId: person.id, name: person.name });
    close();
  };

  return (
    <div className="relative">
      <Input
        id={inputId}
        aria-label={label}
        role="combobox"
        aria-expanded={listShown}
        // Only while the listbox is rendered: an id naming nothing is a
        // dangling reference.
        aria-controls={listShown ? listId : undefined}
        aria-activedescendant={activeId}
        aria-autocomplete="list"
        autoComplete="off"
        placeholder={placeholder}
        value={value.name}
        onChange={(event) => {
          // Typing after picking someone invalidates that choice — the text no
          // longer refers to the selected person.
          onChange({ name: event.target.value });
          setOpen(true);
          setHighlighted(-1);
        }}
        onFocus={() => {
          // A close a recent blur scheduled would shut the list just reopened.
          clearTimeout(blurTimer.current);
          setOpen(true);
        }}
        // A click on a suggestion fires blur first, so closing is deferred
        // long enough for the click to land.
        onBlur={() => {
          blurTimer.current = window.setTimeout(close, 150);
        }}
        onKeyDown={(event) => {
          // Before the bail-out below: this field sits inside the song form, and
          // an Enter let through would submit the whole editor.
          if (event.key === "Enter") {
            event.preventDefault();
            if (activePerson) select(activePerson);
            else close();
            return;
          }

          if (!open || suggestions.length === 0) return;

          if (event.key === "ArrowDown") {
            event.preventDefault();
            setHighlighted((index) => (index + 1) % suggestions.length);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setHighlighted((index) => (index - 1 + suggestions.length) % suggestions.length);
          } else if (event.key === "Escape") {
            close();
          }
        }}
      />

      {listShown && (
        <ul
          id={listId}
          // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: the ARIA combobox pattern's listbox.
          role="listbox"
          className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-line-strong bg-surface py-1 shadow-lg"
        >
          {suggestions.map((person, index) => (
            // `presentation`, or the listbox owns list items rather than options.
            <li key={person.id} role="presentation">
              <button
                id={optionId(listId, index)}
                type="button"
                role="option"
                // Out of the tab order: a row reached by Tab takes focus from
                // the field, whose blur then unmounts the row under it, and the
                // row answers only to a mouse.
                tabIndex={-1}
                aria-selected={index === highlighted}
                onMouseDown={() => {
                  // mousedown beats the input's blur, so the deferred close
                  // never gets a chance to swallow this.
                  clearTimeout(blurTimer.current);
                  select(person);
                }}
                className={cn(
                  "flex w-full items-center justify-between px-3 py-2 text-left text-sm",
                  index === highlighted ? "bg-accent-subtle" : "hover:bg-subtle",
                )}
              >
                <span className="truncate">{person.name}</span>
                {person.song_count !== undefined && person.song_count > 0 && (
                  // fg-tertiary, not fg-subtle: on the highlighted row's fill the
                  // quieter token is under 4.5:1. Drawn as a bare number, spoken
                  // as "12 songs".
                  <span className="ml-2 shrink-0 text-xs text-fg-tertiary">
                    <span aria-hidden>{person.song_count}</span>
                    <span className="sr-only">{songCount(person.song_count)}</span>
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The id of one suggestion, for `aria-activedescendant`. */
function optionId(base: string, index: number): string {
  return `${base}-option-${index}`;
}
