import { expect, test } from "bun:test";

import {
  CUSTOM_PERIOD_MAX_DAYS,
  PeriodRangeError,
  endDateForPeriodCount,
  generatePeriods,
  groupPeriodsByMonth,
  monthKeyOf,
} from "./periods";

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

test("an exact period count produces the completion date used by the importer", () => {
  expect(endDateForPeriodCount("2026-05-03", 17, "weekly")).toBe("2026-08-29");
  expect(generatePeriods("2026-05-03", "2026-08-29", "weekly")).toHaveLength(17);
});

test("monthly completion follows calendar-month boundaries", () => {
  expect(endDateForPeriodCount("2026-01-15", 3, "monthly")).toBe("2026-03-31");
});

test("the documented maximum period count is accepted", () => {
  const end = endDateForPeriodCount("2026-01-01", 600, "weekly");
  expect(generatePeriods("2026-01-01", end, "weekly")).toHaveLength(600);
});

/**
 * The cadences added after the original weekly / biweekly / monthly three.
 *
 * Every calendar cadence gives a *short first bucket* when the schedule starts
 * mid-cycle and whole buckets after it — the rule the monthly arm already
 * followed, now shared. The dates below are all real starts chosen to land
 * mid-cycle, because that is the case a naive implementation gets wrong.
 */

test("a daily axis is one bucket per day", () => {
  const periods = generatePeriods("2026-01-08", "2026-01-12", "daily");

  expect(periods).toHaveLength(5);
  expect(periods.map((period) => period.label)).toEqual(["D1", "D2", "D3", "D4", "D5"]);
  // A day starts and ends on itself.
  expect(periods.every((period) => period.startDate === period.endDate)).toBe(true);
  expect(periods.at(-1)?.endDate).toBe("2026-01-12");
});

test("a semi-monthly axis splits each month at the 15th", () => {
  const periods = generatePeriods("2026-01-08", "2026-02-28", "semimonthly");

  expect(periods.map((period) => [period.label, period.startDate, period.endDate])).toEqual([
    // Short first bucket: the 8th is inside the first half, so it ends with it.
    ["S1", "2026-01-08", "2026-01-15"],
    ["S2", "2026-01-16", "2026-01-31"],
    ["S3", "2026-02-01", "2026-02-15"],
    // February's second half is three days shorter, which is the calendar's
    // business and not the cadence's.
    ["S4", "2026-02-16", "2026-02-28"],
  ]);
});

test("a semi-monthly axis starting after the 15th opens with the second half", () => {
  const periods = generatePeriods("2026-01-20", "2026-02-15", "semimonthly");

  expect(periods.map((period) => [period.startDate, period.endDate])).toEqual([
    ["2026-01-20", "2026-01-31"],
    ["2026-02-01", "2026-02-15"],
  ]);
});

test("a quarterly axis follows calendar quarters", () => {
  const periods = generatePeriods("2026-02-10", "2026-12-31", "quarterly");

  expect(periods.map((period) => [period.label, period.startDate, period.endDate])).toEqual([
    // Starts inside Q1, so the first bucket is what is left of it.
    ["Q1", "2026-02-10", "2026-03-31"],
    ["Q2", "2026-04-01", "2026-06-30"],
    ["Q3", "2026-07-01", "2026-09-30"],
    ["Q4", "2026-10-01", "2026-12-31"],
  ]);
});

test("a custom axis repeats a fixed number of days", () => {
  const periods = generatePeriods("2026-01-08", "2026-02-06", "custom", 10);

  expect(periods.map((period) => [period.label, period.startDate, period.endDate])).toEqual([
    ["C1", "2026-01-08", "2026-01-17"],
    ["C2", "2026-01-18", "2026-01-27"],
    // Runs across the month boundary without noticing it, which is the point.
    ["C3", "2026-01-28", "2026-02-06"],
  ]);
});

test("a custom cadence refuses a cycle it cannot honour", () => {
  // Loud rather than defaulting: a silent fallback would generate a whole axis
  // at a cadence nobody chose.
  for (const days of [0, -1, CUSTOM_PERIOD_MAX_DAYS + 1, 2.5, null]) {
    expect(() => generatePeriods("2026-01-08", "2026-03-01", "custom", days)).toThrow(
      PeriodRangeError,
    );
  }
  expect(() => generatePeriods("2026-01-08", "2026-03-01", "custom")).toThrow(PeriodRangeError);
  expect(() => endDateForPeriodCount("2026-01-08", 3, "custom")).toThrow(PeriodRangeError);
});

test("a cycle length is ignored by every calendar cadence", () => {
  // The column can still hold a value from an earlier custom setting; it must
  // not bend an axis that derives its length from the calendar.
  expect(generatePeriods("2026-01-08", "2026-02-28", "semimonthly", 10)).toEqual(
    generatePeriods("2026-01-08", "2026-02-28", "semimonthly"),
  );
  expect(generatePeriods("2026-05-02", "2026-08-29", "weekly", 3)).toEqual(
    generatePeriods("2026-05-02", "2026-08-29", "weekly"),
  );
});

test("the completion date agrees with the axis for every cadence", () => {
  // The invariant the importer leans on, checked across all seven rather than
  // only the weekly one it was written for.
  const cases = [
    ["2026-01-08", 5, "daily", null],
    ["2026-05-03", 17, "weekly", null],
    ["2026-05-04", 6, "biweekly", null],
    ["2026-01-08", 4, "semimonthly", null],
    ["2026-01-15", 3, "monthly", null],
    ["2026-02-10", 4, "quarterly", null],
    ["2026-01-08", 3, "custom", 10],
  ] as const;

  for (const [start, count, type, lengthDays] of cases) {
    const end = endDateForPeriodCount(start, count, type, lengthDays);
    expect(generatePeriods(start, end, type, lengthDays)).toHaveLength(count);
  }
});

test("every new cadence still bands into months without losing a period", () => {
  for (const [type, start, finish, lengthDays] of [
    ["daily", "2026-01-08", "2026-03-12", null],
    ["semimonthly", "2026-01-08", "2026-06-30", null],
    ["quarterly", "2026-02-10", "2026-12-31", null],
    ["custom", "2026-01-08", "2026-06-30", 10],
  ] as const) {
    const periods = generatePeriods(start, finish, type, lengthDays);
    const groups = groupPeriodsByMonth(periods);

    expect(groups.reduce((total, group) => total + group.span, 0)).toBe(periods.length);
    // Consecutive runs, so a month never appears in two bands.
    expect(new Set(groups.map((group) => group.monthKey)).size).toBe(groups.length);
  }
});

test("a whole quarter is banded under the month holding most of its days", () => {
  // monthKeyOf stops counting at 62 days, so a full quarter is decided on its
  // first two months plus a sliver of the third — which lands on the longest of
  // them. Deliberately not special-cased: the band is one column wide either
  // way, so the label is all that is at stake.
  expect(monthKeyOf({ startDate: "2026-04-01", endDate: "2026-06-30" })).toBe("2026-05");
});
