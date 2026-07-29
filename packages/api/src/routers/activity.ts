import { db } from "@DashboardV2/db";
import { activityLog } from "@DashboardV2/db/schema";
import { count, desc, eq } from "drizzle-orm";
import z from "zod";

import { companyPermissionProcedure, router } from "../index";

export const activityRouter = router({
  list: companyPermissionProcedure("activity:read")
    .input(
      z.object({
        limit: z.number().int().min(1).max(100).default(10),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      const inCompany = eq(activityLog.companyId, ctx.companyId);
      const [entries, [total]] = await Promise.all([
        db
          .select()
          .from(activityLog)
          .where(inCompany)
          .orderBy(desc(activityLog.createdAt))
          .limit(input.limit)
          .offset(input.offset),
        db.select({ value: count() }).from(activityLog).where(inCompany),
      ]);

      // actorName / entityLabel are read straight off the row — no joins. That
      // is what lets the feed still name a deleted user or a deleted project.
      return { entries, total: total?.value ?? 0 };
    }),
});
