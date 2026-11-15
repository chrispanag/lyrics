"use client";

import type { ReactNode } from "react";

import { useAppMounted } from "@/lib/appMounted";

/**
 * Server-rendered content standing in for the app until it mounts.
 *
 * Unmounted, not hidden, before the app's first paint: a `<title>` inside goes
 * with it, so `PageTitle` is the only title left. Its own module, since
 * Biome does not read `ClientOnly`'s `dynamic()` as a component.
 */
export function UntilAppMounts({ children }: { children: ReactNode }) {
  return useAppMounted() ? null : children;
}
