import { describe, expect, it } from "vitest";

import { returnDestination, signInHref } from "./returnTo";

/** What the sign-in screen at `href` would send a visitor on to. */
const destinationOf = (href: string) =>
  returnDestination(new URL(href, "https://x.test").searchParams);

describe("returnTo", () => {
  // The search string is part of where they were; losing it lands them on an
  // unfiltered page.
  it("comes back to the address it was given, search string included", () => {
    expect(destinationOf(signInHref("/lists/list-1?sort=title&q=a b"))).toBe(
      "/lists/list-1?sort=title&q=a%20b",
    );
  });

  it("falls back to the catalog with no destination", () => {
    expect(destinationOf("/login")).toBe("/");
  });

  // Anyone can write the parameter, so anything leaving the site is refused.
  it.each([
    "https://evil.example/",
    "//evil.example/",
    "/\\evil.example/",
    "/\t/evil.example/",
    "javascript:alert(1)",
    "evil.example",
    "",
  ])("refuses %j as a destination", (next) => {
    expect(destinationOf(`/login?${new URLSearchParams({ next })}`)).toBe("/");
  });
});
