import { Fragment } from "react";

import { parseSegments } from "@/lib/snippet";

/**
 * Renders a search snippet with its matches highlighted.
 *
 * Builds elements from parsed segments rather than setting HTML, so lyrics
 * containing markup are displayed rather than executed. See lib/snippet.ts for
 * why the API delimits matches with sentinels instead of tags.
 */
export function Snippet({ text, className }: { text: string; className?: string }) {
  return (
    <p className={className}>
      {parseSegments(text).map((segment, index) => (
        <Fragment key={index}>
          {segment.highlighted ? (
            <mark className="rounded bg-brand-200/70 px-0.5 font-medium text-stone-900 dark:bg-brand-500/40 dark:text-stone-50">
              {segment.text}
            </mark>
          ) : (
            segment.text
          )}
        </Fragment>
      ))}
    </p>
  );
}
