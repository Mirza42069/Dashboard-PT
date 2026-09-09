import { runBatch } from "@DashboardV2/api/lib/batch";
import { computeActualCurve } from "@DashboardV2/api/lib/curves";
import { db } from "@DashboardV2/db";
import {
  boqImport,
  boqItem,
  boqVersion,
  dailyProgressItem,
  dailyProgressSnapshot,
  progressEntry,
  project,
  projectActualCurve,
  reportingPeriod,
} from "@DashboardV2/db/schema";
import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";

import { prepareBoqRevision } from "./boq-import";
import { BOQ_NUMERIC_SCALE, loadWorkbook } from "./boq-import-parse";
import { aggregateDailyProgress } from "./project-daily-aggregation";
import type { WeeklyItemProgress } from "./project-weekly-progress";
import {
  parseDailyProgressWorkbook,
  type ParsedDailyProgressSnapshot,
} from "./project-daily-progress";
import {
  hasValidWorkbookReviewStateSignature,
  pdfCalendarDifferences,
  relevantProjectStateChanged,
} from "./project-workbook-review";
import {
  prepareConfirmedWorkbook,
  projectWorkbookCommitSchema,
  ProjectWorkbookError,
  reviewProjectWorkbook,
  validateWorkbookCalendar,
  workbookPlanSchema,
  type ProjectWorkbookCommit,
} from "./project-workbook";
import {
  parsePdfDailyProgress,
  resolvePdfProgressPeriod,
} from "./project-pdf-progress";

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
  selectedSheetName: string | null;
  plan: unknown;
  sections: ProjectWorkbookUpdateSections;
  confirmed?: Partial<ProjectWorkbookCommit["project"]>;
  confirmedProgressDate?: string;
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
  signature: z.string().regex(/^[a-f0-9]{64}$/),
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

