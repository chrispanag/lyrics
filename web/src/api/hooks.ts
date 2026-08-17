import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";

import { apiFetch, toQuery } from "./client";
import type {
  Genre,
  ListResponse,
  Person,
  Song,
  SongFilters,
  SongInput,
  SongList,
  User,
} from "@/lib/types";

/** Query key factory, so invalidations cannot drift from the keys they target. */
export const keys = {
  songs: (filters: SongFilters) => ["songs", filters] as const,
  song: (id: string) => ["song", id] as const,
  people: (query: string) => ["people", query] as const,
  person: (id: string) => ["person", id] as const,
  genres: () => ["genres"] as const,
  lists: () => ["lists"] as const,
  list: (id: string) => ["list", id] as const,
  songLists: (songId: string) => ["song-lists", songId] as const,
  users: (query: string, role: string) => ["users", query, role] as const,
};

export function useSongs(filters: SongFilters) {
  return useQuery({
    queryKey: keys.songs(filters),
    queryFn: () =>
      apiFetch<ListResponse<Song>>(`/api/v1/songs${toQuery({ ...filters })}`),
    // Backspacing to a previous query should be instant, so results stay fresh
    // for the global 60s window rather than the 30s this used to ask for — which
    // was half the default it overrode, achieving the opposite.
    placeholderData: (previous) => previous,
  });
}

export function useSong(id: string | undefined) {
  return useQuery({
    queryKey: keys.song(id ?? ""),
    queryFn: () => apiFetch<Song>(`/api/v1/songs/${id}`),
    enabled: Boolean(id),
  });
}

export function usePeople(query: string, options?: Partial<UseQueryOptions<ListResponse<Person>>>) {
  return useQuery({
    queryKey: keys.people(query),
    queryFn: () => apiFetch<ListResponse<Person>>(`/api/v1/people${toQuery({ q: query, limit: 20 })}`),
    staleTime: 60_000,
    ...options,
  });
}

/** A single person, used to label an active artist filter with their name. */
export function usePerson(id: string | undefined) {
  return useQuery({
    queryKey: keys.person(id ?? ""),
    queryFn: () => apiFetch<Person>(`/api/v1/people/${id}`),
    enabled: Boolean(id),
    staleTime: 5 * 60_000,
  });
}

export function useGenres() {
  return useQuery({
    queryKey: keys.genres(),
    queryFn: () => apiFetch<ListResponse<Genre>>("/api/v1/genres"),
    // Genres change rarely and are needed on nearly every screen.
    staleTime: 5 * 60_000,
  });
}

export function useLists(enabled: boolean) {
  return useQuery({
    queryKey: keys.lists(),
    queryFn: () => apiFetch<ListResponse<SongList>>("/api/v1/lists"),
    enabled,
  });
}

/**
 * A single list, once the caller's identity is settled.
 *
 * `ready` is required rather than defaulted, because the default anyone would
 * reach for is the broken one: a private list answers 404 to whoever is not its
 * owner, so a request issued before the session has been restored carries no
 * token, reads as a guest, and tells an owner their own list does not exist.
 * Nothing recovers from it either — `apiFetch` retries a 401 with a fresh
 * token, and this is deliberately not a 401.
 */
export function useList(id: string | undefined, ready: boolean) {
  return useQuery({
    queryKey: keys.list(id ?? ""),
    queryFn: () => apiFetch<SongList>(`/api/v1/lists/${id}`),
    enabled: Boolean(id) && ready,
  });
}

/** Which of the current user's lists contain a song. */
export function useSongLists(songId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: keys.songLists(songId ?? ""),
    queryFn: () => apiFetch<{ list_ids: string[] }>(`/api/v1/songs/${songId}/lists`),
    enabled: Boolean(songId) && enabled,
  });
}

export function useCreateSong() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SongInput) =>
      apiFetch<Song>("/api/v1/songs", { method: "POST", body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["songs"] }),
  });
}

export function useUpdateSong(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SongInput) =>
      apiFetch<Song>(`/api/v1/songs/${id}`, { method: "PATCH", body: input }),
    onSuccess: (song) => {
      queryClient.setQueryData(keys.song(id), song);
      void queryClient.invalidateQueries({ queryKey: ["songs"] });
    },
  });
}

export function useDeleteSong() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/api/v1/songs/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["songs"] }),
  });
}

export function useCreateList() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; description?: string; is_public?: boolean }) =>
      apiFetch<SongList>("/api/v1/lists", { method: "POST", body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.lists() }),
  });
}

/**
 * Copies a list the caller can read into one they own.
 *
 * The name is optional — omitted, the server keeps the original's, which
 * collides only when the caller already has a list by that name and answers 409.
 * The body is still sent as `{}` rather than left off: the API rejects an empty
 * request body outright.
 */
export function useCopyList() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name?: string }) =>
      apiFetch<SongList>(`/api/v1/lists/${id}/copy`, {
        method: "POST",
        body: name === undefined ? {} : { name },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.lists() }),
  });
}

export function useUpdateList(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { name?: string; description?: string | null; is_public?: boolean }) =>
      apiFetch<SongList>(`/api/v1/lists/${id}`, { method: "PATCH", body: input }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.lists() });
      void queryClient.invalidateQueries({ queryKey: keys.list(id) });
    },
  });
}

