import { expect, test } from "bun:test";

import { aggregateDailyProgress } from "./project-daily-aggregation";
import type { DailyProgressMapping, ParsedDailyProgressItem, ParsedDailyProgressSnapshot } from "./project-daily-progress";

const periods = [
  { periodIndex: 1, startDate: "2026-08-01", endDate: "2026-08-07" },
  { periodIndex: 2, startDate: "2026-08-08", endDate: "2026-08-14" },
];
const rows = [{ row: 10, description: "Roof", weight: 100, quantity: 1, unitRate: 1000 }];
function detail(sourceRow: number, weight: number, cumulativePercent: number): ParsedDailyProgressItem {
  return {
    sourceRow, description: `Activity ${sourceRow}`, code: null,
    parentCode: null, parentDescription: "Roof", sectionCode: null, sectionDescription: "Structure",
    quantity: 1, unitRate: weight * 10, amount: weight * 10, weight, unit: "LS",
    previousPercent: cumulativePercent, currentPercent: null, cumulativePercent,
    remainingPercent: 100 - cumulativePercent, previousWeighted: weight * cumulativePercent / 100,
    currentWeighted: null, cumulativeWeighted: weight * cumulativePercent / 100,
    remainingWeighted: weight * (100 - cumulativePercent) / 100, remark: null, sourceValues: {},
  };
}
function snapshot(reportDate = "2026-08-07"): ParsedDailyProgressSnapshot {
  return { reportDate, sourceSheetName: reportDate, cumulativePercent: 25, items: [detail(1, 25, 100), detail(2, 75, 0)] };
}

test("aggregates weighted completion, preserving explicit zeros and source rows", () => {
  const result = aggregateDailyProgress(rows, [snapshot()], periods, []);
  expect(result.warnings).toEqual([]);
  expect(result.entries).toMatchObject([{ row: 10, periodIndex: 1, pctComplete: 25, cumulativeQuantity: 0.25 }]);
  expect(JSON.parse(result.entries[0]!.sourceValue).detailRows).toEqual([1, 2]);
  expect(result.entries.some((entry) => entry.periodIndex === 2)).toBe(false);
});

test("selects the latest daily report irrespective of input order", () => {
  const older = snapshot("2026-08-01");
  older.items = [detail(1, 25, 0), detail(2, 75, 0)];
  older.cumulativePercent = 0;
  expect(aggregateDailyProgress(rows, [snapshot(), older], periods, []).entries[0]?.pctComplete).toBe(25);
});

test("keeps a period entirely blank if any detail is unmatched or ambiguous", () => {
  const unmatched = snapshot();
  unmatched.items[1]!.parentDescription = "Unknown";
  for (const result of [
    aggregateDailyProgress(rows, [unmatched], periods, []),
    aggregateDailyProgress([...rows, { ...rows[0]!, row: 11 }], [snapshot()], periods, []),
  ]) {
    expect(result.entries).toEqual([]);
    expect(result.warnings).toHaveLength(1);
  }
});

test("rejects mismatched weights, prices, uncovered baseline rows, and source totals", () => {
  for (const result of [
    aggregateDailyProgress([{ ...rows[0]!, weight: 90 }], [snapshot()], periods, []),
    aggregateDailyProgress([{ ...rows[0]!, unitRate: 900 }], [snapshot()], periods, []),
    aggregateDailyProgress([...rows, { ...rows[0]!, row: 11, description: "Other" }], [snapshot()], periods, []),
    aggregateDailyProgress(rows, [snapshot()], periods, [{ periodIndex: 1, cumulativePercent: 30 }]),
    aggregateDailyProgress(rows, [{ ...snapshot(), cumulativePercent: 30 }], periods, []),
  ]) {
    expect(result.entries).toEqual([]);
    expect(result.warnings).toHaveLength(1);
  }
});

test("a fully matched zero-progress report remains an explicit zero", () => {
  const report = snapshot();
  report.items = [detail(1, 100, 0)];
  report.cumulativePercent = 0;
  expect(aggregateDailyProgress(rows, [report], periods, []).entries[0]?.pctComplete).toBe(0);
});

test("out-of-calendar reports cannot produce entries", () => {
  const result = aggregateDailyProgress(rows, [snapshot("2026-09-01")], periods, []);
  expect(result.entries).toEqual([]);
  expect(result.warnings[0]).toContain("outside the reporting calendar");
});

const sourceMapping: DailyProgressMapping = {
  description: 2, quantity: 4, unitRate: 6, amount: 7, weight: 8,
  previousPercent: 9, previousWeighted: 10, currentPercent: 11, currentWeighted: 12,
  cumulativePercent: 13, cumulativeWeighted: 14, remainingPercent: 15, remainingWeighted: 16,
};

function report(reportDate: string, previous: number, cumulative: number): ParsedDailyProgressSnapshot {
  return {
    reportDate, sourceSheetName: reportDate, cumulativePercent: cumulative,
    items: [{
      ...detail(1, 100, cumulative), previousPercent: previous, previousWeighted: previous,
      currentPercent: cumulative - previous, currentWeighted: cumulative - previous,
      sourceValues: { I: previous / 100, J: previous },
    }],
  };
}

