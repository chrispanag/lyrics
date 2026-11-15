import type { ReactNode } from "react";

import { BackButton } from "./BackButton";

/**
 * The bar over a page you arrive at from somewhere else (a song, a list): the
 * way back, and opposite it what the viewer may do here. The actions are ghost
 * `sm` buttons whose text is `actionLabel`, so a phone shows their icons alone.
 */
export function PageBar({ children }: { children?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-2">
      <BackButton />
      {children && <div className="flex items-center gap-1">{children}</div>}
    </div>
  );
}
