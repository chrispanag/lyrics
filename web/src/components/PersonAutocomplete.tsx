import { useId, useRef, useState } from "react";

import { usePeople } from "@/api/hooks";
import { Input } from "@/components/ui";
import { useDebounced } from "@/lib/useDebounced";
import { cn } from "@/lib/cn";

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
  id,
}: {
  value: PersonSelection;
  onChange: (selection: PersonSelection) => void;
  placeholder?: string;
  id?: string;
}) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const listId = `${inputId}-suggestions`;

  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const blurTimer = useRef<number | undefined>(undefined);

  const query = useDebounced(value.name, 200);
  // Keeping the previous page of suggestions on screen while the next request
  // is in flight is what stops the listbox unmounting and remounting once per
  // debounce pause — the same treatment useSongs and useUsers already get.
  const { data } = usePeople(query, {
    enabled: open && query.trim().length > 0,
    placeholderData: (previous) => previous,
  });
  // Placeholder data outlives the enabled flag, so the emptied input has to be
  // gated here too or clearing the field would leave stale names showing.
  const suggestions = query.trim() ? (data?.data ?? []) : [];

  const select = (person: { id: string; name: string }) => {
    onChange({ personId: person.id, name: person.name });
    setOpen(false);
    setHighlighted(-1);
  };

  return (
    <div className="relative">
      <Input
        id={inputId}
        role="combobox"
        aria-expanded={open && suggestions.length > 0}
        aria-controls={listId}
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
        onFocus={() => setOpen(true)}
        // A click on a suggestion fires blur first, so closing is deferred
        // long enough for the click to land.
        onBlur={() => {
          blurTimer.current = window.setTimeout(() => setOpen(false), 150);
        }}
        onKeyDown={(event) => {
          // Enter is handled before the "nothing to pick" bail-out. This field
          // sits inside the song form, so letting Enter through submitted the
          // whole editor — which is never what someone typing a credit name
          // means, and it happened on every keystroke path because `highlighted`
          // resets to -1 as soon as the text changes.
          if (event.key === "Enter") {
            event.preventDefault();
            const person = open && highlighted >= 0 ? suggestions[highlighted] : undefined;
            if (person) select(person);
            else setOpen(false);
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
            setOpen(false);
          }
        }}
      />

      {open && suggestions.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-stone-200 bg-white py-1 shadow-lg dark:border-stone-700 dark:bg-stone-900"
        >
          {suggestions.map((person, index) => (
            <li key={person.id}>
              <button
                type="button"
                role="option"
                aria-selected={index === highlighted}
                onMouseDown={() => {
                  // mousedown beats the input's blur, so the deferred close
                  // never gets a chance to swallow this.
                  clearTimeout(blurTimer.current);
                  select(person);
                }}
                className={cn(
                  "flex w-full items-center justify-between px-3 py-2 text-left text-sm",
                  index === highlighted
                    ? "bg-brand-50 dark:bg-stone-800"
                    : "hover:bg-stone-100 dark:hover:bg-stone-800",
                )}
              >
                <span className="truncate">{person.name}</span>
                {person.song_count !== undefined && person.song_count > 0 && (
                  <span className="ml-2 shrink-0 text-xs text-stone-400">
                    {person.song_count}
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
