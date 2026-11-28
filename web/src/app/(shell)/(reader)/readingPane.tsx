import { SixteenthNotes } from "lucide-react";

import { EmptyState } from "@/components/ui";
import { Wordmark } from "@/components/Wordmark";

/**
 * The reading pane when no song is open, beside the catalog or a list. While
 * the column is too narrow for both, it is hidden and the list is the whole
 * page; once the column can hold them, it sits to the right of the list.
 *
 * It carries the wordmark: at a desk the rail shows only the brand's mark, so
 * this is where a reader arriving at the catalog sees the site's name.
 * Decorative here, since the page's title already names the site.
 */
export function EmptyReadingPane() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-10">
      <div aria-hidden>
        <Wordmark size="lg" />
      </div>
      <EmptyState
        icon={<SixteenthNotes className="size-12" />}
        title="Select a song"
        description="Its lyrics will open here."
      />
    </div>
  );
}
