"use client";

import { useState, type ReactNode, type SubmitEvent } from "react";
import { Pencil, Plus, Tags, Trash } from "lucide-react";

import { errorDetails, errorMessage } from "@/api/client";
import {
  useCreateGenre,
  useDeleteGenre,
  useGenres,
  useSetUserRole,
  useUpdateGenre,
  useUsers,
} from "@/api/hooks";
import { Avatar } from "@/components/Avatar";
import { actionLabel, segmentClasses, segmentedTrack } from "@/components/buttonStyles";
import { cardChrome } from "@/components/cardStyles";
import { PageTitle } from "@/components/PageTitle";
import { sectionLabel } from "@/components/textStyles";
import {
  Button,
  ConfirmSheet,
  EmptyState,
  ErrorMessage,
  Field,
  Input,
  Select,
  Sheet,
  Skeletons,
  Tally,
} from "@/components/ui";
import { ADMIN_TABS } from "@/routes/adminTabs";
import { cn } from "@/lib/cn";
import { pluralize, songCount } from "@/lib/format";
import { NavLink, pathMatches, usePathname } from "@/lib/navigation";
import { useDebounced } from "@/lib/useDebounced";
import { ROLES, type Genre, type Role } from "@/lib/types";

const ROLE_DESCRIPTIONS: Record<Role, string> = {
  user: "Can browse and build lists",
  contributor: "Can also add songs and edit their own",
  admin: "Full access, including deleting anything",
};

/** The row both console screens list records in, shared so they cannot drift. */
const adminRowChrome = cn(cardChrome, "flex gap-3 bg-surface p-4");

/** A user's role picker drops below them on a phone. */
const userRowChrome = cn(adminRowChrome, "flex-col sm:flex-row sm:items-center sm:justify-between");

/** A genre's actions are icons on a phone, so its row stays one line. */
const genreRowChrome = cn(adminRowChrome, "items-center justify-between");

/** The wait both screens show: rows the height of the cards they become. */
function RowSkeletons() {
  return <Skeletons count={5} className="h-16 w-full" stackClassName="space-y-2" />;
}

/**
 * The console's shell: what the `/admin` layout route renders around its
 * screens, wrapped once by `RequireAdmin`. The heading and title come from the
 * tab matching the address, and the tabs are the only way between screens: the
 * app nav has one `/admin` entry so its prefix match stays lit on both.
 */
