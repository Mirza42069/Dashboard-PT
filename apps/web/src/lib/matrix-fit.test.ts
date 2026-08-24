import { expect, test } from "bun:test";

import { MAX_PERIOD_WIDTH, fitMatrix } from "./matrix-fit";
import { toggleFold, type MonthFoldState } from "./month-fold";
import type { PeriodLike } from "./period-header";

/** A year of weekly periods — long enough that no card would ever hold it. */
const YEAR: PeriodLike[] = Array.from({ length: 52 }, (_, index) => {
  const start = new Date(Date.UTC(2026, 0, 5 + index * 7));
  const end = new Date(Date.UTC(2026, 0, 11 + index * 7));
  return {
    id: `p${index + 1}`,
    periodIndex: index + 1,
    label: `W${index + 1}`,
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
});

/** Nine weeks across May, June and a one-week July — the period-header fixture. */
const SHORT: PeriodLike[] = [
  { id: "p1", periodIndex: 1, label: "W1", startDate: "2026-05-04", endDate: "2026-05-10" },
  { id: "p2", periodIndex: 2, label: "W2", startDate: "2026-05-11", endDate: "2026-05-17" },
  { id: "p3", periodIndex: 3, label: "W3", startDate: "2026-05-18", endDate: "2026-05-24" },
  { id: "p4", periodIndex: 4, label: "W4", startDate: "2026-05-25", endDate: "2026-05-31" },
  { id: "p5", periodIndex: 5, label: "W5", startDate: "2026-06-01", endDate: "2026-06-07" },
  { id: "p6", periodIndex: 6, label: "W6", startDate: "2026-06-08", endDate: "2026-06-14" },
  { id: "p7", periodIndex: 7, label: "W7", startDate: "2026-06-15", endDate: "2026-06-21" },
  { id: "p8", periodIndex: 8, label: "W8", startDate: "2026-06-22", endDate: "2026-06-28" },
  { id: "p9", periodIndex: 9, label: "W9", startDate: "2026-06-29", endDate: "2026-07-05" },
];

const NONE: MonthFoldState = new Set();

function fit(input: Partial<Parameters<typeof fitMatrix<PeriodLike>>[0]> = {}) {
  return fitMatrix<PeriodLike>({
    leadingWidth: 320,
    trailingWidth: 0,
    periods: SHORT,
    state: NONE,
    ...input,
  });
}

test("every column is drawn at the full width, one per period", () => {
  const result = fit();

  expect(result.periodWidth).toBe(MAX_PERIOD_WIDTH);
  expect(result.columnWidths).toEqual(Array.from({ length: 9 }, () => MAX_PERIOD_WIDTH));
});

test("a year of weeks is not folded to make it fit — it is simply wide", () => {
  const result = fit({ periods: YEAR });

  expect(result.collapsed.size).toBe(0);
  expect(result.columnWidths).toHaveLength(52);
  expect(result.columnWidths.every((width) => width === MAX_PERIOD_WIDTH)).toBe(true);
});

test("tableWidth is the leading and trailing blocks plus the columns", () => {
  const result = fit({ leadingWidth: 320, trailingWidth: 168 });

  expect(result.tableWidth).toBe(320 + 168 + 9 * MAX_PERIOD_WIDTH);
});

test("a folded month costs its run of columns and leaves one behind", () => {
  const result = fit({ state: toggleFold(NONE, "2026-05") });

  // May's four weeks become one column; June's four and July's one are untouched.
  expect(result.columnWidths).toHaveLength(6);
  expect(result.collapsed.has("2026-05")).toBe(true);
  expect(result.tableWidth).toBe(320 + 6 * MAX_PERIOD_WIDTH);
});

test("folding a single-period month changes nothing — it is already one column", () => {
  const result = fit({ state: toggleFold(NONE, "2026-07") });

  expect(result.columnWidths).toHaveLength(9);
});

test("the fold state is copied, not aliased", () => {
  const state = toggleFold(NONE, "2026-05");
  const result = fit({ state });

  expect(result.collapsed).not.toBe(state);
  expect([...result.collapsed]).toEqual([...state]);
});
