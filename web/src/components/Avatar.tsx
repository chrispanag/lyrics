import { avatarPalette, avatarSrc, initials, type Identity } from "@/lib/avatar";
import { cn } from "@/lib/cn";

const SIZES = {
  sm: "size-8 text-xs",
  md: "size-10 text-sm",
  lg: "size-20 text-2xl",
} as const;

/**
 * A user's picture, or their initials when they have none.
 *
 * Decides from `avatar_updated_at`, never from whether an image loaded.
 * `lg` is a page's focal picture, so it loads eagerly; every other size is lazy.
 * See "Profile pictures" in CLAUDE.md.
 */
export function Avatar({
  user,
  size = "sm",
  className,
}: {
  user: Identity;
  size?: keyof typeof SIZES;
  className?: string | undefined;
}) {
  const source = avatarSrc(user);
  const shared = cn("shrink-0 rounded-full", SIZES[size], className);

  if (!source) {
    return (
      <span
        // Decorative: the name is rendered beside it, or carried by the control
        // that wraps the picture (the profile's "Edit picture" button).
        aria-hidden
        className={cn(
          shared,
          "inline-flex items-center justify-center font-semibold",
          avatarPalette(user.id),
        )}
      >
        {initials(user)}
      </span>
    );
  }

  return (
    <img
      src={source}
      alt=""
      loading={size === "lg" ? "eager" : "lazy"}
      decoding="async"
      // The API stores squares; this covers any row that is not one.
      className={cn(shared, "aspect-square bg-muted object-cover")}
    />
  );
}
