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
 * One component for every place a user is shown, so the fallback cannot differ
 * between the sidebar, the profile screen and the admin console — and so the
 * decision between the two is made once, from `avatar_updated_at`.
 *
 * Eagerness is the second decision made here, and it is read off `size` rather
 * than passed in. `lg` is only ever a page's focal picture — the profile
 * screen's own — and deferring the one image a page is about is the failure:
 * the browser holds it back behind layout, and it is the element the upload
 * flow is watching change. A prop with a lazy default would put that choice
 * back at the call site, which is where it went wrong to begin with — nothing
 * chose lazy for the focal picture, it was simply what the default said, and
 * the next focal screen would inherit the same silence. If `lg` is ever used
 * somewhere that is *not* focal, the cost is eager fetches of pictures that may
 * be below the fold: bounded, and visible in the network panel rather than
 * silent. The fix then is to make eagerness its own parameter, not to hand a
 * focal image back a lazy default nobody chose.
 */
export function Avatar({
  user,
  size = "sm",
  className,
}: {
  user: Identity;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const source = avatarSrc(user);
  const shared = cn("shrink-0 rounded-full", SIZES[size], className);

  if (!source) {
    return (
      <span
        // Decorative: the name this belongs to is always rendered beside it, so
        // announcing the initials as well would read the same person twice.
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
      // Belt and suspenders: the API crops every picture to a square before
      // storing it, and this keeps a row written before it did — or by anything
      // that ever bypasses it — from stretching a face across the circle.
      className={cn(shared, "aspect-square bg-stone-200 object-cover dark:bg-stone-800")}
    />
  );
}
