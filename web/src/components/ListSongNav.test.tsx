import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ListSongNavBar } from "./ListSongNav";
import type { ListPosition } from "@/lib/listContext";
import { type NavigationBackend, NavigationProvider } from "@/lib/navigation";

/*
 * What a list position loads ahead of a step. The test router's `prefetch`
 * does nothing, so a backend that records it is what can see it. The history
 * the steps keep is pinned in SongDetailPage.test.tsx.
 */

function recordingBackend() {
  return {
    pathname: "/songs/b",
    searchParams: new URLSearchParams("list=l"),
    params: {},
    push: () => {},
    replace: () => {},
    back: () => {},
    writeSearch: () => {},
    prefetch: vi.fn<(href: string) => void>(),
    Link: ({ href, replace: _replace, ...rest }) => <a href={href} {...rest} />,
  } satisfies NavigationBackend;
}

const position: ListPosition = {
  listName: "Summer",
  listHref: "/lists/l",
  index: 1,
  total: 3,
  previousHref: "/songs/a?list=l",
  nextHref: "/songs/c?list=l",
};

function renderBar(backend: NavigationBackend, at: ListPosition) {
  return render(
    <NavigationProvider backend={backend}>
      <ListSongNavBar position={at} />
    </NavigationProvider>,
  );
}

describe("ListSongNavBar", () => {
  it("loads both neighbors, and nothing else, as soon as it knows where it is", () => {
    const backend = recordingBackend();
    renderBar(backend, position);

    // `?list=` included: a step is answered only from an entry for its own href.
    expect(backend.prefetch.mock.calls.map(([href]) => href).sort()).toEqual([
      "/songs/a?list=l",
      "/songs/c?list=l",
    ]);
  });

  it("loads only the neighbor there is at the end of a list", () => {
    const backend = recordingBackend();
    renderBar(backend, { ...position, index: 2, nextHref: undefined });

    expect(backend.prefetch).toHaveBeenCalledTimes(1);
    expect(backend.prefetch).toHaveBeenCalledWith("/songs/a?list=l");
  });
});
