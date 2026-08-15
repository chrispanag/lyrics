import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Globe, ListMusic, Lock, Plus, Trash2 } from "lucide-react";

import { errorMessage } from "@/api/client";
import { useCreateList, useDeleteList, useList, useLists, useUpdateList } from "@/api/hooks";
import { useAuth } from "@/auth/useAuth";
import { SongCard } from "@/components/SongCard";
import { Button, EmptyState, ErrorMessage, Field, Input, Sheet, Skeleton } from "@/components/ui";
import { BackButton } from "@/components/BackButton";
import { songCount } from "@/lib/format";

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
              className="flex items-center justify-between gap-3 rounded-2xl border border-stone-200 bg-white p-4 transition-colors hover:border-brand-300 dark:border-stone-800 dark:bg-stone-900"
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
  const { user } = useAuth();

  const { data: list, isLoading, isError } = useList(id);
  const updateList = useUpdateList(id ?? "");
  const deleteList = useDeleteList();

  const [confirmDelete, setConfirmDelete] = useState(false);

  if (isLoading) {
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

        {isOwner && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
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
      {(list.songs?.length ?? 0) === 0 ? (
        <EmptyState
          icon={<ListMusic className="size-12" />}
          title="This list is empty"
          description={isOwner ? "Open a song and use Save to add it here." : undefined}
        />
      ) : (
        <ul className="space-y-3">
          {list.songs?.map((song) => (
            <li key={song.id}>
              <SongCard song={song} />
            </li>
          ))}
        </ul>
      )}

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
