import { planCells } from "@DashboardV2/api/lib/schedule-plan";
import { runBatch } from "@DashboardV2/api/lib/batch";
import { db } from "@DashboardV2/db";
import {
  boqImport,
  boqItem,
  boqItemDistribution,
  boqVersion,
  project,
  reportingPeriod,
} from "@DashboardV2/db/schema";
import { and, asc, desc, eq } from "drizzle-orm";

import {
  type ImportError,
  type ImportMapping,
  type ParsedRow,
  loadWorkbook,
  parseRows,
} from "./boq-import-parse";
import { importedLineages, type RevisionSourceItem } from "./boq-lineage";

/**
 * Turning a validated spreadsheet into a draft BoQ revision.
 *
 * The rule this module is built around: **validate everything, then write, or
 * write nothing at all.** A half-imported BoQ is worse than a failed one — the
 * failure is obvious and the half-import is not, and the person who finds it
 * will be the person reconciling a contract sum three weeks later. So the
 * parser in ./boq-import-parse runs over every row before a single insert is
 * prepared, and one bad row stops the commit.
 *
 * The one thing that *is* written on failure is the attempt itself: filename,
 * importer, time, and the rejected rows. The error report has to outlive the
 * request that produced it or "download the failed rows" has nothing to read.
 *
 * The flow is two requests — preview, then commit — with nothing held on the
 * server between them. A parsed workbook cannot survive between two invocations
 * of a serverless function, so the file is uploaded again with the mapping
 * rather than pretending there is a session to keep it in.
 */

export {
  MAX_IMPORT_BYTES,
  columnLetter,
  describeSheet,
  errorReportCsv,
  parseNumber,
  parseRows,
  previewWorkbook,
  readCell,
  type ImportError,
  type ImportMapping,
  type SheetPreview,
} from "./boq-import-parse";

export type ImportOutcome =
  | {
      status: "failed";
      importId: string;
      errors: ImportError[];
      rowsTotal: number;
    }
  | {
      status: "succeeded";
      importId: string;
      versionId: string;
      versionNo: number;
      rowsImported: number;
      sectionCount: number;
      lineCount: number;
      scheduledCount: number;
    };

const MAX_DISTRIBUTION_CELLS = 50_000;
const DISTRIBUTION_INSERT_SIZE = 10_000;

export class BoqImportCapacityError extends Error {
  readonly kind = "invalid";
  readonly code = "schedule_capacity_exceeded";
  readonly details = null;
  readonly errors = [];
}

