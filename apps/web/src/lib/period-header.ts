import { groupPeriodsByMonth, monthKeyOf } from "@DashboardV2/api/lib/periods";

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
 *
 * A month can also be *folded*: its run of periods collapses into one column so
 * the months on either side fit on the same screen. That is the answer to a
 * year-long weekly project being fifty-two columns wide, where the only way
 * through was scrolling sideways until the line descriptions had scrolled out of
 * sight. Folding is a display state and nothing else — no period is dropped, no
 * value is recomputed, and expanding puts every column back exactly as it was.
 */

export type PeriodLike = {
  id: string;
  periodIndex: number;
  label: string | null;
  startDate: string;
  endDate: string;
  status?: string;
};

/**
 * One rendered column of a matrix — either a single period, or a whole month
 * standing in for its run of them.
 *
 * The grids iterate this rather than the period list, which is what keeps the
 * folding out of every cell renderer: a cell asks the column what it covers, and
 * a folded column happens to cover more than one period.
 */
export type MatrixColumn<P extends PeriodLike> =
  | { kind: "period"; key: string; monthKey: string; period: P }
  | { kind: "month"; key: string; monthKey: string; periods: P[] };

export type PeriodColumn<P extends PeriodLike> = {
  column: MatrixColumn<P>;
  /** "3" for a period; "5–8" for a folded month, naming what is inside it. */
  number: string;
  /** "17 – 23 Mei" — locale-formatted, month collapsed where it repeats. */
  range: string;
  /** For aria-labels and title attributes, where the two-line header is not read. */
  accessibleName: string;
  /** The period the data date falls inside — or the folded month holding it. */
  isCurrent: boolean;
};

export type MonthBand = {
  monthKey: string;
  /** "Mei" / "May". */
  label: string;
  /** Column span — how many *columns* this month covers, so 1 when folded. */
  span: number;
  /** Whether this month is currently folded into a single column. */
  collapsed: boolean;
  /**
   * Whether folding it would gain anything.
   *
   * A month holding one period is already one column wide. Offering a control
   * that visibly does nothing is worse than not offering it, so the band row
   * renders those as plain text.
   */
  foldable: boolean;
};

export type PeriodHeaderModel<P extends PeriodLike> = {
  months: MonthBand[];
  columns: PeriodColumn<P>[];
};

/**
 * The full column list for a grid, before windowing.
 *
 * Built from every period, not from the visible slice: the window slices *this*,
 * so that the count it is given already reflects the folding. Doing it the other
 * way round — window first, fold second — would make the number of rendered
 * columns depend on which ones happened to be scrolled into view.
 */
export function buildMatrixColumns<P extends PeriodLike>(
  periods: P[],
  collapsed: ReadonlySet<string>,
): MatrixColumn<P>[] {
  const columns: MatrixColumn<P>[] = [];

  for (const group of groupPeriodsByMonth(periods)) {
    const run = periods.slice(group.startIndex, group.startIndex + group.span);
    // A single-period month is folded and unfolded to exactly the same width, so
    // it is left alone whatever the set says. This also means a stale monthKey
    // in the set — after an import changes the period dates, say — cannot make a
    // column disappear.
    if (collapsed.has(group.monthKey) && run.length > 1) {
      columns.push({
        kind: "month",
        key: `month:${group.monthKey}`,
        monthKey: group.monthKey,
        periods: run,
      });
      continue;
    }
    for (const period of run) {
      columns.push({
        kind: "period",
        key: period.id,
        monthKey: group.monthKey,
        period,
      });
    }
  }

  return columns;
}

/** Every period a column stands for — one for a period column, the run for a folded month. */
export function periodsOf<P extends PeriodLike>(column: MatrixColumn<P>): P[] {
  return column.kind === "period" ? [column.period] : column.periods;
}

/** Finds the rendered column containing a period, including inside a folded month. */
export function findPeriodColumnIndex<P extends PeriodLike>(
  columns: readonly MatrixColumn<P>[],
  periodId: string,
): number {
  return columns.findIndex((column) =>
    periodsOf(column).some((period) => period.id === periodId),
  );
}

/**
 * The period whose value a folded column shows.
 *
 * The last one in the month. For the progress grid the figures are cumulative,
 * so the last reading of a month *is* the month's position — summing them would
 * count the same work four times over.
 */
export function lastPeriodOf<P extends PeriodLike>(column: MatrixColumn<P>): P {
  const periods = periodsOf(column);
  return periods[periods.length - 1]!;
}

/**
 * A plain function taking the locale formatters rather than a hook calling
 * `useFormat` itself. Both grids that need it decide whether to render at all
 * — no periods, no baseline, still loading — before they have a period list to
 * describe, and a hook could not be called after those returns.
 *
 * Takes the *visible* columns. `collapsedMonths` is passed separately because
 * the band row must know a month is folded in order to offer to unfold it, and
 * a folded month's own column cannot say so on its own.
 */
export function buildPeriodHeader<P extends PeriodLike>(
  { formatDateRange, formatMonthKey }: Pick<Formatters, "formatDateRange" | "formatMonthKey">,
  columns: MatrixColumn<P>[],
  dataDate: string | null,
  collapsedMonths: ReadonlySet<string> = new Set(),
): PeriodHeaderModel<P> {
  // Consecutive runs over the *columns*, so a folded month spans one. Grouping
  // the periods again here would give a folded month a span of four over a
  // single rendered cell.
  const months: MonthBand[] = [];
  for (const column of columns) {
    const last = months[months.length - 1];
    if (last && last.monthKey === column.monthKey) {
      last.span++;
      continue;
    }
    months.push({
      monthKey: column.monthKey,
      label: formatMonthKey(column.monthKey),
      span: 1,
      collapsed: column.kind === "month" || collapsedMonths.has(column.monthKey),
      // Filled in below, once the spans are known.
      foldable: false,
    });
  }
  // A month is worth a fold control if folding would change its width — so if it
  // is already folded (the control unfolds it) or if it spans more than one
  // column. Read off the spans, which the loop above could not know in advance.
  for (const month of months) {
    month.foldable = month.collapsed || month.span > 1;
  }

  const built = columns.map((column) => {
    const periods = periodsOf(column);
    const first = periods[0]!;
    const last = periods[periods.length - 1]!;
    const range = formatDateRange(first.startDate, last.endDate);
    const number =
      column.kind === "period"
        ? String(column.period.periodIndex)
        : `${first.periodIndex}–${last.periodIndex}`;
    return {
      column,
      number,
      range,
      accessibleName: range === "—" ? (first.label ?? number) : `${number} · ${range}`,
      // No data date means no current period. Falling back to the first, or to
      // today, would put the "you are here" marker on a project that has never
      // reported anything.
      isCurrent:
        dataDate !== null &&
        periods.some((period) => period.startDate <= dataDate && dataDate <= period.endDate),
    };
  });

  return { months, columns: built };
}

/** The month a period belongs to, for grids keying their fold state off a cell. */
export { monthKeyOf };
