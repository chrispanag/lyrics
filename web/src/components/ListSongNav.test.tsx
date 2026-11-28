import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ListPaging } from "./ListSongNav";
import type { ListPosition } from "@/lib/listContext";
import { type NavigationBackend, NavigationProvider } from "@/lib/navigation";
import { recordingBackend } from "@/test/backend";

/*
 * What a list position loads ahead of a step, seen through a backend that
 * records it. The history the steps keep is pinned in SongDetailPage.test.tsx.
 */

const atSong = { pathname: "/songs/b", search: "list=l" };

const position: ListPosition = {
  listName: "Summer",
  listHref: "/lists/l",
  index: 1,
  total: 3,
  previousHref: "/songs/a?list=l",
  nextHref: "/songs/c?list=l",
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
    renderPaging(backend, { ...position, index: 2, nextHref: undefined });

    expect(backend.prefetch).toHaveBeenCalledTimes(1);
    expect(backend.prefetch).toHaveBeenCalledWith("/songs/a?list=l");
  });
});
