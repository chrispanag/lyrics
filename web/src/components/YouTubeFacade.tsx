import { useState } from "react";
import { Play } from "lucide-react";

/**
 * A click-to-load YouTube player.
 *
 * The real iframe pulls roughly a megabyte of scripts and sets cookies before
 * anyone presses play, which is the single heaviest thing on a song page. This
 * shows the thumbnail instead and only mounts the player on demand, so the
 * page stays fast for the majority of visits that never watch the video.
 */
export function YouTubeFacade({ videoId, title }: { videoId: string; title: string }) {
  const [playing, setPlaying] = useState(false);

  if (playing) {
    return (
      <div className="aspect-video overflow-hidden rounded-2xl bg-black">
        <iframe
          // nocookie avoids setting tracking cookies until playback starts.
          src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1`}
          title={`${title} on YouTube`}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          className="size-full border-0"
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setPlaying(true)}
      aria-label={`Play ${title} on YouTube`}
      className="group relative block aspect-video w-full overflow-hidden rounded-2xl bg-stone-900"
    >
      <img
        // hqdefault exists for every video; maxresdefault does not, and a
        // missing thumbnail renders as a broken image.
        src={`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`}
        alt=""
        loading="lazy"
        className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
      />
      <span className="absolute inset-0 flex items-center justify-center bg-black/25 transition-colors group-hover:bg-black/40">
        <span className="flex size-16 items-center justify-center rounded-full bg-red-600 shadow-lg">
          <Play aria-hidden className="size-7 translate-x-0.5 fill-white text-white" />
        </span>
      </span>
    </button>
  );
}
