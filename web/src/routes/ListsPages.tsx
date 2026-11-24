"use client";

import { lazy, memo, Suspense, useState, useSyncExternalStore, type SubmitEvent } from "react";
import {
  ChevronRight,
  Copy,
  Globe,
  Link2,
  ListMusic,
  Lock,
  Plus,
  Share2,
  Trash,
} from "lucide-react";

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
import { useSignInHref } from "@/auth/returnTo";
import { useAuth } from "@/auth/useAuth";
import { paneActionLabel } from "@/components/buttonStyles";
import { cardChrome, cardHover, rowDividers, tagChrome } from "@/components/cardStyles";
import { ListBar, ListSkeleton } from "@/components/ListBar";
import { MenuItem, MoreActionsMenu } from "@/components/MoreActionsMenu";
import { PageHeader } from "@/components/PageHeader";
import { PageTitle } from "@/components/PageTitle";
import { Page } from "@/components/Page";
import { PaneHeading, ReaderPane } from "@/components/ReaderSplit";
import { SongRow } from "@/components/SongRow";
import {
  Button,
  ConfirmSheet,
  EmptyState,
  ErrorMessage,
  Field,
  Input,
  Sheet,
  Skeletons,
} from "@/components/ui";
import { useCatalogPaneShown } from "@/lib/catalogPane";
import { cn } from "@/lib/cn";
import { songCount } from "@/lib/format";
import { listHref, listInView, songHref, songRefFromPath, songRefHref } from "@/lib/listContext";
import type { Song } from "@/lib/types";
import { Link, usePathname, useRouter, useSearchParams } from "@/lib/navigation";

// Only an owner can reorder, so the drag machinery loads on demand.
const SortableSongList = lazy(() =>
  import("@/components/SortableSongList").then((m) => ({ default: m.SortableSongList })),
);

/**
 * The list without drag machinery, for readers and for an owner's list of one.
 * Without `onRemove` the rows are read-only.
 *
 * Memoized, as `SortableSongList` is: beside a song the list re-renders on
 * every step through it, and only the cards themselves follow the open song.
 */
