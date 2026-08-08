import { db } from "@DashboardV2/db";
import {
  boqItem,
  boqItemDistribution,
  boqVersion,
  dailyReport,
  progressEntry,
  project,
  reportingPeriod,
  ticket,
} from "@DashboardV2/db/schema";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import z from "zod";

import { constructionPermissionProcedure, router } from "../index";
import { recordActivity } from "../lib/activity";
import { runBatch } from "../lib/batch";
import { getVersion, leafPredicate } from "../lib/boq";
import { assertProjectAccess, type ProjectScopeCtx } from "../lib/scope";
import { PeriodRangeError, generatePeriods } from "../lib/periods";
import { toAmount } from "../lib/money";
import { planCells, validatePlanWindow } from "../lib/schedule-plan";

/** Percentages are stored to six decimals, matching the column. */
const toPctString = (value: number) => value.toFixed(6);

/**
 * Ceiling on the planned cells one mutation may write.
 *
 * A batch goes to Neon as a single HTTP request, so an unbounded bulk apply is
 * a request-body limit waiting to be hit — 500 lines across 600 periods is
 * 300,000 rows. Well above any real schedule, and low enough to fail with a
 * sentence rather than a truncated request.
 */
const MAX_PLAN_CELLS = 20_000;

async function requireScheduleDraft(ctx: ProjectScopeCtx, versionId: string) {
  const version = await getVersion(ctx, versionId);
  const editable =
    version.scheduleStatus === "draft" &&
    (version.status === "draft" || version.status === "active");
  if (!editable) {
    throw new TRPCError({ code: "CONFLICT", message: "This schedule is active and locked." });
  }
  return version;
}

async function listPeriodsFor(projectId: string) {
  return db
    .select({
      id: reportingPeriod.id,
      periodIndex: reportingPeriod.periodIndex,
      label: reportingPeriod.label,
      startDate: reportingPeriod.startDate,
      endDate: reportingPeriod.endDate,
      status: reportingPeriod.status,
    })
    .from(reportingPeriod)
    .where(eq(reportingPeriod.projectId, projectId))
    .orderBy(asc(reportingPeriod.periodIndex));
}

/**
 * Every id must be a live leaf of this version. Sections are rollups and
 * carry no plan of their own, so accepting one would create a cell that
 * silently never counts toward anything.
 */
async function assertLeavesOfVersion(versionId: string, itemIds: string[]) {
  if (itemIds.length === 0) return;

  const leaves = await db
    .select({ id: boqItem.id })
    .from(boqItem)
    .where(
      and(
        eq(boqItem.boqVersionId, versionId),
        inArray(boqItem.id, itemIds),
        isNull(boqItem.deletedAt),
        leafPredicate("boq_item"),
      ),
    );

  const found = new Set(leaves.map((row) => row.id));
  const missing = itemIds.filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Only priced BoQ lines can be scheduled — sections roll up from theirs.",
    });
  }
}

async function assertPeriodsOfProject(projectId: string, periodIds: string[]) {
  if (periodIds.length === 0) return;

  const periods = await db
    .select({ id: reportingPeriod.id })
    .from(reportingPeriod)
    .where(and(eq(reportingPeriod.projectId, projectId), inArray(reportingPeriod.id, periodIds)));

  if (periods.length !== new Set(periodIds).size) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Unknown reporting period" });
  }
}

