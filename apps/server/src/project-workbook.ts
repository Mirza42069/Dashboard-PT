import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import {
  endDateForPeriodCount,
  generatePeriods,
  MAX_PERIODS,
  PeriodRangeError,
} from "@DashboardV2/api/lib/periods";
import { z } from "zod";

import {
  describeSheet,
  loadWorkbook,
  MAX_IMPORT_ROWS,
  MAX_WORKBOOK_COLUMNS,
  MAX_WORKBOOK_ROWS,
  parseNumber,
  parseRows,
  readCell,
} from "./boq-import-parse";

const workbookRow = z.number().int().positive().max(MAX_WORKBOOK_ROWS);
const workbookColumn = z.number().int().positive().max(MAX_WORKBOOK_COLUMNS);

const fieldsSchema = z.object({
  description: workbookColumn,
  unit: workbookColumn.optional(),
  quantity: workbookColumn.optional(),
  unitRate: workbookColumn.optional(),
  amount: workbookColumn.optional(),
  weight: workbookColumn.optional(),
  start: workbookColumn.optional(),
  finish: workbookColumn.optional(),
});

export const workbookPlanSchema = z
  .object({
    version: z.literal(2),
    fileHash: z.string().regex(/^[a-f0-9]{64}$/),
    analysisSignature: z.string().regex(/^[a-f0-9]{64}$/),
    profile: z.enum(["reference-s-curve", "generic-ai", "generic-deterministic"]),
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
    periodType: z.enum(["weekly", "biweekly", "monthly"]),
    periodCount: z.number().int().min(0).max(600),
    confidence: z.enum(["high", "medium", "low"]),
    warnings: z.array(z.string().max(300)).max(20),
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
    description: string;
    kind: "item" | "section" | "excluded";
    parentRow: number | null;
  }[];
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
};

export const projectWorkbookCommitSchema = z.object({
  plan: workbookPlanSchema,
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
      periodType: z.enum(["weekly", "biweekly", "monthly"]),
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
    readonly details: Record<string, string | number | null> | null = null,
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
    }),
    "hex",
  );
  const submitted = Buffer.from(plan.analysisSignature, "hex");
  return expected.length === submitted.length && timingSafeEqual(expected, submitted);
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

