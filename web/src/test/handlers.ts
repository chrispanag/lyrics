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
    // Verified by default: an unverified account is refused everywhere but the
    // verification screen, so it is the exception a spec asks for explicitly.
    email_verified_at: "2024-01-01T00:00:00Z",
    // No picture by default, so a spec that wants one says so — and the
    // initials fallback is what most screens are rendering.
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

/**
 * Serves each of these lists by id, and a not-found envelope for any other.
 *
 * A handler rather than a `server.use` call, so this module stays free of the
 * server it is loaded into — `server.ts` imports these handlers, and importing it
 * back would close the circle. Each list is held by reference and serialized per
 * request, so a spec whose subject changes one edits it in place rather than
 * registering a second handler that would have to repeat the id matching.
 */
export function listById(...lists: SongList[]) {
  return http.get(`${API}/api/v1/lists/:id`, ({ params }) => {
    const found = lists.find((list) => list.id === params.id);
    return found ? HttpResponse.json(found) : notFound("List was not found.");
  });
}

/**
 * The API's error envelope, which the specs had each written out by hand.
 *
 * `notFound` came first and is the common case by far; the general form exists
 * because the envelope is the same shape whatever the status, and a spec that
 * writes one out by hand is a spec that can get the shape wrong while appearing
 * to test a refusal. Every route spec goes through here.
 *
 * `client.test.ts` is the one deliberate exception and should stay one: the
 * shape of the envelope is what it is testing, so building it from the helper
 * that the code under test is checked against would assert nothing.
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
