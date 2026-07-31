// This package sets `"types": []` on purpose — it targets the browser, and
// pulling in bun/node globals is how `process` and `Buffer` end up in a
// component by accident. The reference is scoped to this file so the test gets
// checked without opening that door for src.
/// <reference types="bun" />
import { expect, test } from "bun:test";

import {
  CALENDAR_WEEKS,
  DAYS_PER_WEEK,
  addDays,
  addMonths,
  clampToRange,
  daysBetween,
  daysInMonth,
  firstDayOfWeek,
  isISODate,
  isOutOfRange,
  isSameMonth,
  monthGrid,
  monthLabel,
  parseISODate,
  startOfMonth,
  toISODate,
  weekdayNames,
} from "./calendar-date";

/**
 * The month grid and the span readout are both built out of these, so an
 * off-by-one here is an off-by-one on screen. The cases that matter are the ones
 * where naive date arithmetic is wrong: month-end clamping, leap years, and the
 * local-vs-UTC parse that shifts a whole calendar by a day.
 */

test("parses and formats an ISO day without shifting it", () => {
  expect(toISODate(parseISODate("2026-08-01")!)).toBe("2026-08-01");
  expect(toISODate(parseISODate("2026-12-31")!)).toBe("2026-12-31");
  // Whatever zone the test runs in, the day is the day.
  expect(parseISODate("2026-08-01")!.getUTCDate()).toBe(1);
});

test("rejects anything that is not a real calendar day", () => {
  for (const bad of ["", "2026-8-1", "2026-02-31", "2026-13-01", "not a date", null, undefined]) {
    expect(parseISODate(bad)).toBeNull();
    expect(isISODate(bad)).toBe(false);
  }
  expect(isISODate("2026-02-28")).toBe(true);
  // 2024 is a leap year, 2026 is not.
  expect(isISODate("2024-02-29")).toBe(true);
  expect(isISODate("2026-02-29")).toBe(false);
});

test("addMonths clamps to the end of a shorter month instead of rolling over", () => {
  // The bug this guards: 31 Jan + 1 month as day arithmetic gives 3 March, so a
  // "next month" button skips February entirely.
  expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
  expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
  expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
  expect(addMonths("2026-05-31", 1)).toBe("2026-06-30");
  // Days that exist in both months are untouched.
  expect(addMonths("2026-01-15", 1)).toBe("2026-02-15");
});

test("addMonths crosses year boundaries in both directions", () => {
  expect(addMonths("2026-12-15", 1)).toBe("2027-01-15");
  expect(addMonths("2026-01-15", -1)).toBe("2025-12-15");
  expect(addMonths("2026-06-15", 12)).toBe("2027-06-15");
  expect(addMonths("2026-06-15", -18)).toBe("2024-12-15");
  // Negative modulo is the easy thing to get wrong stepping back over January.
  expect(addMonths("2026-01-31", -11)).toBe("2025-02-28");
});

test("addDays crosses months, years and leap days", () => {
  expect(addDays("2026-08-01", 31)).toBe("2026-09-01");
  expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
  expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
  expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
  expect(addDays("2026-08-01", 0)).toBe("2026-08-01");
});

test("daysBetween is exact across a DST boundary", () => {
  // Northern-hemisphere clocks change inside this range. Because both ends are
  // UTC midnight there is no 23- or 25-hour day to round away.
  expect(daysBetween("2026-03-01", "2026-04-01")).toBe(31);
  expect(daysBetween("2026-10-01", "2026-11-01")).toBe(31);
  // A calendar month of contract, read inclusively, is 31 days.
  expect(daysBetween("2026-08-01", "2026-08-31") + 1).toBe(31);
  expect(daysBetween("2026-08-01", "2026-08-01")).toBe(0);
  expect(daysBetween("2026-08-31", "2026-08-01")).toBe(-30);
  // The span the dialog reports for a typical contract window.
  expect(Math.round(daysBetween("2026-08-01", "2027-03-31") / 7)).toBe(35);
});

test("daysInMonth knows February", () => {
  expect(daysInMonth(2026, 1)).toBe(28);
  expect(daysInMonth(2024, 1)).toBe(29);
  expect(daysInMonth(2000, 1)).toBe(29); // divisible by 400
  expect(daysInMonth(1900, 1)).toBe(28); // divisible by 100 but not 400
  expect(daysInMonth(2026, 0)).toBe(31);
  expect(daysInMonth(2026, 3)).toBe(30);
});

