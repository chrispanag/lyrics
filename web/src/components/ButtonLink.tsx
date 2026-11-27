"use client";

import type { ComponentProps } from "react";

import { type ButtonSize, type ButtonVariant, buttonClasses } from "@/components/buttonStyles";
import { Link } from "@/lib/navigation";

/**
 * A link in the app drawn as a button: a `Link`, never an anchor in a
 * `<button>`, which is invalid. A client module, so a server component such as
 * the root `not-found.tsx` can render it too.
 */
export function ButtonLink({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <Link className={buttonClasses(variant, size, className)} {...props} />;
}
