import { db } from "@DashboardV2/db";
import {
  DAILY_REPORT_STATUSES,
  WEATHER_CONDITIONS,
  dailyReport,
  dailyReportDelivery,
  dailyReportEquipment,
  dailyReportEvent,
  dailyReportManpower,
  dailyReportPhoto,
  project,
  reportingPeriod,
  user,
} from "@DashboardV2/db/schema";
import type { DailyReportStatus } from "@DashboardV2/db/schema";
import { TRPCError } from "@trpc/server";
import { aliasedTable, and, asc, count, desc, eq, gte, lte, sql } from "drizzle-orm";
import z from "zod";

import { companyPermissionProcedure, router } from "../index";
import { recordActivity } from "../lib/activity";
import { runBatch } from "../lib/batch";
import {
  canTransition,
  isEditable,
  permissionFor,
  requiresComment,
  stampFor,
} from "../lib/daily-report-workflow";
import { toAmount } from "../lib/money";
import { hasPermission, roleOf } from "../lib/permissions";
import { assertProjectAccess, type ProjectScopeCtx } from "../lib/scope";

const reviewerAlias = aliasedTable(user, "report_reviewer");
const approverAlias = aliasedTable(user, "report_approver");

/**
 * The narrative fields. All optional: a report filed at six on a wet Tuesday
 * with the weather, the headcount and one line about what stopped is a useful
 * record, and demanding six paragraphs is how you get six paragraphs of
 * "N/A".
 */
const narrativeSchema = z.object({
  weather: z.enum(WEATHER_CONDITIONS).nullish(),
  weatherNote: z.string().trim().max(500).nullish(),
  rainfallHours: z.number().min(0).max(24).nullish(),
  workPerformed: z.string().trim().max(5000).nullish(),
  delays: z.string().trim().max(5000).nullish(),
  safetyObservations: z.string().trim().max(5000).nullish(),
  qualityObservations: z.string().trim().max(5000).nullish(),
  visitors: z.string().trim().max(2000).nullish(),
  notes: z.string().trim().max(5000).nullish(),
});

const manpowerSchema = z.array(
  z.object({
    trade: z.string().trim().min(1).max(120),
    headcount: z.number().int().min(0).max(10_000),
    hours: z.number().min(0).max(24_000).nullish(),
    note: z.string().trim().max(500).nullish(),
  }),
).max(100);

const equipmentSchema = z.array(
  z.object({
    name: z.string().trim().min(1).max(120),
    quantity: z.number().int().min(0).max(1000),
    hoursUsed: z.number().min(0).max(1000).nullish(),
    idle: z.boolean().default(false),
    note: z.string().trim().max(500).nullish(),
  }),
).max(100);

const deliverySchema = z.array(
  z.object({
    material: z.string().trim().min(1).max(200),
    quantity: z.number().min(0).nullish(),
    unit: z.string().trim().max(20).nullish(),
    supplier: z.string().trim().max(200).nullish(),
    reference: z.string().trim().max(120).nullish(),
    boqItemId: z.string().min(1).nullish(),
    note: z.string().trim().max(500).nullish(),
  }),
).max(100);

/** Scoped lookup. Out-of-company ids read as absent, per lib/scope.ts. */
async function findReport(ctx: ProjectScopeCtx, reportId: string) {
  const [row] = await db
    .select({
      report: dailyReport,
      projectCode: project.code,
      projectName: project.name,
    })
    .from(dailyReport)
    .innerJoin(project, eq(project.id, dailyReport.projectId))
    .where(and(eq(dailyReport.id, reportId), eq(project.companyId, ctx.companyId)));

  if (!row) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Daily report not found" });
  }
  await assertProjectAccess(ctx, row.report.projectId);
  return row;
}

async function requireEditable(ctx: ProjectScopeCtx, reportId: string) {
  const row = await findReport(ctx, reportId);
  if (!isEditable(row.report.status)) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `This report is ${row.report.status} and can no longer be edited.`,
    });
  }
  return row;
}

/** The reporting period a calendar date falls inside, if the axis has one. */
async function periodForDate(projectId: string, reportDate: string) {
  const [period] = await db
    .select({ id: reportingPeriod.id })
    .from(reportingPeriod)
    .where(
      and(
        eq(reportingPeriod.projectId, projectId),
        lte(reportingPeriod.startDate, reportDate),
        gte(reportingPeriod.endDate, reportDate),
      ),
    )
    .limit(1);
  return period?.id ?? null;
}

