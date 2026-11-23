import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Copy, Pencil, Trash } from "lucide-react";
import { describe, expect, it, vi } from "vitest";

import { MenuItem, MoreActionsMenu } from "./MoreActionsMenu";

function renderMenu({ onDelete = vi.fn(), renameDisabled = false } = {}) {
  render(
    <>
      <MoreActionsMenu>
        <MenuItem icon={Copy} onSelect={vi.fn()}>
          Duplicate
        </MenuItem>
        <MenuItem icon={Pencil} disabled={renameDisabled} onSelect={vi.fn()}>
          Rename
        </MenuItem>
        <MenuItem icon={Trash} danger onSelect={onDelete}>
          Delete
        </MenuItem>
      </MoreActionsMenu>
      <button type="button">Elsewhere</button>
    </>,
  );
  return { trigger: screen.getByRole("button", { name: "More actions" }), onDelete };
}

const item = (name: string) => screen.getByRole("menuitem", { name });

describe("MoreActionsMenu", () => {
  // Each item is gated by its own condition; a reader none of them is for gets
  // no menu, without the caller restating every condition.
  it("renders nothing when no item is present", () => {
    const { container } = render(<MoreActionsMenu>{false}</MoreActionsMenu>);

    expect(container).toBeEmptyDOMElement();
  });

  it("can be held shut while nothing in it could act", () => {
    render(
      <MoreActionsMenu disabled>
        <MenuItem icon={Trash} onSelect={vi.fn()}>
          Delete
        </MenuItem>
      </MoreActionsMenu>,
    );

    expect(screen.getByRole("button", { name: "More actions" })).toBeDisabled();
  });

  it("is a closed menu button until pressed", () => {
    const { trigger } = renderMenu();

    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  // As a native menu: a pointer open leaves focus on the trigger.
  it("opens on a press, keeps focus on the trigger, and enters on ArrowDown", async () => {
    const user = userEvent.setup();
    const { trigger } = renderMenu();

    await user.click(trigger);

    expect(screen.getByRole("menu", { name: "More actions" })).toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(trigger).toHaveFocus();

    await user.keyboard("{ArrowDown}");
    expect(item("Duplicate")).toHaveFocus();
  });

  it.each(["{Enter}", " ", "{ArrowDown}"])(
    "opens on %s and focuses the first item",
    async (key) => {
      const user = userEvent.setup();
      const { trigger } = renderMenu();

      trigger.focus();
      await user.keyboard(key);

      expect(item("Duplicate")).toHaveFocus();
    },
  );

  it("opens on ArrowUp at the last item", async () => {
    const user = userEvent.setup();
    const { trigger } = renderMenu();

    trigger.focus();
    await user.keyboard("{ArrowUp}");

    expect(item("Delete")).toHaveFocus();
  });

  it("moves between items with the arrows, wrapping, and Home and End", async () => {
    const user = userEvent.setup();
    const { trigger } = renderMenu();
    trigger.focus();
    await user.keyboard("{ArrowDown}");

    await user.keyboard("{ArrowDown}");
    expect(item("Rename")).toHaveFocus();
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(item("Duplicate")).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(item("Delete")).toHaveFocus();
    await user.keyboard("{Home}");
    expect(item("Duplicate")).toHaveFocus();
    await user.keyboard("{End}");
    expect(item("Delete")).toHaveFocus();
    // Still a single tab stop: the items are reached only by the arrows.
    expect(item("Rename")).toHaveAttribute("tabindex", "-1");
  });

  it("skips an item that is disabled", async () => {
    const user = userEvent.setup();
    const { trigger } = renderMenu({ renameDisabled: true });
    trigger.focus();
    await user.keyboard("{ArrowDown}{ArrowDown}");

    expect(item("Delete")).toHaveFocus();
  });

  it("closes on Escape and hands focus back to the trigger", async () => {
    const user = userEvent.setup();
    const { trigger } = renderMenu();
    trigger.focus();
    await user.keyboard("{ArrowDown}{ArrowDown}");

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();
  });

  it("closes on Escape after a pointer open too", async () => {
    const user = userEvent.setup();
    const { trigger } = renderMenu();
    await user.click(trigger);

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("closes on a second press of the trigger", async () => {
    const user = userEvent.setup();
    const { trigger } = renderMenu();
    await user.click(trigger);

    await user.click(trigger);

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  // A press, so a tap on a phone closes it the same way.
  it("closes on a press outside, without choosing anything", async () => {
    const user = userEvent.setup();
    const { trigger, onDelete } = renderMenu();
    await user.click(trigger);

    await user.click(screen.getByRole("button", { name: "Elsewhere" }));

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Elsewhere" })).toHaveFocus();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("closes when Tab takes focus out of it", async () => {
    const user = userEvent.setup();
    const { trigger } = renderMenu();
    trigger.focus();
    await user.keyboard("{ArrowDown}");

    await user.tab();

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("closes on a choice, back on the trigger, before running it", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn(() => {
      // What a confirmation records as its opener.
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "More actions" }));
    });
    const { trigger } = renderMenu({ onDelete });
    await user.click(trigger);

    await user.click(item("Delete"));

    expect(onDelete).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("chooses with Enter from the keyboard", async () => {
    const user = userEvent.setup();
    const { trigger, onDelete } = renderMenu();
    trigger.focus();
    await user.keyboard("{ArrowUp}{Enter}");

    expect(onDelete).toHaveBeenCalledOnce();
    expect(trigger).toHaveFocus();
  });
});
