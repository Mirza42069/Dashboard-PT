import { runBatch } from "@DashboardV2/api/lib/batch";
import { projectMembershipIds } from "@DashboardV2/api/lib/project-manager";
import type { Role } from "@DashboardV2/api/lib/permissions";
import { db } from "@DashboardV2/db";
import {
  project,
  projectActualCurve,
  projectMember,
  reportingPeriod,
} from "@DashboardV2/db/schema";
import { and, eq } from "drizzle-orm";

import { prepareBoqRevision } from "./boq-import";
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
  const periods = prepared.periods.map((period) => ({
    id: crypto.randomUUID(),
    projectId,
    ...period,
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
      mapping: prepared.plan.mapping,
      profile: prepared.plan.profile,
      sectionRows: prepared.plan.sectionRows,
      excludedRows: prepared.plan.excludedRows,
      userExcludedRows: prepared.plan.userExcludedRows,
      parentAssignments: prepared.plan.parentAssignments,
      actualCurve: prepared.plan.actualCurve,
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
      sourceSheetName: prepared.plan.sheetName,
      sourceRow: snapshot.sourceRow,
      sourceColumn: snapshot.sourceColumn,
      sourceValue: snapshot.sourceValue,
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
    ...(actualCurveValues.length > 0
      ? [db.insert(projectActualCurve).values(actualCurveValues)]
      : []),
  ]);

  return { projectId, ...revision.result, periodCount: periods.length };
}
