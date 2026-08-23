import { screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { App } from "./App";
import type { User } from "@/lib/types";
import { API, list, listById, makeList, makeUser } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

/*
 * Every screen inside the shell offers a way into the navigation.
 *
 * On a phone that way is one hamburger, and which component supplies it depends
 * on the screen: the catalog and a song page have `SearchHeader` put it in the
 * row they already carry, and everything else is given `MenuHeader` by
 * `MenuBarLayout` in the route list. Neither mechanism can see the other, so the
 * only place the guarantee is really a guarantee is here — asked of the real
 * route table, one address at a time.
 *
 * What that catches is the failure both mechanisms were arranged to avoid and
 * neither can report: a route added without the wrapper, or the button dropped
 * from the shared header. Both leave the app working perfectly at a desk, where
 * the sidebar is the navigation, and leave a phone on a screen it cannot
 * navigate off — with no browser chrome at all under `display: standalone`.
 * Every spec elsewhere renders a page or a stand-in route tree, so every one of
 * them stays green through it.
 *
 * Deliberately not asserted through `Layout`: the shell renders no trigger of
 * its own, and a spec that mounted one beside it would be pinning its own
 * arrangement rather than the app's.
 */
describe("Reaching the navigation from every screen", () => {
  const admin = makeUser({ role: "admin" });

  /** Each address a reader can be at inside the shell, and who is at it. */
  const SCREENS: { route: string; user?: User }[] = [
    { route: "/" },
    { route: "/songs/song-1" },
    { route: "/songs/new", user: admin },
    { route: "/songs/song-1/edit", user: admin },
    { route: "/lists", user: admin },
    { route: "/lists/list-1" },
    { route: "/profile" },
    { route: "/admin", user: admin },
    // The catch-all renders rather than redirecting, so it is a screen like any
    // other and needs the same way off it.
    { route: "/nowhere-at-all" },
  ];

  it.each(SCREENS)("offers the drawer at $route", async ({ route, user = null }) => {
    // The two the default handlers do not cover. Both are rendered rather than
    // asserted here, so they only have to answer.
    server.use(
      listById(makeList()),
      http.get(`${API}/api/v1/admin/users`, () => HttpResponse.json(list<User>([]))),
    );

    renderWithProviders(<App />, { route, user });

    // Found rather than got, since the editor and the console are lazy: their
    // chunk resolves a tick after the shell around it renders.
    expect(await screen.findByRole("button", { name: "Open menu" })).toBeInTheDocument();
  });
});
