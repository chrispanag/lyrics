import { getURLFromRedirectError } from "next/dist/client/components/redirect";
import type { ComponentType, ReactNode } from "react";

import NotFound from "@/app/not-found";
import { RouteParams, Redirect, usePathname } from "@/lib/navigation";
import { VerificationGate } from "@/routes/guards";
import { SongDetailPage } from "@/routes/SongDetailPage";
import { bestMatch } from "./match";

/*
 * The real route table, for specs: the app directory's own pages and layouts,
 * composed by where their files sit — route groups, nested layouts and all —
 * the way Next composes them. So a spec that walks addresses through this sees
 * exactly what position gives each screen (the shell, the app bar, the admin
 * guard), and a page moved to the wrong folder fails it.
 *
 * Three things a server does are stood in for. The root layout is not mounted
 * (it is the document, and loads a font from Google); its providers are what
 * `TestProviders` supplies, with the `VerificationGate` added here. An async
 * page — one that reads the API before rendering — is replaced by the screen
 * it renders, from `SERVER_PAGES`, since a browser renderer cannot await it
 * and its own spec calls it. And a page that calls `redirect()` is followed
 * with a client `Redirect`.
 */

type Module = { default: ComponentType<{ children?: ReactNode }> };

const pages = import.meta.glob<Module>("/src/app/**/page.tsx", { eager: true });
const layouts = import.meta.glob<Module>(["/src/app/**/layout.tsx", "!/src/app/layout.tsx"], {
  eager: true,
});

/** The screen each async page renders, by route pattern. */
const SERVER_PAGES: Record<string, ReactNode> = {
  "/songs/:id": <SongDetailPage />,
};

/** `/src/app/(shell)/songs/[id]/page.tsx` → its folders, `["(shell)", "songs", "[id]"]`. */
function folders(file: string): string[] {
  return file
    .replace(/^\/src\/app\//, "")
    .split("/")
    .slice(0, -1);
}

/** The URL pattern of a folder chain: groups dropped, `[id]` as `:id`. */
function patternOf(dirs: string[]): string {
  const parts = dirs
    .filter((dir) => !dir.startsWith("("))
    .map((dir) => dir.replace(/^\[(.+)\]$/, ":$1"));
  return `/${parts.join("/")}`;
}

const routes = Object.fromEntries(
  Object.entries(pages).map(([file, module]) => [patternOf(folders(file)), { file, module }]),
);

/** The layouts above a page, outermost first. */
function layoutsFor(file: string): Module[] {
  const page = folders(file);
  return Object.entries(layouts)
    .map(([path, module]) => ({ dirs: folders(path), module }))
    .filter(({ dirs }) => dirs.every((dir, index) => page[index] === dir))
    .sort((a, b) => a.dirs.length - b.dirs.length)
    .map(({ module }) => module);
}

function isAsync(component: unknown): boolean {
  return typeof component === "function" && component.constructor.name === "AsyncFunction";
}

/** A page's element, its redirect followed. */
function render(pattern: string, page: Module["default"]): ReactNode {
  if (isAsync(page)) {
    const standIn = SERVER_PAGES[pattern];
    if (!standIn) throw new Error(`No stand-in in SERVER_PAGES for the async page at ${pattern}`);
    return standIn;
  }
  try {
    // A server page takes no props and uses no hooks, so it can be called.
    return (page as () => ReactNode)();
  } catch (caught) {
    const to = getURLFromRedirectError(caught as never);
    if (to) return <Redirect href={to} />;
    throw caught;
  }
}

/** Whatever the app directory renders at the current address. */
export function TestApp() {
  return (
    <VerificationGate>
      <Route pathname={usePathname()} />
    </VerificationGate>
  );
}

function Route({ pathname }: { pathname: string }) {
  const match = bestMatch(Object.keys(routes), pathname);
  const route = match && routes[match.pattern];
  if (!match || !route) return <NotFound />;

  const tree = layoutsFor(route.file).reduceRight<ReactNode>(
    (children, { default: Layout }) => <Layout>{children}</Layout>,
    render(match.pattern, route.module.default),
  );
  return (
    <RouteParams key={match.pattern} params={match.params}>
      {tree}
    </RouteParams>
  );
}
