import { groupPeriodsByMonth } from "@DashboardV2/api/lib/periods";

import type { PeriodLike } from "./period-header";

/**
 * What the *reader* has said about a month, as distinct from what fitting the
 * grid to the screen decided on their behalf.
 *
 * The grids used to hold one `Set<string>` of folded months, which the reader
 * toggled. That worked while folding was purely manual. It cannot survive an
 * auto-folder writing into the same set: press the chevron on a month the
 * fitter folded, and the fitter simply folds it again on the next measure —
 * the control looks broken, because from the outside it is.
 *
 * So state holds *intent* and the fit derives the *result*. A month with no
 * entry here has no opinion attached to it and the fitter may do as it likes.
 * An entry is a standing instruction that outranks the fitter in both
 * directions: "unfolded" is the one that matters, because it is what lets
 * someone open the month they are entering figures into and keep it open.
 */
export type FoldIntent = "folded" | "unfolded";

export type MonthFoldState = ReadonlyMap<string, FoldIntent>;

/**
 * Records the opposite of what is *currently on screen*, not of what is stored.
 *
 * The distinction is the whole point. Pressing the chevron on a month the
 * fitter folded has no stored entry to invert; inverting the absence would
 * write "folded" and change nothing visible. What the press means is "leave
 * this one alone", so it writes "unfolded".
 */
export function toggleFold(
  state: MonthFoldState,
  monthKey: string,
  renderedCollapsed: boolean,
): MonthFoldState {
  const next = new Map(state);
  next.set(monthKey, renderedCollapsed ? "unfolded" : "folded");
  return next;
}

/** Months the reader folded by hand — the fitter's starting point. */
export function manualFolds(state: MonthFoldState): Set<string> {
  const folded = new Set<string>();
  for (const [monthKey, intent] of state) {
    if (intent === "folded") folded.add(monthKey);
  }
  return folded;
}

/**
 * Months the fitter must not touch.
 *
 * Only explicit unfolds. A month with no entry is fair game, which is what
 * makes the default behaviour "fold whatever it takes" rather than "fold
 * nothing until asked".
 */
export function protectedMonths(state: MonthFoldState): Set<string> {
  const kept = new Set<string>();
  for (const [monthKey, intent] of state) {
    if (intent === "unfolded") kept.add(monthKey);
  }
  return kept;
}

/**
 * Months the fitter is allowed to fold, worst candidate first.
 *
 * Ordered by distance from the data date, furthest first, with the wider month
 * winning a tie because folding it buys more columns. Someone entering June's
 * figures should find May folded for them and June left alone — folding the
 * month under the cursor to make room for the ones nobody is looking at is the
 * one outcome that would make this feature worse than scrolling.
 *
 * A single-period month is never a candidate: `buildMatrixColumns` refuses to
 * fold one (it is already a single column), so counting it here would make the
 * fitter's width arithmetic disagree with what actually renders.
 */
export function foldCandidates<P extends PeriodLike>(
  periods: P[],
  state: MonthFoldState,
  dataDate: string | null,
): string[] {
  const keep = protectedMonths(state);
  const groups = groupPeriodsByMonth(periods).filter(
    (group) => group.span > 1 && !keep.has(group.monthKey),
  );

  const current = dataDate === null ? null : currentMonthIndex(periods, groups, dataDate);

  return groups
    .map((group, index) => ({
      monthKey: group.monthKey,
      span: group.span,
      distance: current === null ? 0 : Math.abs(index - current),
    }))
    .filter((candidate) => current === null || candidate.distance > 0)
    .sort((a, b) => b.distance - a.distance || b.span - a.span)
    .map((candidate) => candidate.monthKey);
}

/** Which month band holds the data date, or null when it falls outside them all. */
function currentMonthIndex<P extends PeriodLike>(
  periods: P[],
  groups: { monthKey: string; startIndex: number; span: number }[],
  dataDate: string,
): number | null {
  const periodIndex = periods.findIndex(
    (period) => period.startDate <= dataDate && dataDate <= period.endDate,
  );
  if (periodIndex < 0) return null;
  const found = groups.findIndex(
    (group) => periodIndex >= group.startIndex && periodIndex < group.startIndex + group.span,
  );
  return found < 0 ? null : found;
}
