"use client";

import { Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { embedUrl, thumbnailUrl } from "@/lib/youtube";

/**
 * The video, played in place in the song's details column. Until pressed it is
 * the thumbnail, the only thing fetched from YouTube; the player, its scripts
 * and cookies come with the press and start at once. The caller keys it on the
 * song, so another song starts back at the thumbnail.
 *
 * Takes the id, never `youtube_url`, as `WatchOnYouTube` does.
 */
export function YouTubePlayer({ videoId, title }: { videoId: string; title: string }) {
  const [playing, setPlaying] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);

  // The button that had focus is gone; the player takes it, so a keyboard
  // reader lands on what they asked for rather than at the top of the page.
  useEffect(() => {
    if (playing) frame.current?.focus();
  }, [playing]);

  return (
    <div className="relative aspect-video overflow-hidden rounded-control bg-muted">
      {playing ? (
        <iframe
          ref={frame}
          src={embedUrl(videoId)}
          title={`${title} on YouTube`}
          allow="autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
          // YouTube refuses to play an embed that names no origin (error 153).
          // The deployed site is served `same-origin`, whatever `next.config.ts`
          // says, which sends YouTube nothing; the frame sets its own policy.
          referrerPolicy="strict-origin-when-cross-origin"
          className="absolute inset-0 size-full border-0 focus-visible:-outline-offset-4"
        />
      ) : (
        <button
          type="button"
          onClick={() => setPlaying(true)}
          // The ring drawn inside: the frame clips its corners, and the column
          // clips its sides.
          className="group absolute inset-0 flex items-center justify-center focus-visible:-outline-offset-4"
        >
          <img
            src={thumbnailUrl(videoId)}
            alt=""
            loading="lazy"
            decoding="async"
            className="absolute inset-0 size-full object-cover"
          />
          <span className="relative flex size-12 items-center justify-center rounded-full bg-accent text-fg-on-fill shadow-popover motion-safe:transition-transform group-hover:scale-110 group-hover:bg-accent-hover group-focus-visible:scale-110">
            <Play aria-hidden className="size-5 translate-x-px fill-current" />
          </span>
          <span className="sr-only">Play video</span>
        </button>
      )}
    </div>
  );
}