export function AdminConsole({ children }: { children: ReactNode }) {
  // The tabs' own rule, so the heading names the tab that is lit.
  const pathname = usePathname();
  const current = ADMIN_TABS.find((tab) => pathMatches(pathname, tab.to));

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <PageTitle name={current ? `Admin · ${current.label}` : "Admin"} />
      {/* The section's name above the screen's, in the song page's label style. */}
      <p className={sectionLabel}>Admin</p>
      {current && <h1 className="mt-1 text-2xl font-bold tracking-tight">{current.label}</h1>}

      {/* Views of one console, so drawn as the segmented control the theme
          switch is, not as buttons that read as actions. */}
      <nav aria-label="Admin" className={cn(segmentedTrack, "my-5 sm:w-fit")}>
        {ADMIN_TABS.map((tab) => (
          <NavLink
            key={tab.to}
            href={tab.to}
            className={({ isActive }) => segmentClasses(isActive, "flex-1 px-5")}
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>

      {children}
    </div>
  );
}

/**
 * The users count. The screen asks for one page of rows, so a total past it
 * says how many are shown, or "73 users" would sit over 50 rows.
 */
function userTally(shown: number, total: number): string {
  return shown < total ? `${shown} of ${pluralize(total, "user")}` : pluralize(total, "user");
}

export function AdminUsersPage() {
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [error, setError] = useState("");

  const debouncedSearch = useDebounced(search, 250);
  const { data, isLoading, isError, error: fetchError } = useUsers(debouncedSearch, roleFilter);
  const setRole = useSetUserRole();

  return (
    <>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <Input
          type="search"
          placeholder="Search by email or name"
          aria-label="Search users"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          // Only once the row is a row: in the phone's column, `flex-1`'s zero
          // basis is a height, and the field collapses to its border.
          className="sm:flex-1"
        />
        <Select
          aria-label="Filter by role"
          value={roleFilter}
          onChange={(event) => setRoleFilter(event.target.value)}
          className="w-full sm:w-44"
        >
          <option value="">All roles</option>
          {ROLES.map((role) => (
            <option key={role} value={role} className="capitalize">
              {role}
            </option>
          ))}
        </Select>
      </div>

      {/* Blank when nothing matched: "No users matched." below says so once. */}
      {!isError && (
        <Tally className="mb-3">
          {isLoading
            ? "Searching…"
            : data?.meta.total
              ? userTally(data.data.length, data.meta.total)
              : ""}
        </Tally>
      )}

      {error && <ErrorMessage>{error}</ErrorMessage>}
      {/* A failure must not read as "No users matched." */}
      {isError && (
        <ErrorMessage>{errorMessage(fetchError, "Users could not be loaded.")}</ErrorMessage>
      )}

      {isLoading && <RowSkeletons />}

      <ul className="space-y-2">
        {data?.data.map((row) => (
          <li key={row.id} className={userRowChrome}>
            {/* Grouped so `sm:justify-between` keeps picture and name together. */}
            <div className="flex min-w-0 items-center gap-3">
              <Avatar user={row} size="md" />
              <div className="min-w-0">
                <p className="truncate font-medium">{row.display_name ?? row.email}</p>
                {row.display_name && <p className="truncate text-sm text-fg-muted">{row.email}</p>}
                <p className="mt-0.5 text-xs text-fg-muted">{ROLE_DESCRIPTIONS[row.role]}</p>
              </div>
            </div>

            <Select
              aria-label={`Role for ${row.email}`}
              value={row.role}
              disabled={setRole.isPending}
              onChange={(event) => {
                setError("");
                setRole.mutate(
                  { id: row.id, role: event.target.value },
                  {
                    onError: (caught) =>
                      setError(errorMessage(caught, "That role change could not be applied.")),
                  },
                );
              }}
              className="w-full shrink-0 capitalize sm:w-44"
            >
              {ROLES.map((role) => (
                <option key={role} value={role} className="capitalize">
                  {role}
                </option>
              ))}
            </Select>
          </li>
        ))}
      </ul>

      {!isLoading && !isError && data?.data.length === 0 && (
        <p className="py-10 text-center text-sm text-fg-muted">No users matched.</p>
      )}
    </>
  );
}

/** Which sheet is up and its subject; one value, so two cannot be open. */
type GenreSheet =
  | { kind: "create" }
  | { kind: "rename"; genre: Genre }
  | { kind: "delete"; genre: Genre };

/**
 * The name form's wording per use. Only one is ever mounted (`Sheet` renders
 * nothing closed), which is why the field below carries a single id.
 */
const NAME_FORMS = {
  create: {
    title: "New genre",
    submit: "Add genre",
    hint: "Greek names are transliterated for the URL — Έντεχνο becomes entechno.",
    placeholder: "Ρεμπέτικο",
  },
  rename: {
    title: "Rename genre",
    submit: "Save name",
    hint: "The filter link keeps the slug it already has.",
    placeholder: undefined,
  },
};

/** What a refused write said: a sentence for the attempt, and the field's own. */
interface Failure {
  message: string;
  field: string;
}

/**
 * Creates, renames and deletes genres. The slug is derived server-side, and a
 * rename leaves it alone so shared filter links keep working.
 */
export function AdminGenresPage() {
  const { data, isLoading, isError, error: fetchError } = useGenres();
  const createGenre = useCreateGenre();
  const updateGenre = useUpdateGenre();
  const deleteGenre = useDeleteGenre();

  const [sheet, setSheet] = useState<GenreSheet | null>(null);
  const [name, setName] = useState("");
  const [failure, setFailure] = useState<Failure | null>(null);

  // Clears the last attempt's failure, or a rename opens under a create's error.
  const openSheet = (next: GenreSheet) => {
    setFailure(null);
    setName(next.kind === "rename" ? next.genre.name : "");
    setSheet(next);
  };

  /**
   * Runs a write. Success closes the sheet; failure keeps it open with the name
   * still typed and the server's reason, the field's own under the field.
   */
  const attempt = async (write: () => Promise<unknown>, fallback: string) => {
    setFailure(null);
    try {
      await write();
      setSheet(null);
    } catch (caught) {
      setFailure({
        message: errorMessage(caught, fallback),
        field: errorDetails(caught).name ?? "",
      });
    }
  };

  const onSubmitName = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (sheet?.kind === "create") {
      void attempt(() => createGenre.mutateAsync(name.trim()), "The genre could not be created.");
    } else if (sheet?.kind === "rename") {
      const { genre } = sheet;
      void attempt(
        () => updateGenre.mutateAsync({ id: genre.id, name: name.trim() }),
        "The genre could not be renamed.",
      );
    }
  };

  const closeSheet = () => setSheet(null);
  const genres = data?.data ?? [];
  const nameForm = sheet && sheet.kind !== "delete" ? NAME_FORMS[sheet.kind] : null;

  return (
    <>
      <div className="mb-3 flex items-center gap-3">
        {/* Mounted from the start: a live region that arrives with its text
            already in it is not read out. Blank with no genres, which the
            empty state says. */}
        <Tally>{genres.length > 0 && pluralize(genres.length, "genre")}</Tally>
        <Button size="sm" className="ml-auto" onClick={() => openSheet({ kind: "create" })}>
          <Plus aria-hidden className="size-4" />
          New genre
        </Button>
      </div>

      {/* A failure must not read as "No genres yet": re-adding them all is refused. */}
      {isError && (
        <ErrorMessage>{errorMessage(fetchError, "Genres could not be loaded.")}</ErrorMessage>
      )}

      {isLoading && <RowSkeletons />}

      {!isLoading && !isError && genres.length === 0 && (
        <EmptyState
          icon={<Tags className="size-12" />}
          title="No genres yet"
          description="Add one here and it becomes a filter on browse and a choice in the song editor."
        />
      )}

      <ul className="space-y-2">
        {genres.map((genre) => (
          <li key={genre.id} className={genreRowChrome}>
            <div className="min-w-0">
              <p className="truncate font-medium">{genre.name}</p>
              <p className="mt-0.5 text-xs text-fg-muted">
                {songCount(genre.song_count ?? 0)} · {genre.slug}
              </p>
            </div>

            {/* Labeled with the genre, which the visible text leaves out. */}
            <div className="flex shrink-0 items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Rename ${genre.name}`}
                onClick={() => openSheet({ kind: "rename", genre })}
              >
                <Pencil aria-hidden className="size-4" />
                <span className={actionLabel}>Rename</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Delete ${genre.name}`}
                onClick={() => openSheet({ kind: "delete", genre })}
              >
                <Trash aria-hidden className="size-4 text-fg-danger" />
                <span className={actionLabel}>Delete</span>
              </Button>
            </div>
          </li>
        ))}
      </ul>

      {nameForm && (
        <Sheet open onClose={closeSheet} title={nameForm.title}>
          <form onSubmit={onSubmitName} className="space-y-4">
            {failure && <ErrorMessage>{failure.message}</ErrorMessage>}
            <Field label="Name" htmlFor="genre-name" error={failure?.field} hint={nameForm.hint}>
              <Input
                id="genre-name"
                required
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={nameForm.placeholder}
              />
            </Field>
            <Button
              type="submit"
              className="w-full"
              loading={sheet?.kind === "rename" ? updateGenre.isPending : createGenre.isPending}
            >
              {nameForm.submit}
            </Button>
          </form>
        </Sheet>
      )}

      {sheet?.kind === "delete" && (
        <ConfirmSheet
          open
          onClose={closeSheet}
          title="Delete this genre?"
          pending={deleteGenre.isPending}
          error={failure?.message}
          onConfirm={() =>
            void attempt(
              () => deleteGenre.mutateAsync(sheet.genre.id),
              "The genre could not be deleted.",
            )
          }
        >
          {/* The count is the point: nothing else says how many songs lose it. */}“
          {sheet.genre.name}” will be removed, and {songCount(sheet.genre.song_count ?? 0)} will
          lose this label. The songs themselves are not deleted.
        </ConfirmSheet>
      )}
    </>
  );
}
