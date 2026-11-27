/*
 * Text styles shared across screens. Kept out of ui.tsx, which exports only
 * components so fast refresh keeps working.
 */

import { cn } from "@/lib/cn";

/** The small capitals over a section or a screen: "Lyrics", "Admin". */
export const sectionLabel = "text-sm font-semibold uppercase tracking-wide text-fg-muted";

/** A screen's title: a page header's, an auth screen's, a catalog page's. */
export const pageTitle = "text-2xl font-bold tracking-tight text-balance break-words";

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
