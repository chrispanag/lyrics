import { useState, type FormEvent } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { Pencil, Plus, Tags, Trash2 } from "lucide-react";

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
import { buttonClasses } from "@/components/buttonStyles";
import { cardChrome } from "@/components/cardStyles";
import { PageTitle } from "@/components/PageTitle";
import {
  Button,
  ConfirmSheet,
  EmptyState,
  ErrorMessage,
  Field,
  Input,
  Select,
  Sheet,
  Skeleton,
} from "@/components/ui";
import { ADMIN_TABS } from "@/routes/adminTabs";
import { cn } from "@/lib/cn";
import { songCount } from "@/lib/format";
import { useDebounced } from "@/lib/useDebounced";
import { ROLES, type Genre, type Role } from "@/lib/types";

const ROLE_DESCRIPTIONS: Record<Role, string> = {
  user: "Can browse and build lists",
  contributor: "Can also add songs and edit their own",
  admin: "Full access, including deleting anything",
};

/**
 * The row both consoles list their records in.
 *
 * Stated once because the two screens sit behind the same tabs and so have to
 * look alike: typed twice, the next padding or dark-mode change lands on one of
 * them and nothing says the other has drifted — which is the failure
 * `cardStyles` itself exists to stop.
 */
const adminRowChrome = cn(
  cardChrome,
  "flex flex-col gap-3 bg-white p-4 sm:flex-row sm:items-center sm:justify-between dark:bg-stone-900",
);

/** The wait both screens show: rows the height of the cards they become. */
function RowSkeletons() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 5 }, (_, index) => (
        <Skeleton key={index} className="h-16 w-full" />
      ))}
    </div>
  );
}

/**
 * The console's shell: the container, the heading, and the way between screens.
 *
 * This is the element of the `/admin` layout route, which is what lets
 * `RequireAdmin` wrap the section once instead of every screen in it — a screen
 * added below it is admin-only by position rather than by someone remembering
 * the wrapper. The heading is read from the tab that matches the address, so a
 * screen's name is written in one place rather than in the route, the tab, and
 * a title prop.
 *
 * The console gets a single entry in the app's navigation — the phone's tab bar
 * is a row of equal shares and a fifth would crowd it — so moving between these
 * screens is something the console itself has to offer.
 */
export function AdminConsole() {
  const { pathname } = useLocation();
  // Matched by segment, not by characters: `startsWith` would hand a future
  // `/admin/users-archive` the heading "Users" while the NavLink beside it,
  // which matches segments, correctly stayed dark.
  const current = ADMIN_TABS.find(
    (tab) => pathname === tab.to || pathname.startsWith(`${tab.to}/`),
  );

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      {/* Named here for the same reason the heading is: the tab that matches
          the address is the one place a screen's name is written, so a screen
          added to ADMIN_TABS is titled without touching this file. */}
      <PageTitle name={current ? `Admin · ${current.label}` : "Admin"} />
      {current && <h1 className="text-2xl font-bold tracking-tight">{current.label}</h1>}

      <nav aria-label="Admin" className="my-5 flex gap-2">
        {ADMIN_TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) => buttonClasses(isActive ? "primary" : "ghost", "md")}
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>

      <Outlet />
    </div>
  );
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
          className="flex-1"
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

      {error && <ErrorMessage>{error}</ErrorMessage>}
      {/* Said, rather than shown as an empty result: "No users matched." for a
          request that failed sends an admin looking for an account away
          believing it does not exist. */}
      {isError && (
        <ErrorMessage>{errorMessage(fetchError, "Users could not be loaded.")}</ErrorMessage>
      )}

      {isLoading && <RowSkeletons />}

      <ul className="space-y-2">
        {data?.data.map((row) => (
          <li key={row.id} className={adminRowChrome}>
            {/* The picture belongs to the name, so the two travel together:
                the row itself is a stack on a phone and spreads its children to
                its edges from `sm` up, which would put the two halves of one
                identity at opposite ends of it. */}
            <div className="flex min-w-0 items-center gap-3">
              <Avatar user={row} size="md" />
              <div className="min-w-0">
                <p className="truncate font-medium">{row.display_name ?? row.email}</p>
                {row.display_name && (
                  <p className="truncate text-sm text-stone-500 dark:text-stone-400">{row.email}</p>
                )}
                <p className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">
                  {ROLE_DESCRIPTIONS[row.role]}
                </p>
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
        <p className="py-10 text-center text-sm text-stone-500">No users matched.</p>
      )}
    </>
  );
}

