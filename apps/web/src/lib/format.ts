/**
 * Money always renders Indonesian style — `Rp100.000`: no space after Rp, dots
 * for thousands. The amount is rupiah whatever language the UI is in, so the
 * currency's own convention travels with it rather than switching to
 * `IDR 100,000` on the English UI.
 *
 * Built from `style: "decimal"` and a manual prefix rather than
 * `style: "currency"`, because Intl inserts a non-breaking space after "Rp"
 * that cannot be turned off.
 *
 * Quantities and dates *do* follow the UI locale — they aren't rupiah.
 *
 * Client components get these via useFormat() (lib/use-format.ts). The factory
 * is memoized per locale, so formatter instances are created once.
 */

export const CURRENCY_PREFIX = "Rp";

/** Grouping/decimal marks for money are pinned to Indonesian, never the UI locale. */
const MONEY_LOCALE = "id-ID";

export type Formatters = ReturnType<typeof createFormatters>;

const cache = new Map<string, Formatters>();

export function getFormatters(intlLocale: string) {
  const cached = cache.get(intlLocale);
  if (cached) return cached;
  const created = createFormatters(intlLocale);
  cache.set(intlLocale, created);
  return created;
}

function createFormatters(intlLocale: string) {
  const amount = new Intl.NumberFormat(MONEY_LOCALE, { maximumFractionDigits: 0 });

  const amountCompact = new Intl.NumberFormat(MONEY_LOCALE, {
    notation: "compact",
    maximumFractionDigits: 1,
  });

  const number = new Intl.NumberFormat(intlLocale, { maximumFractionDigits: 2 });

  /** Keeps the minus outside the symbol: -Rp50.000, not Rp-50.000. */
  const withPrefix = (value: number, format: Intl.NumberFormat) =>
    `${value < 0 ? "-" : ""}${CURRENCY_PREFIX}${format.format(Math.abs(value))}`;

  return {
    /** `Rp100.000` — the default for tables and totals. */
    money(value: number) {
      return withPrefix(value, amount);
    },

    /** `Rp4,1 M` — compact, for stat tiles where width is tight. */
    moneyCompact(value: number) {
      return withPrefix(value, amountCompact);
    },

    quantity(value: number, unit?: string | null) {
      const formatted = number.format(value);
      return unit ? `${formatted} ${unit}` : formatted;
    },

    percent(value: number | null | undefined) {
      return value === null || value === undefined ? "—" : `${Math.round(value)}%`;
    },

    /**
     * Dates arrive as "YYYY-MM-DD" strings (no tRPC transformer; `date`
     * columns). Parsing as UTC avoids the off-by-one where a browser behind UTC
     * renders the previous day.
     */
    formatDate(value: string | null | undefined) {
      if (!value) return "—";
      const date = new Date(`${value}T00:00:00Z`);
      if (Number.isNaN(date.getTime())) return "—";
      return date.toLocaleDateString(intlLocale, {
        year: "numeric",
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      });
    },

    /** Timestamps (createdAt etc.) are full ISO strings; local time is correct. */
    formatDateTime(value: string | Date | null | undefined) {
      if (!value) return "—";
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return "—";
      return date.toLocaleDateString(intlLocale, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    },
  };
}
