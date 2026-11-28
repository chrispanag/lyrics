"use client";

import { Minus, Plus, Type } from "lucide-react";

import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  DEFAULT_FONT_SIZE,
  FONT_SIZES,
  applyFontSize,
  drawnFontSize,
  storeFontSize,
} from "@/lib/fontSize";
import { useStoredState } from "@/lib/useStoredState";

/**
 * The lyrics' text size, one step at a time. The lyrics are sized by CSS from
 * the attribute the boot script set before first paint (lib/fontSize); the
 * state here only decides where the buttons stop.
 *
 * A fieldset is the native group; preflight zeroes its border, margin and
 * padding. Named by `aria-label`, not a <legend>: the controls are icons, and
 * a visible "Text size" would crowd the song's tools bar it sits in.
 * `className` may only add non-colliding utilities, such as a margin.
 */
export function TextSizeControl({ className }: { className?: string }) {
  const [index, setIndex] = useStoredState(DEFAULT_FONT_SIZE, drawnFontSize);

  const step = (by: number) => {
    const next = Math.max(0, Math.min(FONT_SIZES.length - 1, index + by));
    setIndex(next);
    applyFontSize(next);
    storeFontSize(next);
  };

  return (
    <fieldset className={cn("flex items-center", className)} aria-label="Text size">
      <Type aria-hidden className="mr-1 size-4 text-fg-subtle" />
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => step(-1)}
        disabled={index === 0}
        aria-label="Decrease text size"
      >
        <Minus aria-hidden className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => step(1)}
        disabled={index === FONT_SIZES.length - 1}
        aria-label="Increase text size"
      >
        <Plus aria-hidden className="size-4" />
      </Button>
    </fieldset>
  );
}
