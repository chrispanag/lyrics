import { Youtube } from "lucide-react";

import { buttonClasses } from "@/components/buttonStyles";
import { watchUrl } from "@/lib/youtube";

/**
 * A link out to the video. Loads nothing from YouTube until pressed.
 *
 * Takes the id, never `youtube_url`: the importer stores URLs unvalidated, while
 * an id is always eleven safe characters, so the destination cannot be elsewhere.
 */
export function WatchOnYouTube({ videoId, className }: { videoId: string; className?: string }) {
  return (
    <a
      href={watchUrl(videoId)}
      target="_blank"
      // noreferrer: the new tab need not learn which song page sent it.
      rel="noopener noreferrer"
      className={buttonClasses("secondary", "sm", className)}
    >
      <Youtube aria-hidden className="size-4" />
      Watch on YouTube{" "}
      {/* A reader who cannot see the new tab appear needs telling. The space
          stays outside the span, since a name computation may trim it. */}
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}
