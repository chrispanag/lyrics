import { Loader2, X } from "lucide-react";

import { rowControlChrome } from "./buttonStyles";
import { cn } from "@/lib/cn";

/**
 * Takes one song out of the list being viewed.
 *
 * In its own module because both renderings of a list need it — the sortable
 * one an owner gets and the plain one that serves everyone else, a one-song
 * list, and the wait for the drag chunk — and the sortable list is loaded on
 * demand, so neither of them can own the button the other borrows.
 *
 * An X rather than a bin: the song stays in the catalog, and a column of red
 * bins reads as deleting it from there. Sized to match the drag handle it sits
 * opposite, so a row reads as one control on each side of the card.
 */
export function RemoveFromListButton({
  title,
  pending,
  onRemove,
}: {
  title: string;
  pending: boolean;
  onRemove: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onRemove}
      // A second tap while the first is in flight sends a DELETE for a song the
      // list no longer holds, which answers 404 and reports a failure for a
      // removal that worked.
      disabled={pending}
      aria-label={`Remove ${title} from this list`}
      className={cn(
        rowControlChrome,
        "hover:bg-red-50 hover:text-red-600 focus-visible:ring-red-500 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-red-950/50 dark:hover:text-red-400",
      )}
    >
      {pending ? (
        <Loader2 aria-hidden className="size-5 animate-spin" />
      ) : (
        <X aria-hidden className="size-5" />
      )}
    </button>
  );
}
