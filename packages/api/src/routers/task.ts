import { db } from "@DashboardV2/db";
import { TASK_PRIORITIES, TASK_STATUSES, project, task, user } from "@DashboardV2/db/schema";
import { TRPCError } from "@trpc/server";
import { and, asc, count, eq, or, sql } from "drizzle-orm";
import z from "zod";

import { adminCompanyProcedure, companyProcedure, router } from "../index";
import { assertProjectInScope, assertUserAssignable } from "../lib/scope";

const statusSchema = z.enum(TASK_STATUSES);
const prioritySchema = z.enum(TASK_PRIORITIES);

const upsertSchema = z.object({
  projectId: z.string().min(1),
  title: z.string().trim().min(1, "Title is required").max(200),
  description: z.string().trim().max(2000).optional(),
  status: statusSchema.default("todo"),
  priority: prioritySchema.default("medium"),
  assigneeId: z.string().min(1).optional(),
  dueDate: z.iso.date().optional(),
  isMilestone: z.boolean().default(false),
});

/**
 * Tasks carry no company of their own, so every entry point resolves scope
 * through the parent project before touching a row.
 */
async function assertTaskInScope(companyId: string, taskId: string) {
  const [row] = await db
    .select({ companyId: project.companyId })
    .from(task)
    .innerJoin(project, eq(task.projectId, project.id))
    .where(eq(task.id, taskId));
  if (!row || row.companyId !== companyId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });
  }
}

export const taskRouter = router({
  listByProject: companyProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        status: statusSchema.optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      await assertProjectInScope(ctx.companyId, input.projectId);

      const where = input.status
        ? and(eq(task.projectId, input.projectId), eq(task.status, input.status))
        : eq(task.projectId, input.projectId);

      const rows = await db
        .select({
          id: task.id,
          title: task.title,
          description: task.description,
          status: task.status,
          priority: task.priority,
          dueDate: task.dueDate,
          isMilestone: task.isMilestone,
          assigneeId: task.assigneeId,
          assigneeName: user.name,
          createdAt: task.createdAt,
        })
        .from(task)
        .leftJoin(user, eq(user.id, task.assigneeId))
        .where(where)
        // Milestones first, then earliest due date. Nulls last so undated work
        // doesn't crowd out anything actually scheduled.
        .orderBy(sql`${task.isMilestone} desc`, sql`${task.dueDate} asc nulls last`);

      const counts = await db
        .select({ status: task.status, value: count() })
        .from(task)
        .where(eq(task.projectId, input.projectId))
        .groupBy(task.status);

      return {
        tasks: rows,
        counts: Object.fromEntries(
          TASK_STATUSES.map((status) => [
            status,
            counts.find((row) => row.status === status)?.value ?? 0,
          ]),
        ) as Record<(typeof TASK_STATUSES)[number], number>,
      };
    }),

  /**
   * Assignable users for the task form, and the manager picker on the project
   * form. Scoped to the company's own staff, plus admins — who are unpinned
   * operators of the whole system and would otherwise be unassignable.
   */
  assignees: companyProcedure.query(async ({ ctx }) => {
    return db
      .select({ id: user.id, name: user.name, email: user.email })
      .from(user)
      .where(
        and(
          eq(user.banned, false),
          or(eq(user.companyId, ctx.companyId), eq(user.role, "admin")),
        ),
      )
      .orderBy(asc(user.name));
  }),

  create: adminCompanyProcedure.input(upsertSchema).mutation(async ({ ctx, input }) => {
    await assertProjectInScope(ctx.companyId, input.projectId);
    if (input.assigneeId) {
      await assertUserAssignable(ctx.companyId, input.assigneeId);
    }
    const [created] = await db.insert(task).values(input).returning({ id: task.id });
    return { id: created?.id };
  }),

  update: adminCompanyProcedure
    .input(upsertSchema.partial().extend({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { id: taskId, ...rest } = input;
      await assertTaskInScope(ctx.companyId, taskId);
      // Moving a task between projects must not move it between companies.
      if (rest.projectId) {
        await assertProjectInScope(ctx.companyId, rest.projectId);
      }
      if (rest.assigneeId) {
        await assertUserAssignable(ctx.companyId, rest.assigneeId);
      }
      await db.update(task).set(rest).where(eq(task.id, taskId));
      return { success: true };
    }),

  /**
   * The one write any signed-in user may perform: moving work along. Everything
   * else about a task stays admin-only.
   */
  setStatus: companyProcedure
    .input(z.object({ id: z.string().min(1), status: statusSchema }))
    .mutation(async ({ ctx, input }) => {
      await assertTaskInScope(ctx.companyId, input.id);
      await db.update(task).set({ status: input.status }).where(eq(task.id, input.id));
      return { success: true };
    }),

  delete: adminCompanyProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await assertTaskInScope(ctx.companyId, input.id);
      await db.delete(task).where(eq(task.id, input.id));
      return { success: true };
    }),
});
