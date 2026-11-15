import type { InputHTMLAttributes } from "react";
import { Search, X } from "lucide-react";

import { fieldChrome } from "@/components/fieldStyles";
import { cn } from "@/lib/cn";

/**
 * The catalog's search box: the field, the icon inside it, and the way to empty
 * it.
 *
 * `text-base` is required: iOS Safari zooms the page when a field with smaller
 * text takes focus. The clear button is a 44px target.
 *
 * Not built on `<Input>`: its height and radius differ, and `cn` cannot override.
 *
 * `className` goes on the wrapper; left to `...rest` it would replace
 * `fieldClasses` on the input. `...rest` comes after the label and placeholder,
 * so callers can override them.
 */
const fieldClasses = cn(
  fieldChrome,
  // Drops the browser's own clear cross; see styles/index.css.
  "search-own-clear h-12 w-full rounded-2xl pl-10 pr-10 text-base",
);

export function SearchField({
  value,
  onChange,
  className,
  ...rest
}: {
  value: string;
  /** The text, not the event. */
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
