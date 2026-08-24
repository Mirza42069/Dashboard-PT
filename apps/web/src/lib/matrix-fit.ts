import { buildMatrixColumns, type PeriodLike } from "./period-header";
import type { MonthFoldState } from "./month-fold";

/** The width every period column is drawn at. */
export const MAX_PERIOD_WIDTH = 96;
/** Below this, cells drop their second line and headers drop the date range. */
export const COMPACT_CELL_WIDTH = 72;

export type MatrixFit = {
  /** The nominal width; `columnWidths` is what actually gets rendered. */
  periodWidth: number;
  /** Per-column widths, one entry per rendered column. */
  columnWidths: number[];
  /** The months the reader folded. Feed this to `buildMatrixColumns`. */
  collapsed: ReadonlySet<string>;
  /** Leading + trailing + the column widths. */
  tableWidth: number;
};

export type FitMatrixInput<P extends PeriodLike> = {
  leadingWidth: number;
  trailingWidth: number;
  periods: P[];
  state: MonthFoldState;
  maxPeriodWidth?: number;
};

/**
 * Lays the period columns out at full width and reports how wide that makes the
 * table.
 *
 * This used to do more. It compressed columns toward a floor and then folded
 * months on the reader's behalf, all to keep the grid inside its card — the
 * ordering was "compress first, fold second, scroll never". That is exactly
 * backwards for a grid of figures: at the floor a weekly percentage like
 * `11.111111` ran into its neighbour, and a month nobody asked about would
 * disappear into a single column on a narrow window.
 *
 * So the grid is drawn at full width and scrolls sideways when it has to, and
 * folding is left entirely to the reader — see `month-fold.ts`. The only thing
 * left to decide here is arithmetic, which is why it stays a pure function
 * rather than collapsing into the two grids.
 */
export function fitMatrix<P extends PeriodLike>({
  leadingWidth,
  trailingWidth,
  periods,
  state,
  maxPeriodWidth = MAX_PERIOD_WIDTH,
}: FitMatrixInput<P>): MatrixFit {
  const collapsed = new Set(state);
  const columns = buildMatrixColumns(periods, collapsed).length;

  return {
    periodWidth: maxPeriodWidth,
    columnWidths: Array.from({ length: columns }, () => maxPeriodWidth),
    collapsed,
    tableWidth: leadingWidth + trailingWidth + columns * maxPeriodWidth,
  };
}
