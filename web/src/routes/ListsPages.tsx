import { lazy, Suspense, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { Copy, Globe, Link2, ListMusic, Lock, Plus, Share2, Trash2 } from "lucide-react";

import { ApiError, errorMessage } from "@/api/client";
import {
  useCopyList,
  useCreateList,
  useDeleteList,
  useList,
  useLists,
  useRemoveSongFromList,
  useReorderList,
  useUpdateList,
} from "@/api/hooks";
import { useAuth } from "@/auth/useAuth";
import { cardChrome } from "@/components/cardStyles";
import { SongRow } from "@/components/SongRow";
import { Button, EmptyState, ErrorMessage, Field, Input, Sheet, Skeleton } from "@/components/ui";
import { BackButton } from "@/components/BackButton";
import { cn } from "@/lib/cn";
import { songCount } from "@/lib/format";
import type { Song } from "@/lib/types";

// Drag-and-drop machinery is worth its weight only to someone who can reorder,
// which is the list's owner and nobody else. Everyone else reads the same songs
// without it, so it loads on demand rather than in the page's own chunk.
const SortableSongList = lazy(() =>
  import("@/components/SortableSongList").then((m) => ({ default: m.SortableSongList })),
);

/**
 * The list without its drag machinery: how a reader sees it, and how an owner
 * sees a list of one — where there is nothing to reorder but still something to
 * remove. Hence `onRemove` is optional here and required on the sortable list;
 * omitted, the rows are read-only.
 */
function StaticSongList({
  songs,
  listId,
  onRemove,
  pendingRemoval,
}: {
  songs: Song[];
  listId: string;
  onRemove?: (songId: string) => void;
  pendingRemoval?: string;
}) {
  return (
    <ul className="space-y-3">
      {songs.map((song) => (
        <li key={song.id}>
          <SongRow
            song={song}
            listId={listId}
            onRemove={onRemove}
            pendingRemoval={pendingRemoval}
          />
        </li>
      ))}
    </ul>
  );
}

export function ListsPage() {
  const { data, isLoading } = useLists(true);
  const createList = useCreateList();

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  const onCreate = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    try {
      await createList.mutateAsync({ name: name.trim() });
      setName("");
      setCreating(false);
    } catch (caught) {
      setError(errorMessage(caught, "The list could not be created."));
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Your lists</h1>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus aria-hidden className="size-4" />
          New list
        </Button>
      </div>

      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-20 w-full" />
          ))}
        </div>
      )}

      {!isLoading && data?.data.length === 0 && (
        <EmptyState
          icon={<ListMusic className="size-12" />}
          title="No lists yet"
          description="Create a list to collect the songs you want to come back to."
        />
      )}

      <ul className="space-y-3">
        {data?.data.map((list) => (
          <li key={list.id}>
            <Link
              to={`/lists/${list.id}`}
              className={cn(
                cardChrome,
                "flex items-center justify-between gap-3 bg-white p-4 transition-colors hover:border-brand-300 dark:bg-stone-900",
              )}
            >
              <div className="min-w-0">
                <h2 className="flex items-center gap-2 truncate font-semibold">
                  {list.name}
                  {list.is_public ? (
                    <Globe aria-label="Public" className="size-3.5 shrink-0 text-stone-400" />
                  ) : (
                    <Lock aria-label="Private" className="size-3.5 shrink-0 text-stone-400" />
                  )}
                </h2>
                <p className="mt-0.5 text-sm text-stone-500 dark:text-stone-400">
                  {songCount(list.item_count)}
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ul>

      <Sheet open={creating} onClose={() => setCreating(false)} title="New list">
        <form onSubmit={onCreate} className="space-y-4">
          {error && <ErrorMessage>{error}</ErrorMessage>}
          <Field label="Name" htmlFor="list-name">
            <Input
              id="list-name"
              required
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Rebetika favourites"
            />
          </Field>
          <Button type="submit" className="w-full" loading={createList.isPending}>
            Create list
          </Button>
        </form>
      </Sheet>
    </div>
  );
}

export function ListDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, loading: sessionLoading } = useAuth();

  // Held until the session is known: asked for a moment too early, a private
  // list reads as a guest request and comes back 404 to its own owner.
  const { data: list, isLoading, isError } = useList(id, !sessionLoading);
  const updateList = useUpdateList(id ?? "");
  const deleteList = useDeleteList();
  const copyList = useCopyList();
  const reorderList = useReorderList(id ?? "");
  const removeSong = useRemoveSongFromList(id ?? "");

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [linkState, setLinkState] = useState<"idle" | "copied" | "failed">("idle");
  const [naming, setNaming] = useState(false);
  const [copyName, setCopyName] = useState("");
  const [copyError, setCopyError] = useState("");

  // A disabled query is not "loading" as far as React Query is concerned, so the
  // wait for the session has to be spelled out here — otherwise the page falls
  // straight through to its error state and reports a list it has yet to ask for
  // as unavailable.
  if (sessionLoading || isLoading) {
    return (
      <div className="mx-auto max-w-2xl space-y-3 px-4 py-6">
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (isError || !list) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-6">
        <ErrorMessage>This list is not available.</ErrorMessage>
        <Link to="/lists" className="mt-4 inline-block text-sm text-brand-600 hover:underline">
          Back to lists
        </Link>
      </div>
    );
  }

  const isOwner = user?.id === list.owner_id;
  const songs = list.songs ?? [];
  const removeFromList = (songId: string) => removeSong.mutate(songId);
  // Undefined for a reader, which is what leaves their rows read-only.
  const onRemove = isOwner ? removeFromList : undefined;
  // `variables` outlives the request it belongs to, so the row it names would
  // stay disabled after the removal settled were this not held to the flight.
  const pendingRemoval = removeSong.isPending ? removeSong.variables : undefined;
  // Built from the origin rather than read off window.location, so the link is
  // the canonical one whatever query or hash the current URL carries.
  const shareUrl = `${window.location.origin}/lists/${list.id}`;

  const copyLink = async () => {
    // Clipboard access needs a secure context and can be refused outright. The
    // link is on screen and selectable, so a refusal asks for a manual copy
    // rather than leaving a button that silently does nothing.
    try {
      await navigator.clipboard.writeText(shareUrl);
      setLinkState("copied");
    } catch {
      setLinkState("failed");
    }
  };

  const saveCopy = async (name?: string) => {
    setCopyError("");
    try {
      const copied = await copyList.mutateAsync({ id: list.id, name });
      setNaming(false);
      navigate(`/lists/${copied.id}`);
    } catch (caught) {
      // Names are unique per owner, so a second copy of the same list — or a
      // copy of one's own — is an ordinary outcome rather than a failure. It
      // opens the rename step instead of reporting an error nobody can act on.
      if (caught instanceof ApiError && caught.status === 409) {
        setCopyName(name ?? list.name);
        setNaming(true);
      }
      setCopyError(errorMessage(caught, "The list could not be copied."));
    }
  };

  const onSave = () => {
    if (!user) {
      // Same shape RequireAuth uses, and read from the router for the same
      // reason it gives: the route the visitor is on is the destination, and
      // rebuilding it from an id drifts the day the route gains a segment.
      navigate("/login", { state: { from: location.pathname } });
      return;
    }
    void saveCopy();
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-4">
      <BackButton className="mb-4" />

      <header className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight">{list.name}</h1>
        {list.description && (
          <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">{list.description}</p>
        )}
        <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
          {songCount(list.item_count)}
        </p>

        {/* A reader only ever reaches a list that is public, so the copy is
            offered unconditionally to everyone but its owner — guests included,
            who are sent to sign in and returned here. */}
        {!isOwner && (
          <div className="mt-4">
            <Button size="sm" onClick={onSave} loading={copyList.isPending}>
              <Copy aria-hidden className="size-4" />
              Save to my lists
            </Button>
            {copyError && !naming && (
              <div className="mt-3">
                <ErrorMessage>{copyError}</ErrorMessage>
              </div>
            )}
          </div>
        )}

        {isOwner && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setLinkState("idle");
                setSharing(true);
              }}
            >
              <Share2 aria-hidden className="size-4" />
              Share
            </Button>

            <Button
              variant="secondary"
              size="sm"
              onClick={() => updateList.mutate({ is_public: !list.is_public })}
              loading={updateList.isPending}
            >
              {list.is_public ? (
                <>
                  <Lock aria-hidden className="size-4" />
                  Make private
                </>
              ) : (
                <>
                  <Globe aria-hidden className="size-4" />
                  Make public
                </>
              )}
            </Button>

            {/* The default list is where one-tap saves land, so it has no
                delete affordance at all rather than a button that 403s. */}
            {!list.is_default && (
              <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>
                <Trash2 aria-hidden className="size-4 text-red-600" />
                Delete list
              </Button>
            )}
          </div>
        )}
      </header>

      {/* `songs` carries `omitempty` on the Go side, so an empty list arrives
          with the key absent rather than as []. `undefined === 0` is false, so
          the strict comparison rendered an empty <ul> instead of the empty
          state — exactly the case the empty state exists for. */}
      {songs.length === 0 ? (
        <EmptyState
          icon={<ListMusic className="size-12" />}
          title="This list is empty"
          description={isOwner ? "Open a song and use Save to add it here." : undefined}
        />
      ) : /* Only an owner can reorder, and a single song has nowhere to go, so
             everyone else is served the plain list and never downloads the drag
             library. It doubles as the fallback while that chunk loads, which
             keeps the songs on screen instead of blanking the page. */
      isOwner && songs.length > 1 ? (
        <Suspense
          fallback={
            <StaticSongList
              songs={songs}
              listId={list.id}
              onRemove={onRemove}
              pendingRemoval={pendingRemoval}
            />
          }
        >
          <SortableSongList
            songs={songs}
            listId={list.id}
            onReorder={(songIds) => reorderList.mutate(songIds)}
            // The unnarrowed callback: this branch is owner-only, and the
            // prop is required, so the optional `onRemove` would need an
            // assertion to be passed here.
            onRemove={removeFromList}
            pendingRemoval={pendingRemoval}
          />
        </Suspense>
      ) : (
        <StaticSongList
          songs={songs}
          listId={list.id}
          onRemove={onRemove}
          pendingRemoval={pendingRemoval}
        />
      )}

      {reorderList.isError && (
        <div className="mt-3">
          <ErrorMessage>The new order could not be saved.</ErrorMessage>
        </div>
      )}

      {removeSong.isError && (
        <div className="mt-3">
          <ErrorMessage>
            {errorMessage(removeSong.error, "The song could not be removed.")}
          </ErrorMessage>
        </div>
      )}

      <Sheet open={sharing} onClose={() => setSharing(false)} title="Share this list">
        {list.is_public ? (
          <div className="space-y-4">
            <p className="text-sm text-stone-600 dark:text-stone-400">
              Anyone with this link can read “{list.name}” and save their own copy of it. It is
              not listed anywhere in the catalog.
            </p>
            <Input
              readOnly
              aria-label="Link to this list"
              value={shareUrl}
              onFocus={(event) => event.target.select()}
            />
            {linkState === "failed" && (
              <ErrorMessage>Copying failed. Select the link above and copy it.</ErrorMessage>
            )}
            <Button className="w-full" onClick={() => void copyLink()}>
              <Link2 aria-hidden className="size-4" />
              {linkState === "copied" ? "Link copied" : "Copy link"}
            </Button>
          </div>
        ) : (
          /* Publishing is what makes the link work, so it is stated and asked
             for rather than done quietly behind a Share button. */
          <div className="space-y-4">
            <p className="text-sm text-stone-600 dark:text-stone-400">
              “{list.name}” is private. Publishing it lets anyone holding the link read it and
              save their own copy — the songs stay yours to change, and their copy is separate
              from this list.
            </p>
            <Button
              className="w-full"
              loading={updateList.isPending}
              onClick={() => updateList.mutate({ is_public: true })}
            >
              <Globe aria-hidden className="size-4" />
              Publish and get a link
            </Button>
          </div>
        )}
      </Sheet>

      <Sheet
        open={naming}
        onClose={() => {
          // The conflict that opened this sheet is resolved by abandoning it,
          // so its message goes too rather than lingering on the page behind.
          setNaming(false);
          setCopyError("");
        }}
        title="Name your copy"
      >
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void saveCopy(copyName.trim());
          }}
        >
          {copyError && <ErrorMessage>{copyError}</ErrorMessage>}
          <Field label="Name" htmlFor="copy-name">
            <Input
              id="copy-name"
              required
              autoFocus
              value={copyName}
              onChange={(event) => setCopyName(event.target.value)}
            />
          </Field>
          <Button type="submit" className="w-full" loading={copyList.isPending}>
            Save to my lists
          </Button>
        </form>
      </Sheet>

      <Sheet open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete this list?">
        <p className="text-sm text-stone-600 dark:text-stone-400">
          “{list.name}” will be removed. The songs themselves are not affected.
        </p>
        <div className="mt-5 flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={() => setConfirmDelete(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            className="flex-1"
            loading={deleteList.isPending}
            onClick={() =>
              deleteList.mutate(list.id, { onSuccess: () => navigate("/lists", { replace: true }) })
            }
          >
            Delete
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
