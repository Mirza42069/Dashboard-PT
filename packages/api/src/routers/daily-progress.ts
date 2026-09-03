import { db } from "@DashboardV2/db";
import { dailyProgressItem, dailyProgressSnapshot, reportingPeriod } from "@DashboardV2/db/schema";
import { TRPCError } from "@trpc/server";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { companyPermissionProcedure, router } from "../index";
import { toAmount } from "../lib/money";
import { assertProjectAccess } from "../lib/scope";

export const dailyProgressRouter = router({
  list: companyPermissionProcedure("project:read")
    .input(z.object({ projectId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId);
      const rows = await db
        .select({
          id: dailyProgressSnapshot.id,
          reportDate: dailyProgressSnapshot.reportDate,
          cumulativePercent: dailyProgressSnapshot.cumulativePercent,
          sourceFilename: dailyProgressSnapshot.sourceFilename,
          sourceSheetName: dailyProgressSnapshot.sourceSheetName,
          periodId: dailyProgressSnapshot.periodId,
          periodIndex: reportingPeriod.periodIndex,
          periodLabel: reportingPeriod.label,
        })
        .from(dailyProgressSnapshot)
        .innerJoin(reportingPeriod, eq(reportingPeriod.id, dailyProgressSnapshot.periodId))
        .where(eq(dailyProgressSnapshot.projectId, input.projectId))
        .orderBy(asc(dailyProgressSnapshot.reportDate));

      return rows.map((row) => ({
        ...row,
        cumulativePercent: toAmount(row.cumulativePercent),
      }));
    }),

  detail: companyPermissionProcedure("project:read")
    .input(z.object({ projectId: z.string().min(1), snapshotId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId);
      const [snapshot] = await db
        .select()
        .from(dailyProgressSnapshot)
        .where(
          and(
            eq(dailyProgressSnapshot.id, input.snapshotId),
            eq(dailyProgressSnapshot.projectId, input.projectId),
          ),
        )
        .limit(1);
      if (!snapshot) {
        throw new TRPCError({ code: "NOT_FOUND", message: ctx.t.project.notFound });
      }
      const items = await db
        .select()
        .from(dailyProgressItem)
        .where(
          and(
            eq(dailyProgressItem.snapshotId, input.snapshotId),
            eq(dailyProgressItem.projectId, input.projectId),
          ),
        )
        .orderBy(asc(dailyProgressItem.sourceRow));

      return {
        snapshot: { ...snapshot, cumulativePercent: toAmount(snapshot.cumulativePercent) },
        items: items.map((item) => ({
          ...item,
          quantity: item.quantity === null ? null : toAmount(item.quantity),
          unitRate: item.unitRate === null ? null : toAmount(item.unitRate),
          amount: item.amount === null ? null : toAmount(item.amount),
          weight: toAmount(item.weight),
          previousPercent: item.previousPercent === null ? null : toAmount(item.previousPercent),
          currentPercent: item.currentPercent === null ? null : toAmount(item.currentPercent),
          cumulativePercent: toAmount(item.cumulativePercent),
          remainingPercent: item.remainingPercent === null ? null : toAmount(item.remainingPercent),
          previousWeighted: item.previousWeighted === null ? null : toAmount(item.previousWeighted),
          currentWeighted: item.currentWeighted === null ? null : toAmount(item.currentWeighted),
          cumulativeWeighted: toAmount(item.cumulativeWeighted),
          remainingWeighted: item.remainingWeighted === null ? null : toAmount(item.remainingWeighted),
        })),
      };
    }),
});
