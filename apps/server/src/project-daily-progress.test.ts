import { expect, setDefaultTimeout, test } from "bun:test";
import { resolve } from "node:path";

import { loadWorkbook } from "./boq-import-parse";
import { parseDailyProgressWorkbook } from "./project-daily-progress";
import { aggregateDailyProgress } from "./project-daily-aggregation";
import {
  analyzeProjectWorkbook,
  prepareConfirmedWorkbook,
  reviewProjectWorkbook,
} from "./project-workbook";

setDefaultTimeout(90_000);

const REFERENCE = resolve(import.meta.dir, "../../../reference/DAILY PROGRESS WEEK 16.xlsx");

async function referenceBytes() {
  return new Uint8Array(await Bun.file(REFERENCE).arrayBuffer());
}

test("parses every dated daily progress sheet and reconciles the latest total", async () => {
  const parsed = parseDailyProgressWorkbook(await loadWorkbook(await referenceBytes()));

  expect(parsed?.errors).toEqual([]);
  expect(parsed?.preview).toMatchObject({
    sheetCount: 7,
    itemCount: 125,
    dates: [
      "2026-08-16",
      "2026-08-17",
      "2026-08-18",
      "2026-08-19",
      "2026-08-20",
      "2026-08-21",
      "2026-08-22",
    ],
    movementDates: ["2026-08-16", "2026-08-18", "2026-08-19"],
  });
  expect(parsed?.preview.latestCumulativePercent).toBeCloseTo(56.9230209578, 8);
  expect(parsed?.snapshots[1]?.items.every((item) => item.currentPercent === null)).toBe(true);
  expect(parsed?.snapshots[0]?.items[0]).toMatchObject({
    sectionCode: "BILL I",
    sectionDescription: "PRELIMINARIES",
    parentCode: null,
  });
  expect(parsed?.snapshots[0]?.items.find((item) => item.code === "1.1")).toMatchObject({
    sectionCode: "BILL III",
    sectionDescription: "STRUCTURE",
    parentCode: "1",
    parentDescription: "Detail Base plate (SC1)",
  });
  expect(parsed?.snapshots.at(-1)?.items.find((item) => item.sourceRow === 157)?.parentDescription)
    .toBe("Pekerjaan Relokasi Outdoor AC Existing Lantai 5 dan Instalasi Pipa Refrigrant");
  expect(parsed?.snapshots.at(-1)?.items.find((item) => item.sourceRow === 162)?.parentDescription)
    .toBe("Pekerjaan Relokasi Water Heater  Existing");
});

test("entire-workbook analysis signs and prepares all dated readings", async () => {
  const bytes = await referenceBytes();
  const analysis = await analyzeProjectWorkbook(bytes);

  expect(analysis.plan.sheetName).toBe("S CURVE (5)");
  expect(analysis.plan.dailyProgress?.sheets).toHaveLength(7);
  expect(analysis.dailyProgressPreview?.latestCumulativePercent).toBeCloseTo(56.9230209578, 8);

  const prepared = await prepareConfirmedWorkbook(bytes, {
    plan: analysis.plan,
    project: {
      code: "DAILY-16",
      name: "Daily progress fixture",
      client: null,
      location: null,
      startDate: "2026-05-02",
      scheduleStart: "2026-05-03",
      endDate: "2026-08-29",
      periodType: "weekly",
      periodLengthDays: null,
    },
  });
  expect(prepared.dailyProgress).toHaveLength(7);
  expect(prepared.dailyProgress[0]?.items).toHaveLength(125);
  expect(prepared.actualSnapshots.at(-1)?.periodIndex).toBe(16);
  expect(prepared.actualSnapshots.at(-1)?.cumulativePercent).toBeCloseTo(56.9230209578, 8);
  expect(prepared.itemProgress).toHaveLength(44);
  expect([...new Set(prepared.itemProgress.map((entry) => entry.periodIndex))]).toEqual([15, 16]);
  const current = prepared.itemProgress.filter((entry) => entry.periodIndex === 16);
  expect(current.find((entry) => entry.row === 13)?.pctComplete).toBeCloseTo(49, 8);
  expect(current.find((entry) => entry.row === 30)?.pctComplete).toBeCloseTo(53.7580261846, 8);
  expect(current.find((entry) => entry.row === 24)?.pctComplete).toBe(0);
  for (const [periodIndex, expectedTotal] of [[15, 49.2583702648], [16, 56.9230209578]]) {
    const entries = prepared.itemProgress.filter((entry) => entry.periodIndex === periodIndex);
    expect(entries).toHaveLength(22);
    const weightedTotal = entries.reduce((total, entry) =>
      total + (prepared.rows.find((row) => row.row === entry.row)!.weight ?? 0) * entry.pctComplete / 100, 0);
    expect(weightedTotal).toBeCloseTo(expectedTotal!, 8);
    const persistedTotal = entries.reduce((total, entry) =>
      total + Number(prepared.rows.find((row) => row.row === entry.row)!.weight!.toFixed(6)) *
        Number(entry.pctComplete.toFixed(4)) / 100, 0);
    expect(Math.abs(persistedTotal - weightedTotal)).toBeLessThan(0.0001);
  }
  const previous = prepared.itemProgress.find((entry) => entry.periodIndex === 15)!;
  expect(previous.sourceSheetName).toBe("16 AGUSTUS 2026");
  expect(previous.sourceColumn).toBe(analysis.plan.dailyProgress!.mapping.previousPercent);
  expect(JSON.parse(previous.sourceValue)).toMatchObject({
    basis: "previous", reportDate: "2026-08-16", readingDate: "2026-08-15",
  });
  expect(prepared.plan.warnings.some((warning) => warning.includes("entries were not imported"))).toBe(false);
});

