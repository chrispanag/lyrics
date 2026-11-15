import { act, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Link, pathMatches, useNavigationKey, useRouter } from "./navigation";
import { renderWithProviders } from "@/test/render";

describe("pathMatches", () => {
  it.each([
    ["/admin/users", "/admin", true],
    ["/admin", "/admin", true],
    ["/Admin/Users", "/admin", true],
    // By whole segments only.
    ["/admin-x", "/admin", false],
    // The catalog is lit on itself alone, or it would be lit everywhere.
    ["/songs/x", "/", false],
    ["/", "/", true],
  ])("%s under a link to %s: %s", (pathname, href, lit) => {
    expect(pathMatches(pathname, href)).toBe(lit);
  });

  it("asks for the same path alone with `end`", () => {
    expect(pathMatches("/admin/users", "/admin", true)).toBe(false);
  });
});

/** The navigation key and `canGoBack`, with a link to here and one elsewhere. */
function Probe() {
  const router = useRouter();
  return (
    <>
      <p data-testid="key">{useNavigationKey()}</p>
      <Link href="/songs/a">Here</Link>
      <Link href="/songs/b">Elsewhere</Link>
      <button type="button" onClick={() => router.replace("/songs/c")}>
        Replace
      </button>
      <p data-testid="back">{String(router.canGoBack())}</p>
    </>
  );
}

const key = () => screen.getByTestId("key").textContent;
const canGoBack = () => screen.getByTestId("back").textContent;

describe("useNavigationKey", () => {
  // The drawer and the song page's search box reset on it; a link to the
  // screen already showing has to count, though the address does not move.
  it("changes for a link to the address already showing", async () => {
    renderWithProviders(<Probe />, { route: "/songs/a" });
    const before = key();

    await userEvent.click(screen.getByRole("link", { name: "Here" }));

    expect(key()).not.toBe(before);
  });

  // A modified click opens another tab and leaves this page where it was.
  it("does not change for a click that opens another tab", () => {
    renderWithProviders(<Probe />, { route: "/songs/a" });
    const before = key();

    fireEvent.click(screen.getByRole("link", { name: "Here" }), { metaKey: true });

    expect(key()).toBe(before);
  });
});

describe("canGoBack", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // A fresh tab: Back would leave the site.
  it("is false for the first screen a tab opened", () => {
    renderWithProviders(<Probe />, { route: "/songs/a" });
    expect(canGoBack()).toBe("false");
  });

  it("is true once the app has pushed an entry", async () => {
    renderWithProviders(<Probe />, { route: "/songs/a" });

    await userEvent.click(screen.getByRole("link", { name: "Elsewhere" }));

    expect(canGoBack()).toBe("true");
  });

  // A replace leaves nothing new behind, and neither does a link to here,
  // which the router turns into a replace.
  it("stays false through a replace and a link to the address showing", async () => {
    renderWithProviders(<Probe />, { route: "/songs/a" });

    await userEvent.click(screen.getByRole("link", { name: "Here" }));
    await userEvent.click(screen.getByRole("button", { name: "Replace" }));

    expect(canGoBack()).toBe("false");
  });

  it("is true once the browser has moved through history", () => {
    renderWithProviders(<Probe />, { route: "/songs/a" });

    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    // Read at the next render, which a navigation always brings.
    fireEvent.click(screen.getByRole("link", { name: "Here" }));

    expect(canGoBack()).toBe("true");
  });

  // Right after a reload too, which nothing kept in memory can be.
  it("asks the Navigation API where the browser has one", () => {
    vi.stubGlobal("navigation", { canGoBack: true });
    renderWithProviders(<Probe />, { route: "/songs/a" });

    expect(canGoBack()).toBe("true");
  });
});
