import { apiUrl } from "@/api/client";
import { CATALOG_ABOUT, CATALOG_HEADING, CATALOG_PROGRAMS } from "@/lib/catalogCopy";
import { SITE_NAME, SITE_ORIGIN } from "@/lib/site";
import type { Song, SongList } from "@/lib/types";

/**
 * Markdown representations of the site's documents, and the 404 an agent gets
 * for an address that has none. The homepage does not wait on the API: its
 * prose is the page. A song or a public list is read from the API so the
 * Markdown is the same work the HTML shows.
 */

export interface MarkdownDocument {
  status: number;
  body: string;
}

const GUIDE = `${SITE_ORIGIN}/llms.txt`;
const SITEMAP = `${SITE_ORIGIN}/sitemap.xml`;
const OPENAPI = `${SITE_ORIGIN}/openapi.json`;

/** A path safe to echo into a Markdown document. */
function shownPath(pathname: string): string {
  let clean = "";
  for (const char of pathname) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 32 || char === "`") continue;
    clean += char;
    if (clean.length >= 200) break;
  }
  if (!clean.startsWith("/")) clean = `/${clean}`;
  return clean;
}

/** Links an error or a short page gives an agent instead of a dead end. */
function guideLinks(): string {
  return [
    `- [Agent guide](${GUIDE})`,
    `- [Sitemap](${SITEMAP})`,
    `- [OpenAPI specification](${OPENAPI})`,
  ].join("\n");
}

/** The homepage, as Markdown. */
export function homeMarkdown(): MarkdownDocument {
  const paragraphs = [CATALOG_HEADING, ...CATALOG_ABOUT, CATALOG_PROGRAMS]
    .map((paragraph, index) => (index === 0 ? `# ${paragraph}` : paragraph))
    .join("\n\n");

  return {
    status: 200,
    body: `${paragraphs}\n\n${guideLinks()}\n`,
  };
}

/** An unknown address. Status 404, with a way onward. */
export function notFoundMarkdown(pathname: string): MarkdownDocument {
  const path = shownPath(pathname);
  return {
    status: 404,
    body: `# Page not found

Nothing on ${SITE_NAME} is published at \`${path}\`.

${guideLinks()}
`,
  };
}

/** A screen that exists and is not a catalog document. */
function screenMarkdown(title: string, detail: string): MarkdownDocument {
  return {
    status: 200,
    body: `# ${title}

${detail}

The catalog is on the [home page](${SITE_ORIGIN}/).

${guideLinks()}
`,
  };
}

const SCREENS: Record<string, MarkdownDocument> = {
  "/login": screenMarkdown(
    "Sign in",
    "This screen signs an existing reader in. Reading the catalog does not require an account.",
  ),
  "/register": screenMarkdown(
    "Create an account",
    "This screen creates an account. Reading the catalog does not require one.",
  ),
  "/forgot-password": screenMarkdown(
    "Forgot password",
    "This screen sends a code to reset a password.",
  ),
  "/change-password": screenMarkdown(
    "Change password",
    "This screen changes the password of a signed-in account.",
  ),
  "/verify-email": screenMarkdown(
    "Verify email",
    "This screen confirms an email address with a one-time code. The API records it when the token carries the email:verify scope.",
  ),
  "/profile": screenMarkdown(
    "Profile",
    "This screen shows the signed-in account. Guests are asked to sign in.",
  ),
  "/lists": screenMarkdown(
    "Your lists",
    "This screen lists the signed-in reader's lists. A public list has its own address, /lists/<id>.",
  ),
  "/songs/new": screenMarkdown(
    "Add a song",
    "This screen is the form contributors use to add a song. The catalog itself is public.",
  ),
  "/admin": screenMarkdown(
    "Admin",
    "This screen is for administrators. It redirects to the user list.",
  ),
  "/admin/users": screenMarkdown("Users", "This screen lists accounts for an administrator."),
  "/admin/genres": screenMarkdown("Genres", "This screen edits genres for an administrator."),
};

