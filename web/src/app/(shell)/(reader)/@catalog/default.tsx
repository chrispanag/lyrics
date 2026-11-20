import { BrowsePage } from "@/routes/BrowsePage";

/*
 * The list beside a song opened by its own address. Following a song from the
 * catalog keeps the list already on screen; loading the song directly has no
 * list to keep, so this is that catalog, read from the address it lands on.
 */
export default function CatalogBesideSong() {
  return <BrowsePage />;
}