export const scheduleRouter = router({
  listPeriods: constructionPermissionProcedure("project:read")
    .input(z.object({ projectId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId);
      return listPeriodsFor(input.projectId);
    }),

  updateSettings: constructionPermissionProcedure("project:write")
    .input(
      z.object({
        projectId: z.string().min(1),
        versionId: z.string().min(1),
        startDate: z.iso.date(),
        endDate: z.iso.date(),
        scheduleStart: z.iso.date().nullish(),
        periodType: z.enum(["weekly", "biweekly", "monthly"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId);
      const version = await requireScheduleDraft(ctx, input.versionId);
      if (version.projectId !== input.projectId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Baseline does not belong to this project." });
      }
      if (input.endDate < input.startDate) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "End date is before the start date." });
      }
      if (input.scheduleStart && input.scheduleStart < input.startDate) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Reporting cannot start before the project." });
      }

      const [[recorded], [activeSchedule]] = await Promise.all([
        db
          .select({ id: progressEntry.id })
          .from(progressEntry)
          .where(eq(progressEntry.projectId, input.projectId))
          .limit(1),
        db
          .select({ id: boqVersion.id })
          .from(boqVersion)
          .where(
            and(
              eq(boqVersion.projectId, input.projectId),
              eq(boqVersion.status, "active"),
              eq(boqVersion.scheduleStatus, "active"),
            ),
          )
          .limit(1),
      ]);
      if (recorded || activeSchedule) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Baseline timing is fixed after the first baseline is activated.",
        });
      }

      await db
        .update(project)
        .set({
          startDate: input.startDate,
          endDate: input.endDate,
          scheduleStart: input.scheduleStart ?? null,
          periodType: input.periodType,
        })
        .where(eq(project.id, input.projectId));
      return { success: true };
    }),

  /**
   * Rebuilds the time axis from the project's dates and cadence.
   *
   * Refused once any progress exists: the periods are what every recorded
   * reading is attached to, and regenerating them would either orphan those
   * readings or move them to dates nobody reported against.
   */
  generatePeriods: constructionPermissionProcedure("project:write")
    .input(z.object({ projectId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId);
      const [target] = await db.select().from(project).where(eq(project.id, input.projectId));
      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      }

      const start = target.scheduleStart ?? target.startDate;
      const finish = target.endDate;
      if (!start || !finish) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Set the project's start and target completion dates first.",
        });
      }

      const [recorded] = await db
        .select({ id: progressEntry.id })
        .from(progressEntry)
        .where(eq(progressEntry.projectId, input.projectId))
        .limit(1);

      if (recorded) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Progress has already been recorded, so the reporting periods can no longer be rebuilt.",
        });
      }

      const [existingReport] = await db
        .select({ id: dailyReport.id })
        .from(dailyReport)
        .where(and(eq(dailyReport.projectId, input.projectId), isNotNull(dailyReport.periodId)))
        .limit(1);
      if (existingReport) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Daily reports already use these periods, so they can no longer be rebuilt.",
        });
      }

      const [linkedAction] = await db
        .select({ id: ticket.id })
        .from(ticket)
        .where(and(eq(ticket.projectId, input.projectId), isNotNull(ticket.periodId)))
        .limit(1);
      if (linkedAction) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Actions already use these periods, so they can no longer be rebuilt.",
        });
      }

      const [activeSchedule] = await db
        .select({ id: boqVersion.id })
        .from(boqVersion)
        .where(
          and(eq(boqVersion.projectId, input.projectId), eq(boqVersion.scheduleStatus, "active")),
        )
        .limit(1);
      if (activeSchedule) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "The active schedule uses these periods, so they can no longer be rebuilt.",
        });
      }

      let periods;
      try {
        periods = generatePeriods(start, finish, target.periodType);
      } catch (error) {
        if (error instanceof PeriodRangeError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
        }
        throw error;
      }

      if (periods.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No periods fall inside those dates.",
        });
      }

      try {
        await runBatch([
          db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.projectId}, 0))`),
          // Recheck under the project lock. The earlier checks provide specific
          // messages; this one closes the gap where another request starts using
          // a period while this request is preparing the replacement axis.
          db.execute(sql`
            select 1 / case when
              exists (select 1 from progress_entry where project_id = ${input.projectId})
              or exists (
                select 1 from daily_report
                where project_id = ${input.projectId} and period_id is not null
              )
              or exists (
                select 1 from ticket
                where project_id = ${input.projectId} and period_id is not null
              )
              or exists (
                select 1 from boq_version
                where project_id = ${input.projectId} and schedule_status = 'active'
              )
            then 0 else 1 end
          `),
          db.delete(reportingPeriod).where(eq(reportingPeriod.projectId, input.projectId)),
          db.insert(reportingPeriod).values(
            periods.map((period) => ({
              projectId: input.projectId,
              periodIndex: period.periodIndex,
              label: period.label,
              startDate: period.startDate,
              endDate: period.endDate,
            })),
          ),
          db.execute(sql`
            update daily_report as report
            set period_id = period.id, updated_at = now()
            from reporting_period as period
            where report.project_id = ${input.projectId}
              and report.period_id is null
              and period.project_id = report.project_id
              and report.report_date between period.start_date and period.end_date
          `),
        ]);
      } catch (error) {
        if (error instanceof Error && error.message.toLowerCase().includes("division by zero")) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "The reporting periods became in use and can no longer be rebuilt.",
          });
        }
        throw error;
      }

      await recordActivity(ctx, {
        action: "generated",
        entityType: "period",
        entityId: input.projectId,
        entityLabel: `${target.code} - ${target.name}`,
        detail: `${periods.length} ${target.periodType} periods`,
      });

      return { periods: await listPeriodsFor(input.projectId) };
    }),

  getDistribution: constructionPermissionProcedure("project:read")
    .input(z.object({ versionId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      await getVersion(ctx, input.versionId);

      const rows = await db
        .select({
          boqItemId: boqItemDistribution.boqItemId,
          periodId: boqItemDistribution.periodId,
          plannedPct: boqItemDistribution.plannedPct,
        })
        .from(boqItemDistribution)
        .innerJoin(boqItem, eq(boqItem.id, boqItemDistribution.boqItemId))
        .where(eq(boqItem.boqVersionId, input.versionId));

      return rows.map((row) => ({
        boqItemId: row.boqItemId,
        periodId: row.periodId,
        plannedPct: toAmount(row.plannedPct),
      }));
    }),

  /**
   * Writes planned-percentage cells.
   *
   * A cell set to zero is deleted rather than stored — absent and zero mean the
   * same thing to the curve, and not keeping zero rows around stops the matrix
   * growing to items × periods for no reason. All three statements go in one
   * batch so a half-applied edit cannot leave the row totalling something the
   * user never typed.
   */
  setDistributionCells: constructionPermissionProcedure("project:write")
    .input(
      z.object({
        versionId: z.string().min(1),
        cells: z
          .array(
            z.object({
              boqItemId: z.string().min(1),
              periodId: z.string().min(1),
              plannedPct: z.number().min(0).max(100),
            }),
          )
          .min(1)
          .max(2000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const version = await requireScheduleDraft(ctx, input.versionId);

      const itemIds = [...new Set(input.cells.map((cell) => cell.boqItemId))];
      const periodIds = [...new Set(input.cells.map((cell) => cell.periodId))];

      await assertLeavesOfVersion(input.versionId, itemIds);
      await assertPeriodsOfProject(version.projectId, periodIds);

      const cleared = input.cells.filter((cell) => cell.plannedPct <= 0);
      const written = input.cells.filter((cell) => cell.plannedPct > 0);

      const statements = [];

      if (cleared.length > 0) {
        const pairs = sql.join(
          cleared.map((cell) => sql`(${cell.boqItemId}::text, ${cell.periodId}::text)`),
          sql`, `,
        );
        statements.push(
          db
            .delete(boqItemDistribution)
            .where(
              sql`(${boqItemDistribution.boqItemId}, ${boqItemDistribution.periodId}) in (values ${pairs})`,
            ),
        );
      }

      if (written.length > 0) {
        statements.push(
          db
            .insert(boqItemDistribution)
            .values(
              written.map((cell) => ({
                boqItemId: cell.boqItemId,
                periodId: cell.periodId,
                plannedPct: toPctString(cell.plannedPct),
              })),
            )
            .onConflictDoUpdate({
              target: [boqItemDistribution.boqItemId, boqItemDistribution.periodId],
              set: { plannedPct: sql`excluded.planned_pct` },
            }),
        );
      }

      // Records that this item's plan was typed rather than spread evenly.
      statements.push(
        db.update(boqItem).set({ distribution: "manual" }).where(inArray(boqItem.id, itemIds)),
      );

      await runBatch(statements);

      return { success: true };
    }),

  /**
   * Sets the planning window — start period and finish period — on one or many
   * lines, and optionally spreads each line's plan evenly across it.
   *
   * This is the fast path the whole tab exists for. Filling a 17-week schedule
   * by hand is 17 numbers per line; stating "weeks 3 to 17" is two, and the
   * even spread is a starting point that is quicker to correct than an empty
   * row is to fill.
   *
   * `mode: "window"` records the window without touching the cells, which is
   * what preserving manual fine-tuning needs: someone who has hand-adjusted a
   * row and then realises the finish date moved should not lose the adjustment
   * to a silent redistribution.
   */
  setItemPlan: constructionPermissionProcedure("project:write")
    .input(
      z.object({
        versionId: z.string().min(1),
        items: z
          .array(
            z.object({
              boqItemId: z.string().min(1),
              /** Both null clears the window (and, in "even" mode, the row). */
              startPeriodIndex: z.number().int().nullable(),
              finishPeriodIndex: z.number().int().nullable(),
            }),
          )
          .min(1)
          .max(500),
        mode: z.enum(["even", "window"]).default("even"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const version = await requireScheduleDraft(ctx, input.versionId);

      const itemIds = [...new Set(input.items.map((item) => item.boqItemId))];
      await assertLeavesOfVersion(input.versionId, itemIds);

      const periods = await listPeriodsFor(version.projectId);
      if (periods.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Generate the reporting periods first.",
        });
      }

      const periodIndexes = periods.map((period) => period.periodIndex);
      const periodIdByIndex = new Map(periods.map((period) => [period.periodIndex, period.id]));

      // Every window is checked before anything is written. A bulk apply that
      // took the first eight lines and rejected the ninth would leave the user
      // to work out which eight moved.
      const windows = input.items.map((item) => {
        const hasWindow = item.startPeriodIndex !== null && item.finishPeriodIndex !== null;
        if (!hasWindow) {
          if (item.startPeriodIndex !== null || item.finishPeriodIndex !== null) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "A planning window needs both a start and a finish period.",
            });
          }
          return { boqItemId: item.boqItemId, window: null };
        }

        const window = {
          startIndex: item.startPeriodIndex as number,
          finishIndex: item.finishPeriodIndex as number,
        };
        const problem = validatePlanWindow(window, periodIndexes);
        if (problem?.kind === "finish_before_start") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "The finish period cannot come before the start period.",
          });
        }
        if (problem?.kind === "out_of_range") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Periods run from ${problem.firstIndex} to ${problem.lastIndex}.`,
          });
        }
        return { boqItemId: item.boqItemId, window };
      });

      const statements: Parameters<typeof runBatch>[0] = [];

      if (input.mode === "even") {
        // The whole row is rewritten, so the old cells go in one statement
        // rather than as an (item, period) pair list — at 500 lines against 600
        // periods that list would be 300,000 tuples in a single query.
        statements.push(
          db.delete(boqItemDistribution).where(inArray(boqItemDistribution.boqItemId, itemIds)),
        );

        const values = windows.flatMap(({ boqItemId, window }) => {
          if (!window) return [];
          return planCells(periodIndexes, window)
            .filter((cell) => cell.plannedPct > 0)
            .map((cell) => ({
              boqItemId,
              periodId: periodIdByIndex.get(cell.periodIndex)!,
              plannedPct: toPctString(cell.plannedPct),
            }));
        });

        // Neon sends a batch as one request; an unbounded insert here is how a
        // wide schedule applied to every line would blow the body limit.
        if (values.length > MAX_PLAN_CELLS) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `That would write ${values.length} planned cells at once. Apply the plan to fewer lines.`,
          });
        }
        if (values.length > 0) {
          statements.push(db.insert(boqItemDistribution).values(values));
        }
      }

      const windowRows = sql.join(
        windows.map(
          ({ boqItemId, window }) =>
            sql`(${boqItemId}::text, ${window?.startIndex ?? null}::int, ${window?.finishIndex ?? null}::int)`,
        ),
        sql`, `,
      );

      statements.push(
        db.execute(sql`
          update boq_item
          set planned_start_period_index = plan.start_index,
              planned_finish_period_index = plan.finish_index,
              ${input.mode === "even" ? sql`distribution = 'linear',` : sql``}
              updated_at = now()
          from (values ${windowRows}) as plan(id, start_index, finish_index)
          where boq_item.id = plan.id
            and boq_item.boq_version_id = ${input.versionId}
        `),
      );

      await runBatch(statements);

      return { success: true };
    }),

  /**
   * Copies one line's plan onto others — the schedule equivalent of filling a
   * column down. Lines that run to the same programme (every floor of the same
   * slab, say) are the common case, and retyping the window for each is exactly
   * the spreadsheet drudgery this tab replaces.
   */
  copyDistribution: constructionPermissionProcedure("project:write")
    .input(
      z.object({
        versionId: z.string().min(1),
        sourceItemId: z.string().min(1),
        targetItemIds: z.array(z.string().min(1)).min(1).max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireScheduleDraft(ctx, input.versionId);

      const targetIds = [...new Set(input.targetItemIds)].filter((id) => id !== input.sourceItemId);
      if (targetIds.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Choose at least one line to copy the plan onto.",
        });
      }
      await assertLeavesOfVersion(input.versionId, [input.sourceItemId, ...targetIds]);

      const [[source], sourceCells] = await Promise.all([
        db
          .select({
            distribution: boqItem.distribution,
            plannedStartPeriodIndex: boqItem.plannedStartPeriodIndex,
            plannedFinishPeriodIndex: boqItem.plannedFinishPeriodIndex,
          })
          .from(boqItem)
          .where(eq(boqItem.id, input.sourceItemId)),
        db
          .select({
            periodId: boqItemDistribution.periodId,
            plannedPct: boqItemDistribution.plannedPct,
          })
          .from(boqItemDistribution)
          .where(eq(boqItemDistribution.boqItemId, input.sourceItemId)),
      ]);

      if (!source) {
        throw new TRPCError({ code: "NOT_FOUND", message: "BoQ line not found" });
      }

      const cellCount = sourceCells.length * targetIds.length;
      if (cellCount > MAX_PLAN_CELLS) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `That would write ${cellCount} planned cells at once. Copy onto fewer lines.`,
        });
      }

      const statements: Parameters<typeof runBatch>[0] = [
        db.delete(boqItemDistribution).where(inArray(boqItemDistribution.boqItemId, targetIds)),
      ];

      if (sourceCells.length > 0) {
        statements.push(
          db.insert(boqItemDistribution).values(
            targetIds.flatMap((boqItemId) =>
              sourceCells.map((cell) => ({
                boqItemId,
                periodId: cell.periodId,
                plannedPct: cell.plannedPct,
              })),
            ),
          ),
        );
      }

      statements.push(
        db
          .update(boqItem)
          .set({
            distribution: source.distribution,
            plannedStartPeriodIndex: source.plannedStartPeriodIndex,
            plannedFinishPeriodIndex: source.plannedFinishPeriodIndex,
          })
          .where(inArray(boqItem.id, targetIds)),
      );

      await runBatch(statements);

      return { copied: targetIds.length };
    }),

  /** Clears the planned cells and the planning window on one or many lines. */
  clearItemDistribution: constructionPermissionProcedure("project:write")
    .input(
      z.object({
        versionId: z.string().min(1),
        boqItemIds: z.array(z.string().min(1)).min(1).max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireScheduleDraft(ctx, input.versionId);
      const itemIds = [...new Set(input.boqItemIds)];
      await assertLeavesOfVersion(input.versionId, itemIds);

      await runBatch([
        db.delete(boqItemDistribution).where(inArray(boqItemDistribution.boqItemId, itemIds)),
        db
          .update(boqItem)
          .set({ plannedStartPeriodIndex: null, plannedFinishPeriodIndex: null })
          .where(inArray(boqItem.id, itemIds)),
      ]);

      return { cleared: itemIds.length };
    }),
});