const serialize = (row: typeof dailyReport.$inferSelect) => ({
  ...row,
  rainfallHours: row.rainfallHours === null ? null : toAmount(row.rainfallHours),
});

export const dailyReportRouter = router({
  /**
   * The register for one project: newest first, filterable by status and date.
   *
   * Counts come back with the page so the list can show "12 of 340" without a
   * second round trip, and so a filter that matches nothing can say so rather
   * than looking like a failure.
   */
  list: companyPermissionProcedure("project:read")
    .input(
      z.object({
        projectId: z.string().min(1),
        status: z.enum(DAILY_REPORT_STATUSES).optional(),
        from: z.iso.date().optional(),
        to: z.iso.date().optional(),
        limit: z.number().int().min(1).max(100).default(30),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId);

      const where = and(
        eq(dailyReport.projectId, input.projectId),
        input.status ? eq(dailyReport.status, input.status) : undefined,
        input.from ? gte(dailyReport.reportDate, input.from) : undefined,
        input.to ? lte(dailyReport.reportDate, input.to) : undefined,
      );

      const [rows, [total]] = await Promise.all([
        db
          .select({
            id: dailyReport.id,
            reportDate: dailyReport.reportDate,
            status: dailyReport.status,
            weather: dailyReport.weather,
            preparedByName: dailyReport.preparedByName,
            submittedAt: dailyReport.submittedAt,
            approvedAt: dailyReport.approvedAt,
            returnReason: dailyReport.returnReason,
            headcount: sql<number>`(
              select coalesce(sum(m.headcount), 0)
              from daily_report_manpower m where m.report_id = ${dailyReport.id}
            )`,
            photoCount: sql<number>`(
              select count(*) from daily_report_photo p where p.report_id = ${dailyReport.id}
            )`,
          })
          .from(dailyReport)
          .where(where)
          .orderBy(desc(dailyReport.reportDate))
          .limit(input.limit)
          .offset(input.offset),
        db.select({ value: count() }).from(dailyReport).where(where),
      ]);

      return {
        reports: rows.map((row) => ({
          ...row,
          headcount: Number(row.headcount ?? 0),
          photoCount: Number(row.photoCount ?? 0),
        })),
        total: total?.value ?? 0,
      };
    }),

  /** One report in full, with its structured sections. */
  get: companyPermissionProcedure("project:read")
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const { report, projectCode, projectName } = await findReport(ctx, input.id);

      const [manpower, equipment, deliveries, photos, events, reviewers] = await Promise.all([
        db
          .select()
          .from(dailyReportManpower)
          .where(eq(dailyReportManpower.reportId, input.id))
          .orderBy(asc(dailyReportManpower.sortOrder)),
        db
          .select()
          .from(dailyReportEquipment)
          .where(eq(dailyReportEquipment.reportId, input.id))
          .orderBy(asc(dailyReportEquipment.sortOrder)),
        db
          .select()
          .from(dailyReportDelivery)
          .where(eq(dailyReportDelivery.reportId, input.id))
          .orderBy(asc(dailyReportDelivery.sortOrder)),
        db
          .select({
            id: dailyReportPhoto.id,
            caption: dailyReportPhoto.caption,
            contentType: dailyReportPhoto.contentType,
          })
          .from(dailyReportPhoto)
          .where(eq(dailyReportPhoto.reportId, input.id))
          .orderBy(asc(dailyReportPhoto.createdAt)),
        db
          .select()
          .from(dailyReportEvent)
          .where(eq(dailyReportEvent.reportId, input.id))
          .orderBy(desc(dailyReportEvent.createdAt)),
        db
          .select({ reviewedByName: reviewerAlias.name, approvedByName: approverAlias.name })
          .from(dailyReport)
          .leftJoin(reviewerAlias, eq(reviewerAlias.id, dailyReport.reviewedById))
          .leftJoin(approverAlias, eq(approverAlias.id, dailyReport.approvedById))
          .where(eq(dailyReport.id, input.id)),
      ]);

      return {
        report: serialize(report),
        project: { code: projectCode, name: projectName },
        reviewedByName: reviewers[0]?.reviewedByName ?? null,
        approvedByName: reviewers[0]?.approvedByName ?? null,
        manpower: manpower.map((row) => ({
          ...row,
          hours: row.hours === null ? null : toAmount(row.hours),
        })),
        equipment: equipment.map((row) => ({
          ...row,
          hoursUsed: row.hoursUsed === null ? null : toAmount(row.hoursUsed),
        })),
        deliveries: deliveries.map((row) => ({
          ...row,
          quantity: row.quantity === null ? null : toAmount(row.quantity),
        })),
        photos,
        events,
        editable: isEditable(report.status),
      };
    }),

  /**
   * Opens the report for a given day, creating it if nobody has started one.
   *
   * Get-or-create rather than create, because the unique constraint on
   * (project, date) makes "a second report for Tuesday" impossible by design —
   * a second Tuesday is a correction to the first. Two site engineers opening
   * the form at once therefore both land on the same record instead of one of
   * them getting a constraint violation for doing nothing wrong.
   */
  open: companyPermissionProcedure("project:write")
    .input(z.object({ projectId: z.string().min(1), reportDate: z.iso.date() }))
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId);

      const [existing] = await db
        .select({ id: dailyReport.id })
        .from(dailyReport)
        .where(
          and(
            eq(dailyReport.projectId, input.projectId),
            eq(dailyReport.reportDate, input.reportDate),
          ),
        );
      if (existing) return { id: existing.id, created: false };

      const [created] = await db
        .insert(dailyReport)
        .values({
          projectId: input.projectId,
          reportDate: input.reportDate,
          periodId: await periodForDate(input.projectId, input.reportDate),
          preparedById: ctx.session.user.id,
          preparedByName: ctx.session.user.name,
          status: "draft",
        })
        // Belt and braces against the race the get-or-create above narrows but
        // cannot close: two requests can both read "no row" before either
        // writes. Doing nothing on conflict turns that into a re-read.
        .onConflictDoNothing({
          target: [dailyReport.projectId, dailyReport.reportDate],
        })
        .returning({ id: dailyReport.id });

      if (created) return { id: created.id, created: true };

      const [raced] = await db
        .select({ id: dailyReport.id })
        .from(dailyReport)
        .where(
          and(
            eq(dailyReport.projectId, input.projectId),
            eq(dailyReport.reportDate, input.reportDate),
          ),
        );
      if (!raced) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Could not open the report" });
      }
      return { id: raced.id, created: false };
    }),

  /**
   * Saves the narrative and the structured sections together.
   *
   * The three child tables are replaced wholesale rather than diffed. They are
   * small, unordered from the user's point of view, and edited as lists — and a
   * diff would need stable ids the form has no reason to carry. All of it rides
   * in one batch, so a save cannot leave a report with yesterday's manpower and
   * today's equipment.
   */
  save: companyPermissionProcedure("project:write")
    .input(
      narrativeSchema.extend({
        id: z.string().min(1),
        manpower: manpowerSchema.optional(),
        equipment: equipmentSchema.optional(),
        deliveries: deliverySchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireEditable(ctx, input.id);
      const { id, manpower, equipment, deliveries, rainfallHours, ...narrative } = input;

      const statements: Parameters<typeof runBatch>[0] = [
        db
          .update(dailyReport)
          .set({
            ...narrative,
            rainfallHours: rainfallHours == null ? null : rainfallHours.toFixed(2),
          })
          .where(eq(dailyReport.id, id)),
      ];

      if (manpower) {
        statements.push(db.delete(dailyReportManpower).where(eq(dailyReportManpower.reportId, id)));
        if (manpower.length > 0) {
          statements.push(
            db.insert(dailyReportManpower).values(
              manpower.map((row, index) => ({
                reportId: id,
                trade: row.trade,
                headcount: row.headcount,
                hours: row.hours == null ? null : row.hours.toFixed(2),
                note: row.note ?? null,
                sortOrder: index,
              })),
            ),
          );
        }
      }

      if (equipment) {
        statements.push(
          db.delete(dailyReportEquipment).where(eq(dailyReportEquipment.reportId, id)),
        );
        if (equipment.length > 0) {
          statements.push(
            db.insert(dailyReportEquipment).values(
              equipment.map((row, index) => ({
                reportId: id,
                name: row.name,
                quantity: row.quantity,
                hoursUsed: row.hoursUsed == null ? null : row.hoursUsed.toFixed(2),
                idle: row.idle,
                note: row.note ?? null,
                sortOrder: index,
              })),
            ),
          );
        }
      }

      if (deliveries) {
        statements.push(db.delete(dailyReportDelivery).where(eq(dailyReportDelivery.reportId, id)));
        if (deliveries.length > 0) {
          statements.push(
            db.insert(dailyReportDelivery).values(
              deliveries.map((row, index) => ({
                reportId: id,
                material: row.material,
                quantity: row.quantity == null ? null : row.quantity.toFixed(4),
                unit: row.unit ?? null,
                supplier: row.supplier ?? null,
                reference: row.reference ?? null,
                boqItemId: row.boqItemId ?? null,
                note: row.note ?? null,
                sortOrder: index,
              })),
            ),
          );
        }
      }

      await runBatch(statements);
      return { success: true };
    }),

  /** Submit, review, approve, return, or reopen. Same shape as the period workflow. */
  transition: companyPermissionProcedure("project:read")
    .input(
      z.object({
        id: z.string().min(1),
        to: z.enum(DAILY_REPORT_STATUSES),
        comment: z.string().trim().max(1000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { report, projectCode, projectName } = await findReport(ctx, input.id);
      const from = report.status as DailyReportStatus;

      if (!canTransition(from, input.to)) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `A ${from} report cannot become ${input.to}.`,
        });
      }
      if (!hasPermission(roleOf(ctx.session.user), permissionFor(input.to, from))) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have permission to make that change.",
        });
      }
      if (requiresComment(input.to, from) && !input.comment) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Say what needs correcting before sending the report back.",
        });
      }

      const now = new Date();
      await runBatch([
        db
          .update(dailyReport)
          .set({ status: input.to, ...stampFor(input.to, ctx.session.user.id, now, input.comment) })
          .where(eq(dailyReport.id, input.id)),
        db.insert(dailyReportEvent).values({
          reportId: input.id,
          fromStatus: from,
          toStatus: input.to,
          actorId: ctx.session.user.id,
          actorName: ctx.session.user.name,
          comment: input.comment ?? null,
        }),
      ]);

      await recordActivity(ctx, {
        action:
          input.to === "submitted"
            ? "submitted"
            : input.to === "approved"
              ? "approved"
              : input.to === "returned"
                ? "returned"
                : input.to === "reviewed"
                  ? "reviewed"
                  : "reopened",
        entityType: "daily_report",
        entityId: input.id,
        entityLabel: `${projectCode} - ${projectName}`,
        detail: report.reportDate,
      });

      return { status: input.to };
    }),

  /**
   * Weather and manpower for the last fortnight, for the project overview.
   *
   * Approved and submitted reports only: a draft is somebody's half-written
   * note, and putting it on the overview would present it as the record of the
   * day when it is not yet one.
   */
  recentSummary: companyPermissionProcedure("project:read")
    .input(z.object({ projectId: z.string().min(1), days: z.number().int().min(1).max(60).default(14) }))
    .query(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId);

      const rows = await db
        .select({
          id: dailyReport.id,
          reportDate: dailyReport.reportDate,
          weather: dailyReport.weather,
          status: dailyReport.status,
          headcount: sql<number>`(
            select coalesce(sum(m.headcount), 0)
            from daily_report_manpower m where m.report_id = ${dailyReport.id}
          )`,
        })
        .from(dailyReport)
        .where(
          and(
            eq(dailyReport.projectId, input.projectId),
            sql`${dailyReport.status} in ('submitted', 'reviewed', 'approved')`,
            sql`${dailyReport.reportDate} >= current_date - ${input.days}::int`,
          ),
        )
        .orderBy(asc(dailyReport.reportDate));

      return rows.map((row) => ({ ...row, headcount: Number(row.headcount ?? 0) }));
    }),

  delete: companyPermissionProcedure("project:write")
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      // Only a draft may be deleted. Once submitted the report is part of the
      // record — the way to undo it is to return it, which leaves a trace.
      const { report } = await findReport(ctx, input.id);
      if (report.status !== "draft") {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Only a draft report can be deleted. Return it for correction instead.",
        });
      }
      await db.delete(dailyReport).where(eq(dailyReport.id, input.id));
      return { success: true };
    }),
});
