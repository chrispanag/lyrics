import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSetSearchParams } from "./navigation";
import { NextNavigation } from "./nextNavigation";

/*
 * The seam's Next backend, against a stand-in for `next/navigation` whose
 * `useSearchParams` is the last render's address, as Next's is. Every other spec
 * mounts `TestRouter`; this one holds the production backend to the same contract.
 */

const router = { push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() };

vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
  useParams: () => ({}),
}));

function SearchWriter() {
  const setParams = useSetSearchParams();
  return (
    <button
      type="button"
      onClick={() => {
        setParams((next) => next.set("q", "agapi"), { replace: true });
        setParams((next) => next.set("genre", "laiko"));
      }}
    >
      Both
    </button>
  );
}

describe("NextNavigation's search-string writes", () => {
  const start = window.location.href;

  beforeEach(() => {
    window.history.replaceState(null, "", "/?page=2");
  });

  afterEach(() => {
    window.history.replaceState(null, "", start);
  });

  it("keeps both of two writes made before a re-render", async () => {
    render(
      <NextNavigation>
        <SearchWriter />
      </NextNavigation>,
    );
    const before = window.history.length;

    await userEvent.click(screen.getByRole("button", { name: "Both" }));

    expect(`${window.location.pathname}${window.location.search}`).toBe(
      "/?page=2&q=agapi&genre=laiko",
    );
    // The replace took the entry it was on and the plain write pushed one,
    // through the History API and never through the router.
    expect(window.history.length).toBe(before + 1);
    expect(router.push).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });
});
