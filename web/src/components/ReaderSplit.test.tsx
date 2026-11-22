import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ReaderSplit } from "./ReaderSplit";
import { Link, useRouter } from "@/lib/navigation";
import { BrowsePage } from "@/routes/BrowsePage";
import { renderWithProviders } from "@/test/render";
import { recordRequests } from "@/test/requests";
import { CurrentAddress } from "@/test/routes";

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
});
