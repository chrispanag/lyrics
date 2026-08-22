import { Youtube } from "lucide-react";

import { buttonClasses } from "@/components/buttonStyles";

/**
 * A link out to the video, standing where a click-to-load player facade used to.
 * Not an embed: the facade already deferred the player to a press. What it did
 * cost was a thumbnail fetched from `i.ytimg.com` on every song page, which is
 * what a link costs nothing of.
 *
 * Takes the video id rather than a URL, and builds the link itself. Two reasons,
 * and the first is not stylistic: `songs.youtube_url` is not always a link this
 * app validated. The API canonicalizes it, but the catalog importer stores
 * whatever the old database held and sets the id only when it parses — so a URL
 * rendered straight into an href is stored text, under a label promising
 * YouTube. An id is eleven characters of `[A-Za-z0-9_-]` or it is not stored at
 * all, so the destination cannot be anywhere else. The second reason is that
 * the canonical shape is then written in one place per stack rather than two.
 */
export function WatchOnYouTube({ videoId, className }: { videoId: string; className?: string }) {
  return (
    <a
      href={`https://www.youtube.com/watch?v=${videoId}`}
      target="_blank"
      // noreferrer alongside noopener: the tab this opens has no business
      // learning which song page sent it.
      rel="noopener noreferrer"
      className={buttonClasses("secondary", "sm", className)}
    >
      <Youtube aria-hidden className="size-4" />
      Watch on YouTube
    </a>
  );
}
