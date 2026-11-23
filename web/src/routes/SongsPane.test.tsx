import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { ReaderSplit } from "@/components/ReaderSplit";
import { Link } from "@/lib/navigation";
import { SongsPane } from "@/routes/SongsPane";
import { catalogList } from "@/test/catalog";
import { listById } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";
import { CurrentAddress } from "@/test/routes";
import { server } from "@/test/server";

/*
 * Rendered in a `ReaderSplit` rather than through `TestApp`, which mounts each
 * address fresh: on a soft navigation the router keeps whichever `@catalog`
 * page last matched, so the list's own page stays in the slot on any song
 * opened from it. The pane must follow the address, not that page.
 */
describe("SongsPane", () => {
  it("shows the catalog beside a song opened from search, which is in no list", async () => {
    server.use(listById(catalogList(3)));
    const user = userEvent.setup();
    renderWithProviders(
      <ReaderSplit catalog={<SongsPane />}>
        {/* A song as the song page's search links it: no `?list=`. */}
        <Link href="/songs/thalassa-platia">Open a song</Link>
        <CurrentAddress />
      </ReaderSplit>,
      { route: "/lists/list-1" },
    );
    // The module the pane's `lazy` names, so the list waits on its own import.
    await import("@/routes/ListsPages");
    expect(await screen.findByRole("heading", { name: "Ρεμπέτικα" })).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "Open a song" }));
    expect(screen.getByText("Now at /songs/thalassa-platia")).toBeInTheDocument();
    expect(await screen.findByRole("searchbox", { name: "Search songs" })).toBeInTheDocument();
    expect(screen.queryByText("This list is not available.")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Ρεμπέτικα" })).not.toBeInTheDocument();
  });

  it("shows the list a song's address names", async () => {
    server.use(listById(catalogList(3)));
    renderWithProviders(<SongsPane />, { route: "/songs/thalassa-platia?list=list-1" });
    await import("@/routes/ListsPages");
    expect(await screen.findByRole("heading", { name: "Ρεμπέτικα" })).toBeInTheDocument();
    expect(screen.queryByRole("searchbox", { name: "Search songs" })).not.toBeInTheDocument();
  });
});