function referenceBounds(
  sheet: Awaited<ReturnType<typeof loadWorkbook>>["worksheets"][number],
) {
  if (!/s[ -]?curve/i.test(sheet.name)) return null;
  const description = cellValue(sheet.getRow(7).getCell(3).value).toUpperCase();
  const amount = cellValue(sheet.getRow(7).getCell(4).value).toUpperCase();
  const weight = cellValue(sheet.getRow(7).getCell(5).value).toUpperCase();
  const start = cellValue(sheet.getRow(7).getCell(6).value).toUpperCase();
  if (
    !description.includes("URAIAN") ||
    !amount.includes("JUMLAH") ||
    !weight.includes("BOBOT") ||
    !start.includes("MINGGU")
  ) {
    return null;
  }

  let totalRow = 0;
  for (let row = 8; row <= sheet.rowCount; row++) {
    if (cellValue(sheet.getRow(row).getCell(3).value).trim().toUpperCase() === "TOTAL") {
      totalRow = row;
      break;
    }
  }
  if (totalRow === 0) return null;
  let titleRow = 0;
  for (let row = 8; row < totalRow; row++) {
    const text = cellValue(sheet.getRow(row).getCell(3).value).trim();
    const rowAmount = parseNumber(readCell(sheet.getRow(row).getCell(4).value));
    const rowStart = parseNumber(readCell(sheet.getRow(row).getCell(6).value));
    const nextDescription = cellValue(sheet.getRow(row + 1).getCell(3).value).trim();
    if (text && typeof rowAmount === "number" && rowStart === null && nextDescription) {
      titleRow = row;
      break;
    }
  }
  if (titleRow === 0) return null;
  const periodColumns: { periodIndex: number; column: number }[] = [];
  for (let column = 1; column <= sheet.columnCount; column++) {
    const periodIndex = parseNumber(readCell(sheet.getRow(7).getCell(column).value));
    if (typeof periodIndex === "number" && Number.isInteger(periodIndex) && periodIndex > 0) {
      periodColumns.push({ periodIndex, column });
    }
  }
  const firstPeriod = periodColumns[0];
  const lastPeriod = periodColumns.at(-1);
  const contractStartDate = firstPeriod ? isoDateAt(sheet, 8, firstPeriod.column) : null;
  const firstPeriodEnd = firstPeriod ? isoDateAt(sheet, 9, firstPeriod.column) : null;
  const scheduleStartDate = firstPeriodEnd ? addDays(firstPeriodEnd, -6) : null;
  const endDate = lastPeriod ? isoDateAt(sheet, 9, lastPeriod.column) : null;
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
    titleRow,
    dataStartRow: titleRow + 1,
    dataEndRow: totalRow - 1,
    periodColumns,
    actualRow,
    contractStartDate,
    scheduleStartDate,
    endDate,
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
): WorkbookPlan | null {
  for (const sheet of workbook.worksheets) {
    const bounds = referenceBounds(sheet);
    if (!bounds) continue;
    const { titleRow, dataStartRow, dataEndRow } = bounds;
    const sectionRows: number[] = [];
    let periodCount = 0;
    for (let row = dataStartRow; row <= dataEndRow; row++) {
      const text = cellValue(sheet.getRow(row).getCell(3).value).trim();
      const rowAmount = parseNumber(readCell(sheet.getRow(row).getCell(4).value));
      if (text && rowAmount === null) sectionRows.push(row);
      const finish = parseNumber(readCell(sheet.getRow(row).getCell(7).value));
      if (typeof finish === "number" && Number.isInteger(finish)) periodCount = Math.max(periodCount, finish);
    }
    assertPeriodCapacity(periodCount);
    const parentAssignments = defaultParentAssignments(sheet, {
      dataStartRow,
      dataEndRow,
      sectionRows,
      excludedRows: [],
      descriptionColumn: 3,
    });
    const identity = {
      fileHash,
      profile: "reference-s-curve" as const,
      sheetName: sheet.name,
      headerRow: 7,
    };

    return {
      version: 2,
      ...identity,
      analysisSignature: workbookPlanIdentitySignature(identity),
      dataStartRow,
      dataEndRow,
      sectionRows,
      excludedRows: [],
      mandatoryExcludedRows: [],
      userExcludedRows: [],
      parentAssignments,
      actualCurve:
        bounds.actualRow && bounds.periodColumns.length > 0
          ? { sourceRow: bounds.actualRow, periodColumns: bounds.periodColumns }
          : null,
      mapping: { fields: { description: 3, amount: 4, weight: 5, start: 6, finish: 7 } },
      suggestedCode: null,
      suggestedName: cellValue(sheet.getRow(titleRow).getCell(3).value).trim() || null,
      suggestedClient: null,
      suggestedLocation: null,
      suggestedStartDate: bounds.contractStartDate,
      suggestedScheduleStartDate: bounds.scheduleStartDate,
      suggestedEndDate: bounds.endDate,
      periodType: "weekly",
      periodCount,
      confidence: "high",
      warnings: [
        "Roman numerals are sparse in this workbook, so stable BoQ codes will be generated.",
        "Rows with JUMLAH are imported as lump-sum items (1 LS × JUMLAH).",
        ...(bounds.contractStartDate !== bounds.scheduleStartDate
          ? [
              "The first reporting period begins after the contract start, following the workbook's period-end dates.",
            ]
          : []),
      ],
    };
  }
  return null;
}

