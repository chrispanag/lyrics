import type { ReactNode } from "react";

import { sheetChrome, sheetFrame } from "@/components/cardStyles";
import { cn } from "@/lib/cn";

const FRAME = cn("@3xl/app:flex @3xl/app:min-h-dvh @3xl/app:flex-col", sheetFrame);
const SHEET = cn("@3xl/app:flex-1", sheetChrome);

/**
 * A screen with no header of its own, set out as the shell's other screens
 * are: at a desk one sheet beside the rail, as the reader's list and song are
 * two (`sheetChrome`), at least a window tall less the frame's inset and
 * growing with the screen; the window scrolls it. On a phone it keeps the
 * screen clear of the notch, the room a header would have taken.
 *
 * The `(plain)` route group renders it around each of its screens.
 */
export function PlainSheet({ children }: { children: ReactNode }) {
  return (
    <div className={FRAME}>
      <div aria-hidden className="pt-safe md:hidden" />
      <div className={SHEET}>{children}</div>
    </div>
  );
}