function chunks<T>(values: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

type ItemReading = {
  boqItemId: string;
  periodId: string;
  pctComplete: number;
  cumulativeQuantity: number | null;
  cumulativePercent: number | null;
};

// Compare at database precision, and keep identical stored readings untouched.
export function reconcileWorkbookItemReadings(
  existing: readonly ItemReading[],
  incoming: readonly ItemReading[],
  periods: readonly { id: string; periodIndex: number }[],
) {
  const periodIndexes = new Map(periods.map((period) => [period.id, period.periodIndex]));
  const readings = new Map<string, Map<string, ItemReading>>();
  for (const entry of existing) {
    const item = readings.get(entry.boqItemId) ?? new Map<string, ItemReading>();
    item.set(entry.periodId, entry);
    readings.set(entry.boqItemId, item);
  }
  const additions: ItemReading[] = [];
  for (const entry of incoming) {
    if (!periodIndexes.has(entry.periodId) || !Number.isFinite(entry.pctComplete) ||
      entry.pctComplete < 0 || entry.pctComplete > 100 ||
      (entry.cumulativeQuantity === null && entry.cumulativePercent === null)) {
      invalid("Imported item progress contains an invalid reading or reporting period.", "item_progress_invalid");
    }
    const item = readings.get(entry.boqItemId) ?? new Map<string, ItemReading>();
    const stored = item.get(entry.periodId);
    if (stored) {
      if (
        (stored.cumulativeQuantity === null && stored.cumulativePercent === null) ||
        stored.pctComplete.toFixed(4) !== entry.pctComplete.toFixed(4) ||
        (stored.cumulativePercent !== null && entry.cumulativePercent !== null &&
          stored.cumulativePercent.toFixed(4) !== entry.cumulativePercent.toFixed(4)) ||
        (stored.cumulativeQuantity !== null && entry.cumulativeQuantity !== null &&
          stored.cumulativeQuantity.toFixed(BOQ_NUMERIC_SCALE) !==
            entry.cumulativeQuantity.toFixed(BOQ_NUMERIC_SCALE))
      ) {
        invalid(
          `Imported item progress conflicts with an existing reading for item ${entry.boqItemId} at period ${periodIndexes.get(entry.periodId)}. Correct the stored reading first.`,
          "item_progress_conflict",
        );
      }
      continue;
    }
    item.set(entry.periodId, entry);
    readings.set(entry.boqItemId, item);
    additions.push(entry);
  }
  for (const itemId of new Set(incoming.map((entry) => entry.boqItemId))) {
    let previous: ItemReading | undefined;
    for (const entry of [...readings.get(itemId)!.values()].sort(
      (a, b) => periodIndexes.get(a.periodId)! - periodIndexes.get(b.periodId)!,
    )) {
      if (entry.cumulativeQuantity === null && entry.cumulativePercent === null) continue;
      if (previous && (
        Number(entry.pctComplete.toFixed(4)) < Number(previous.pctComplete.toFixed(4)) ||
        (entry.cumulativeQuantity !== null && previous.cumulativeQuantity !== null &&
          Number(entry.cumulativeQuantity.toFixed(BOQ_NUMERIC_SCALE)) <
            Number(previous.cumulativeQuantity.toFixed(BOQ_NUMERIC_SCALE)))
      )) {
        invalid(
          `Imported item progress would decrease for item ${itemId} at period ${periodIndexes.get(entry.periodId)}. Correct the stored readings first.`,
          "item_progress_decrease",
        );
      }
      previous = entry;
    }
  }
  return additions;
}

export async function commitProjectWorkbookUpdate(input: CommitProjectWorkbookUpdateInput) {
  if (!Object.values(input.sections).some(Boolean)) {
    invalid("Select at least one project section to update.", "section_required");
  }
  const submittedPlan = workbookPlanSchema.parse(input.plan);
  const signedReviewState = parseOrInvalid(reviewStateSchema.safeParse(input.reviewState));
  const { signature: reviewStateSignature, ...reviewState } = signedReviewState;
  if (
    !hasValidWorkbookReviewStateSignature(
      input.projectId,
      submittedPlan.analysisSignature,
      reviewState,
      reviewStateSignature,
    )
  ) {
    invalid("The reviewed project state is invalid. Analyze the source file again.", "review_invalid");
  }

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

  if (
    submittedPlan.profile !== "pdf-ai" &&
    submittedPlan.sheetName !== input.selectedSheetName &&
    !(
      submittedPlan.dailyProgress &&
      (input.selectedSheetName === null ||
        submittedPlan.dailyProgress.sheets.some(
          (sheet) => sheet.sheetName === input.selectedSheetName,
        ))
    )
  ) {
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
        status: reportingPeriod.status,
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
  if (
    analysis.plan.weeklyProgress &&
    (input.sections.projectDetails || importsBoqAndSchedule)
  ) {
    invalid(
      "Multi-sheet weekly reports can create a project, but can only add aggregate progress to an existing project.",
      "weekly_progress_create_only",
    );
  }
  if (
    (importsBoqAndSchedule || input.sections.progress) &&
    analysis.plan.profile === "pdf-ai" &&
    analysis.plan.pdf
  ) {
    const differences = pdfCalendarDifferences(current, {
      startDate: analysis.plan.pdf.extraction.startDate,
      scheduleStartDate: analysis.plan.pdf.extraction.scheduleStartDate,
      endDate: analysis.plan.pdf.extraction.endDate,
      periodType: analysis.plan.pdf.extraction.periodType,
    });
    if (differences.length > 0) {
      invalid(
        `The PDF reporting calendar does not match the project (${differences.join(", ")}).`,
        "reporting_period_mismatch",
      );
    }
  }
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
  let dailyProgress: ParsedDailyProgressSnapshot[] = [];
  let workbookPeriods: Awaited<ReturnType<typeof validateWorkbookCalendar>>["generated"] | null = null;
  const pdfProgress = analysis.plan.pdf
    ? parsePdfDailyProgress(analysis.plan.pdf.extraction)
    : null;
  if (input.sections.progress && pdfProgress) {
    if (pdfProgress.errors.length > 0) {
      throw new ProjectWorkbookError(
        "The detailed PDF progress report needs attention.",
        "invalid",
        pdfProgress.errors.slice(0, 100),
      );
    }
    const resolvedProgress = resolvePdfProgressPeriod(
      pdfProgress.reportDate,
      input.confirmedProgressDate,
      periods,
    );
    const reportDate = resolvedProgress.reportDate;
    if (!reportDate || !z.iso.date().safeParse(reportDate).success) {
      invalid(
        "Choose the date represented by this PDF progress report.",
        "progress_report_date_required",
      );
    }
    if (!resolvedProgress.period) {
      invalid(
        "The PDF progress report date is outside the project's reporting calendar.",
        "progress_report_date_outside_calendar",
      );
    }
    dailyProgress = [{
      reportDate,
      sourceSheetName: pdfProgress.sourceSheetName,
      cumulativePercent: pdfProgress.cumulativePercent,
      items: pdfProgress.items,
    }];
  }
  if (importsBoqAndSchedule) {
    const confirmed = parseOrInvalid(
      projectWorkbookCommitSchema.safeParse({ plan: analysis.plan, project: confirmedProject }),
    );
    prepared = await prepareConfirmedWorkbook(input.bytes, confirmed);
    if (input.sections.progress && dailyProgress.length === 0) {
      dailyProgress = prepared.dailyProgress;
    }
    workbookPeriods = prepared.periods;
  } else if (input.sections.progress) {
    if (dailyProgress.length === 0 && analysis.plan.dailyProgress) {
      const parsedDaily = parseDailyProgressWorkbook(
        await loadWorkbook(input.bytes),
        analysis.plan.dailyProgress,
      );
      if (!parsedDaily || parsedDaily.errors.length > 0) {
        throw new ProjectWorkbookError(
          "The dated progress worksheets need attention.",
          "invalid",
          parsedDaily?.errors.slice(0, 100) ?? [],
        );
      }
      dailyProgress = parsedDaily.snapshots;
    } else if (dailyProgress.length === 0) {
      const projectCalendar = parseOrInvalid(
        projectWorkbookCommitSchema.shape.project.safeParse(confirmedProject),
      );
      workbookPeriods = (
        await validateWorkbookCalendar(input.bytes, analysis.plan, projectCalendar)
      ).generated;
    }
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

  let snapshots = input.sections.progress
    ? (prepared?.actualSnapshots ?? analysis.actualSnapshots)
    : [];
  if (input.sections.progress && dailyProgress.length > 0) {
    const merged = new Map(snapshots.map((snapshot) => [snapshot.periodIndex, snapshot]));
    const latestDailyByPeriod = new Map<number, ParsedDailyProgressSnapshot>();
    for (const snapshot of dailyProgress) {
      const period = periods.find(
        (candidate) =>
          snapshot.reportDate >= candidate.startDate && snapshot.reportDate <= candidate.endDate,
      );
      if (!period) {
        invalid(
          `Daily progress date ${snapshot.reportDate} is outside the project reporting calendar.`,
          "daily_progress_date_outside_calendar",
        );
      }
      const latest = latestDailyByPeriod.get(period.periodIndex);
      if (!latest || snapshot.reportDate > latest.reportDate) {
        latestDailyByPeriod.set(period.periodIndex, snapshot);
      }
    }
    for (const [periodIndex, snapshot] of latestDailyByPeriod) {
      if (merged.has(periodIndex)) continue;
      merged.set(periodIndex, {
        periodIndex,
        cumulativePercent: snapshot.cumulativePercent,
        sourceRow:
          analysis.plan.dailyProgress?.dataEndRow ??
          analysis.plan.pdf?.extraction.progressReport?.grandTotal.sourceRow ??
          analysis.plan.dataEndRow,
        sourceColumn:
          analysis.plan.dailyProgress?.mapping.cumulativeWeighted ??
          analysis.plan.mapping.fields.weight ??
          1,
        sourceValue:
          analysis.plan.pdf?.extraction.progressReport?.grandTotal.sourceValue ??
          snapshot.cumulativePercent.toFixed(8),
        sourceLabel: snapshot.sourceSheetName,
      });
    }
    snapshots = [...merged.values()].sort((a, b) => a.periodIndex - b.periodIndex);
  }
  if (input.sections.progress && snapshots.length === 0) {
    invalid("The selected worksheet has no valid actual progress snapshots.", "actual_required");
  }

  const periodByIndex = new Map(periods.map((period) => [period.periodIndex, period]));
  const storedDaily = input.sections.progress && dailyProgress.length > 0
    ? await db.select({
        id: dailyProgressSnapshot.id,
        periodId: dailyProgressSnapshot.periodId,
        reportDate: dailyProgressSnapshot.reportDate,
      }).from(dailyProgressSnapshot)
        .where(eq(dailyProgressSnapshot.projectId, input.projectId))
        .orderBy(asc(dailyProgressSnapshot.id))
    : [];
  for (const stored of storedDaily) {
    const period = periods.find((candidate) => candidate.id === stored.periodId);
    const importedDates = dailyProgress.filter((snapshot) => period &&
      snapshot.reportDate >= period.startDate && snapshot.reportDate <= period.endDate);
    if (importedDates.length > 0 && importedDates.every(
      (snapshot) => snapshot.reportDate < stored.reportDate,
    )) {
      invalid(
        `A later daily report (${stored.reportDate}) is already stored for period ${period!.periodIndex}. Import the latest report instead.`,
        "daily_progress_backdated",
      );
    }
  }
  let itemProgress: WeeklyItemProgress[] = input.sections.progress
    ? [...(prepared?.itemProgress ?? [])]
    : [];
  const aggregationWarnings: string[] = [];
  if (input.sections.progress && prepared && dailyProgress.length > 0) {
    const parentCodes = new Set(prepared.rows.map((row) => row.parentCode).filter(Boolean));
    const aggregation = aggregateDailyProgress(
      prepared.rows.filter((row) => !parentCodes.has(row.code) && !prepared.plan.sectionRows.includes(row.row)),
      dailyProgress, periods, snapshots,
    );
    itemProgress = aggregation.entries;
    aggregationWarnings.push(...aggregation.warnings);
  }
  let itemReadings: ItemReading[] = [];
  const itemIdByRow = new Map<number, string>();
  const percentItemIds = new Set<string>();
  let activeLeafState: {
    id: string;
    description: string;
    weight: string;
    quantity: string | null;
    unitRate: string | null;
    progressMode: "by_quantity" | "by_percent";
  }[] = [];
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
          .select({
            id: boqItem.id,
            description: boqItem.description,
            weight: boqItem.weight,
            quantity: boqItem.quantity,
            unitRate: boqItem.unitRate,
            progressMode: boqItem.progressMode,
          })
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
      if (!importsBoqAndSchedule && dailyProgress.length > 0) {
        activeLeafState = [...leaves].sort((a, b) => a.id.localeCompare(b.id));
        const aggregation = aggregateDailyProgress(leaves.map((leaf, index) => {
          itemIdByRow.set(index + 1, leaf.id);
          return {
            row: index + 1,
            description: leaf.description,
            weight: Number(leaf.weight),
            quantity: leaf.quantity === null ? null : Number(leaf.quantity),
            unitRate: leaf.unitRate === null ? null : Number(leaf.unitRate),
          };
        }), dailyProgress, periods, snapshots);
        itemProgress = aggregation.entries;
        aggregationWarnings.push(...aggregation.warnings);
        const leavesById = new Map(leaves.map((leaf) => [leaf.id, leaf]));
        const incoming = itemProgress.map((entry) => {
          const boqItemId = itemIdByRow.get(entry.row)!;
          const leaf = leavesById.get(boqItemId)!;
          // Active modes must stay stable for manual saves already in flight.
          const byPercent = leaf.progressMode === "by_percent";
          if (!byPercent && (leaf.quantity === null || Number(leaf.quantity) <= 0)) {
            invalid("The active baseline needs a positive quantity before importing quantity-based progress.", "item_progress_invalid");
          }
          return {
            boqItemId,
            periodId: periodByIndex.get(entry.periodIndex)!.id,
            pctComplete: Number(entry.pctComplete.toFixed(4)),
            cumulativeQuantity: byPercent ? null : Number(entry.cumulativeQuantity.toFixed(BOQ_NUMERIC_SCALE)),
            cumulativePercent: byPercent ? Number(entry.pctComplete.toFixed(4)) : null,
          };
        });
        itemReadings = reconcileWorkbookItemReadings(curveEntries, incoming, periods);
        curveEntries.push(...itemReadings);
      }
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
        // Item readings are stored at four decimals, snapshots at six.
        if (nextDrop > (dailyProgress.length > 0 ? 0.0001 : 0.000001)) {
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
    sourceKind: analysis.plan.profile === "pdf-ai" ? "pdf" : "xlsx",
    requestedSections: input.sections,
    importedSections: effectiveSections,
    mapping: analysis.plan.mapping,
    profile: analysis.plan.profile,
    sectionRows: analysis.plan.sectionRows,
    excludedRows: analysis.plan.excludedRows,
    userExcludedRows: analysis.plan.userExcludedRows,
    parentAssignments: analysis.plan.parentAssignments,
    actualCurve: analysis.plan.actualCurve,
    itemProgress: {
      entries: itemProgress.map((entry) => ({ ...entry, boqItemId: itemIdByRow.get(entry.row) ?? null })),
      warnings: [...(prepared?.plan.warnings ?? []), ...aggregationWarnings],
    },
    dailyProgress:
      analysis.plan.dailyProgress == null
        ? null
        : {
            ...analysis.plan.dailyProgress,
            dates: dailyProgress.map((snapshot) => ({
              reportDate: snapshot.reportDate,
              cumulativePercent: snapshot.cumulativePercent,
              itemCount: snapshot.items.length,
            })),
          },
    pdf:
      analysis.plan.pdf === null
        ? null
        : {
            pageCount: analysis.plan.pdf.pageCount,
            extractionDigest: analysis.plan.pdf.extractionDigest,
            modelReportedMetadataSources: analysis.plan.pdf.extraction.metadataSources,
            modelReportedProgressReport: analysis.plan.pdf.extraction.progressReport,
            confirmedProgressDate:
              analysis.plan.pdf.extraction.progressReport === null
                ? null
                : (dailyProgress[0]?.reportDate ?? null),
            rowSources: analysis.plan.pdf.extraction.rows.map((row, index) => ({
              row: index + 2,
              page: row.page,
              table: row.table,
              sourceRow: row.sourceRow,
            })),
          },
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
  const revision = prepared && importsBoqAndSchedule
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
  if (revision && input.sections.progress) {
    const incoming = itemProgress.map((entry) => {
      const boqItemId = revision.itemIdByRow.get(entry.row);
      const period = periodByIndex.get(entry.periodIndex);
      if (!boqItemId || !period) {
        invalid(`Imported item progress could not be attached at period ${entry.periodIndex}.`, "item_progress_unmatched");
      }
      itemIdByRow.set(entry.row, boqItemId);
      if (dailyProgress.length > 0) percentItemIds.add(boqItemId);
      return {
        boqItemId,
        periodId: period.id,
        pctComplete: Number(entry.pctComplete.toFixed(4)),
        cumulativeQuantity: dailyProgress.length > 0 ? null : Number(entry.cumulativeQuantity.toFixed(BOQ_NUMERIC_SCALE)),
        cumulativePercent: dailyProgress.length > 0 ? Number(entry.pctComplete.toFixed(4)) : null,
      };
    });
    itemReadings = reconcileWorkbookItemReadings([], incoming, periods);
    const parentCodes = new Set(prepared!.rows.map((row) => row.parentCode).filter(Boolean));
    const curve = computeActualCurve(
      prepared!.rows.filter((row) => !parentCodes.has(row.code)).map((row) => ({
        leaf: { id: revision.itemIdByRow.get(row.row)!, weight: row.weight ?? 0 },
      })),
      periods,
      itemReadings,
      null,
      [...new Map([
        ...existingSnapshots.map((snapshot) => [snapshot.periodId, Number(snapshot.cumulativePercent)] as const),
        ...snapshots.map((snapshot) => [periodByIndex.get(snapshot.periodIndex)!.id, snapshot.cumulativePercent] as const),
      ])].map(([periodId, cumulativePercent]) => ({ periodId, cumulativePercent })),
    ).cumulative;
    for (let index = 1; index < curve.length; index++) {
      if (curve[index - 1] != null && curve[index] != null && curve[index - 1]! - curve[index]! > (dailyProgress.length > 0 ? 0.0001 : 0.000001)) {
        invalid(`The imported progress would make cumulative progress decrease at period ${periods[index]!.periodIndex}.`, "actual_curve_decrease");
      }
    }
  }
  const dailyVersionId = revision?.result.versionId ?? activeVersion?.id ?? null;
  if (dailyProgress.length > 0 && !dailyVersionId) {
    invalid("Activate a baseline before importing dated item progress.", "active_baseline_required");
  }
  const dailySnapshotValues = dailyProgress.map((snapshot) => {
    const period = periods.find(
      (candidate) =>
        snapshot.reportDate >= candidate.startDate && snapshot.reportDate <= candidate.endDate,
    );
    if (!period) {
      invalid(
        `Daily progress date ${snapshot.reportDate} is outside the project reporting calendar.`,
        "daily_progress_date_outside_calendar",
      );
    }
    return {
      id: crypto.randomUUID(),
      projectId: input.projectId,
      periodId: period.id,
      boqVersionId: dailyVersionId!,
      boqImportId: updateImportId,
      reportDate: snapshot.reportDate,
      cumulativePercent: snapshot.cumulativePercent.toFixed(6),
      sourceFilename: input.filename,
      sourceSheetName: snapshot.sourceSheetName,
      sourceHeaderRow: analysis.plan.dailyProgress?.headerRow ?? 1,
    };
  });
  const dailySnapshotIdByDate = new Map(
    dailySnapshotValues.map((snapshot) => [snapshot.reportDate, snapshot.id]),
  );
  const dailyItemValues = dailyProgress.flatMap((snapshot) =>
    snapshot.items.map((item) => ({
      id: crypto.randomUUID(),
      projectId: input.projectId,
      snapshotId: dailySnapshotIdByDate.get(snapshot.reportDate)!,
      sourceRow: item.sourceRow,
      code: item.code,
      description: item.description,
      sectionCode: item.sectionCode,
      sectionDescription: item.sectionDescription,
      parentCode: item.parentCode,
      parentDescription: item.parentDescription,
      unit: item.unit,
      quantity: item.quantity.toFixed(BOQ_NUMERIC_SCALE),
      unitRate: item.unitRate.toFixed(BOQ_NUMERIC_SCALE),
      amount: item.amount.toFixed(BOQ_NUMERIC_SCALE),
      weight: item.weight.toFixed(6),
      previousPercent: item.previousPercent.toFixed(6),
      currentPercent: item.currentPercent === null ? null : item.currentPercent.toFixed(6),
      cumulativePercent: item.cumulativePercent.toFixed(6),
      remainingPercent: item.remainingPercent.toFixed(6),
      previousWeighted: item.previousWeighted.toFixed(8),
      currentWeighted: item.currentWeighted === null ? null : item.currentWeighted.toFixed(8),
      cumulativeWeighted: item.cumulativeWeighted.toFixed(8),
      remainingWeighted: item.remainingWeighted.toFixed(8),
      remark: item.remark,
      sourceValues: item.sourceValues,
    })),
  );
  const actualCurveValues = snapshots.map((snapshot) => ({
    projectId: input.projectId,
    periodId: periodByIndex.get(snapshot.periodIndex)!.id,
    boqImportId: updateImportId,
    cumulativePercent: snapshot.cumulativePercent.toFixed(6),
    sourceFilename: input.filename,
    sourceSheetName: snapshot.sourceLabel ?? analysis.plan.sheetName,
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
      ...(!importsBoqAndSchedule && dailyProgress.length > 0 ? [db.execute(sql`
        select 1 / case when coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', item.id, 'description', item.description, 'weight', item.weight::text,
            'quantity', item.quantity::text, 'unitRate', item.unit_rate::text,
            'progressMode', item.progress_mode
          ) order by item.id)
          from boq_item item
          where item.boq_version_id = ${activeVersion?.id ?? null} and item.deleted_at is null
            and not exists (
              select 1 from boq_item child where child.parent_id = item.id and child.deleted_at is null
            )
        ), '[]'::jsonb) = ${JSON.stringify(activeLeafState)}::jsonb then 1 else 0 end
      `)] : []),
      ...(dailyProgress.length > 0 ? [db.execute(sql`
        select 1 / case when coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', id, 'periodId', period_id, 'reportDate', report_date
          ) order by id)
          from daily_progress_snapshot where project_id = ${input.projectId}
        ), '[]'::jsonb) = ${JSON.stringify(storedDaily)}::jsonb then 1 else 0 end
      `)] : []),
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
  }
  if (input.sections.progress) {
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

  if (itemReadings.length > 0) {
    const writtenPeriodIds = [...new Set(itemReadings.map((entry) => entry.periodId))];
    if (periods.some((period) => writtenPeriodIds.includes(period.id) &&
      !["open", "draft", "returned"].includes(period.status))) {
      invalid("Item progress can only be imported into open, draft, or returned reporting periods.", "period_not_editable");
    }
    statements.push(db.execute(sql`
      with editable as (
        update reporting_period
        set status = case when status = 'open' then 'draft' else status end,
            updated_at = now()
        where project_id = ${input.projectId}
          and id in (${sql.join(writtenPeriodIds.map((id) => sql`${id}`), sql`, `)})
          and status in ('open', 'draft', 'returned')
        returning id
      )
      select 1 / case when (select count(*) from editable) = ${writtenPeriodIds.length}
        then 1 else 0 end
    `));
  }

  if (itemProgress.length > 0) {
    // Revision imports serialize their audit before their generated item IDs are available.
    if (revision) statements.push(db.update(boqImport).set({ mapping: JSON.stringify({
      ...mappingAudit,
      itemProgress: {
        ...mappingAudit.itemProgress,
        entries: itemProgress.map((entry) => ({ ...entry, boqItemId: itemIdByRow.get(entry.row) })),
      },
    }) }).where(eq(boqImport.id, updateImportId)));
    if (percentItemIds.size > 0) statements.push(db.update(boqItem)
      .set({ progressMode: "by_percent" })
      .where(inArray(boqItem.id, [...percentItemIds])));
    if (revision && dailyProgress.length === 0) statements.push(db.update(boqItem)
      .set({ progressMode: "by_quantity" })
      .where(inArray(boqItem.id, [...new Set(itemReadings.map((entry) => entry.boqItemId))])));
    statements.push(...chunks(itemReadings, 250).map((values) => db.insert(progressEntry).values(
      values.map((entry) => ({
        id: crypto.randomUUID(),
        projectId: input.projectId,
        boqItemId: entry.boqItemId,
        periodId: entry.periodId,
        pctComplete: entry.pctComplete.toFixed(4),
        cumulativePercent: entry.cumulativePercent?.toFixed(4) ?? null,
        cumulativeQuantity: entry.cumulativeQuantity?.toFixed(BOQ_NUMERIC_SCALE) ?? null,
        noProgress: false,
        recordedById: input.actor.id,
      })),
    )));
  }

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

  if (dailySnapshotValues.length > 0) {
    statements.push(
      db.delete(dailyProgressSnapshot).where(
        and(
          eq(dailyProgressSnapshot.projectId, input.projectId),
          inArray(
            dailyProgressSnapshot.reportDate,
            dailySnapshotValues.map((snapshot) => snapshot.reportDate),
          ),
        ),
      ),
      db.insert(dailyProgressSnapshot).values(dailySnapshotValues),
      ...chunks(dailyItemValues, 250).map((values) =>
        db.insert(dailyProgressItem).values(values),
      ),
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
    ...(prepared?.plan.warnings ?? []),
    ...aggregationWarnings,
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
