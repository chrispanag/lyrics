import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";

import { SESSION_BOOT_SCRIPT } from "@/auth/storedUser";
import { FONT_SIZE_BOOT_SCRIPT } from "@/lib/fontSize";
import { NAV_COLLAPSED_BOOT_SCRIPT } from "@/lib/navCollapsed";
import { OG_BASE, SITE_NAME, SITE_ORIGIN, SITE_SUMMARY } from "@/lib/site";
import { THEME_BOOT_SCRIPT, THEME_COLORS } from "@/lib/theme";
import "@/styles/index.css";

import { Providers } from "./Providers";

/*
 * Every route renders per request. The shell reads the search string through
 * `useSearchParams`, and on a route Next prerenders that hands the whole tree
 * up to the nearest Suspense boundary to the browser — the server HTML would be
 * an empty shell again. Per request, it renders with the real search params.
 */
export const dynamic = "force-dynamic";

// Self-hosted at build time; `--font-sans` in styles/index.css reads the
// variable. Greek because most of the catalog is.
const inter = Inter({ subsets: ["latin", "greek"], variable: "--font-inter" });

export const metadata: Metadata = {
  // No `title` here or in any route: `PageTitle` names every screen, and a
  // second mechanism means two <title>s racing for `document.title`. See
  // CLAUDE.md, Head assets.
  description: `${SITE_NAME} is a Greek and English song lyrics catalog: browse, search, and collect songs into lists.`,
  // manifest.json rather than .webmanifest: every server knows the .json type.
  manifest: "/manifest.json",
  // .ico first: a browser takes the last entry it supports, so SVG wins where read.
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "32x32" },
      { url: "/favicon.svg", type: "image/svg+xml" },
    ],
    apple: "/apple-touch-icon.png",
  },
  // Resolves metadata's relative URLs (scrapers need absolute ones) and nothing
  // else. A route's openGraph replaces this block, hence the shared `OG_BASE`.
  metadataBase: new URL(SITE_ORIGIN),
  openGraph: {
    ...OG_BASE,
    type: "website",
    url: "/",
    title: SITE_NAME,
    description: SITE_SUMMARY,
  },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Lets the layout extend under the notch and home indicator; the safe-area
  // insets in styles/index.css keep content clear of them.
  viewportFit: "cover",
  // Read before any CSS arrives, so the first canvas can already be dark. Both,
  // because the theme is the reader's; html's color-scheme decides from there.
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: THEME_COLORS.dark },
    { media: "(prefers-color-scheme: light)", color: THEME_COLORS.light },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // lang is the chrome's; SongDetailPage marks each song's own. Change both or
    // neither. suppressHydrationWarning: the boot scripts edit this element.
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body>
        {/* Must run before anything with a background color paints, the
            lyrics at their default size, a collapsed navigation column, or a
            signed-in reader's Sign in. Four scripts' worth of source in one
            tag; each has its own try. */}
        <script
          // biome-ignore lint/security/noDangerouslySetInnerHtml: constants written here, with no input in them.
          dangerouslySetInnerHTML={{
            __html:
              THEME_BOOT_SCRIPT +
              FONT_SIZE_BOOT_SCRIPT +
              NAV_COLLAPSED_BOOT_SCRIPT +
              SESSION_BOOT_SCRIPT,
          }}
        />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
