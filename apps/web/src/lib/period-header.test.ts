import { expect, test } from "bun:test";

import {
  buildMatrixColumns,
  buildPeriodHeader,
  lastPeriodOf,
  periodsOf,
  type PeriodLike,
} from "./period-header";

/**
 * Four weeks of May, four of June, one of July.
 *
 * The July run is deliberately a single period: a month one column wide is the
 * case where folding would be a control that visibly does nothing, and the band
 * has to know not to offer it.
 */
const PERIODS: PeriodLike[] = [
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

/** Enough of the locale formatters for the header model; nothing here is localised. */
const FORMAT = {
  formatDateRange: (start: string, end: string) => `${start}..${end}`,
  formatMonthKey: (key: string) => key,
};

test("nothing folded leaves one column per period", () => {
  const columns = buildMatrixColumns(PERIODS, new Set());

  expect(columns).toHaveLength(PERIODS.length);
  expect(columns.every((column) => column.kind === "period")).toBe(true);
});

test("a folded month becomes exactly one column and the rest are untouched", () => {
  const columns = buildMatrixColumns(PERIODS, new Set(["2026-05"]));

  // Four May weeks became one; June's four and July's one are unchanged.
  expect(columns).toHaveLength(6);
  expect(columns[0]!.kind).toBe("month");
  expect(periodsOf(columns[0]!).map((period) => period.id)).toEqual([
    "p1",
    "p2",
    "p3",
    "p4",
  ]);
  expect(columns.slice(1).every((column) => column.kind === "period")).toBe(true);
});

test("folding never drops a period", () => {
  for (const collapsed of [new Set<string>(), new Set(["2026-05"]), new Set(["2026-05", "2026-06"])]) {
    const columns = buildMatrixColumns(PERIODS, collapsed);
    const covered = columns.flatMap((column) => periodsOf(column).map((period) => period.id));
    expect(covered).toEqual(PERIODS.map((period) => period.id));
  }
});

test("a month holding one period is left expanded however hard it is folded", () => {
  // p9 runs 29 Jun - 5 Jul: five of its seven days are in July, so monthKeyOf
  // puts it under July, alone. Folding it would produce the same one column.
  const columns = buildMatrixColumns(PERIODS, new Set(["2026-07"]));

  expect(columns).toHaveLength(PERIODS.length);
  expect(columns.every((column) => column.kind === "period")).toBe(true);
});

test("a folded column reports the last period in the month", () => {
  const [may] = buildMatrixColumns(PERIODS, new Set(["2026-05"]));

  expect(lastPeriodOf(may!).id).toBe("p4");
});

test("the band spans columns, not periods", () => {
  const columns = buildMatrixColumns(PERIODS, new Set(["2026-05"]));
  const header = buildPeriodHeader(FORMAT, columns, null, new Set(["2026-05"]));

  const may = header.months.find((month) => month.monthKey === "2026-05")!;
  // One rendered cell, not four — spanning four here would push every column
  // after it out by three.
  expect(may.span).toBe(1);
  expect(may.collapsed).toBe(true);

  const june = header.months.find((month) => month.monthKey === "2026-06")!;
  expect(june.span).toBe(4);
  expect(june.collapsed).toBe(false);
});

test("only a month whose width would change offers a fold control", () => {
  const header = buildPeriodHeader(FORMAT, buildMatrixColumns(PERIODS, new Set()), null);

  expect(header.months.find((month) => month.monthKey === "2026-05")!.foldable).toBe(true);
  expect(header.months.find((month) => month.monthKey === "2026-06")!.foldable).toBe(true);
  // July is one period wide already.
  expect(header.months.find((month) => month.monthKey === "2026-07")!.foldable).toBe(false);
});

test("a folded month is still foldable, so it can be unfolded again", () => {
  const collapsed = new Set(["2026-05"]);
  const header = buildPeriodHeader(FORMAT, buildMatrixColumns(PERIODS, collapsed), null, collapsed);

  expect(header.months.find((month) => month.monthKey === "2026-05")!.foldable).toBe(true);
});

test("a folded column names the periods inside it", () => {
  const collapsed = new Set(["2026-05"]);
  const header = buildPeriodHeader(FORMAT, buildMatrixColumns(PERIODS, collapsed), null, collapsed);

  expect(header.columns[0]!.number).toBe("1–4");
  // The range runs from the first period's start to the last one's end.
  expect(header.columns[0]!.range).toBe("2026-05-04..2026-05-31");
  expect(header.columns[1]!.number).toBe("5");
});

test("the data date marks the folded month that contains it", () => {
  const collapsed = new Set(["2026-05"]);
  const header = buildPeriodHeader(
    FORMAT,
    buildMatrixColumns(PERIODS, collapsed),
    "2026-05-20",
    collapsed,
  );

  // Inside the fold, not merely at its edge — the marker must not go missing
  // just because the period holding it stopped having a column of its own.
  expect(header.columns[0]!.isCurrent).toBe(true);
  expect(header.columns.slice(1).every((column) => !column.isCurrent)).toBe(true);
});

test("no data date puts the marker nowhere", () => {
  const header = buildPeriodHeader(FORMAT, buildMatrixColumns(PERIODS, new Set()), null);

  expect(header.columns.every((column) => !column.isCurrent)).toBe(true);
});

test("a stale month key cannot make a column disappear", () => {
  // The set outlives the periods it was built against — an import that renames
  // or reschedules them must not fold something that is no longer there.
  const columns = buildMatrixColumns(PERIODS, new Set(["2019-01"]));

  expect(columns).toHaveLength(PERIODS.length);
});
