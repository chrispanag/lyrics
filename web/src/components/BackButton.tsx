import { ArrowLeft } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "@/lib/navigation";

import { cn } from "@/lib/cn";
import { upHref } from "@/lib/listContext";

/**
 * Returns to the previous screen, and never out of the app: where nothing in
 * the app is behind this one (a link opened in a fresh tab, or Back already
 * taken to the first screen), it replaces this screen with the one above it.
 *
 * Not in ui.tsx, which stays router-free so its primitives work outside a route.
 * `cn` is a plain join: `className` may only add non-colliding utilities.
 */
export function BackButton({ className }: { className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return (
    <button
      type="button"
      onClick={() => {
        if (router.canGoBack()) router.back();
        else router.replace(upHref(pathname, searchParams));
      }}
      className={cn(
        "-ml-2 flex items-center gap-1 rounded-compact p-2 text-sm text-fg-tertiary hover:bg-subtle",
        className,
      )}
    >
      <ArrowLeft aria-hidden className="size-4" />
      Back
    </button>
  );
}
