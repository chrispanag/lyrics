import { SixteenthNotes } from "lucide-react";

import { EmptyState } from "@/components/ui";

/**
 * The reading pane when no song is open, beside the catalog or a list. While
 * the column is too narrow for both, it is hidden and the list is the whole
 * page; once the column can hold them, it sits to the right of the list.
 */
export function EmptyReadingPane() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <EmptyState
        icon={<SixteenthNotes className="size-12" />}
        title="Select a song"
        description="Its lyrics will open here."
      />
    </div>
  );
}
