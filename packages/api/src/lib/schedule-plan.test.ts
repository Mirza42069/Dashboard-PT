import { expect, test } from "bun:test";

import {
  evenShares,
  planCells,
  planDuration,
  validatePlanWindow,
  weightPerPeriod,
} from "./schedule-plan";

/**
 * The planning window and what it spreads.
 *
 * The one property everything else rests on: a row must total *exactly* 100.
 * Activation compares each row against 100 within a half-percent tolerance, so
 * a spread that leaves float dust behind is a baseline that cannot be
 * activated — and the person hitting that button has no way to see why.
 */

const total = (values: number[]) => values.reduce((sum, value) => sum + value, 0);

test("an even spread totals exactly 100, whatever the duration", () => {
  for (const length of [1, 2, 3, 6, 7, 11, 13, 17, 52, 600]) {
    expect(total(evenShares(length))).toBeCloseTo(100, 9);
    expect(evenShares(length)).toHaveLength(length);
  }
});

test("the remainder lands on the final period, not spread as float dust", () => {
  const shares = evenShares(3);
  expect(shares[0]).toBe(33.333333);
  expect(shares[1]).toBe(33.333333);
  expect(shares[2]).toBe(33.333334);
});

test("a window of one period carries the whole line", () => {
  expect(evenShares(1)).toEqual([100]);
});

test("an empty window spreads nothing", () => {
  expect(evenShares(0)).toEqual([]);
  expect(evenShares(-3)).toEqual([]);
});

test("duration is inclusive of both ends, and zero when unset or inverted", () => {
  expect(planDuration(3, 17)).toBe(15);
  expect(planDuration(4, 4)).toBe(1);
  expect(planDuration(null, 9)).toBe(0);
  expect(planDuration(9, null)).toBe(0);
  expect(planDuration(9, 4)).toBe(0);
});

test("weight per period is the line's weight over its duration", () => {
  // The reference workbook's BOBOT/MINGGU column: 5.920528 over 15 weeks.
  expect(weightPerPeriod(5.920528, 15)).toBeCloseTo(0.394702, 6);
  expect(weightPerPeriod(10, 0)).toBeNull();
});

test("cells outside the window come back at zero so the old tail is cleared", () => {
  const periodIndexes = [1, 2, 3, 4, 5];
  const cells = planCells(periodIndexes, { startIndex: 2, finishIndex: 4 });

  // One cell per period, not just the window — the write path deletes zeros.
  expect(cells).toHaveLength(5);
  expect(cells.filter((cell) => cell.plannedPct === 0).map((cell) => cell.periodIndex)).toEqual([
    1, 5,
  ]);
  expect(total(cells.map((cell) => cell.plannedPct))).toBeCloseTo(100, 9);
});

test("a window covering everything still totals 100", () => {
  const cells = planCells([1, 2, 3], { startIndex: 1, finishIndex: 3 });
  expect(total(cells.map((cell) => cell.plannedPct))).toBeCloseTo(100, 9);
});

test("a finish before the start is rejected", () => {
  expect(validatePlanWindow({ startIndex: 9, finishIndex: 4 }, [1, 2, 3, 4, 9])).toEqual({
    kind: "finish_before_start",
  });
});

test("a window outside the project's periods is rejected with the real range", () => {
  expect(validatePlanWindow({ startIndex: 1, finishIndex: 40 }, [1, 2, 3])).toEqual({
    kind: "out_of_range",
    firstIndex: 1,
    lastIndex: 3,
  });
  expect(validatePlanWindow({ startIndex: 0, finishIndex: 2 }, [1, 2, 3])).toEqual({
    kind: "out_of_range",
    firstIndex: 1,
    lastIndex: 3,
  });
});

test("a window inside the project's periods passes", () => {
  expect(validatePlanWindow({ startIndex: 2, finishIndex: 3 }, [1, 2, 3])).toBeNull();
});
