import { expect, test } from "bun:test";

import { generatePeriods, groupPeriodsByMonth, monthKeyOf } from "./periods";

/**
 * The month bands above a schedule grid.
 *
 * The cases that matter are the boundary weeks, and the specification for those
 * is the reference workbook in ./reference: its week 5 runs 31 May - 6 June and
 * sits under JUNI, its week 13 runs 26 July - 1 August and sits under JULI.
 * Both fall out of counting days and neither falls out of using the start date,
 * which is what the naive implementation would have done.
 */

test("a period is filed under the month holding most of its days", () => {
  // One day in May, six in June.
  expect(monthKeyOf({ startDate: "2026-05-31", endDate: "2026-06-06" })).toBe("2026-06");
  // Six days in July, one in August.
  expect(monthKeyOf({ startDate: "2026-07-26", endDate: "2026-08-01" })).toBe("2026-07");
});

test("a period inside one month is filed under it", () => {
  expect(monthKeyOf({ startDate: "2026-05-17", endDate: "2026-05-23" })).toBe("2026-05");
});

test("an even split goes to the month the period starts in", () => {
  // 29, 30, 31 January and 1, 2, 3 February — three days each.
  expect(monthKeyOf({ startDate: "2026-01-29", endDate: "2026-02-03" })).toBe("2026-01");
});

test("the reference workbook's own boundary weeks land where its header puts them", () => {
  // Its week 5 and week 13 verbatim, from the date rows of the source sheet.
  expect(monthKeyOf({ startDate: "2026-05-31", endDate: "2026-06-06" })).toBe("2026-06"); // JUNI
  expect(monthKeyOf({ startDate: "2026-07-26", endDate: "2026-08-01" })).toBe("2026-07"); // JULI

  // Its week 14 runs 2-8 August and is nonetheless merged under JULI. That one
  // is a hand-drawn merged cell rather than a rule — no consistent reading of
  // those dates puts a wholly-August week in July — so it is deliberately not
  // reproduced. Counting days is what the other boundaries agree on.
  expect(monthKeyOf({ startDate: "2026-08-02", endDate: "2026-08-08" })).toBe("2026-08");
});

test("a weekly axis bands into consecutive months", () => {
  const periods = generatePeriods("2026-05-02", "2026-08-29", "weekly");
  const groups = groupPeriodsByMonth(periods);

  expect(groups.map((group) => group.monthKey)).toEqual([
    "2026-05",
    "2026-06",
    "2026-07",
    "2026-08",
  ]);
  expect(groups.map((group) => group.span)).toEqual([4, 5, 4, 5]);
  expect(groups.map((group) => group.startIndex)).toEqual([0, 4, 9, 13]);
  expect(groups.reduce((total, group) => total + group.span, 0)).toBe(periods.length);
});

test("groups are consecutive runs, so a month is never split into two bands", () => {
  const periods = generatePeriods("2026-01-01", "2026-03-31", "monthly");
  const groups = groupPeriodsByMonth(periods);

  expect(groups).toHaveLength(3);
  expect(groups.every((group) => group.span === 1)).toBe(true);
});

test("a biweekly axis still bands by month", () => {
  const periods = generatePeriods("2026-05-04", "2026-07-26", "biweekly");
  const groups = groupPeriodsByMonth(periods);

  // Every period lands in exactly one band and the spans account for them all.
  expect(groups.reduce((total, group) => total + group.span, 0)).toBe(periods.length);
  expect(new Set(groups.map((group) => group.monthKey)).size).toBe(groups.length);
});

test("an empty axis has no bands", () => {
  expect(groupPeriodsByMonth([])).toEqual([]);
});