/**
 * Which sheet is up, and what it is about.
 *
 * One value rather than three flags, which is what makes two open sheets
 * impossible to reach rather than merely unlikely — and what lets the subject
 * of a rename or a delete travel with the sheet instead of in a state slot of
 * its own that has to be cleared in step with it.
 */
type GenreSheet =
  | { kind: "create" }
  | { kind: "rename"; genre: Genre }
  | { kind: "delete"; genre: Genre };

/**
 * The two ways the name form is used.
 *
 * A table rather than two near-identical sheets: the wording is the whole of
 * the difference between them, and side by side it can be compared. Only one is
 * ever on the page — `Sheet` renders nothing while closed — which is why the
 * field below carries a single id.
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
 * Where genres come from.
 *
 * The song editor offers the genres that exist and nothing more, so until this
 * screen there was no way to add one at all — the catalog was stuck with
 * whatever the seed and the import had created. Naming a genre is the whole of
 * it: the slug the filter URLs are built from is derived server-side, and a
 * rename deliberately leaves it alone so a shared link keeps working.
 */
export function AdminGenresPage() {
  const { data, isLoading, isError, error: fetchError } = useGenres();
  const createGenre = useCreateGenre();
  const updateGenre = useUpdateGenre();
  const deleteGenre = useDeleteGenre();

  const [sheet, setSheet] = useState<GenreSheet | null>(null);
  const [name, setName] = useState("");
  const [failure, setFailure] = useState<Failure | null>(null);

  // Opening a sheet drops what the last attempt said — otherwise a rename opens
  // under the message a failed creation left behind. Only a rename starts with
  // a name in the field, since it is the one editing a name that exists.
  const openSheet = (next: GenreSheet) => {
    setFailure(null);
    setName(next.kind === "rename" ? next.genre.name : "");
    setSheet(next);
  };

  /**
   * Runs one of the three writes.
   *
   * A success closes the sheet; a failure leaves it open holding the reason,
   * with the name still in the field — so a refusal the server can explain, a
   * name already taken above all, is corrected rather than retyped. The message
   * is read the way the song editor reads one: a sentence for the attempt, and
   * whatever the server said about the field under the field.
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

  const onSubmitName = (event: FormEvent) => {
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
  // The delete sheet is a confirmation rather than a form, so the name form
  // answers to the other two kinds.
  const nameForm = sheet && sheet.kind !== "delete" ? NAME_FORMS[sheet.kind] : null;

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button size="sm" onClick={() => openSheet({ kind: "create" })}>
          <Plus aria-hidden className="size-4" />
          New genre
        </Button>
      </div>

      {/* A failed fetch must not read as an empty catalog: told there are no
          genres, an admin adds the ones that already exist — and every one of
          those is then refused as a duplicate slug, which explains nothing. */}
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
          <li key={genre.id} className={adminRowChrome}>
            <div className="min-w-0">
              <p className="truncate font-medium">{genre.name}</p>
              <p className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">
                {songCount(genre.song_count ?? 0)} · {genre.slug}
              </p>
            </div>

            <div className="flex shrink-0 gap-2">
              <Button
                variant="secondary"
                size="sm"
                aria-label={`Rename ${genre.name}`}
                onClick={() => openSheet({ kind: "rename", genre })}
              >
                <Pencil aria-hidden className="size-4" />
                Rename
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Delete ${genre.name}`}
                onClick={() => openSheet({ kind: "delete", genre })}
              >
                <Trash2 aria-hidden className="size-4 text-red-600" />
                Delete
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
                // `Field` renders one or the other under this input and says
                // outright that the control has to point at it; unpointed,
                // neither the hint nor a refusal is read out with the field.
                aria-describedby={failure?.field ? "genre-name-error" : "genre-name-hint"}
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
          {/* The count is the point of this sheet: deleting a genre takes it off
              every song that carries it, and nothing else says how many. */}“
          {sheet.genre.name}” will be removed, and {songCount(sheet.genre.song_count ?? 0)} will
          lose this label. The songs themselves are not deleted.
        </ConfirmSheet>
      )}
    </>
  );
}
