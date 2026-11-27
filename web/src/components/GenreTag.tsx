"use client";

import { tagChrome, tagLinkChrome } from "@/components/cardStyles";
import { genrePageHref } from "@/lib/browse";
import { Link } from "@/lib/navigation";
import type { Genre } from "@/lib/types";

/**
 * A song's genre, drawn alike wherever it is shown. A link to the genre's page
 * where `linked`; plain inside something that is already a link, such as a song
 * card, since a link inside a link is invalid.
 */
export function GenreTag({
  genre,
  linked = false,
}: {
  genre: Pick<Genre, "name" | "slug">;
  linked?: boolean;
}) {
  if (!linked) return <span className={tagChrome}>{genre.name}</span>;
  return (
    <Link href={genrePageHref(genre.slug)} className={tagLinkChrome}>
      {genre.name}
    </Link>
  );
}
