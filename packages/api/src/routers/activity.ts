import { db } from "@DashboardV2/db";
import { activityLog } from "@DashboardV2/db/schema";
import { Effect } from "effect";
import { and, count, desc, eq, ne } from "drizzle-orm";
import z from "zod";

import { companyPermissionProcedure, router } from "../index";
import { attempt, runProcedure } from "../lib/effect";

export const activityRouter = router({
  list: companyPermissionProcedure("activity:read")
    .input(
      z.object({
        limit: z.number().int().min(1).max(100).default(10),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(({ ctx, input }) =>
      runProcedure(
        Effect.gen(function* () {
          const inCompany = and(
            eq(activityLog.companyId, ctx.companyId),
            ne(activityLog.entityType, "daily_report"),
          );
          const [entries, [total]] = yield* Effect.all([
            attempt(() =>
              db
                .select()
                .from(activityLog)
                .where(inCompany)
                .orderBy(desc(activityLog.createdAt))
                .limit(input.limit)
                .offset(input.offset),
            ),
            attempt(() => db.select({ value: count() }).from(activityLog).where(inCompany)),
          ], { concurrency: "unbounded" });

          // actorName / entityLabel are read straight off the row — no joins. That
          // is what lets the feed still name a deleted user or a deleted project.
          return { entries, total: total?.value ?? 0 };
        }),
      ),
    ),
});