/**
 * Saves a new order for a list's songs.
 *
 * The reorder is applied to the cache before the request goes out: a drag that
 * snapped back until the server answered would be unusable on a phone. A
 * failure restores the order that was there and refetches, so the list on
 * screen is never a guess the server disagreed with.
 *
 * What the server sends back is deliberately *not* written to the cache. Two
 * quick drags produce two requests whose responses can land in either order,
 * and the older one landing last would reinstate the order the user already
 * moved on from. Since the client sends the complete order it wants, a success
 * carries no information the optimistic write does not already hold.
 */
export function useReorderList(id: string) {
  const queryClient = useQueryClient();

  return useMutation({
    // One list's saves run in series. Unscoped mutations go out in parallel, so
    // two quick drags race at the *server* as well as in the cache — and the
    // first request committing last leaves the database holding the order the
    // user already moved on from, silently, because the reply is discarded and
    // nothing refetches. A scope defers only the request: onMutate still runs
    // immediately, so the optimistic write stays instant.
    scope: { id: `reorder-${id}` },
    mutationFn: (songIds: string[]) =>
      apiFetch<SongList>(`/api/v1/lists/${id}/reorder`, {
        method: "POST",
        body: { song_ids: songIds },
      }),
    onMutate: async (songIds) => {
      // An in-flight read would otherwise land after this write and undo it.
      await queryClient.cancelQueries({ queryKey: keys.list(id) });

      const previous = queryClient.getQueryData<SongList>(keys.list(id));
      if (previous?.songs) {
        const bySongId = new Map(previous.songs.map((song) => [song.id, song]));
        const reordered = songIds.flatMap((songId) => bySongId.get(songId) ?? []);
        // Applied only when the payload is a permutation of what is cached. An
        // id that does not resolve, or a cached song the payload leaves out,
        // would disappear from the list on screen while the server keeps it —
        // it pushes anything omitted to the end — and nothing rewrites the
        // cache on success to put it back.
        if (reordered.length === songIds.length && reordered.length === previous.songs.length) {
          queryClient.setQueryData<SongList>(keys.list(id), { ...previous, songs: reordered });
        }
      }
      return { previous };
    },
    onError: (_error, _songIds, context) => {
      // The snapshot is the order from before *this* drag, which a later drag
      // may already have superseded — so the refetch is what settles the list,
      // and the rollback only keeps it from sitting on a rejected order in the
      // meantime.
      if (context?.previous) queryClient.setQueryData(keys.list(id), context.previous);
      void queryClient.invalidateQueries({ queryKey: keys.list(id) });
    },
  });
}

export function useDeleteList() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/api/v1/lists/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.lists() }),
  });
}

/**
 * Marks everything that a song's membership of a list is visible through.
 *
 * Both mutations below write the same fact and so must unsettle the same
 * readers of it — the toggle on a song page, the counts on the lists index, and
 * the songs on the list's own page. Shared rather than stated twice, which is
 * how two copies of a rule come to disagree without anything failing: whichever
 * screen was forgotten simply goes stale.
 *
 * Nothing is patched in place. A cache written by hand in two shapes is the
 * drift this avoids; a refetch settles the rows and the counts together.
 */
function invalidateMembership(queryClient: QueryClient, listId: string, songId: string): void {
  void queryClient.invalidateQueries({ queryKey: keys.songLists(songId) });
  void queryClient.invalidateQueries({ queryKey: keys.lists() });
  void queryClient.invalidateQueries({ queryKey: keys.list(listId) });
}

/** Adds or removes a song from a list, from the song's page. */
export function useToggleSongInList(songId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ listId, present }: { listId: string; present: boolean }) =>
      apiFetch<void>(`/api/v1/lists/${listId}/songs/${songId}`, {
        method: present ? "DELETE" : "PUT",
      }),
    onSuccess: (_data, { listId }) => invalidateMembership(queryClient, listId, songId),
  });
}

/**
 * Takes a song out of one list, from that list's own page.
 *
 * The same DELETE as `useToggleSongInList`, keyed the other way round: that one
 * belongs to a song and is handed a list, this one belongs to a list and is
 * handed a song. That is what lets the page hold a single mutation and pass one
 * callback to every row — and what makes `variables` name the row whose removal
 * is in flight, which a hook per row could not.
 *
 * `useReorderList` next door is optimistic because a drag that snaps back until
 * the server replies is unusable on a phone; a row that lingers for one round
 * trip is not, so this one waits for the answer.
 */
export function useRemoveSongFromList(listId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (songId: string) =>
      apiFetch<void>(`/api/v1/lists/${listId}/songs/${songId}`, { method: "DELETE" }),
    onSuccess: (_data, songId) => invalidateMembership(queryClient, listId, songId),
  });
}

export function useUsers(query: string, role: string) {
  return useQuery({
    queryKey: keys.users(query, role),
    queryFn: () =>
      apiFetch<ListResponse<User>>(`/api/v1/admin/users${toQuery({ q: query, role, limit: 50 })}`),
    // Without this every debounced keystroke tears the table down to skeletons
    // and rebuilds it, which useSongs already avoids.
    placeholderData: (previous) => previous,
  });
}

export function useSetUserRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, role }: { id: string; role: string }) =>
      apiFetch<User>(`/api/v1/admin/users/${id}/role`, { method: "PATCH", body: { role } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["users"] }),
  });
}

export function useUpdateProfile() {
  return useMutation({
    mutationFn: (input: { display_name: string | null }) =>
      apiFetch<User>("/api/v1/me", { method: "PATCH", body: input }),
  });
}
