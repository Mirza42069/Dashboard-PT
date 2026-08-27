import { runBatch } from "@DashboardV2/api/lib/batch";
import { computeActualCurve } from "@DashboardV2/api/lib/curves";
import { db } from "@DashboardV2/db";
import {
  boqImport,
  boqItem,
  boqVersion,
  progressEntry,
  project,
  projectActualCurve,
  reportingPeriod,
} from "@DashboardV2/db/schema";
import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";

import { prepareBoqRevision } from "./boq-import";
import { relevantProjectStateChanged } from "./project-workbook-review";
import {
  prepareConfirmedWorkbook,
  projectWorkbookCommitSchema,
  ProjectWorkbookError,
  reviewProjectWorkbook,
  validateWorkbookCalendar,
  workbookPlanSchema,
  type ProjectWorkbookCommit,
} from "./project-workbook";

export type ProjectWorkbookUpdateSections = {
  projectDetails: boolean;
  boq: boolean;
  schedule: boolean;
  progress: boolean;
};

export type CommitProjectWorkbookUpdateInput = {
  bytes: Uint8Array;
  filename: string;
  projectId: string;
  companyId: string;
  selectedSheetName: string;
  plan: unknown;
  sections: ProjectWorkbookUpdateSections;
  confirmed?: Partial<ProjectWorkbookCommit["project"]>;
  reviewState: unknown;
  actor: { id: string; name: string };
};

type SectionName = keyof ProjectWorkbookUpdateSections;

const confirmedProjectSchema = projectWorkbookCommitSchema.shape.project;
const projectDetailsSchema = z.object({
  code: confirmedProjectSchema.shape.code,
  name: confirmedProjectSchema.shape.name,
  client: confirmedProjectSchema.shape.client,
  location: confirmedProjectSchema.shape.location,
});
const reviewStateSchema = z.object({
  project: z.object({
    code: z.string(),
    name: z.string(),
    client: z.string().nullable(),
    location: z.string().nullable(),
    startDate: z.string().nullable(),
    scheduleStart: z.string().nullable(),
    endDate: z.string().nullable(),
    periodType: z.string(),
    periodLengthDays: z.number().int().nullable(),
  }),
  existingActualSnapshots: z.array(
    z.object({
      periodIndex: z.number().int().positive(),
      cumulativePercent: z.number().min(0).max(100),
    }),
  ),
  activeVersionId: z.string().nullable(),
  progressEntryCount: z.number().int().nonnegative(),
  latestProgressUpdatedAt: z.iso.datetime().nullable(),
});

function invalid(message: string, code: string | null = null): never {
  throw new ProjectWorkbookError(message, "invalid", [], code);
}

function parseOrInvalid<T>(result: z.ZodSafeParseResult<T>): T {
  if (result.success) return result.data;
  invalid(result.error.issues[0]?.message ?? "The confirmed project details are invalid.");
}

function warningText(error: { row: number; column: string | null; message: string }) {
  return `Row ${error.row}${error.column ? `, column ${error.column}` : ""}: ${error.message}`;
}

function databaseCode(error: unknown) {
  if (!error || typeof error !== "object") return "";
  if ("code" in error) return String((error as { code?: unknown }).code ?? "");
  if ("cause" in error) {
    const cause = (error as { cause?: unknown }).cause;
    if (cause && typeof cause === "object" && "code" in cause) {
      return String((cause as { code?: unknown }).code ?? "");
    }
  }
  return "";
}

function isDivisionByZero(error: unknown) {
  const message =
    error instanceof Error
      ? `${error.message} ${error.cause instanceof Error ? error.cause.message : ""}`
      : "";
  return message.toLowerCase().includes("division by zero");
}

