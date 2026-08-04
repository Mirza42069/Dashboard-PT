import { db } from "@DashboardV2/db";
import {
  PERIOD_STATUSES,
  boqItem,
  boqItemDistribution,
  boqVersion,
  progressEntry,
  project,
  reportingPeriod,
  reportingPeriodEvent,
  user,
} from "@DashboardV2/db/schema";
import type { ActivityAction, PeriodStatus } from "@DashboardV2/db/schema";
import { TRPCError } from "@trpc/server";
import { aliasedTable, and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import z from "zod";

import { companyPermissionProcedure, router } from "../index";
import { recordActivity } from "../lib/activity";
import { computePctComplete, leafPredicate, serializeItem, serializeVersion } from "../lib/boq";
import { toAmount } from "../lib/money";
import { hasPermission, roleOf } from "../lib/permissions";
import {
  canTransition,
  completeness,
  isEditable,
  permissionFor,
  requiresComment,
  stampFor,
} from "../lib/progress-workflow";
import { assertProjectAccess, type ProjectScopeCtx } from "../lib/scope";

/**
 * Three aliases of `user`, because one period names up to three different
 * people and a single join could only resolve one of them.
 */
const submitter = aliasedTable(user, "submitter");
const reviewer = aliasedTable(user, "reviewer");
const approver = aliasedTable(user, "approver");

/** The audit action each destination status writes. */
const TRANSITION_ACTIONS: Record<PeriodStatus, ActivityAction> = {
  open: "updated",
  draft: "reopened",
  submitted: "submitted",
  reviewed: "reviewed",
  approved: "approved",
  returned: "returned",
  locked: "locked",
};

/** Scoped lookup of one period. Out-of-company ids read as absent, per lib/scope.ts. */
async function findPeriod(ctx: ProjectScopeCtx, periodId: string) {
  const [row] = await db
    .select({
      id: reportingPeriod.id,
      projectId: reportingPeriod.projectId,
      periodIndex: reportingPeriod.periodIndex,
      label: reportingPeriod.label,
      status: reportingPeriod.status,
      updatedAt: reportingPeriod.updatedAt,
    })
    .from(reportingPeriod)
    .innerJoin(project, eq(project.id, reportingPeriod.projectId))
    .where(and(eq(reportingPeriod.id, periodId), eq(project.companyId, ctx.companyId)));

  if (!row) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Reporting period not found" });
  }
  return row;
}

/**
 * The gate every write into a period passes.
 *
 * A submitted or approved report is a statement of record — see isEditable.
 * The message names the state rather than saying "locked", because "this
 * report is with the reviewer" tells someone what to do next and "locked" does
 * not.
 */
async function requireEditablePeriod(ctx: ProjectScopeCtx, periodId: string) {
  const period = await findPeriod(ctx, periodId);
  await assertProjectAccess(ctx, period.projectId);

  if (!isEditable(period.status)) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `This report is ${period.status} and can no longer be edited.`,
    });
  }
  return period;
}

/** The active baseline's leaves, restricted to the ids asked for. */
async function activeLeaves(projectId: string, itemIds: string[]) {
  const [active] = await db
    .select({ id: boqVersion.id })
    .from(boqVersion)
    .where(and(eq(boqVersion.projectId, projectId), eq(boqVersion.status, "active")));

  if (!active) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Baseline the BoQ before recording progress against it.",
    });
  }

  const leaves = await db
    .select({ id: boqItem.id })
    .from(boqItem)
    .where(
      and(
        eq(boqItem.boqVersionId, active.id),
        inArray(boqItem.id, itemIds),
        isNull(boqItem.deletedAt),
        leafPredicate("boq_item"),
      ),
    );

  if (leaves.length !== new Set(itemIds).size) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Progress can only be recorded against priced lines of the active baseline.",
    });
  }
  return leaves;
}

/**
 * Lines of the active baseline with neither a reading nor a mark in this
 * period. The set "mark the rest as unchanged" acts on.
 */
async function unaddressedLeaves(projectId: string, periodId: string) {
  const [active] = await db
    .select({ id: boqVersion.id })
    .from(boqVersion)
    .where(and(eq(boqVersion.projectId, projectId), eq(boqVersion.status, "active")));
  if (!active) return [];

  return db
    .select({ id: boqItem.id })
    .from(boqItem)
    .where(
      and(
        eq(boqItem.boqVersionId, active.id),
        isNull(boqItem.deletedAt),
        leafPredicate("boq_item"),
        sql`not exists (
          select 1 from progress_entry entry
          where entry.boq_item_id = ${boqItem.id}
            and entry.period_id = ${periodId}
            and (entry.no_progress = true
                 or entry.cumulative_percent is not null
                 or entry.cumulative_quantity is not null)
        )`,
      ),
    );
}

