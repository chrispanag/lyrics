/** Types mirroring the Go API's JSON shapes. */

export type Role = "user" | "contributor" | "admin";

/**
 * The capacity a person is credited in on a song — authorship only.
 *
 * Performing is a property of a recording rather than of the work, so the
 * `artist` and `performer` roles this once had live on `Recording.performers`
 * now. The server refuses them, so a widened union here would render a picker
 * option every save rejects.
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
 *
 * Shared by the detail page and the editor so the Edit affordance and the
 * editor's own guard cannot disagree about who gets in. As with hasRole, the
 * server is the authority; this only decides what to render.
 *
 * The admin answer comes before the song is looked at, which is what lets a
 * caller ask before it has one: a song page renders its controls while the song
 * is in flight, and an admin's row has to be the row it will still be once the
 * song lands rather than gaining a link a moment later, under the finger of
 * someone reaching for the button beside it. Guarding on `!song` first — as this
 * did — pushed that caller into re-deriving the admin case for itself, which is
 * the disagreement the sharing exists to prevent. A contributor is the one who
 * cannot be answered early, their claim being on the song itself.
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
   * When the profile picture was last written, or null when there is none.
   *
   * The picture's URL is stable, so this is both what decides whether there is
   * one to show and what busts its cache once a new one is stored — see
   * `lib/avatar.ts`.
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
 * A song's `recordings` arrive **already ordered, first recording first**: the
 * server sorts by `is_first`, then the earliest year, then position. So
 * `recordings[0]` is the first recording and nothing here re-derives that rule.
 * `is_first` is a claim about history and may be false on every one of them,
 * which is why the order does not depend on it alone.
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
   * The song's address: `/songs/<slug>`.
   *
   * Derived from the title when the row is inserted and never recomputed, so
   * correcting a title cannot move a bookmarked URL. Build links with
   * `songHref` rather than from this directly — the id still resolves too, and
   * which one a route parameter holds is `songMatchesRef`'s question.
   */
  slug: string;
  alt_title: string | null;
  /**
   * The song body, present only on single-song reads.
   *
   * Browse, search and a list's songs project it away — nothing that shows more
   * than one song renders it, and it dwarfs the rest of the payload. Absent is
   * not the same as empty: a song may genuinely have no lyrics recorded.
   */
  lyrics?: string;
  language: string;
  /**
   * Denormalized copies of the first recording's, maintained server-side.
   *
   * They are what `SongCard` reads for its video badge and what the browse year
   * filters sort and filter on — a listing that had to carry every recording to
   * answer "is there a video" would pay for the whole set to draw one icon. A
   * song with no recordings has all three null.
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
 * Writable shape of a song, matching the API's create/update payload.
 *
 * No `youtube_url` and no `release_year`: both belong to a recording now, and
 * the server refuses a payload that still names them at this level rather than
 * ignoring it. Recordings are replaced wholesale on every save, like credits.
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
  q?: string;
  // The honest name for the filter, which is what the API calls it too. It kept
  // `artist` as an alias for links already out in the world, and nothing here
  // should reach for that spelling — a client type naming only the deprecated
  // one is how the alias becomes impossible to retire.
  performer?: string;
  composer?: string;
  lyricist?: string;
  person?: string;
  genre?: string;
  genre_slug?: string;
  language?: string;
  year_from?: number;
  year_to?: number;
  sort?: "relevance" | "title" | "newest" | "oldest";
  limit?: number;
  offset?: number;
}
