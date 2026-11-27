export type Theme = "light" | "dark" | "system";

const THEME_KEY = "lyrics:theme";

const DARK_QUERY = "(prefers-color-scheme: dark)";

/**
 * The browser chrome's color per theme: the surface a phone's screens sit on,
 * so its bars match the page. app/layout.tsx reads them, and
 * public/manifest.json carries the dark one (theme.test.ts checks).
 */
export const THEME_COLORS = { light: "#ffffff", dark: "#1c1917" } as const;

/**
 * Our own unscoped `theme-color` meta, present only while the theme is explicit.
 * Prepended to <head>: the browser takes the first match in tree order, so it
 * outranks the media-scoped pair from layout.tsx's `viewport`, and "system"
 * removes it to hand back to them.
 */
const THEME_COLOR_ID = "theme-color-override";

/**
 * The override's colors, deliberately spelled differently from `THEME_COLORS`.
 * React hydrates a `<meta>` by adopting the first one in the document with the
 * same `name` and `content` string, checking neither `media` nor `id` — so an
 * override spelled like the viewport's becomes React's instance of one of the
 * media-scoped pair, and React later updating or removing that meta acts on
 * ours (and throws if "system" has already removed it). Same color, other key.
 */
const OVERRIDE_COLORS = {
  light: THEME_COLORS.light.toUpperCase(),
  dark: THEME_COLORS.dark.toUpperCase(),
} as const;

/**
 * Applies the theme, when the visitor changes it: the class on <html> and the
 * browser chrome's color. The first application of a load is `THEME_BOOT_SCRIPT`.
 */
export function applyTheme(theme: Theme): void {
  const dark = theme === "dark" || (theme === "system" && window.matchMedia(DARK_QUERY).matches);
  document.documentElement.classList.toggle("dark", dark);
  let meta = document.getElementById(THEME_COLOR_ID) as HTMLMetaElement | null;
  if (theme === "system") {
    meta?.remove();
    return;
  }
  if (!meta) {
    meta = document.createElement("meta");
    meta.id = THEME_COLOR_ID;
    meta.name = "theme-color";
    document.head.prepend(meta);
  }
  meta.content = dark ? OVERRIDE_COLORS.dark : OVERRIDE_COLORS.light;
}

/**
 * The same decision as `applyTheme(storedTheme())`, as source for the inline
 * `<script>` app/layout.tsx renders so the theme is set before first paint.
 *
 * Mirrors `applyTheme`; change both (`theme.test.ts` holds them together). `let`,
 * not `var`: an inline script runs in global scope, where `var` lands on `window`.
 */
export const THEME_BOOT_SCRIPT =
  `try{` +
  `let t=localStorage.getItem(${JSON.stringify(THEME_KEY)})??"system";` +
  `let d=t==="dark"||(t==="system"&&window.matchMedia(${JSON.stringify(DARK_QUERY)}).matches);` +
  `document.documentElement.classList.toggle("dark",d);` +
  // Nothing renders the override, so at boot there is none to find or remove.
  `if(t!=="system"){` +
  `let m=document.createElement("meta");m.id=${JSON.stringify(THEME_COLOR_ID)};m.name="theme-color";` +
  `m.content=d?${JSON.stringify(OVERRIDE_COLORS.dark)}:${JSON.stringify(OVERRIDE_COLORS.light)};` +
  `document.head.prepend(m)` +
  `}` +
  `}catch(e){}`;

/**
 * The theme this browser was last set to, or "system" when it has not been set
 * or storage is unavailable.
 *
 * Known divergence: with storage blocked, the boot script paints light while
 * `applyTheme(storedTheme())` would follow the system. Unreached today, since
 * `applyTheme` only runs from the theme switch.
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
