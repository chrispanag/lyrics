import type { DehydratedState } from "@tanstack/react-query";
import { HydrationBoundary } from "@tanstack/react-query";
import type { ReactElement } from "react";

/*
 * Reading the tree an async server page returns, for the specs that call one
 * rather than render it: by element type, never by position, since a page's
 * JSON-LD script may be conditional or move.
 */

type Node = ReactElement<Record<string, unknown>>;

/** The page's top-level elements, a `false` from each `&&` left out. */
export function topLevel(tree: ReactElement): Node[] {
  return (tree.props as { children: unknown[] }).children.flat().filter(Boolean) as Node[];
}

/** The page's `HydrationBoundary`: what it hands over, and what it wraps. */
export function handover(
  tree: ReactElement,
): ReactElement<{ children: ReactElement; state?: DehydratedState }> | undefined {
  return topLevel(tree).find((node) => node.type === HydrationBoundary) as
    | ReactElement<{ children: ReactElement; state?: DehydratedState }>
    | undefined;
}

/** The JSON-LD script's body, or null when the page rendered none. */
export function structuredData(tree: ReactElement): string | null {
  const script = topLevel(tree).find((node) => node.props.type === "application/ld+json");
  const inner = script?.props.dangerouslySetInnerHTML as { __html: string } | undefined;
  return inner?.__html ?? null;
}
