import { expect, setDefaultTimeout, test } from "bun:test";
import ExcelJS from "exceljs";
import { resolve } from "node:path";

import {
  analyzeProjectWorkbook,
  discoverProjectWorkbookSheets,
  recommendProjectWorkbookSheet,
  visibleProjectWorkbookSheets,
  prepareConfirmedWorkbook,
  reviewProjectWorkbook,
  workbookSummary,
  workbookHash,
  workbookPlanIdentitySignature,
  workbookPlanSchema,
} from "./project-workbook";
import { loadWorkbook } from "./boq-import-parse";

setDefaultTimeout(60_000);

const REFERENCE = resolve(import.meta.dir, "../../../reference/S-CURVE PLAN VS ACTUAL RSCH.xlsx");
const DAILY_PROGRESS = resolve(import.meta.dir, "../../../reference/DAILY PROGRESS WEEK 16.xlsx");

test("selected-sheet AI summaries include rows beyond the discovery sample", () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("BoQ");
  for (let row = 1; row <= 60; row++) sheet.addRow([`Item ${row}`, row]);

  const selected = workbookSummary(workbook, sheet.name);
  const discovery = workbookSummary(workbook);

  expect(selected.sheets[0]).toMatchObject({
    sampledThroughRow: 60,
    samplingComplete: true,
  });
  expect(selected.sheets[0]?.rows).toHaveLength(60);
  expect(discovery.sheets[0]).toMatchObject({
    sampledThroughRow: 40,
    samplingComplete: false,
  });
  expect(discovery.sheets[0]?.rows).toHaveLength(40);
});

test("discovery accepts the daily workbook and reports the valid actual prefix", async () => {
  const bytes = new Uint8Array(await Bun.file(DAILY_PROGRESS).arrayBuffer());
  const workbook = await loadWorkbook(bytes);
  const candidates = discoverProjectWorkbookSheets(workbook);

  expect(workbook.worksheets).toHaveLength(23);
  const candidate = candidates.find((sheet) => sheet.sheetName === "S CURVE NOV");
  expect(candidate).toMatchObject({
    sheetName: "S CURVE NOV",
    state: "hidden",
    rowCount: 75,
    columnCount: 47,
    knownSCurve: true,
    actualSnapshotCount: 12,
    latestActualPeriodIndex: 12,
  });
  expect(candidate?.latestActualPercent).toBeCloseTo(15.3167704327, 8);
  expect(
    candidate?.warnings.some(
      (warning) => warning.row === 50 && warning.column === "V" && warning.message.includes("#REF!"),
    ),
  ).toBe(true);
});

test("workbook selection shows visible sheets and recommends the matching S-curve", async () => {
  const bytes = new Uint8Array(await Bun.file(DAILY_PROGRESS).arrayBuffer());
  const workbook = await loadWorkbook(bytes);
  const candidates = discoverProjectWorkbookSheets(workbook);
  const visible = visibleProjectWorkbookSheets(candidates);

  expect(visible.map((sheet) => sheet.sheetName)).toEqual([
    "16 AGUSTUS 2026",
    "17 AGUSTUS 2026",
    "18 AGUSTUS 2026",
    "19 AGUSTUS 2026",
    "20 AGUSTUS 2026",
    "21 AGUSTUS 2026",
    "22 AGUSTUS 2026",
    "S CURVE (5)",
  ]);
  expect(recommendProjectWorkbookSheet(visible)?.sheetName).toBe("S CURVE (5)");
  expect(
    recommendProjectWorkbookSheet(visible, {
      name: "PEKERJAAN STRUCTURE RSU CITRA HARAPAN",
      startDate: "2026-05-02",
      scheduleStart: "2026-05-03",
      endDate: "2026-08-29",
    })?.sheetName,
  ).toBe("S CURVE (5)");
});

