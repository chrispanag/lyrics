export type Theme = "light" | "dark" | "system";

const THEME_KEY = "lyrics:theme";

const DARK_QUERY = "(prefers-color-scheme: dark)";

/**
 * Applies the theme by toggling a class on <html>.
 *
 * Called when the visitor changes it. The *first* application of a load is not
 * this function — it is `THEME_BOOT_SCRIPT` below, which has to restate the
 * rule because nothing bundled runs early enough. Doing it from a component
 * effect instead would paint the wrong theme and then correct it, which reads
 * as a flash on every load, and under Next the app arrives later still than it
 * did under Vite.
 */
export function applyTheme(theme: Theme): void {
  const dark = theme === "dark" || (theme === "system" && window.matchMedia(DARK_QUERY).matches);
  document.documentElement.classList.toggle("dark", dark);
}

/**
 * The same decision as `applyTheme(storedTheme())`, as source for an inline
 * `<script>` — rendered by app/layout.tsx into every document so the theme is
 * on `<html>` before the first paint.
 *
 * It lives here, beside the function it restates, because that is as close as
 * the two can get: this one cannot *call* anything, running before a line of
 * the bundle exists. Keeping them adjacent is what is left of sharing them, and
 * it is why the key and the media query above are interpolated rather than
 * spelled again — a wrong key is the half that fails silently and forever,
 * where a wrong predicate costs one flash. What is genuinely duplicated is the
 * rule, and changing it means changing both lines, which are now nine apart.
 *
 * The try/catch covers a browser refusing to hand its storage over, the same
 * reason `auth/storedUser.ts` wraps its own read: unthemed beats throwing
 * before the app has loaded.
 *
 * `let` rather than `var`, and that is not a style choice: an inline `<script>`
 * runs in global scope, where `var` inside a block is still function-scoped and
 * so lands on `window`. Two single-letter globals — `window.t` and `window.d` —
 * on every page in the app, waiting to collide with whatever else claims them.
 * `let` is scoped to the `try` block, which is where both are read.
 *
 * `theme.test.ts` pins this against `applyTheme(storedTheme())` case by case,
 * because the duplication above is only safe while the two agree, and nothing
 * else compares them — the same reason `youtube.test.ts` pins `extractVideoId`
 * against the Go parser it mirrors.
 */
export const THEME_BOOT_SCRIPT =
  `try{` +
  `let t=localStorage.getItem(${JSON.stringify(THEME_KEY)})??"system";` +
  `let d=t==="dark"||(t==="system"&&window.matchMedia(${JSON.stringify(DARK_QUERY)}).matches);` +
  `document.documentElement.classList.toggle("dark",d)` +
  `}catch(e){}`;

/**
 * The theme this browser was last set to, or "system" when it has not been set.
 *
 * Wrapped for the two reasons the boot script above is wrapped and
 * `auth/storedUser` says out loud: a browser can refuse to hand its storage
 * over, and — the day anything importing this renders on a server — there is no
 * storage to ask. "system" is what both fall back to, which is the answer a
 * visitor who has never chosen gets anyway.
 *
 * That is the one case where this and the boot script above deliberately part
 * company, and it is worth naming because everything else about them is held
 * to agreeing. The script's `try` wraps the whole rule including the
 * `classList.toggle`, so a browser refusing its storage gets no class at all
 * and paints light; `applyTheme(storedTheme())` would fall back to "system"
 * and honor `prefers-color-scheme`, so a dark machine would go dark. Nothing
 * reaches that today — `applyTheme` is called only from the theme switch, the
 * boot script being the whole of what runs on a load — so the divergence costs
 * nothing until someone restores a boot-time call, and `theme.test.ts` does not
 * cover it precisely because there is no answer yet about which of the two is
 * right.
 */
export function storedTheme(): Theme {
  try {
    return (localStorage.getItem(THEME_KEY) as Theme | null) ?? "system";
  } catch {
    return "system";
  }
}

/** Records the choice, for the boot script above to read on the next load. */
export function storeTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // A theme that cannot be remembered still applies to the page that set it.
  }
}
