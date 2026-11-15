import { ArrowLeft } from "lucide-react";
import { useNavigate } from "@/lib/navigation";

import { cn } from "@/lib/cn";

/**
 * Returns to the previous page.
 *
 * Not in ui.tsx, which stays router-free so its primitives work outside a route.
 * `cn` is a plain join: `className` may only add non-colliding utilities.
 */
export function BackButton({ className }: { className?: string }) {
  const navigate = useNavigate();

  return (
    <button
      type="button"
      onClick={() => navigate(-1)}
      className={cn(
        "-ml-2 flex items-center gap-1 rounded-lg p-2 text-sm text-stone-600 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800",
        className,
      )}
    >
      <ArrowLeft aria-hidden className="size-4" />
      Back
    </button>
  );
}
