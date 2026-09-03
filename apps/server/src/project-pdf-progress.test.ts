import { expect, test } from "bun:test";

import type { PdfExtraction } from "./project-pdf";
import {
  parsePdfDailyProgress,
  resolvePdfProgressPeriod,
} from "./project-pdf-progress";

function extraction(): PdfExtraction {
  return {
    projectCode: null,
    projectName: "Progress fixture",
    client: null,
    location: null,
    startDate: null,
    scheduleStartDate: null,
    endDate: null,
    periodType: "weekly",
    confidence: "high",
    warnings: [],
    metadataSources: {
      projectCode: null,
      projectName: { page: 1, table: "Header", sourceRow: 1 },
      client: null,
      location: null,
      startDate: null,
      scheduleStartDate: null,
      endDate: null,
      periodType: { page: 1, table: "Progress", sourceRow: 1 },
    },
    rows: [
      {
        page: 1,
        table: "Progress A",
        sourceRow: 1,
        kind: "item",
        code: "1",
        description: "First item",
        unit: "LS",
        quantity: 1,
        unitRate: 60,
        amount: 60,
        weight: 60,
        startPeriodIndex: null,
        finishPeriodIndex: null,
        progress: {
          sectionCode: "BILL I",
          sectionDescription: "Preliminaries",
          parentCode: null,
          parentDescription: null,
          previousPercent: 50,
          currentPercent: null,
          cumulativePercent: 50,
          remainingPercent: 50,
          previousWeighted: 30,
          currentWeighted: null,
          cumulativeWeighted: 30,
          remainingWeighted: 30,
          remark: null,
        },
      },
      {
        page: 2,
        table: "Progress B",
        sourceRow: 1,
        kind: "item",
        code: "2",
        description: "Second item",
        unit: "LS",
        quantity: 1,
        unitRate: 40,
        amount: 40,
        weight: 40,
        startPeriodIndex: null,
        finishPeriodIndex: null,
        progress: {
          sectionCode: "BILL II",
          sectionDescription: "Structure",
          parentCode: null,
          parentDescription: null,
          previousPercent: 25,
          currentPercent: 25,
          cumulativePercent: 50,
          remainingPercent: 50,
          previousWeighted: 10,
          currentWeighted: 10,
          cumulativeWeighted: 20,
          remainingWeighted: 20,
          remark: "Installed",
        },
      },
    ],
    actualSnapshots: [],
    progressReport: {
      reportDate: null,
      reportDateSource: null,
      grandTotal: {
        page: 2,
        table: "Grand total",
        sourceRow: 4,
        cumulativePercent: 50,
        sourceValue: "50.00",
      },
    },
  };
}

test("validates an undated PDF progress report and preserves unique source rows", () => {
  const parsed = parsePdfDailyProgress(extraction());

  expect(parsed?.errors).toEqual([]);
  expect(parsed?.snapshot).toBeNull();
  expect(parsed?.preview).toMatchObject({
    itemCount: 2,
    dates: [],
    latestCumulativePercent: 50,
  });
  expect(parsed?.items.map((item) => item.sourceRow)).toEqual([1, 2]);
  expect(parsed?.items[1]?.sourceValues).toMatchObject({
    page: 2,
    table: "Progress B",
    sourceRow: 1,
  });
});

test("rejects inconsistent item calculations and grand totals", () => {
  const source = extraction();
  source.rows[0]!.progress!.cumulativePercent = 40;
  source.progressReport!.grandTotal.cumulativePercent = 90;

  const errors = parsePdfDailyProgress(source)?.errors.map((error) => error.message) ?? [];
  expect(errors.some((message) => message.includes("previous plus current"))).toBe(true);
  expect(errors.some((message) => message.includes("reported grand total"))).toBe(true);
});

test("requires an undated PDF report to be placed inside a reporting period", () => {
  const periods = [
    { periodIndex: 15, startDate: "2026-08-09", endDate: "2026-08-15" },
    { periodIndex: 16, startDate: "2026-08-16", endDate: "2026-08-22" },
  ];

  expect(resolvePdfProgressPeriod(null, undefined, periods)).toEqual({
    reportDate: null,
    period: null,
  });
  expect(resolvePdfProgressPeriod(null, "2026-08-22", periods)).toMatchObject({
    reportDate: "2026-08-22",
    period: { periodIndex: 16 },
  });
  expect(resolvePdfProgressPeriod(null, "2026-08-23", periods)).toEqual({
    reportDate: "2026-08-23",
    period: null,
  });
});
