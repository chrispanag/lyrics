/*
 * Who this deployment says it is.
 *
 * Mostly for things that render on the *server*, where there is no page to be
 * relative to: a link-preview card is fetched by a scraper with no page context,
 * and a sitemap entry must be an absolute URL by specification. Next's
 * `metadataBase` resolves the relative URLs inside metadata and nothing else — a
 * sitemap entry does not read it, and neither does JSON-LD.
 *
 * `SITE_NAME` is the exception and is read by client components too, which is
 * why this is not "the server's module": `PageTitle` and `Wordmark` both import
 * it. The metadata constants do not follow them into the bundle — verified by
 * grepping the built client chunks for the card's filename, which is absent —
 * but that is the bundler's tree-shaking rather than anything stated here, so
 * this module is not the place to put something that must never reach a browser.
 */

/**
 * The origin this app is deployed on, written out because nothing can derive it.
 *
 * Deployment identity rather than a build input, which is what separates it from
 * NEXT_PUBLIC_API_BASE_URL — that one is left unset precisely so the bundle calls
 * whatever origin served it. Here the opposite is needed: the value has to be
 * right in a document nobody is reading from a browser.
 *
 * Two things stay outside and neither can be helped: `icons/og-card.svg` bakes
 * the domain into the picture itself, and `public/robots.txt` names the sitemap
 * in a directive the specification requires be absolute. So a rename visits this
 * constant, that drawing and that file — and this sentence is the inventory
 * CLAUDE.md warns prose inventories become, which is why there are only three
 * and why `make icons` redraws the second one.
 */
export const SITE_ORIGIN = "https://songfolio.live";

/**
 * The product name, in the one place the *server* says it.
 *
 * `PageTitle` and `Wordmark` read it too, both of them having argued for exactly
 * this in their own comments before there was anywhere to put it: a rename that
 * reaches one screen and misses another is silent, a tab or a sidebar rendering
 * perfectly well under last year's name. A link card is the worst of those to
 * miss, being the copy nothing in the app renders at all.
 */
export const SITE_NAME = "Songfolio";

/**
 * The link-preview picture.
 *
 * The four numbers are why it is worth naming once: a width that disagrees with
 * the file is a card most scrapers decline to draw at all, and a per-route copy
 * is four chances at that per route. Reached through `OG_BASE` below rather than
 * directly, which is what makes forgetting it impossible rather than unlikely.
 */
export const OG_IMAGE = {
  url: "/og-card.png",
  type: "image/png",
  width: 1200,
  height: 630,
  alt: `${SITE_NAME} — a Greek and English song lyrics catalog`,
};

/**
 * What every route's `openGraph` block has to restate, whatever else it says.
 *
 * A route's `openGraph` **replaces** the layout's rather than merging into it,
 * field by field, so a page naming `og:type` and `og:title` and stopping there
 * has silently dropped the card image and the site name with them. Sharing the
 * *pair* rather than the image alone is what closes that for the next route as
 * well as this one: spread this first and a block cannot be written that forgets
 * either half.
 */
export const OG_BASE = { siteName: SITE_NAME, images: [OG_IMAGE] };
