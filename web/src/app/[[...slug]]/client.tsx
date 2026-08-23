"use client";

import dynamic from "next/dynamic";

// `ssr: false` is what keeps the react-router app client-only, and it is legal
// only inside a client component — which is the entire reason this module sits
// between page.tsx and AppRoot, and why AppRoot needs no directive of its own:
// everything reached from here is a client component by inheritance, exactly as
// every file under routes/ and components/ already was. page.tsx stays a server
// component so `generateMetadata` is available to it when routes start being
// server-rendered.
//
// Nothing is offered as a `loading` fallback on purpose: the document has always
// had a stretch with no app in it — index.html served an empty div for exactly
// as long — so this is the wait the app already had rather than a new one, and a
// spinner here would be the only chrome in the app that appears before its own
// layout.
export const ClientOnly = dynamic(() => import("@/AppRoot"), { ssr: false });
