"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { apiFetch } from "@/api/client";
import { keys } from "@/api/hooks";
import { visitorId } from "@/lib/popularity";
import type { Song, SongPopularity } from "@/lib/types";

/**
 * Records one opening of the song the page is showing. `enabled` waits until
 * the song has loaded and the session has settled, so a signed-in reader is
 * not counted as anonymous during the restore. A failure is swallowed: the
 * page is already up, and a missed tally is not a reason to say it failed.
 *
 * Lives apart from `hooks.ts`: that module is imported by server components,
 * and a `useEffect` import there makes the whole module client-only.
 */
export function useRecordSongClick(songRef: string | undefined, enabled: boolean) {
  const queryClient = useQueryClient();
  const recorded = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!enabled || !songRef || recorded.current === songRef) return;
    recorded.current = songRef;
    void apiFetch<SongPopularity>(`/api/v1/songs/${songRef}/clicks`, {
      method: "POST",
      body: { visitor_id: visitorId() },
    })
      .then(async (popularity) => {
        // The response is the tally including this opening. Fold it into the
        // song already on screen; a 204 (no tally) leaves that song as it was.
        if (!popularity) return;
        // A refetch already in flight read the tally before this opening and
        // would land over it; the song is on screen, so nothing is lost.
        await queryClient.cancelQueries({ queryKey: keys.song(songRef) });
        queryClient.setQueryData<Song>(keys.song(songRef), (song) =>
          song ? { ...song, popularity } : song,
        );
      })
      .catch(() => {
        // See the comment above.
      });
  }, [enabled, songRef, queryClient]);
}
