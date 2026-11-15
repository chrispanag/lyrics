import { Link } from "react-router-dom";

import { browseHref } from "@/lib/browse";

/**
 * A comma-separated run of people, each linked to the catalog filtered by them.
 *
 * Shared so the destination is built in one place: a link with the wrong
 * parameter still answers, with the unfiltered catalog.
 *
 * The prop is structural so both a `Credit` and a `RecordingPerformer` fit.
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
            // Lets a modal close itself, since the navigation happens beneath it.
            onClick={onNavigate}
            className="hover:text-fg-accent hover:underline"
          >
            {person.name}
          </Link>
        </span>
      ))}
    </>
  );
}
