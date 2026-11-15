"use client";

import dynamic from "next/dynamic";

// `ssr: false` keeps the react-router app client-only (CLAUDE.md, The Next.js
// shell) and is legal only in a client component, hence this module between
// the pages and AppRoot. No `loading` fallback, on purpose.
export const ClientOnly = dynamic(() => import("@/AppRoot"), { ssr: false });
