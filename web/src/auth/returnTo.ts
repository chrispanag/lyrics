import { createPath, type Location } from "react-router-dom";

/*
 * Where signing in sends a visitor afterwards: written by whoever asks them to
 * sign in, read by the screen that does it.
 *
 * Its own module because three places ask and one answers, and the address has
 * to mean the same thing at all four. It had already drifted: the song page
 * carries its search string, since `?list=` is what keeps a reader inside the
 * list they came from, while the two older callers passed the path alone. That
 * reads as one convention right up until a route that does have a parameter
 * sends someone through it, and then the round trip quietly lands them on a
 * different page than the one they left.
 */

/**
 * The router state that asks the sign-in screen to come back here.
 *
 * The router's location rather than `window.location`, so a redirect made
 * mid-navigation records where the visitor was going and not the page they are
 * being taken off. `createPath` keeps the search and the hash with the path,
 * which is what makes it an address: this app keeps the state that shapes a page
 * in the URL, so the path alone names a different page.
 */
export function returnTo(location: Location): { from: string } {
  return { from: createPath(location) };
}

/** Where to go now, for the screen that has just signed someone in. */
export function returnDestination(state: unknown): string {
  return (state as { from?: string } | null)?.from ?? "/";
}