export async function commitProjectWorkbookUpdate(input: CommitProjectWorkbookUpdateInput) {
  if (!Object.values(input.sections).some(Boolean)) {
    invalid("Select at least one project section to update.", "section_required");
  }
  const reviewState = parseOrInvalid(reviewStateSchema.safeParse(input.reviewState));

  const [current] = await db
    .select({
      id: project.id,
      code: project.code,
      name: project.name,
      client: project.client,
      location: project.location,
      startDate: project.startDate,
      scheduleStart: project.scheduleStart,
      endDate: project.endDate,
      periodType: project.periodType,
      periodLengthDays: project.periodLengthDays,
    })
    .from(project)
    .where(and(eq(project.id, input.projectId), eq(project.companyId, input.companyId)))
    .limit(1);
  if (!current) {
    throw new ProjectWorkbookError(
      "The project was not found in this company.",
      "conflict",
      [],
      "project_not_found",
    );
  }

  const submittedPlan = workbookPlanSchema.parse(input.plan);
  if (submittedPlan.sheetName !== input.selectedSheetName) {
    invalid("The selected worksheet no longer matches the reviewed import plan.", "sheet_mismatch");
  }

  const [analysis, periods, versions, existingSnapshots] = await Promise.all([
    reviewProjectWorkbook(input.bytes, submittedPlan),
    db
      .select({
        id: reportingPeriod.id,
        periodIndex: reportingPeriod.periodIndex,
        label: reportingPeriod.label,
        startDate: reportingPeriod.startDate,
        endDate: reportingPeriod.endDate,
      })
      .from(reportingPeriod)
      .where(eq(reportingPeriod.projectId, input.projectId))
      .orderBy(asc(reportingPeriod.periodIndex)),
    db
      .select({ id: boqVersion.id, versionNo: boqVersion.versionNo, status: boqVersion.status })
      .from(boqVersion)
      .where(eq(boqVersion.projectId, input.projectId))
      .orderBy(desc(boqVersion.versionNo)),
    db
      .select({
        periodId: projectActualCurve.periodId,
        periodIndex: reportingPeriod.periodIndex,
        cumulativePercent: projectActualCurve.cumulativePercent,
      })
      .from(projectActualCurve)
      .innerJoin(reportingPeriod, eq(reportingPeriod.id, projectActualCurve.periodId))
      .where(eq(projectActualCurve.projectId, input.projectId)),
  ]);

  const importsBoqAndSchedule = input.sections.boq || input.sections.schedule;
  const existingDraft = versions.find((version) => version.status === "draft");
  const activeVersion = versions.find((version) => version.status === "active") ?? null;
  if (relevantProjectStateChanged(current, reviewState.project, input.sections)) {
    invalid("The project changed after this workbook was reviewed. Analyze it again.", "review_stale");
  }
  if (input.sections.progress) {
    const reviewedActuals = reviewState.existingActualSnapshots
      .map((snapshot) => ({
        periodIndex: snapshot.periodIndex,
        cumulativePercent: snapshot.cumulativePercent.toFixed(6),
      }))
      .sort((a, b) => a.periodIndex - b.periodIndex);
    const currentActuals = existingSnapshots
      .map((snapshot) => ({
        periodIndex: snapshot.periodIndex,
        cumulativePercent: Number(snapshot.cumulativePercent).toFixed(6),
      }))
      .sort((a, b) => a.periodIndex - b.periodIndex);
    if (
      activeVersion?.id !== reviewState.activeVersionId ||
      JSON.stringify(currentActuals) !== JSON.stringify(reviewedActuals)
    ) {
      invalid("Progress changed after this workbook was reviewed. Analyze it again.", "review_stale");
    }
  }
  if (importsBoqAndSchedule && existingDraft) {
    throw new ProjectWorkbookError(
      `Rev ${existingDraft.versionNo} is already open as a draft. Activate or discard it before importing.`,
      "conflict",
      [],
      "draft_exists",
    );
  }

  const details = input.sections.projectDetails
    ? parseOrInvalid(
        projectDetailsSchema.safeParse({
          code: input.confirmed?.code ?? analysis.plan.suggestedCode ?? current.code,
          name: input.confirmed?.name ?? analysis.plan.suggestedName ?? current.name,
          client:
            input.confirmed?.client !== undefined
              ? input.confirmed.client
              : (analysis.plan.suggestedClient ?? current.client),
          location:
            input.confirmed?.location !== undefined
              ? input.confirmed.location
              : (analysis.plan.suggestedLocation ?? current.location),
        }),
      )
    : {
        code: current.code,
        name: current.name,
        client: current.client,
        location: current.location,
      };
  const normalizedDetails = { ...details, code: details.code.toUpperCase() };

  if (input.sections.projectDetails) {
    const [duplicate] = await db
      .select({ id: project.id })
      .from(project)
      .where(
        and(
          eq(project.companyId, input.companyId),
          eq(project.code, normalizedDetails.code),
          ne(project.id, input.projectId),
        ),
      )
      .limit(1);
    if (duplicate) {
      throw new ProjectWorkbookError(
        `Project code ${normalizedDetails.code} is already in use.`,
        "conflict",
        [],
        "project_code_conflict",
      );
    }
  }

  const confirmedProject = {
    ...(input.sections.projectDetails
      ? normalizedDetails
      : {
          code: current.code,
          name: current.name,
          client: current.client,
          location: current.location,
        }),
    startDate: current.startDate,
    scheduleStart: current.scheduleStart,
    endDate: current.endDate,
    periodType: current.periodType,
    periodLengthDays: current.periodLengthDays,
  };

  let prepared: Awaited<ReturnType<typeof prepareConfirmedWorkbook>> | null = null;
  let workbookPeriods: Awaited<ReturnType<typeof validateWorkbookCalendar>>["generated"] | null = null;
  if (importsBoqAndSchedule) {
    const confirmed = parseOrInvalid(
      projectWorkbookCommitSchema.safeParse({ plan: analysis.plan, project: confirmedProject }),
    );
    prepared = await prepareConfirmedWorkbook(input.bytes, confirmed);
    workbookPeriods = prepared.periods;
  } else if (input.sections.progress) {
    const projectCalendar = parseOrInvalid(
      projectWorkbookCommitSchema.shape.project.safeParse(confirmedProject),
    );
    workbookPeriods = (
      await validateWorkbookCalendar(input.bytes, analysis.plan, projectCalendar)
    ).generated;
  }

  if (workbookPeriods) {
    const samePeriods =
      workbookPeriods.length === periods.length &&
      workbookPeriods.every((generated, index) => {
        const existing = periods[index];
        return (
          existing !== undefined &&
          generated.periodIndex === existing.periodIndex &&
          generated.label === existing.label &&
          generated.startDate === existing.startDate &&
          generated.endDate === existing.endDate
        );
      });
    if (!samePeriods) {
      invalid(
        "The workbook calendar does not exactly match the project's reporting periods.",
        "reporting_period_mismatch",
      );
    }
  }

  const snapshots = input.sections.progress
    ? (prepared?.actualSnapshots ?? analysis.actualSnapshots)
    : [];
  if (input.sections.progress && snapshots.length === 0) {
    invalid("The selected worksheet has no valid actual progress snapshots.", "actual_required");
  }

  const periodByIndex = new Map(periods.map((period) => [period.periodIndex, period]));
  for (const snapshot of snapshots) {
    if (!periodByIndex.has(snapshot.periodIndex)) {
      invalid(
        `The workbook actual curve references missing reporting period ${snapshot.periodIndex}.`,
        "reporting_period_missing",
      );
    }
  }
  let progressState: { count: number; latestUpdatedAt: Date | null } = {
    count: 0,
    latestUpdatedAt: null,
  };
  if (input.sections.progress) {
    const merged = new Map(
      existingSnapshots.map((snapshot) => [
        snapshot.periodIndex,
        Number(snapshot.cumulativePercent),
      ]),
    );
    for (const snapshot of snapshots) merged.set(snapshot.periodIndex, snapshot.cumulativePercent);
    let previous = -1;
    for (const [periodIndex, value] of [...merged.entries()].sort((a, b) => a[0] - b[0])) {
      if (value < previous) {
        invalid(
          `The imported progress would make cumulative progress decrease at period ${periodIndex}. Remove or correct the later stored snapshot first.`,
          "actual_curve_decrease",
        );
      }
      previous = value;
    }

    if (activeVersion) {
      const [leaves, entries] = await Promise.all([
        db
          .select({ id: boqItem.id, weight: boqItem.weight })
          .from(boqItem)
          .where(
            and(
              eq(boqItem.boqVersionId, activeVersion.id),
              isNull(boqItem.deletedAt),
              sql`not exists (
                select 1 from boq_item child
                where child.parent_id = ${boqItem.id} and child.deleted_at is null
              )`,
            ),
          ),
        db
          .select({
            boqItemId: progressEntry.boqItemId,
            periodId: progressEntry.periodId,
            pctComplete: progressEntry.pctComplete,
            cumulativeQuantity: progressEntry.cumulativeQuantity,
            cumulativePercent: progressEntry.cumulativePercent,
            updatedAt: progressEntry.updatedAt,
          })
          .from(progressEntry)
          .innerJoin(boqItem, eq(boqItem.id, progressEntry.boqItemId))
          .where(eq(boqItem.boqVersionId, activeVersion.id)),
      ]);
      progressState = {
        count: entries.length,
        latestUpdatedAt:
          entries.reduce<Date | null>(
            (latest, entry) =>
              latest === null || entry.updatedAt > latest ? entry.updatedAt : latest,
            null,
          ),
      };
      if (
        progressState.count !== reviewState.progressEntryCount ||
        (progressState.latestUpdatedAt?.toISOString() ?? null) !==
          reviewState.latestProgressUpdatedAt
      ) {
        invalid("Item progress changed after this workbook was reviewed. Analyze it again.", "review_stale");
      }
      const curveRows = leaves.map((leaf) => ({
        leaf: { id: leaf.id, weight: Number(leaf.weight) },
      }));
      const curvePeriods = periods.map((period) => ({ id: period.id, endDate: period.endDate }));
      const curveEntries = entries.map((entry) => ({
        boqItemId: entry.boqItemId,
        periodId: entry.periodId,
        pctComplete: Number(entry.pctComplete),
        cumulativeQuantity:
          entry.cumulativeQuantity === null ? null : Number(entry.cumulativeQuantity),
        cumulativePercent:
          entry.cumulativePercent === null ? null : Number(entry.cumulativePercent),
      }));
      const mergedSnapshots = new Map(
        existingSnapshots.map((snapshot) => [
          snapshot.periodId,
          Number(snapshot.cumulativePercent),
        ]),
      );
      for (const snapshot of snapshots) {
        mergedSnapshots.set(periodByIndex.get(snapshot.periodIndex)!.id, snapshot.cumulativePercent);
      }
      const nextCurve = computeActualCurve(
        curveRows,
        curvePeriods,
        curveEntries,
        null,
        [...mergedSnapshots].map(([periodId, cumulativePercent]) => ({
          periodId,
          cumulativePercent,
        })),
      ).cumulative;
      for (let index = 1; index < nextCurve.length; index++) {
        const previousNext = nextCurve[index - 1];
        const next = nextCurve[index];
        if (previousNext == null || next == null) continue;
        const nextDrop = previousNext - next;
        if (nextDrop > 0.000001) {
          invalid(
            `The imported progress would make cumulative progress decrease at period ${periods[index]!.periodIndex}.`,
            "actual_curve_decrease",
          );
        }
      }
    }
  }

  const latestVersionNo = versions[0]?.versionNo ?? 0;
  const effectiveSections: ProjectWorkbookUpdateSections = {
    ...input.sections,
    boq: importsBoqAndSchedule,
    schedule: importsBoqAndSchedule,
  };
  const projectDetailsAudit = input.sections.projectDetails
    ? {
        before: {
          code: current.code,
          name: current.name,
          client: current.client,
          location: current.location,
        },
        after: normalizedDetails,
      }
    : null;
  const mappingAudit = {
    operation: "project_workbook_update",
    requestedSections: input.sections,
    importedSections: effectiveSections,
    mapping: analysis.plan.mapping,
    profile: analysis.plan.profile,
    sectionRows: analysis.plan.sectionRows,
    excludedRows: analysis.plan.excludedRows,
    userExcludedRows: analysis.plan.userExcludedRows,
    parentAssignments: analysis.plan.parentAssignments,
    actualCurve: analysis.plan.actualCurve,
    projectDetails: projectDetailsAudit,
  };

  const sourceItems =
    prepared && activeVersion
      ? await db
          .select({
            id: boqItem.id,
            parentId: boqItem.parentId,
            code: boqItem.code,
            description: boqItem.description,
            lineageId: boqItem.lineageId,
            progressMode: boqItem.progressMode,
          })
          .from(boqItem)
          .where(and(eq(boqItem.boqVersionId, activeVersion.id), isNull(boqItem.deletedAt)))
      : [];
  const revision = prepared
    ? prepareBoqRevision({
        projectId: input.projectId,
        rows: prepared.rows,
        periods,
        versionNo: latestVersionNo + 1,
        filename: input.filename,
        sheetName: prepared.plan.sheetName,
        mapping: prepared.plan.mapping,
        mappingAudit,
        actor: input.actor,
        sourceVersionId: activeVersion?.id,
        sourceItems,
      })
    : null;
  const updateImportId = revision?.result.importId ?? crypto.randomUUID();
  const actualCurveValues = snapshots.map((snapshot) => ({
    projectId: input.projectId,
    periodId: periodByIndex.get(snapshot.periodIndex)!.id,
    boqImportId: updateImportId,
    cumulativePercent: snapshot.cumulativePercent.toFixed(6),
    sourceFilename: input.filename,
    sourceSheetName: analysis.plan.sheetName,
    sourceRow: snapshot.sourceRow,
    sourceColumn: snapshot.sourceColumn,
    sourceValue: snapshot.sourceValue,
  }));

  const periodState = periods.map((period) => ({
    id: period.id,
    periodIndex: period.periodIndex,
    label: period.label,
    startDate: period.startDate,
    endDate: period.endDate,
  }));
  const actualSnapshotState = existingSnapshots
    .map((snapshot) => ({
      periodId: snapshot.periodId,
      cumulativePercent: snapshot.cumulativePercent,
    }))
    .sort((a, b) => a.periodId.localeCompare(b.periodId));
  const statements: Parameters<typeof runBatch>[0] = [
    db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.projectId}, 0))`),
    db.execute(sql`
      select 1 / case when exists (
        select 1 from project
        where id = ${input.projectId} and company_id = ${input.companyId} and archived_at is null
      ) then 1 else 0 end
    `),
  ];

  if (importsBoqAndSchedule || input.sections.progress) {
    statements.push(
      db.execute(sql`
        select 1 / case when coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', id,
            'periodIndex', period_index,
            'label', label,
            'startDate', start_date,
            'endDate', end_date
          ) order by period_index)
          from reporting_period where project_id = ${input.projectId}
        ), '[]'::jsonb) = ${JSON.stringify(periodState)}::jsonb
        and exists (
          select 1 from project
          where id = ${input.projectId}
            and start_date is not distinct from ${current.startDate}
            and schedule_start is not distinct from ${current.scheduleStart}
            and end_date is not distinct from ${current.endDate}
            and period_type is not distinct from ${current.periodType}
            and period_length_days is not distinct from ${current.periodLengthDays}
        ) then 1 else 0 end
      `),
    );
  }

  if (input.sections.progress) {
    statements.push(
      db.execute(sql`
        select 1 / case when coalesce((
          select jsonb_agg(jsonb_build_object(
            'periodId', period_id,
            'cumulativePercent', cumulative_percent::text
          ) order by period_id)
          from project_actual_curve where project_id = ${input.projectId}
        ), '[]'::jsonb) = ${JSON.stringify(actualSnapshotState)}::jsonb then 1 else 0 end
      `),
      db.execute(sql`
        select 1 / case when (
          select count(*)::int
          from progress_entry entry
          join boq_item item on item.id = entry.boq_item_id
          where item.boq_version_id = ${activeVersion?.id ?? null}
        ) = ${progressState.count}
        and date_trunc('milliseconds', (
          select max(entry.updated_at)
          from progress_entry entry
          join boq_item item on item.id = entry.boq_item_id
          where item.boq_version_id = ${activeVersion?.id ?? null}
        )) is not distinct from ${progressState.latestUpdatedAt}
        then 1 else 0 end
      `),
    );
  }

  if (importsBoqAndSchedule) {
    statements.push(
      db.execute(sql`
        select 1 / case when
          not exists (
            select 1 from boq_version
            where project_id = ${input.projectId} and status = 'draft'
          )
          and coalesce((
            select max(version_no) from boq_version where project_id = ${input.projectId}
          ), 0) = ${latestVersionNo}
        then 1 else 0 end
      `),
    );
  } else if (input.sections.progress) {
    statements.push(
      db.execute(sql`
        select 1 / case when (
          select id from boq_version
          where project_id = ${input.projectId} and status = 'active'
          limit 1
        ) is not distinct from ${activeVersion?.id ?? null} then 1 else 0 end
      `),
    );
  }

  if (input.sections.projectDetails) {
    statements.push(
      db.execute(sql`
        with changed as (
          update project set
            code = ${normalizedDetails.code},
            name = ${normalizedDetails.name},
            client = ${normalizedDetails.client},
            location = ${normalizedDetails.location},
            updated_at = now()
          where id = ${input.projectId}
            and company_id = ${input.companyId}
            and code = ${reviewState.project.code}
            and name = ${reviewState.project.name}
            and client is not distinct from ${reviewState.project.client}
            and location is not distinct from ${reviewState.project.location}
            and not exists (
              select 1 from project duplicate
              where duplicate.company_id = ${input.companyId}
                and duplicate.code = ${normalizedDetails.code}
                and duplicate.id <> ${input.projectId}
            )
          returning id
        )
        select 1 / case when exists (select 1 from changed) then 1 else 0 end
      `),
    );
  }

  if (revision) statements.push(...revision.statements);

  if (!revision) {
    statements.push(
      db.insert(boqImport).values({
        id: updateImportId,
        projectId: input.projectId,
        boqVersionId: activeVersion?.id ?? null,
        filename: input.filename,
        sheetName: analysis.plan.sheetName,
        importedById: input.actor.id,
        importedByName: input.actor.name,
        mapping: JSON.stringify(mappingAudit),
        status: "succeeded",
        rowsTotal: snapshots.length,
        rowsImported: snapshots.length,
        errorCount: 0,
      }),
    );
  }

  if (input.sections.progress) {
    const replacedPeriodIds = actualCurveValues.map((value) => value.periodId);
    statements.push(
      db
        .delete(projectActualCurve)
        .where(
          and(
            eq(projectActualCurve.projectId, input.projectId),
            inArray(projectActualCurve.periodId, replacedPeriodIds),
          ),
        ),
    );
    if (actualCurveValues.length > 0) {
      statements.push(db.insert(projectActualCurve).values(actualCurveValues));
    }
    statements.push(
      db
        .update(project)
        .set({
          dataDate: sql`(
            select max(period.end_date)
            from reporting_period period
            where period.project_id = ${input.projectId}
              and (
                exists (
                  select 1 from progress_entry entry
                  where entry.period_id = period.id
                    and (
                      entry.cumulative_percent is not null
                      or entry.cumulative_quantity is not null
                    )
                )
                or exists (
                  select 1 from project_actual_curve snapshot
                  where snapshot.project_id = ${input.projectId}
                    and snapshot.period_id = period.id
                )
              )
          )`,
        })
        .where(and(eq(project.id, input.projectId), eq(project.companyId, input.companyId))),
    );
  }

  try {
    await runBatch(statements);
  } catch (error) {
    if (databaseCode(error) === "23505" && input.sections.projectDetails) {
      throw new ProjectWorkbookError(
        `Project code ${normalizedDetails.code} is already in use.`,
        "conflict",
        [],
        "project_code_conflict",
      );
    }
    if (isDivisionByZero(error)) {
      throw new ProjectWorkbookError(
        "The project changed while the workbook update was being prepared. Refresh and try again.",
        "conflict",
        [],
        "project_update_conflict",
      );
    }
    throw error;
  }

  const sectionsUpdated = (Object.keys(effectiveSections) as SectionName[]).filter(
    (section) => effectiveSections[section],
  );
  const warnings = [
    ...analysis.plan.warnings,
    ...(!importsBoqAndSchedule ? analysis.summary.validationErrors.map(warningText) : []),
  ];

  return {
    sectionsUpdated,
    rowsImported: revision?.result.rowsImported ?? 0,
    periodCount: periods.length,
    actualSnapshotCount: snapshots.length,
    draftVersionId: revision?.result.versionId ?? null,
    versionNo: revision?.result.versionNo ?? null,
    warnings: [...new Set(warnings)],
  };
}