test("missing project dates do not count as worksheet matches", () => {
  const generic = {
    sheetName: "Daily report",
    state: "visible" as const,
    rowCount: 20,
    columnCount: 10,
    knownSCurve: false,
    warnings: [],
    actualSnapshotCount: 0,
    latestActualPeriodIndex: null,
    latestActualPercent: null,
    suggestedName: null,
    suggestedStartDate: null,
    suggestedScheduleStartDate: null,
    suggestedEndDate: null,
  };
  const recognized = {
    ...generic,
    sheetName: "S CURVE",
    knownSCurve: true,
    suggestedStartDate: "2026-01-01",
    suggestedScheduleStartDate: "2026-01-02",
    suggestedEndDate: "2026-04-30",
  };

  expect(
    recommendProjectWorkbookSheet([generic, recognized], {
      name: "Unscheduled project",
      startDate: null,
      scheduleStart: null,
      endDate: null,
    })?.sheetName,
  ).toBe("S CURVE");
});

test("analysis honors an explicitly selected reference worksheet", async () => {
  const bytes = new Uint8Array(await Bun.file(DAILY_PROGRESS).arrayBuffer());
  const analysis = await analyzeProjectWorkbook(bytes, undefined, "S CURVE NOV");

  expect(analysis.plan).toMatchObject({
    profile: "reference-s-curve",
    sheetName: "S CURVE NOV",
    headerRow: 7,
  });
  expect(analysis.summary.actualSnapshotCount).toBe(12);
  expect(analysis.summary.latestActualPercent).toBeCloseTo(15.3167704327, 8);
  expect(
    analysis.summary.validationErrors.some(
      (error) => error.row === 50 && error.column === "V" && error.message.includes("#REF!"),
    ),
  ).toBe(true);
});

test("the daily workbook matching S-curve can update the reference project calendar", async () => {
  const [reference, daily] = await Promise.all([
    analyzeProjectWorkbook(
      new Uint8Array(await Bun.file(REFERENCE).arrayBuffer()),
      undefined,
      "S CURVE (5)",
    ),
    analyzeProjectWorkbook(
      new Uint8Array(await Bun.file(DAILY_PROGRESS).arrayBuffer()),
      undefined,
      "S CURVE (5)",
    ),
  ]);

  expect(daily.plan).toMatchObject({
    suggestedStartDate: reference.plan.suggestedStartDate,
    suggestedScheduleStartDate: reference.plan.suggestedScheduleStartDate,
    suggestedEndDate: reference.plan.suggestedEndDate,
    periodCount: reference.plan.periodCount,
  });
  expect(daily.summary.validationErrors).toEqual([]);
  expect(daily.actualSnapshots).toHaveLength(14);
  expect(daily.actualSnapshots.at(-1)?.periodIndex).toBe(16);
  expect(daily.actualSnapshots.at(-1)?.cumulativePercent).toBeCloseTo(56.9230209578, 8);
});

test("an explicit generic selection is not displaced by a recognized first sheet", async () => {
  // This is the only test that deliberately enters the AI fallback. The model
  // stays disabled, but the env module it lives behind still validates the
  // application environment when imported from the repo-root test command.
  process.env.SKIP_ENV_VALIDATION = "true";
  process.env.AI_GATEWAY_API_KEY = "";
  const workbook = new ExcelJS.Workbook();
  const reference = workbook.addWorksheet("S CURVE");
  reference.getRow(7).values = [
    null,
    null,
    "URAIAN PEKERJAAN",
    "JUMLAH",
    "BOBOT",
    "MINGGU",
    "MINGGU",
    null,
    null,
    1,
  ];
  reference.getRow(8).getCell(10).value = new Date("2026-01-01T00:00:00Z");
  reference.getRow(9).getCell(10).value = new Date("2026-01-07T00:00:00Z");
  reference.getRow(12).getCell(3).value = "Reference project";
  reference.getRow(13).values = [null, null, "Reference item", 100, 100, 1, 1];
  reference.getRow(14).getCell(3).value = "TOTAL";

  const selected = workbook.addWorksheet("Selected BoQ");
  selected.addRow(["Description", "Amount", "Start", "Finish"]);
  selected.addRow(["Selected item", 100, 1, 1]);
  const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
  const analysis = await analyzeProjectWorkbook(bytes, undefined, selected.name);

  expect(analysis.plan).toMatchObject({
    sheetName: "Selected BoQ",
    headerRow: 1,
  });
  expect(["generic-ai", "generic-deterministic"]).toContain(analysis.plan.profile);
});

