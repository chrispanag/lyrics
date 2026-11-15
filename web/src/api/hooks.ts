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

/**
 * A page of songs. `enabled` lets the quick search ask for nothing while empty
 * (an absent `q` means the whole catalog); it is a boolean, not an options bag,
 * so no caller can override `queryKey` or `placeholderData`.
 */
export function useSongs(filters: SongFilters, enabled = true) {
  return useQuery({
    queryKey: keys.songs(filters),
    queryFn: () => apiFetch<ListResponse<Song>>(`/api/v1/songs${toQuery({ ...filters })}`),
    // Keeps the previous page on screen while the next query loads.
    placeholderData: (previous) => previous,
    enabled,
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
    queryFn: () =>
      apiFetch<ListResponse<Person>>(`/api/v1/people${toQuery({ q: query, limit: 20 })}`),
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
    staleTime: 5 * 60_000,
  });
}

/** The chips themselves, which is all a brand new genre can be seen in. */
function invalidateGenreList(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: keys.genres() });
}

/**
 * Unsettles everything a genre's name is visible through, for rename and delete.
 * `["list"]` is the easy one to forget: the genre sits in `songs[].genres`.
 * Creating needs only `invalidateGenreList`. Callers return the promise so the
 * mutation settles when the caches do.
 */
function invalidateGenres(queryClient: QueryClient): Promise<unknown> {
  return Promise.all([
    invalidateGenreList(queryClient),
    queryClient.invalidateQueries({ queryKey: ["songs"] }),
    queryClient.invalidateQueries({ queryKey: ["song"] }),
    queryClient.invalidateQueries({ queryKey: ["list"] }),
  ]);
}

export function useCreateGenre() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      apiFetch<Genre>("/api/v1/genres", { method: "POST", body: { name } }),
    onSuccess: () => invalidateGenreList(queryClient),
  });
}

export function useUpdateGenre() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      apiFetch<Genre>(`/api/v1/genres/${id}`, { method: "PATCH", body: { name } }),
    onSuccess: () => invalidateGenres(queryClient),
  });
}

export function useDeleteGenre() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/api/v1/genres/${id}`, { method: "DELETE" }),
    onSuccess: () => invalidateGenres(queryClient),
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
 * A single list, once the caller's identity is settled. `ready` is required: a
 * guest request gets 404 on a private list, which no retry recovers from.
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

/**
 * Unsettles everything an edited song is visible through, including `["list"]`,
 * whose cached `songs[].recordings` feed each row's byline. Creating needs only
 * `["songs"]`: a new song is on no list.
 */
function invalidateSongs(queryClient: QueryClient): Promise<unknown> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ["songs"] }),
    queryClient.invalidateQueries({ queryKey: ["list"] }),
  ]);
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
      // Only under the ref the URL held; nothing reads the other address's key.
      queryClient.setQueryData(keys.song(id), song);
      return invalidateSongs(queryClient);
    },
  });
}

export function useDeleteSong() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/api/v1/songs/${id}`, { method: "DELETE" }),
    // Known gap: `["lists"]` item counts go stale on delete.
    onSuccess: () => invalidateSongs(queryClient),
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
 * Copies a list the caller can read into one they own. Omitting the name keeps
 * the original's. The body is `{}`, never absent: the API rejects an empty body.
 */
export function useCopyList() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name?: string | undefined }) =>
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
 * Saves a new order for a list's songs, optimistically; a failure rolls back
 * and refetches. The response is not written to the cache: an older reply
 * landing last would reinstate a superseded order.
 */
export function useReorderList(id: string) {
  const queryClient = useQueryClient();

  return useMutation({
    // Serializes one list's saves so two drags cannot race at the server.
    // onMutate still runs immediately.
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
        // Only for an exact permutation of the cache; otherwise a song would
        // vanish on screen while the server keeps it.
        if (reordered.length === songIds.length && reordered.length === previous.songs.length) {
          queryClient.setQueryData<SongList>(keys.list(id), { ...previous, songs: reordered });
        }
      }
      return { previous };
    },
    onError: (_error, _songIds, context) => {
      // A later drag may have superseded the snapshot; the refetch settles it.
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
 * Unsettles everything a song's membership of a list is visible through. Shared
 * by every mutation that changes membership, so none goes stale.
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
 * Takes a song out of one list, from that list's own page. Keyed by list, so
 * one mutation serves every row and `variables` names the row in flight.
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
    // Keeps rows on screen between debounced keystrokes.
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

/**
 * Stores a profile picture, replacing any previous one. Answers with the
 * updated user. Unsettles `["users"]`, whose cached `avatar_updated_at` is
 * what `Avatar` decides from.
 */
export function useUploadAvatar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (image: Blob) =>
      apiFetch<User>("/api/v1/me/avatar", { method: "POST", body: image }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["users"] }),
  });
}

export function useRemoveAvatar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<User>("/api/v1/me/avatar", { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["users"] }),
  });
}
