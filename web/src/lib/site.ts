/*
 * Who this deployment says it is.
 *
 * Both values below are read by things that render on the *server*, where there
 * is no page to be relative to: a link-preview card is fetched by a scraper with
 * no page context, and a sitemap entry must be an absolute URL by
 * specification. Next's `metadataBase` resolves the relative URLs inside
 * metadata and nothing else — a sitemap entry does not read it, and neither does
 * JSON-LD.
 */

/**
 * The origin this app is deployed on, written out because nothing can derive it.
 *
 * Deployment identity rather than a build input, which is what separates it from
 * NEXT_PUBLIC_API_BASE_URL — that one is left unset precisely so the bundle calls
 * whatever origin served it. Here the opposite is needed: the value has to be
 * right in a document nobody is reading from a browser.
 *
 * Shared because it was already written in two places and the sitemap and a
 * song's JSON-LD wanted two more. What stays outside is `icons/og-card.svg`,
 * which bakes the domain into the picture itself — so a rename visits this
 * constant and that drawing, and `make icons` is what redraws the second.
 */
export const SITE_ORIGIN = "https://songfolio.live";

/**
 * The link-preview picture, shared for a reason particular to Next's metadata.
 *
 * A route's `openGraph` **replaces** the layout's rather than merging into it,
 * field by field — so a song page that names `og:type` and `og:title` and stops
 * there has silently dropped the card image and the site name along with them.
 * Every route that opens an `openGraph` block therefore restates the image, and
 * restating it from here is what keeps the four numbers in it from being four
 * numbers per route: a width that disagrees with the file is a card most
 * scrapers decline to draw at all.
 */
export const OG_IMAGE = {
  url: "/og-card.png",
  type: "image/png",
  width: 1200,
  height: 630,
  alt: "Songfolio — a Greek and English song lyrics catalog",
};
