import { buildMatrixColumns, type PeriodLike } from "./period-header";
import { foldCandidates, manualFolds, type MonthFoldState } from "./month-fold";

/** What a period column is allowed to be, in pixels. */
export const MAX_PERIOD_WIDTH = 96;
/**
 * The floor for a column of figures you only read.
 *
 * Four digits and a decimal point at `text-sm` with the cell's own padding.
 */
export const MIN_PERIOD_WIDTH_READONLY = 44;
/**
 * The floor for a column of figures you type into, which is higher and has to
 * be.
 *
 * The `Input` primitive spends 22px on its own border and padding before a
 * character is drawn. At the read-only floor that leaves 14px of typable
 * interior — under two digits — so the editable grids get their own floor and
 * narrow the input's padding to `px-1` on top of it. `type="number"` scrolls
 * its own content, so a value stays *enterable* at this width even when it is
 * too long to be *readable* at a glance.
 */
export const MIN_PERIOD_WIDTH_EDITABLE = 56;
/** Below this, cells drop their second line and headers drop the date range. */
export const COMPACT_CELL_WIDTH = 72;

export type MatrixFit = {
  /** The nominal width; `columnWidths` is what actually gets rendered. */
  periodWidth: number;
  /**
   * Per-column widths, summing to exactly the available budget.
   *
   * Flooring a budget across N columns leaves a remainder of up to N-1 pixels.
   * Dropping it leaves a visible gap at the right edge that looks like a
   * rendering fault, so it is handed out one pixel at a time from the left.
   */
  columnWidths: number[];
  /** Manual folds plus whatever the fitter had to add. Feed this to `buildMatrixColumns`. */
  collapsed: ReadonlySet<string>;
  /** Just the fitter's additions, so the grid can say it folded something. */
  autoCollapsed: ReadonlySet<string>;
  /**
   * Still wider than the container with every eligible month folded.
   *
   * Reachable only by protecting an unfold: the reader opened a month, and
   * honouring that is worth more than the promise never to scroll. The caller
   * puts `scrollX` back on for this state rather than re-folding the month
   * someone just opened.
   */
  overflows: boolean;
  /** Leading + trailing + the column widths. */
  tableWidth: number;
};

export type FitMatrixInput<P extends PeriodLike> = {
  /** Container width in pixels. Zero means "not measured yet". */
  available: number;
  leadingWidth: number;
  trailingWidth: number;
  periods: P[];
  state: MonthFoldState;
  minPeriodWidth: number;
  maxPeriodWidth?: number;
  dataDate: string | null;
};

/**
 * Chooses a column width and, when compression alone is not enough, which
 * months to fold — so the grid fits its container instead of scrolling.
 *
 * The order matters and is the whole design: compress first, fold second,
 * scroll never (see `overflows` for the one exception). Folding is the bigger
 * hammer because a folded month cannot be typed into, so it is only reached
 * once narrowing has run out of room.
 *
 * Pure, and deliberately so — it is the part worth testing, and the measuring
 * lives in the hook that calls it.
 */
export function fitMatrix<P extends PeriodLike>({
  available,
  leadingWidth,
  trailingWidth,
  periods,
  state,
  minPeriodWidth,
  maxPeriodWidth = MAX_PERIOD_WIDTH,
  dataDate,
}: FitMatrixInput<P>): MatrixFit {
  const manual = manualFolds(state);

  // Before the first measurement there is no budget to divide. Guessing one
  // would fold months for a single frame and then unfold them, which reads as
  // a flash of the wrong layout on every mount.
  if (available <= 0) {
    const columns = buildMatrixColumns(periods, manual).length;
    return {
      periodWidth: maxPeriodWidth,
      columnWidths: Array.from({ length: columns }, () => maxPeriodWidth),
      collapsed: manual,
      autoCollapsed: new Set(),
      overflows: false,
      tableWidth: leadingWidth + trailingWidth + columns * maxPeriodWidth,
    };
  }

  const budget = Math.max(0, available - leadingWidth - trailingWidth);
  const collapsed = new Set(manual);
  const autoCollapsed = new Set<string>();

  let columns = buildMatrixColumns(periods, collapsed).length;

  if (columns * minPeriodWidth > budget) {
    for (const monthKey of foldCandidates(periods, state, dataDate)) {
      if (columns * minPeriodWidth <= budget) break;
      if (collapsed.has(monthKey)) continue;
      collapsed.add(monthKey);
      autoCollapsed.add(monthKey);
      columns = buildMatrixColumns(periods, collapsed).length;
    }
  }

  const overflows = columns * minPeriodWidth > budget;
  const periodWidth = overflows
    ? minPeriodWidth
    : Math.min(maxPeriodWidth, Math.floor(budget / Math.max(1, columns)));

  const columnWidths = spreadWidths(
    columns,
    periodWidth,
    overflows ? null : budget,
    maxPeriodWidth,
  );
  return {
    periodWidth,
    columnWidths,
    collapsed,
    autoCollapsed,
    overflows,
    tableWidth:
      leadingWidth + trailingWidth + columnWidths.reduce((total, width) => total + width, 0),
  };
}

/**
 * `count` widths of `base`, with any leftover budget handed out a pixel each
 * from the left so the row ends flush with the container.
 *
 * A null budget means the columns are already at their floor and overflowing —
 * there is nothing left over to spread.
 */
function spreadWidths(count: number, base: number, budget: number | null, maximum: number): number[] {
  const widths = Array.from({ length: count }, () => base);
  if (budget === null || count === 0) return widths;

  let remainder = budget - count * base;
  // Only spread a genuine remainder. When the columns hit maxPeriodWidth the
  // leftover is the empty space to the right of a narrow grid, and stretching
  // the columns across it would make a three-period project draw three columns
  // the width of the card.
  if (remainder <= 0 || base >= maximum) return widths;

  for (let index = 0; remainder > 0 && widths.some((width) => width < maximum); index = (index + 1) % count) {
    if ((widths[index] ?? base) >= maximum) continue;
    widths[index] = (widths[index] ?? base) + 1;
    remainder--;
  }
  return widths;
}
