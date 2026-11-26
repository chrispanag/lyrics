"use client";

import { Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/**
 * The video, played in place: the song's details column, where it can run
 * while the lyrics are read beside it.
 *
 * Until it is pressed this is YouTube's thumbnail and a play button, and the
 * thumbnail is the only thing fetched from YouTube, lazily. The player itself
 * (its scripts, its cookies) arrives with the press, from the no-cookie host,
 * and starts at once, since the press was the request to play. The caller keys
 * it on the song, so another song starts back at the thumbnail.
 *
 * Takes the id, never `youtube_url`: an id is always eleven safe characters,
 * so neither address can be steered elsewhere (see `WatchOnYouTube`).
 */
export function YouTubePlayer({ videoId, title }: { videoId: string; title: string }) {
  const [playing, setPlaying] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const id = encodeURIComponent(videoId);

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
          src={`https://www.youtube-nocookie.com/embed/${id}?autoplay=1`}
          title={`${title} on YouTube`}
          allow="autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
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
            src={`https://i.ytimg.com/vi/${id}/hqdefault.jpg`}
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