test("startOfMonth and isSameMonth", () => {
  expect(startOfMonth("2026-08-17")).toBe("2026-08-01");
  expect(startOfMonth("2026-08-01")).toBe("2026-08-01");
  expect(isSameMonth("2026-08-01", "2026-08-31")).toBe(true);
  expect(isSameMonth("2026-08-31", "2026-09-01")).toBe(false);
  expect(isSameMonth("2025-08-01", "2026-08-01")).toBe(false);
});

test("monthGrid is always six aligned weeks", () => {
  for (const month of ["2026-02-01", "2026-08-01", "2027-01-01", "2024-02-01"]) {
    for (const weekStart of [0, 1]) {
      const grid = monthGrid(month, weekStart);
      expect(grid).toHaveLength(CALENDAR_WEEKS * DAYS_PER_WEEK);
      // Every row starts on the locale's first weekday...
      expect(parseISODate(grid[0]!)!.getUTCDay()).toBe(weekStart);
      // ...and the days run consecutively with no gap or repeat.
      for (let i = 1; i < grid.length; i++) {
        expect(grid[i]).toBe(addDays(grid[i - 1]!, 1));
      }
      // The whole month is in there.
      expect(grid).toContain(month);
      expect(grid.filter((day) => isSameMonth(day, month))).toHaveLength(
        daysInMonth(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1),
      );
    }
  }
});

test("monthGrid puts the first of the month in the right column", () => {
  // 1 August 2026 is a Saturday.
  const sundayFirst = monthGrid("2026-08-01", 0);
  expect(sundayFirst.indexOf("2026-08-01")).toBe(6);
  const mondayFirst = monthGrid("2026-08-01", 1);
  expect(mondayFirst.indexOf("2026-08-01")).toBe(5);
  // A month starting on the week's first day still gets a full leading week
  // rather than none, so the grid never shows the 1st in the top-left corner
  // with five trailing weeks of the next month.
  const thursdayStart = monthGrid("2026-10-01", 4);
  expect(thursdayStart[0]).toBe("2026-10-01");
});

test("firstDayOfWeek differs between the app's two locales", () => {
  // The reason this function exists rather than a hardcoded Monday.
  const us = firstDayOfWeek("en-US");
  const indonesia = firstDayOfWeek("id-ID");
  expect([0, 1]).toContain(us);
  expect([0, 1]).toContain(indonesia);
  // Falls back rather than throwing on a tag Intl cannot parse.
  expect(firstDayOfWeek("not a locale!")).toBe(1);
});

test("weekdayNames is seven names rotated to the week start", () => {
  const sundayFirst = weekdayNames("en-US", 0);
  const mondayFirst = weekdayNames("en-US", 1);
  expect(sundayFirst).toHaveLength(DAYS_PER_WEEK);
  expect(new Set(sundayFirst).size).toBe(DAYS_PER_WEEK);
  // Same seven names, rotated by one.
  expect(mondayFirst[0]).toBe(sundayFirst[1]);
  expect(mondayFirst[6]).toBe(sundayFirst[0]);
});

test("monthLabel follows the locale", () => {
  expect(monthLabel("2026-08-01", "en-US")).toContain("2026");
  // Indonesian names the month differently, which is the whole point of Intl.
  expect(monthLabel("2026-08-01", "id-ID")).not.toBe(monthLabel("2026-08-01", "en-US"));
});

test("range helpers use lexicographic order, which ISO days satisfy", () => {
  expect(clampToRange("2026-01-01", "2026-06-01", "2026-12-31")).toBe("2026-06-01");
  expect(clampToRange("2027-01-01", "2026-06-01", "2026-12-31")).toBe("2026-12-31");
  expect(clampToRange("2026-08-01", "2026-06-01", "2026-12-31")).toBe("2026-08-01");
  expect(clampToRange("2026-08-01")).toBe("2026-08-01");

  expect(isOutOfRange("2026-08-01", "2026-09-01")).toBe(true);
  expect(isOutOfRange("2026-08-01", null, "2026-07-01")).toBe(true);
  expect(isOutOfRange("2026-08-01", "2026-01-01", "2026-12-31")).toBe(false);
  expect(isOutOfRange("2026-08-01")).toBe(false);
});
