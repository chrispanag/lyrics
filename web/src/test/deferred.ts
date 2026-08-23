/*
 * A response held open until the spec lets it through.
 *
 * Every assertion about what is on screen *while* a request is in flight needs
 * the flight to last, and a delay is the wrong instrument: it holds on a fast
 * machine and quietly stops holding on a slow one, so the spec still passes
 * while asserting nothing. Awaiting this inside a handler and releasing it when
 * the assertions are done makes the wait a fact rather than a bet on timing.
 *
 * Shared because specs across two files reach for it — the song page's chrome,
 * its list navigation, and the profile sheet closing before an upload lands.
 * Deliberately not counted: the next spec to hold a response open makes a number
 * here wrong, and a count in prose is the one thing in a comment that goes stale
 * without anybody touching the line it is on.
 *
 * `Promise.withResolvers` is this and nothing else, but it needs the ES2024 lib
 * and `tsconfig.json` stands at ES2022.
 */
export function deferred(): [Promise<void>, () => void] {
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });

  return [held, release];
}