test("the reference workbook produces a high-confidence guided import proposal", async () => {
  const analysis = await analyzeProjectWorkbook(new Uint8Array(await Bun.file(REFERENCE).arrayBuffer()));

  expect(workbookPlanSchema.safeParse(analysis.plan).success).toBe(true);
  expect(analysis.plan).toMatchObject({
    version: 2,
    profile: "reference-s-curve",
    sheetName: "S CURVE (5)",
    headerRow: 7,
    dataStartRow: 13,
    dataEndRow: 34,
    sectionRows: [14, 20, 25],
    suggestedName: "PEKERJAAN STRUCTURE RSU CITRA HARAPAN",
    suggestedStartDate: "2026-05-02",
    suggestedScheduleStartDate: "2026-05-03",
    suggestedEndDate: "2026-08-29",
    periodType: "weekly",
    periodLengthDays: null,
    periodCount: 17,
    confidence: "high",
  });
  expect(analysis.summary).toMatchObject({
    sectionCount: 3,
    lineCount: 19,
    scheduledCount: 19,
    actualSnapshotCount: 10,
    latestActualPeriodIndex: 12,
    validationErrors: [],
  });
  expect(analysis.plan.parentAssignments).toHaveLength(19);
  expect(analysis.summary.latestActualPercent).toBeCloseTo(16.4995, 4);
  expect(analysis.actualSnapshots).toHaveLength(10);
  expect(analysis.summary.totalAmount).toBeCloseTo(2_542_143_270.0877023, 2);
  expect(analysis.summary.totalWeight).toBeCloseTo(100, 4);
});

test("a confirmed plan cannot reference data rows above its header", () => {
  const result = workbookPlanSchema.safeParse({
    version: 2,
    fileHash: "a".repeat(64),
    analysisSignature: "b".repeat(64),
    profile: "generic-ai",
    sheetName: "Sheet 1",
    headerRow: 8,
    dataStartRow: 7,
    dataEndRow: 20,
    sectionRows: [],
    excludedRows: [],
    mandatoryExcludedRows: [],
    userExcludedRows: [],
    parentAssignments: [],
    actualCurve: null,
    mapping: { fields: { description: 3 } },
    suggestedCode: null,
    suggestedName: null,
    suggestedClient: null,
    suggestedLocation: null,
    suggestedStartDate: null,
    suggestedScheduleStartDate: null,
    suggestedEndDate: null,
    periodType: "weekly",
    periodLengthDays: null,
    periodCount: 0,
    confidence: "low",
    warnings: [],
  });

  expect(result.success).toBe(false);
});

test("a row cannot be both a section and excluded", () => {
  const result = workbookPlanSchema.safeParse({
    version: 2,
    fileHash: "a".repeat(64),
    analysisSignature: "b".repeat(64),
    profile: "generic-ai",
    sheetName: "Sheet 1",
    headerRow: 1,
    dataStartRow: 2,
    dataEndRow: 3,
    sectionRows: [2],
    excludedRows: [2],
    mandatoryExcludedRows: [],
    userExcludedRows: [],
    parentAssignments: [],
    actualCurve: null,
    mapping: { fields: { description: 1 } },
    suggestedCode: null,
    suggestedName: null,
    suggestedClient: null,
    suggestedLocation: null,
    suggestedStartDate: null,
    suggestedScheduleStartDate: null,
    suggestedEndDate: null,
    periodType: "weekly",
    periodLengthDays: null,
    periodCount: 0,
    confidence: "low",
    warnings: [],
  });

  expect(result.success).toBe(false);
});

