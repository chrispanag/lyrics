"use client";

import { PageTitle } from "@/components/PageTitle";
import { EmptyState } from "@/components/ui";

/** An address no route answers. Named, or the tab keeps the previous page's title. */
export function NotFoundPage() {
  return (
    <>
      <PageTitle name="Page not found" />
      <EmptyState title="Page not found" description="That link does not lead anywhere." />
    </>
  );
}
