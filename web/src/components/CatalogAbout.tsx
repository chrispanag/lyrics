import { CATALOG_ABOUT } from "@/lib/catalogCopy";

const linkClass = "font-medium text-fg-accent hover:underline";

/**
 * Catalog prose in the server HTML. Song cards carry the entries; this carries
 * what the catalog is, so a document with no songs yet is still a page.
 * Rendered after the list, under the page's h1.
 */
export function CatalogAbout() {
  return (
    <section
      aria-labelledby="catalog-about"
      className="mx-auto max-w-3xl space-y-3 px-4 pb-10 text-sm leading-relaxed text-fg-secondary"
    >
      <h2 id="catalog-about" className="text-base font-semibold text-fg">
        About the catalog
      </h2>
      {CATALOG_ABOUT.map((paragraph) => (
        <p key={paragraph}>{paragraph}</p>
      ))}
      <p>
        Programs can read the same catalog without rendering this page. The{" "}
        <a className={linkClass} href="/llms.txt">
          agent guide
        </a>{" "}
        describes every address, the{" "}
        <a className={linkClass} href="/sitemap.xml">
          sitemap
        </a>{" "}
        lists every song, and the{" "}
        <a className={linkClass} href="/openapi.json">
          OpenAPI specification
        </a>{" "}
        describes the JSON API and the{" "}
        <a className={linkClass} href="/.well-known/oauth-protected-resource">
          OAuth scopes
        </a>{" "}
        a client can request.
      </p>
    </section>
  );
}
