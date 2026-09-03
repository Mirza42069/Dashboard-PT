import { expect, setDefaultTimeout, test } from "bun:test";
import { resolve } from "node:path";

import { loadWorkbook } from "./boq-import-parse";
import { parseDailyProgressWorkbook } from "./project-daily-progress";
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
