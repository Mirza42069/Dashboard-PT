export type Locale = "id" | "en";

export function localeHref(locale: Locale) {
  return locale === "id" ? "/" : "/en";
}