/** How much of one period's report is filled in — the submission precondition. */
async function periodCompleteness(projectId: string, periodId: string) {
  const [active] = await db
    .select({ id: boqVersion.id })
    .from(boqVersion)
    .where(
      and(
        eq(boqVersion.projectId, projectId),
        eq(boqVersion.status, "active"),
        eq(boqVersion.scheduleStatus, "active"),
      ),
    );
  if (!active) return completeness(0, []);

  const [leaves, entries] = await Promise.all([
    db
      .select({ id: boqItem.id })
      .from(boqItem)
      .where(
        and(
          eq(boqItem.boqVersionId, active.id),
          isNull(boqItem.deletedAt),
          leafPredicate("boq_item"),
        ),
      ),
    db
      .select({
        boqItemId: progressEntry.boqItemId,
        noProgress: progressEntry.noProgress,
        cumulativeQuantity: progressEntry.cumulativeQuantity,
        cumulativePercent: progressEntry.cumulativePercent,
      })
      .from(progressEntry)
      .innerJoin(boqItem, eq(boqItem.id, progressEntry.boqItemId))
      .where(and(eq(progressEntry.periodId, periodId), eq(boqItem.boqVersionId, active.id))),
  ]);

  return completeness(
    leaves.length,
    entries.map((entry) => ({
      boqItemId: entry.boqItemId,
      hasReading: entry.cumulativeQuantity !== null || entry.cumulativePercent !== null,
      noProgress: entry.noProgress,
    })),
  );
}