test("choosing a dated sheet still analyzes the complete progress workbook", async () => {
  const analysis = await analyzeProjectWorkbook(
    await referenceBytes(),
    undefined,
    "16 AGUSTUS 2026",
  );

  expect(analysis.plan.sheetName).toBe("S CURVE (5)");
  expect(analysis.plan.dailyProgress?.sheets).toHaveLength(7);
  expect(analysis.dailyProgressPreview).toMatchObject({
    itemCount: 125,
    latestCumulativePercent: expect.any(Number),
  });
  expect(analysis.summary.validationErrors).toEqual([]);
});

test("AI ranges starting at the first priced line retain headings needed for cumulative table entries", async () => {
  const bytes = await referenceBytes();
  const analysis = await analyzeProjectWorkbook(bytes);
  const parsed = parseDailyProgressWorkbook(await loadWorkbook(bytes), {
    ...analysis.plan.dailyProgress!, mappingSource: "ai", dataStartRow: 12, dataEndRow: 169,
  })!;
  expect(parsed.errors).toEqual([]);
  expect(parsed.snapshots[0]?.items[0]?.sectionDescription).toBe("PRELIMINARIES");
  expect(parsed.preview.itemCount).toBe(125);
  const aggregated = aggregateDailyProgress(
    analysis.rowPreview.filter((row) => row.kind === "item"), parsed.snapshots,
    [
      { periodIndex: 15, startDate: "2026-08-09", endDate: "2026-08-15" },
      { periodIndex: 16, startDate: "2026-08-16", endDate: "2026-08-22" },
    ], analysis.actualSnapshots, parsed.plan.mapping,
  );
  expect(aggregated.warnings).toEqual([]);
  expect(aggregated.entries).toHaveLength(44);
  const omitted = parseDailyProgressWorkbook(await loadWorkbook(bytes), {
    ...parsed.plan, dataStartRow: 13,
  });
  expect(omitted?.errors.some((error) => error.row === 12 && error.message.includes("omits a priced detail row"))).toBe(true);
});

test("daily progress plan coordinates cannot be changed after analysis", async () => {
  const bytes = await referenceBytes();
  const analysis = await analyzeProjectWorkbook(bytes);
  const daily = analysis.plan.dailyProgress;
  expect(daily).toBeTruthy();
  if (!daily) return;

  await expect(
    reviewProjectWorkbook(bytes, {
      ...analysis.plan,
      dailyProgress: {
        ...daily,
        mapping: { ...daily.mapping, cumulativePercent: daily.mapping.previousPercent },
      },
    }),
  ).rejects.toThrow("identity changed");
});

test("rejects item progress that decreases between dated sheets", async () => {
  const workbook = await loadWorkbook(await referenceBytes());
  const sheet = workbook.getWorksheet("20 AGUSTUS 2026");
  if (!sheet) throw new Error("Fixture sheet missing");
  sheet.getCell("M30").value = 0;
  sheet.getCell("N30").value = 0;
  sheet.getCell("O30").value = 1;
  sheet.getCell("P30").value = sheet.getCell("H30").value;

  const parsed = parseDailyProgressWorkbook(workbook);
  expect(parsed?.errors.some((error) => error.message.includes("decreases"))).toBe(true);
});

test("blank cumulative and remaining cells are not imported as explicit zero", async () => {
  const workbook = await loadWorkbook(await referenceBytes());
  const sheet = workbook.getWorksheet("16 AGUSTUS 2026")!;
  for (const column of ["I", "J", "K", "L", "M", "N", "O", "P"]) {
    sheet.getCell(`${column}30`).value = null;
  }
  const parsed = parseDailyProgressWorkbook(workbook);
  expect(parsed?.errors.some((error) => error.row === 30 && error.message.includes("blank progress is not zero"))).toBe(true);
});
