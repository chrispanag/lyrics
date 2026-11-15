import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode, useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { Input, Sheet } from "./ui";
import { modalIsOpen } from "@/lib/modal";

/*
 * jsdom has no `showModal()`; src/test/dialog.ts stands in for the parts these
 * lean on. Its rectangles are all zero, so a point is "outside" by coordinates.
 */

function Harness({ onClose, mounted = true }: { onClose?: () => void; mounted?: boolean }) {
  const [open, setOpen] = useState(false);
  const close = () => {
    onClose?.();
    setOpen(false);
  };
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      {/* `mounted={false}` is the `{cond && <Sheet open />}` shape two pages use. */}
      {(mounted || open) && (
        <Sheet open={open} onClose={close} title="Example">
          <Input autoFocus aria-label="Name" />
        </Sheet>
      )}
    </>
  );
}

describe("Sheet", () => {
  it("is a modal dialog named by its heading only while open", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(modalIsOpen()).toBe(false);

    await user.click(screen.getByRole("button", { name: "Open" }));

    expect(screen.getByRole("dialog", { name: "Example" })).toBeInTheDocument();
    expect(modalIsOpen()).toBe(true);
    expect(document.body.style.overflow).toBe("hidden");
  });

  // `autoFocus` runs during the commit; mounted with `showModal()` rather than
  // after it, the field is recorded as the opener and focus never comes home.
  it("starts on an `autoFocus` field and hands focus back to the opener", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Open" });

    await user.click(opener);
    expect(screen.getByLabelText("Name")).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(opener).toHaveFocus();
    expect(modalIsOpen()).toBe(false);
    expect(document.body.style.overflow).toBe("");
  });

  // Unmounting an open dialog would drop focus on <body>; the layout cleanup
  // closes it first.
  it("hands focus back when its caller unmounts it", async () => {
    const user = userEvent.setup();
    render(<Harness mounted={false} />);
    const opener = screen.getByRole("button", { name: "Open" });

    await user.click(opener);
    await user.click(screen.getByRole("button", { name: "Close" }));

    expect(opener).toHaveFocus();
  });

  // The native close is reported once: the `close` event that follows our own
  // `close()` is the echo, not a second request.
  it("reports Escape through onClose, once", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: "Open" }));
    await user.keyboard("{Escape}");

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).toBeNull();

    // And the prop closing it is not reported back as a second request.
    await user.click(screen.getByRole("button", { name: "Open" }));
    await user.click(screen.getByRole("button", { name: "Close" }));
    await act(() => new Promise((resolve) => setTimeout(resolve)));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  // Strict Mode closes and reopens on mount; that close's event lands a task
  // later, on a dialog already open again, and must not close it.
  it("stays open through Strict Mode's remount", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <StrictMode>
        <Harness onClose={onClose} mounted={false} />
      </StrictMode>,
    );

    await user.click(screen.getByRole("button", { name: "Open" }));
    await act(() => new Promise((resolve) => setTimeout(resolve)));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("closes on a press and release outside, not on a drag that ends there", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "Open" }));
    const dialog = screen.getByRole("dialog");

    // Pressed inside (the zero rectangle's own point), released outside.
    fireEvent.pointerDown(dialog, { clientX: 0, clientY: 0 });
    fireEvent.pointerUp(dialog, { clientX: 50, clientY: 50 });
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.pointerDown(dialog, { clientX: 50, clientY: 50 });
    fireEvent.pointerUp(dialog, { clientX: 50, clientY: 50 });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
