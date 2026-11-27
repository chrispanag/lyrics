import { ButtonLink } from "@/components/ButtonLink";
import { PageTitle } from "@/components/PageTitle";
import { EmptyState } from "@/components/ui";

import PlainLayout from "./(shell)/(plain)/layout";
import ShellLayout from "./(shell)/layout";

/*
 * Every address no route answers, with a real 404 and Next's `noindex`. The
 * root's not-found renders inside the root layout alone, outside the route
 * groups, so it mounts the two group layouts itself: a reader who followed a
 * dead link still needs a way off it on a phone. A song the API says does not
 * exist has its own, under `(shell)/(reader)/songs/[id]`.
 */
export default function NotFound() {
  return (
    <ShellLayout>
      <PlainLayout>
        {/* Named, or the tab keeps the previous page's title. */}
        <PageTitle name="Page not found" />
        <EmptyState
          title="Page not found"
          description="That link does not lead anywhere."
          action={
            <ButtonLink href="/" variant="secondary" size="sm">
              Browse songs
            </ButtonLink>
          }
        />
      </PlainLayout>
    </ShellLayout>
  );
}
