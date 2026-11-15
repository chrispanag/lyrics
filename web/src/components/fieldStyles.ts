/*
 * Form-field chrome, shared with inputs that are not the <Input> primitive
 * (`SearchField`), since `cn` cannot override. No height, radius, padding or
 * width: those vary per call site. Kept out of ui.tsx for fast refresh.
 */
export const fieldChrome =
  "border border-stone-300 bg-white text-stone-900 " +
  "placeholder:text-stone-400 focus:border-brand-500 " +
  "dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:placeholder:text-stone-500";
