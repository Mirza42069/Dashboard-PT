import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import {
  CUSTOM_PERIOD_MAX_DAYS,
  CUSTOM_PERIOD_MIN_DAYS,
  endDateForPeriodCount,
  generatePeriods,
  MAX_PERIODS,
  PeriodRangeError,
} from "@DashboardV2/api/lib/periods";
import { PERIOD_TYPES } from "@DashboardV2/db/schema";
import type ExcelJS from "exceljs";
import { z } from "zod";

import {
  columnLetter,
  describeSheet,
  loadWorkbook,
  MAX_IMPORT_ROWS,
  MAX_WORKBOOK_COLUMNS,
  MAX_WORKBOOK_ROWS,
  parseNumber,
  parseRows,
  readCell,
} from "./boq-import-parse";
import {
  dailyProgressSheetDates,
  parseDailySheetDate,
  parseDailyProgressWorkbook,
  type DailyProgressMapping,
  type DailyProgressPlan,
  type DailyProgressPreview,
  type ParsedDailyProgressSnapshot,
} from "./project-daily-progress";
import {
  extractProjectPdf,
  pdfExtractionDigest,
  pdfExtractionSchema,
  validateProjectPdf,
  type PdfExtraction,
} from "./project-pdf";
import { parsePdfDailyProgress } from "./project-pdf-progress";
import {
  isWeeklyProgressWorkbook,
  parseWeeklyProgressWorkbook,
  type WeeklyProgressPreview,
} from "./project-weekly-progress";

const workbookRow = z.number().int().positive().max(MAX_WORKBOOK_ROWS);
const workbookColumn = z.number().int().positive().max(MAX_WORKBOOK_COLUMNS);

const fieldsSchema = z.object({
  code: workbookColumn.optional(),
  description: workbookColumn,
  unit: workbookColumn.optional(),
  quantity: workbookColumn.optional(),
  unitRate: workbookColumn.optional(),
  amount: workbookColumn.optional(),
  weight: workbookColumn.optional(),
  start: workbookColumn.optional(),
  finish: workbookColumn.optional(),
});

const dailyProgressMappingSchema = z.object({
  code: workbookColumn.optional(),
  description: workbookColumn,
  quantity: workbookColumn,
  unit: workbookColumn.optional(),
  unitRate: workbookColumn,
  amount: workbookColumn,
  weight: workbookColumn,
  previousPercent: workbookColumn,
  previousWeighted: workbookColumn,
  currentPercent: workbookColumn,
  currentWeighted: workbookColumn,
  cumulativePercent: workbookColumn,
  cumulativeWeighted: workbookColumn,
  remainingPercent: workbookColumn,
  remainingWeighted: workbookColumn,
  remark: workbookColumn.optional(),
});

const dailyProgressPlanSchema = z.object({
  version: z.literal(1),
  mappingSource: z.enum(["deterministic", "ai"]),
  headerRow: workbookRow,
  dataStartRow: workbookRow,
  dataEndRow: workbookRow,
  mapping: dailyProgressMappingSchema,
  sheets: z
    .array(z.object({ sheetName: z.string().min(1).max(100), reportDate: z.iso.date() }))
    .min(2)
    .max(100),
});

export const workbookPlanSchema = z
  .object({
    version: z.literal(2),
    fileHash: z.string().regex(/^[a-f0-9]{64}$/),
    analysisSignature: z.string().regex(/^[a-f0-9]{64}$/),
    profile: z.enum(["reference-s-curve", "generic-ai", "generic-deterministic", "pdf-ai"]),
    sheetName: z.string().min(1).max(100),
    headerRow: workbookRow,
    dataStartRow: workbookRow,
    dataEndRow: workbookRow,
    sectionRows: z.array(workbookRow).max(200),
    excludedRows: z.array(workbookRow).max(500),
    mandatoryExcludedRows: z.array(workbookRow).max(500),
    userExcludedRows: z.array(workbookRow).max(500),
    parentAssignments: z
      .array(
        z.object({
          row: workbookRow,
          parentRow: workbookRow.nullable(),
        }),
      )
      .max(2_000),
    actualCurve: z
      .object({
        sourceRow: workbookRow,
        periodColumns: z
          .array(
            z.object({
              periodIndex: z.number().int().positive(),
              column: workbookColumn,
            }),
          )
          .max(MAX_PERIODS),
      })
      .nullable(),
    mapping: z.object({ fields: fieldsSchema }),
    suggestedCode: z.string().trim().min(1).max(32).nullable(),
    suggestedName: z.string().trim().min(1).max(200).nullable(),
    suggestedClient: z.string().trim().min(1).max(200).nullable(),
    suggestedLocation: z.string().trim().min(1).max(200).nullable(),
    suggestedStartDate: z.iso.date().nullable(),
    suggestedScheduleStartDate: z.iso.date().nullable(),
    suggestedEndDate: z.iso.date().nullable(),
    periodType: z.enum(PERIOD_TYPES),
    /** Set only alongside a "custom" periodType; null for every other. */
    periodLengthDays: z
      .number()
      .int()
      .min(CUSTOM_PERIOD_MIN_DAYS)
      .max(CUSTOM_PERIOD_MAX_DAYS)
      .nullable()
      .default(null),
    periodCount: z.number().int().min(0).max(600),
    confidence: z.enum(["high", "medium", "low"]),
    warnings: z.array(z.string().max(300)).max(20),
    weeklyProgress: z
      .object({
        version: z.literal(1),
        detailSheetCount: z.number().int().positive().max(50),
        categoryCount: z.number().int().positive().max(100),
        previousPeriodIndex: z.number().int().positive().max(MAX_PERIODS),
        currentPeriodIndex: z.number().int().positive().max(MAX_PERIODS),
      })
      .nullable()
      .optional(),
    dailyProgress: dailyProgressPlanSchema.nullable().optional(),
    pdf: z
      .object({
        pageCount: z.number().int().positive().max(25),
        extractionDigest: z.string().regex(/^[a-f0-9]{64}$/),
        extraction: pdfExtractionSchema,
      })
      .nullable()
      .default(null),
  })
  .refine((plan) => plan.dataStartRow > plan.headerRow, {
    message: "The first data row must follow the header row.",
    path: ["dataStartRow"],
  })
  .refine((plan) => plan.dataEndRow >= plan.dataStartRow, {
    message: "The last data row must not precede the first data row.",
    path: ["dataEndRow"],
  })
  .refine(
    (plan) => {
      const sections = new Set(plan.sectionRows);
      return plan.excludedRows.every((row) => !sections.has(row));
    },
    {
      message: "A workbook row cannot be both a section and excluded.",
      path: ["excludedRows"],
    },
  )
  .superRefine((plan, ctx) => {
    const sectionRows = new Set(plan.sectionRows);
    const excludedRows = new Set(plan.excludedRows);
    const userExcludedRows = new Set(plan.userExcludedRows);
    const mandatoryExcludedRows = new Set(plan.mandatoryExcludedRows);
    if ((plan.profile === "pdf-ai") !== (plan.pdf !== null)) {
      ctx.addIssue({
        code: "custom",
        message: "The PDF extraction does not match the import profile.",
        path: ["pdf"],
      });
    }
    if (plan.profile !== "reference-s-curve" && plan.actualCurve !== null) {
      ctx.addIssue({
        code: "custom",
        message: "Imported actual progress is not available for this workbook format.",
        path: ["actualCurve"],
      });
    }
    for (const row of [...sectionRows, ...excludedRows]) {
      if (row < plan.dataStartRow || row > plan.dataEndRow) {
        ctx.addIssue({
          code: "custom",
          message: `Workbook row ${row} is outside the analyzed table.`,
          path: [sectionRows.has(row) ? "sectionRows" : "excludedRows"],
        });
      }
    }
    for (const row of userExcludedRows) {
      if (!excludedRows.has(row)) {
        ctx.addIssue({
          code: "custom",
          message: `User-excluded row ${row} must also be excluded from the import.`,
          path: ["userExcludedRows"],
        });
      }
    }
    for (const row of mandatoryExcludedRows) {
      if (!excludedRows.has(row) || userExcludedRows.has(row)) {
        ctx.addIssue({
          code: "custom",
          message: `Mandatory summary row ${row} must remain excluded.`,
          path: ["mandatoryExcludedRows"],
        });
      }
    }
    const assignedRows = new Set<number>();
    for (const assignment of plan.parentAssignments) {
      if (assignedRows.has(assignment.row)) {
        ctx.addIssue({
          code: "custom",
          message: `Workbook row ${assignment.row} has more than one parent assignment.`,
          path: ["parentAssignments"],
        });
      }
      assignedRows.add(assignment.row);
      if (
        assignment.row < plan.dataStartRow ||
        assignment.row > plan.dataEndRow ||
        sectionRows.has(assignment.row) ||
        (excludedRows.has(assignment.row) && !userExcludedRows.has(assignment.row))
      ) {
        ctx.addIssue({
          code: "custom",
          message: `Workbook row ${assignment.row} cannot have a parent assignment.`,
          path: ["parentAssignments"],
        });
      }
      if (assignment.parentRow !== null && !sectionRows.has(assignment.parentRow)) {
        ctx.addIssue({
          code: "custom",
          message: `Workbook row ${assignment.parentRow} is not an available section.`,
          path: ["parentAssignments"],
        });
      }
    }
    if (plan.actualCurve) {
      const periodIndexes = new Set<number>();
      const columns = new Set<number>();
      let previousPeriodIndex = 0;
      for (const mapping of plan.actualCurve.periodColumns) {
        if (periodIndexes.has(mapping.periodIndex) || columns.has(mapping.column)) {
          ctx.addIssue({
            code: "custom",
            message: "Each actual-curve period and source column must be mapped once.",
            path: ["actualCurve", "periodColumns"],
          });
        }
        if (mapping.periodIndex > plan.periodCount) {
          ctx.addIssue({
            code: "custom",
            message: `Actual progress period ${mapping.periodIndex} exceeds the workbook schedule.`,
            path: ["actualCurve", "periodColumns"],
          });
        }
        if (mapping.periodIndex <= previousPeriodIndex) {
          ctx.addIssue({
            code: "custom",
            message: "Actual-curve periods must be ordered from earliest to latest.",
            path: ["actualCurve", "periodColumns"],
          });
        }
        previousPeriodIndex = mapping.periodIndex;
        periodIndexes.add(mapping.periodIndex);
        columns.add(mapping.column);
      }
    }
  });

export type WorkbookPlan = z.infer<typeof workbookPlanSchema>;

