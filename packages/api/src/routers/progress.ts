import { db } from "@DashboardV2/db";
import {
  boqItem,
  boqItemDistribution,
  boqVersion,
  progressEntry,
  project,
  reportingPeriod,
} from "@DashboardV2/db/schema";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import z from "zod";

import { adminCompanyProcedure, companyProcedure, router } from "../index";
import { recordActivity } from "../lib/activity";
import { runBatch } from "../lib/batch";
import { computePctComplete, leafPredicate, serializeItem, serializeVersion } from "../lib/boq";
import { refreshDataDateStatement } from "../lib/boq-metrics";
import { toAmount } from "../lib/money";
import { assertProjectInScope } from "../lib/scope";

export const progressRouter = router({
  /**
   * Everything the BoQ, schedule and progress tabs need, in one round trip.
   *
   * The curves are deliberately *not* computed here. Drawing them needs the
   * whole item × period grid in the browser anyway, and computing planned and
   * actual from the same arrays the chart renders means the headline deviation
   * can never disagree with the line the user is looking at.
   */
  report: companyProcedure
    .input(z.object({ projectId: z.string().min(1), versionId: z.string().min(1).optional() }))
    .query(async ({ ctx, input }) => {
      await assertProjectInScope(ctx.companyId, input.projectId);

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
  bulkSave: adminCompanyProcedure
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
      const [period] = await db
        .select({
          id: reportingPeriod.id,
          projectId: reportingPeriod.projectId,
          label: reportingPeriod.label,
          status: reportingPeriod.status,
        })
        .from(reportingPeriod)
        .innerJoin(project, eq(project.id, reportingPeriod.projectId))
        .where(and(eq(reportingPeriod.id, input.periodId), eq(project.companyId, ctx.companyId)));

      if (!period) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Reporting period not found" });
      }
      if (period.status === "locked") {
        throw new TRPCError({
          code: "CONFLICT",
          message: "This period is locked and can no longer be edited.",
        });
      }

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
          projectId: period.projectId,
          periodId: input.periodId,
          boqItemId: entry.boqItemId,
          cumulativeQuantity: cumulativeQuantity === null ? null : cumulativeQuantity.toFixed(4),
          cumulativePercent: cumulativePercent === null ? null : cumulativePercent.toFixed(4),
          pctComplete: pctComplete.toFixed(4),
          note: entry.note ?? null,
          recordedById: ctx.session.user.id,
        };
      });

      await runBatch([
        db
          .insert(progressEntry)
          .values(values)
          .onConflictDoUpdate({
            target: [progressEntry.periodId, progressEntry.boqItemId],
            set: {
              cumulativeQuantity: sql`excluded.cumulative_quantity`,
              cumulativePercent: sql`excluded.cumulative_percent`,
              pctComplete: sql`excluded.pct_complete`,
              note: sql`excluded.note`,
              recordedById: sql`excluded.recorded_by_id`,
              updatedAt: new Date(),
            },
          }),
        db.execute(refreshDataDateStatement(period.projectId)),
      ]);

      await recordActivity(ctx, {
        action: "progress_recorded",
        entityType: "progress",
        entityId: period.projectId,
        entityLabel: projectRow ? `${projectRow.code} · ${projectRow.name}` : period.projectId,
        detail: `${input.entries.length} line(s) · ${period.label ?? ""}`.trim(),
      });

      return { success: true };
    }),

  /**
   * Locking freezes a period once it has been reported and agreed. Reversible,
   * because a late correction to an agreed period is a normal thing to need.
   */
  setPeriodStatus: adminCompanyProcedure
    .input(
      z.object({
        periodId: z.string().min(1),
        status: z.enum(["open", "locked"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [updated] = await db
        .update(reportingPeriod)
        .set({ status: input.status })
        .where(
          and(
            eq(reportingPeriod.id, input.periodId),
            sql`exists (
              select 1 from project
              where project.id = ${reportingPeriod.projectId}
                and project.company_id = ${ctx.companyId}
            )`,
          ),
        )
        .returning({ id: reportingPeriod.id });

      if (!updated) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Reporting period not found" });
      }

      return { success: true };
    }),
});
