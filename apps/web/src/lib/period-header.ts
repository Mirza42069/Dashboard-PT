import { groupPeriodsByMonth } from "@DashboardV2/api/lib/periods";

import type { Formatters } from "./format";

/**
 * The calendar header a schedule grid needs above its columns.
 *
 * "W1, W2, W3…" tells a site manager nothing they can act on — the question is
 * always "which week is that, and are we in it now". So a column carries three
 * things: the month it falls in (as a band spanning its run), its number, and
 * the dates it covers.
 *
 * The *identifier* stays `periodIndex` throughout. It is what the distribution
 * cells, the planning windows and the import all key on, so the display can be
 * relabelled, translated or reformatted without moving any data. The stored
 * `label` column ("W3") is no longer shown; it survives as the fallback for a
 * period whose dates are somehow unreadable.
 */

export type PeriodLike = {
  id: string;
  periodIndex: number;
  label: string | null;
  startDate: string;
  endDate: string;
  status?: string;
};

export type PeriodColumn<P extends PeriodLike> = {
  period: P;
  /** "3" — the number, shown large. */
  number: string;
  /** "17 – 23 Mei" — locale-formatted, month collapsed where it repeats. */
  range: string;
  /** For aria-labels and title attributes, where the two-line header is not read. */
  accessibleName: string;
  /** The period the data date falls inside. */
  isCurrent: boolean;
};

export type MonthBand = {
  monthKey: string;
  /** "Mei" / "May". */
  label: string;
  /** Column span — how many periods this month covers. */
  span: number;
};

export type PeriodHeaderModel<P extends PeriodLike> = {
  months: MonthBand[];
  columns: PeriodColumn<P>[];
};

/**
 * A plain function taking the locale formatters rather than a hook calling
 * `useFormat` itself. Both grids that need it decide whether to render at all
 * — no periods, no baseline, still loading — before they have a period list to
 * describe, and a hook could not be called after those returns.
 */
export function buildPeriodHeader<P extends PeriodLike>(
  { formatDateRange, formatMonthKey }: Pick<Formatters, "formatDateRange" | "formatMonthKey">,
  periods: P[],
  dataDate: string | null,
): PeriodHeaderModel<P> {
  const months = groupPeriodsByMonth(periods).map((group) => ({
    monthKey: group.monthKey,
    label: formatMonthKey(group.monthKey),
    span: group.span,
  }));

  const columns = periods.map((period) => {
    const range = formatDateRange(period.startDate, period.endDate);
    const number = String(period.periodIndex);
    return {
      period,
      number,
      range,
      accessibleName: range === "—" ? (period.label ?? number) : `${number} · ${range}`,
      // No data date means no current period. Falling back to the first, or to
      // today, would put the "you are here" marker on a project that has never
      // reported anything.
      isCurrent:
        dataDate !== null && period.startDate <= dataDate && dataDate <= period.endDate,
    };
  });

  return { months, columns };
}
