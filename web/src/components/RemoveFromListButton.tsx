import { LoaderCircle, X } from "lucide-react";

import { rowControlChrome } from "./buttonStyles";
import { cn } from "@/lib/cn";

/**
 * Takes one song out of the list being viewed.
 *
 * An X rather than a bin: the song stays in the catalog.
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
      // A second DELETE would 404 and report a removal that worked as failed.
      disabled={pending}
      aria-label={`Remove ${title} from this list`}
      className={cn(
        rowControlChrome,
        "hover:bg-danger-subtle hover:text-fg-danger focus-visible:ring-danger disabled:cursor-not-allowed disabled:opacity-50",
      )}
    >
      {pending ? (
        <LoaderCircle aria-hidden className="size-5 animate-spin" />
      ) : (
        <X aria-hidden className="size-5" />
      )}
    </button>
  );
}