test("confirmation regenerates and validates the complete weekly schedule", async () => {
  const bytes = new Uint8Array(await Bun.file(REFERENCE).arrayBuffer());
  const analysis = await analyzeProjectWorkbook(bytes);
  const prepared = await prepareConfirmedWorkbook(bytes, {
    plan: analysis.plan,
    project: {
      code: "RSCH-01",
      name: analysis.plan.suggestedName!,
      client: null,
      location: null,
      startDate: "2026-05-02",
      scheduleStart: "2026-05-03",
      endDate: "2026-08-29",
      periodType: "weekly",
      periodLengthDays: null,
    },
  });

  expect(prepared.periods).toHaveLength(17);
  expect(prepared.rows).toHaveLength(22);
  expect(prepared.periods[0]).toMatchObject({ periodIndex: 1, startDate: "2026-05-03" });
  expect(prepared.periods[16]).toMatchObject({ periodIndex: 17, endDate: "2026-08-29" });
  expect(prepared.actualSnapshots).toHaveLength(10);
  expect(prepared.actualSnapshots.at(-1)?.periodIndex).toBe(12);
  expect(prepared.actualSnapshots.at(-1)?.cumulativePercent).toBeCloseTo(16.4995, 4);
});

test("reference actuals cannot be attached to a shifted reporting calendar", async () => {
  const bytes = new Uint8Array(await Bun.file(REFERENCE).arrayBuffer());
  const analysis = await analyzeProjectWorkbook(bytes);
  let caught: unknown;

  try {
    await prepareConfirmedWorkbook(bytes, {
      plan: analysis.plan,
      project: {
        code: "RSCH-02",
        name: analysis.plan.suggestedName!,
        client: null,
        location: null,
        startDate: "2026-05-09",
        scheduleStart: "2026-05-10",
        endDate: "2026-09-05",
        periodType: "weekly",
        periodLengthDays: null,
      },
    });
  } catch (error) {
    caught = error;
  }

  expect(caught).toMatchObject({
    code: "workbook_calendar_mismatch",
    details: {
      differences: ["startDate", "scheduleStart", "endDate"],
      suggestedStartDate: "2026-05-02",
      suggestedScheduleStartDate: "2026-05-03",
      suggestedEndDate: "2026-08-29",
    },
  });
});

test("a short confirmed calendar reports the period mismatch and suggested end date", async () => {
  const bytes = new Uint8Array(await Bun.file(REFERENCE).arrayBuffer());
  const analysis = await analyzeProjectWorkbook(bytes);
  let caught: unknown;

  try {
    await prepareConfirmedWorkbook(bytes, {
      plan: analysis.plan,
      project: {
        code: "RSCH-03",
        name: analysis.plan.suggestedName!,
        client: null,
        location: null,
        startDate: "2026-05-02",
        scheduleStart: "2026-05-03",
        endDate: "2026-05-30",
        periodType: "weekly",
        periodLengthDays: null,
      },
    });
  } catch (error) {
    caught = error;
  }

  expect(caught).toMatchObject({
    code: "period_count_mismatch",
    details: {
      workbookPeriodCount: 17,
      confirmedPeriodCount: 4,
      suggestedEndDate: "2026-08-29",
    },
  });
});

test("an excessive confirmed calendar still returns the workbook recovery date", async () => {
  const bytes = new Uint8Array(await Bun.file(REFERENCE).arrayBuffer());
  const analysis = await analyzeProjectWorkbook(bytes);
  let caught: unknown;

  try {
    await prepareConfirmedWorkbook(bytes, {
      plan: analysis.plan,
      project: {
        code: "RSCH-LONG",
        name: analysis.plan.suggestedName!,
        client: null,
        location: null,
        startDate: "2026-05-02",
        scheduleStart: "2026-05-03",
        endDate: "2040-12-31",
        periodType: "weekly",
        periodLengthDays: null,
      },
    });
  } catch (error) {
    caught = error;
  }

  expect(caught).toMatchObject({
    code: "schedule_range_exceeded",
    details: { workbookPeriodCount: 17, suggestedEndDate: "2026-08-29" },
  });
});

test("a priced row cannot be hidden by an excluded-row proposal", async () => {
  const bytes = new Uint8Array(await Bun.file(REFERENCE).arrayBuffer());
  const analysis = await analyzeProjectWorkbook(bytes);

  await expect(
    reviewProjectWorkbook(bytes, {
      ...analysis.plan,
      excludedRows: [15],
      parentAssignments: analysis.plan.parentAssignments.filter((assignment) => assignment.row !== 15),
    }),
  ).rejects.toThrow("Row 15 contains BoQ values");
});

