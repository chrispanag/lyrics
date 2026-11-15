import { ArrowLeft } from "lucide-react";
import { useRouter } from "@/lib/navigation";

import { cn } from "@/lib/cn";

/**
 * Returns to the previous page.
 *
 * Not in ui.tsx, which stays router-free so its primitives work outside a route.
 * `cn` is a plain join: `className` may only add non-colliding utilities.
 */
export function BackButton({ className }: { className?: string }) {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => router.back()}
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
