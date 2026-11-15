import { lazy, Suspense, useState, useSyncExternalStore, type SubmitEvent } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { Copy, Globe, Link2, ListMusic, Lock, Plus, Share2, Trash } from "lucide-react";

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
import { returnTo } from "@/auth/returnTo";
import { useAuth } from "@/auth/useAuth";
import { cardChrome, cardHover } from "@/components/cardStyles";
import { PageTitle } from "@/components/PageTitle";
import { SongRow } from "@/components/SongRow";
import {
  Button,
  ConfirmSheet,
  EmptyState,
  ErrorMessage,
  Field,
  Input,
  Sheet,
  Skeleton,
  Skeletons,
} from "@/components/ui";
import { BackButton } from "@/components/BackButton";
import { cn } from "@/lib/cn";
import { songCount } from "@/lib/format";
import type { Song } from "@/lib/types";
import { useNavigate } from "@/lib/navigation";

// Only an owner can reorder, so the drag machinery loads on demand.
const SortableSongList = lazy(() =>
  import("@/components/SortableSongList").then((m) => ({ default: m.SortableSongList })),
);

/**
 * The list without drag machinery, for readers and for an owner's list of one.
 * Without `onRemove` the rows are read-only.
 */
function StaticSongList({
  songs,
  listId,
  onRemove,
  pendingRemoval,
}: {
  songs: Song[];
  listId: string;
  onRemove?: ((songId: string) => void) | undefined;
  pendingRemoval?: string | undefined;
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
  const { data, isLoading, isError, error: loadError } = useLists(true);
  const createList = useCreateList();

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  const onCreate = async (event: SubmitEvent<HTMLFormElement>) => {
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
      <PageTitle name="Your lists" />
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Your lists</h1>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus aria-hidden className="size-4" />
          New list
        </Button>
      </div>

      {isLoading && <Skeletons count={3} className="h-20 w-full" />}

      {/* A failed refetch keeps the lists in hand and says nothing. */}
      {isError && !data && (
        <ErrorMessage>{errorMessage(loadError, "Your lists could not be loaded.")}</ErrorMessage>
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
                cardHover,
                "flex items-center justify-between gap-3 bg-white p-4 dark:bg-stone-900",
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

function subscribeToNothing() {
  return () => {};
}

export function ListDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, loading: sessionLoading } = useAuth();

  // Waiting on the session is redundant now that auth/session registers the
  // token provider at import time, but harmless; see CLAUDE.md "Frontend".
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
  // A server render has no `window`: its snapshot is "" and the browser's
  // answer follows on hydration. The origin never changes, so there is
  // nothing to subscribe to.
  const origin = useSyncExternalStore(
    subscribeToNothing,
    () => window.location.origin,
    () => "",
  );

  // A disabled query is not `isLoading`, so the session wait is spelled out, or
  // the page reports a list it has not asked for yet as unavailable.
  if (sessionLoading || isLoading) {
    return (
      <div className="mx-auto max-w-2xl space-y-3 px-4 py-6">
        {/* Nameless while in flight, rather than "undefined — Songfolio". */}
        <PageTitle />
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (isError || !list) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-6">
        <PageTitle name="List not available" />
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
  // `variables` outlives its request, so it is held to the flight.
  const pendingRemoval = removeSong.isPending ? removeSong.variables : undefined;
  // From the origin, so no query or hash leaks into the shared link.
  const shareUrl = `${origin}/lists/${list.id}`;

  const copyLink = async () => {
    // Clipboard access can be refused; then the page asks for a manual copy.
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
      // Names are unique per owner, so a 409 opens the rename step.
      if (caught instanceof ApiError && caught.status === 409) {
        setCopyName(name ?? list.name);
        setNaming(true);
      }
      setCopyError(errorMessage(caught, "The list could not be copied."));
    }
  };

  const onSave = () => {
    if (!user) {
      navigate("/login", { state: returnTo(location) });
      return;
    }
    void saveCopy();
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-4">
      <PageTitle name={list.name} />
      <BackButton className="mb-4" />

      <header className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight">{list.name}</h1>
        {list.description && (
          <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">{list.description}</p>
        )}
        <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
          {songCount(list.item_count)}
        </p>

        {/* A non-owner only reaches a public list; guests are sent to sign in. */}
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

            {/* The default list cannot be deleted (the server 403s). */}
            {!list.is_default && (
              <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>
                <Trash aria-hidden className="size-4 text-red-600" />
                Delete list
              </Button>
            )}
          </div>
        )}
      </header>

      {/* `songs` is `omitempty` in Go, hence the `?? []` above. */}
      {songs.length === 0 ? (
        <EmptyState
          icon={<ListMusic className="size-12" />}
          title="This list is empty"
          description={isOwner ? "Open a song and use Save to add it here." : undefined}
        />
      ) : /* Sortable only for an owner with two or more songs; the static list
             is also the fallback while that chunk loads. */
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
            // Owner-only branch, and the prop is required: pass the unnarrowed one.
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
              Anyone with this link can read “{list.name}” and save their own copy of it. It is not
              listed anywhere in the catalog.
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
          /* Publishing is asked for, never done quietly behind Share. */
          <div className="space-y-4">
            <p className="text-sm text-stone-600 dark:text-stone-400">
              “{list.name}” is private. Publishing it lets anyone holding the link read it and save
              their own copy — the songs stay yours to change, and their copy is separate from this
              list.
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
          // Abandoning the rename drops the conflict message too.
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

      <ConfirmSheet
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this list?"
        pending={deleteList.isPending}
        onConfirm={() =>
          deleteList.mutate(list.id, { onSuccess: () => navigate("/lists", { replace: true }) })
        }
      >
        “{list.name}” will be removed. The songs themselves are not affected.
      </ConfirmSheet>
    </div>
  );
}
