import { en, type Dictionary } from "./en";
import { id } from "./id";

export const LOCALES = ["en", "id"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "v2.locale";

const DICTIONARIES: Record<Locale, Dictionary> = { en, id };

/** Intl locale tags — used by format.ts for dates and currency. */
export const INTL_LOCALE: Record<Locale, string> = {
  en: "en-US",
  id: "id-ID",
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

export function getDictionary(locale: Locale): Dictionary {
  return DICTIONARIES[locale];
}

/**
 * Server-side locale read. Client components get the locale from the provider
 * instead — never call this in a "use client" file.
 */
export async function getLocale(): Promise<Locale> {
  const { cookies } = await import("next/headers");
  const value = (await cookies()).get(LOCALE_COOKIE)?.value;
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

/** `interpolate("Hello {name}", { name: "Ana" })` -> `"Hello Ana"`. */
export function interpolate(
  template: string,
  vars: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in vars ? String(vars[key]) : match,
  );
}

export type { Dictionary };
