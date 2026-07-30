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
   * Dark is off pending a redesign — the settings tile shows it as "coming
   * soon" rather than switching (see PreferencesSection).
   *
   * Forced here rather than only in the UI because the cookie outlives the
   * button: anyone who selected dark before it was pulled would otherwise stay
   * on it forever with no control left to get out. Reading and then discarding
   * also means their preference survives, so re-enabling is a one-line revert
   * and they land back where they were.
   *
   * The .dark block in packages/ui/src/styles/globals.css is deliberately left
   * intact and is simply unreachable while this stands.
   */
  return stored === "dark" ? "light" : stored;
}

export function setThemeCookie(theme: Theme) {
  document.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
}
