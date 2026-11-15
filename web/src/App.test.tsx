import { screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { App } from "./App";
import type { User } from "@/lib/types";
import { API, list, listById, makeList, makeUser } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

/*
 * Every screen inside the shell offers the hamburger. `SearchHeader` and
 * `MenuBarLayout` supply it independently, so only the real route table can
 * check both; a miss leaves a phone on a screen it cannot navigate off.
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
    // Not covered by the default handlers; they only have to answer.
    server.use(
      listById(makeList()),
      http.get(`${API}/api/v1/admin/users`, () => HttpResponse.json(list<User>([]))),
    );

    renderWithProviders(<App />, { route, user });

    // Found rather than got: the editor and console are lazy chunks.
    expect(await screen.findByRole("button", { name: "Open menu" })).toBeInTheDocument();
  });
});
