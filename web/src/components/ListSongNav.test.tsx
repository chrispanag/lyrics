import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ListSongNavBar } from "./ListSongNav";
import type { ListPosition } from "@/lib/listContext";
import {
  type BackendLinkProps,
  type NavigationBackend,
  NavigationProvider,
} from "@/lib/navigation";

/*
 * Which of the bar's links ask to be loaded ahead of a press. The test router
 * ignores the hint, so a backend that writes it onto the anchor is what can
 * see it. The steps are the ones that must paint at once; the history they
 * keep is pinned in SongDetailPage.test.tsx.
 */

function RecordingLink({ href, replace, prefetch, ...rest }: BackendLinkProps) {
  return (
    <a href={href} data-replace={replace} data-prefetch={String(Boolean(prefetch))} {...rest} />
  );
}

const backend: NavigationBackend = {
  pathname: "/songs/b",
  searchParams: new URLSearchParams("list=l"),
  params: {},
  push: () => {},
  replace: () => {},
  back: () => {},
  writeSearch: () => {},
  Link: RecordingLink,
};

const position: ListPosition = {
  listName: "Summer",
  listHref: "/lists/l",
  index: 1,
  total: 3,
  previousHref: "/songs/a?list=l",
  nextHref: "/songs/c?list=l",
};

describe("ListSongNavBar", () => {
  it("loads both neighbors ahead of a step, and not the list it leads back to", () => {
    render(
      <NavigationProvider backend={backend}>
        <ListSongNavBar position={position} />
      </NavigationProvider>,
    );

    for (const name of ["Previous song", "Next song"]) {
      expect(screen.getByRole("link", { name })).toHaveAttribute("data-prefetch", "true");
    }
    expect(screen.getByRole("link", { name: "Summer" })).toHaveAttribute("data-prefetch", "false");
  });
});
