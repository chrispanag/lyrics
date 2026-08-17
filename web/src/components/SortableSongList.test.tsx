import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SortableSongList } from "./SortableSongList";
import { makeSong } from "@/test/handlers";
import { stubRowRects } from "@/test/rects";
import { renderWithProviders } from "@/test/render";

const songs = [
  makeSong({ id: "song-1", title: "First" }),
  makeSong({ id: "song-2", title: "Second" }),
  makeSong({ id: "song-3", title: "Third" }),
];

describe("SortableSongList", () => {
  it("gives every song a named handle", () => {
    renderWithProviders(<SortableSongList songs={songs} onReorder={vi.fn()} onRemove={vi.fn()} />);

    for (const title of ["First", "Second", "Third"]) {
      expect(screen.getByRole("button", { name: `Reorder ${title}` })).toBeInTheDocument();
    }
  });

  // Dragging with a pointer is not the only way in: the same list has to be
  // reorderable from the keyboard, which is also the only way to drive dnd-kit
  // in jsdom.
  it("reorders from the keyboard and reports the new order", async () => {
    const user = userEvent.setup();
    const onReorder = vi.fn();

    const { container } = renderWithProviders(
      <SortableSongList songs={songs} onReorder={onReorder} onRemove={vi.fn()} />,
    );
    stubRowRects(container);

    await user.tab();
    expect(screen.getByRole("button", { name: "Reorder First" })).toHaveFocus();

    await user.keyboard("{ }");        // lift
    await user.keyboard("{ArrowDown}"); // over the next song
    await user.keyboard("{ }");        // drop

    await waitFor(() => expect(onReorder).toHaveBeenCalledWith(["song-2", "song-1", "song-3"]));
  });

  it("saves nothing when a song is dropped where it started", async () => {
    const user = userEvent.setup();
    const onReorder = vi.fn();

    const { container } = renderWithProviders(
      <SortableSongList songs={songs} onReorder={onReorder} onRemove={vi.fn()} />,
    );
    stubRowRects(container);

    await user.tab();
    await user.keyboard("{ }");
    await user.keyboard("{ }");

    expect(onReorder).not.toHaveBeenCalled();
  });
});