test("fills every source-backed period, including explicit zero and the latest boundary reading", () => {
  const calendar = [...periods, { periodIndex: 3, startDate: "2026-08-15", endDate: "2026-08-21" }];
  const result = aggregateDailyProgress(rows, [
    report("2026-08-21", 60, 75), report("2026-08-15", 50, 60), report("2026-08-08", 0, 25),
  ], calendar, [
    { periodIndex: 1, cumulativePercent: 0 }, { periodIndex: 2, cumulativePercent: 50 },
    { periodIndex: 3, cumulativePercent: 75 },
  ], sourceMapping);
  expect(result.warnings).toEqual([]);
  expect(result.entries.map((entry) => [entry.periodIndex, entry.pctComplete])).toEqual([[1, 0], [2, 50], [3, 75]]);
  expect(result.entries[0]?.sourceColumn).toBe(9);
  expect(JSON.parse(result.entries[1]!.sourceValue)).toMatchObject({
    basis: "previous", reportDate: "2026-08-15", readingDate: "2026-08-14",
  });
  expect(result.entries[2]?.sourceColumn).toBe(13);
});

test("previous readings need an Excel source, a contiguous boundary, and a prior actual total", () => {
  const actuals = [{ periodIndex: 1, cumulativePercent: 25 }];
  for (const result of [
    aggregateDailyProgress(rows, [report("2026-08-08", 25, 50)], periods, actuals),
    aggregateDailyProgress(rows, [report("2026-08-09", 25, 50)], periods, actuals, sourceMapping),
    aggregateDailyProgress(rows, [report("2026-08-08", 25, 50)], periods, [], sourceMapping),
    aggregateDailyProgress(rows, [report("2026-08-08", 25, 50)], [
      { ...periods[0]!, endDate: "2026-08-06" }, periods[1]!,
    ], actuals, sourceMapping),
  ]) {
    expect(result.entries.map((entry) => entry.periodIndex)).toEqual([2]);
  }
});

test("blank or invalid previous source cells cannot become historical zeros", () => {
  for (const raw of [null, undefined, "", "#REF!"]) {
    const source = report("2026-08-08", 0, 50);
    if (raw === undefined) delete source.items[0]!.sourceValues.I;
    else source.items[0]!.sourceValues.I = raw;
    const result = aggregateDailyProgress(rows, [source], periods, [{ periodIndex: 1, cumulativePercent: 0 }], sourceMapping);
    expect(result.entries.map((entry) => entry.periodIndex)).toEqual([2]);
    expect(result.warnings[0]).toContain("missing or inconsistent previous progress");
  }
});

test("inconsistent previous weights or totals do not discard valid current readings", () => {
  const badWeight = report("2026-08-08", 25, 50);
  badWeight.items[0]!.previousWeighted = 30;
  for (const source of [badWeight, report("2026-08-08", 30, 50), report("2026-08-08", 60, 50)]) {
    const result = aggregateDailyProgress(rows, [source], periods, [{ periodIndex: 1, cumulativePercent: 25 }], sourceMapping);
    expect(result.entries.map((entry) => [entry.periodIndex, entry.pctComplete])).toEqual([[2, 50]]);
    expect(result.warnings).toHaveLength(1);
  }
});

test("a blank previous value can be established by explicit cumulative and current readings", () => {
  for (const cumulative of [0, 50]) {
    const source = report("2026-08-08", 0, cumulative);
    source.items[0]!.sourceValues = { M: cumulative / 100 };
    if (cumulative === 0) source.items[0]!.currentPercent = null;
    const result = aggregateDailyProgress(rows, [source], periods, [{ periodIndex: 1, cumulativePercent: 0 }], sourceMapping);
    expect(result.warnings).toEqual([]);
    expect(result.entries.map((entry) => [entry.periodIndex, entry.pctComplete])).toEqual([[1, 0], [2, cumulative]]);
    expect(JSON.parse(result.entries[0]!.sourceValue).derivedPreviousRows).toEqual([1]);
  }
  const unknown = report("2026-08-08", 0, 50);
  unknown.items[0]!.sourceValues = { M: 0.5 };
  unknown.items[0]!.currentPercent = null;
  expect(aggregateDailyProgress(rows, [unknown], periods, [{ periodIndex: 1, cumulativePercent: 0 }], sourceMapping)
    .entries.map((entry) => entry.periodIndex)).toEqual([2]);
});

test("overlapping end-of-period reports are deduplicated and conflicts are reported", () => {
  for (const previous of [25, 30]) {
    const result = aggregateDailyProgress(rows, [report("2026-08-08", previous, 50), report("2026-08-07", 0, 25)],
      periods, [{ periodIndex: 1, cumulativePercent: 25 }], sourceMapping);
    expect(result.entries.map((entry) => [entry.periodIndex, entry.pctComplete])).toEqual([[1, 25], [2, 50]]);
    expect(result.warnings).toHaveLength(previous === 25 ? 0 : 1);
    expect(result.entries[0]?.sourceColumn).toBe(13);
  }
});

test("a previous-period reading cannot decrease an earlier imported item", () => {
  const calendar = [...periods, { periodIndex: 3, startDate: "2026-08-15", endDate: "2026-08-21" }];
  const result = aggregateDailyProgress(rows, [report("2026-08-07", 0, 40), report("2026-08-15", 30, 50)],
    calendar, [{ periodIndex: 1, cumulativePercent: 40 }, { periodIndex: 2, cumulativePercent: 30 }], sourceMapping);
  expect(result.entries.map((entry) => entry.periodIndex)).toEqual([1, 3]);
  expect(result.warnings[0]).toContain("decreases");
});

test("invalid previous-column readings preserve a valid earlier daily report", () => {
  const boundary = report("2026-08-08", 25, 50);
  boundary.items[0]!.previousWeighted = 30;
  const result = aggregateDailyProgress(rows, [boundary, report("2026-08-06", 0, 25)],
    periods, [{ periodIndex: 1, cumulativePercent: 25 }], sourceMapping);
  expect(result.entries.map((entry) => [entry.periodIndex, entry.pctComplete])).toEqual([[1, 25], [2, 50]]);
  expect(result.entries[0]?.sourceSheetName).toBe("2026-08-06");
  expect(result.warnings).toHaveLength(1);
});