function songMarkdown(song: Song): string {
  const lines = [`# ${song.title}`, ""];
  if (song.credits.length > 0) {
    lines.push(song.credits.map((credit) => `${credit.name} (${credit.role})`).join(", "), "");
  }
  const performers = song.recordings.flatMap((recording) =>
    recording.performers.map((person) => person.name),
  );
  if (performers.length > 0) {
    lines.push(`Performed by ${performers.join(", ")}.`, "");
  }
  if (song.release_year) lines.push(`Released ${song.release_year}.`, "");
  if (song.lyrics?.trim()) {
    lines.push(song.lyrics.trim(), "");
  }
  lines.push(
    `Canonical page: ${SITE_ORIGIN}/songs/${song.slug}`,
    "",
    `JSON: ${SITE_ORIGIN}/api/v1/songs/${encodeURIComponent(song.slug)}`,
    "",
    guideLinks(),
    "",
  );
  return lines.join("\n");
}

function listMarkdown(list: SongList): string {
  const lines = [`# ${list.name}`, ""];
  if (list.description?.trim()) lines.push(list.description.trim(), "");
  for (const song of list.songs ?? []) {
    lines.push(`- [${song.title}](${SITE_ORIGIN}/songs/${song.slug})`);
  }
  lines.push("", `Canonical page: ${SITE_ORIGIN}/lists/${list.id}`, "", guideLinks(), "");
  return lines.join("\n");
}

interface ApiResult<T> {
  status: number;
  body: T | null;
}

/** One guest read. A transport failure is status 0, which is not a 404. */
async function readJson<T>(path: string): Promise<ApiResult<T>> {
  try {
    const response = await fetch(apiUrl(path), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return { status: response.status, body: null };
    return { status: response.status, body: (await response.json()) as T };
  } catch {
    return { status: 0, body: null };
  }
}

function unavailable(title: string, path: string): MarkdownDocument {
  return {
    status: 200,
    body: `# ${title}

The catalog could not be read just now. The page at \`${shownPath(path)}\` is still the address; try the JSON API or the links below.

${guideLinks()}
`,
  };
}

async function songDocument(slug: string): Promise<MarkdownDocument> {
  const path = `/songs/${slug}`;
  const result = await readJson<Song>(`/api/v1/songs/${encodeURIComponent(slug)}`);
  if (result.status === 404) return notFoundMarkdown(path);
  if (!result.body?.slug) return unavailable("Song", path);
  return { status: 200, body: songMarkdown(result.body) };
}

async function listDocument(id: string): Promise<MarkdownDocument> {
  const path = `/lists/${id}`;
  const result = await readJson<SongList>(`/api/v1/lists/${encodeURIComponent(id)}`);
  if (result.status === 404) return notFoundMarkdown(path);
  if (!result.body?.id) return unavailable("List", path);
  return { status: 200, body: listMarkdown(result.body) };
}

/**
 * The Markdown document for a path, or a 404 when nothing is published there.
 * `pathname` is normalized and has no query string.
 */
export async function markdownFor(pathname: string): Promise<MarkdownDocument> {
  if (pathname === "/") return homeMarkdown();

  const screen = SCREENS[pathname];
  if (screen) return screen;

  const edit = pathname.match(/^\/songs\/([^/]+)\/edit$/);
  if (edit?.[1] && edit[1] !== "new") {
    return screenMarkdown(
      "Edit song",
      `This screen edits the song at /songs/${edit[1]}. It is for the contributor who added it, and for an administrator.`,
    );
  }

  const song = pathname.match(/^\/songs\/([^/]+)$/);
  if (song?.[1] && song[1] !== "new") return songDocument(song[1]);

  const list = pathname.match(/^\/lists\/([^/]+)$/);
  if (list?.[1]) return listDocument(list[1]);

  return notFoundMarkdown(pathname);
}