export type WorkbookAnalysis = {
  plan: WorkbookPlan;
  columns: ReturnType<typeof describeSheet>["columns"];
  actualSnapshots: ParsedActualSnapshot[];
  rowPreview: {
    row: number;
    sourcePage?: number;
    sourceSheet?: string;
    sourceTable?: string;
    sourceRow?: number;
    description: string;
    kind: "item" | "section" | "excluded";
    parentRow: number | null;
    code: string | null;
    sourceCode?: string | null;
    unit: string | null;
    quantity: number | null;
    unitRate: number | null;
    amount: number | null;
    weight: number | null;
    startPeriodIndex: number | null;
    finishPeriodIndex: number | null;
    progress?: PdfExtraction["rows"][number]["progress"];
  }[];
  pdfActualPreview?: PdfExtraction["actualSnapshots"];
  pdfProgressErrorCount?: number;
  weeklyProgressPreview?: WeeklyProgressPreview;
  dailyProgressPreview?: DailyProgressPreview;
  /** The latest dated snapshot's line detail, capped for the review UI. */
  dailyProgressItems?: {
    reportDate: string;
    total: number;
    capped: boolean;
    items: DailyProgressItemPreview[];
  };
  summary: {
    sectionCount: number;
    lineCount: number;
    scheduledCount: number;
    totalAmount: number;
    totalWeight: number;
    actualSnapshotCount: number;
    latestActualPercent: number | null;
    latestActualPeriodIndex: number | null;
    validationErrors: { row: number; column: string | null; message: string }[];
  };
};

export type ParsedActualSnapshot = {
  periodIndex: number;
  cumulativePercent: number;
  sourceRow: number;
  sourceColumn: number;
  sourceValue: string;
  sourceLabel?: string;
};

/** One dated progress line, without the bulky sourceValues column. */
export type DailyProgressItemPreview = {
  sourceRow: number;
  code: string | null;
  description: string;
  sectionCode: string | null;
  sectionDescription: string | null;
  parentCode: string | null;
  parentDescription: string | null;
  unit: string | null;
  quantity: number;
  unitRate: number;
  amount: number;
  weight: number;
  previousPercent: number;
  currentPercent: number | null;
  cumulativePercent: number;
  remainingPercent: number;
  previousWeighted: number;
  currentWeighted: number | null;
  cumulativeWeighted: number;
  remainingWeighted: number;
  remark: string | null;
};

const DAILY_ITEMS_PREVIEW_LIMIT = 200;

function dailyItemsPreview(
  snapshots: ParsedDailyProgressSnapshot[],
): WorkbookAnalysis["dailyProgressItems"] {
  const latest = snapshots.at(-1);
  if (!latest) return undefined;
  return {
    reportDate: latest.reportDate,
    total: latest.items.length,
    capped: latest.items.length > DAILY_ITEMS_PREVIEW_LIMIT,
    items: latest.items.slice(0, DAILY_ITEMS_PREVIEW_LIMIT).map((item) => ({
      sourceRow: item.sourceRow,
      code: item.code,
      description: item.description,
      sectionCode: item.sectionCode,
      sectionDescription: item.sectionDescription,
      parentCode: item.parentCode,
      parentDescription: item.parentDescription,
      unit: item.unit,
      quantity: item.quantity,
      unitRate: item.unitRate,
      amount: item.amount,
      weight: item.weight,
      previousPercent: item.previousPercent,
      currentPercent: item.currentPercent,
      cumulativePercent: item.cumulativePercent,
      remainingPercent: item.remainingPercent,
      previousWeighted: item.previousWeighted,
      currentWeighted: item.currentWeighted,
      cumulativeWeighted: item.cumulativeWeighted,
      remainingWeighted: item.remainingWeighted,
      remark: item.remark,
    })),
  };
}

export type WorkbookSheetCandidate = {
  sheetName: string;
  state: "visible" | "hidden" | "veryHidden";
  rowCount: number;
  columnCount: number;
  knownSCurve: boolean;
  warnings: { row: number; column: string | null; message: string }[];
  actualSnapshotCount: number;
  latestActualPeriodIndex: number | null;
  latestActualPercent: number | null;
  suggestedName: string | null;
  suggestedStartDate: string | null;
  suggestedScheduleStartDate: string | null;
  suggestedEndDate: string | null;
};

export type WorkbookSheetTarget = {
  name: string;
  startDate: string | null;
  scheduleStart: string | null;
  endDate: string | null;
};

export const projectWorkbookCommitSchema = z.object({
  plan: workbookPlanSchema,
  acceptProgressDifference: z.boolean().optional(),
  project: z
    .object({
      code: z
        .string()
        .trim()
        .min(1)
        .max(32)
        .regex(/^[A-Za-z0-9-]+$/),
      name: z.string().trim().min(1).max(200),
      client: z.string().trim().max(200).nullable(),
      location: z.string().trim().max(200).nullable(),
      startDate: z.iso.date(),
      scheduleStart: z.iso.date().nullable(),
      endDate: z.iso.date(),
      periodType: z.enum(PERIOD_TYPES),
      periodLengthDays: z
        .number()
        .int()
        .min(CUSTOM_PERIOD_MIN_DAYS)
        .max(CUSTOM_PERIOD_MAX_DAYS)
        .nullable()
        .default(null),
    })
    .refine((value) => value.periodType !== "custom" || value.periodLengthDays !== null, {
      message: "A custom reporting cadence needs a cycle length in days.",
      path: ["periodLengthDays"],
    })
    .refine((value) => value.endDate >= value.startDate, {
      message: "The target completion date must not precede the start date.",
      path: ["endDate"],
    })
    .refine(
      (value) => !value.scheduleStart || value.scheduleStart >= value.startDate,
      { message: "Reporting cannot start before the project start date.", path: ["scheduleStart"] },
    ),
});

export type ProjectWorkbookCommit = z.infer<typeof projectWorkbookCommitSchema>;

export class ProjectWorkbookError extends Error {
  constructor(
    message: string,
    readonly kind: "invalid" | "conflict",
    readonly errors: { row: number; column: string | null; message: string }[] = [],
    readonly code: string | null = null,
    readonly details: Record<string, unknown> | null = null,
  ) {
    super(message);
  }
}

function cellValue(value: unknown): string {
  const cell = readCell(value);
  if (cell.kind === "empty") return "";
  return String(cell.value);
}

function hash(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

type WorkbookPlanIdentity = {
  fileHash: string;
  profile: WorkbookPlan["profile"];
  sheetName: string;
  headerRow: number;
  dataStartRow: number;
  dataEndRow: number;
  pdfExtractionDigest?: string;
  dailyProgressDigest?: string;
};

export function workbookPlanIdentitySignature(identity: WorkbookPlanIdentity) {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret && process.env.NODE_ENV === "production") {
    throw new Error("BETTER_AUTH_SECRET is required to sign workbook analysis plans.");
  }
  return createHmac("sha256", secret ?? "test-only-workbook-plan-signing-secret")
    .update(JSON.stringify(identity))
    .digest("hex");
}

function hasValidPlanIdentity(plan: WorkbookPlan) {
  const expected = Buffer.from(
    workbookPlanIdentitySignature({
      fileHash: plan.fileHash,
      profile: plan.profile,
      sheetName: plan.sheetName,
      headerRow: plan.headerRow,
      dataStartRow: plan.dataStartRow,
      dataEndRow: plan.dataEndRow,
      ...(plan.pdf ? { pdfExtractionDigest: plan.pdf.extractionDigest } : {}),
      ...(plan.dailyProgress
        ? { dailyProgressDigest: hashText(JSON.stringify(plan.dailyProgress)) }
        : {}),
    }),
    "hex",
  );
  const submitted = Buffer.from(plan.analysisSignature, "hex");
  return expected.length === submitted.length && timingSafeEqual(expected, submitted);
}

