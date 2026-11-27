/*
 * Form-field chrome, shared with inputs that are not the <Input> primitive
 * (`SearchField`), since `cn` cannot override. No height, radius, padding or
 * width: those vary per call site. Kept out of ui.tsx for fast refresh.
 *
 * The border turns the focus color, so the focus ring sits against it rather
 * than off it (index.css's offset), or the two would read as a ring in a ring.
 */
export const fieldChrome =
  "border border-line-strong bg-surface text-fg placeholder:text-fg-subtle focus:border-focus focus-visible:outline-offset-0";
