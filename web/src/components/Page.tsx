import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * The content column's width, shared with the header bar above every page
 * (`SearchHeader`) and the reader columns under it (`ReaderSplit`'s pane, a
 * song's page), so a page's edge and the search field's stay on one line. A `form`
 * page is narrower, so its edge sits inside the bar's.
 */
export const contentWidth = "max-w-3xl";

/**
 * The two column widths a single-column screen may take: `content` for pages
 * that list things (your lists, the admin console), `form` for pages that edit
 * one thing (the song editor, Profile). Named by purpose so a new screen picks
 * one of the two instead of inventing a third.
 */
const PAGE_WIDTHS = {
  content: contentWidth,
  form: "max-w-2xl",
} as const;

/**
 * The column a single-column screen renders in, centered in the shell with the
 * shared gutter and top spacing. Not for the reader panes, which fill the shell
 * at their own widths, nor the auth card, which sits outside the shell.
 */
export function Page({
  width,
  children,
}: {
  width: keyof typeof PAGE_WIDTHS;
  children: ReactNode;
}) {
  return <div className={cn("mx-auto px-4 py-6", PAGE_WIDTHS[width])}>{children}</div>;
}
