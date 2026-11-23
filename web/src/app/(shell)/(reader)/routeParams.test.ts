import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/*
 * The reader keeps a segment of its `@catalog` slot (a list) mounted beside a
 * song, and Next merges the params of every active segment into `useParams`.
 * Two routes with a dynamic segment of one name would hand a page the other's
 * value, which the test router, answering for one page at a time, never shows.
 * The song page reads the address instead, but the names are kept apart here
 * too. One route in both the slot and the page (`lists/[listId]`) is one
 * address, so it counts once.
 */

/** The address of each dynamic segment under `dir`, e.g. `/lists/[listId]`. */
function dynamicRoutes(dir: string, at = ""): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      // Slots and groups are not part of the address.
      const route = /^[@(]/.test(entry.name) ? at : `${at}/${entry.name}`;
      const nested = dynamicRoutes(path.join(dir, entry.name), route);
      return entry.name.startsWith("[") ? [route, ...nested] : nested;
    });
}

describe("the reader's routes", () => {
  it("give each route's dynamic segment a name no other route uses", () => {
    const routes = new Set(dynamicRoutes(import.meta.dirname));
    const names = [...routes].map((route) => route.slice(route.lastIndexOf("/") + 1));

    expect(routes).toContain("/lists/[listId]");
    expect(names).toEqual([...new Set(names)]);
  });
});
