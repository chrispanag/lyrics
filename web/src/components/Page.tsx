import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * The two column widths a single-column screen may take: `content` for pages
 * that list things (your lists, the admin console), `form` for pages that edit
 * one thing (the song editor, Profile). Named by purpose so a new screen picks
 * one of the two instead of inventing a third.
 */
const PAGE_WIDTHS = {
  content: "max-w-3xl",
  form: "max-w-2xl",
} as const;

export type PageWidth = keyof typeof PAGE_WIDTHS;

/**
 * The column a single-column screen renders in, centered in the shell with the
 * shared gutter and top spacing. Not for the reader panes, which fill the shell
 * at their own widths, nor the auth card, which sits outside the shell.
 *
 * `cn` is a plain join: `className` may only add non-colliding utilities.
 */
export function Page({
  width,
  className,
  children,
}: {
  width: PageWidth;
  className?: string;
  children: ReactNode;
}) {
  return <div className={cn("mx-auto px-4 py-6", PAGE_WIDTHS[width], className)}>{children}</div>;
}
