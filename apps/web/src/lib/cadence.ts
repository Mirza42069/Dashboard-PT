import type { PeriodType } from "@DashboardV2/db/schema";

import { interpolate, type Dictionary } from "@/i18n";

/**
 * What a reporting cadence is called, in one place.
 *
 * Three surfaces need this string — the baseline timing dialog, the Excel
 * import wizard and the overview's detail list — and they used to spell it out
 * separately. Two of them were object literals keyed by cadence, which is the
 * shape that silently renders nothing when a new cadence is added: a missing
 * key is `undefined`, not a type error.
 *
 * `custom` is the reason this is a function rather than a record. Its name
 * carries the cycle length, so it cannot be a constant.
 */
export function cadenceLabel(
  t: Dictionary,
  type: PeriodType,
  lengthDays: number | null = null,
): string {
  if (type === "custom") {
    // The length can legitimately be missing while the reader is still typing
    // one into the dialog; the generic name is the honest placeholder.
    return lengthDays
      ? interpolate(t.projects.periodCustomEvery, { days: lengthDays })
      : t.projects.periodCustom;
  }

  return {
    daily: t.projects.periodDaily,
    weekly: t.projects.periodWeekly,
    biweekly: t.projects.periodBiweekly,
    semimonthly: t.projects.periodSemimonthly,
    monthly: t.projects.periodMonthly,
    quarterly: t.projects.periodQuarterly,
  }[type];
}
