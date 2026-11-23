import { SongsPane } from "@/routes/SongsPane";

/*
 * The list beside a song opened by its own address. Following a song from the
 * catalog or a list keeps the one already on screen; loading the song directly
 * has none to keep, so this is the list its `?list=` names, or else the
 * catalog. A default is handed no search params, so the pane reads the
 * address itself.
 */
export default function SongsBesideSong() {
  return <SongsPane />;
}
