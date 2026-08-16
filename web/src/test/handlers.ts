import { HttpResponse, http } from "msw";

import type { Genre, ListResponse, Person, Song, SongList, User } from "@/lib/types";

/** Base URL the client talks to under test. Exported so specs cannot drift from it. */
export const API = "http://localhost:8080";

export function makeSong(overrides: Partial<Song> = {}): Song {
  return {
    id: "song-1",
    title: "Θάλασσα Πλατιά",
    alt_title: null,
    lyrics: "Στης θάλασσας τα βάθη\nη αγάπη μου κοιμάται",
    language: "el",
    youtube_url: null,
    youtube_video_id: null,
    release_year: 1964,
    notes: null,
    credits: [
      { person_id: "person-1", name: "Μίκης Θεοδωράκης", role: "composer", position: 0 },
    ],
    genres: [],
    created_by: null,
    updated_by: null,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

export function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: "user-1",
    email: "singer@example.com",
    display_name: null,
    role: "user",
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

export function makePerson(overrides: Partial<Person> = {}): Person {
  return {
    id: "person-1",
    name: "Μίκης Θεοδωράκης",
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

export function makeList(overrides: Partial<SongList> = {}): SongList {
  return {
    id: "list-1",
    owner_id: "user-1",
    name: "Ρεμπέτικα",
    description: null,
    is_public: true,
    is_default: false,
    item_count: 0,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    songs: [],
    ...overrides,
  };
}

/**
 * Wraps rows in the API's list envelope.
 *
 * Exported so specs do not hand-write `meta`, where `total` can silently
 * disagree with the number of rows actually returned. `meta` overrides exist
 * for the one case where they legitimately differ: a paginated response
 * returns a page of rows but a `total` counting all of them.
 */
export function list<T>(
  data: T[],
  meta: Partial<ListResponse<T>["meta"]> = {},
): ListResponse<T> {
  return { data, meta: { total: data.length, limit: 20, offset: 0, ...meta } };
}

/** Default handlers. Individual tests override these with server.use(). */
export const handlers = [
  http.get(`${API}/api/v1/songs`, () => HttpResponse.json(list([makeSong()]))),
  http.get(`${API}/api/v1/songs/:id`, () => HttpResponse.json(makeSong())),
  http.get(`${API}/api/v1/genres`, () => HttpResponse.json(list<Genre>([]))),
  http.get(`${API}/api/v1/people`, () => HttpResponse.json(list([]))),
  http.get(`${API}/api/v1/people/:id`, () => HttpResponse.json(makePerson())),
  http.get(`${API}/api/v1/me`, () => HttpResponse.json(makeUser())),
  http.get(`${API}/api/v1/lists`, () => HttpResponse.json(list([]))),
  // Asked for by the save sheet, to mark the lists a song is already in.
  http.get(`${API}/api/v1/songs/:id/lists`, () => HttpResponse.json({ list_ids: [] })),
];