function hashText(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function planIdentity(plan: WorkbookPlan, dailyProgress: DailyProgressPlan | null) {
  return {
    fileHash: plan.fileHash,
    profile: plan.profile,
    sheetName: plan.sheetName,
    headerRow: plan.headerRow,
    dataStartRow: plan.dataStartRow,
    dataEndRow: plan.dataEndRow,
    ...(plan.pdf ? { pdfExtractionDigest: plan.pdf.extractionDigest } : {}),
    ...(dailyProgress
      ? { dailyProgressDigest: hashText(JSON.stringify(dailyProgress)) }
      : {}),
  } satisfies WorkbookPlanIdentity;
}

function attachDailyProgress(plan: WorkbookPlan, dailyProgress: DailyProgressPlan) {
  const identity = planIdentity(plan, dailyProgress);
  return workbookPlanSchema.parse({
    ...plan,
    dailyProgress,
    analysisSignature: workbookPlanIdentitySignature(identity),
  });
}

function isoDateAt(
  sheet: Awaited<ReturnType<typeof loadWorkbook>>["worksheets"][number],
  row: number,
  column: number,
) {
  const cell = readCell(sheet.getRow(row).getCell(column).value);
  return cell.kind === "date" ? cell.value : null;
}

function addDays(value: string, days: number) {
  return new Date(Date.parse(`${value}T00:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

function assertPeriodCapacity(periodCount: number) {
  if (periodCount > MAX_PERIODS) {
    throw new ProjectWorkbookError(
      `The workbook schedule reaches period ${periodCount}, above the ${MAX_PERIODS}-period limit.`,
      "invalid",
      [],
      "schedule_capacity_exceeded",
      { workbookPeriodCount: periodCount, maximumPeriodCount: MAX_PERIODS },
    );
  }
}

function indonesianCurveSummaryBounds(
  sheet: Awaited<ReturnType<typeof loadWorkbook>>["worksheets"][number],
) {
  if (!/^kurva[ -]?s$/i.test(sheet.name.trim())) return null;
  if (!cellValue(sheet.getCell("A1").value).toUpperCase().includes("SCHEDULE S CURVE")) {
    return null;
  }

  let actualRow = 0;
  let plannedRow = 0;
  for (let row = 1; row <= sheet.rowCount; row++) {
    const label = cellValue(sheet.getRow(row).getCell(4).value).trim().toUpperCase();
    if (label === "PROGRES RENCANA (%)") plannedRow = row;
    if (label === "AKUMULASI PROGRES ACTUAL (%)") actualRow = row;
  }
  if (plannedRow === 0 || actualRow === 0 || actualRow <= plannedRow) return null;

  const headerRow = 9;
  const periodColumns: { periodIndex: number; column: number }[] = [];
  for (let column = 6; column <= sheet.columnCount; column++) {
    const periodIndex = parseNumber(readCell(sheet.getRow(headerRow).getCell(column).value));
    const expected = periodColumns.length + 1;
    if (periodIndex === expected) {
      periodColumns.push({ periodIndex, column });
    } else if (periodColumns.length > 0) {
      break;
    }
  }
  if (periodColumns.length === 0) return null;

  return {
    layout: "indonesian-summary" as const,
    headerRow,
    titleRow: 4,
    dataStartRow: headerRow + 1,
    dataEndRow: plannedRow - 1,
    periodColumns,
    actualRow,
    contractStartDate: null,
    scheduleStartDate: null,
    endDate: null,
    mapping: { fields: { description: 3, weight: 5 } },
    suggestedName: cellValue(sheet.getCell("A4").value).trim() || null,
    suggestedLocation: cellValue(sheet.getCell("A5").value).trim() || null,
  };
}

function referenceBounds(
  sheet: Awaited<ReturnType<typeof loadWorkbook>>["worksheets"][number],
) {
  if (!/s[ -]?curve/i.test(sheet.name)) return indonesianCurveSummaryBounds(sheet);
  let headerRow = 0;
  let periodColumns: { periodIndex: number; column: number }[] = [];
  for (let row = 1; row <= Math.min(sheet.rowCount, 25); row++) {
    const description = cellValue(sheet.getRow(row).getCell(3).value).toUpperCase();
    const amount = cellValue(sheet.getRow(row).getCell(4).value).toUpperCase();
    const weight = cellValue(sheet.getRow(row).getCell(5).value).toUpperCase();
    const start = cellValue(sheet.getRow(row).getCell(6).value).toUpperCase();
    if (
      !description.includes("URAIAN") ||
      !amount.includes("JUMLAH") ||
      !weight.includes("BOBOT") ||
      !start.includes("MINGGU")
    ) {
      continue;
    }
    const periods: { periodIndex: number; column: number }[] = [];
    for (let column = 8; column <= sheet.columnCount; column++) {
      const periodIndex = parseNumber(readCell(sheet.getRow(row).getCell(column).value));
      const expected = periods.length + 1;
      if (periodIndex === expected) {
        periods.push({ periodIndex, column });
      } else if (periods.length > 0) {
        break;
      }
    }
    if (periods.length > 0) {
      headerRow = row;
      periodColumns = periods;
      break;
    }
  }
  if (headerRow === 0) return null;

  let totalRow = 0;
  for (let row = headerRow + 1; row <= sheet.rowCount; row++) {
    if (cellValue(sheet.getRow(row).getCell(3).value).trim().toUpperCase() === "TOTAL") {
      totalRow = row;
      break;
    }
  }
  if (totalRow === 0) return null;
  let titleRow = 0;
  for (let row = headerRow + 1; row < totalRow; row++) {
    const text = cellValue(sheet.getRow(row).getCell(3).value).trim();
    const rowStart = parseNumber(readCell(sheet.getRow(row).getCell(6).value));
    const nextDescription = cellValue(sheet.getRow(row + 1).getCell(3).value).trim();
    const nextAmount = parseNumber(readCell(sheet.getRow(row + 1).getCell(4).value));
    const nextStart = parseNumber(readCell(sheet.getRow(row + 1).getCell(6).value));
    if (
      text &&
      rowStart === null &&
      nextDescription &&
      (typeof nextAmount === "number" || typeof nextStart === "number")
    ) {
      titleRow = row;
      break;
    }
  }
  if (titleRow === 0) return null;
  const firstPeriod = periodColumns[0];
  const lastPeriod = periodColumns.at(-1);
  const contractStartDate = firstPeriod ? isoDateAt(sheet, headerRow + 1, firstPeriod.column) : null;
  const firstPeriodEnd = firstPeriod ? isoDateAt(sheet, headerRow + 2, firstPeriod.column) : null;
  const scheduleStartDate = firstPeriodEnd ? addDays(firstPeriodEnd, -6) : null;
  const endDate = lastPeriod ? isoDateAt(sheet, headerRow + 2, lastPeriod.column) : null;
  let actualRow: number | null = null;
  for (let row = totalRow + 1; row <= sheet.rowCount; row++) {
    if (
      cellValue(sheet.getRow(row).getCell(3).value).trim().toUpperCase() ===
      "BOBOT AKTUAL KUMULATIF"
    ) {
      actualRow = row;
      break;
    }
  }
  return {
    layout: "priced-reference" as const,
    headerRow,
    titleRow,
    dataStartRow: titleRow + 1,
    dataEndRow: totalRow - 1,
    periodColumns,
    actualRow,
    contractStartDate,
    scheduleStartDate,
    endDate,
    mapping: { fields: { description: 3, amount: 4, weight: 5, start: 6, finish: 7 } },
    suggestedName: cellValue(sheet.getRow(titleRow).getCell(3).value).trim() || null,
    suggestedLocation: null,
  };
}

function defaultParentAssignments(
  sheet: Awaited<ReturnType<typeof loadWorkbook>>["worksheets"][number],
  input: {
    dataStartRow: number;
    dataEndRow: number;
    sectionRows: number[];
    excludedRows: number[];
    descriptionColumn: number;
  },
) {
  const sections = new Set(input.sectionRows);
  const excluded = new Set(input.excludedRows);
  const assignments: { row: number; parentRow: number | null }[] = [];
  let currentParent: number | null = null;
  for (let row = input.dataStartRow; row <= input.dataEndRow; row++) {
    if (excluded.has(row)) continue;
    if (sections.has(row)) {
      currentParent = row;
      continue;
    }
    const description = cellValue(sheet.getRow(row).getCell(input.descriptionColumn).value).trim();
    if (description) assignments.push({ row, parentRow: currentParent });
  }
  return assignments;
}

function referencePlan(
  workbook: Awaited<ReturnType<typeof loadWorkbook>>,
  fileHash: string,
  selectedSheetName?: string,
): WorkbookPlan | null {
  const sheets = selectedSheetName
    ? workbook.worksheets.filter((sheet) => sheet.name === selectedSheetName)
    : workbook.worksheets;
  for (const sheet of sheets) {
    const bounds = referenceBounds(sheet);
    if (!bounds) continue;
    const actual =
      bounds.actualRow && bounds.periodColumns.length > 0
        ? parseActualSnapshotCells(
            sheet,
            bounds.actualRow,
            bounds.periodColumns,
            bounds.periodColumns.at(-1)?.periodIndex ?? 0,
          )
        : { snapshots: [], errors: [] };
    const latestActual = actual.snapshots.at(-1);
    const previousActual = actual.snapshots.find(
      (snapshot) => snapshot.periodIndex === (latestActual?.periodIndex ?? 0) - 1,
    );
    const weeklyProgress =
      bounds.layout === "indonesian-summary"
        ? parseWeeklyProgressWorkbook(
            workbook,
            sheet,
            latestActual?.cumulativePercent ?? 0,
            latestActual?.periodIndex ?? 0,
            previousActual?.cumulativePercent ?? null,
          )
        : null;
    const { dataStartRow, dataEndRow } = bounds;
    const sectionRows: number[] = [];
    let periodCount = bounds.periodColumns.at(-1)?.periodIndex ?? 0;
    for (let row = dataStartRow; row <= dataEndRow; row++) {
      const descriptionColumn = bounds.mapping.fields.description;
      const text = cellValue(sheet.getRow(row).getCell(descriptionColumn).value).trim();
      const amountColumn =
        "amount" in bounds.mapping.fields ? bounds.mapping.fields.amount : undefined;
      const rowAmount = amountColumn
        ? parseNumber(readCell(sheet.getRow(row).getCell(amountColumn).value))
        : null;
      if (text && rowAmount === null) sectionRows.push(row);
      const finishColumn =
        "finish" in bounds.mapping.fields ? bounds.mapping.fields.finish : undefined;
      const finish = finishColumn
        ? parseNumber(readCell(sheet.getRow(row).getCell(finishColumn).value))
        : null;
      if (typeof finish === "number" && Number.isInteger(finish)) periodCount = Math.max(periodCount, finish);
    }
    assertPeriodCapacity(periodCount);
    const parentAssignments = defaultParentAssignments(sheet, {
      dataStartRow,
      dataEndRow,
      sectionRows,
      excludedRows: [],
      descriptionColumn: bounds.mapping.fields.description,
    });
    const identity = {
      fileHash,
      profile: "reference-s-curve" as const,
      sheetName: sheet.name,
      headerRow: bounds.headerRow,
      dataStartRow,
      dataEndRow,
    };

    return {
      version: 2,
      ...identity,
      analysisSignature: workbookPlanIdentitySignature(identity),
      sectionRows,
      excludedRows: [],
      mandatoryExcludedRows: [],
      userExcludedRows: [],
      parentAssignments,
      actualCurve:
        bounds.actualRow && bounds.periodColumns.length > 0
          ? { sourceRow: bounds.actualRow, periodColumns: bounds.periodColumns }
          : null,
      mapping: bounds.mapping,
      suggestedCode: null,
      suggestedName: bounds.suggestedName,
      suggestedClient: weeklyProgress?.client ?? null,
      suggestedLocation: bounds.suggestedLocation,
      suggestedStartDate: bounds.contractStartDate,
      suggestedScheduleStartDate: bounds.scheduleStartDate,
      suggestedEndDate: bounds.endDate,
      periodType: "weekly",
      periodLengthDays: null,
      periodCount,
      confidence: "high",
      warnings: [
        "Roman numerals are sparse in this workbook, so stable BoQ codes will be generated.",
        ...(bounds.layout === "priced-reference"
          ? ["Rows with JUMLAH are imported as lump-sum items (1 LS × JUMLAH)."]
          : weeklyProgress
            ? []
            : ["This KURVA-S summary is suitable for progress updates; its item pricing is not present."]),
        ...(weeklyProgress
          ? [
              `This weekly report combines ${weeklyProgress.plan.detailSheetCount} detail sheets into one BoQ.`,
              ...(weeklyProgress.preview.confirmationRequired
                ? ["The itemized current progress differs from the unfinished KURVA-S total and requires confirmation."]
                : []),
            ]
          : []),
        ...(bounds.contractStartDate !== bounds.scheduleStartDate
          ? [
              "The first reporting period begins after the contract start, following the workbook's period-end dates.",
            ]
          : []),
      ],
      weeklyProgress: weeklyProgress?.plan ?? null,
      pdf: null,
    };
  }
  return null;
}

const DISCOVERY_SUMMARY_ROW_LIMIT = 40;
const DISCOVERY_SUMMARY_CHARACTER_LIMIT = 30_000;
const SELECTED_SHEET_SUMMARY_ROW_LIMIT = 1_000;
const SELECTED_SHEET_SUMMARY_CHARACTER_LIMIT = 120_000;

export function workbookSummary(
  workbook: Awaited<ReturnType<typeof loadWorkbook>>,
  selectedSheetName?: string,
) {
  const selectedSheetOnly = Boolean(selectedSheetName);
  const rowLimit = selectedSheetOnly
    ? SELECTED_SHEET_SUMMARY_ROW_LIMIT
    : DISCOVERY_SUMMARY_ROW_LIMIT;
  let remainingCharacters = selectedSheetOnly
    ? SELECTED_SHEET_SUMMARY_CHARACTER_LIMIT
    : DISCOVERY_SUMMARY_CHARACTER_LIMIT;
  const sheets = selectedSheetName
    ? workbook.worksheets.filter((sheet) => sheet.name === selectedSheetName)
    : workbook.worksheets;
  return {
    task: "Identify the project and importable BoQ/S-curve table. Column numbers are 1-based.",
    selectedSheet: selectedSheetName ?? null,
    sheets: sheets.map((sheet) => {
      const nonemptyRows: { row: number; cells: { column: number; value: string }[] }[] = [];
      let scannedThroughRow = 0;
      for (
        let row = 1;
        row <= sheet.rowCount && nonemptyRows.length < rowLimit && remainingCharacters > 0;
        row++
      ) {
        scannedThroughRow = row;
        const cells: { column: number; value: string }[] = [];
        for (
          let column = 1;
          column <= Math.min(sheet.columnCount, 20) && remainingCharacters > 0;
          column++
        ) {
          const value = cellValue(sheet.getRow(row).getCell(column).value).trim().slice(0, 80);
          if (value) {
            cells.push({ column, value });
            remainingCharacters -= value.length;
          }
        }
        if (cells.length > 0) nonemptyRows.push({ row, cells });
      }
      return {
        name: sheet.name,
        rowCount: sheet.rowCount,
        columnCount: sheet.columnCount,
        sampledThroughRow: scannedThroughRow,
        samplingComplete: scannedThroughRow >= sheet.rowCount,
        rows: nonemptyRows,
      };
    }),
  };
}

function guessColumn(columns: ReturnType<typeof describeSheet>["columns"], aliases: string[]) {
  return columns.find((column) => {
    const header = column.header.toLowerCase();
    return aliases.some((alias) => header === alias || header.includes(alias));
  })?.index;
}

function boundedRows(rows: number[], first: number, last: number) {
  return [...new Set(rows.filter((row) => row >= first && row <= last))].sort((a, b) => a - b);
}

const SUMMARY_ROW = /^(total|bobot (rencana|aktual) (mingguan|kumulatif)|deviasi (mingguan|kumulatif))$/i;

function mandatorySummaryRows(
  sheet: Awaited<ReturnType<typeof loadWorkbook>>["worksheets"][number],
  first: number,
  last: number,
  descriptionColumn: number,
) {
  const rows: number[] = [];
  for (let row = first; row <= last; row++) {
    const description = cellValue(sheet.getRow(row).getCell(descriptionColumn).value).trim();
    if (SUMMARY_ROW.test(description)) rows.push(row);
  }
  return rows;
}

function rowCarriesLineData(
  sheet: Awaited<ReturnType<typeof loadWorkbook>>["worksheets"][number],
  row: number,
  fields: Record<string, number | undefined>,
) {
  return ["amount", "quantity", "unitRate", "weight", "start", "finish"].some((field) => {
    const column = fields[field];
    return column !== undefined && readCell(sheet.getRow(row).getCell(column).value).kind !== "empty";
  });
}

function lastMappedRow(
  sheet: Awaited<ReturnType<typeof loadWorkbook>>["worksheets"][number],
  headerRow: number,
  fields: Record<string, number | undefined>,
) {
  let last = headerRow + 1;
  for (let row = headerRow + 1; row <= sheet.rowCount; row++) {
    const hasValue = Object.values(fields).some(
      (column) =>
        column !== undefined && readCell(sheet.getRow(row).getCell(column).value).kind !== "empty",
    );
    if (hasValue) last = row;
  }
  return last;
}

function parseActualSnapshots(
  sheet: Awaited<ReturnType<typeof loadWorkbook>>["worksheets"][number],
  plan: WorkbookPlan,
) {
  if (plan.profile === "pdf-ai" && plan.pdf) {
    const snapshots: ParsedActualSnapshot[] = [];
    const errors: { row: number; column: string | null; message: string }[] = [];
    let previous = -1;
    let previousPeriod = 0;
    for (const snapshot of [...plan.pdf.extraction.actualSnapshots].sort(
      (left, right) => left.periodIndex - right.periodIndex,
    )) {
      if (snapshot.periodIndex === previousPeriod) {
        errors.push({
          row: snapshot.sourceRow,
          column: null,
          message: `Actual cumulative progress has more than one value for period ${snapshot.periodIndex}.`,
        });
        continue;
      }
      if (snapshot.periodIndex > plan.periodCount) {
        errors.push({
          row: snapshot.sourceRow,
          column: null,
          message: `Actual cumulative progress period ${snapshot.periodIndex} exceeds the PDF schedule.`,
        });
        continue;
      }
      if (snapshot.cumulativePercent < previous) {
        errors.push({
          row: snapshot.sourceRow,
          column: null,
          message: `Actual cumulative progress decreases at period ${snapshot.periodIndex}.`,
        });
        break;
      }
      previousPeriod = snapshot.periodIndex;
      previous = snapshot.cumulativePercent;
      snapshots.push({
        periodIndex: snapshot.periodIndex,
        cumulativePercent: snapshot.cumulativePercent,
        sourceRow: snapshot.sourceRow,
        sourceColumn: 1,
        sourceValue: snapshot.sourceValue,
        sourceLabel: `PDF page ${snapshot.page}, ${snapshot.table}`,
      });
    }
    return { snapshots, errors };
  }
  if (!plan.actualCurve) return { snapshots: [], errors: [] };
  return parseActualSnapshotCells(
    sheet,
    plan.actualCurve.sourceRow,
    plan.actualCurve.periodColumns,
    plan.periodCount,
  );
}

function parseActualSnapshotCells(
  sheet: Awaited<ReturnType<typeof loadWorkbook>>["worksheets"][number],
  sourceRow: number,
  periodColumns: { periodIndex: number; column: number }[],
  periodCount: number,
) {
  const snapshots: ParsedActualSnapshot[] = [];
  const errors: { row: number; column: string | null; message: string }[] = [];
  let previous = -1;
  for (const mapping of periodColumns) {
    if (mapping.periodIndex > periodCount) continue;
    const cell = readCell(sheet.getRow(sourceRow).getCell(mapping.column).value);
    const parsed = parseNumber(cell);
    if (parsed === null) continue;
    if (parsed === "invalid" || parsed < 0 || parsed > 100) {
      errors.push({
        row: sourceRow,
        column: columnLetter(mapping.column),
        message:
          cell.kind === "error"
            ? `Actual cumulative progress for period ${mapping.periodIndex} contains ${cell.value}.`
            : `Actual cumulative progress for period ${mapping.periodIndex} must be between 0% and 100%.`,
      });
      break;
    }
    if (parsed < previous) {
      errors.push({
        row: sourceRow,
        column: columnLetter(mapping.column),
        message: `Actual cumulative progress decreases at period ${mapping.periodIndex}.`,
      });
      break;
    }
    previous = parsed;
    snapshots.push({
      periodIndex: mapping.periodIndex,
      cumulativePercent: parsed,
      sourceRow,
      sourceColumn: mapping.column,
      sourceValue: cell.kind === "empty" ? "" : String(cell.value),
    });
  }
  return { snapshots, errors };
}

export function discoverProjectWorkbookSheets(
  workbook: Awaited<ReturnType<typeof loadWorkbook>>,
): WorkbookSheetCandidate[] {
  return workbook.worksheets.map((sheet) => {
    const bounds = referenceBounds(sheet);
    const actual =
      bounds?.actualRow
        ? parseActualSnapshotCells(
            sheet,
            bounds.actualRow,
            bounds.periodColumns,
            bounds.periodColumns.at(-1)?.periodIndex ?? 0,
          )
        : { snapshots: [], errors: [] };
    const latest = actual.snapshots.at(-1);
    return {
      sheetName: sheet.name,
      state: sheet.state,
      rowCount: sheet.rowCount,
      columnCount: sheet.columnCount,
      knownSCurve: bounds !== null,
      warnings: actual.errors,
      actualSnapshotCount: actual.snapshots.length,
      latestActualPeriodIndex: latest?.periodIndex ?? null,
      latestActualPercent: latest?.cumulativePercent ?? null,
      suggestedName: bounds?.suggestedName ?? null,
      suggestedStartDate: bounds?.contractStartDate ?? null,
      suggestedScheduleStartDate: bounds?.scheduleStartDate ?? null,
      suggestedEndDate: bounds?.endDate ?? null,
    };
  });
}

export function visibleProjectWorkbookSheets(candidates: WorkbookSheetCandidate[]) {
  return candidates.filter((candidate) => candidate.state === "visible");
}

function normalizedProjectName(value: string | null) {
  return value?.trim().replace(/\s+/g, " ").toLocaleUpperCase("en-US") ?? "";
}

/** Chooses one safe, visible worksheet when the reader selects the whole workbook. */
export function recommendProjectWorkbookSheet(
  candidates: WorkbookSheetCandidate[],
  target?: WorkbookSheetTarget,
) {
  const targetName = normalizedProjectName(target?.name ?? null);
  return candidates
    .filter((candidate) => candidate.state === "visible")
    .map((candidate, index) => {
      let score = candidate.knownSCurve ? 100 : 0;
      if (candidate.warnings.length === 0) score += 25;
      score += Math.min(candidate.actualSnapshotCount, 20) * 2;
      if (target) {
        if (
          targetName &&
          normalizedProjectName(candidate.suggestedName) === targetName
        ) {
          score += 500;
        }
        if (target.startDate && candidate.suggestedStartDate === target.startDate) score += 150;
        if (
          target.scheduleStart &&
          candidate.suggestedScheduleStartDate === target.scheduleStart
        ) {
          score += 150;
        }
        if (target.endDate && candidate.suggestedEndDate === target.endDate) score += 150;
      }
      return { candidate, index, score };
    })
    .sort((left, right) => right.score - left.score || left.index - right.index)[0]?.candidate;
}

/**
 * The steps this function passes through, in order.
 *
 * Reported rather than estimated: the caller cannot see inside a single
 * request, and provider work is also what a timer would guess worst. PDF
 * parsing and model interpretation report separately; Excel skips parsing,
 * while the reference template also skips interpretation.
 */
export const ANALYSIS_STAGES = ["reading", "recognising", "parsing", "interpreting", "building"] as const;
export type AnalysisStage = (typeof ANALYSIS_STAGES)[number];

const PDF_SHEET_NAME = "PDF tables";
const PDF_MAPPING = {
  fields: {
    code: 1,
    description: 2,
    unit: 3,
    quantity: 4,
    unitRate: 5,
    amount: 6,
    weight: 7,
    start: 8,
    finish: 9,
  },
} as const;

async function pdfWorksheet(extraction: PdfExtraction) {
  const { default: excel } = (await import("exceljs")) as unknown as {
    default: typeof ExcelJS;
  };
  const workbook = new excel.Workbook();
  const sheet = workbook.addWorksheet(PDF_SHEET_NAME);
  sheet.addRow([
    "Code",
    "Description",
    "Unit",
    "Quantity",
    "Unit rate",
    "Amount",
    "Weight",
    "Start period",
    "Finish period",
  ]);
  for (const [index, row] of extraction.rows.entries()) {
    sheet.addRow([
      row.code ?? `P${index + 1}`,
      row.description,
      row.unit,
      row.quantity,
      row.unitRate,
      row.amount,
      row.weight,
      row.startPeriodIndex,
      row.finishPeriodIndex,
    ]);
  }
  return sheet;
}

function pdfRowNumbers(extraction: PdfExtraction, kind: PdfExtraction["rows"][number]["kind"]) {
  return extraction.rows.flatMap((row, index) => (row.kind === kind ? [index + 2] : []));
}

function pdfParentAssignments(extraction: PdfExtraction) {
  const assignments: { row: number; parentRow: number | null }[] = [];
  let parentRow: number | null = null;
  extraction.rows.forEach((row, index) => {
    const workbookRow = index + 2;
    if (row.kind === "section") parentRow = workbookRow;
    else if (row.kind === "item") assignments.push({ row: workbookRow, parentRow });
  });
  return assignments;
}

export function pdfSchedulePeriodCount(extraction: PdfExtraction) {
  return Math.max(
    0,
    ...extraction.rows.map((row) => (row.kind === "item" ? (row.finishPeriodIndex ?? 0) : 0)),
    ...extraction.actualSnapshots.map((snapshot) => snapshot.periodIndex),
  );
}

async function analyzeProjectPdf(
  bytes: Uint8Array,
  filename: string,
  onStage: (stage: AnalysisStage) => void,
  onModelAnswer: () => void | Promise<void>,
) {
  const { pageCount } = await validateProjectPdf(bytes);
  onStage("recognising");
  onStage("parsing");
  const extraction = await extractProjectPdf(bytes, filename, pageCount, {
    onModelAnswer,
    onParsed: () => onStage("interpreting"),
  });
  onStage("building");
  const extractionDigest = pdfExtractionDigest(extraction);
  const fileHash = hash(bytes);
  const dataEndRow = extraction.rows.length + 1;
  const mandatoryExcludedRows = pdfRowNumbers(extraction, "excluded");
  const sectionRows = pdfRowNumbers(extraction, "section");
  const periodCount = pdfSchedulePeriodCount(extraction);
  assertPeriodCapacity(periodCount);
  const identity = {
    fileHash,
    profile: "pdf-ai" as const,
    sheetName: PDF_SHEET_NAME,
    headerRow: 1,
    dataStartRow: 2,
    dataEndRow,
    pdfExtractionDigest: extractionDigest,
  };
  const plan: WorkbookPlan = workbookPlanSchema.parse({
    version: 2,
    ...identity,
    analysisSignature: workbookPlanIdentitySignature(identity),
    sectionRows,
    excludedRows: mandatoryExcludedRows,
    mandatoryExcludedRows,
    userExcludedRows: [],
    parentAssignments: pdfParentAssignments(extraction),
    actualCurve: null,
    mapping: PDF_MAPPING,
    suggestedCode: extraction.projectCode,
    suggestedName: extraction.projectName,
    suggestedClient: extraction.client,
    suggestedLocation: extraction.location,
    suggestedStartDate: extraction.startDate,
    suggestedScheduleStartDate: extraction.scheduleStartDate ?? extraction.startDate,
    suggestedEndDate: extraction.endDate,
    periodType: extraction.periodType,
    periodLengthDays: null,
    periodCount,
    confidence: extraction.confidence,
    warnings: [
      ...extraction.warnings,
      "PDF text was parsed by Firecrawl and structured by AI. Review every imported row against the source document.",
      "Rows without source codes receive deterministic import codes.",
      "Amount-only rows import as 1 LS at the extracted amount.",
    ],
    weeklyProgress: null,
    pdf: { pageCount, extractionDigest, extraction },
  });
  return reviewProjectWorkbook(bytes, plan);
}

export async function analyzeProjectWorkbook(
  bytes: Uint8Array,
  onStage: (stage: AnalysisStage) => void = () => {},
  selectedSheetName?: string,
  onModelAnswer: () => void | Promise<void> = () => {},
  filename = "workbook.xlsx",
): Promise<WorkbookAnalysis> {
  onStage("reading");
  if (new TextDecoder().decode(bytes.subarray(0, 5)) === "%PDF-") {
    return analyzeProjectPdf(bytes, filename, onStage, onModelAnswer);
  }
  const workbook = await loadWorkbook(bytes);
  const explicitlySelected = selectedSheetName
    ? workbook.worksheets.find((sheet) => sheet.name === selectedSheetName)
    : undefined;
  if (selectedSheetName && !explicitlySelected) {
    throw new ProjectWorkbookError(`Worksheet "${selectedSheetName}" was not found.`, "invalid");
  }
  const fileHash = hash(bytes);
  onStage("recognising");
  const selectedDailySheet = selectedSheetName ? parseDailySheetDate(selectedSheetName) !== null : false;
  // Dated progress sheets are detected from the whole workbook, whatever the
  // sheet choice. Restricting detection to AUTO and dated selections used to
  // drop them silently when the S-curve sheet was picked by hand: the import
  // then succeeded with actuals but no daily data behind it.
  const dailySheets = dailyProgressSheetDates(workbook);
  const dailySelectionExplicit = Boolean(selectedSheetName) && !selectedDailySheet;
  const autoSheetName =
    dailySheets.length >= 2
      ? recommendProjectWorkbookSheet(visibleProjectWorkbookSheets(discoverProjectWorkbookSheets(workbook)))
          ?.sheetName
      : undefined;
  let plan = referencePlan(
    workbook,
    fileHash,
    selectedDailySheet ? autoSheetName : (selectedSheetName ?? autoSheetName),
  );

  if (plan && dailySheets.length >= 2) {
    let daily = parseDailyProgressWorkbook(workbook);
    if (!daily && !dailySelectionExplicit) {
      onStage("interpreting");
      const { interpretDailyProgressWorkbook } = await import("./workbook-ai");
      const interpreted = await interpretDailyProgressWorkbook(
        workbookSummary(workbook, dailySheets[0]!.sheetName),
        onModelAnswer,
      );
      if (interpreted) {
        const mapping = Object.fromEntries(
          Object.entries(interpreted.mapping).filter(([, value]) => value !== null),
        ) as DailyProgressMapping;
        const dailyPlan: DailyProgressPlan = {
          version: 1,
          mappingSource: "ai",
          headerRow: interpreted.headerRow,
          dataStartRow: interpreted.dataStartRow,
          dataEndRow: interpreted.dataEndRow,
          mapping,
          sheets: dailySheets,
        };
        daily = parseDailyProgressWorkbook(workbook, dailyPlan);
      }
    }
    if (daily) {
      plan = attachDailyProgress(plan, daily.plan);
    } else if (!dailySelectionExplicit) {
      throw new ProjectWorkbookError(
        "The dated progress worksheets could not be mapped. Select the S-curve sheet to import it alone, or correct the dated sheet headers.",
        "invalid",
        [],
        "daily_progress_mapping_required",
      );
    } else {
      // An explicitly picked non-dated sheet keeps its import, but the skipped
      // progress sheets must not disappear without a trace.
      plan = workbookPlanSchema.parse({
        ...plan,
        warnings: [
          ...plan.warnings,
          `${dailySheets.length} dated progress sheets were detected but could not be mapped, so only the selected sheet is imported.`,
        ],
      });
    }
  }

  if (!plan) {
    onStage("interpreting");
    const { interpretWorkbook } = await import("./workbook-ai");
    const interpreted = await interpretWorkbook(
      workbookSummary(workbook, selectedSheetName),
      onModelAnswer,
    );
    onStage("building");
    const selected =
      explicitlySelected ??
      (interpreted
        ? workbook.worksheets.find((sheet) => sheet.name === interpreted.sheetName)
        : workbook.worksheets[0]);
    if (!selected) throw new ProjectWorkbookError("The workbook has no worksheets.", "invalid");

    const preview = describeSheet(selected, interpreted?.headerRow);
    const description = interpreted?.descriptionColumn ?? guessColumn(preview.columns, ["description", "uraian", "pekerjaan", "item", "deskripsi"]);
    if (!description) {
      throw new ProjectWorkbookError("No description column could be identified.", "invalid");
    }
    const headerRow = Math.min(Math.max(interpreted?.headerRow ?? preview.headerRow, 1), selected.rowCount);
    const firstPossibleDataRow = Math.min(headerRow + 1, selected.rowCount);
    const dataStartRow = interpreted
      ? Math.min(Math.max(interpreted.dataStartRow, firstPossibleDataRow), selected.rowCount)
      : firstPossibleDataRow;
    const mapping = {
      fields: {
        description,
        unit: interpreted?.unitColumn ?? guessColumn(preview.columns, ["satuan", "unit", "sat"]),
        quantity:
          interpreted?.quantityColumn ?? guessColumn(preview.columns, ["quantity", "volume", "qty", "vol"]),
        unitRate:
          interpreted?.unitRateColumn ??
          guessColumn(preview.columns, ["harga satuan", "unit rate", "unit price", "rate"]),
        amount: interpreted?.amountColumn ?? guessColumn(preview.columns, ["jumlah", "amount", "total", "nilai", "value"]),
        weight: interpreted?.weightColumn ?? guessColumn(preview.columns, ["bobot", "weight"]),
        start: interpreted?.startColumn ?? guessColumn(preview.columns, ["mulai", "start", "awal"]),
        finish: interpreted?.finishColumn ?? guessColumn(preview.columns, ["selesai", "finish", "akhir", "end"]),
      },
    };
    const lastAvailableDataRow = lastMappedRow(selected, dataStartRow - 1, mapping.fields);
    const dataEndRow = interpreted
      ? Math.min(Math.max(interpreted.dataEndRow, dataStartRow), lastAvailableDataRow)
      : lastAvailableDataRow;
    const proposedSections = boundedRows(interpreted?.sectionRows ?? [], dataStartRow, dataEndRow).filter(
      (row) => !rowCarriesLineData(selected, row, mapping.fields),
    );
    const proposedExclusions = boundedRows(
      interpreted?.excludedRows ?? [],
      dataStartRow,
      dataEndRow,
    ).filter((row) => {
      const descriptionText = cellValue(selected.getRow(row).getCell(description).value).trim();
      return !descriptionText || !rowCarriesLineData(selected, row, mapping.fields);
    });
    const sectionSet = new Set(proposedSections);
    const deterministicExclusions: number[] = [];
    for (let row = dataStartRow; row <= dataEndRow; row++) {
      const text = cellValue(selected.getRow(row).getCell(description).value).trim();
      if (SUMMARY_ROW.test(text)) deterministicExclusions.push(row);
    }

    let periodCount = 0;
    if (mapping.fields.finish) {
      for (let row = dataStartRow; row <= dataEndRow; row++) {
        const finish = parseNumber(readCell(selected.getRow(row).getCell(mapping.fields.finish).value));
        if (typeof finish === "number" && Number.isInteger(finish)) periodCount = Math.max(periodCount, finish);
      }
    }
    assertPeriodCapacity(periodCount);
    const excludedRows = [...new Set([...proposedExclusions, ...deterministicExclusions])]
      .filter((row) => !sectionSet.has(row))
      .sort((a, b) => a - b);
    const parentAssignments = defaultParentAssignments(selected, {
      dataStartRow,
      dataEndRow,
      sectionRows: proposedSections,
      excludedRows,
      descriptionColumn: description,
    });

    plan = {
      version: 2,
      fileHash,
      profile: interpreted ? "generic-ai" : "generic-deterministic",
      sheetName: selected.name,
      headerRow,
      analysisSignature: workbookPlanIdentitySignature({
        fileHash,
        profile: interpreted ? "generic-ai" : "generic-deterministic",
        sheetName: selected.name,
        headerRow,
        dataStartRow,
        dataEndRow,
      }),
      dataStartRow,
      dataEndRow,
      sectionRows: proposedSections,
      excludedRows,
      mandatoryExcludedRows: deterministicExclusions.filter((row) => excludedRows.includes(row)),
      userExcludedRows: [],
      parentAssignments,
      actualCurve: null,
      mapping,
      suggestedCode: interpreted?.projectCode ?? null,
      suggestedName: interpreted?.projectName ?? null,
      suggestedClient: interpreted?.client ?? null,
      suggestedLocation: interpreted?.location ?? null,
      suggestedStartDate: interpreted?.startDate ?? null,
      suggestedScheduleStartDate: interpreted?.startDate ?? null,
      suggestedEndDate: interpreted?.endDate ?? null,
      periodType: interpreted?.periodType ?? "weekly",
      // The model never proposes "custom" (see workbook-ai.ts), so an AI plan
      // never arrives with a cycle length. The wizard sets both if the reader
      // overrides the cadence.
      periodLengthDays: null,
      periodCount,
      confidence: interpreted?.confidence ?? "low",
      warnings: interpreted?.warnings ?? ["AI interpretation is unavailable. Review every mapping before importing."],
      weeklyProgress: null,
      pdf: null,
    };
  }

  // The reference path skips `interpreting` entirely and lands here still on
  // `recognising`, so it needs its own building signal.
  if (plan.profile === "reference-s-curve") onStage("building");

  return reviewProjectWorkbook(bytes, plan);
}

function assertSafeRowScope(
  sheet: Awaited<ReturnType<typeof loadWorkbook>>["worksheets"][number],
  plan: WorkbookPlan,
) {
  if (plan.profile === "reference-s-curve") {
    const bounds = referenceBounds(sheet);
    const expectedActualCurve =
      bounds?.actualRow && bounds.periodColumns.length > 0
        ? { sourceRow: bounds.actualRow, periodColumns: bounds.periodColumns }
        : null;
    if (
      !bounds ||
      plan.headerRow !== bounds.headerRow ||
      plan.dataStartRow !== bounds.dataStartRow ||
      plan.dataEndRow !== bounds.dataEndRow ||
      JSON.stringify(plan.actualCurve) !== JSON.stringify(expectedActualCurve)
    ) {
      throw new ProjectWorkbookError("The reference workbook import scope was changed.", "invalid");
    }
  } else if (plan.profile === "generic-deterministic") {
    const expectedEnd = lastMappedRow(sheet, plan.headerRow, plan.mapping.fields);
    if (plan.dataStartRow !== plan.headerRow + 1 || plan.dataEndRow !== expectedEnd) {
      throw new ProjectWorkbookError("The workbook row range no longer matches its analyzed table.", "invalid");
    }
  } else {
    const lastAvailableRow = lastMappedRow(sheet, plan.dataStartRow - 1, plan.mapping.fields);
    if (
      plan.dataStartRow <= plan.headerRow ||
      plan.dataEndRow < plan.dataStartRow ||
      plan.dataEndRow > lastAvailableRow
    ) {
      throw new ProjectWorkbookError("The AI workbook row range is outside its analyzed table.", "invalid");
    }
  }
  for (const row of plan.excludedRows) {
    const description = cellValue(
      sheet.getRow(row).getCell(plan.mapping.fields.description).value,
    ).trim();
    if (
      rowCarriesLineData(sheet, row, plan.mapping.fields) &&
      description &&
      !SUMMARY_ROW.test(description) &&
      !plan.userExcludedRows.includes(row)
    ) {
      throw new ProjectWorkbookError(
        `Row ${row} contains BoQ values and cannot be excluded from validation.`,
        "invalid",
      );
    }
  }
  if (
    plan.actualCurve &&
    (plan.actualCurve.sourceRow > sheet.rowCount ||
      plan.actualCurve.periodColumns.some((mapping) => mapping.column > sheet.columnCount))
  ) {
    throw new ProjectWorkbookError(
      "The actual-curve source is outside the selected worksheet.",
      "invalid",
    );
  }
}

function assertPlanCoordinates(
  sheet: Awaited<ReturnType<typeof loadWorkbook>>["worksheets"][number],
  plan: WorkbookPlan,
) {
  const mappedColumns = Object.values(plan.mapping.fields);
  if (
    plan.headerRow > sheet.rowCount ||
    plan.dataStartRow > sheet.rowCount ||
    plan.dataEndRow > sheet.rowCount ||
    mappedColumns.some((column) => column !== undefined && column > sheet.columnCount)
  ) {
    throw new ProjectWorkbookError(
      "The import mapping points outside the selected worksheet.",
      "invalid",
    );
  }
}

async function reviewProjectPdf(bytes: Uint8Array, submittedPlan: WorkbookPlan) {
  const pdf = submittedPlan.pdf;
  if (!pdf) throw new ProjectWorkbookError("The PDF extraction is missing.", "invalid");
  const validation = await validateProjectPdf(bytes);
  if (validation.pageCount !== pdf.pageCount) {
    throw new ProjectWorkbookError("The PDF page count changed after analysis.", "invalid");
  }
  if (
    pdf.extraction.rows.some((row) => row.page > pdf.pageCount) ||
    pdf.extraction.actualSnapshots.some((snapshot) => snapshot.page > pdf.pageCount) ||
    (pdf.extraction.progressReport !== null &&
      (pdf.extraction.progressReport.grandTotal.page > pdf.pageCount ||
        (pdf.extraction.progressReport.reportDateSource !== null &&
          pdf.extraction.progressReport.reportDateSource.page > pdf.pageCount))) ||
    Object.values(pdf.extraction.metadataSources).some(
      (source) => source !== null && source.page > pdf.pageCount,
    )
  ) {
    throw new ProjectWorkbookError("The PDF extraction references a page outside the document.", "invalid");
  }
  const extractionDigest = pdfExtractionDigest(pdf.extraction);
  if (extractionDigest !== pdf.extractionDigest) {
    throw new ProjectWorkbookError(
      "The extracted PDF values changed after analysis. Analyze the PDF again.",
      "invalid",
    );
  }
  const expectedDataEndRow = pdf.extraction.rows.length + 1;
  if (
    submittedPlan.sheetName !== PDF_SHEET_NAME ||
    submittedPlan.headerRow !== 1 ||
    submittedPlan.dataStartRow !== 2 ||
    submittedPlan.dataEndRow !== expectedDataEndRow ||
    JSON.stringify(submittedPlan.mapping) !== JSON.stringify(PDF_MAPPING)
  ) {
    throw new ProjectWorkbookError("The PDF import scope was changed.", "invalid");
  }

  const mandatoryExcludedRows = pdfRowNumbers(pdf.extraction, "excluded");
  const userExcludedRows = boundedRows(
    submittedPlan.userExcludedRows,
    2,
    expectedDataEndRow,
  ).filter((row) => !mandatoryExcludedRows.includes(row));
  const excludedRows = boundedRows(
    [...mandatoryExcludedRows, ...userExcludedRows],
    2,
    expectedDataEndRow,
  );
  const sectionRows = boundedRows(
    submittedPlan.sectionRows,
    2,
    expectedDataEndRow,
  ).filter((row) => !excludedRows.includes(row));
  const periodCount = pdfSchedulePeriodCount(pdf.extraction);
  assertPeriodCapacity(periodCount);
  const plan = workbookPlanSchema.parse({
    ...submittedPlan,
    sectionRows,
    excludedRows,
    mandatoryExcludedRows,
    userExcludedRows,
    periodCount,
    parentAssignments: submittedPlan.parentAssignments.filter(
      (assignment) =>
        assignment.row >= 2 &&
        assignment.row <= expectedDataEndRow &&
        !excludedRows.includes(assignment.row),
    ),
    suggestedCode: pdf.extraction.projectCode,
    suggestedName: pdf.extraction.projectName,
    suggestedClient: pdf.extraction.client,
    suggestedLocation: pdf.extraction.location,
    suggestedStartDate: pdf.extraction.startDate,
    suggestedScheduleStartDate:
      pdf.extraction.scheduleStartDate ?? pdf.extraction.startDate,
    suggestedEndDate: pdf.extraction.endDate,
    periodType: pdf.extraction.periodType,
    confidence: pdf.extraction.confidence,
    warnings: [
      ...pdf.extraction.warnings,
      "PDF text was parsed by Firecrawl and structured by AI. Review every imported row against the source document.",
      "Rows without source codes receive deterministic import codes.",
      "Amount-only rows import as 1 LS at the extracted amount.",
    ],
  });
  const sheet = await pdfWorksheet(pdf.extraction);
  const periods = Array.from({ length: Math.max(periodCount, 1) }, (_, index) => ({
    periodIndex: index + 1,
    startDate: "2000-01-01",
    endDate: "2099-12-31",
  }));
  const parsed = parseRows(sheet, plan.headerRow, plan.mapping, periods, {
    ...plan,
    requirePricing: true,
  });
  const sectionSet = new Set(plan.sectionRows);
  const excludedSet = new Set(plan.excludedRows);
  const parentByRow = new Map(
    plan.parentAssignments.map((assignment) => [assignment.row, assignment.parentRow]),
  );
  const sections = parsed.rows.filter((row) => sectionSet.has(row.row));
  const lines = parsed.rows.filter((row) => !sectionSet.has(row.row));
  const parsedByRow = new Map(parsed.rows.map((row) => [row.row, row]));
  const rowPreview: WorkbookAnalysis["rowPreview"] = pdf.extraction.rows.map((source, index) => {
    const row = index + 2;
    const parsedRow = parsedByRow.get(row);
    return {
      row,
      sourcePage: source.page,
      sourceTable: source.table,
      sourceRow: source.sourceRow,
      description: source.description,
      kind: excludedSet.has(row) ? "excluded" : sectionSet.has(row) ? "section" : "item",
      parentRow: parentByRow.get(row) ?? null,
      code: source.code,
      sourceCode: source.code,
      unit: source.unit,
      quantity: source.quantity,
      unitRate: source.unitRate,
      amount: source.amount,
      weight: parsedRow?.weight ?? source.weight,
      startPeriodIndex: parsedRow?.start ?? source.startPeriodIndex,
      finishPeriodIndex: parsedRow?.finish ?? source.finishPeriodIndex,
      progress: source.progress,
    };
  });
  const actual = parseActualSnapshots(sheet, plan);
  const detailedProgress = parsePdfDailyProgress(pdf.extraction);
  const validationErrors = [
    ...parsed.errors,
    ...actual.errors,
    ...(detailedProgress?.errors ?? []),
  ];
  if (lines.length === 0) {
    validationErrors.push({
      row: plan.dataStartRow,
      column: null,
      message: "Include at least one BoQ item before creating the draft.",
    });
  }

  return {
    plan,
    columns: describeSheet(sheet, 1).columns,
    actualSnapshots: actual.snapshots,
    pdfActualPreview: pdf.extraction.actualSnapshots,
    pdfProgressErrorCount: detailedProgress?.errors.length ?? 0,
    dailyProgressPreview: detailedProgress?.preview,
    dailyProgressItems: detailedProgress?.snapshot
      ? dailyItemsPreview([detailedProgress.snapshot])
      : undefined,
    rowPreview,
    summary: {
      sectionCount: sections.length,
      lineCount: lines.length,
      scheduledCount: lines.filter((row) => row.start !== null && row.finish !== null).length,
      totalAmount: lines.reduce(
        (total, row) => total + (row.quantity ?? 0) * (row.unitRate ?? 0),
        0,
      ),
      totalWeight: lines.reduce((total, row) => total + (row.weight ?? 0), 0),
      actualSnapshotCount: actual.snapshots.length,
      latestActualPercent: actual.snapshots.at(-1)?.cumulativePercent ?? null,
      latestActualPeriodIndex: actual.snapshots.at(-1)?.periodIndex ?? null,
      validationErrors: validationErrors.slice(0, 50),
    },
  } satisfies WorkbookAnalysis;
}

function reviewWeeklyProgressWorkbook(
  workbook: Awaited<ReturnType<typeof loadWorkbook>>,
  sheet: Awaited<ReturnType<typeof loadWorkbook>>["worksheets"][number],
  plan: WorkbookPlan,
): WorkbookAnalysis {
  const actual = parseActualSnapshots(sheet, plan);
  const latestActual = actual.snapshots.at(-1);
  const previousActual = actual.snapshots.find(
    (snapshot) => snapshot.periodIndex === (latestActual?.periodIndex ?? 0) - 1,
  );
  const parsed = parseWeeklyProgressWorkbook(
    workbook,
    sheet,
    latestActual?.cumulativePercent ?? 0,
    latestActual?.periodIndex ?? 0,
    previousActual?.cumulativePercent ?? null,
  );
  if (!parsed || JSON.stringify(parsed.plan) !== JSON.stringify(plan.weeklyProgress)) {
    throw new ProjectWorkbookError(
      "The multi-sheet weekly progress layout changed after analysis.",
      "invalid",
    );
  }

  const totalAmount = parsed.totalAmount;
  const sectionRowByCode = new Map(
    parsed.rows
      .filter((row) => row.parentCode === null)
      .map((row) => [row.code, row.row]),
  );
  const rowPreview: WorkbookAnalysis["rowPreview"] = parsed.rows.map((row) => {
    const source = parsed.rowSources.get(row.row);
    const amount = (row.quantity ?? 0) * (row.unitRate ?? 0);
    return {
      row: row.row,
      sourceSheet: source?.sheetName,
      sourceRow: source?.sourceRow,
      description: row.description,
      kind: row.parentCode === null ? "section" : "item",
      parentRow:
        row.parentCode === null
          ? null
          : (sectionRowByCode.get(row.parentCode) ?? null),
      code: row.code,
      unit: row.unit,
      quantity: row.quantity,
      unitRate: row.unitRate,
      amount: row.parentCode === null ? null : amount,
      weight: row.parentCode === null || totalAmount === 0 ? null : (amount / totalAmount) * 100,
      startPeriodIndex: row.start,
      finishPeriodIndex: row.finish,
    };
  });
  const lines = parsed.rows.filter((row) => row.parentCode !== null);

  return {
    plan,
    columns: describeSheet(sheet, plan.headerRow).columns,
    actualSnapshots: actual.snapshots,
    weeklyProgressPreview: parsed.preview,
    rowPreview,
    summary: {
      sectionCount: parsed.rows.length - lines.length,
      lineCount: lines.length,
      scheduledCount: lines.filter((row) => row.cells !== null).length,
      totalAmount,
      totalWeight: totalAmount > 0 && lines.length > 0 ? 100 : 0,
      actualSnapshotCount: actual.snapshots.length,
      latestActualPercent: actual.snapshots.at(-1)?.cumulativePercent ?? null,
      latestActualPeriodIndex: actual.snapshots.at(-1)?.periodIndex ?? null,
      validationErrors: [...parsed.errors, ...actual.errors].slice(0, 50),
    },
  };
}

export async function reviewProjectWorkbook(
  bytes: Uint8Array,
  submittedPlan: WorkbookPlan,
): Promise<WorkbookAnalysis> {
  const parsedPlan = workbookPlanSchema.parse(submittedPlan);
  if (!hasValidPlanIdentity(parsedPlan)) {
    throw new ProjectWorkbookError(
      "The analyzed workbook identity changed. Upload the workbook again.",
      "invalid",
    );
  }
  if (hash(bytes) !== parsedPlan.fileHash) {
    throw new ProjectWorkbookError("The source file changed after analysis.", "invalid");
  }
  if (parsedPlan.profile === "pdf-ai") return reviewProjectPdf(bytes, parsedPlan);
  const workbook = await loadWorkbook(bytes);
  const sheet = workbook.worksheets.find((candidate) => candidate.name === parsedPlan.sheetName);
  if (!sheet) {
    throw new ProjectWorkbookError("The selected worksheet no longer exists.", "invalid");
  }
  assertPlanCoordinates(sheet, parsedPlan);
  const daily = parsedPlan.dailyProgress
    ? parseDailyProgressWorkbook(workbook, parsedPlan.dailyProgress)
    : null;
  if (parsedPlan.dailyProgress && !daily) {
    throw new ProjectWorkbookError(
      "The dated progress worksheet layout changed after analysis.",
      "invalid",
    );
  }
  if (parsedPlan.weeklyProgress || isWeeklyProgressWorkbook(workbook, sheet)) {
    assertSafeRowScope(sheet, parsedPlan);
    return reviewWeeklyProgressWorkbook(workbook, sheet, parsedPlan);
  }
  let scopedPlan = parsedPlan;
  if (parsedPlan.profile !== "reference-s-curve") {
    const dataStartRow =
      parsedPlan.profile === "generic-ai" ? parsedPlan.dataStartRow : parsedPlan.headerRow + 1;
    const dataEndRow =
      parsedPlan.profile === "generic-ai"
        ? parsedPlan.dataEndRow
        : lastMappedRow(sheet, parsedPlan.headerRow, parsedPlan.mapping.fields);
    const mandatoryExcludedRows = mandatorySummaryRows(
      sheet,
      dataStartRow,
      dataEndRow,
      parsedPlan.mapping.fields.description,
    );
    scopedPlan = {
      ...parsedPlan,
      dataStartRow,
      dataEndRow,
      sectionRows: boundedRows(parsedPlan.sectionRows, dataStartRow, dataEndRow),
      excludedRows: boundedRows(
        [...parsedPlan.excludedRows, ...mandatoryExcludedRows],
        dataStartRow,
        dataEndRow,
      ),
      mandatoryExcludedRows,
      userExcludedRows: boundedRows(
        parsedPlan.userExcludedRows,
        dataStartRow,
        dataEndRow,
      ).filter((row) => !mandatoryExcludedRows.includes(row)),
      parentAssignments: parsedPlan.parentAssignments.filter(
        (assignment) => assignment.row >= dataStartRow && assignment.row <= dataEndRow,
      ),
    };
  }
  assertSafeRowScope(sheet, scopedPlan);
  let periodCount =
    scopedPlan.profile === "reference-s-curve"
      ? (referenceBounds(sheet)?.periodColumns.at(-1)?.periodIndex ?? 0)
      : 0;
  const finishColumn = scopedPlan.mapping.fields.finish;
  if (finishColumn) {
    for (let row = scopedPlan.dataStartRow; row <= scopedPlan.dataEndRow; row++) {
      if (scopedPlan.excludedRows.includes(row)) continue;
      const finish = parseNumber(readCell(sheet.getRow(row).getCell(finishColumn).value));
      if (typeof finish === "number" && Number.isInteger(finish)) {
        periodCount = Math.max(periodCount, finish);
      }
    }
  }
  if (periodCount > MAX_PERIODS) {
    throw new ProjectWorkbookError(
      `The selected finish column contains period ${periodCount}, above the ${MAX_PERIODS}-period limit.`,
      "invalid",
    );
  }
  const plan = workbookPlanSchema.parse({
    ...scopedPlan,
    periodCount,
    actualCurve: scopedPlan.actualCurve
      ? {
          ...scopedPlan.actualCurve,
          periodColumns: scopedPlan.actualCurve.periodColumns.filter(
            (mapping) => mapping.periodIndex <= periodCount,
          ),
        }
      : null,
  });
  if (plan.dataEndRow - plan.dataStartRow + 1 > MAX_IMPORT_ROWS) {
    throw new ProjectWorkbookError(
      `The analyzed table exceeds the ${MAX_IMPORT_ROWS.toLocaleString("en-US")} row import limit.`,
      "invalid",
    );
  }
  const periods = Array.from({ length: Math.max(plan.periodCount, 1) }, (_, index) => ({
    periodIndex: index + 1,
    startDate: "2000-01-01",
    endDate: "2099-12-31",
  }));
  const parsed = parseRows(sheet, plan.headerRow, plan.mapping, periods, {
    ...plan,
    requirePricing: true,
  });
  const sectionRows = new Set(plan.sectionRows);
  const excludedRows = new Set(plan.excludedRows);
  const parentByRow = new Map(
    plan.parentAssignments.map((assignment) => [assignment.row, assignment.parentRow]),
  );
  const sections = parsed.rows.filter((row) => sectionRows.has(row.row));
  const lines = parsed.rows.filter((row) => !sections.includes(row));
  const parsedByRow = new Map(parsed.rows.map((row) => [row.row, row]));
  const rowPreview: WorkbookAnalysis["rowPreview"] = [];
  for (let row = plan.dataStartRow; row <= plan.dataEndRow; row++) {
    const description = cellValue(sheet.getRow(row).getCell(plan.mapping.fields.description).value)
      .trim()
      .slice(0, 500);
    if (!description) continue;
    const parsedRow = parsedByRow.get(row);
    rowPreview.push({
      row,
      description,
      kind: excludedRows.has(row) ? "excluded" : sectionRows.has(row) ? "section" : "item",
      parentRow: parentByRow.get(row) ?? null,
      code: parsedRow?.code ?? null,
      unit: parsedRow?.unit ?? null,
      quantity: parsedRow?.quantity ?? null,
      unitRate: parsedRow?.unitRate ?? null,
      amount:
        parsedRow?.quantity !== null &&
        parsedRow?.quantity !== undefined &&
        parsedRow.unitRate !== null &&
        parsedRow.unitRate !== undefined
          ? parsedRow.quantity * parsedRow.unitRate
          : null,
      weight: parsedRow?.weight ?? null,
      startPeriodIndex: parsedRow?.start ?? null,
      finishPeriodIndex: parsedRow?.finish ?? null,
    });
  }
  const actual = parseActualSnapshots(sheet, plan);
  const validationErrors = [...parsed.errors, ...actual.errors, ...(daily?.errors ?? [])];
  const latestDaily = daily?.snapshots.at(-1);
  const latestActual = actual.snapshots.at(-1);
  if (
    latestDaily &&
    latestActual &&
    Math.abs(latestDaily.cumulativePercent - latestActual.cumulativePercent) > 0.02
  ) {
    validationErrors.push({
      row: plan.dailyProgress?.dataEndRow ?? plan.dataEndRow,
      column: null,
      message: `Latest daily progress (${latestDaily.cumulativePercent.toFixed(3)}%) does not match the S-curve (${latestActual.cumulativePercent.toFixed(3)}%).`,
    });
  }
  if (lines.length === 0) {
    validationErrors.push({
      row: plan.dataStartRow,
      column: null,
      message: "Include at least one BoQ item before creating the draft.",
    });
  }

  return {
    plan,
    columns: describeSheet(sheet, plan.headerRow).columns,
    actualSnapshots: actual.snapshots,
    dailyProgressPreview: daily?.preview,
    dailyProgressItems: daily ? dailyItemsPreview(daily.snapshots) : undefined,
    rowPreview,
    summary: {
      sectionCount: sections.length,
      lineCount: lines.length,
      scheduledCount: lines.filter((row) => row.start !== null && row.finish !== null).length,
      totalAmount: lines.reduce((total, row) => total + (row.quantity ?? 0) * (row.unitRate ?? 0), 0),
      totalWeight: lines.reduce((total, row) => total + (row.weight ?? 0), 0),
      actualSnapshotCount: actual.snapshots.length,
      latestActualPercent: actual.snapshots.at(-1)?.cumulativePercent ?? null,
      latestActualPeriodIndex: actual.snapshots.at(-1)?.periodIndex ?? null,
      validationErrors: validationErrors.slice(0, 50),
    },
  };
}

export function workbookHash(bytes: Uint8Array) {
  return hash(bytes);
}

export async function validateWorkbookCalendar(
  bytes: Uint8Array,
  plan: WorkbookPlan,
  project: ProjectWorkbookCommit["project"],
) {
  if (plan.periodCount < 1) {
    throw new ProjectWorkbookError(
      "No reporting periods were found. Review the Finish period column mapping.",
      "invalid",
      [],
      "schedule_mapping_required",
    );
  }

  let generated;
  try {
    generated = generatePeriods(
      project.scheduleStart ?? project.startDate,
      project.endDate,
      project.periodType,
      project.periodLengthDays,
    );
  } catch (error) {
    if (error instanceof PeriodRangeError) {
      throw new ProjectWorkbookError(
        error.message,
        "invalid",
        [],
        "schedule_range_exceeded",
        {
          workbookPeriodCount: plan.periodCount,
          suggestedEndDate: endDateForPeriodCount(
            project.scheduleStart ?? project.startDate,
            plan.periodCount,
            project.periodType,
            project.periodLengthDays,
          ),
        },
      );
    }
    throw error;
  }
  if (generated.length !== plan.periodCount) {
    const suggestedEndDate = endDateForPeriodCount(
      project.scheduleStart ?? project.startDate,
      plan.periodCount,
      project.periodType,
      project.periodLengthDays,
    );
    throw new ProjectWorkbookError(
      `Your dates create ${generated.length} ${project.periodType} periods, but workbook items are scheduled through period ${plan.periodCount}.`,
      "invalid",
      [],
      "period_count_mismatch",
      {
        workbookPeriodCount: plan.periodCount,
        confirmedPeriodCount: generated.length,
        suggestedEndDate,
      },
    );
  }

  if (plan.profile === "pdf-ai" && plan.pdf) {
    return { generated, sheet: await pdfWorksheet(plan.pdf.extraction) };
  }

  const workbook = await loadWorkbook(bytes);
  const sheet = workbook.worksheets.find((candidate) => candidate.name === plan.sheetName);
  if (!sheet) throw new ProjectWorkbookError("The selected worksheet was not found.", "invalid");
  assertSafeRowScope(sheet, plan);
  if (plan.profile === "reference-s-curve") {
    const bounds = referenceBounds(sheet);
    if (bounds?.layout === "indonesian-summary") {
      if (project.periodType !== "weekly") {
        throw new ProjectWorkbookError(
          "The KURVA-S workbook uses weekly reporting periods.",
          "invalid",
          [],
          "workbook_calendar_mismatch",
        );
      }
      return { generated, sheet };
    }
    if (
      !bounds?.contractStartDate ||
      !bounds.scheduleStartDate ||
      !bounds.endDate
    ) {
      throw new ProjectWorkbookError(
        "The workbook reporting calendar could not be verified.",
        "invalid",
      );
    }
    if (
      project.startDate !== bounds.contractStartDate ||
      project.scheduleStart !== bounds.scheduleStartDate ||
      project.endDate !== bounds.endDate ||
      project.periodType !== "weekly"
    ) {
      const differences = [
        project.startDate !== bounds.contractStartDate ? "startDate" : null,
        project.scheduleStart !== bounds.scheduleStartDate ? "scheduleStart" : null,
        project.endDate !== bounds.endDate ? "endDate" : null,
        project.periodType !== "weekly" ? "periodType" : null,
      ].filter((field): field is string => field !== null);
      throw new ProjectWorkbookError(
        "The selected dates do not match the calendar found in the workbook.",
        "invalid",
        [],
        "workbook_calendar_mismatch",
        {
          suggestedStartDate: bounds.contractStartDate,
          suggestedScheduleStartDate: bounds.scheduleStartDate,
          suggestedEndDate: bounds.endDate,
          differences,
        },
      );
    }
    const periodEndDatesMatch = bounds.periodColumns.every((mapping) => {
      const period = generated.find((candidate) => candidate.periodIndex === mapping.periodIndex);
      return period?.endDate === isoDateAt(sheet, bounds.headerRow + 2, mapping.column);
    });
    if (!periodEndDatesMatch) {
      throw new ProjectWorkbookError(
        "The generated reporting periods do not match the workbook calendar.",
        "invalid",
      );
    }
  }

  return { generated, sheet };
}

export async function prepareConfirmedWorkbook(bytes: Uint8Array, input: ProjectWorkbookCommit) {
  const reviewed = await reviewProjectWorkbook(bytes, input.plan);
  const plan = reviewed.plan;
  if (reviewed.summary.validationErrors.length > 0) {
    throw new ProjectWorkbookError(
      "Some workbook rows need attention.",
      "invalid",
      reviewed.summary.validationErrors,
    );
  }
  if (plan.weeklyProgress) {
    const workbook = await loadWorkbook(bytes);
    const sheet = workbook.worksheets.find((candidate) => candidate.name === plan.sheetName);
    if (!sheet) throw new ProjectWorkbookError("The selected worksheet was not found.", "invalid");
    const parsed = parseWeeklyProgressWorkbook(
      workbook,
      sheet,
      reviewed.actualSnapshots.at(-1)?.cumulativePercent ?? 0,
      reviewed.actualSnapshots.at(-1)?.periodIndex ?? 0,
      reviewed.actualSnapshots.find(
        (snapshot) =>
          snapshot.periodIndex ===
          (reviewed.actualSnapshots.at(-1)?.periodIndex ?? 0) - 1,
      )?.cumulativePercent ?? null,
    );
    if (!parsed || JSON.stringify(parsed.plan) !== JSON.stringify(plan.weeklyProgress)) {
      throw new ProjectWorkbookError(
        "The multi-sheet weekly progress layout changed after review.",
        "invalid",
      );
    }
    if (parsed.preview.confirmationRequired && !input.acceptProgressDifference) {
      throw new ProjectWorkbookError(
        "The itemized current progress differs from the unfinished KURVA-S total. Confirm the partial progress import to continue.",
        "invalid",
        [],
        "itemized_progress_difference",
        {
          aggregateCurrentPercent: parsed.preview.aggregateCurrentPercent,
          itemizedCurrentPercent: parsed.preview.itemizedCurrentPercent,
        },
      );
    }
    const { generated } = await validateWorkbookCalendar(bytes, plan, input.project);
    return {
      plan,
      rows: parsed.rows,
      periods: generated,
      actualSnapshots: reviewed.actualSnapshots,
      itemProgress: parsed.itemProgress,
      weeklyProgressPreview: parsed.preview,
      dailyProgress: [] as ParsedDailyProgressSnapshot[],
    };
  }
  if (!plan.mapping.fields.start || !plan.mapping.fields.finish) {
    throw new ProjectWorkbookError(
      "Map both a start-period and finish-period column before creating the schedule.",
      "invalid",
    );
  }

  const { generated, sheet } = await validateWorkbookCalendar(bytes, plan, input.project);

  const rows = parseRows(sheet, plan.headerRow, plan.mapping, generated, {
    ...plan,
    requirePricing: true,
  });
  if (rows.errors.length > 0 || rows.rows.length === 0) {
    throw new ProjectWorkbookError(
      rows.rows.length === 0 ? "No importable rows were found." : "Some workbook rows need attention.",
      "invalid",
      rows.errors.slice(0, 100),
    );
  }
  if (rows.rows.every((row) => plan.sectionRows.includes(row.row))) {
    throw new ProjectWorkbookError(
      "Include at least one BoQ item before creating the draft.",
      "invalid",
    );
  }
  const actual = parseActualSnapshots(sheet, plan);
  if (actual.errors.length > 0) {
    throw new ProjectWorkbookError("The imported actual curve needs attention.", "invalid", actual.errors);
  }
  const workbook = plan.dailyProgress ? await loadWorkbook(bytes) : null;
  const daily = workbook && plan.dailyProgress
    ? parseDailyProgressWorkbook(workbook, plan.dailyProgress)
    : null;
  if (plan.dailyProgress && (!daily || daily.errors.length > 0)) {
    throw new ProjectWorkbookError(
      "The dated progress worksheets need attention.",
      "invalid",
      daily?.errors.slice(0, 100) ?? [],
    );
  }
  const mergedActuals = new Map(actual.snapshots.map((snapshot) => [snapshot.periodIndex, snapshot]));
  const latestDailyByPeriod = new Map<number, ParsedDailyProgressSnapshot>();
  for (const snapshot of daily?.snapshots ?? []) {
    const period = generated.find(
      (candidate) =>
        snapshot.reportDate >= candidate.startDate && snapshot.reportDate <= candidate.endDate,
    );
    if (period) latestDailyByPeriod.set(period.periodIndex, snapshot);
  }
  for (const [periodIndex, snapshot] of latestDailyByPeriod) {
    if (mergedActuals.has(periodIndex)) continue;
    mergedActuals.set(periodIndex, {
      periodIndex,
      cumulativePercent: snapshot.cumulativePercent,
      sourceRow: plan.dailyProgress?.dataEndRow ?? plan.dataEndRow,
      sourceColumn:
        plan.dailyProgress?.mapping.cumulativeWeighted ?? plan.mapping.fields.weight ?? 1,
      sourceValue: snapshot.cumulativePercent.toFixed(8),
      sourceLabel: snapshot.sourceSheetName,
    });
  }

  return {
    plan,
    rows: rows.rows,
    periods: generated,
    actualSnapshots: [...mergedActuals.values()].sort((a, b) => a.periodIndex - b.periodIndex),
    itemProgress: [],
    weeklyProgressPreview: undefined,
    dailyProgress: daily?.snapshots ?? [],
  };
}
