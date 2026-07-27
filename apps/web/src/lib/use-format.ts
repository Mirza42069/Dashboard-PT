"use client";

import { useLocale } from "@/i18n/provider";

import { getFormatters } from "./format";

/**
 * Formatters bound to the active locale. The single way client components
 * format money, quantities and dates — never instantiate Intl formatters in a
 * component.
 */
export function useFormat() {
  const { intlLocale } = useLocale();
  return getFormatters(intlLocale);
}
