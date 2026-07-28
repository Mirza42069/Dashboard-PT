import { db } from "@DashboardV2/db";
import {
  boqItem,
  boqItemDistribution,
  progressEntry,
  project,
  reportingPeriod,
} from "@DashboardV2/db/schema";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import z from "zod";

import { adminCompanyProcedure, companyProcedure, router } from "../index";
import { recordActivity } from "../lib/activity";
import { runBatch } from "../lib/batch";
import { getVersion, leafPredicate, requireDraft } from "../lib/boq";
import { assertProjectInScope } from "../lib/scope";
import { PeriodRangeError, generatePeriods } from "../lib/periods";
import { toAmount } from "../lib/money";

/** Percentages are stored to six decimals, matching the column. */
const toPctString = (value: number) => value.toFixed(6);

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
  listPeriods: companyProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      await assertProjectInScope(ctx.companyId, input.projectId);
      return listPeriodsFor(input.projectId);
    }),

  /**
   * Rebuilds the time axis from the project's dates and cadence.
   *
   * Refused once any progress exists: the periods are what every recorded
   * reading is attached to, and regenerating them would either orphan those
   * readings or move them to dates nobody reported against.
   */
  generatePeriods: adminCompanyProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const [target] = await db
        .select()
        .from(project)
        .where(and(eq(project.id, input.projectId), eq(project.companyId, ctx.companyId)));
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

      await runBatch([
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
      ]);

      await recordActivity(ctx, {
        action: "generated",
        entityType: "period",
        entityId: input.projectId,
        entityLabel: `${target.code} · ${target.name}`,
        detail: `${periods.length} ${target.periodType} periods`,
      });

      return { periods: await listPeriodsFor(input.projectId) };
    }),

  getDistribution: companyProcedure
    .input(z.object({ versionId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      await getVersion(ctx.companyId, input.versionId);

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
  setDistributionCells: adminCompanyProcedure
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
      const version = await requireDraft(ctx.companyId, input.versionId);

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
   * Spreads an item's plan evenly across every period, as a starting point that
   * is quicker to correct than an empty row is to fill. The remainder lands on
   * the final period so the row totals exactly 100.
   */
  distributeEvenly: adminCompanyProcedure
    .input(z.object({ versionId: z.string().min(1), boqItemId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const version = await requireDraft(ctx.companyId, input.versionId);
      await assertLeavesOfVersion(input.versionId, [input.boqItemId]);

      const periods = await listPeriodsFor(version.projectId);
      if (periods.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Generate the reporting periods first.",
        });
      }

      const share = Number((100 / periods.length).toFixed(6));
      const cells = periods.map((period, index) => ({
        boqItemId: input.boqItemId,
        periodId: period.id,
        plannedPct:
          index === periods.length - 1
            ? Number((100 - share * (periods.length - 1)).toFixed(6))
            : share,
      }));

      await runBatch([
        db
          .insert(boqItemDistribution)
          .values(
            cells.map((cell) => ({
              boqItemId: cell.boqItemId,
              periodId: cell.periodId,
              plannedPct: toPctString(cell.plannedPct),
            })),
          )
          .onConflictDoUpdate({
            target: [boqItemDistribution.boqItemId, boqItemDistribution.periodId],
            set: { plannedPct: sql`excluded.planned_pct` },
          }),
        db.update(boqItem).set({ distribution: "linear" }).where(eq(boqItem.id, input.boqItemId)),
      ]);

      return { success: true };
    }),

  /** Clears every planned cell for one item. */
  clearItemDistribution: adminCompanyProcedure
    .input(z.object({ versionId: z.string().min(1), boqItemId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await requireDraft(ctx.companyId, input.versionId);
      await assertLeavesOfVersion(input.versionId, [input.boqItemId]);

      await db
        .delete(boqItemDistribution)
        .where(eq(boqItemDistribution.boqItemId, input.boqItemId));

      return { success: true };
    }),
});
