import { db } from "@DashboardV2/db";
import {
  DAILY_REPORT_STATUSES,
  WEATHER_CONDITIONS,
  boqItem,
  boqVersion,
  dailyReport,
  dailyReportDelivery,
  dailyReportEquipment,
  dailyReportEvent,
  dailyReportManpower,
  dailyReportPhoto,
  project,
  user,
} from "@DashboardV2/db/schema";
import type { DailyReportStatus } from "@DashboardV2/db/schema";
import { TRPCError } from "@trpc/server";
import { aliasedTable, and, asc, count, desc, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import z from "zod";

import { companyPermissionProcedure, router } from "../index";
import { recordActivity } from "../lib/activity";
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

async function assertDeliveriesInProject(
  projectId: string,
  deliveries: z.infer<typeof deliverySchema> | undefined,
) {
  const ids = [...new Set(deliveries?.flatMap((row) => (row.boqItemId ? [row.boqItemId] : [])) ?? [])];
  if (ids.length === 0) return;

  const linkedItems = await db
    .select({ id: boqItem.id })
    .from(boqItem)
    .innerJoin(boqVersion, eq(boqItem.boqVersionId, boqVersion.id))
    .where(and(inArray(boqItem.id, ids), eq(boqVersion.projectId, projectId)));

  if (linkedItems.length !== ids.length) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Every linked BOQ item must belong to the report's project.",
    });
  }
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

      const [previous] = await db
        .select({ id: dailyReport.id, reportDate: dailyReport.reportDate })
        .from(dailyReport)
        .where(
          and(
            eq(dailyReport.projectId, report.projectId),
            lt(dailyReport.reportDate, report.reportDate),
          ),
        )
        .orderBy(desc(dailyReport.reportDate))
        .limit(1);

      const [
        manpower,
        equipment,
        deliveries,
        photos,
        events,
        reviewers,
        previousManpower,
        previousEquipment,
        previousDeliveries,
      ] = await Promise.all([
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
        previous
          ? db
              .select({ trade: dailyReportManpower.trade })
              .from(dailyReportManpower)
              .where(eq(dailyReportManpower.reportId, previous.id))
              .orderBy(asc(dailyReportManpower.sortOrder))
          : Promise.resolve([]),
        previous
          ? db
              .select({ name: dailyReportEquipment.name })
              .from(dailyReportEquipment)
              .where(eq(dailyReportEquipment.reportId, previous.id))
              .orderBy(asc(dailyReportEquipment.sortOrder))
          : Promise.resolve([]),
        previous
          ? db
              .select({
                material: dailyReportDelivery.material,
                unit: dailyReportDelivery.unit,
                supplier: dailyReportDelivery.supplier,
              })
              .from(dailyReportDelivery)
              .where(eq(dailyReportDelivery.reportId, previous.id))
              .orderBy(asc(dailyReportDelivery.sortOrder))
          : Promise.resolve([]),
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
        previousStructure: previous
          ? {
              reportDate: previous.reportDate,
              manpower: previousManpower,
              equipment: previousEquipment,
              deliveries: previousDeliveries,
            }
          : null,
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

      const created = await db.execute<{ id: string }>(sql`
        with locked as materialized (
          select pg_advisory_xact_lock(hashtextextended(${input.projectId}, 0))
        )
        insert into daily_report
          (id, project_id, report_date, period_id, prepared_by_id, prepared_by_name, status)
        select
          ${crypto.randomUUID()}, ${input.projectId}, ${input.reportDate},
          (
            select period.id from reporting_period period
            where period.project_id = ${input.projectId}
              and ${input.reportDate} between period.start_date and period.end_date
            limit 1
          ),
          ${ctx.session.user.id}, ${ctx.session.user.name}, 'draft'
        from locked
        on conflict (project_id, report_date) do nothing
        returning id
      `);

      if (created.rows[0]) return { id: created.rows[0].id, created: true };

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
      const current = await requireEditable(ctx, input.id);
      const { id, manpower, equipment, deliveries, rainfallHours, ...narrative } = input;
      await assertDeliveriesInProject(current.report.projectId, deliveries);

      const manpowerRows = (manpower ?? []).map((row, index) => ({
        id: crypto.randomUUID(),
        trade: row.trade,
        headcount: row.headcount,
        hours: row.hours == null ? null : row.hours.toFixed(2),
        note: row.note ?? null,
        sortOrder: index,
      }));
      const equipmentRows = (equipment ?? []).map((row, index) => ({
        id: crypto.randomUUID(),
        name: row.name,
        quantity: row.quantity,
        hoursUsed: row.hoursUsed == null ? null : row.hoursUsed.toFixed(2),
        idle: row.idle,
        note: row.note ?? null,
        sortOrder: index,
      }));
      const deliveryRows = (deliveries ?? []).map((row, index) => ({
        id: crypto.randomUUID(),
        material: row.material,
        quantity: row.quantity == null ? null : row.quantity.toFixed(4),
        unit: row.unit ?? null,
        supplier: row.supplier ?? null,
        reference: row.reference ?? null,
        boqItemId: row.boqItemId ?? null,
        note: row.note ?? null,
        sortOrder: index,
      }));

      // Every child-table write depends on the conditional report update, so a
      // concurrent submission either waits for this save or makes all of it a no-op.
      const saved = await db.execute<{ id: string }>(sql`
        with editable as (
          update daily_report set
            weather = case when ${narrative.weather !== undefined} then ${narrative.weather ?? null} else weather end,
            weather_note = case when ${narrative.weatherNote !== undefined} then ${narrative.weatherNote ?? null} else weather_note end,
            rainfall_hours = case when ${rainfallHours !== undefined} then ${rainfallHours == null ? null : rainfallHours.toFixed(2)} else rainfall_hours end,
            work_performed = case when ${narrative.workPerformed !== undefined} then ${narrative.workPerformed ?? null} else work_performed end,
            delays = case when ${narrative.delays !== undefined} then ${narrative.delays ?? null} else delays end,
            safety_observations = case when ${narrative.safetyObservations !== undefined} then ${narrative.safetyObservations ?? null} else safety_observations end,
            quality_observations = case when ${narrative.qualityObservations !== undefined} then ${narrative.qualityObservations ?? null} else quality_observations end,
            visitors = case when ${narrative.visitors !== undefined} then ${narrative.visitors ?? null} else visitors end,
            notes = case when ${narrative.notes !== undefined} then ${narrative.notes ?? null} else notes end,
            updated_at = ${new Date()}
          where id = ${id} and status in ('draft', 'returned')
          returning id
        ), deleted_manpower as (
          delete from daily_report_manpower
          where report_id in (select id from editable) and ${manpower !== undefined}
        ), manpower_rows as (
          select * from jsonb_to_recordset(${JSON.stringify(manpowerRows)}::jsonb) as value(
            id text, trade text, headcount integer, hours numeric, note text, "sortOrder" integer
          )
        ), inserted_manpower as (
          insert into daily_report_manpower (id, report_id, trade, headcount, hours, note, sort_order)
          select rows.id, editable.id, rows.trade, rows.headcount, rows.hours, rows.note, rows."sortOrder"
          from manpower_rows rows cross join editable
          where ${manpower !== undefined}
        ), deleted_equipment as (
          delete from daily_report_equipment
          where report_id in (select id from editable) and ${equipment !== undefined}
        ), equipment_rows as (
          select * from jsonb_to_recordset(${JSON.stringify(equipmentRows)}::jsonb) as value(
            id text, name text, quantity integer, "hoursUsed" numeric, idle boolean,
            note text, "sortOrder" integer
          )
        ), inserted_equipment as (
          insert into daily_report_equipment
            (id, report_id, name, quantity, hours_used, idle, note, sort_order)
          select rows.id, editable.id, rows.name, rows.quantity, rows."hoursUsed",
                 rows.idle, rows.note, rows."sortOrder"
          from equipment_rows rows cross join editable
          where ${equipment !== undefined}
        ), deleted_deliveries as (
          delete from daily_report_delivery
          where report_id in (select id from editable) and ${deliveries !== undefined}
        ), delivery_rows as (
          select * from jsonb_to_recordset(${JSON.stringify(deliveryRows)}::jsonb) as value(
            id text, material text, quantity numeric, unit text, supplier text,
            reference text, "boqItemId" text, note text, "sortOrder" integer
          )
        ), inserted_deliveries as (
          insert into daily_report_delivery
            (id, report_id, material, quantity, unit, supplier, reference, boq_item_id, note, sort_order)
          select rows.id, editable.id, rows.material, rows.quantity, rows.unit, rows.supplier,
                 rows.reference, rows."boqItemId", rows.note, rows."sortOrder"
          from delivery_rows rows cross join editable
          where ${deliveries !== undefined}
        )
        select id from editable
      `);
      if (saved.rows.length === 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "This report is no longer editable. Refresh and try again.",
        });
      }
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
      const stamp = stampFor(input.to, ctx.session.user.id, now, input.comment);
      const assignments = [sql`status = ${input.to}`, sql`updated_at = ${now}`];
      if ("submittedAt" in stamp) assignments.push(sql`submitted_at = ${stamp.submittedAt}`);
      if ("reviewedById" in stamp) assignments.push(sql`reviewed_by_id = ${stamp.reviewedById}`);
      if ("reviewedAt" in stamp) assignments.push(sql`reviewed_at = ${stamp.reviewedAt}`);
      if ("approvedById" in stamp) assignments.push(sql`approved_by_id = ${stamp.approvedById}`);
      if ("approvedAt" in stamp) assignments.push(sql`approved_at = ${stamp.approvedAt}`);
      if ("returnReason" in stamp) assignments.push(sql`return_reason = ${stamp.returnReason}`);

      const eventId = crypto.randomUUID();
      const changed = await db.execute<{ id: string }>(sql`
        with changed as (
          update daily_report
          set ${sql.join(assignments, sql`, `)}
          where id = ${input.id} and status = ${from}
          returning id
        )
        insert into daily_report_event
          (id, report_id, from_status, to_status, actor_id, actor_name, comment)
        select
          ${eventId}, id, ${from}, ${input.to}, ${ctx.session.user.id},
          ${ctx.session.user.name}, ${input.comment ?? null}
        from changed
        returning id
      `);
      if (changed.rows.length === 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "This report changed while you were viewing it. Refresh and try again.",
        });
      }

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
