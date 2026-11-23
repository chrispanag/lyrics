"use client";

import { listInView } from "@/lib/listContext";
import { usePathname, useSearchParams } from "@/lib/navigation";
import { BrowsePage } from "@/routes/BrowsePage";
import { ListDetailPage } from "@/routes/ListsPages";

/**
 * The songs beside a song opened by its own address: the list it is being read
 * from, or the catalog when it names none. Following a song from a list or the
 * catalog keeps the one already on screen; loading the song directly has none
 * to keep, so this reads the address it lands on, the way the list and the
 * catalog read theirs.
 */
export function SongsPane() {
  return listInView(usePathname(), useSearchParams()) ? <ListDetailPage /> : <BrowsePage />;
}
