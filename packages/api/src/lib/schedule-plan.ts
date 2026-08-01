/**
 * Turning a planning window into distribution cells.
 *
 * A contractor's schedule states two things per line — the period work starts
 * and the period it finishes — and the sheet works out the rest. That is the
 * BOBOT/MINGGU column in the reference workbook: the line's weight divided by
 * its duration, repeated across the window. Here the same idea is expressed one
 * level down, as the share *of the line itself* in each period, because that is
 * what boq_item_distribution stores: a row that totals 100 whatever the line
 * weighs.
 *
 * Pure and free of database or tRPC types so the router, the spreadsheet import
 * and the tests all spread work the same way.
 */

/**
 * How far a row of percentages may drift from 100 and still count as complete.
 *
 * Percentages are stored to six decimal places and rounding across a few
 * hundred lines can legitimately leave a fraction on the table; anything past
 * half a percent is a real modelling error, not rounding.
 *
 * Lives here rather than beside the BoQ helpers because those import the
 * database, and the spreadsheet importer needs this number without dragging a
 * connection string into a parser.
 */
export const PLAN_TOLERANCE = 0.5;

/** Percentages are stored to six decimals, matching boq_item_distribution.planned_pct. */
const PRECISION = 6;

const round = (value: number) => Number(value.toFixed(PRECISION));

export type PlanWindow = { startIndex: number; finishIndex: number };

/**
 * Even shares across `length` periods, totalling exactly 100.
 *
 * The remainder lands on the final period rather than being spread as an extra
 * digit everywhere. 100/3 is 33.333333 three times over and leaves 0.000001 on
 * the table — small, but the activation check compares row totals against 100
 * and a plan that cannot be activated because of float dust is not a plan.
 */
export function evenShares(length: number): number[] {
  if (length <= 0) return [];
  const share = round(100 / length);
  return Array.from({ length }, (_, index) =>
    index === length - 1 ? round(100 - share * (length - 1)) : share,
  );
}

/** Inclusive duration, in periods — the DURASI column. Zero when the window is unset. */
export function planDuration(
  startIndex: number | null | undefined,
  finishIndex: number | null | undefined,
): number {
  if (startIndex == null || finishIndex == null) return 0;
  return finishIndex < startIndex ? 0 : finishIndex - startIndex + 1;
}

/**
 * The line's share of the *project* in each period of its window — the
 * reference workbook's BOBOT/MINGGU. Display only; nothing is stored from it.
 */
export function weightPerPeriod(weight: number, duration: number): number | null {
  return duration > 0 ? weight / duration : null;
}

export type PlanCell = { periodIndex: number; plannedPct: number };

/**
 * The full set of cells for one line, given its window.
 *
 * Returns a cell for **every** period the project has, not just the window —
 * the ones outside it at zero. The caller needs those: setting a window to
 * weeks 3-9 has to clear whatever used to sit in week 12, and the write path
 * already treats a zero as "delete this cell" (see schedule.setDistributionCells).
 * Returning only the window would leave the old tail behind and produce a row
 * totalling 160%.
 */
export function planCells(periodIndexes: number[], window: PlanWindow): PlanCell[] {
  const inWindow = periodIndexes
    .filter((index) => index >= window.startIndex && index <= window.finishIndex)
    .sort((a, b) => a - b);

  const shares = evenShares(inWindow.length);
  const byIndex = new Map(inWindow.map((periodIndex, position) => [periodIndex, shares[position] ?? 0]));

  return periodIndexes.map((periodIndex) => ({
    periodIndex,
    plannedPct: byIndex.get(periodIndex) ?? 0,
  }));
}

export type PlanProblem =
  | { kind: "finish_before_start" }
  | { kind: "out_of_range"; firstIndex: number; lastIndex: number };

/**
 * Validates a window against the periods the project actually has.
 *
 * Returns the problem rather than throwing, so the router can raise a TRPCError
 * with a message and the importer can attach the same fault to a spreadsheet
 * row number — one rule, two ways of reporting it.
 */
export function validatePlanWindow(
  window: PlanWindow,
  periodIndexes: number[],
): PlanProblem | null {
  if (window.finishIndex < window.startIndex) return { kind: "finish_before_start" };

  const firstIndex = Math.min(...periodIndexes);
  const lastIndex = Math.max(...periodIndexes);
  if (window.startIndex < firstIndex || window.finishIndex > lastIndex) {
    return { kind: "out_of_range", firstIndex, lastIndex };
  }
  return null;
}
