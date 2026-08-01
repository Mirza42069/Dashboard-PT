"use client";

import type { PeriodHeaderModel, PeriodLike } from "@/lib/period-header";

/**
 * The month band that runs above a schedule grid's period columns.
 *
 * A separate header row whose cells span their run of periods, exactly as the
 * source workbooks draw it: MEI over four weeks, JUNI over five. It is the one
 * piece of structure that makes a seventeen-column grid legible at a glance,
 * and it earns the row it occupies because it encodes something true — which
 * calendar month each column of work falls in — rather than decorating.
 *
 * Shared between the schedule and progress grids so a period cannot sit under
 * June on one tab and May on the other.
 */
export function MonthBandRow<P extends PeriodLike>({
  header,
  /** Accessible name for the corner cell above the identity columns. */
  leadingLabel,
  /** How many columns precede the periods — identity, planning controls. */
  leadingColSpan = 1,
  /** How many follow them, e.g. a row total and a row menu. */
  trailingColSpan = 0,
}: {
  header: PeriodHeaderModel<P>;
  leadingLabel: string;
  leadingColSpan?: number;
  trailingColSpan?: number;
}) {
  if (header.months.length === 0) return null;

  return (
    <tr className="border-b">
      <th
        scope="col"
        colSpan={leadingColSpan}
        className="sticky left-0 z-10 bg-card px-4 py-1 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground"
      >
        <span className="sr-only">{leadingLabel}</span>
      </th>
      {header.months.map((month) => (
        <th
          key={month.monthKey}
          scope="colgroup"
          colSpan={month.span}
          // Centred over its run and ruled off from the next month, which is
          // what makes the grouping readable without a background per month.
          className="border-l px-2 py-1 text-center text-xs font-medium uppercase tracking-wide text-muted-foreground first:border-l-0"
        >
          {month.label}
        </th>
      ))}
      {trailingColSpan > 0 && <th aria-hidden colSpan={trailingColSpan} />}
    </tr>
  );
}
