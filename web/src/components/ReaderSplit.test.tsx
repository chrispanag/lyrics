import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ReaderSplit } from "./ReaderSplit";
import { Link, useRouter } from "@/lib/navigation";
import { BrowsePage } from "@/routes/BrowsePage";
import { ListDetailPage } from "@/routes/ListsPages";
import { catalogList } from "@/test/catalog";
import { listById } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";
import { recordRequests } from "@/test/requests";
import { CurrentAddress, TestRoutes } from "@/test/routes";
import { server } from "@/test/server";

function Reader() {
  const router = useRouter();
  return (
    <>
      <Link href="/songs/a-song">Open the song</Link>
      <button type="button" onClick={() => router.back()}>
        Back
      </button>
      <CurrentAddress />
    </>
  );
}

/*
 * Rendered here rather than through `TestApp`, which mounts each address fresh:
 * the router keeps the catalog slot mounted across a soft navigation, and that
 * mounted list is what this is about. jsdom has no container width, so the
 * panes never split and the list beside a song is hidden, as on a phone.
 */
describe("ReaderSplit", () => {
  it("keeps the list's query on once it has shown, so Back from a song refetches nothing", async () => {
    const user = userEvent.setup();
    const { queryClient } = renderWithProviders(
      <ReaderSplit catalog={<BrowsePage />}>
        <Reader />
      </ReaderSplit>,
      { route: "/" },
    );
    await waitFor(() => expect(screen.queryByText("Searching…")).not.toBeInTheDocument());

    await user.click(screen.getByRole("link", { name: "Open the song" }));
    expect(screen.getByText("Now at /songs/a-song")).toBeInTheDocument();

    // Long enough on the song for the list's pages to go stale. Only the clock
    // React Query reads is faked: user-event and MSW keep their real timers.
    vi.useFakeTimers({ toFake: ["Date"] });
    const requests = recordRequests();
    try {
      vi.setSystemTime(Date.now() + 10 * 60_000);
      await user.click(screen.getByRole("button", { name: "Back" }));
      expect(screen.getByText("Now at /")).toBeInTheDocument();
      expect(queryClient.isFetching()).toBe(0);
    } finally {
      requests.stop();
      vi.useRealTimers();
    }
    expect(requests.paths).toEqual([]);
  });

  // A list's own page fills the same slot, so a song opened from it keeps the
  // list on screen, scrolled where it was, with the song marked in it.
  it("keeps a list mounted beside the song opened from it", async () => {
    server.use(listById(catalogList(3)));
    const user = userEvent.setup();
    renderWithProviders(
      <ReaderSplit catalog={<ListDetailPage />}>
        <TestRoutes
          routes={{ "/lists/:listId": <p>Select a song</p>, "/songs/:id": <CurrentAddress /> }}
        />
      </ReaderSplit>,
      { route: "/lists/list-1" },
    );
    const card = await screen.findByRole("link", { name: /Φραγκοσυριανή/ });
    expect(card).not.toHaveAttribute("aria-current");

    const lists = recordRequests((path) => path.startsWith("/api/v1/lists"));
    try {
      await user.click(card);
      expect(screen.getByText("Now at /songs/frangosyriani?list=list-1")).toBeInTheDocument();
      // The same card, not one rebuilt: the list was kept, not read again.
      expect(screen.getByRole("link", { name: /Φραγκοσυριανή/ })).toBe(card);
      expect(card).toHaveAttribute("aria-current", "page");
      // Beside a song the song holds the page's h1; the list's name steps down.
      expect(screen.getByRole("heading", { level: 2, name: "Ρεμπέτικα" })).toBeInTheDocument();
    } finally {
      lists.stop();
    }
    expect(lists.paths).toEqual([]);
  });
});
