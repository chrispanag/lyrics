export type Theme = "light" | "dark" | "system";

const THEME_KEY = "lyrics:theme";

/**
 * Applies the theme by toggling a class on <html>.
 *
 * Called from main.tsx before the first render — doing this in a component
 * effect instead would paint the wrong theme and then correct it, which reads
 * as a flash on every load.
 */
export function applyTheme(theme: Theme): void {
  const dark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

export function storedTheme(): Theme {
  return (localStorage.getItem(THEME_KEY) as Theme | null) ?? "system";
}

export function storeTheme(theme: Theme): void {
  localStorage.setItem(THEME_KEY, theme);
}
