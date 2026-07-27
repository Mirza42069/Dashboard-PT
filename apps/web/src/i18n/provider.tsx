"use client";

import { createContext, useContext } from "react";

import {
  DEFAULT_LOCALE,
  getDictionary,
  INTL_LOCALE,
  LOCALE_COOKIE,
  type Dictionary,
  type Locale,
} from "./index";

type I18nContextValue = {
  locale: Locale;
  intlLocale: string;
  dict: Dictionary;
};

const I18nContext = createContext<I18nContextValue>({
  locale: DEFAULT_LOCALE,
  intlLocale: INTL_LOCALE[DEFAULT_LOCALE],
  dict: getDictionary(DEFAULT_LOCALE),
});

export function I18nProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: React.ReactNode;
}) {
  return (
    <I18nContext.Provider
      value={{ locale, intlLocale: INTL_LOCALE[locale], dict: getDictionary(locale) }}
    >
      {children}
    </I18nContext.Provider>
  );
}

/** The whole typed dictionary: `const t = useT(); t.nav.projects`. */
export function useT(): Dictionary {
  return useContext(I18nContext).dict;
}

export function useLocale() {
  const { locale, intlLocale } = useContext(I18nContext);
  return { locale, intlLocale };
}

/**
 * Writes the cookie and hard-reloads. A router.refresh() would re-render server
 * components but leave already-mounted client state (open dialogs, cached
 * formatter instances) in the old language; a reload guarantees consistency and
 * language switching is rare enough that the cost is irrelevant.
 */
export function setLocaleCookie(locale: Locale) {
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
  window.location.reload();
}