export const progressRouter = router({
  /**
   * Everything the BoQ, schedule and progress tabs need, in one round trip.
   *
   * The curves are deliberately *not* computed here. Drawing them needs the
   * whole item × period grid in the browser anyway, and computing planned and
   * actual from the same arrays the chart renders means the headline deviation
   * can never disagree with the line the user is looking at.
   */
  report: companyPermissionProcedure("project:read")
    .input(z.object({ projectId: z.string().min(1), versionId: z.string().min(1).optional() }))
    .query(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId);

      const [target] = await db
        .select({
          dataDate: project.dataDate,
          periodType: project.periodType,
          startDate: project.startDate,
          scheduleStart: project.scheduleStart,
          endDate: project.endDate,
        })
        .from(project)
        .where(eq(project.id, input.projectId));

      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      }

      const versions = await db
        .select()
        .from(boqVersion)
        .where(eq(boqVersion.projectId, input.projectId))
        .orderBy(desc(boqVersion.versionNo));

      const current = input.versionId
        ? versions.find((row) => row.id === input.versionId)
        : versions.find((row) => row.status === "active");
      if (input.versionId && !current) {
        throw new TRPCError({ code: "NOT_FOUND", message: "BoQ version not found" });
      }

      const periods = await db
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
        .orderBy(asc(reportingPeriod.periodIndex));

      if (!current) {
        return {
          project: target,
          version: null,
          items: [],
          periods,
          distribution: [],
          entries: [],
        };
      }

      const [items, distribution, entries] = await Promise.all([
        db
          .select()
          .from(boqItem)
          .where(and(eq(boqItem.boqVersionId, current.id), isNull(boqItem.deletedAt)))
          .orderBy(asc(boqItem.sortOrder), asc(boqItem.code)),
        db
          .select({
            boqItemId: boqItemDistribution.boqItemId,
            periodId: boqItemDistribution.periodId,
            plannedPct: boqItemDistribution.plannedPct,
          })
          .from(boqItemDistribution)
          .innerJoin(boqItem, eq(boqItem.id, boqItemDistribution.boqItemId))
          .where(eq(boqItem.boqVersionId, current.id)),
        db
          .select({
            boqItemId: progressEntry.boqItemId,
            periodId: progressEntry.periodId,
            cumulativeQuantity: progressEntry.cumulativeQuantity,
            cumulativePercent: progressEntry.cumulativePercent,
            pctComplete: progressEntry.pctComplete,
            noProgress: progressEntry.noProgress,
            note: progressEntry.note,
          })
          .from(progressEntry)
          .innerJoin(boqItem, eq(boqItem.id, progressEntry.boqItemId))
          .where(eq(boqItem.boqVersionId, current.id)),
      ]);

      return {
        project: target,
        version: serializeVersion(current),
        items: items.map(serializeItem),
        periods,
        distribution: distribution.map((row) => ({
          boqItemId: row.boqItemId,
          periodId: row.periodId,
          plannedPct: toAmount(row.plannedPct),
        })),
        entries: entries.map((row) => ({
          boqItemId: row.boqItemId,
          periodId: row.periodId,
          // Null is meaningful here — it marks a cleared cell, which carries the
          // previous reading forward instead of resetting the line to zero.
          cumulativeQuantity: row.cumulativeQuantity === null ? null : toAmount(row.cumulativeQuantity),
          cumulativePercent: row.cumulativePercent === null ? null : toAmount(row.cumulativePercent),
          pctComplete: toAmount(row.pctComplete),
          noProgress: row.noProgress,
          note: row.note,
        })),
      };
    }),

  /**
   * Records the readings for one period.
   *
   * Values are cumulative to date, not increments. `pctComplete` is resolved
   * here rather than by a database trigger, so the one place that knows how a
   * reading becomes a percentage is the same place that validates it.
   *
   * The upsert and the data-date refresh ride in one batch: the data date is
   * what every progress figure is measured against, and leaving it stale after
   * a successful save would understate the project until the next write.
   */
  bulkSave: companyPermissionProcedure("project:write")
    .input(
      z.object({
        periodId: z.string().min(1),
        entries: z
          .array(
            z.object({
              boqItemId: z.string().min(1),
              cumulativeQuantity: z.number().min(0).nullish(),
              cumulativePercent: z.number().min(0).max(100).nullish(),
              note: z.string().trim().max(500).nullish(),
            }),
          )
          .min(1)
          .max(1000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const period = await requireEditablePeriod(ctx, input.periodId);

      const [active] = await db
        .select()
        .from(boqVersion)
        .where(and(eq(boqVersion.projectId, period.projectId), eq(boqVersion.status, "active")));

      if (!active) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Baseline the BoQ before recording progress against it.",
        });
      }
      if (active.scheduleStatus !== "active") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Activate the schedule before recording progress against it.",
        });
      }

      const itemIds = [...new Set(input.entries.map((entry) => entry.boqItemId))];
      const leaves = await db
        .select({
          id: boqItem.id,
          progressMode: boqItem.progressMode,
          quantity: boqItem.quantity,
        })
        .from(boqItem)
        .where(
          and(
            eq(boqItem.boqVersionId, active.id),
            inArray(boqItem.id, itemIds),
            isNull(boqItem.deletedAt),
            leafPredicate("boq_item"),
          ),
        );

      const byId = new Map(leaves.map((row) => [row.id, row]));
      if (byId.size !== itemIds.length) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Progress can only be recorded against priced lines of the active baseline.",
        });
      }

      const [projectRow] = await db
        .select({ code: project.code, name: project.name })
        .from(project)
        .where(eq(project.id, period.projectId));

      const values = input.entries.map((entry) => {
        const item = byId.get(entry.boqItemId);
        if (!item) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Unknown BoQ line" });
        }

        const cumulativeQuantity = entry.cumulativeQuantity ?? null;
        const cumulativePercent = entry.cumulativePercent ?? null;

        const pctComplete = computePctComplete({
          progressMode: item.progressMode,
          quantity: item.quantity === null ? null : toAmount(item.quantity),
          cumulativeQuantity,
          cumulativePercent,
        });

        return {
          id: crypto.randomUUID(),
          projectId: period.projectId,
          periodId: input.periodId,
          boqItemId: entry.boqItemId,
          cumulativeQuantity: cumulativeQuantity === null ? null : cumulativeQuantity.toFixed(4),
          cumulativePercent: cumulativePercent === null ? null : cumulativePercent.toFixed(4),
          pctComplete: pctComplete.toFixed(4),
          // A typed figure supersedes a "no progress" mark on the same line.
          noProgress: false,
          note: entry.note ?? null,
          recordedById: ctx.session.user.id,
        };
      });

      const [, changed] = await db.batch([
        db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${period.projectId}, 0))`),
        db.execute<{ id: string }>(sql`
        with editable as (
          update reporting_period
          set status = case when status = 'open' then 'draft' else status end,
              updated_at = ${new Date()}
          where id = ${input.periodId} and status in ('open', 'draft', 'returned')
          returning id
        ), input_rows as (
          select * from jsonb_to_recordset(${JSON.stringify(values)}::jsonb) as value(
            id text, "projectId" text, "periodId" text, "boqItemId" text,
            "cumulativeQuantity" numeric, "cumulativePercent" numeric,
            "pctComplete" numeric, "noProgress" boolean, note text, "recordedById" text
          )
        ), upserted as (
          insert into progress_entry
            (id, project_id, period_id, boq_item_id, cumulative_quantity, cumulative_percent,
             pct_complete, no_progress, note, recorded_by_id)
          select
            input_rows.id, input_rows."projectId", input_rows."periodId", input_rows."boqItemId",
            input_rows."cumulativeQuantity", input_rows."cumulativePercent", input_rows."pctComplete",
            input_rows."noProgress", input_rows.note, input_rows."recordedById"
          from input_rows cross join editable
          on conflict (period_id, boq_item_id) do update set
            cumulative_quantity = excluded.cumulative_quantity,
            cumulative_percent = excluded.cumulative_percent,
            pct_complete = excluded.pct_complete,
            no_progress = excluded.no_progress,
            note = excluded.note,
            recorded_by_id = excluded.recorded_by_id,
            updated_at = ${new Date()}
          returning id
        ), refreshed as (
          update project set data_date = (
            select max(period.end_date)
            from reporting_period period
            where period.project_id = ${period.projectId}
              and (
                exists (
                  select 1 from progress_entry entry
                  where entry.period_id = period.id
                    and (entry.cumulative_percent is not null or entry.cumulative_quantity is not null)
                    and not exists (
                      select 1 from input_rows input
                      where input."periodId" = entry.period_id
                        and input."boqItemId" = entry.boq_item_id
                    )
                )
                or exists (
                  select 1 from input_rows input
                  where input."periodId" = period.id
                    and (input."cumulativePercent" is not null or input."cumulativeQuantity" is not null)
                )
              )
          )
          where id = ${period.projectId} and exists (select 1 from editable)
        )
        select id from upserted
        `),
      ]);
      if (changed.rows.length !== values.length) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "This period is no longer editable. Refresh and try again.",
        });
      }
      await recordActivity(ctx, {
        action: "progress_recorded",
        entityType: "progress",
        entityId: period.projectId,
        entityLabel: projectRow ? `${projectRow.code} - ${projectRow.name}` : period.projectId,
        detail: `${input.entries.length} line(s) - ${period.label ?? ""}`.trim(),
      });

      return { success: true };
    }),

  /**
   * Marks lines as checked-and-unchanged for a period.
   *
   * Separate from bulkSave because it is a different statement: bulkSave writes
   * measurements, this writes an assertion that there is nothing to measure.
   * Conflating them would mean either inventing a reading (which fabricates
   * data) or leaving the line blank (which is indistinguishable from forgetting
   * it) — and it is precisely that distinction submission depends on.
   */
  markNoProgress: companyPermissionProcedure("project:write")
    .input(
      z.object({
        periodId: z.string().min(1),
        /**
         * Omitted means "every line nobody has addressed yet" — the shape of
         * the real task, which is filling in what moved and then saying, once,
         * that the rest did not. Resolved on the server so the client never
         * has to ship a list of a few hundred ids to express it.
         */
        boqItemIds: z.array(z.string().min(1)).min(1).max(1000).optional(),
        /** False un-marks them, for a line ticked by mistake. */
        noProgress: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const period = await requireEditablePeriod(ctx, input.periodId);
      const leaves = input.boqItemIds
        ? await activeLeaves(period.projectId, input.boqItemIds)
        : await unaddressedLeaves(period.projectId, input.periodId);

      if (leaves.length === 0) return { marked: 0 };

      const values = leaves.map((leaf) => ({
        id: crypto.randomUUID(),
        projectId: period.projectId,
        periodId: input.periodId,
        boqItemId: leaf.id,
        noProgress: input.noProgress,
        recordedById: ctx.session.user.id,
      }));
      const [, changed] = await db.batch([
        db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${period.projectId}, 0))`),
        db.execute<{ id: string }>(sql`
        with editable as (
          update reporting_period
          set status = case when status = 'open' then 'draft' else status end,
              updated_at = ${new Date()}
          where id = ${input.periodId} and status in ('open', 'draft', 'returned')
          returning id
        ), input_rows as (
          select * from jsonb_to_recordset(${JSON.stringify(values)}::jsonb) as value(
            id text, "projectId" text, "periodId" text, "boqItemId" text,
            "noProgress" boolean, "recordedById" text
          )
        )
        insert into progress_entry
          (id, project_id, period_id, boq_item_id, cumulative_quantity, cumulative_percent,
           pct_complete, no_progress, recorded_by_id)
        select
          input_rows.id, input_rows."projectId", input_rows."periodId", input_rows."boqItemId",
          null, null, 0, input_rows."noProgress", input_rows."recordedById"
        from input_rows cross join editable
        on conflict (period_id, boq_item_id) do update set
          no_progress = excluded.no_progress,
          updated_at = ${new Date()}
        returning id
        `),
      ]);
      if (changed.rows.length !== values.length) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "This period is no longer editable. Refresh and try again.",
        });
      }

      return { marked: leaves.length };
    }),

  /**
   * How complete each period's report is, and where it stands in the workflow.
   *
   * One query for the whole project rather than one per period: the reporting
   * table shows every period at once, and the counts are what tell a manager
   * which week to chase.
   */
  periodStatus: companyPermissionProcedure("project:read")
    .input(z.object({ projectId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId);

      const [active] = await db
        .select({ id: boqVersion.id })
        .from(boqVersion)
        .where(
          and(
            eq(boqVersion.projectId, input.projectId),
            eq(boqVersion.status, "active"),
            eq(boqVersion.scheduleStatus, "active"),
          ),
        );

      const [periods, leaves, entries] = await Promise.all([
        db
          .select({
            id: reportingPeriod.id,
            periodIndex: reportingPeriod.periodIndex,
            startDate: reportingPeriod.startDate,
            endDate: reportingPeriod.endDate,
            status: reportingPeriod.status,
            submittedAt: reportingPeriod.submittedAt,
            reviewedAt: reportingPeriod.reviewedAt,
            approvedAt: reportingPeriod.approvedAt,
            lockedAt: reportingPeriod.lockedAt,
            returnReason: reportingPeriod.returnReason,
            reviewComment: reportingPeriod.reviewComment,
            submittedByName: submitter.name,
            reviewedByName: reviewer.name,
            approvedByName: approver.name,
          })
          .from(reportingPeriod)
          .leftJoin(submitter, eq(submitter.id, reportingPeriod.submittedById))
          .leftJoin(reviewer, eq(reviewer.id, reportingPeriod.reviewedById))
          .leftJoin(approver, eq(approver.id, reportingPeriod.approvedById))
          .where(eq(reportingPeriod.projectId, input.projectId))
          .orderBy(asc(reportingPeriod.periodIndex)),
        active
          ? db
              .select({ id: boqItem.id })
              .from(boqItem)
              .where(
                and(
                  eq(boqItem.boqVersionId, active.id),
                  isNull(boqItem.deletedAt),
                  leafPredicate("boq_item"),
                ),
              )
          : Promise.resolve([]),
        active
          ? db
              .select({
                periodId: progressEntry.periodId,
                boqItemId: progressEntry.boqItemId,
                noProgress: progressEntry.noProgress,
                cumulativeQuantity: progressEntry.cumulativeQuantity,
                cumulativePercent: progressEntry.cumulativePercent,
              })
              .from(progressEntry)
              .innerJoin(boqItem, eq(boqItem.id, progressEntry.boqItemId))
              .where(eq(boqItem.boqVersionId, active.id))
          : Promise.resolve([]),
      ]);

      const byPeriod = new Map<
        string,
        { boqItemId: string; hasReading: boolean; noProgress: boolean }[]
      >();
      for (const entry of entries) {
        const list = byPeriod.get(entry.periodId) ?? [];
        list.push({
          boqItemId: entry.boqItemId,
          hasReading: entry.cumulativeQuantity !== null || entry.cumulativePercent !== null,
          noProgress: entry.noProgress,
        });
        byPeriod.set(entry.periodId, list);
      }

      return periods.map((period) => ({
        ...period,
        completeness: completeness(leaves.length, byPeriod.get(period.id) ?? []),
        editable: isEditable(period.status),
      }));
    }),

  /** The full transition history for one period — who moved it, when, and why. */
  periodHistory: companyPermissionProcedure("project:read")
    .input(z.object({ periodId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const period = await findPeriod(ctx, input.periodId);
      await assertProjectAccess(ctx, period.projectId);

      return db
        .select({
          id: reportingPeriodEvent.id,
          fromStatus: reportingPeriodEvent.fromStatus,
          toStatus: reportingPeriodEvent.toStatus,
          actorName: reportingPeriodEvent.actorName,
          comment: reportingPeriodEvent.comment,
          createdAt: reportingPeriodEvent.createdAt,
        })
        .from(reportingPeriodEvent)
        .where(eq(reportingPeriodEvent.periodId, input.periodId))
        .orderBy(desc(reportingPeriodEvent.createdAt));
    }),

  /**
   * Every move a period can make, behind one procedure.
   *
   * One entry point rather than submit/approve/return/lock as four: the checks
   * they share — is this transition legal, does the caller hold the permission
   * for it, does it need a reason, what does it stamp, what does it log — are
   * the entire body of each, and four copies is four places for one of them to
   * go missing.
   */
  transitionPeriod: companyPermissionProcedure("project:read")
    .input(
      z.object({
        periodId: z.string().min(1),
        to: z.enum(PERIOD_STATUSES),
        comment: z.string().trim().max(1000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const period = await findPeriod(ctx, input.periodId);
      await assertProjectAccess(ctx, period.projectId);

      const from = period.status;
      if (!canTransition(from, input.to)) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `A ${from} report cannot become ${input.to}.`,
        });
      }

      // Permission is decided by the move, not by the procedure — which is why
      // this one is declared at project:read and gates itself here.
      const needed = permissionFor(input.to, from);
      if (!hasPermission(roleOf(ctx.session.user), needed)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have permission to make that change.",
        });
      }

      if (requiresComment(input.to, from) && !input.comment) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            input.to === "returned"
              ? "Say what needs correcting before sending the report back."
              : "Reopening an agreed period needs a reason.",
        });
      }

      // Submission is the one move with a data precondition: every line must
      // have been addressed. Checked here rather than in the UI because the UI
      // is not what the record depends on.
      if (input.to === "submitted") {
        const summary = await periodCompleteness(period.projectId, input.periodId);
        if (summary.missing > 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `${summary.missing} line(s) have neither a reading nor a "no progress" mark.`,
          });
        }
      }

      const now = new Date();
      const stamp = stampFor(input.to, ctx.session.user.id, now, input.comment);
      const assignments = [sql`status = ${input.to}`, sql`updated_at = ${now}`];
      if ("submittedById" in stamp) assignments.push(sql`submitted_by_id = ${stamp.submittedById}`);
      if ("submittedAt" in stamp) assignments.push(sql`submitted_at = ${stamp.submittedAt}`);
      if ("reviewedById" in stamp) assignments.push(sql`reviewed_by_id = ${stamp.reviewedById}`);
      if ("reviewedAt" in stamp) assignments.push(sql`reviewed_at = ${stamp.reviewedAt}`);
      if ("approvedById" in stamp) assignments.push(sql`approved_by_id = ${stamp.approvedById}`);
      if ("approvedAt" in stamp) assignments.push(sql`approved_at = ${stamp.approvedAt}`);
      if ("lockedById" in stamp) assignments.push(sql`locked_by_id = ${stamp.lockedById}`);
      if ("lockedAt" in stamp) assignments.push(sql`locked_at = ${stamp.lockedAt}`);
      if ("returnReason" in stamp) assignments.push(sql`return_reason = ${stamp.returnReason}`);
      if ("reviewComment" in stamp) assignments.push(sql`review_comment = ${stamp.reviewComment}`);

      const eventId = crypto.randomUUID();
      const changed = await db.execute<{ id: string }>(sql`
        with changed as (
          update reporting_period
          set ${sql.join(assignments, sql`, `)}
          where id = ${input.periodId} and status = ${from} and updated_at = ${period.updatedAt}
          returning id
        )
        insert into reporting_period_event
          (id, period_id, from_status, to_status, actor_id, actor_name, comment)
        select
          ${eventId}, id, ${from}, ${input.to}, ${ctx.session.user.id},
          ${ctx.session.user.name}, ${input.comment ?? null}
        from changed
        returning id
      `);
      if (changed.rows.length === 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "This period changed while you were viewing it. Refresh and try again.",
        });
      }

      const [projectRow] = await db
        .select({ code: project.code, name: project.name })
        .from(project)
        .where(eq(project.id, period.projectId));

      await recordActivity(ctx, {
        action: TRANSITION_ACTIONS[input.to],
        entityType: "period",
        entityId: input.periodId,
        entityLabel: projectRow ? `${projectRow.code} - ${projectRow.name}` : period.projectId,
        detail: `${period.label ?? `#${period.periodIndex}`}${input.comment ? ` - ${input.comment}` : ""}`,
      });

      return { status: input.to };
    }),
});
