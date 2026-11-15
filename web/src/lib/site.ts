/*
 * Who this deployment says it is, mostly for server-rendered output that needs
 * absolute URLs (`metadataBase` does not reach sitemaps or JSON-LD).
 *
 * Client components import `SITE_NAME` too, so nothing secret belongs here.
 */

/**
 * The origin this app is deployed on, written out because nothing can derive it.
 *
 * The domain is also baked into `icons/og-card.svg` and `public/robots.txt`.
 */
export const SITE_ORIGIN = "https://songfolio.live";

/** The product name, written once so a rename cannot miss a screen. */
export const SITE_NAME = "Songfolio";

/**
 * The site in a sentence, as a link preview says it. Shared because a route
 * that sets `openGraph` restates it: the layout's block is replaced, not merged.
 */
export const SITE_SUMMARY =
  "A Greek and English song lyrics catalog: browse, search, and collect songs into lists.";

/**
 * The link-preview picture. Its dimensions must match the file, or scrapers
 * decline to draw the card. Use it through `OG_BASE`.
 */
export const OG_IMAGE = {
  url: "/og-card.png",
  type: "image/png",
  width: 1200,
  height: 630,
  alt: `${SITE_NAME} — a Greek and English song lyrics catalog`,
};

/**
 * What every route's `openGraph` block has to spread first: a route's
 * `openGraph` **replaces** the layout's, silently dropping the image and site name.
 */
export const OG_BASE = { siteName: SITE_NAME, images: [OG_IMAGE] };
