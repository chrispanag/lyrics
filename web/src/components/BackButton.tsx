import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "@/lib/navigation";

import { useAuth } from "@/auth/useAuth";
import { cn } from "@/lib/cn";
import { upHref } from "@/lib/listContext";

/**
 * Returns to the previous screen, or, where nothing in the app is behind this
 * one, to the screen above it (`Router.back`).
 *
 * Not in ui.tsx, which stays router-free so its primitives work outside a route.
 * `cn` is a plain join: `className` may only add non-colliding utilities.
 * `children` replaces the word "Back", for a Back that says where it leads,
 * and `label` is then its name, which must still start with "Back".
 */
export function BackButton({
  className,
  children = "Back",
  label,
}: {
  className?: string;
  children?: ReactNode;
  label?: string | undefined;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { user } = useAuth();

  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => router.back(upHref(pathname, searchParams, { signedIn: Boolean(user) }))}
      className={cn(
        "-ml-2 flex min-w-0 items-center gap-1 rounded-compact p-2 text-sm text-fg-tertiary hover:bg-subtle",
        className,
      )}
    >
      <ArrowLeft aria-hidden className="size-4 shrink-0" />
      {children}
    </button>
  );
}
