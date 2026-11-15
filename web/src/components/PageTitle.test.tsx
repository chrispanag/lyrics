import { describe, expect, it } from "vitest";

import { PageTitle } from "@/components/PageTitle";
import { ProfilePage } from "@/routes/ProfilePage";
import { renderWithProviders } from "@/test/render";

// Asserts on `document.title`, not the container: React 19 hoists the title.
describe("PageTitle", () => {
  it("appends the product name to the page's own", () => {
    renderWithProviders(<PageTitle name="Your lists" />);

    expect(document.title).toBe("Your lists — Songfolio");
  });

  it("renders the product name alone when the page has none yet", () => {
    // Pins against a tab reading "undefined — Songfolio".
    renderWithProviders(<PageTitle />);

    expect(document.title).toBe("Songfolio");
  });

  it("releases the title when the page unmounts", () => {
    const { unmount } = renderWithProviders(<PageTitle name="Edit song" />);
    expect(document.title).toBe("Edit song — Songfolio");

    unmount();

    // Otherwise the editor's name sticks to the song page it pops back to.
    expect(document.title).not.toBe("Edit song — Songfolio");
  });

  // Each of ProfilePage's branches renders its own PageTitle, so each needs a
  // spec. A branch without one leaves no title at all; the tab reads the URL.
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