const StaticSongList = memo(function StaticSongList({
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
    <ul className={rowDividers}>
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
});

/** Whether anyone but the owner can read a list, said in words and not only an icon. */
function VisibilityTag({ isPublic }: { isPublic: boolean }) {
  const Icon = isPublic ? Globe : Lock;
  return (
    <span className={cn(tagChrome, "inline-flex shrink-0 items-center gap-1")}>
      <Icon aria-hidden className="size-3" />
      {isPublic ? "Public" : "Private"}
    </span>
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
    <Page width="content">
      <PageTitle name="Your lists" />
      <PageHeader
        title="Your lists"
        className="mb-6"
        actions={
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus aria-hidden className="size-4" />
            New list
          </Button>
        }
      />

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
              href={listHref(list.id)}
              className={cn(cardChrome, cardHover, "group flex items-center gap-3 bg-surface p-4")}
            >
              <span
                aria-hidden
                // Swaps to the surface under the pointer, where the card takes
                // the tile's own tint and would swallow it.
                className="flex size-11 shrink-0 items-center justify-center rounded-control bg-accent-subtle text-fg-accent-subtle transition-colors group-hover:bg-surface"
              >
                <ListMusic className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="truncate font-semibold">{list.name}</h2>
                <p className="mt-0.5 truncate text-sm text-fg-muted">
                  <span>{songCount(list.item_count)}</span>
                  {list.description && <span> · {list.description}</span>}
                </p>
              </div>
              <VisibilityTag isPublic={list.is_public} />
              <ChevronRight aria-hidden className="size-4 shrink-0 text-fg-subtle" />
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
    </Page>
  );
}

function subscribeToNothing() {
  return () => {};
}

/**
 * A list: on its own page, and beside a song read from it, where it is the
 * list the reader steps through, with the open song marked. Which list is the
 * address's to say (`listInView`).
 */
export function ListDetailPage() {
  const pathname = usePathname();
  const id = listInView(pathname, useSearchParams()) ?? undefined;
  // The song open beside the list, if any: copying or deleting the list must
  // not close it.
  const openSong = songRefFromPath(pathname);
  const shown = useCatalogPaneShown();
  const router = useRouter();
  const signIn = useSignInHref();
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

  // Stable, so the memoized rows are not re-rendered by each step through the
  // list beside a song: a mutation's `mutate` keeps its identity.
  const { mutate: onReorder } = reorderList;
  const { mutate: removeFromList } = removeSong;

  // Hidden beside a song on a phone, the list is not built until it shows.
  // A disabled query is not `isLoading`, so the session wait is spelled out, or
  // the page reports a list it has not asked for yet as unavailable. A list
  // already in hand (the server's read of a public one) renders at once: the
  // wait only exists so a private list is asked for with its owner's token.
  if (!shown || (!list && (sessionLoading || isLoading))) return <ListSkeleton />;

  if (isError || !list) {
    return (
      <ReaderPane header={<ListBar />} title="List not available">
        <ErrorMessage>This list is not available.</ErrorMessage>
        <Link href="/lists" className="mt-4 inline-block text-sm text-fg-accent hover:underline">
          Back to lists
        </Link>
      </ReaderPane>
    );
  }

  const isOwner = user?.id === list.owner_id;
  const songs = list.songs ?? [];
  // Undefined for a reader, which is what leaves their rows read-only.
  const onRemove = isOwner ? removeFromList : undefined;
  // `variables` outlives its request, so it is held to the flight.
  const pendingRemoval = removeSong.isPending ? removeSong.variables : undefined;
  // The toggle offers the other state, under that state's icon.
  const [VisibilityIcon, visibilityAction] = list.is_public
    ? [Lock, "Make private"]
    : [Globe, "Make public"];
  // From the origin, so no query or hash leaks into the shared link.
  const shareUrl = `${origin}${listHref(list.id)}`;

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
      // Beside a song, the reader goes on reading it, now from their copy.
      router.push(openSong ? songHref({ slug: openSong }, copied.id) : listHref(copied.id));
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
      router.push(signIn);
      return;
    }
    void saveCopy();
  };

  const actions = (
    <>
      {/* A non-owner only reaches a public list; guests are sent to sign in.
            Inert until the session is known: a server-rendered list is on screen
            before then, and `!user` would send a signed-in reader to sign in. */}
      {!isOwner && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onSave}
          loading={copyList.isPending}
          disabled={sessionLoading}
        >
          <Copy aria-hidden className="size-4" />
          {/* Shown on a phone too: a reader's one action, and a copy icon
                alone reads as "copy link". */}
          Save to my lists
        </Button>
      )}

      {isOwner && (
        <>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setLinkState("idle");
              setSharing(true);
            }}
          >
            <Share2 aria-hidden className="size-4" />
            <span className={paneActionLabel}>Share</span>
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => updateList.mutate({ is_public: !list.is_public })}
            loading={updateList.isPending}
          >
            <VisibilityIcon aria-hidden className="size-4" />
            {/* Shown on a phone too: its icon is the state it switches to,
                  beside a tag showing the state it is in. */}
            {visibilityAction}
          </Button>

          <MoreActionsMenu>
            {/* The default list cannot be deleted (the server 403s). With
                nothing else in the menu, it then shows no menu at all. */}
            {!list.is_default && (
              <MenuItem icon={Trash} danger onSelect={() => setConfirmDelete(true)}>
                Delete list
              </MenuItem>
            )}
          </MoreActionsMenu>
        </>
      )}
    </>
  );

  return (
    <ReaderPane header={<ListBar actions={actions} />} title={list.name}>
      {/* Not a <header>: the bar above is the pane's banner. */}
      <div className="mb-6">
        <PaneHeading className="text-3xl font-bold leading-tight tracking-tight text-balance @3xl/app:text-2xl">
          {list.name}
        </PaneHeading>
        {list.description && <p className="mt-1 text-lg text-fg-muted">{list.description}</p>}
        <div className="mt-3 flex items-center gap-2">
          <p className="text-sm text-fg-muted">{songCount(list.item_count)}</p>
          <VisibilityTag isPublic={list.is_public} />
        </div>

        {copyError && !naming && (
          <div className="mt-4">
            <ErrorMessage>{copyError}</ErrorMessage>
          </div>
        )}
      </div>

      {/* `songs` is `omitempty` in Go, hence the `?? []` above. */}
      {songs.length === 0 ? (
        <EmptyState
          icon={<ListMusic className="size-12" />}
          title="This list is empty"
          description={isOwner ? "Open a song and use Add to list to put it here." : undefined}
        />
      ) : /* Sortable only for an owner with two or more songs. The static list
             is the fallback while that chunk loads, and the pane builds no rows
             until it shows (above), so a hidden list loads no drag machinery
             and the rows are swapped once, for the sortable ones, not built
             again when the pane first shows. */
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
            onReorder={onReorder}
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
            <p className="text-sm text-fg-tertiary">
              Anyone with this link can read “{list.name}” and save their own copy of it, and it can
              show up in search engines.
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
            <p className="text-sm text-fg-tertiary">
              “{list.name}” is private. Publishing it lets anyone holding the link read it and save
              their own copy, and lets search engines find it — the songs stay yours to change, and
              their copy is separate from this list.
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
          deleteList.mutate(list.id, {
            // Beside a song, the song stays, read from the catalog now.
            onSuccess: () => router.replace(openSong ? songRefHref(openSong) : "/lists"),
          })
        }
      >
        “{list.name}” will be removed. The songs themselves are not affected.
      </ConfirmSheet>
    </ReaderPane>
  );
}
