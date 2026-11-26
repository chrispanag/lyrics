import { act, fireEvent, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  Link,
  NavigationProvider,
  pathMatches,
  useNavigationKey,
  useRouter,
  useSetSearchParams,
} from "./navigation";
import { recordingBackend } from "@/test/backend";
import { renderWithProviders } from "@/test/render";
import { CurrentAddress } from "@/test/routes";

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
});

/**
 * The navigation key and `canGoBack`, with a link to here and one elsewhere,
 * and two search-string writes in one event, before anything re-renders.
 */
function Probe() {
  const router = useRouter();
  const setParams = useSetSearchParams();
  return (
    <>
      <p data-testid="key">{useNavigationKey()}</p>
      <Link href="/songs/a">Here</Link>
      <Link href="/songs/b">Elsewhere</Link>
      <button type="button" onClick={() => router.replace("/songs/c")}>
        Replace
      </button>
      <button type="button" onClick={() => router.push("/songs/a")}>
        Push here
      </button>
      <button
        type="button"
        onClick={() => {
          setParams((next) => next.set("q", "agapi"), { replace: true });
          setParams((next) => next.set("genre", "laiko"));
        }}
      >
        Write twice
      </button>
      <button type="button" onClick={() => router.back("/")}>
        Back
      </button>
      <p data-testid="back">{String(router.canGoBack())}</p>
      <CurrentAddress />
    </>
  );
}

const key = () => screen.getByTestId("key").textContent;
const canGoBack = () => screen.getByTestId("back").textContent;

describe("useNavigationKey", () => {
  // The search sheet and the song page's search box reset on it; a link to the
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

describe("Link's prefetch", () => {
  // The prop is for the router; a plain anchor must not carry it to the DOM.
  it("is taken by the router and does not reach the anchor", () => {
    renderWithProviders(
      <Link href="/songs/a/edit" prefetch={false}>
        Edit
      </Link>,
    );

    expect(screen.getByRole("link", { name: "Edit" })).not.toHaveAttribute("prefetch");
  });
});

describe("push", () => {
  // Two identical entries in a row make Back appear to do nothing.
  it("replaces rather than pushes the address already showing", async () => {
    renderWithProviders(<Probe />, { route: ["/songs/z", "/songs/a"] });

    await userEvent.click(screen.getByRole("button", { name: "Push here" }));
    await userEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(screen.getByTestId("location")).toHaveTextContent("/songs/z");
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

  // A replace leaves nothing new behind, and neither does a link or a push to
  // the address showing, which both become replaces.
  it("stays false through a replace, and a link or push to the address showing", async () => {
    renderWithProviders(<Probe />, { route: "/songs/a" });

    await userEvent.click(screen.getByRole("link", { name: "Here" }));
    await userEvent.click(screen.getByRole("button", { name: "Push here" }));
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

  // With the entry's index, Back to the screen the tab opened on reads as
  // nothing behind again, so the app's Back cannot then leave the site.
  it("follows the entry's index where the backend reads it", () => {
    let index = 3;
    const backend = { ...recordingBackend(), entryIndex: () => index };
    const { result } = renderHook(useRouter, {
      wrapper: ({ children }) => (
        <NavigationProvider backend={backend}>{children}</NavigationProvider>
      ),
    });
    const router = result.current;

    expect(router.canGoBack()).toBe(false);
    index = 4;
    expect(router.canGoBack()).toBe(true);
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    index = 3;
    expect(router.canGoBack()).toBe(false);
  });

  // An earlier page load of this site is not the app's trail: the editor would
  // pop to an unrelated song. The Navigation API would say true here.
  it("ignores the browser's own history from before the page loaded", () => {
    vi.stubGlobal("navigation", { canGoBack: true });
    renderWithProviders(<Probe />, { route: "/songs/a" });

    expect(canGoBack()).toBe("false");
  });
});

describe("useSetSearchParams", () => {
  it("keeps both of two writes made before a re-render", async () => {
    renderWithProviders(<Probe />, { route: "/?page=2" });

    await userEvent.click(screen.getByRole("button", { name: "Write twice" }));

    expect(screen.getByTestId("location")).toHaveTextContent("/?page=2&q=agapi&genre=laiko");
  });

  // The replace took the entry it was on, so Back from the push lands on it
  // and not on the address before both.
  it("keeps each write's own history", async () => {
    renderWithProviders(<Probe />, { route: ["/songs/a", "/?page=2"] });

    await userEvent.click(screen.getByRole("button", { name: "Write twice" }));
    await userEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(screen.getByTestId("location")).toHaveTextContent("/?page=2&q=agapi");
  });

  it("is not counted as a navigation", async () => {
    renderWithProviders(<Probe />, { route: "/" });

    await userEvent.click(screen.getByRole("button", { name: "Write twice" }));

    expect(canGoBack()).toBe("false");
  });
});
