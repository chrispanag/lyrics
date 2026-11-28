/*
 * Text styles shared across screens. Kept out of ui.tsx, which exports only
 * components so fast refresh keeps working.
 */

import { cn } from "@/lib/cn";

/**
 * The name over a part of a screen: a profile section, an editor's fieldset,
 * a song's notes. In sentence case and unspaced: a label set in letter-spaced
 * capitals shouts over the content it names.
 */
export const sectionLabel = "text-sm font-medium text-fg-secondary";

/**
 * The face of every title, without its size: a song's (`SongTitle`), which is
 * the largest, and a screen's (`pageTitle`). The lyrics' serif, so every screen
 * reads as part of the same printed piece: semibold, since a serif is already
 * dark at display sizes, and without a sans title's tight tracking, which
 * crowds a serif's Greek. `break-words`: a title is user input, and one long
 * word must wrap rather than push the column wider than a phone.
 */
export const titleFace = "font-lyrics font-semibold leading-tight text-balance break-words";

/** The face of the line under a title, without its size: italic, quiet, just under it. */
export const subtitleFace = "mt-1 font-lyrics italic text-fg-muted";

/** A screen's title: a page header's, a list's, an auth screen's, a catalog page's. */
export const pageTitle = cn(titleFace, "text-3xl");

/** The line under a `pageTitle`: a list's description, a reader's role. */
export const pageSubtitle = cn(subtitleFace, "text-lg");

/**
 * The text of a navigation entry's name set under its icon: the bottom bar's
 * tabs, and the rail's entries on a touch screen (`RailCaption`), so the two
 * read alike.
 */
export const tabLabelText = "text-[11px] leading-tight font-medium";

export type LinkTone = "accent" | "muted" | "quiet";

const linkTones: Record<LinkTone, string> = {
  // The way forward: "Create one", "Show all".
  accent: "font-medium text-fg-accent",
  // A secondary action: "Resend code", "Back to sign in".
  muted: "font-medium text-fg-muted",
  // The least of them: "Forgot your password?", "Continue as guest".
  quiet: "text-fg-muted",
};

/**
 * A link in running text, and a button drawn as one, in one of three tones.
 * The disabled styles only reach a button; an anchor is never disabled.
 */
export function linkClasses(tone: LinkTone = "accent", className?: string): string {
  return cn(
    "hover:underline disabled:cursor-not-allowed disabled:text-fg-subtle disabled:no-underline",
    linkTones[tone],
    className,
  );
}
