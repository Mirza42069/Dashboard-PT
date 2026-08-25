import { readCookie } from "../cookies";
import { en, type MessageDictionary } from "./en";
import { id } from "./id";

/**
 * The invariant this file exists to hold, so it can be checked in one command:
 *
 *   grep -rn 'message: "' packages/api/src
 *   grep -n  'error: "'   apps/server/src/index.ts
 *
 * Both should return only the deliberate English survivors — `routers/index.ts`
 * ("This is private" is the health-probe payload, not an error) and the opaque
 * `Unauthorized` / `Not found` responses, which are HTTP status names rather
 * than copy. The 404s are deliberately indistinguishable from one another; see
 * the note above the guards in lib/scope.ts. Anything else showing up in that
 * grep is a message a user can reach in the wrong language.
 */
export const LOCALES = ["en", "id"] as const;
export type Locale = (typeof LOCALES)[number];

/** Matches apps/web/src/i18n/index.ts — the product is Indonesian by default. */
export const DEFAULT_LOCALE: Locale = "id";

/** Written by apps/web/src/i18n/provider.tsx. Keep the name in step with it. */
export const LOCALE_COOKIE = "v2.locale";

const DICTIONARIES: Record<Locale, MessageDictionary> = { en, id };

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

export function dictionaryFor(locale: Locale): MessageDictionary {
  return DICTIONARIES[locale];
}

/**
 * The locale of a request, from its cookies.
 *
 * A cookie rather than a header because it already arrives on every path with
 * no further plumbing: the browser client sets `credentials: "include"`, the
 * SSR client forwards the raw `cookie` header, and the Hono routes have no tRPC
 * client attaching headers at all. An `x-locale` header would need widening
 * `allowHeaders` in the CORS config *and* an addition to the SSR forward list —
 * two places that would each silently fall back to English if missed.
 */
export function localeFromHeaders(headers: Headers): Locale {
  const value = readCookie(headers, LOCALE_COOKIE);
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

/** The dictionary for a request, for callers that never need the locale itself. */
export function tFor(headers: Headers): MessageDictionary {
  return dictionaryFor(localeFromHeaders(headers));
}

/** Intl tags, mirroring INTL_LOCALE in apps/web/src/i18n/index.ts. */
const INTL_LOCALE: Record<Locale, string> = { en: "en-US", id: "id-ID" };

/**
 * A number as the reader's locale writes it — `97.50` in English, `97,50` in
 * Indonesian. Only one message needs this today (the weight total), but a raw
 * `toFixed` is the kind of thing that reads as a typo to an Indonesian reader
 * rather than as a foreign convention.
 */
export function formatNumber(locale: Locale, value: number, fractionDigits = 2): string {
  return value.toLocaleString(INTL_LOCALE[locale], {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

/** `interpolate("Kode {code} sudah dipakai", { code: "A1" })`. */
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
 * This is what replaced the `"{n} ticket(s)"` shape these messages used to have.
 * "(s)" is not a plural rule, it is a way of not choosing one, and it does not
 * survive translation: Indonesian marks plurality by reduplication or not at
 * all, so `tindakan(s)` is simply wrong rather than merely graceless.
 */
export function plural(
  forms: PluralForms,
  count: number,
  vars: Record<string, string | number> = {},
): string {
  const form = count === 1 ? forms.one : forms.other;
  return interpolate(form, { count, ...vars });
}

export type {
  AdminAction,
  ArchivedEntity,
  MessageDictionary,
  SupportAction,
  WorkbookOperation,
} from "./en";
