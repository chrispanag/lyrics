import { describe, expect, it } from "vitest";

import { PageTitle } from "@/components/PageTitle";
import { ProfilePage } from "@/routes/ProfilePage";
import { renderWithProviders } from "@/test/render";

/**
 * These specs assert on `document.title` rather than on the rendered markup,
 * because the markup is not where a `<title>` ends up: React 19 hoists it out
 * of the component into `<head>`. Querying the container would pass on a
 * component that rendered a title nowhere useful.
 */
describe("PageTitle", () => {
  it("appends the product name to the page's own", () => {
    renderWithProviders(<PageTitle name="Your lists" />);

    expect(document.title).toBe("Your lists — Songfolio");
  });

  it("renders the product name alone when the page has none yet", () => {
    // The state a page fetching a record is in before it resolves. The failure
    // this pins is a tab reading "undefined — Songfolio".
    renderWithProviders(<PageTitle />);

    expect(document.title).toBe("Songfolio");
  });

  it("releases the title when the page unmounts", () => {
    const { unmount } = renderWithProviders(<PageTitle name="Edit song" />);
    expect(document.title).toBe("Edit song — Songfolio");

    unmount();

    // Left standing, a title outlives the route that set it — which is what
    // makes the editor's name stick to the song page it pops back to.
    expect(document.title).not.toBe("Edit song — Songfolio");
  });

  // An end-to-end pass rather than another unit: a route that imports PageTitle
  // but never renders it looks identical to one that does, and only the
  // document says otherwise.
  //
  // All three of ProfilePage's branches, because they are three separate
  // insertions of the same line and one spec covers exactly one of them — with
  // only the signed-in case here, deleting the title from the other two leaves
  // the suite green, which is the regression the comment beside them exists to
  // prevent. A branch left without one falls back to index.html's static title,
  // not to the previous page's.
  describe("titles every branch of a route that renders it", () => {
    const user = { id: "u1", email: "reader@example.com", role: "user" } as const;

    it("names the signed-in page", () => {
      renderWithProviders(<ProfilePage />, {
        route: "/profile",
        user: { ...user, display_name: "Reader" } as never,
      });

      expect(document.title).toBe("Profile — Songfolio");
    });

    it("names the page while the session is restoring", () => {
      renderWithProviders(<ProfilePage />, { route: "/profile", auth: { loading: true } });

      expect(document.title).toBe("Profile — Songfolio");
    });

    it("names the page for a guest", () => {
      renderWithProviders(<ProfilePage />, { route: "/profile", user: null });

      expect(document.title).toBe("Profile — Songfolio");
    });
  });
});
