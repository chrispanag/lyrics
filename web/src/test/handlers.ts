import { HttpResponse, http } from "msw";

import type { Genre, ListResponse, Person, Recording, Song, SongList, User } from "@/lib/types";

/** Base URL the client talks to under test. Exported so specs cannot drift from it. */
export const API = "http://localhost:8080";

/**
 * A song with no recordings, as most of the catalog is; add one with
 * makeRecording. `release_year` is the server's copy of the first recording's.
 */
export function makeSong(overrides: Partial<Song> = {}): Song {
  return {
    id: "song-1",
    title: "Θάλασσα Πλατιά",
    // Differs from `id` so specs catch code that confuses the two.
    slug: "thalassa-platia",
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
    recordings: [],
    created_by: null,
    updated_by: null,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

/** One recording, with a performer on it, marked `is_first`. */
export function makeRecording(overrides: Partial<Recording> = {}): Recording {
  return {
    id: "recording-1",
    label: null,
    youtube_url: null,
    youtube_video_id: null,
    release_year: 1964,
    notes: null,
    is_first: true,
    position: 0,
    performers: [{ person_id: "person-2", name: "Γιώργος Νταλάρας", position: 0 }],
    ...overrides,
  };
}

export function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: "user-1",
    email: "singer@example.com",
    display_name: null,
    role: "user",
    // Verified by default; specs opt into the unverified case.
    email_verified_at: "2024-01-01T00:00:00Z",
    avatar_updated_at: null,
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

export function makeGenre(overrides: Partial<Genre> = {}): Genre {
  return {
    id: "genre-1",
    name: "Ρεμπέτικο",
    slug: "rempetiko",
    song_count: 0,
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
 * Wraps rows in the API's list envelope, `total` defaulting to the row count.
 * Override `meta` for a paginated page.
 */
export function list<T>(
  data: T[],
  meta: Partial<ListResponse<T>["meta"]> = {},
): ListResponse<T> {
  return { data, meta: { total: data.length, limit: 20, offset: 0, ...meta } };
}

/**
 * Serves each of these lists by id, and a not-found envelope for any other.
 * Returns a handler, since `server.ts` imports this module. Lists are serialized
 * per request, so a spec may mutate one in place.
 */
export function listById(...lists: SongList[]) {
  return http.get(`${API}/api/v1/lists/:id`, ({ params }) => {
    const found = lists.find((list) => list.id === params.id);
    return found ? HttpResponse.json(found) : notFound("List was not found.");
  });
}

/**
 * The API's error envelope. Specs use this rather than writing it by hand,
 * except `client.test.ts`, which tests the shape itself.
 */
export function apiError(status: number, code: string, message: string) {
  return HttpResponse.json({ error: { code, message } }, { status });
}

export function notFound(message: string) {
  return apiError(404, "not_found", message);
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
