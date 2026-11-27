"use client";

import { useEffect, useRef } from "react";

import { embedUrl } from "@/lib/youtube";

/**
 * The video, played in place on the song's page. Mounted only by a press (the
 * page's Watch button), so nothing comes from YouTube until the reader asks:
 * the player, its scripts and cookies arrive with it and start at once. The
 * caller keys it on the song, so another song never inherits a playing frame.
 *
 * Takes the id, never `youtube_url`, as `WatchOnYouTube` does.
 */
export function YouTubePlayer({ videoId, title }: { videoId: string; title: string }) {
  const frame = useRef<HTMLIFrameElement>(null);

  // The player takes focus from the button that opened it, so a keyboard
  // reader lands on what they asked for.
  useEffect(() => {
    frame.current?.focus();
  }, []);

  return (
    <div className="relative aspect-video overflow-hidden rounded-control bg-muted">
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
        // The ring drawn inside: the frame clips its corners.
        className="absolute inset-0 size-full border-0 focus-visible:-outline-offset-4"
      />
    </div>
  );
}
