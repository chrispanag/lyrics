import { SixteenthNotes } from "lucide-react";

import { EmptyState } from "@/components/ui";

export { generateMetadata } from "./catalogPage";

/*
 * The reading pane when no song is open. While the column is too narrow for
 * both, it is hidden and the catalog is the whole page; once the column can
 * hold them, it sits to the right of the list.
 */
export default function ReadingPane() {
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
