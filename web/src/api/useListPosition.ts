import { useList } from "@/api/hooks";
import { useAuth } from "@/auth/useAuth";
import { listInView, listPosition, songRefFromPath } from "@/lib/listContext";
import { usePathname, useSearchParams } from "@/lib/navigation";

/**
 * The song at the address, the list it is read from or the list's own page
 * (`listInView`), and where the song sits in that list. Null `position` off a
 * song, off a list, and for a song the list does not hold.
 *
 * The song page and the bottom bar's pill both read it, so they ask for the
 * list under one key and agree on the place: the pill asks for nothing the
 * page has not. After the session settles, since a private list needs it.
 *
 * Its own module rather than `hooks.ts`, which server components import for
 * `queries` and which must not reach the routing seam or the session.
 */
export function useListPosition() {
  const { loading } = useAuth();
  const pathname = usePathname();
  const params = useSearchParams();
  const ref = songRefFromPath(pathname) ?? undefined;
  const { data: list } = useList(listInView(pathname, params) ?? undefined, !loading);
  const position = list && ref ? listPosition(list, ref) : null;
  return { ref, list, position };
}
