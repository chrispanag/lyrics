/** Types mirroring the Go API's JSON shapes. */

export type Role = "user" | "contributor" | "admin";

/**
 * The capacity a person is credited in on a song — authorship only. Performers
 * are on `Recording.performers`; the server refuses other roles here.
 */
export type CreditRole = "composer" | "lyricist";

export const CREDIT_ROLES: CreditRole[] = ["composer", "lyricist"];

export const ROLES: Role[] = ["user", "contributor", "admin"];

export const ROLE_RANK: Record<Role, number> = {
  user: 1,
  contributor: 2,
  admin: 3,
};

/** Language codes to display names, for anywhere a raw code would otherwise show. */
export const LANGUAGE_LABELS: Record<string, string> = {
  el: "Greek",
  en: "English",
  fr: "French",
  es: "Spanish",
  it: "Italian",
  tr: "Turkish",
};

/**
 * Mirrors the server's role check. The server remains the authority — this
 * only decides what to render, never what is permitted.
 */
export function hasRole(role: Role | undefined, minimum: Role): boolean {
  if (!role) return false;
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

/**
 * Whether a user may edit a song: admins anywhere, contributors on their own.
 * Decides what to render only; the server is the authority.
 *
 * The admin check comes before `!song`, so a page can ask while its song is
 * still in flight.
 */
export function canEditSong(
  user: Pick<User, "id" | "role"> | null | undefined,
  song: Pick<Song, "created_by"> | null | undefined,
): boolean {
  if (!user) return false;
  if (hasRole(user.role, "admin")) return true;
  if (!song) return false;
  return hasRole(user.role, "contributor") && song.created_by === user.id;
}

export interface User {
  id: string;
  email: string;
  display_name: string | null;
  role: Role;
  /**
   * When the address was confirmed with a one-time code, or null while it has
   * not been. The server refuses everything but reading this profile and
   * finishing verification until it is set, so this is what the app gates on.
   */
  email_verified_at: string | null;
  /**
   * When the profile picture was last written, or null when there is none. Also
   * its cache-busting version; see `lib/avatar.ts`.
   */
  avatar_updated_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Person {
  id: string;
  name: string;
  song_count?: number;
  created_at: string;
  updated_at: string;
}

export interface Genre {
  id: string;
  name: string;
  slug: string;
  song_count?: number;
  created_at: string;
  updated_at: string;
}

export interface Credit {
  person_id: string;
  name: string;
  role: CreditRole;
  position: number;
}

/** A performer on a recording. No role: everyone here performed it. */
export interface RecordingPerformer {
  person_id: string;
  name: string;
  position: number;
}

/**
 * One performance of a song — an εκτέλεση.
 *
 * A song's `recordings` arrive **already ordered, first recording first**
 * (`is_first`, then earliest year, then position), so `recordings[0]` is the
 * first recording. `is_first` may be false on every one.
 */
export interface Recording {
  id: string;
  label: string | null;
  youtube_url: string | null;
  youtube_video_id: string | null;
  release_year: number | null;
  notes: string | null;
  is_first: boolean;
  position: number;
  performers: RecordingPerformer[];
}

export interface Song {
  id: string;
  title: string;
  /**
   * The song's address: `/songs/<slug>`, fixed at insert. Build links with
   * `songHref`, and compare route parameters with `songMatchesRef`.
   */
  slug: string;
  alt_title: string | null;
  /**
   * The song body, present only on single-song reads. Absent is not empty: a
   * song may have no lyrics recorded.
   */
  lyrics?: string;
  language: string;
  /**
   * Denormalized copies of the first recording's, maintained server-side; all
   * null when there are no recordings. Read these, not `recordings[0]`.
   */
  youtube_url: string | null;
  youtube_video_id: string | null;
  release_year: number | null;
  notes: string | null;
  credits: Credit[];
  genres: Genre[];
  /** Ordered first-recording-first by the server. Present on every read. */
  recordings: Recording[];
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  /** Highlighted lyrics excerpt, present only on search results. */
  snippet?: string;
  /** Blended relevance score, present only on search results. */
  score?: number;
}

export interface SongList {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  is_public: boolean;
  is_default: boolean;
  item_count: number;
  created_at: string;
  updated_at: string;
  songs?: Song[];
}

/** A row of `GET /public-lists`: an address and a date, for the sitemap. */
export interface PublicList {
  id: string;
  updated_at: string;
}

export interface ListResponse<T> {
  data: T[];
  meta: { total: number; limit: number; offset: number };
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: Record<string, string>;
  };
}

/**
 * Writable shape of a song, matching the API's create/update payload. No
 * `youtube_url` or `release_year` (they belong to a recording; the server
 * refuses them here). Recordings are replaced wholesale on every save.
 */
export interface SongInput {
  title: string;
  alt_title?: string | null;
  lyrics: string;
  language: string;
  notes?: string | null;
  credits: CreditInput[];
  genre_ids: string[];
  recordings: RecordingInput[];
}

/**
 * A credit identifies a person by id, or by name to have the server create
 * them — which is what lets the editor accept a name typed inline.
 */
export interface CreditInput {
  person_id?: string;
  name?: string;
  role: CreditRole;
  position: number;
}

/** A performer, named the same two ways a credit is. */
export interface RecordingPerformerInput {
  person_id?: string;
  name?: string;
  position: number;
}

/**
 * Writable shape of a recording. No `youtube_video_id` — the server derives it
 * from the link, so the two cannot be stated as disagreeing values.
 */
export interface RecordingInput {
  label?: string | null;
  youtube_url?: string | null;
  release_year?: number | null;
  notes?: string | null;
  is_first: boolean;
  position: number;
  performers: RecordingPerformerInput[];
}

export interface SongFilters {
  q?: string | undefined;
  // Not `artist`: the API keeps that only as an alias for old links.
  performer?: string;
  composer?: string;
  lyricist?: string;
  person?: string | undefined;
  genre?: string;
  genre_slug?: string | undefined;
  language?: string | undefined;
  year_from?: number;
  year_to?: number;
  sort?: "relevance" | "title" | "newest" | "oldest";
  limit?: number;
  offset?: number;
}