test("review rejects changes to immutable analysis identity", async () => {
  const bytes = new Uint8Array(await Bun.file(REFERENCE).arrayBuffer());
  const analysis = await analyzeProjectWorkbook(bytes);

  await expect(
    reviewProjectWorkbook(bytes, { ...analysis.plan, headerRow: 6 }),
  ).rejects.toThrow("identity changed");
});

test("a user can explicitly exclude a priced row from the draft", async () => {
  const bytes = new Uint8Array(await Bun.file(REFERENCE).arrayBuffer());
  const analysis = await analyzeProjectWorkbook(bytes);
  const reviewed = await reviewProjectWorkbook(bytes, {
    ...analysis.plan,
    excludedRows: [15],
    userExcludedRows: [15],
    parentAssignments: analysis.plan.parentAssignments.filter((assignment) => assignment.row !== 15),
  } as typeof analysis.plan);

  expect(reviewed.plan.excludedRows).toContain(15);
  expect(reviewed.summary.lineCount).toBe(18);
  expect(reviewed.rowPreview.find((row) => row.row === 15)?.kind).toBe("excluded");

  const prepared = await prepareConfirmedWorkbook(bytes, {
    plan: reviewed.plan,
    project: {
      code: "RSCH-04",
      name: analysis.plan.suggestedName!,
      client: null,
      location: null,
      startDate: "2026-05-02",
      scheduleStart: "2026-05-03",
      endDate: "2026-08-29",
      periodType: "weekly",
      periodLengthDays: null,
    },
  });
  expect(prepared.rows).toHaveLength(21);
  expect(prepared.rows.some((row) => row.row === 15)).toBe(false);
});

test("review blocks a draft after every BoQ item is excluded", async () => {
  const bytes = new Uint8Array(await Bun.file(REFERENCE).arrayBuffer());
  const analysis = await analyzeProjectWorkbook(bytes);
  const itemRows = analysis.rowPreview
    .filter((row) => row.kind === "item")
    .map((row) => row.row);
  const reviewed = await reviewProjectWorkbook(bytes, {
    ...analysis.plan,
    excludedRows: itemRows,
    userExcludedRows: itemRows,
  });

  expect(reviewed.summary.lineCount).toBe(0);
  expect(
    reviewed.summary.validationErrors.some((error) =>
      error.message.includes("Include at least one BoQ item"),
    ),
  ).toBe(true);
});

test("confirmation recomputes a tampered period count from the workbook", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("BoQ");
  sheet.addRow(["Description", "Amount", "Start", "Finish"]);
  sheet.addRow(["Excavation", 100, 1, 4]);
  const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
  const identity = {
    fileHash: workbookHash(bytes),
    profile: "generic-deterministic" as const,
    sheetName: "BoQ",
    headerRow: 1,
    dataStartRow: 2,
    dataEndRow: 2,
  };
  const plan = workbookPlanSchema.parse({
    version: 2,
    ...identity,
    analysisSignature: workbookPlanIdentitySignature(identity),
    sectionRows: [],
    excludedRows: [],
    mandatoryExcludedRows: [],
    userExcludedRows: [],
    parentAssignments: [{ row: 2, parentRow: null }],
    actualCurve: null,
    mapping: { fields: { description: 1, amount: 2, start: 3, finish: 4 } },
    suggestedCode: null,
    suggestedName: null,
    suggestedClient: null,
    suggestedLocation: null,
    suggestedStartDate: null,
    suggestedScheduleStartDate: null,
    suggestedEndDate: null,
    periodType: "weekly",
    periodLengthDays: null,
    periodCount: 1,
    confidence: "low",
    warnings: [],
  });
  let caught: unknown;

  try {
    await prepareConfirmedWorkbook(bytes, {
      plan,
      project: {
        code: "TAMPERED",
        name: "Tampered period count",
        client: null,
        location: null,
        startDate: "2026-01-01",
        scheduleStart: "2026-01-01",
        endDate: "2026-01-07",
        periodType: "weekly",
        periodLengthDays: null,
      },
    });
  } catch (error) {
    caught = error;
  }

  expect(caught).toMatchObject({
    code: "period_count_mismatch",
    details: { workbookPeriodCount: 4, confirmedPeriodCount: 1 },
  });
});