function workbookSummary(workbook: Awaited<ReturnType<typeof loadWorkbook>>) {
  let remainingCharacters = 30_000;
  return {
    task: "Identify the project and importable BoQ/S-curve table. Column numbers are 1-based.",
    sheets: workbook.worksheets.slice(0, 5).map((sheet) => {
      const nonemptyRows: { row: number; cells: { column: number; value: string }[] }[] = [];
      for (
        let row = 1;
        row <= sheet.rowCount && nonemptyRows.length < 40 && remainingCharacters > 0;
        row++
      ) {
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
      return { name: sheet.name, rowCount: sheet.rowCount, columnCount: sheet.columnCount, rows: nonemptyRows };
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
  const snapshots: ParsedActualSnapshot[] = [];
  const errors: { row: number; column: string | null; message: string }[] = [];
  if (!plan.actualCurve) return { snapshots, errors };
  let previous = -1;
  for (const mapping of plan.actualCurve.periodColumns) {
    if (mapping.periodIndex > plan.periodCount) continue;
    const cell = readCell(sheet.getRow(plan.actualCurve.sourceRow).getCell(mapping.column).value);
    const parsed = parseNumber(cell);
    if (parsed === null) continue;
    if (parsed === "invalid" || parsed < 0 || parsed > 100) {
      errors.push({
        row: plan.actualCurve.sourceRow,
        column: String(mapping.column),
        message: `Actual cumulative progress for period ${mapping.periodIndex} must be between 0% and 100%.`,
      });
      continue;
    }
    if (parsed < previous) {
      errors.push({
        row: plan.actualCurve.sourceRow,
        column: String(mapping.column),
        message: `Actual cumulative progress decreases at period ${mapping.periodIndex}.`,
      });
      continue;
    }
    previous = parsed;
    snapshots.push({
      periodIndex: mapping.periodIndex,
      cumulativePercent: parsed,
      sourceRow: plan.actualCurve.sourceRow,
      sourceColumn: mapping.column,
      sourceValue: cell.kind === "empty" ? "" : String(cell.value),
    });
  }
  return { snapshots, errors };
}

/**
 * The steps this function passes through, in order.
 *
 * Reported rather than estimated: the caller cannot see inside a single
 * request, and the one step that dominates the wait — the model reading the
 * layout — is also the one a timer would guess worst. `interpreting` is
 * genuinely skipped for the reference template, which is recognised without
 * the model, so a progress bar driven by these never claims work that did not
 * happen.
 */
export const ANALYSIS_STAGES = ["reading", "recognising", "interpreting", "building"] as const;
export type AnalysisStage = (typeof ANALYSIS_STAGES)[number];

export async function analyzeProjectWorkbook(
  bytes: Uint8Array,
  onStage: (stage: AnalysisStage) => void = () => {},
): Promise<WorkbookAnalysis> {
  onStage("reading");
  const workbook = await loadWorkbook(bytes);
  const fileHash = hash(bytes);
  onStage("recognising");
  let plan = referencePlan(workbook, fileHash);

  if (!plan) {
    onStage("interpreting");
    const { interpretWorkbook } = await import("./openrouter");
    const interpreted = await interpretWorkbook(workbookSummary(workbook));
    onStage("building");
    const selected = interpreted
      ? workbook.worksheets.find((sheet) => sheet.name === interpreted.sheetName)
      : workbook.worksheets[0];
    if (!selected) throw new ProjectWorkbookError("The workbook has no worksheets.", "invalid");

    const preview = describeSheet(selected, interpreted?.headerRow);
    const description = interpreted?.descriptionColumn ?? guessColumn(preview.columns, ["description", "uraian", "pekerjaan", "item", "deskripsi"]);
    if (!description) {
      throw new ProjectWorkbookError("No description column could be identified.", "invalid");
    }
    const headerRow = Math.min(Math.max(interpreted?.headerRow ?? preview.headerRow, 1), selected.rowCount);
    const dataStartRow = Math.min(headerRow + 1, selected.rowCount);
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
    const dataEndRow = lastMappedRow(selected, headerRow, mapping.fields);
    const proposedSections = boundedRows(interpreted?.sectionRows ?? [], dataStartRow, dataEndRow).filter(
      (row) => !rowCarriesLineData(selected, row, mapping.fields),
    );
    const proposedExclusions = boundedRows(
      interpreted?.excludedRows ?? [],
      dataStartRow,
      dataEndRow,
    ).filter((row) => !rowCarriesLineData(selected, row, mapping.fields));
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
      periodCount,
      confidence: interpreted?.confidence ?? "low",
      warnings: interpreted?.warnings ?? ["AI interpretation is unavailable. Review every mapping before importing."],
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
      plan.headerRow !== 7 ||
      plan.dataStartRow !== bounds.dataStartRow ||
      plan.dataEndRow !== bounds.dataEndRow ||
      JSON.stringify(plan.actualCurve) !== JSON.stringify(expectedActualCurve)
    ) {
      throw new ProjectWorkbookError("The reference workbook import scope was changed.", "invalid");
    }
  } else {
    const expectedEnd = lastMappedRow(sheet, plan.headerRow, plan.mapping.fields);
    if (plan.dataStartRow !== plan.headerRow + 1 || plan.dataEndRow !== expectedEnd) {
      throw new ProjectWorkbookError("The workbook row range no longer matches its analyzed table.", "invalid");
    }
  }
  for (const row of plan.excludedRows) {
    const description = cellValue(
      sheet.getRow(row).getCell(plan.mapping.fields.description).value,
    ).trim();
    if (
      rowCarriesLineData(sheet, row, plan.mapping.fields) &&
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
    throw new ProjectWorkbookError("The workbook changed after analysis.", "invalid");
  }
  const workbook = await loadWorkbook(bytes);
  const sheet = workbook.worksheets.find((candidate) => candidate.name === parsedPlan.sheetName);
  if (!sheet) {
    throw new ProjectWorkbookError("The selected worksheet no longer exists.", "invalid");
  }
  assertPlanCoordinates(sheet, parsedPlan);
  let scopedPlan = parsedPlan;
  if (parsedPlan.profile !== "reference-s-curve") {
    const dataEndRow = lastMappedRow(sheet, parsedPlan.headerRow, parsedPlan.mapping.fields);
    const mandatoryExcludedRows = mandatorySummaryRows(
      sheet,
      parsedPlan.headerRow + 1,
      dataEndRow,
      parsedPlan.mapping.fields.description,
    );
    scopedPlan = {
      ...parsedPlan,
      dataStartRow: parsedPlan.headerRow + 1,
      dataEndRow,
      sectionRows: boundedRows(parsedPlan.sectionRows, parsedPlan.headerRow + 1, dataEndRow),
      excludedRows: boundedRows(
        [...parsedPlan.excludedRows, ...mandatoryExcludedRows],
        parsedPlan.headerRow + 1,
        dataEndRow,
      ),
      mandatoryExcludedRows,
      userExcludedRows: boundedRows(
        parsedPlan.userExcludedRows,
        parsedPlan.headerRow + 1,
        dataEndRow,
      ).filter((row) => !mandatoryExcludedRows.includes(row)),
      parentAssignments: parsedPlan.parentAssignments.filter(
        (assignment) => assignment.row > parsedPlan.headerRow && assignment.row <= dataEndRow,
      ),
    };
  }
  assertSafeRowScope(sheet, scopedPlan);
  let periodCount = 0;
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
  const rowPreview: WorkbookAnalysis["rowPreview"] = [];
  for (let row = plan.dataStartRow; row <= plan.dataEndRow; row++) {
    const description = cellValue(sheet.getRow(row).getCell(plan.mapping.fields.description).value)
      .trim()
      .slice(0, 500);
    if (!description) continue;
    rowPreview.push({
      row,
      description,
      kind: excludedRows.has(row) ? "excluded" : sectionRows.has(row) ? "section" : "item",
      parentRow: parentByRow.get(row) ?? null,
    });
  }
  const actual = parseActualSnapshots(sheet, plan);
  const validationErrors = [...parsed.errors, ...actual.errors];
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
  if (!plan.mapping.fields.start || !plan.mapping.fields.finish) {
    throw new ProjectWorkbookError(
      "Map both a start-period and finish-period column before creating the schedule.",
      "invalid",
    );
  }
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
      input.project.scheduleStart ?? input.project.startDate,
      input.project.endDate,
      input.project.periodType,
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
            input.project.scheduleStart ?? input.project.startDate,
            plan.periodCount,
            input.project.periodType,
          ),
        },
      );
    }
    throw error;
  }
  if (generated.length !== plan.periodCount) {
    const suggestedEndDate = endDateForPeriodCount(
      input.project.scheduleStart ?? input.project.startDate,
      plan.periodCount,
      input.project.periodType,
    );
    throw new ProjectWorkbookError(
      `Your dates create ${generated.length} ${input.project.periodType} periods, but workbook items are scheduled through period ${plan.periodCount}.`,
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

  const workbook = await loadWorkbook(bytes);
  const sheet = workbook.worksheets.find((candidate) => candidate.name === plan.sheetName);
  if (!sheet) throw new ProjectWorkbookError("The selected worksheet was not found.", "invalid");
  assertSafeRowScope(sheet, plan);
  if (plan.profile === "reference-s-curve") {
    const bounds = referenceBounds(sheet);
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
      input.project.startDate !== bounds.contractStartDate ||
      input.project.scheduleStart !== bounds.scheduleStartDate ||
      input.project.endDate !== bounds.endDate ||
      input.project.periodType !== "weekly"
    ) {
      throw new ProjectWorkbookError(
        "The selected dates do not match the calendar found in the workbook.",
        "invalid",
        [],
        "workbook_calendar_mismatch",
        {
          suggestedStartDate: bounds.contractStartDate,
          suggestedScheduleStartDate: bounds.scheduleStartDate,
          suggestedEndDate: bounds.endDate,
        },
      );
    }
    const periodEndDatesMatch = bounds.periodColumns.every((mapping) => {
      const period = generated.find((candidate) => candidate.periodIndex === mapping.periodIndex);
      return period?.endDate === isoDateAt(sheet, 9, mapping.column);
    });
    if (!periodEndDatesMatch) {
      throw new ProjectWorkbookError(
        "The generated reporting periods do not match the workbook calendar.",
        "invalid",
      );
    }
  }

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

  return { plan, rows: rows.rows, periods: generated, actualSnapshots: actual.snapshots };
}
