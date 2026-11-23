import { SongsPane } from "@/routes/SongsPane";

/*
 * The songs beside a song opened by its own address, which no page of the slot
 * matches: the list its `?list=` names, or else the catalog. A default is
 * handed no search params, so the pane reads the address itself.
 */
export default function SongsBesideSong() {
  return <SongsPane />;
}
