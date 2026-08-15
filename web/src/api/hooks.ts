import {
  useMutation,
  useQuery,
  useQueryClient,
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

export function useList(id: string | undefined) {
  return useQuery({
    queryKey: keys.list(id ?? ""),
    queryFn: () => apiFetch<SongList>(`/api/v1/lists/${id}`),
    enabled: Boolean(id),
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

export function useDeleteList() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/api/v1/lists/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.lists() }),
  });
}

/**
 * Adds or removes a song from a list.
 *
 * Every affected key is invalidated rather than patched in place: the toggle
 * appears on the song page, the list page, and the lists index at once, and
 * hand-patching three caches is how they drift apart.
 */
export function useToggleSongInList(songId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ listId, present }: { listId: string; present: boolean }) =>
      apiFetch<void>(`/api/v1/lists/${listId}/songs/${songId}`, {
        method: present ? "DELETE" : "PUT",
      }),
    onSuccess: (_data, { listId }) => {
      void queryClient.invalidateQueries({ queryKey: keys.songLists(songId) });
      void queryClient.invalidateQueries({ queryKey: keys.lists() });
      void queryClient.invalidateQueries({ queryKey: keys.list(listId) });
    },
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
