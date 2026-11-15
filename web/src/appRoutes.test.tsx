import { screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import type { User } from "@/lib/types";
import { API, list, listById, makeList, makeUser } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";
import { TestApp } from "@/test/app";
import { CurrentAddress } from "@/test/routes";

/*
 * Every screen inside the shell offers the hamburger. `SearchHeader` and the
 * `(menu)` layout supply it independently, so only the app directory itself,
 * composed by position (`test/app.tsx`), can check both; a miss leaves a phone
 * on a screen it cannot navigate off.
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
    { route: "/admin/genres", user: admin },
    // The root not-found sits outside the route groups and mounts their
    // layouts itself, so it needs the same way off it.
    { route: "/nowhere-at-all" },
  ];

  it.each(SCREENS)("offers the drawer at $route", async ({ route, user = null }) => {
    // Not covered by the default handlers; they only have to answer.
    server.use(
      listById(makeList()),
      http.get(`${API}/api/v1/admin/users`, () => HttpResponse.json(list<User>([]))),
    );

    renderWithProviders(<TestApp />, { route, user });

    expect(await screen.findByRole("button", { name: "Open menu" })).toBeInTheDocument();
  });

  // The credential screens have no navigation by design.
  it.each(["/login", "/register", "/forgot-password"])("offers none at %s", async (route) => {
    renderWithProviders(<TestApp />, { route });

    expect(await screen.findByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open menu" })).not.toBeInTheDocument();
  });

  it("names a dead link as one", async () => {
    renderWithProviders(<TestApp />, { route: "/nowhere-at-all" });

    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeInTheDocument();
  });

  // The section has no screen of its own; its page redirects to the first tab.
  it("opens the admin console on its first tab", async () => {
    server.use(http.get(`${API}/api/v1/admin/users`, () => HttpResponse.json(list<User>([]))));

    renderWithProviders(
      <>
        <TestApp />
        <CurrentAddress />
      </>,
      { route: "/admin", user: admin },
    );

    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/admin/users"));
  });
});
