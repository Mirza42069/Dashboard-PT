import { db } from "@DashboardV2/db";
import { EXPENSE_CATEGORIES, expense, project, user } from "@DashboardV2/db/schema";
import { TRPCError } from "@trpc/server";
import { desc, eq, sum } from "drizzle-orm";
import z from "zod";

import { adminProcedure, protectedProcedure, router } from "../index";
import { recordActivity } from "../lib/activity";
import { toAmount, toNumericString } from "../lib/money";

export const expenseRouter = router({
  listByProject: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        limit: z.number().int().min(1).max(200).default(50),
      }),
    )
    .query(async ({ input }) => {
      const [rows, [total]] = await Promise.all([
        db
          .select({
            id: expense.id,
            category: expense.category,
            description: expense.description,
            amount: expense.amount,
            incurredOn: expense.incurredOn,
            recordedByName: user.name,
          })
          .from(expense)
          .leftJoin(user, eq(user.id, expense.recordedById))
          .where(eq(expense.projectId, input.projectId))
          .orderBy(desc(expense.incurredOn), desc(expense.createdAt))
          .limit(input.limit),
        db
          .select({ total: sum(expense.amount) })
          .from(expense)
          .where(eq(expense.projectId, input.projectId)),
      ]);

      return {
        expenses: rows.map((row) => ({ ...row, amount: toAmount(row.amount) })),
        total: toAmount(total?.total),
      };
    }),

  create: adminProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        category: z.enum(EXPENSE_CATEGORIES),
        description: z.string().trim().min(1, "Description is required").max(500),
        amount: z.number().positive("Amount must be greater than zero"),
        incurredOn: z.iso.date(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [target] = await db
        .select({ id: project.id, code: project.code })
        .from(project)
        .where(eq(project.id, input.projectId));
      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      }

      const [created] = await db
        .insert(expense)
        .values({
          ...input,
          amount: toNumericString(input.amount),
          recordedById: ctx.session.user.id,
        })
        .returning({ id: expense.id });

      if (created) {
        await recordActivity(ctx, {
          action: "created",
          entityType: "expense",
          entityId: created.id,
          entityLabel: `${target.code} · ${input.description}`,
        });
      }

      return { id: created?.id };
    }),

  delete: adminProcedure.input(z.object({ id: z.string().min(1) })).mutation(async ({ ctx, input }) => {
    const [target] = await db
      .select({ description: expense.description, code: project.code })
      .from(expense)
      .innerJoin(project, eq(project.id, expense.projectId))
      .where(eq(expense.id, input.id));

    await db.delete(expense).where(eq(expense.id, input.id));

    if (target) {
      await recordActivity(ctx, {
        action: "deleted",
        entityType: "expense",
        entityId: input.id,
        entityLabel: `${target.code} · ${target.description}`,
      });
    }

    return { success: true };
  }),
});