test("review recalculates validation after a column mapping changes", async () => {
  const bytes = new Uint8Array(await Bun.file(REFERENCE).arrayBuffer());
  const analysis = await analyzeProjectWorkbook(bytes);
  const revised = await reviewProjectWorkbook(bytes, {
    ...analysis.plan,
    mapping: {
      fields: {
        description: 3,
        weight: 5,
        start: 6,
        finish: 7,
      },
    },
  });

  expect(revised.summary.totalAmount).toBe(0);
  expect(revised.summary.validationErrors.some((error) => error.message.includes("Map an amount"))).toBe(
    true,
  );
});

test("generic review includes trailing priced rows even when their description is blank", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("BoQ");
  sheet.addRow(["Description", "Amount", "Start", "Finish"]);
  sheet.addRow(["Excavation", 100, 1, 1]);
  sheet.addRow([null, 200, 1, 1]);
  const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());

  const identity = {
    fileHash: workbookHash(bytes),
    profile: "generic-deterministic" as const,
    sheetName: "BoQ",
    headerRow: 1,
    dataStartRow: 2,
    dataEndRow: 2,
  };
  const reviewed = await reviewProjectWorkbook(bytes, {
    version: 2,
    ...identity,
    analysisSignature: workbookPlanIdentitySignature(identity),
    sectionRows: [],
    excludedRows: [],
    mandatoryExcludedRows: [],
    userExcludedRows: [],
    parentAssignments: [
      { row: 2, parentRow: null },
    ],
    actualCurve: null,
    mapping: { fields: { description: 1, amount: 2, start: 3, finish: 4 } },
    suggestedCode: null,
    suggestedName: null,
    suggestedClient: null,
    suggestedLocation: null,
    suggestedStartDate: null,
    suggestedScheduleStartDate: null,
    suggestedEndDate: null,
    periodType: "weekly",
    periodLengthDays: null,
    periodCount: 1,
    confidence: "low",
    warnings: [],
  });

  expect(reviewed.plan.dataEndRow).toBe(3);
  expect(reviewed.summary.validationErrors.some((error) => error.row === 3)).toBe(true);
});

test("AI review preserves signed table bounds and safe blank-description exclusions", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("BoQ");
  sheet.addRow(["Description", "Amount"]);
  sheet.addRow(["2", "3"]);
  sheet.addRow(["Excavation", 100]);
  sheet.addRow([null, 200]);
  sheet.addRow(["Authorized signature", null]);
  const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
  const identity = {
    fileHash: workbookHash(bytes),
    profile: "generic-ai" as const,
    sheetName: "BoQ",
    headerRow: 1,
    dataStartRow: 3,
    dataEndRow: 4,
  };
  const plan = workbookPlanSchema.parse({
    version: 2,
    ...identity,
    analysisSignature: workbookPlanIdentitySignature(identity),
    sectionRows: [],
    excludedRows: [4],
    mandatoryExcludedRows: [],
    userExcludedRows: [],
    parentAssignments: [{ row: 3, parentRow: null }],
    actualCurve: null,
    mapping: { fields: { description: 1, amount: 2 } },
    suggestedCode: null,
    suggestedName: null,
    suggestedClient: null,
    suggestedLocation: null,
    suggestedStartDate: null,
    suggestedScheduleStartDate: null,
    suggestedEndDate: null,
    periodType: "weekly",
    periodLengthDays: null,
    periodCount: 0,
    confidence: "high",
    warnings: [],
  });

  const reviewed = await reviewProjectWorkbook(bytes, plan);

  expect(reviewed.plan).toMatchObject({ dataStartRow: 3, dataEndRow: 4, excludedRows: [4] });
  expect(reviewed.summary).toMatchObject({ lineCount: 1, validationErrors: [] });
  await expect(reviewProjectWorkbook(bytes, { ...plan, dataEndRow: 5 })).rejects.toThrow(
    "workbook identity changed",
  );
});
