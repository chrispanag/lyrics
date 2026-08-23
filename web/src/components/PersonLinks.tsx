import { Link } from "react-router-dom";

import { browseHref } from "@/lib/browse";

/**
 * A comma-separated run of people, each linked to the catalog filtered by them.
 *
 * Three places render this same line — the song page's "Performed by" row, its
 * authorship rows, and the recordings sheet — and each one spelled out the
 * separator, the hover treatment and the destination itself. The destination is
 * the load-bearing part: `?person=` is the parameter browse has to read, and a
 * link built by hand with the wrong one still answers, with the unfiltered
 * catalog, which reads as "this artist is on every song" rather than as a broken
 * link.
 *
 * The prop is structural rather than a named type, so a `Credit` and a
 * `RecordingPerformer` both satisfy it without this component knowing which of
 * the two tables a name came out of.
 */
export function PersonLinks({
  people,
  onNavigate,
}: {
  people: { person_id: string; name: string }[];
  onNavigate?: () => void;
}) {
  return (
    <>
      {people.map((person, index) => (
        <span key={person.person_id}>
          {index > 0 && ", "}
          <Link
            to={browseHref({ person: person.person_id })}
            // The sheet has to close on its way out — it is a modal, and the
            // navigation happens underneath it. Nothing to do on the song page,
            // which is why this is optional rather than required of both.
            onClick={onNavigate}
            className="hover:text-brand-600 hover:underline"
          >
            {person.name}
          </Link>
        </span>
      ))}
    </>
  );
}
