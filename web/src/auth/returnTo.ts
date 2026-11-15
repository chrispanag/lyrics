import { createPath, type Location } from "react-router-dom";

/*
 * Where signing in sends a visitor afterwards. One module for every writer and
 * the reader, so the address (search string included) means the same everywhere.
 */

/**
 * The router state that asks the sign-in screen to come back here. The router's
 * location, not `window.location`, so a mid-navigation redirect records the
 * destination; `createPath` keeps search and hash.
 */
export function returnTo(location: Location): { from: string } {
  return { from: createPath(location) };
}

/** Where to go now, for the screen that has just signed someone in. */
export function returnDestination(state: unknown): string {
  return (state as { from?: string } | null)?.from ?? "/";
}
