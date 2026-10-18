/**
 * The light/dark switch, stored per browser. Not a "use client" module on
 * purpose: app/layout.tsx (a server component) inlines THEME_SCRIPT, and a
 * plain string exported from a client module would reach it as a client
 * reference rather than as the string.
 *
 * "system" is stored as the ABSENCE of a value, so a browser that never
 * touched the switch follows the OS — and a blocked or cleared localStorage
 * degrades to exactly that rather than to an error.
 */
export type ThemeChoice = "system" | "light" | "dark";

export const THEME_KEY = "theme";

/** Runs in <head> before first paint, so a light-theme reader never sees a
 * dark flash. Kept tiny and dependency-free; mirrors `resolveTheme` below. */
export const THEME_SCRIPT = `(function(){var t;try{t=localStorage.getItem("${THEME_KEY}")}catch(e){}if(t!=="light"&&t!=="dark")t=window.matchMedia&&matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";document.documentElement.setAttribute("data-theme",t)})()`;

export function readThemeChoice(): ThemeChoice {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

export function resolveTheme(choice: ThemeChoice, osPrefersLight: boolean): "light" | "dark" {
  if (choice === "system") return osPrefersLight ? "light" : "dark";
  return choice;
}

export function applyThemeChoice(choice: ThemeChoice) {
  try {
    if (choice === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, choice);
  } catch {
    // Private window or blocked storage: the choice lasts for this page only.
  }
  const osPrefersLight = window.matchMedia?.("(prefers-color-scheme: light)").matches ?? false;
  document.documentElement.setAttribute("data-theme", resolveTheme(choice, osPrefersLight));
}
