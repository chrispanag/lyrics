import { Youtube } from "lucide-react";

import { buttonClasses } from "@/components/buttonStyles";

/**
 * A link out to the video, standing where an embedded player used to.
 *
 * Shared by the song page and the editor so the two cannot drift, and so the
 * editor keeps confirming that a pasted link was recognized — that was the only
 * job the preview thumbnail still did once the player itself was dropped.
 */
export function WatchOnYouTube({ href, className }: { href: string; className?: string }) {
  return (
    <a
      href={href}
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
