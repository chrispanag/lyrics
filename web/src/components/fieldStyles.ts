/*
 * Form-field chrome, in its own module so it can be shared with inputs that are
 * not the <Input> primitive.
 *
 * The browse search box needs its own height and corner radius, and cn() is a
 * plain join rather than tailwind-merge — so it cannot pass overrides through
 * <Input> without both values landing in the class list and CSS source order
 * deciding the winner. Sharing the chrome instead of the whole recipe is what
 * lets it differ where it must while staying in step everywhere else; before
 * this, that one input had already lost its dark-mode placeholder color.
 *
 * Chrome only, deliberately: no height, radius, padding, or width, since those
 * are what each call site varies. Kept out of ui.tsx because that file exports
 * only components, which is what keeps fast refresh working.
 */
export const fieldChrome =
  "border border-stone-300 bg-white text-stone-900 " +
  "placeholder:text-stone-400 focus:border-brand-500 " +
  "dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:placeholder:text-stone-500";
