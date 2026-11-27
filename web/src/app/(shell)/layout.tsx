import { Layout } from "@/components/Layout";

/*
 * The shell — navigation rail, bottom bar, scroll-to-top — around every screen in this
 * group, and only those. The auth screens sit outside it in `(auth)`: they have
 * no navigation. A layout persists across navigations inside it, so the
 * rail does not remount from one screen to the next.
 */
export default function ShellLayout({ children }: { children: React.ReactNode }) {
  return <Layout>{children}</Layout>;
}
