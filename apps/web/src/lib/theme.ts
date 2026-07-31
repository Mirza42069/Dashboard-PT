export const THEMES = ["light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

export const DEFAULT_THEME: Theme = "light";
export const THEME_COOKIE = "v2.theme";

export function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}

/**
 * Read server-side and stamped straight onto <html>, which is why this app does
 * not use next-themes. That library injects an inline <script> to apply the
 * stored theme before paint — React 19 warns about script tags inside
 * components, and it can only ever run after the server has already sent the
 * wrong class. A cookie is known before the response is written, so the correct
 * theme is in the very first byte of HTML: no script, no flash, no warning.
 */
export async function getTheme(): Promise<Theme> {
  const { cookies } = await import("next/headers");
  const value = (await cookies()).get(THEME_COOKIE)?.value;
  const stored = isTheme(value) ? value : DEFAULT_THEME;

  /*
   * Dark is off pending a redesign, and there is no longer a control for it:
   * the Light/Dark row was removed from PreferencesSection once it could only
   * ever answer "coming soon".
   *
   * This forcing matters more without that row, not less — the cookie outlives
   * the button, so anyone who selected dark while it worked would otherwise be
   * stranded on it with nothing left to press. Reading and then discarding also
   * means their preference survives, so re-enabling is a one-line revert here
   * plus a row in the settings tile, and they land back where they were.
   *
   * The .dark block in packages/ui/src/styles/globals.css is deliberately left
   * intact and is simply unreachable while this stands.
   */
  return stored === "dark" ? "light" : stored;
}

/**
 * Unused while the theme is forced to light, and kept for exactly that reason:
 * it is the other half of the one-line revert described above.
 */
export function setThemeCookie(theme: Theme) {
  document.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
}
