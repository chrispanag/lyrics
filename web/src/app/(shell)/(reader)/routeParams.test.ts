import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/*
 * The reader keeps a segment of its `@catalog` slot (a list) mounted beside a
 * song, and Next merges the params of every active segment. Two routes with a
 * dynamic segment of one name would hand the song page the list's id, which the
 * test router, answering for one page at a time, never shows. So the names are
 * kept apart here. One route in both the slot and the page (`lists/[listId]`)
 * is one address, and one value, so it may repeat its name.
 */

/** Each dynamic segment under `dir`: its name, and the address it sits at. */
function dynamicSegments(dir: string, at = ""): { name: string; route: string }[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      // Slots and groups are not part of the address.
      const part = /^[@(]/.test(entry.name) ? "" : `/${entry.name}`;
      const route = `${at}${part}`;
      const name = /^\[+\.{0,3}([^\]]+)\]+$/.exec(entry.name)?.[1];
      const nested = dynamicSegments(path.join(dir, entry.name), route);
      return name ? [{ name, route }, ...nested] : nested;
    });
}

describe("the reader's routes", () => {
  it("give each route's dynamic segment a name no other route uses", () => {
    const routesByName = new Map<string, Set<string>>();
    for (const { name, route } of dynamicSegments(import.meta.dirname)) {
      routesByName.set(name, (routesByName.get(name) ?? new Set()).add(route));
    }

    expect(routesByName.get("listId")).toEqual(new Set(["/lists/[listId]"]));
    const shared = [...routesByName].filter(([, routes]) => routes.size > 1);
    expect(shared).toEqual([]);
  });
});
