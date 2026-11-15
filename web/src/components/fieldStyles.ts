/*
 * Form-field chrome, shared with inputs that are not the <Input> primitive
 * (`SearchField`), since `cn` cannot override. No height, radius, padding or
 * width: those vary per call site. Kept out of ui.tsx for fast refresh.
 */
export const fieldChrome =
  "border border-line-strong bg-surface text-fg placeholder:text-fg-subtle focus:border-focus";
