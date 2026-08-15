import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { cn } from "@/lib/cn";

/**
 * Returns to the previous page.
 *
 * Its own module rather than ui.tsx, which is deliberately router-free: this is
 * the one control that needs useNavigate, and importing the router there would
 * make every primitive unusable outside a route.
 *
 * `className` is composed, not overridden — cn is a plain join, so callers may
 * only add utilities (spacing) that do not collide with the ones set here.
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
