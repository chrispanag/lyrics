import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ListPaging } from "./ListSongNav";
import type { ListPosition } from "@/lib/listContext";
import { type NavigationBackend, NavigationProvider } from "@/lib/navigation";
import { recordingBackend } from "@/test/backend";
import { makeSong } from "@/test/handlers";

/*
 * What a list position loads ahead of a step, seen through a backend that
 * records it. The history the steps keep is pinned in SongDetailPage.test.tsx.
 */

const atSong = { pathname: "/songs/b", search: "list=l" };

const position: ListPosition = {
  listName: "Summer",
  index: 1,
  total: 3,
  previous: { href: "/songs/a?list=l", song: makeSong({ id: "a", slug: "a" }) },
  next: { href: "/songs/c?list=l", song: makeSong({ id: "c", slug: "c" }) },
};

function renderPaging(backend: NavigationBackend, at: ListPosition) {
  return render(
    <NavigationProvider backend={backend}>
      <ListPaging position={at} surface={{ current: null }} />
    </NavigationProvider>,
  );
}

describe("ListPaging", () => {
  it("loads both neighbors, and nothing else, as soon as it knows where it is", () => {
    const backend = recordingBackend(atSong);
    renderPaging(backend, position);

    // `?list=` included: a step is answered only from an entry for its own href.
    expect(backend.prefetch.mock.calls.map(([href]) => href).sort()).toEqual([
      "/songs/a?list=l",
      "/songs/c?list=l",
    ]);
  });

  it("loads only the neighbor there is at the end of a list", () => {
    const backend = recordingBackend(atSong);
    renderPaging(backend, { ...position, index: 2, next: undefined });

    expect(backend.prefetch).toHaveBeenCalledTimes(1);
    expect(backend.prefetch).toHaveBeenCalledWith("/songs/a?list=l");
  });
});
