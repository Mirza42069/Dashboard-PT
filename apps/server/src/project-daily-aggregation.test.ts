import { expect, test } from "bun:test";

import { aggregateDailyProgress } from "./project-daily-aggregation";
import type { ParsedDailyProgressItem, ParsedDailyProgressSnapshot } from "./project-daily-progress";

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
