"use client";

import type { DatePickerLabels } from "@DashboardV2/ui/components/date-picker";

import type { useT } from "@/i18n/provider";

/**
 * The DatePicker's own strings, from the dictionary.
 *
 * `packages/ui` cannot reach `useT()` — it is framework-agnostic and has no
 * dictionary — so its accessible names arrive as props, the same arrangement
 * `DialogContent`'s `closeLabel` uses. This exists so the two callers (the
 * project dialog and the Baseline tab's schedule settings) cannot drift apart,
 * and so a third one has an obvious thing to reuse.
 */
export function datePickerLabels(t: ReturnType<typeof useT>): DatePickerLabels {
  return {
    placeholder: t.common.pickDate,
    today: t.common.today,
    clear: t.common.clear,
    previousMonth: t.common.previousMonth,
    nextMonth: t.common.nextMonth,
  };
}
