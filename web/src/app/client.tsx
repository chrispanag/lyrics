"use client";

import dynamic from "next/dynamic";

// `ssr: false` keeps the react-router app client-only (CLAUDE.md, The Next.js
// shell) and is legal only in a client component, hence this module between
// the pages and AppRoot. No `loading` fallback: a spinner would be the only
// chrome to appear before the app's own layout.
export const ClientOnly = dynamic(() => import("@/AppRoot"), { ssr: false });
