import { Layout } from "@/components/Layout";
import { MenuHeader } from "@/components/SearchHeader";
import { NotFoundPage } from "@/routes/NotFoundPage";

/*
 * Every address no route answers, with a real 404 and Next's `noindex`. The
 * root's not-found renders inside the root layout alone, outside the route
 * groups, so it composes the shell and its app bar itself: a reader who
 * followed a dead link still needs a way off it on a phone. A song the API
 * says does not exist has its own, under `(shell)/songs/[id]`.
 */
export default function NotFound() {
  return (
    <Layout>
      <MenuHeader />
      <NotFoundPage />
    </Layout>
  );
}
