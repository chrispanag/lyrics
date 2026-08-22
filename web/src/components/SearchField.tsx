import type { InputHTMLAttributes } from "react";
import { Search, X } from "lucide-react";

import { fieldChrome } from "@/components/fieldStyles";
import { cn } from "@/lib/cn";

/**
 * The catalog's search box: the field, the icon inside it, and the way to empty
 * it.
 *
 * Two headers carry this — the catalog's own and the one above a song — and
 * every detail of it is a detail that only shows on a phone: the icon sits
 * inside the field rather than beside it so the box keeps the full width, the
 * clear button is a 44px target rather than a 14px glyph, and the text is
 * `text-base`, because iOS Safari zooms the whole page when a field with smaller
 * text takes focus. Restated at the second call site, that last one is invisible
 * until someone reads the page on a phone.
 *
 * It shares `fieldChrome` with the form primitives but not their layout: this
 * box is taller and rounder than an `<Input>`, and `cn` is a plain join, so
 * passing h-12/rounded-2xl through one would leave both values in the class list
 * with CSS source order picking the winner.
 *
 * `className` lands on the wrapper rather than the field, because the wrapper is
 * what a caller places — `flex-1` in a row of controls. Everything else an input
 * can be handed comes through `...rest`, which is what lets the song page's box
 * be a combobox — its role, the aria that goes with it, and its own key handling
 * — without this file knowing that a results panel exists. The label and
 * placeholder are written below rather than defaulted in the signature, since
 * `...rest` comes after them: neither caller overrides one today, and one that
 * needs to still can.
 */
const fieldClasses = cn(
  fieldChrome,
  // search-own-clear drops the cross the browser draws inside a search field,
  // which lands on top of the one below; see the rule in styles/index.css for
  // why that is switched off by class here rather than for every search field in
  // the app.
  "search-own-clear h-12 w-full rounded-2xl pl-10 pr-10 text-base",
);

export function SearchField({
  value,
  onChange,
  className,
  ...rest
}: {
  value: string;
  /** The text, not the event: both call sites hold it as plain state. */
  onChange: (value: string) => void;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type">) {
  return (
    <div className={cn("relative", className)}>
      <Search
        aria-hidden
        className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-stone-400"
      />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Search lyrics, titles, artists…"
        aria-label="Search songs"
        className={fieldClasses}
        {...rest}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-2 text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800"
        >
          <X aria-hidden className="size-4" />
        </button>
      )}
    </div>
  );
}
