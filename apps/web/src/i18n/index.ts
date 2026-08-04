import { en, type Dictionary } from "./en";
import { id } from "./id";

export const LOCALES = ["en", "id"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "id";
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

/** A count-dependent string. Both forms are required, even where they match. */
export type PluralForms = { readonly one: string; readonly other: string };

/**
 * Picks the form matching `count`, then interpolates — `{count}` is always
 * available without passing it.
 *
 *   plural(t.projects.bulkDeleted, 1)  -> "1 project deleted"
 *   plural(t.projects.bulkDeleted, 4)  -> "4 projects deleted"
 *
 * Replaces the `"{count} project(s) deleted"` shape these keys used to have.
 * "(s)" is not a plural rule, it is a way of not choosing one, and it does not
 * survive translation: Indonesian marks plurality by reduplication or not at
 * all, so `proyek(s)` is simply wrong there rather than merely graceless.
 *
 * Deliberately two forms and not full CLDR categories (zero/one/two/few/many).
 * English and Indonesian between them need exactly these two, and a `one`/
 * `other` pair is the shape Intl.PluralRules would hand back for both. If a
 * language with richer rules is ever added, this is where it changes — one
 * function, not sixty call sites.
 */
export function plural(
  forms: PluralForms,
  count: number,
  vars: Record<string, string | number> = {},
): string {
  const form = count === 1 ? forms.one : forms.other;
  return interpolate(form, { count, ...vars });
}

export type { Dictionary };