function chunks<T>(values: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

export function prepareBoqRevision(input: {
  projectId: string;
  rows: ParsedRow[];
  periods: { id: string; periodIndex: number }[];
  versionNo: number;
  filename: string;
  sheetName: string;
  mapping: ImportMapping;
  mappingAudit?: unknown;
  actor: { id: string; name: string };
  sourceVersionId?: string;
  sourceItems?: RevisionSourceItem[];
}) {
  const versionId = crypto.randomUUID();
  const periodIdByIndex = new Map(input.periods.map((period) => [period.periodIndex, period.id]));
  const periodIndexes = input.periods.map((period) => period.periodIndex);
  const lineageByRow = importedLineages(
    input.rows,
    input.sourceItems ?? [],
    input.mapping.fields.code !== undefined,
  );
  const progressModeByLineage = new Map(
    (input.sourceItems ?? []).map((item) => [item.lineageId, item.progressMode]),
  );

  const idByCode = new Map<string, string>();
  for (const row of input.rows) {
    if (row.parentCode === null) idByCode.set(row.code, crypto.randomUUID());
  }

  const itemValues = input.rows.map((row, index) => {
    const id = row.parentCode === null ? idByCode.get(row.code)! : crypto.randomUUID();
    const lineageId = lineageByRow.get(row.row);
    const parentId = row.parentCode === null ? null : idByCode.get(row.parentCode);
    if (row.parentCode !== null && !parentId) {
      throw new Error(`Import invariant failed: parent ${row.parentCode} was not prepared.`);
    }
    return {
      id,
      boqVersionId: versionId,
      ...(lineageId ? { lineageId } : {}),
      parentId,
      code: row.code,
      description: row.description,
      unit: row.unit,
      quantity: row.quantity === null ? null : row.quantity.toFixed(4),
      unitRate: row.unitRate === null ? null : row.unitRate.toFixed(4),
      weight: row.weight === null ? "0" : row.weight.toFixed(6),
      weightSource: (row.weight === null ? "derived" : "manual") as "derived" | "manual",
      distribution: (row.cells ? "manual" : "linear") as "manual" | "linear",
      progressMode: lineageId ? progressModeByLineage.get(lineageId) : undefined,
      plannedStartPeriodIndex: row.start,
      plannedFinishPeriodIndex: row.finish,
      sortOrder: index,
    };
  });

  const itemIdByRow = new Map(input.rows.map((row, index) => [row.row, itemValues[index]!.id]));
  const sectionIds = new Set(itemValues.map((item) => item.parentId).filter(Boolean) as string[]);
  const totalValue = input.rows.reduce((total, row, index) => {
    if (sectionIds.has(itemValues[index]!.id)) return total;
    const value = (row.quantity ?? 0) * (row.unitRate ?? 0);
    return total + Math.round(value * 100) / 100;
  }, 0);
  let plannedCellCount = 0;
  for (const [index, row] of input.rows.entries()) {
    if (sectionIds.has(itemValues[index]!.id)) continue;
    if (row.cells) {
      plannedCellCount += row.cells.length;
    } else if (row.start !== null && row.finish !== null) {
      plannedCellCount += periodIndexes.filter(
        (periodIndex) => periodIndex >= row.start! && periodIndex <= row.finish!,
      ).length;
    }
    if (plannedCellCount > MAX_DISTRIBUTION_CELLS) {
      throw new BoqImportCapacityError(
        `The schedule contains more than ${MAX_DISTRIBUTION_CELLS.toLocaleString("en-US")} planned cells. Reduce the imported rows or periods.`,
      );
    }
  }
  const distributionValues = input.rows.flatMap((row) => {
    const boqItemId = itemIdByRow.get(row.row)!;
    if (sectionIds.has(boqItemId)) return [];

    if (row.cells) {
      return row.cells.flatMap((cell) => {
        const periodId = periodIdByIndex.get(cell.periodIndex);
        return periodId
          ? [{ boqItemId, periodId, plannedPct: cell.plannedPct.toFixed(6) }]
          : [];
      });
    }
    if (row.start === null || row.finish === null) return [];
    return planCells(periodIndexes, { startIndex: row.start, finishIndex: row.finish })
      .filter((cell) => cell.plannedPct > 0)
      .map((cell) => ({
        boqItemId,
        periodId: periodIdByIndex.get(cell.periodIndex)!,
        plannedPct: cell.plannedPct.toFixed(6),
      }));
  });

  const importId = crypto.randomUUID();
  const statements = [
    db.insert(boqVersion).values({
      id: versionId,
      projectId: input.projectId,
      versionNo: input.versionNo,
      sourceVersionId: input.sourceVersionId,
      title: `Rev ${input.versionNo}`,
      status: "draft",
      scheduleStatus: "draft",
      totalValue: totalValue.toFixed(2),
    }),
    db.insert(boqItem).values(itemValues),
    ...chunks(distributionValues, DISTRIBUTION_INSERT_SIZE).map((values) =>
      db.insert(boqItemDistribution).values(values),
    ),
    db.insert(boqImport).values({
      id: importId,
      projectId: input.projectId,
      boqVersionId: versionId,
      filename: input.filename,
      sheetName: input.sheetName,
      importedById: input.actor.id,
      importedByName: input.actor.name,
      mapping: JSON.stringify(input.mappingAudit ?? input.mapping),
      status: "succeeded",
      rowsTotal: input.rows.length,
      rowsImported: input.rows.length,
      errorCount: 0,
    }),
  ];

  return {
    statements,
    result: {
      status: "succeeded" as const,
      importId,
      versionId,
      versionNo: input.versionNo,
      rowsImported: input.rows.length,
      sectionCount: sectionIds.size,
      lineCount: itemValues.length - sectionIds.size,
      scheduledCount: new Set(distributionValues.map((cell) => cell.boqItemId)).size,
    },
  };
}

export async function commitImport(input: {
  projectId: string;
  bytes: Uint8Array;
  filename: string;
  sheetName: string;
  headerRow: number;
  mapping: ImportMapping;
  actor: { id: string; name: string };
}): Promise<ImportOutcome | { status: "rejected"; message: string }> {
  const workbook = await loadWorkbook(input.bytes);
  const sheet = workbook.worksheets.find((candidate) => candidate.name === input.sheetName);
  if (!sheet) {
    return { status: "rejected", message: `The workbook has no sheet named "${input.sheetName}".` };
  }
  if (input.mapping.fields.description === undefined) {
    return { status: "rejected", message: "Map a column to Description before importing." };
  }

  // One draft per project is a database constraint, not a preference — see the
  // partial unique index on boq_version. Importing into an existing draft would
  // also mix imported rows with hand-entered ones, which is worse than refusing.
  const [existingDraft] = await db
    .select({ id: boqVersion.id, versionNo: boqVersion.versionNo })
    .from(boqVersion)
    .where(and(eq(boqVersion.projectId, input.projectId), eq(boqVersion.status, "draft")))
    .limit(1);
  if (existingDraft) {
    return {
      status: "rejected",
      message: `Rev ${existingDraft.versionNo} is already open as a draft. Activate or discard it before importing.`,
    };
  }

  const periods = await db
    .select({
      id: reportingPeriod.id,
      periodIndex: reportingPeriod.periodIndex,
      startDate: reportingPeriod.startDate,
      endDate: reportingPeriod.endDate,
    })
    .from(reportingPeriod)
    .where(eq(reportingPeriod.projectId, input.projectId))
    .orderBy(asc(reportingPeriod.periodIndex));

  const wantsSchedule =
    input.mapping.fields.start !== undefined ||
    input.mapping.fields.finish !== undefined ||
    (input.mapping.periodColumns?.length ?? 0) > 0;
  if (wantsSchedule && periods.length === 0) {
    return {
      status: "rejected",
      message:
        "This project has no reporting periods yet. Generate them from the project dates before importing a schedule.",
    };
  }

  const { rows, errors } = parseRows(sheet, input.headerRow, input.mapping, periods);

  const record = {
    projectId: input.projectId,
    filename: input.filename,
    sheetName: input.sheetName,
    importedById: input.actor.id,
    importedByName: input.actor.name,
    mapping: JSON.stringify(input.mapping),
  };

  if (errors.length > 0 || rows.length === 0) {
    const listed =
      rows.length === 0 && errors.length === 0
        ? [{ row: input.headerRow, column: null, message: "No rows were found under the header row." }]
        : errors;

    const [written] = await db
      .insert(boqImport)
      .values({
        ...record,
        status: "failed",
        rowsTotal: rows.length + listed.length,
        rowsImported: 0,
        errorCount: listed.length,
        errors: JSON.stringify(listed),
      })
      .returning({ id: boqImport.id });

    return {
      status: "failed",
      importId: written?.id ?? "",
      errors: listed,
      rowsTotal: rows.length,
    };
  }

  /* Everything below here is valid. Build the whole revision, then write once. */

  const [latest] = await db
    .select({ versionNo: boqVersion.versionNo })
    .from(boqVersion)
    .where(eq(boqVersion.projectId, input.projectId))
    .orderBy(desc(boqVersion.versionNo))
    .limit(1);

  const versionNo = (latest?.versionNo ?? 0) + 1;
  const prepared = prepareBoqRevision({
    projectId: input.projectId,
    rows,
    periods,
    versionNo,
    filename: input.filename,
    sheetName: input.sheetName,
    mapping: input.mapping,
    actor: input.actor,
  });
  await runBatch(prepared.statements);
  return prepared.result;
}

/** The project a stored import belongs to, so the route can scope the download. */
export async function getImportRecord(importId: string) {
  const [row] = await db
    .select({
      id: boqImport.id,
      projectId: boqImport.projectId,
      filename: boqImport.filename,
      errors: boqImport.errors,
      companyId: project.companyId,
    })
    .from(boqImport)
    .innerJoin(project, eq(project.id, boqImport.projectId))
    .where(eq(boqImport.id, importId));
  return row ?? null;
}
