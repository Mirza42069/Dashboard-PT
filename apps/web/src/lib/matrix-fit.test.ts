import { expect, test } from "bun:test";

import {
  MIN_PERIOD_WIDTH_EDITABLE,
  MIN_PERIOD_WIDTH_READONLY,
  MAX_PERIOD_WIDTH,
  fitMatrix,
} from "./matrix-fit";
import { toggleFold, type MonthFoldState } from "./month-fold";
import type { PeriodLike } from "./period-header";

/** A year of weekly periods, so folding is the only way it ever fits. */
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

const NONE: MonthFoldState = new Map();

function fit(input: Partial<Parameters<typeof fitMatrix<PeriodLike>>[0]> = {}) {
  return fitMatrix<PeriodLike>({
    available: 1130,
    leadingWidth: 320,
    trailingWidth: 0,
    periods: SHORT,
    state: NONE,
    minPeriodWidth: MIN_PERIOD_WIDTH_EDITABLE,
    dataDate: null,
    ...input,
  });
}

test("a grid that already fits is not folded, and its columns stop at the maximum", () => {
  // 1400px leaves 1080px for nine columns — 120px each if unclamped.
  const result = fit({ available: 1400 });

  expect(result.autoCollapsed.size).toBe(0);
  expect(result.collapsed.size).toBe(0);
  expect(result.periodWidth).toBe(MAX_PERIOD_WIDTH);
  expect(result.columnWidths).toHaveLength(9);
});

test("columns compress before any month is folded", () => {
  // 9 columns into 630px is 70px each — under the 96px maximum, over the floor.
  const result = fit({ available: 950 });

  expect(result.autoCollapsed.size).toBe(0);
  expect(result.periodWidth).toBe(70);
  expect(result.overflows).toBe(false);
});

test("table width includes pixels distributed across period columns", () => {
  const result = fit({ available: 953 });

  expect(result.columnWidths.reduce((total, width) => total + width, 0)).toBe(633);
  expect(result.tableWidth).toBe(953);
});

test("a year of weeks folds until it fits, and then fits", () => {
  const result = fit({ periods: YEAR, available: 1130 });

  expect(result.autoCollapsed.size).toBeGreaterThan(0);
  expect(result.overflows).toBe(false);
  expect(result.tableWidth).toBeLessThanOrEqual(1130);
  expect(result.periodWidth).toBeGreaterThanOrEqual(MIN_PERIOD_WIDTH_EDITABLE);
});

test("the month holding the data date is never folded for you", () => {
  const result = fit({ periods: YEAR, available: 1130, dataDate: "2026-06-10" });

  expect(result.autoCollapsed.size).toBeGreaterThan(0);
  expect(result.autoCollapsed.has("2026-06")).toBe(false);
});

test("months furthest from the data date fold first", () => {
  // Wide enough that only a couple of folds are needed, so the choice shows.
  const result = fit({ periods: YEAR, available: 1130, dataDate: "2026-06-10" });

  expect(result.autoCollapsed.has("2026-01")).toBe(true);
  expect(result.autoCollapsed.has("2026-12")).toBe(true);
});

test("a month the reader unfolded is never folded again by the fitter", () => {
  // Fold everything automatically first, then unfold March by hand.
  const auto = fit({ periods: YEAR, available: 1130 });
  expect(auto.collapsed.has("2026-03")).toBe(true);

  const state = toggleFold(NONE, "2026-03", true);
  const result = fit({ periods: YEAR, available: 1130, state });

  expect(result.collapsed.has("2026-03")).toBe(false);
});

test("protecting an unfold that cannot fit reports overflow rather than re-folding it", () => {
  // A narrow container plus an unfolded month: something has to give, and it is
  // the no-scroll promise, not the reader's explicit choice.
  const state = toggleFold(NONE, "2026-03", true);
  const result = fit({ periods: YEAR, available: 520, state });

  expect(result.collapsed.has("2026-03")).toBe(false);
  expect(result.overflows).toBe(true);
  expect(result.periodWidth).toBe(MIN_PERIOD_WIDTH_EDITABLE);
});

test("a month the reader folded by hand stays folded even when there is room", () => {
  const state = toggleFold(NONE, "2026-05", false);
  const result = fit({ state });

  expect(result.collapsed.has("2026-05")).toBe(true);
  expect(result.autoCollapsed.has("2026-05")).toBe(false);
  // May's four periods became one column.
  expect(result.columnWidths).toHaveLength(6);
});

test("column widths spend the whole budget, to the pixel", () => {
  // 9 columns into 631px does not divide evenly; the remainder must not vanish.
  const result = fit({ available: 951 });
  const total = result.columnWidths.reduce((sum, width) => sum + width, 0);

  expect(total).toBe(951 - 320);
});

test("a short grid does not stretch its columns across the whole card", () => {
  const result = fit({ periods: SHORT.slice(0, 3), available: 1130 });

  expect(result.columnWidths).toEqual([MAX_PERIOD_WIDTH, MAX_PERIOD_WIDTH, MAX_PERIOD_WIDTH]);
});

test("before the container is measured, nothing folds", () => {
  const result = fit({ periods: YEAR, available: 0 });

  expect(result.autoCollapsed.size).toBe(0);
  expect(result.overflows).toBe(false);
  expect(result.periodWidth).toBe(MAX_PERIOD_WIDTH);
});

test("a read-only grid fits more columns than an editable one", () => {
  const readonly = fit({ periods: YEAR, available: 1130, minPeriodWidth: MIN_PERIOD_WIDTH_READONLY });
  const editable = fit({ periods: YEAR, available: 1130, minPeriodWidth: MIN_PERIOD_WIDTH_EDITABLE });

  expect(readonly.autoCollapsed.size).toBeLessThanOrEqual(editable.autoCollapsed.size);
});

test("a single-period month is never counted as a fold candidate", () => {
  // July holds one week; folding it would change nothing, and buildMatrixColumns
  // refuses to. The fitter has to agree or its arithmetic drifts from the grid.
  const result = fit({ periods: SHORT, available: 400 });

  expect(result.autoCollapsed.has("2026-07")).toBe(false);
});
