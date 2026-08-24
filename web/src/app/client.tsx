"use client";

import dynamic from "next/dynamic";

// `ssr: false` is what keeps the react-router app client-only, and it is legal
// only inside a client component — which is the entire reason this module sits
// between a page and AppRoot, and why AppRoot needs no directive of its own:
// everything reached from here is a client component by inheritance, exactly as
// every file under routes/ and components/ already was. Every page stays a
// server component, which is what makes `generateMetadata` available to it — the
// whole of what `/songs/[id]` renders on the server today.
//
// It sits beside the routes rather than inside the catch-all's folder because it
// is no longer that page's alone: `/songs/[id]` and `/songs/new` have their own
// segments now — the first for its metadata, the second only to keep the first
// off the editor's address — and all three render this same boundary.
//
// Nothing is offered as a `loading` fallback on purpose: the document has always
// had a stretch with no app in it — index.html served an empty div for exactly
// as long — so this is the wait the app already had rather than a new one, and a
// spinner here would be the only chrome in the app that appears before its own
// layout.
export const ClientOnly = dynamic(() => import("@/AppRoot"), { ssr: false });
