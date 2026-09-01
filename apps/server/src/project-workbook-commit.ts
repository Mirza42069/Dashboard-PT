import { runBatch } from "@DashboardV2/api/lib/batch";
import { projectMembershipIds } from "@DashboardV2/api/lib/project-manager";
import type { Role } from "@DashboardV2/api/lib/permissions";
import { db } from "@DashboardV2/db";
import {
  project,
  projectActualCurve,
  projectMember,
  progressEntry,
  reportingPeriod,
} from "@DashboardV2/db/schema";
import { and, eq } from "drizzle-orm";

import { prepareBoqRevision } from "./boq-import";
import { BOQ_NUMERIC_SCALE } from "./boq-import-parse";
import {
  prepareConfirmedWorkbook,
  projectWorkbookCommitSchema,
  ProjectWorkbookError,
  type ProjectWorkbookCommit,
} from "./project-workbook";

export async function commitProjectWorkbook(input: {
  bytes: Uint8Array;
  filename: string;
  confirmed: ProjectWorkbookCommit;
  companyId: string;
  actor: { id: string; name: string; role: Role };
}) {
  const confirmed = projectWorkbookCommitSchema.parse(input.confirmed);
  const code = confirmed.project.code.toUpperCase();
  const [existing] = await db
    .select({ id: project.id })
    .from(project)
    .where(and(eq(project.companyId, input.companyId), eq(project.code, code)))
    .limit(1);
  if (existing) {
    throw new ProjectWorkbookError(`Project code ${code} is already in use.`, "conflict");
  }

  const prepared = await prepareConfirmedWorkbook(input.bytes, confirmed);
  const projectId = crypto.randomUUID();
  const progressPeriodIndexes = new Set(
    prepared.itemProgress.map((entry) => entry.periodIndex),
  );
  const periods = prepared.periods.map((period) => ({
    id: crypto.randomUUID(),
    projectId,
    ...period,
    status: progressPeriodIndexes.has(period.periodIndex) ? ("draft" as const) : ("open" as const),
  }));
  const revision = prepareBoqRevision({
    projectId,
    rows: prepared.rows,
    periods,
    versionNo: 1,
    filename: input.filename,
    sheetName: prepared.plan.sheetName,
    mapping: prepared.plan.mapping,
    mappingAudit: {
      sourceKind: prepared.plan.profile === "pdf-ai" ? "pdf" : "xlsx",
      mapping: prepared.plan.mapping,
      profile: prepared.plan.profile,
      sectionRows: prepared.plan.sectionRows,
      excludedRows: prepared.plan.excludedRows,
      userExcludedRows: prepared.plan.userExcludedRows,
      parentAssignments: prepared.plan.parentAssignments,
      actualCurve: prepared.plan.actualCurve,
      weeklyProgress:
        prepared.weeklyProgressPreview === undefined
          ? null
          : {
              ...prepared.weeklyProgressPreview,
              entries: prepared.itemProgress.map((entry) => ({
                periodIndex: entry.periodIndex,
                sourceSheetName: entry.sourceSheetName,
                sourceRow: entry.sourceRow,
                sourceColumn: entry.sourceColumn,
              })),
            },
      pdf:
        prepared.plan.pdf === null
          ? null
          : {
              pageCount: prepared.plan.pdf.pageCount,
              extractionDigest: prepared.plan.pdf.extractionDigest,
              modelReportedMetadataSources: prepared.plan.pdf.extraction.metadataSources,
              rowSources: prepared.plan.pdf.extraction.rows.map((row, index) => ({
                row: index + 2,
                page: row.page,
                table: row.table,
                sourceRow: row.sourceRow,
              })),
            },
    },
    actor: input.actor,
  });
  const membershipIds = projectMembershipIds({
    creatorId: input.actor.id,
    creatorRole: input.actor.role,
    manager: null,
  });
  const periodByIndex = new Map(periods.map((period) => [period.periodIndex, period]));
  const actualCurveValues = prepared.actualSnapshots.map((snapshot) => {
    const period = periodByIndex.get(snapshot.periodIndex);
    if (!period) {
      throw new ProjectWorkbookError(
        `The workbook actual curve references missing period ${snapshot.periodIndex}.`,
        "invalid",
      );
    }
    return {
      projectId,
      periodId: period.id,
      boqImportId: revision.result.importId,
      cumulativePercent: snapshot.cumulativePercent.toFixed(6),
      sourceFilename: input.filename,
      sourceSheetName: snapshot.sourceLabel ?? prepared.plan.sheetName,
      sourceRow: snapshot.sourceRow,
      sourceColumn: snapshot.sourceColumn,
      sourceValue: snapshot.sourceValue,
    };
  });
  const itemProgressValues = prepared.itemProgress.map((entry) => {
    const period = periodByIndex.get(entry.periodIndex);
    const boqItemId = revision.itemIdByRow.get(entry.row);
    if (!period || !boqItemId) {
      throw new ProjectWorkbookError(
        `Imported item progress could not be attached at period ${entry.periodIndex}.`,
        "invalid",
      );
    }
    return {
      id: crypto.randomUUID(),
      projectId,
      periodId: period.id,
      boqItemId,
      cumulativeQuantity: entry.cumulativeQuantity.toFixed(BOQ_NUMERIC_SCALE),
      cumulativePercent: null,
      pctComplete: entry.pctComplete.toFixed(4),
      noProgress: false,
      note: null,
      recordedById: input.actor.id,
    };
  });
  const latestActual = prepared.actualSnapshots.at(-1);
  const dataDate = latestActual
    ? (periodByIndex.get(latestActual.periodIndex)?.endDate ?? null)
    : null;

  await runBatch([
    db.insert(project).values({
      id: projectId,
      companyId: input.companyId,
      code,
      name: confirmed.project.name,
      client: confirmed.project.client,
      location: confirmed.project.location,
      startDate: confirmed.project.startDate,
      endDate: confirmed.project.endDate,
      scheduleStart: confirmed.project.scheduleStart ?? confirmed.project.startDate,
      dataDate,
      periodType: confirmed.project.periodType,
      periodLengthDays: confirmed.project.periodLengthDays,
      status: "planning",
      progress: 0,
    }),
    ...(membershipIds.length > 0
      ? [
          db
            .insert(projectMember)
            .values(membershipIds.map((userId) => ({ projectId, userId })))
            .onConflictDoNothing(),
        ]
      : []),
    db.insert(reportingPeriod).values(periods),
    ...revision.statements,
    ...(itemProgressValues.length > 0
      ? [db.insert(progressEntry).values(itemProgressValues)]
      : []),
    ...(actualCurveValues.length > 0
      ? [db.insert(projectActualCurve).values(actualCurveValues)]
      : []),
  ]);

  return { projectId, ...revision.result, periodCount: periods.length };
}
